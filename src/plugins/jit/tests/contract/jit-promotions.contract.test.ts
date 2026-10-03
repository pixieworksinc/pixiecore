import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JitPromotionError } from '../../../../core/contracts/errors/index.js';
import type { JitAdmissionReport } from '../../../../core/contracts/jit/index.js';
import type { Blueprint } from '../../../../core/contracts/types/index.js';
import { withTempDirectory } from '../../../../../tests/helpers/temp.js';
import {
  blueprintDigest,
  createJitPromotion,
  createJitPromotionFile,
  jitProgramDigest,
  readJitPromotionFile,
  validateJitProgram,
  validateJitPromotionFile,
  writeJitPromotionFile,
} from '../../jit.js';

const blueprint: Blueprint = {
  name: 'Arithmetic',
  version: '1.0.0',
  role: 'converter',
  prompt: 'Double the input.',
  output_schema: {
    type: 'object',
    properties: { value: { type: 'number' } },
    required: ['value'],
    additionalProperties: false,
  },
};
const program = validateJitProgram({
  outputs: {
    value: {
      kind: 'arithmetic',
      op: 'multiply',
      left: { kind: 'input', name: 'value' },
      right: { kind: 'const', value: 2 },
    },
  },
});

test('promotion artifact binds validated program, Blueprint source, model, and evidence digests', async () => {
  const value = artifact();
  const validated = validateJitPromotionFile(value);

  assert.equal(validated.promotions[0]?.source_digest, blueprintDigest(blueprint));
  assert.equal(validated.promotions[0]?.artifact_digest, jitProgramDigest(program));
  assert.equal(Object.isFrozen(validated), true);
  assert.equal(Object.isFrozen(validated.promotions[0]?.program), true);

  await withTempDirectory(async directory => {
    const path = join(directory, 'promotions.json');
    await writeFile(path, `${JSON.stringify(value)}\n`, 'utf8');
    assert.deepEqual(await readJitPromotionFile(path), validated);
  });
});

test('promotion validation rejects tampering, duplicates, incomplete evidence, and executable programs', () => {
  const invalid = [
    null,
    [],
    {},
    { ...artifact(), unexpected: true },
    { ...artifact(), note: ' ' },
    { ...artifact(), promotions: {} },
    { ...artifact(), schema: 'pixiecore.jit-promotions/v2' },
    withPromotion({ artifact_digest: `sha256:${'0'.repeat(64)}` }),
    withPromotion({ source_digest: 'not-a-digest' }),
    withPromotion({ version: '1.0' }),
    withPromotion({ model: ' ' }),
    withPromotion({ evidence: null }),
    withPromotion({ evidence: { ...artifact().promotions[0]!.evidence, case_count: 0 } }),
    withPromotion({ evidence: { ...artifact().promotions[0]!.evidence, run_count: 0 } }),
    withPromotion({ evidence: { ...artifact().promotions[0]!.evidence, correct: 1 } }),
    withPromotion({ evidence: { ...artifact().promotions[0]!.evidence, correct: 3 } }),
    withPromotion({ evidence: { ...artifact().promotions[0]!.evidence, agreed: 3 } }),
    withPromotion({ evidence: { ...artifact().promotions[0]!.evidence, seed: '' } }),
    withPromotion({ evidence: { ...artifact().promotions[0]!.evidence, dataset_digest: 1 } }),
    withPromotion({ evidence: { ...artifact().promotions[0]!.evidence, measured_at: '2026-08-27' } }),
    withPromotion({ evidence: { ...artifact().promotions[0]!.evidence, measured_at: '2026-13-27T12:00:00.000Z' } }),
    { ...artifact(), promotions: [artifact().promotions[0], artifact().promotions[0]] },
    withPromotion({ program: { outputs: { value: { kind: 'eval', source: 'process.exit()' } } } }),
  ];

  for (const value of invalid) {
    assert.throws(() => validateJitPromotionFile(value), JitPromotionError);
  }
});

test('promotion creation refuses every incomplete or mismatched admission boundary', () => {
  const report = admissionReport();
  const invalid: JitAdmissionReport[] = [
    { ...report, schema: 'pixiecore.jit-admission-report/v2' as JitAdmissionReport['schema'] },
    { ...report, promoted: false, refusal_reason: 'model_mismatch' },
    { ...report, refusal_reason: 'model_mismatch' },
    { ...report, summary: { ...report.summary, case_count: 0 } },
    { ...report, summary: { ...report.summary, run_count: 0 } },
    { ...report, summary: { ...report.summary, correct: 1 } },
    { ...report, summary: { ...report.summary, agreed: 1 } },
    { ...report, summary: { ...report.summary, program_errors: 1 } },
    { ...report, summary: { ...report.summary, model_errors: 1 } },
    { ...report, blueprint: { ...report.blueprint, name: 'Other' } },
    { ...report, blueprint: { ...report.blueprint, version: '2.0.0' } },
    { ...report, blueprint: { ...report.blueprint, source_digest: `sha256:${'7'.repeat(64)}` } },
    { ...report, program_digest: `sha256:${'8'.repeat(64)}` },
    { ...report, model: ' ' },
    { ...report, dataset: { ...report.dataset, digest: 'invalid' } },
    { ...report, seed: ' ' },
    { ...report, measured_at: 'invalid' },
  ];

  for (const item of invalid) {
    assert.throws(() => createJitPromotion(item, blueprint, program), JitPromotionError);
  }
});

test('promotion file I/O normalizes missing, malformed, and failed writes', async () => {
  const file = createJitPromotionFile([createJitPromotion(admissionReport(), blueprint, program)]);
  await withTempDirectory(async directory => {
    await assert.rejects(readJitPromotionFile(join(directory, 'missing.json')), JitPromotionError);
    const malformed = join(directory, 'malformed.json');
    await writeFile(malformed, '{', 'utf8');
    await assert.rejects(readJitPromotionFile(malformed), JitPromotionError);
    await assert.rejects(writeJitPromotionFile(directory, file), JitPromotionError);
  });
});

function artifact() {
  return {
    schema: 'pixiecore.jit-promotions/v1',
    note: 'Generated evidence-bound artifact. Regenerate instead of editing.',
    promotions: [{
      blueprint: blueprint.name,
      version: blueprint.version,
      model: 'fixture-model',
      source_digest: blueprintDigest(blueprint),
      artifact_digest: jitProgramDigest(program),
      evidence: {
        dataset_digest: `sha256:${'1'.repeat(64)}`,
        seed: 'fixture-seed',
        case_count: 1,
        run_count: 2,
        correct: 2,
        agreed: 2,
        measured_at: '2026-08-27T12:00:00.000Z',
      },
      program,
    }],
  } as const;
}

function withPromotion(overrides: Record<string, unknown>) {
  const value = artifact();
  return {
    ...value,
    promotions: [{ ...value.promotions[0], ...overrides }],
  };
}

function admissionReport(): JitAdmissionReport {
  return {
    schema: 'pixiecore.jit-admission-report/v1',
    seed: 'fixture-seed',
    measured_at: '2026-08-27T12:00:00.000Z',
    blueprint: {
      name: blueprint.name,
      version: blueprint.version,
      source_digest: blueprintDigest(blueprint),
    },
    dataset: {
      name: 'fixture-dataset',
      version: '1.0.0',
      digest: `sha256:${'1'.repeat(64)}`,
    },
    provider: 'fixture-provider',
    model: 'fixture-model',
    program_digest: jitProgramDigest(program),
    promoted: true,
    summary: {
      case_count: 1,
      run_count: 2,
      correct: 2,
      agreed: 2,
      program_errors: 0,
      model_errors: 0,
    },
    cases: [{
      id: 'fixture-case',
      runs: 2,
      correct: 2,
      agreed: 2,
      program_errors: 0,
      model_errors: 0,
      divergences: [],
    }],
  };
}
