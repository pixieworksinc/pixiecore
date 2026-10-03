import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAzureNativeProviderFactory,
  createAzureOpenAIProviderFactory,
} from '../../azure.js';
import { createProviderSupport } from '../../../../providers.js';
import { createLoggingService } from '../../../../../logging/logging.js';
import { createMultimodalService } from '../../../../../multimodal/multimodal.js';

test('Azure child plugin owns both Azure provider factories', () => {
  const support = createProviderSupport({
    logging: createLoggingService(),
    multimodal: createMultimodalService(),
  });
  assert.deepEqual([
    createAzureOpenAIProviderFactory({}, support).name,
    createAzureNativeProviderFactory({}, support).name,
  ], ['azure_openai', 'azure_native']);
});
