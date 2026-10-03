import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { ConverterRole } from '../converter.js';

test('converter role preserves arbitrary rendered input', async () => {
  const input = createHash('sha256')
    .update(`${process.env.TEST_SEED}:converter example`)
    .digest('hex');
  const result = await ConverterRole.apply(input, {} as never, {});
  assert.equal(result.messages.at(-1)?.content, input);
});
