/**
 * Implements router behavior for the api plugin.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { elapsedMilliseconds } from '../../../core/component/diagnostics/index.js';
import {
  ApiError,
  ignoreApiLoggerFailure,
  logApiError,
  mapApiError,
} from './errors.js';
import {
  readJson,
  requestPath,
  sendEmpty,
  sendError,
  sendHtml,
  sendJson,
  setCors,
} from './http.js';
import { OPENAPI_DOCUMENT, redocHtml, swaggerHtml } from './openapi.js';
import { parseExecuteRequest } from './schema.js';
import type { ApiRequestContext, ExecuteRequest } from './types.js';
import { ApiUploadSession } from './uploads.js';

/**
 * Handles request for the owning PixieCore boundary.
 */
export async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: ApiRequestContext,
): Promise<void> {
  const started = performance.now();
  const method = request.method ?? 'GET';
  const path = requestPath(request.url);
  logRequest(response, context, started, method, path);
  setCors(request, response, context.corsOrigins);
  try {
    if (method === 'OPTIONS') {
      sendEmpty(response, 204);
      return;
    }
    if (method === 'GET' && path === '/health') {
      sendJson(response, 200, { status: 'ok' });
      return;
    }
    if (method === 'GET' && path === '/openapi.json') {
      sendJson(response, 200, OPENAPI_DOCUMENT);
      return;
    }
    if (method === 'GET' && path === '/docs') {
      sendHtml(response, 200, swaggerHtml());
      return;
    }
    if (method === 'GET' && path === '/redoc') {
      sendHtml(response, 200, redocHtml());
      return;
    }
    if (method === 'POST' && path === '/execute') {
      await handleExecute(request, response, context, started);
      return;
    }
    sendError(response, new ApiError('not_found', 'Not found', 404));
  } catch (error) {
    const mapped = mapApiError(error);
    logApiError(context.apiLogger, mapped, error);
    sendError(response, mapped);
  }
}

function logRequest(
  response: ServerResponse,
  context: ApiRequestContext,
  started: number,
  method: string,
  path: string,
): void {
  ignoreApiLoggerFailure(() => {
    context.apiLogger.info(`${method} ${path}`, {
      request_id: response.getHeader('x-request-id'),
    });
  });
  response.once('finish', () => {
    ignoreApiLoggerFailure(() => {
      context.apiLogger.info(`status=${response.statusCode} duration_ms=${elapsedMilliseconds(started)}`, {
        method,
        path,
        status: response.statusCode,
        duration_ms: elapsedMilliseconds(started),
        request_id: response.getHeader('x-request-id'),
      });
    });
  });
}

async function handleExecute(
  request: IncomingMessage,
  response: ServerResponse,
  context: ApiRequestContext,
  started: number,
): Promise<void> {
  const body = parseExecuteRequest(await readJson(request, context.maxRequestSize));
  rejectRemoteFileInputs(body);
  rejectRemoteAuthorizationInputs(body);
  enforceRemoteMessagePolicy(body, context);
  const caller = await resolveCaller(request, context);
  const uploads = new ApiUploadSession(body.files, context.maxFileSize, context.tempRoot);
  const abort = new AbortController();
  request.once('aborted', () => abort.abort());
  let data: Record<string, unknown>;
  try {
    const inputs = {
      ...(body.inputs ?? {}),
      ...(await uploads.materialize()),
      ...(caller?.role ? { user_role: caller.role } : {}),
      ...(caller?.userId ? { user_id: caller.userId } : {}),
      ...(caller?.scopes ? { user_scopes: [...caller.scopes] } : {}),
    };
    data = await context.runtime.executeYaml(body.blueprint, inputs, {
      ...(body.messages ? { messages: body.messages } : {}),
      signal: abort.signal,
    });
  } finally {
    try {
      await uploads.close();
    } catch (error) {
      ignoreApiLoggerFailure(() => {
        context.apiLogger.error('Failed to remove API temporary directory', { error });
      });
    }
  }
  sendJson(response, 200, {
    status: 'success',
    data,
    metadata: {
      provider: context.runtime.providerName,
      model: context.runtime.model,
      duration_ms: elapsedMilliseconds(started),
    },
  });
}

async function resolveCaller(
  request: IncomingMessage,
  context: ApiRequestContext,
): Promise<Awaited<ReturnType<NonNullable<ApiRequestContext['callerResolver']>>>> {
  if (!context.callerResolver) return undefined;
  try {
    return await context.callerResolver(request);
  } catch (error) {
    ignoreApiLoggerFailure(() => {
      context.apiLogger.warning('API caller authentication failed', { error });
    });
    throw new ApiError('unauthorized', 'Invalid credential', 401);
  }
}

function enforceRemoteMessagePolicy(
  body: ExecuteRequest,
  context: ApiRequestContext,
): void {
  const denied = body.messages?.find(message => !context.remoteMessageRoles.has(message.role));
  if (!denied) return;
  throw new ApiError(
    'validation_error',
    `Remote message role is not allowed: ${denied.role}`,
    400,
  );
}

function rejectRemoteFileInputs(body: ExecuteRequest): void {
  for (const key of ['file_path', 'image_path'] as const) {
    if (key in (body.inputs ?? {})) {
      throw new ApiError('validation_error', `${key} is not allowed in inputs; use files`, 400);
    }
  }
}

function rejectRemoteAuthorizationInputs(body: ExecuteRequest): void {
  for (const key of ['user_role', 'user_id', 'user_scopes'] as const) {
    if (key in (body.inputs ?? {})) {
      throw new ApiError(
        'validation_error',
        `${key} is server-controlled and is not allowed in remote inputs`,
        400,
      );
    }
  }
}
