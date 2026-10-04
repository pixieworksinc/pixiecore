import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  createOpenAIExtractorAttachmentReport,
  parseOpenAIExtractorReportArgs,
  renderOpenAIExtractorAttachmentReport,
} from '../../examples/benchmarks/openai-blueprint-reports.js';
import { testData } from '../helpers/test-data.js';
import { withTempDirectory } from '../helpers/temp.js';

const data = testData('OpenAI extractor report limitations');

test('Extractor reports retain limitations from any run and accept older metadata-free cases', async () => {
  await withTempDirectory(async directory => {
    const caseIds = [data.text('limited case', 'case'), data.text('other case', 'case')];
    const datasetId = data.text('extractor dataset', 'dataset');
    const manifestPath = join(directory, 'manifest.json');
    const checkpointPath = join(directory, 'checkpoint.json');
    const hash = createHash('sha256').update(data.text('identity')).digest('hex');
    const timestamp = data.date('completed at').toISOString();
    const manifest = {
      release: '0.1.0',
      datasets: [{
        id: datasetId,
        role: 'extractor',
        path: 'dataset.yaml',
        attachments: caseIds.map(caseId => ({ case_id: caseId, kind: 'native-pdf', path: `${caseId}.pdf` })),
      }],
    };
    const checkpoint = {
      schema: 'pixiecore.openai-blueprint-matrix-checkpoint/v2',
      status: 'completed',
      started_at: timestamp,
      completed_at: timestamp,
      usage: { complete: true },
      plan: {
        provider: 'openai',
        model: data.text('model', 'model'),
        seed: data.text('seed', 'seed'),
        source_revision: hash,
        runs: 3,
        datasets: [datasetId],
        dataset_snapshots: [{
          dataset_id: datasetId,
          dataset_version: '1.0.0',
          blueprint_version: '1.0.0',
          dataset_digest: `sha256:${hash}`,
          blueprint_digest: `sha256:${hash}`,
          comparison_policy_digest: `sha256:${hash}`,
        }],
        pricing: { source: data.text('pricing source') },
      },
      results: [1, 2, 3].map(run => ({
        run,
        dataset_id: datasetId,
        role: 'extractor',
        cases: caseIds.map((id, index) => ({
          id,
          status: 'passed',
          duration_ms: data.integer(`duration ${run}/${id}`, 1, 10),
          provider_usage: [],
          error_name: null,
          ...(run === 2 && index === 0 ? { limitations: ['factuality_not_evaluated'] } : {}),
        })),
      })),
    };
    await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
    await writeFile(checkpointPath, JSON.stringify(checkpoint), 'utf8');
    const report = await createOpenAIExtractorAttachmentReport(checkpointPath, manifestPath, directory);
    assert.deepEqual(report.attachments[0]?.limitations, ['factuality_not_evaluated']);
    assert.equal(Object.isFrozen(report.attachments[0]?.limitations), true);
    assert.equal(report.attachments[1]?.limitations, undefined);
    assert.equal(report.totals.passed, 6);
    assert.equal(report.totals.accuracy, 1);
    const markdown = renderOpenAIExtractorAttachmentReport(report);
    assert.ok(markdown.includes(`> ${caseIds[0]}: includes structural comparisons; factuality was not evaluated`));
    assert.ok(!markdown.includes(`> ${caseIds[1]}: includes structural comparisons`));
    assert.doesNotMatch(JSON.stringify(report), /actual_output|expected_output/u);

    for (const result of checkpoint.results) {
      for (const item of result.cases) Reflect.deleteProperty(item, 'limitations');
    }
    await writeFile(checkpointPath, JSON.stringify(checkpoint), 'utf8');
    const legacy = await createOpenAIExtractorAttachmentReport(checkpointPath, manifestPath, directory);
    assert.ok(legacy.attachments.every(item => item.limitations === undefined));
    assert.deepEqual(legacy.totals, report.totals);
    assert.doesNotMatch(renderOpenAIExtractorAttachmentReport(legacy), /factuality was not evaluated/u);
  });
});

test('legacy Extractor checkpoints cannot be relabeled from current files', async () => {
  await withTempDirectory(async directory => {
    const checkpoint = join(directory, 'legacy-checkpoint.json');
    const manifest = join(directory, 'manifest.json');
    await writeFile(checkpoint, '{"schema":"pixiecore.openai-blueprint-matrix-checkpoint/v1"}\n', 'utf8');
    await writeFile(manifest, '{}\n', 'utf8');
    await assert.rejects(
      createOpenAIExtractorAttachmentReport(checkpoint, manifest, directory),
      /completed v2 OpenAI matrix checkpoint with immutable identity/u,
    );
  }, 'pixiecore-openai-extractor-');
});

test('Extractor report CLI requires distinct JSON and Markdown outputs', () => {
  assert.throws(() => parseOpenAIExtractorReportArgs([
    '--checkpoint=checkpoint.json',
    '--manifest=manifest.json',
    '--json=report.json',
    '--markdown=report.json',
  ]), /different files/u);
});
