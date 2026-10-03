import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appendRotating, writeConsole } from '../../../../plugins/logging/src/persistence.js';
import { testData } from '../../../../../tests/helpers/test-data.js';
import { withTempDirectory } from '../../../../../tests/helpers/temp.js';

const data = testData('logging persistence');

test('rotation handles zero, one, and many backups at the exact byte boundary', async () => {
  await withTempDirectory(async directory => {
    const values = ['first', 'second', 'third', 'fourth', 'fifth']
      .map(label => data.text(`rotation ${label}`).slice(-4));
    assert.equal(new Set(values).size, values.length);

    const zero = join(directory, `${data.text('zero filename')}.log`);
    appendRotating(zero, values[0]!, 4, 0);
    assert.equal(await readFile(zero, 'utf8'), values[0]);
    appendRotating(zero, values[1]!, 4, 0);
    assert.equal(await readFile(zero, 'utf8'), values[1]);
    await assert.rejects(access(`${zero}.1`), { code: 'ENOENT' });

    const one = join(directory, `${data.text('one filename')}.log`);
    appendRotating(one, values[0]!, 4, 1);
    appendRotating(one, values[1]!, 4, 1);
    assert.equal(await readFile(one, 'utf8'), values[1]);
    assert.equal(await readFile(`${one}.1`, 'utf8'), values[0]);
    appendRotating(one, values[2]!, 4, 1);
    assert.equal(await readFile(one, 'utf8'), values[2]);
    assert.equal(await readFile(`${one}.1`, 'utf8'), values[1]);

    const many = join(directory, `${data.text('many filename')}.log`);
    for (const value of values) appendRotating(many, value, 4, 3);
    assert.equal(await readFile(many, 'utf8'), values[4]);
    assert.equal(await readFile(`${many}.1`, 'utf8'), values[3]);
    assert.equal(await readFile(`${many}.2`, 'utf8'), values[2]);
    assert.equal(await readFile(`${many}.3`, 'utf8'), values[1]);
    await assert.rejects(access(`${many}.4`), { code: 'ENOENT' });
  });
});

test('console persistence routes errors, warnings, and ordinary levels exactly', t => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const logs: string[] = [];
  t.mock.method(console, 'error', (line: string) => { errors.push(line); });
  t.mock.method(console, 'warn', (line: string) => { warnings.push(line); });
  t.mock.method(console, 'log', (line: string) => { logs.push(line); });

  const lines = {
    critical: data.text('critical console line'),
    error: data.text('error console line'),
    warning: data.text('warning console line'),
    info: data.text('info console line'),
    debug: data.text('debug console line'),
  };
  writeConsole('CRITICAL', lines.critical);
  writeConsole('ERROR', lines.error);
  writeConsole('WARNING', lines.warning);
  writeConsole('INFO', lines.info);
  writeConsole('DEBUG', lines.debug);

  assert.deepEqual(errors, [lines.critical, lines.error]);
  assert.deepEqual(warnings, [lines.warning]);
  assert.deepEqual(logs, [lines.info, lines.debug]);
});
