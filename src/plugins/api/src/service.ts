/**
 * Implements service behavior for the api plugin.
 */

import type {
  ApiServerCompositionPort,
  ApiServicePort,
} from '../../../core/contracts/api/index.js';
import type { LoggingServicePort } from '../../../core/contracts/logging/index.js';
import type { ApiOptions, PixieCoreApiServer } from './types.js';
import { createApiServer } from './server.js';

/** Creates an immutable server factory without constructing operational resources. */
export function createApiService(logging: LoggingServicePort): ApiServicePort {
  return Object.freeze({
    /**
     * Creates server according to the containing class contract.
     */
    createServer(
      options: ApiOptions,
      composition: ApiServerCompositionPort,
    ): PixieCoreApiServer {
      return createApiServer(options, logging, composition);
    },
  });
}
