import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGeminiNativeProviderFactory,
  createGeminiOpenAIProviderFactory,
} from '../../gemini.js';
import { createProviderSupport } from '../../../../providers.js';
import { createLoggingService } from '../../../../../logging/logging.js';
import { createMultimodalService } from '../../../../../multimodal/multimodal.js';

test('Gemini child plugin owns both Gemini provider factories', () => {
  const services = {
    logging: createLoggingService(),
    multimodal: createMultimodalService(),
  };
  assert.deepEqual([
    createGeminiNativeProviderFactory({}, services).name,
    createGeminiOpenAIProviderFactory({}, createProviderSupport(services)).name,
  ], ['gemini_native', 'gemini_openai']);
});
