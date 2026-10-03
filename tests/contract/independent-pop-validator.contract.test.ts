import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Ajv2020 } from 'ajv/dist/2020.js';

const execFileAsync = promisify(execFile);
const validatorPath = fileURLToPath(new URL(
  '../../conformance/validators/python/pop_validator.py',
  import.meta.url,
));
const reportSchema = JSON.parse(await readFile(
  new URL('../../schemas/pop.conformance-report-0.1.schema.json', import.meta.url),
  'utf8',
)) as object;
const validateReport = new Ajv2020({ allErrors: true, strict: true }).compile(reportSchema);

test('independent Python validator passes the canonical POP Core 0.1 suite', async t => {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('python3', [validatorPath], {
      cwd: tmpdir(),
      encoding: 'utf8',
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      t.skip('python3 is unavailable; CI runs the independent validator as a required gate');
      return;
    }
    throw error;
  }

  const report = JSON.parse(stdout) as Record<string, unknown>;
  assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors, null, 2));
  assert.deepEqual(report.implementation, {
    name: 'Independent Python validator',
    version: '0.1.0',
  });
  assert.deepEqual(report.summary, { total: 21, passed: 21, failed: 0 });
  assert.equal(report.conformant, true);
  assert.doesNotMatch(stdout, /2026-02-04|4 February|generated_output/u);
});

test('independent validator has no runtime or third-party package dependency', async () => {
  const source = await readFile(validatorPath, 'utf8');
  assert.doesNotMatch(source, /pixiecore|node_modules|subprocess|site-packages|pip install/iu);
  assert.match(source, /from pathlib import Path/u);
  assert.match(source, /import json/u);
});
