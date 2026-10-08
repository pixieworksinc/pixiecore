import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import {
  POP_CONFORMANCE_REPORT_SCHEMA,
  POP_CONFORMANCE_SPECIFICATION,
  POP_CONFORMANCE_SUITE_SCHEMA,
  runPopConformanceSuite,
} from '../../src/core/kernel/conformance/index.js';

const reportSchema = JSON.parse(await readFile(
  new URL('../../schemas/pop.conformance-report-0.1.schema.json', import.meta.url),
  'utf8',
)) as object;
const validateReport = new Ajv2020({ allErrors: true, strict: true }).compile(reportSchema);
const packageVersion = (JSON.parse(await readFile(
  new URL('../../package.json', import.meta.url),
  'utf8',
)) as { version: string }).version;

test('PixieCore passes every bundled POP Core 0.1 runtime conformance fixture', async () => {
  const report = await runPopConformanceSuite();

  assert.equal(report.schema, POP_CONFORMANCE_REPORT_SCHEMA);
  assert.equal(report.suite, POP_CONFORMANCE_SUITE_SCHEMA);
  assert.equal(report.specification, POP_CONFORMANCE_SPECIFICATION);
  assert.deepEqual(report.implementation, { name: 'PixieCore', version: packageVersion });
  assert.equal(report.profile, 'runtime');
  assert.deepEqual(report.summary, { total: 21, passed: 21, failed: 0 });
  assert.equal(report.conformant, true);
  assert.equal(report.cases.every(item => item.passed), true);
  assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors, null, 2));
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.cases), true);
  assert.equal(Object.isFrozen(report.summary), true);
  assert.doesNotMatch(JSON.stringify(report), /2026-02-04|4 February|generated_output/u);
});
