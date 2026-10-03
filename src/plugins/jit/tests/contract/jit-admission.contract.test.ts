import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Blueprint, BlueprintEvaluationDataset } from '../../../../index.js';
import { JitPromotionError } from '../../../../core/contracts/errors/index.js';
import {
  createJitPromotion,
  createJitPromotionFile,
  readJitPromotionFile,
  runJitAdmission,
  validateJitProgram,
  writeJitPromotionFile,
} from '../../../../core/kernel/jit/index.js';
import { withTempDirectory } from '../../../../../tests/helpers/temp.js';

const blueprint: Blueprint = {
  name: 'Double',
  version: '1.0.0',
  role: 'converter',
  prompt: 'Double {{ value }}.',
  input_placeholders: [{ name: 'value', type: 'number', required: true }],
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
const dataset: BlueprintEvaluationDataset = {
  schema: 'pixiecore.blueprint-eval-dataset/v1',
  name: 'double-cases',
  version: '1.0.0',
  blueprint: { path: 'double.yaml', version: '1.0.0' },
  tags: ['jit'],
  cases: [
    {
      id: 'integer',
      tags: [],
      inputs: { value: 2 },
      expected_output: { value: 4 },
      comparison: { mode: 'exact' },
    },
    {
      id: 'decimal',
      tags: [],
      inputs: { value: 1.5 },
      expected_output: { value: 3 },
      comparison: { mode: 'fields', pointers: ['/value'] },
    },
  ],
};

test('admission promotes only complete repeated expectation and model agreement', async () => {
  const calls: Array<{ caseId: string; run: number; seed: string }> = [];
  const report = await runJitAdmission({
    blueprint,
    dataset,
    program,
    provider: 'fixture-provider',
    model: 'fixture-model',
    runs: 2,
    seed: 'admission-seed',
    executeModel(inputs, context) {
      calls.push({ caseId: context.caseId, run: context.run, seed: context.seed });
      return { value: Number(inputs.value) * 2 };
    },
  });

  assert.equal(report.promoted, true);
  assert.equal(report.refusal_reason, undefined);
  assert.deepEqual(report.summary, {
    case_count: 2,
    run_count: 4,
    correct: 4,
    agreed: 4,
    program_errors: 0,
    model_errors: 0,
  });
  assert.deepEqual(calls, [
    { caseId: 'integer', run: 1, seed: 'admission-seed' },
    { caseId: 'integer', run: 2, seed: 'admission-seed' },
    { caseId: 'decimal', run: 1, seed: 'admission-seed' },
    { caseId: 'decimal', run: 2, seed: 'admission-seed' },
  ]);
  assert.equal(JSON.stringify(report).includes('actual_output'), false);
  assert.equal(JSON.stringify(report).includes('expected_output'), false);

  const promotion = createJitPromotion(report, blueprint, program);
  const file = createJitPromotionFile([promotion]);
  await withTempDirectory(async directory => {
    const path = join(directory, 'promotions.json');
    await writeJitPromotionFile(path, file);
    assert.deepEqual(await readJitPromotionFile(path), file);
    assert.match(await readFile(path, 'utf8'), /pixiecore\.jit-promotions\/v1/u);
  });
});

test('admission measures an immutable Blueprint and dataset snapshot', async () => {
  const mutableBlueprint = structuredClone(blueprint) as Blueprint;
  const mutableDataset = structuredClone({
    ...dataset,
    cases: [dataset.cases[0]!],
  }) as BlueprintEvaluationDataset;
  const report = await runJitAdmission({
    blueprint: mutableBlueprint,
    dataset: mutableDataset,
    program,
    provider: 'fixture-provider',
    model: 'fixture-model',
    seed: 'snapshot-seed',
    executeModel() {
      (mutableBlueprint as { name: string }).name = 'Changed after admission started';
      (mutableDataset.cases[0]!.expected_output as Record<string, unknown>).value = 999;
      return { value: 4 };
    },
  });

  assert.equal(report.promoted, true);
  assert.equal(report.blueprint.name, 'Double');
  assert.equal(report.cases[0]?.correct, 1);
});

test('admission reports value-free expectation and model divergences and refuses promotion', async () => {
  const mismatchedDataset: BlueprintEvaluationDataset = {
    ...dataset,
    cases: [{
      ...dataset.cases[0]!,
      expected_output: { value: 5 },
    }],
  };
  const report = await runJitAdmission({
    blueprint,
    dataset: mismatchedDataset,
    program,
    provider: 'fixture-provider',
    model: 'fixture-model',
    seed: 'mismatch-seed',
    executeModel: () => ({ value: 6 }),
  });

  assert.equal(report.promoted, false);
  assert.equal(report.refusal_reason, 'expectation_mismatch');
  assert.deepEqual(report.cases[0]?.divergences, [
    { against: 'expectation', pointer: '', reason: 'not_equal' },
    { against: 'model', pointer: '/value', reason: 'not_equal' },
  ]);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('"value":4'), false);
  assert.equal(serialized.includes('"value":5'), false);
  assert.equal(serialized.includes('"value":6'), false);
  assert.throws(() => createJitPromotion(report, blueprint, program), JitPromotionError);
});

test('admission reports nested array and escaped object pointers without values', async () => {
  const nestedBlueprint: Blueprint = {
    ...blueprint,
    name: 'Nested output',
    output_schema: { type: 'object', additionalProperties: true },
  };
  const nestedProgram = validateJitProgram({
    outputs: {
      keep: { kind: 'const', value: { 'a/b~': [1, 2] } },
      extraCompiled: { kind: 'const', value: 'private-compiled' },
    },
  });
  const compiled = { keep: { 'a/b~': [1, 2] }, extraCompiled: 'private-compiled' };
  const nestedDataset: BlueprintEvaluationDataset = {
    ...dataset,
    blueprint: { path: 'nested.yaml', version: '1.0.0' },
    cases: [{
      id: 'nested',
      tags: [],
      inputs: {},
      expected_output: compiled,
      comparison: { mode: 'exact' },
    }],
  };
  const report = await runJitAdmission({
    blueprint: nestedBlueprint,
    dataset: nestedDataset,
    program: nestedProgram,
    provider: 'fixture-provider',
    model: 'fixture-model',
    executeModel: () => ({
      keep: { 'a/b~': [0, 2, 3], extra: 'private-model' },
      extraModel: 'private-model',
    }),
  });

  assert.equal(report.refusal_reason, 'model_mismatch');
  assert.match(report.seed, /^[0-9a-f-]{36}$/u);
  assert.deepEqual(report.cases[0]?.divergences, [
    { against: 'model', pointer: '/extraCompiled', reason: 'missing_model' },
    { against: 'model', pointer: '/extraModel', reason: 'missing_compiled' },
    { against: 'model', pointer: '/keep/a~1b~0/0', reason: 'not_equal' },
    { against: 'model', pointer: '/keep/a~1b~0/2', reason: 'missing_compiled' },
    { against: 'model', pointer: '/keep/extra', reason: 'missing_compiled' },
  ]);
  assert.equal(JSON.stringify(report).includes('private-'), false);
});

test('admission distinguishes no cases, model errors, and schema-invalid program output', async () => {
  const empty = await runJitAdmission({
    blueprint,
    dataset: { ...dataset, cases: [] },
    program,
    provider: 'fixture-provider',
    model: 'fixture-model',
    executeModel: () => ({ value: 4 }),
  });
  assert.equal(empty.refusal_reason, 'no_cases');

  const modelError = await runJitAdmission({
    blueprint,
    dataset: { ...dataset, cases: [dataset.cases[0]!] },
    program,
    provider: 'fixture-provider',
    model: 'fixture-model',
    executeModel: () => { throw new Error('secret model output'); },
  });
  assert.equal(modelError.refusal_reason, 'model_error');
  assert.equal(JSON.stringify(modelError).includes('secret model output'), false);

  const invalidProgram = validateJitProgram({ outputs: { other: { kind: 'const', value: true } } });
  const programError = await runJitAdmission({
    blueprint,
    dataset: { ...dataset, cases: [dataset.cases[0]!] },
    program: invalidProgram,
    provider: 'fixture-provider',
    model: 'fixture-model',
    executeModel: () => ({ value: 4 }),
  });
  assert.equal(programError.refusal_reason, 'program_error');
  assert.equal(programError.summary.program_errors, 1);
});

test('admission validates identities, run bounds, callbacks, and cancellation', async () => {
  await assert.rejects(
    runJitAdmission({
      blueprint,
      dataset,
      program,
      provider: ' ',
      model: 'fixture-model',
      executeModel: () => ({ value: 4 }),
    }),
    /Provider must be a non-blank string/u,
  );
  await assert.rejects(
    runJitAdmission({
      blueprint,
      dataset,
      program,
      provider: 'fixture-provider',
      model: 'fixture-model',
      runs: 101,
      executeModel: () => ({ value: 4 }),
    }),
    /runs must be an integer/u,
  );
  await assert.rejects(
    runJitAdmission({
      blueprint,
      dataset,
      program,
      provider: 'fixture-provider',
      model: 'fixture-model',
      seed: ' ',
      executeModel: () => ({ value: 4 }),
    }),
    /Seed must be a non-blank string/u,
  );
  await assert.rejects(
    runJitAdmission({
      blueprint,
      dataset: { ...dataset, cases: [{ ...dataset.cases[0]!, id: ' ' }] },
      program,
      provider: 'fixture-provider',
      model: 'fixture-model',
      executeModel: () => ({ value: 4 }),
    }),
    /Dataset case 0 id/u,
  );
  await assert.rejects(
    runJitAdmission({
      blueprint,
      dataset: {
        ...dataset,
        cases: [{ ...dataset.cases[0]!, inputs: [] as unknown as Record<string, never> }],
      },
      program,
      provider: 'fixture-provider',
      model: 'fixture-model',
      executeModel: () => ({ value: 4 }),
    }),
    /Dataset case 0 inputs must be a JSON object/u,
  );
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await assert.rejects(
    runJitAdmission({
      blueprint,
      dataset,
      program,
      provider: 'fixture-provider',
      model: 'fixture-model',
      signal: controller.signal,
      executeModel: () => ({ value: 4 }),
    }),
    /cancelled/u,
  );
});
