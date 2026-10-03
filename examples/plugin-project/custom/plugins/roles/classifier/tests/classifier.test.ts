import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { ClassifierRole } from '../classifier.js';

test('classifier role preserves arbitrary rendered input', async () => {
  const input = createHash('sha256')
    .update(`${process.env.TEST_SEED}:classifier example`)
    .digest('hex');
  const result = await ClassifierRole.apply(input, {} as never, {});
  assert.equal(result.messages.at(-1)?.content, input);
});
