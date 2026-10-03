/**
 * Coordinates api responsibilities inside the PixieCore kernel.
 */

import {
  activateCorePluginRoots,
  PluginManager,
  resolvePluginService,
} from '../plugin/manager.js';
import type { ApiServerCompositionPort } from '../../contracts/api/index.js';
import { API_SERVICE } from '../../contracts/plugin/services.js';
import { getLoggingConfig, getRuntimeEnvironment } from '../config/index.js';
import type { PixieCoreLogger } from '../../../plugins/logging/logging.js';
import { PromptRuntime } from '../runtime/index.js';
import {
  ApiError,
  EXECUTE_REQUEST_SCHEMA,
  OPENAPI_DOCUMENT,
  mapApiError,
} from '../../../plugins/api/api.js';
import type {
  ApiCallerIdentity as InternalApiCallerIdentity,
  ApiCallerResolver as InternalApiCallerResolver,
  ApiMessage as InternalApiMessage,
  ApiOptions as InternalApiOptions,
  ApiRuntime as InternalApiRuntime,
  ApiUploadedFile as InternalApiUploadedFile,
  ExecuteRequest as InternalExecuteRequest,
  PixieCoreApiServer as InternalPixieCoreApiServer,
} from '../../../plugins/api/api.js';

export { ApiError, EXECUTE_REQUEST_SCHEMA, OPENAPI_DOCUMENT, mapApiError };
/**
 * Defines the supported api caller identity values.
 */
export type ApiCallerIdentity = InternalApiCallerIdentity;
/**
 * Defines the supported api caller resolver values.
 */
export type ApiCallerResolver = InternalApiCallerResolver;
/**
 * Defines the supported api message values.
 */
export type ApiMessage = InternalApiMessage;
/**
 * Defines the supported api runtime values.
 */
export type ApiRuntime = InternalApiRuntime;
/**
 * Defines the supported api uploaded file values.
 */
export type ApiUploadedFile = InternalApiUploadedFile;
/**
 * Defines the supported execute request values.
 */
export type ExecuteRequest = InternalExecuteRequest;
/**
 * Configures api behavior.
 */
export type ApiOptions = InternalApiOptions<PixieCoreLogger>;
/**
 * Defines the supported type core api server values.
 */
export type PixieCoreApiServer = InternalPixieCoreApiServer<PixieCoreLogger>;

/** Public synchronous API facade backed by one plugin-manager scope. */
export function createApp(options: ApiOptions = {}): PixieCoreApiServer {
  const environment = getRuntimeEnvironment(options.environment);
  const runtime = options.runtime ?? new PromptRuntime({ ...options, environment });
  const runtimeOwnsBootstrap = runtime instanceof PromptRuntime;
  const pluginManager = runtimeOwnsBootstrap
    ? runtime.pluginManager
    : new PluginManager(options.pluginsDir, environment, options);

  activateCorePluginRoots(pluginManager, 'pixiecore.api');
  const api = resolvePluginService(pluginManager, API_SERVICE);
  const composition: ApiServerCompositionPort = {
    environment,
    runtime,
    getLoggingConfig,
    ...(runtimeOwnsBootstrap
      ? {}
      : { closeBootstrap: () => pluginManager.close() }),
  };
  return api.createServer(options, composition) as PixieCoreApiServer;
}
