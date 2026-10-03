import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  createOpenAIExtractorAttachmentReport,
  parseOpenAIExtractorReportArgs,
} from '../../examples/benchmarks/openai-blueprint-reports.js';
import { withTempDirectory } from '../helpers/temp.js';

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
