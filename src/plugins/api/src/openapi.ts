/**
 * Implements openapi behavior for the api plugin.
 */

import { EXECUTE_REQUEST_SCHEMA, FILE_SCHEMA, MESSAGE_SCHEMA } from './schema.js';

/** Stable OpenAPI document and documentation pages for the API core plugin. */

const ERROR_SCHEMA = {
  type: 'object',
  required: ['status', 'error'],
  properties: {
    status: { const: 'error' },
    error: {
      type: 'object',
      required: ['type', 'message'],
      properties: { type: { type: 'string' }, message: { type: 'string' } },
    },
  },
} as const;

export const OPENAPI_DOCUMENT = {
  openapi: '3.1.0',
  info: {
    title: 'PixieCore REST API',
    version: '0.1.0',
    description: 'Execute PixieCore Blueprints over HTTP.',
  },
  paths: {
    '/health': {
      get: {
        operationId: 'health',
        summary: 'Health check',
        responses: {
          '200': {
            description: 'Server is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['status'],
                  properties: { status: { const: 'ok' } },
                },
              },
            },
          },
        },
      },
    },
    '/execute': {
      post: {
        operationId: 'executeBlueprint',
        summary: 'Execute a Blueprint',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ExecuteRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Blueprint executed successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ExecuteResponse' },
              },
            },
          },
          '400': {
            description: 'Invalid request, Blueprint, or file',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '401': {
            description: 'Caller authentication failed',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '403': {
            description: 'Authenticated or anonymous caller is not authorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '422': {
            description: 'Invalid Blueprint inputs',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '502': {
            description: 'Provider or output-schema failure',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '504': {
            description: 'Retry exhaustion',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      ExecuteRequest: EXECUTE_REQUEST_SCHEMA,
      Message: MESSAGE_SCHEMA,
      UploadedFile: FILE_SCHEMA,
      ExecuteResponse: {
        type: 'object',
        required: ['status', 'data', 'metadata'],
        properties: {
          status: { const: 'success' },
          data: { type: 'object', additionalProperties: true },
          metadata: {
            type: 'object',
            required: ['provider', 'model', 'duration_ms'],
            properties: {
              provider: { type: 'string' },
              model: { type: 'string' },
              duration_ms: { type: 'number' },
            },
          },
        },
      },
      ErrorResponse: ERROR_SCHEMA,
    },
  },
} as const;

/**
 * Handles swagger html for the owning PixieCore boundary.
 */
export function swaggerHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>PixieCore API Docs</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger-ui'});</script></body></html>`;
}

/**
 * Handles redoc html for the owning PixieCore boundary.
 */
export function redocHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>PixieCore API ReDoc</title></head><body><redoc spec-url="/openapi.json"></redoc><script src="https://cdn.jsdelivr.net/npm/redoc@2/bundles/redoc.standalone.js"></script></body></html>`;
}
