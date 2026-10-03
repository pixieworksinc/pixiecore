import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenAIProviderFactory } from '../../openai.js';
import { createProviderSupport } from '../../../../providers.js';
import { createLoggingService } from '../../../../../logging/logging.js';
import { createMultimodalService } from '../../../../../multimodal/multimodal.js';

test('OpenAI child plugin owns the openai provider factory', () => {
  const factory = createOpenAIProviderFactory({}, createProviderSupport({
    logging: createLoggingService(),
    multimodal: createMultimodalService(),
  }));
  assert.equal(factory.name, 'openai');
});
