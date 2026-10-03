import test from 'node:test';
import assert from 'node:assert/strict';
import { SelfEvalDecorator } from '../../self-evaluation.js';
import { SelfEvaluationError } from '../../../../core/contracts/errors/index.js';
import type { Blueprint, DecoratorContext, Provider } from '../../../../core/contracts/types/index.js';
import { testData } from '../../../../../tests/helpers/test-data.js';

const data = testData('self evaluation plugin');
const blueprint: Blueprint = {
  name: data.text('blueprint name'),
  version: '1.0',
  role: 'assistant',
  prompt: data.text('prompt'),
  output_schema: { type: 'object' },
};
const provider: Provider = {
  name: data.text('provider name'),
  model: data.text('model name'),
  supportsTools: false,
  supportsMultimodal: false,
  supportsVision: () => false,
  supportsFileInput: () => false,
  getModelList: async () => [],
  async generate() { return { content: '{}' }; },
};

function context(output: unknown): DecoratorContext {
  return { blueprint, inputs: {}, provider, attempt: 1, output };
}

test('self-evaluation plugin entry rejects reported errors and accepts empty reports', () => {
  const decorator = new SelfEvalDecorator();
  const accepted = context({ errors: [] });
  assert.equal(decorator.validate(accepted), accepted);
  assert.throws(
    () => decorator.validate(context({ errors: [data.text('reported error')] })),
    SelfEvaluationError,
  );
});
