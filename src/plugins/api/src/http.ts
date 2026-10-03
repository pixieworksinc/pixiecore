/**
 * Implements http behavior for the api plugin.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError } from './errors.js';

/**
 * Reads and parses a bounded JSON request body before API dispatch.
 */
export async function readJson(request: IncomingMessage, limit: number): Promise<unknown> {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    throw requestSizeError(limit);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw requestSizeError(limit);
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new ApiError('validation_error', 'Malformed JSON request body', 400);
  }
}

/**
 * Sends error for the owning PixieCore boundary.
 */
export function sendError(response: ServerResponse, error: ApiError): void {
  sendJson(response, error.status, {
    status: 'error',
    error: { type: error.type, message: error.message },
  });
}

/**
 * Sends json for the owning PixieCore boundary.
 */
export function sendJson(response: ServerResponse, status: number, value: unknown): void {
  if (response.headersSent || response.destroyed) return;
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(value));
}

/**
 * Sends html for the owning PixieCore boundary.
 */
export function sendHtml(response: ServerResponse, status: number, value: string): void {
  if (response.headersSent || response.destroyed) return;
  response.statusCode = status;
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end(value);
}

/**
 * Sends empty for the owning PixieCore boundary.
 */
export function sendEmpty(response: ServerResponse, status: number): void {
  if (response.headersSent || response.destroyed) return;
  response.statusCode = status;
  response.end();
}

/**
 * Sets cors for the owning PixieCore boundary.
 */
export function setCors(
  request: IncomingMessage,
  response: ServerResponse,
  allowed: readonly string[],
): void {
  const origin = request.headers.origin;
  if (!origin || (!allowed.includes(origin) && !allowed.includes('*'))) return;
  response.setHeader('access-control-allow-origin', allowed.includes('*') ? '*' : origin);
  if (!allowed.includes('*')) response.setHeader('vary', 'origin');
  response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type');
}

/**
 * Requests path for the owning PixieCore boundary.
 */
export function requestPath(url: string | undefined): string {
  try {
    return new URL(url ?? '/', 'http://localhost').pathname;
  } catch {
    return '/';
  }
}

/**
 * Handles unhandled response failure for the owning PixieCore boundary.
 */
export function handleUnhandledResponseFailure(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.destroy(error instanceof Error ? error : undefined);
    return;
  }
  sendError(response, new ApiError('internal_error', 'An internal error occurred', 500));
}

function requestSizeError(limit: number): ApiError {
  return new ApiError('validation_error', `Request body exceeds ${limit} bytes`, 400);
}
