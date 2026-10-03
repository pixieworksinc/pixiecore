/**
 * Implements schema behavior for the api plugin.
 */

import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv/dist/ajv.js';
import { ApiError } from './errors.js';
import type { ExecuteRequest } from './types.js';

/** Public request schema and normalization owned by the API core plugin. */

export const FILE_SCHEMA = {
  type: 'object',
  required: ['filename', 'content'],
  properties: {
    filename: { type: 'string', minLength: 1, maxLength: 255 },
    content: { type: 'string' },
  },
  additionalProperties: true,
} as const;

export const FILES_SCHEMA = {
  type: 'object',
  properties: {
    file_path: { type: 'array', items: FILE_SCHEMA },
    image_path: { type: 'array', items: FILE_SCHEMA },
  },
  additionalProperties: false,
} as const;

export const MESSAGE_SCHEMA = {
  type: 'object',
  required: ['role', 'content'],
  properties: {
    role: { type: 'string', enum: ['system', 'user', 'assistant'] },
    content: { type: 'string' },
  },
  additionalProperties: true,
} as const;

export const EXECUTE_REQUEST_SCHEMA = {
  type: 'object',
  required: ['blueprint'],
  properties: {
    blueprint: { type: 'string' },
    inputs: { type: 'object', additionalProperties: true },
    messages: { type: 'array', items: MESSAGE_SCHEMA },
    files: FILES_SCHEMA,
  },
  additionalProperties: true,
} as const;

const validateExecuteRequest = new Ajv({ allErrors: true, strict: false })
  .compile(EXECUTE_REQUEST_SCHEMA) as ValidateFunction<ExecuteRequest>;

/**
 * Parses execute request for the owning PixieCore boundary.
 */
export function parseExecuteRequest(value: unknown): ExecuteRequest {
  if (!validateExecuteRequest(value)) throw validationError(validateExecuteRequest.errors);
  return normalizeExecuteRequest(value);
}

function normalizeExecuteRequest(value: ExecuteRequest): ExecuteRequest {
  return {
    blueprint: value.blueprint,
    ...(value.inputs ? { inputs: { ...value.inputs } } : {}),
    ...(value.messages ? {
      messages: value.messages.map(message => ({ role: message.role, content: message.content })),
    } : {}),
    ...(value.files ? {
      files: Object.fromEntries(
        Object.entries(value.files).map(([field, files]) => [
          field,
          files.map(file => ({ filename: file.filename, content: file.content })),
        ]),
      ),
    } : {}),
  };
}

function validationError(errors: ErrorObject[] | null | undefined): ApiError {
  const detail = (errors ?? [])
    .map(error => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
  return new ApiError(
    'validation_error',
    `Invalid request body: ${detail || 'unknown validation error'}`,
    400,
  );
}
