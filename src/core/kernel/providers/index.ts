/**
 * Coordinates providers responsibilities inside the PixieCore kernel.
 */

import { ConfigurationError } from '../../contracts/errors/index.js';
import type { Provider, RuntimeOptions } from '../../contracts/types/index.js';
import { createLoggingService } from '../../../plugins/logging/logging.js';
import { createMultimodalService } from '../../../plugins/multimodal/multimodal.js';
import { createProviderSupport } from '../../../plugins/providers/providers.js';
import { createOpenAIProvider } from '../../../plugins/providers/plugins/openai/openai.js';
import { createAnthropicProvider } from '../../../plugins/providers/plugins/anthropic/anthropic.js';
import {
  createAzureNativeProvider,
  createAzureOpenAIProvider,
} from '../../../plugins/providers/plugins/azure/azure.js';
import {
  createGeminiNativeProvider,
  createGeminiOpenAIProvider,
} from '../../../plugins/providers/plugins/gemini/gemini.js';
import { createApisixProvider } from '../../../plugins/providers/plugins/apisix/apisix.js';

export {
  BUILT_IN_PROVIDER_NAMES,
  isBuiltInProviderName,
} from '../../../plugins/providers/providers.js';
export { shouldUseAnthropicPdfTextFallback } from '../../../plugins/providers/plugins/anthropic/anthropic.js';
export { cleanGeminiSchema } from '../../../plugins/providers/plugins/gemini/gemini.js';

/** Compatibility factory for callers outside a bootstrap-owned plugin scope. */
export function createProvider(name: string, options: RuntimeOptions = {}): Provider {
  const services = {
    logging: createLoggingService(),
    multimodal: createMultimodalService(),
  };
  const support = createProviderSupport(services);
  if (name === 'openai') return createOpenAIProvider(options, support);
  if (name === 'anthropic') return createAnthropicProvider(options, services);
  if (name === 'azure_openai') return createAzureOpenAIProvider(options, support);
  if (name === 'azure_native') return createAzureNativeProvider(options, support);
  if (name === 'gemini_native') return createGeminiNativeProvider(options, services);
  if (name === 'gemini_openai') return createGeminiOpenAIProvider(options, support);
  if (name === 'apisix') return createApisixProvider(options, support);
  throw new ConfigurationError(`Unknown built-in provider: ${name}`);
}
