import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnthropicProviderFactory } from '../../anthropic.js';
import { createLoggingService } from '../../../../../logging/logging.js';
import { createMultimodalService } from '../../../../../multimodal/multimodal.js';

test('Anthropic child plugin owns the anthropic provider factory', () => {
  const factory = createAnthropicProviderFactory({}, {
    logging: createLoggingService(),
    multimodal: createMultimodalService(),
  });
  assert.equal(factory.name, 'anthropic');
});
