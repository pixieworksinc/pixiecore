import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { runInstructionTemplateConformanceSuite } from '../../src/core/kernel/conformance/index.js';
import { testData } from '../helpers/test-data.js';
import { withTempDirectory } from '../helpers/temp.js';

const data = testData('contract/cross-runtime-conformance');
const runnerPath = new URL(
  '../../conformance/runners/compare-instruction-template-reports.mjs',
  import.meta.url,
).pathname;
const comparisonSchema = await readJson(
  new URL(
    '../../schemas/pixiecore.instruction-template-cross-runtime-comparison-v1.schema.json',
    import.meta.url,
  ),
);
test('synthetic independent runtime fixture matches every portable observation', async () => {
  await withTempDirectory(async directory => {
    const baseline = await runInstructionTemplateConformanceSuite();
    const independentFixture = candidateReport(baseline, {
      implementationName: 'IndependentRuntime',
    });
    const result = await compareReports(directory, baseline, independentFixture);
    const comparison = JSON.parse(result.stdout) as {
      readonly compatible: boolean;
      readonly portable_summary: { readonly total: number; readonly failed: number };
      readonly extension_summary: { readonly total: number; readonly failed: number };
    };

    assert.equal(result.status, 0, result.stderr);
    assert.equal(comparison.compatible, true);
    assert.deepEqual(comparison.portable_summary, { total: 7, passed: 7, failed: 0 });
    assert.deepEqual(comparison.extension_summary, { total: 2, passed: 2, failed: 0 });
  }, 'pixiecore-cross-runtime-');
});

test('cross-runtime runner compares portable observations and isolates extension failures', async () => {
  await withTempDirectory(async directory => {
    const baseline = await runInstructionTemplateConformanceSuite();
    const candidate = candidateReport(baseline, {
      implementationName: data.text('candidate implementation', 'runtime'),
      changedCaseId: 'compatibility.flat-dotted-name',
    });
    const result = await compareReports(directory, baseline, candidate);
    const comparison = JSON.parse(result.stdout) as {
      readonly compatible: boolean;
      readonly portable_summary: { readonly total: number; readonly failed: number };
      readonly extension_summary: { readonly total: number; readonly failed: number };
      readonly cases: readonly { readonly id: string; readonly passed: boolean }[];
    };
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(comparisonSchema);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(validate(comparison), true, JSON.stringify(validate.errors));
    assert.equal(comparison.compatible, true);
    assert.deepEqual(comparison.portable_summary, { total: 7, passed: 7, failed: 0 });
    assert.deepEqual(comparison.extension_summary, { total: 2, passed: 1, failed: 1 });
    assert.equal(
      comparison.cases.find(item => item.id === 'compatibility.flat-dotted-name')?.passed,
      false,
    );
  }, 'pixiecore-cross-runtime-');
});

test('cross-runtime runner exits one when a portable observation differs', async () => {
  await withTempDirectory(async directory => {
    const baseline = await runInstructionTemplateConformanceSuite();
    const candidate = candidateReport(baseline, {
      implementationName: data.text('incompatible implementation', 'runtime'),
      changedCaseId: 'mustache.spaced',
    });
    const result = await compareReports(directory, baseline, candidate);
    const comparison = JSON.parse(result.stdout) as {
      readonly compatible: boolean;
      readonly portable_summary: { readonly failed: number };
    };

    assert.equal(result.status, 1, result.stderr);
    assert.equal(comparison.compatible, false);
    assert.equal(comparison.portable_summary.failed, 1);
  }, 'pixiecore-cross-runtime-');
});

test('cross-runtime runner rejects reports from one implementation or different case sets', async () => {
  await withTempDirectory(async directory => {
    const baseline = await runInstructionTemplateConformanceSuite();
    const sameImplementation = structuredClone(baseline);
    const sameResult = await compareReports(directory, baseline, sameImplementation);

    assert.equal(sameResult.status, 2);
    assert.equal(sameResult.stdout, '');
    assert.match(sameResult.stderr, /distinct implementation names/u);

    const missingCase = candidateReport(baseline, {
      implementationName: data.text('partial implementation', 'runtime'),
    });
    missingCase.cases.pop();
    const missingResult = await compareReports(directory, baseline, missingCase);

    assert.equal(missingResult.status, 2);
    assert.equal(missingResult.stdout, '');
    assert.match(missingResult.stderr, /different case counts/u);

    const mismatchedExtension = candidateReport(baseline, {
      implementationName: data.text('extension mismatch implementation', 'runtime'),
    });
    const extensionCase = mismatchedExtension.cases.find(item => !item.portable);
    assert.ok(extensionCase);
    extensionCase.extension_id = 'example.input-binding.different/v1';
    const mismatchResult = await compareReports(directory, baseline, mismatchedExtension);

    assert.equal(mismatchResult.status, 2);
    assert.equal(mismatchResult.stdout, '');
    assert.match(mismatchResult.stderr, /disagree on case contract/u);
  }, 'pixiecore-cross-runtime-');
});

function candidateReport(
  baseline: Awaited<ReturnType<typeof runInstructionTemplateConformanceSuite>>,
  options: { readonly implementationName: string; readonly changedCaseId?: string },
): MutableReport {
  const candidate = structuredClone(baseline) as unknown as MutableReport;
  candidate.implementation.name = options.implementationName;
  const changed = candidate.cases.find(item => item.id === options.changedCaseId);
  if (!changed) return candidate;
  changed.passed = false;
  if (changed.kind === 'render') changed.observed.rendered_instruction = 'different';
  else changed.observed.accepted = !changed.observed.accepted;
  candidate.summary.failed++;
  candidate.summary.passed--;
  const scope = changed.portable ? candidate.portable_summary : candidate.extension_summary;
  scope.failed++;
  scope.passed--;
  candidate.conformant = candidate.portable_summary.failed === 0;
  return candidate;
}

async function compareReports(
  directory: string,
  baseline: unknown,
  candidate: unknown,
): Promise<ProcessResult> {
  const baselinePath = join(directory, 'baseline.json');
  const candidatePath = join(directory, 'candidate.json');
  await Promise.all([
    writeFile(baselinePath, JSON.stringify(baseline)),
    writeFile(candidatePath, JSON.stringify(candidate)),
  ]);
  const result = spawnSync(process.execPath, [
    runnerPath,
    '--baseline',
    baselinePath,
    '--candidate',
    candidatePath,
  ], { encoding: 'utf8' });
  return {
    status: result.status,
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  };
}

async function readJson(url: URL): Promise<object> {
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(url, 'utf8')) as object;
}

interface MutableSummary {
  total: number;
  passed: number;
  failed: number;
}

interface MutableRenderCase {
  id: string;
  kind: 'render';
  portable: boolean;
  extension_id?: string;
  passed: boolean;
  observed: { rendered_instruction: string };
}

interface MutableValidationCase {
  id: string;
  kind: 'validation';
  portable: boolean;
  extension_id?: string;
  passed: boolean;
  observed: { accepted: boolean };
}

interface MutableReport {
  implementation: { name: string; version: string };
  summary: MutableSummary;
  portable_summary: MutableSummary;
  extension_summary: MutableSummary;
  cases: Array<MutableRenderCase | MutableValidationCase>;
  conformant: boolean;
}

interface ProcessResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}
