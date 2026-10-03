import assert from 'node:assert/strict';
import test from 'node:test';
import { SampleToolTool } from '../sample-tool.js';

test('sample tool executes offline', async () => {
  assert.deepEqual(await SampleToolTool.execute({}), { ok: true });
});
