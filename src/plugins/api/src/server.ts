/**
 * Implements server behavior for the api plugin.
 */

import { createServer } from 'node:http';
import type { ApiServerCompositionPort } from '../../../core/contracts/api/index.js';
import { ConfigurationError } from '../../../core/contracts/errors/index.js';
import type { LoggerPort, LoggingServicePort } from '../../../core/contracts/logging/index.js';
import { ignoreApiLoggerFailure } from './errors.js';
import { handleUnhandledResponseFailure } from './http.js';
import { handleRequest } from './router.js';
import type { ApiOptions, ApiRequestContext, ApiRuntime, PixieCoreApiServer } from './types.js';
import { resolveEnvironmentVariable } from '../../../core/component/environment-alias/index.js';
import { createEnvironmentCallerResolver } from './auth.js';

export { ApiError, mapApiError } from './errors.js';
export { OPENAPI_DOCUMENT } from './openapi.js';
export { EXECUTE_REQUEST_SCHEMA } from './schema.js';
export type {
  ApiCallerIdentity,
  ApiCallerResolver,
  ApiMessage,
  ApiOptions,
  ApiRuntime,
  ApiUploadedFile,
  ExecuteRequest,
  PixieCoreApiServer,
} from './types.js';

const DEFAULT_MAX_FILE_SIZE = 20 * 1024 * 1024;
const MINIMUM_DEFAULT_REQUEST_SIZE = 8 * 1024 * 1024;
const REQUEST_FILE_CAPACITY = 8;
const REQUEST_JSON_OVERHEAD = 1024 * 1024;

/**
 * Creates api server after validating the supplied contract.
 */
export function createApiServer(
  options: ApiOptions = {},
  logging: LoggingServicePort,
  composition: ApiServerCompositionPort,
): PixieCoreApiServer {
  const { environment, runtime } = composition;
  const injectedLogger = options.logger ? logging.adaptLogger(options.logger) : undefined;
  const loggingConfig = injectedLogger?.config
    ?? composition.getLoggingConfig(options, environment);
  const apiLogger = options.apiLogger
    ?? injectedLogger?.child('pixiecore.api')
    ?? logging.createLogger(loggingConfig, 'pixiecore.api');
  const context = createRequestContext(options, environment, runtime, apiLogger);

  let closePromise: Promise<void> | undefined;
  const server = createServer((request, response) => {
    const requestId = logging.generateTraceId();
    response.setHeader('x-request-id', requestId);
    void logging.runWithTraceId(
      requestId,
      () => handleRequest(request, response, context),
    ).catch(error => {
      ignoreApiLoggerFailure(() => {
        apiLogger.error('Unhandled API response failure', { error });
      });
      handleUnhandledResponseFailure(response, error);
    });
  }) as PixieCoreApiServer;

  Object.defineProperties(server, {
    runtime: { value: runtime, enumerable: true },
    apiLogger: { value: apiLogger, enumerable: true },
    closeResources: {
      enumerable: false,
      value: (): Promise<void> => closePromise ??= closeResources(
        runtime,
        apiLogger,
        composition.closeBootstrap,
      ),
    },
  });
  server.once('close', () => {
    void server.closeResources().catch(error => {
      ignoreApiLoggerFailure(() => {
        apiLogger.error('API resource shutdown failed', { error });
      });
    });
  });
  return server;
}

function createRequestContext(
  options: ApiOptions,
  environment: NodeJS.ProcessEnv,
  runtime: ApiRuntime,
  apiLogger: LoggerPort,
): ApiRequestContext {
  const maxFileSizeEnvironment = resolveEnvironmentVariable(
    environment,
    'PIXIECORE_API_MAX_FILE_SIZE',
  );
  const maxFileSize = positiveInteger(
    options.maxFileSize === undefined
      ? maxFileSizeEnvironment?.name ?? 'PIXIECORE_API_MAX_FILE_SIZE'
      : 'maxFileSize',
    options.maxFileSize ?? maxFileSizeEnvironment?.value,
    DEFAULT_MAX_FILE_SIZE,
  );
  const encodedFileSize = Math.ceil(maxFileSize / 3) * 4 + 4;
  const defaultRequestSize = Math.max(
    MINIMUM_DEFAULT_REQUEST_SIZE,
    encodedFileSize * REQUEST_FILE_CAPACITY + REQUEST_JSON_OVERHEAD,
  );
  const maxRequestSizeEnvironment = resolveEnvironmentVariable(
    environment,
    'PIXIECORE_API_MAX_REQUEST_SIZE',
  );
  const maxRequestSize = positiveInteger(
    options.maxRequestSize === undefined
      ? maxRequestSizeEnvironment?.name ?? 'PIXIECORE_API_MAX_REQUEST_SIZE'
      : 'maxRequestSize',
    options.maxRequestSize ?? maxRequestSizeEnvironment?.value,
    defaultRequestSize,
  );
  if (maxRequestSize < encodedFileSize) {
    throw new ConfigurationError(
      'maxRequestSize must accommodate one maximum-sized base64 file',
    );
  }
  const corsOriginsEnvironment = resolveEnvironmentVariable(
    environment,
    'PIXIECORE_CORS_ORIGINS',
  );
  const corsOrigins = options.corsOrigins
    ? [...options.corsOrigins]
    : corsOriginsEnvironment?.value.split(',').map(origin => origin.trim()).filter(Boolean) ?? [];
  const remoteMessageRoles = new Set<'system' | 'user' | 'assistant'>(
    options.remoteMessageRoles ?? ['user'],
  );
  for (const role of remoteMessageRoles) {
    if (role !== 'system' && role !== 'user' && role !== 'assistant') {
      throw new ConfigurationError(`Unsupported remote message role: ${String(role)}`);
    }
  }
  return {
    runtime,
    apiLogger,
    maxFileSize,
    maxRequestSize,
    corsOrigins,
    ...(options.tempRoot ? { tempRoot: options.tempRoot } : {}),
    ...(options.callerResolver
      ? { callerResolver: options.callerResolver }
      : callerResolverFromEnvironment(environment)),
    remoteMessageRoles,
  };
}

function callerResolverFromEnvironment(
  environment: NodeJS.ProcessEnv,
): Pick<ApiRequestContext, 'callerResolver'> {
  const callerResolver = createEnvironmentCallerResolver(environment);
  return callerResolver ? { callerResolver } : {};
}

async function closeResources(
  runtime: ApiRuntime,
  logger: LoggerPort,
  closeBootstrap?: () => void | Promise<void>,
): Promise<void> {
  const tasks: Array<Promise<void>> = [
    Promise.resolve().then(() => runtime.close()),
    Promise.resolve().then(() => logger.close()),
  ];
  if (closeBootstrap) {
    tasks.push(Promise.resolve().then(() => closeBootstrap()));
  }
  const results = await Promise.allSettled(tasks);
  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason);
  if (errors.length) {
    throw new AggregateError(errors, 'Failed to close one or more API resources');
  }
}

function positiveInteger(
  name: string,
  value: number | string | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new ConfigurationError(`${name} must be a positive integer`);
  }
  return parsed;
}
