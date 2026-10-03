import assert from 'node:assert/strict';
import test from 'node:test';
import { SampleDecoratorDecorator } from '../sample-decorator.js';

test('sample decorator owns its execution stage', () => {
  assert.equal(SampleDecoratorDecorator.stage, 'after');
});
