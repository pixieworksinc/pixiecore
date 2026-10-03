import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { JitAdmissionReport, JitProgram } from '../../src/core/contracts/jit/index.js';
import type { Blueprint } from '../../src/index.js';
import { testData } from '../helpers/test-data.js';

const data = testData('jit published schemas');
const programSchema = JSON.parse(await readFile(fileURLToPath(new URL(
  '../../schemas/pixiecore.jit-program-v1.schema.json', import.meta.url,
)), 'utf8')) as object;
const reportSchema = JSON.parse(await readFile(fileURLToPath(new URL(
  '../../schemas/pixiecore.jit-admission-report-v1.schema.json', import.meta.url,
)), 'utf8')) as object;
const promotionsSchema = JSON.parse(await readFile(fileURLToPath(new URL(
  '../../schemas/pixiecore.jit-promotions-v1.schema.json', import.meta.url,
)), 'utf8')) as object;
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  formats: { 'date-time': true },
});
ajv.addSchema(programSchema);
const validateProgram = ajv.getSchema(
  'https://raw.githubusercontent.com/pixieworksinc/pixiecore/0.1.x/schemas/pixiecore.jit-program-v1.schema.json',
)!;
const validateReport = ajv.compile(reportSchema);
const validatePromotions = ajv.compile(promotionsSchema);

const blueprint: Blueprint = {
  name: data.text('schema Blueprint', 'blueprint'),
  version: '1.0.0',
  role: 'converter',
  prompt: 'Return {{ value }}.',
  input_placeholders: [{ name: 'value', type: 'number', required: true }],
  output_schema: {
    type: 'object',
    properties: { value: { type: 'number' } },
    required: ['value'],
    additionalProperties: false,
  },
};
const program: JitProgram = {
  outputs: { value: { kind: 'input', name: 'value' } },
};

function admittedReport(): JitAdmissionReport {
  const sourceDigest = `sha256:${'1'.repeat(64)}`;
  const programDigest = `sha256:${'2'.repeat(64)}`;
  return {
    schema: 'pixiecore.jit-admission-report/v1',
    seed: data.text('schema seed', 'seed'),
    measured_at: data.date('schema measurement').toISOString(),
    blueprint: { name: blueprint.name, version: blueprint.version, source_digest: sourceDigest },
    dataset: {
      name: data.text('schema dataset', 'dataset'),
      version: '1.0.0',
      digest: `sha256:${'3'.repeat(64)}`,
    },
    provider: data.text('schema provider', 'provider'),
    model: data.text('schema model', 'model'),
    program_digest: programDigest,
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
      id: data.text('schema case', 'case'),
      runs: 2,
      correct: 2,
      agreed: 2,
      program_errors: 0,
      model_errors: 0,
      divergences: [],
    }],
  };
}

test('published JIT schemas accept closed programs and evidence artifacts', () => {
  assert.equal(validateProgram(program), true, JSON.stringify(validateProgram.errors));
  const report = admittedReport();
  assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors));
});

test('published JIT schemas reject executable, extended, and contradictory artifacts', () => {
  assert.equal(validateProgram({ outputs: { value: { kind: 'eval', source: 'return 1' } } }), false);
  assert.equal(validateProgram({ outputs: { value: { kind: 'input', name: 'value', extra: true } } }), false);

  const report = admittedReport();
  assert.equal(validateReport({ ...report, refusal_reason: 'model_mismatch' }), false);
  assert.equal(validateReport({ ...report, schema: 'pixiecore.jit-admission-report/v2' }), false);
  assert.equal(validateReport({ ...report, unexpected: true }), false);

  assert.equal(validatePromotions({
    schema: 'pixiecore.jit-promotions/v1',
    note: data.text('schema note'),
    promotions: [{
      blueprint: blueprint.name,
      version: blueprint.version,
      model: data.text('promotion model'),
      source_digest: `sha256:${'4'.repeat(64)}`,
      artifact_digest: `sha256:${'5'.repeat(64)}`,
      evidence: {
        dataset_digest: `sha256:${'6'.repeat(64)}`,
        seed: data.text('promotion seed'),
        case_count: 1,
        run_count: 1,
        correct: 1,
        agreed: 1,
        measured_at: data.date('promotion measurement').toISOString(),
      },
      program,
    }],
  }), true, JSON.stringify(validatePromotions.errors));
  assert.equal(validatePromotions({ schema: 'pixiecore.jit-promotions/v1', note: 'x', promotions: [], extra: true }), false);
});
