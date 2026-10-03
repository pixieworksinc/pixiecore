import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import {
  BlueprintValidationError,
  ConfigurationError,
  InputTypeError,
  InputValidationError,
  LLMAPIError,
  LoggingConfig,
  MaxRetryExceededError,
  RolePermissionError,
  SchemaValidationError,
  ScopePermissionError,
  PixieCoreLogger,
  UserPermissionError,
  captureLogs,
} from '../../../../index.js';
import { createApp, type ApiRuntime } from '../../../../core/kernel/api/index.js';
import { FakeApiRuntime, apiMessages } from '../../../../../tests/helpers/fake-api-runtime.js';
import { responseJson, startApiServer, stopApiServer } from '../../../../../tests/helpers/http-server.js';
import { RecordingLoggerPort } from '../../../../../tests/helpers/recording-logger.js';
import { testData } from '../../../../../tests/helpers/test-data.js';

const data = testData('API contract');

test('HTTP health, OpenAPI, Swagger, ReDoc, not-found, request IDs, and CORS contracts', async () => {
  const runtime = new FakeApiRuntime();
  const logger = quietApiLogger();
  const capture = captureLogs(logger);
  const { server, baseUrl } = await startApiServer({
    runtime,
    apiLogger: logger,
    environment: {},
    corsOrigins: ['http://localhost:3000'],
  });
  try {
    const health = await fetch(`${baseUrl}/health?ready=1`, { headers: { origin: 'http://localhost:3000' } });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('content-type'), 'application/json');
    assert.equal(health.headers.get('access-control-allow-origin'), 'http://localhost:3000');
    assert.equal(health.headers.get('vary'), 'origin');
    assert.match(health.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/i);
    assert.deepEqual(await responseJson(health), { status: 'ok' });

    const deniedOrigin = await fetch(`${baseUrl}/health`, { headers: { origin: 'http://evil.example' } });
    assert.equal(deniedOrigin.headers.get('access-control-allow-origin'), null);

    const preflight = await fetch(`${baseUrl}/execute`, { method: 'OPTIONS', headers: { origin: 'http://localhost:3000' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET,POST,OPTIONS');

    const openapi = await fetch(`${baseUrl}/openapi.json`);
    assert.equal(openapi.status, 200);
    const specification = await responseJson(openapi);
    assert.equal(specification.openapi, '3.1.0');
    assert.ok(specification.paths['/health']);
    assert.ok(specification.paths['/execute']);
    assert.ok(specification.components.schemas.ExecuteRequest);

    const docs = await fetch(`${baseUrl}/docs`);
    assert.equal(docs.status, 200);
    assert.match(docs.headers.get('content-type') ?? '', /^text\/html/);
    assert.match(await docs.text(), /SwaggerUIBundle/);
    const redoc = await fetch(`${baseUrl}/redoc`);
    assert.equal(redoc.status, 200);
    assert.match(await redoc.text(), /<redoc spec-url="\/openapi.json">/);

    const missing = await fetch(`${baseUrl}/missing`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await responseJson(missing), { status: 'error', error: { type: 'not_found', message: 'Not found' } });
    assert.equal(runtime.calls.length, 0);

    const wildcard = await fetch(`${baseUrl}/health`, {
      headers: { origin: 'https://client.example' },
    });
    assert.equal(wildcard.headers.get('access-control-allow-origin'), null);
    assert.equal(wildcard.headers.get('vary'), null);

    const healthTrace = capture.records.find(record => record.message === 'GET /health');
    assert.equal(healthTrace?.name, 'pixiecore.api');
    assert.match(String(healthTrace?.trace_id), /^[0-9a-f-]{36}$/i);
  } finally {
    capture.close();
    await stopApiServer(server);
  }
  assert.equal(runtime.closeCount, 1);
});

test('wildcard CORS permits every origin without a Vary header', async () => {
  const runtime = new FakeApiRuntime();
  const { server, baseUrl } = await startApiServer({
    runtime,
    apiLogger: quietApiLogger(),
    environment: {},
    corsOrigins: ['*'],
  });
  try {
    const origin = `https://${data.text('wildcard origin', 'client')}.example`;
    const response = await fetch(`${baseUrl}/health`, { headers: { origin } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(response.headers.get('vary'), null);
    assert.equal(response.headers.get('access-control-allow-methods'), 'GET,POST,OPTIONS');
    assert.match(response.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/i);
    assert.deepEqual(await responseJson(response), { status: 'ok' });
  } finally {
    await stopApiServer(server);
  }
});

test('API derives and owns a concrete logger adapter from an independent logger port', async () => {
  const runtime = new FakeApiRuntime();
  const logger = new RecordingLoggerPort();
  const { server, baseUrl } = await startApiServer({ runtime, logger, environment: {} });
  try {
    assert.ok(server.apiLogger instanceof PixieCoreLogger);
    assert.equal(server.apiLogger.name, 'pixiecore.api');
    assert.deepEqual(logger.childNames, ['pixiecore.api']);

    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.ok(logger.records.some(record =>
      record.name === 'pixiecore.api' && record.message === 'GET /health'));
  } finally {
    await stopApiServer(server);
  }

  await server.closeResources();
  assert.equal(runtime.closeCount, 1);
  assert.deepEqual(logger.closedNames, ['pixiecore.api']);
});

test('POST /execute ignores client runtime overrides and forwards allowed user messages', async () => {
  const runtime = new FakeApiRuntime();
  const { server, baseUrl } = await startApiServer({ runtime, apiLogger: quietApiLogger(), environment: {} });
  try {
    const response = await fetch(`${baseUrl}/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        blueprint: 'name: Test',
        inputs: { name: 'World' },
        messages: [
          { role: 'user', content: 'Question', ignored: true },
        ],
        provider: 'untrusted-provider',
        temperature: 2,
        unknown_field: 'ignored',
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json');
    const body = await responseJson(response);
    assert.equal(body.status, 'success');
    assert.deepEqual(body.data, { greeting: 'hello' });
    assert.deepEqual(Object.keys(body.metadata).sort(), ['duration_ms', 'model', 'provider']);
    assert.equal(body.metadata.provider, 'test-provider');
    assert.equal(body.metadata.model, 'test-model');
    assert.equal(typeof body.metadata.duration_ms, 'number');
    assert.equal(runtime.calls.length, 1);
    assert.deepEqual(runtime.calls[0]?.inputs, { name: 'World' });
    assert.deepEqual(apiMessages(runtime.calls[0]!.options), [
      { role: 'user', content: 'Question' },
    ]);
  } finally { await stopApiServer(server); }
});

test('REST rejects self-asserted identity and non-user messages by default', async () => {
  const runtime = new FakeApiRuntime();
  const { server, baseUrl } = await startApiServer({
    runtime,
    apiLogger: quietApiLogger(),
    environment: {},
  });
  try {
    for (const input of [
      { user_role: data.text('untrusted role', 'role') },
      { user_id: `${data.text('untrusted user', 'user')}@example.test` },
      { user_scopes: [data.text('untrusted scope', 'scope')] },
    ]) {
      const response = await postJson(`${baseUrl}/execute`, { blueprint: 'x', inputs: input });
      assert.equal(response.status, 400);
      assert.equal((await responseJson(response)).error.type, 'validation_error');
    }
    for (const role of ['system', 'assistant'] as const) {
      const response = await postJson(`${baseUrl}/execute`, {
        blueprint: 'x',
        messages: [{ role, content: data.text(`untrusted ${role}`, 'message') }],
      });
      assert.equal(response.status, 400);
      assert.equal((await responseJson(response)).error.type, 'validation_error');
    }
    assert.equal(runtime.calls.length, 0);
  } finally { await stopApiServer(server); }
});

test('REST derives authorization inputs only from a server-side caller resolver', async () => {
  const runtime = new FakeApiRuntime();
  const role = data.text('resolved role', 'role');
  const userId = `${data.text('resolved user', 'user')}@example.test`;
  const scopes = [data.text('resolved scope one', 'scope'), data.text('resolved scope two', 'scope')];
  const token = data.text('resolver token', 'token');
  const name = data.text('resolved caller input', 'name');
  const assistantContent = data.text('allowed assistant', 'message');
  const { server, baseUrl } = await startApiServer({
    runtime,
    apiLogger: quietApiLogger(),
    environment: {},
    callerResolver(request) {
      if (request.headers.authorization !== `Bearer ${token}`) throw new Error('bad token');
      return { role, userId, scopes };
    },
    remoteMessageRoles: ['user', 'assistant'],
  });
  try {
    const unauthorized = await postJson(`${baseUrl}/execute`, { blueprint: 'x' });
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(await responseJson(unauthorized), {
      status: 'error',
      error: { type: 'unauthorized', message: 'Invalid credential' },
    });

    const response = await fetch(`${baseUrl}/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        blueprint: 'x',
        inputs: { name },
        messages: [{ role: 'assistant', content: assistantContent }],
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(runtime.calls.length, 1);
    assert.deepEqual(runtime.calls[0]?.inputs, {
      name,
      user_role: role,
      user_id: userId,
      user_scopes: scopes,
    });
    assert.deepEqual(apiMessages(runtime.calls[0]!.options), [
      { role: 'assistant', content: assistantContent },
    ]);
  } finally { await stopApiServer(server); }
});

test('REST derives Bearer authentication and caller identity from canonical environment variables', async () => {
  const runtime = new FakeApiRuntime();
  const token = data.text('environment token', 'token');
  const invalidToken = data.text('invalid token', 'token');
  const role = data.text('environment role', 'role');
  const userId = `${data.text('environment user', 'user')}@example.test`;
  const scopes = [
    data.text('environment scope one', 'scope'),
    data.text('environment scope two', 'scope'),
  ];
  const { server, baseUrl } = await startApiServer({
    runtime,
    apiLogger: quietApiLogger(),
    environment: {
      PIXIECORE_API_TOKEN: token,
      PIXIECORE_API_CALLER_ROLE: role,
      PIXIECORE_API_CALLER_ID: userId,
      PIXIECORE_API_CALLER_SCOPES: scopes.join(','),
    },
  });
  try {
    for (const authorization of [undefined, `Bearer ${invalidToken}`]) {
      const response = await fetch(`${baseUrl}/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify({ blueprint: 'x' }),
      });
      assert.equal(response.status, 401);
    }
    const response = await fetch(`${baseUrl}/execute`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ blueprint: 'x' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(runtime.calls[0]?.inputs, {
      user_role: role,
      user_id: userId,
      user_scopes: scopes,
    });
  } finally { await stopApiServer(server); }
});

test('request-schema violations and remote path inputs return validation_error without executing', async () => {
  const runtime = new FakeApiRuntime();
  const { server, baseUrl } = await startApiServer({ runtime, apiLogger: quietApiLogger(), environment: {} });
  try {
    const malformed = await fetch(`${baseUrl}/execute`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json',
    });
    assert.equal(malformed.status, 400);
    assert.equal((await responseJson(malformed)).error.type, 'validation_error');

    const invalidBodies: unknown[] = [
      {},
      { blueprint: 1 },
      { blueprint: 'x', inputs: [] },
      { blueprint: 'x', messages: [{ role: 'tool', content: 'bad' }] },
      { blueprint: 'x', messages: [{ role: 'user', content: 1 }] },
      { blueprint: 'x', files: { file_path: { filename: 'x', content: '' } } },
      { blueprint: 'x', files: { file_path: [{ filename: '', content: '' }] } },
      { blueprint: 'x', files: { attachment: [] } },
      JSON.parse('{"blueprint":"x","files":{"__proto__":[]}}'),
    ];
    for (const value of invalidBodies) {
      const response = await postJson(`${baseUrl}/execute`, value);
      assert.equal(response.status, 400);
      assert.equal((await responseJson(response)).error.type, 'validation_error');
    }
    for (const key of ['file_path', 'image_path']) {
      const response = await postJson(`${baseUrl}/execute`, { blueprint: 'x', inputs: { [key]: '/private/server/path' } });
      assert.equal(response.status, 400);
      assert.equal((await responseJson(response)).error.type, 'validation_error');
    }
    assert.equal(runtime.calls.length, 0);
  } finally { await stopApiServer(server); }
});

test('runtime errors map to exact public HTTP status and error categories', async () => {
  const runtime = new FakeApiRuntime();
  const { server, baseUrl } = await startApiServer({ runtime, apiLogger: quietApiLogger(), environment: {} });
  try {
    const cases: Array<[Error, number, string]> = [
      [new BlueprintValidationError('bad blueprint'), 400, 'blueprint_validation_error'],
      [new InputValidationError('missing input'), 422, 'input_validation_error'],
      [new InputTypeError('wrong type'), 422, 'input_type_error'],
      [new LLMAPIError('provider failed'), 502, 'llm_api_error'],
      [new MaxRetryExceededError('retry exhausted'), 504, 'max_retry_exceeded'],
      [new SchemaValidationError('bad output'), 502, 'schema_validation_error'],
      [new RolePermissionError('role denied'), 403, 'role_permission_error'],
      [new UserPermissionError('user denied'), 403, 'user_permission_error'],
      [new ScopePermissionError('scope denied'), 403, 'scope_permission_error'],
    ];
    for (const [error, status, type] of cases) {
      runtime.error = error;
      const response = await postJson(`${baseUrl}/execute`, { blueprint: 'x', inputs: {} });
      assert.equal(response.status, status);
      const body = await responseJson(response);
      assert.deepEqual(body, { status: 'error', error: { type, message: error.message } });
    }
    runtime.error = new Error('secret internal path /private/data and token abc');
    const unexpected = await postJson(`${baseUrl}/execute`, { blueprint: 'x' });
    assert.equal(unexpected.status, 500);
    assert.deepEqual(await responseJson(unexpected), {
      status: 'error', error: { type: 'internal_error', message: 'An internal error occurred' },
    });
  } finally { await stopApiServer(server); }
});

test('aggregate request limit is independent from the decoded per-file limit', async () => {
  const runtime = new FakeApiRuntime();
  const { server, baseUrl } = await startApiServer({
    runtime,
    apiLogger: quietApiLogger(),
    environment: {},
    maxFileSize: 1,
    maxRequestSize: 128,
  });
  try {
    const response = await postJson(`${baseUrl}/execute`, { blueprint: 'x'.repeat(200) });
    assert.equal(response.status, 400);
    const body = await responseJson(response);
    assert.equal(body.error.type, 'validation_error');
    assert.match(body.error.message, /Request body exceeds 128 bytes/);
  } finally { await stopApiServer(server); }
});

test('streamed request bodies cannot bypass the aggregate request limit', async () => {
  const runtime = new FakeApiRuntime();
  const { server, baseUrl } = await startApiServer({
    runtime,
    apiLogger: quietApiLogger(),
    environment: {},
    maxFileSize: 1,
    maxRequestSize: 64,
  });
  try {
    const response = await chunkedPost(baseUrl, ['{"blueprint":"', 'x'.repeat(80), '"}']);
    assert.equal(response.status, 400);
    assert.equal(response.body.error.type, 'validation_error');
    assert.match(response.body.error.message, /Request body exceeds 64 bytes/);
    assert.equal(runtime.calls.length, 0);
  } finally { await stopApiServer(server); }
});

test('content-length accepts the exact aggregate boundary and rejects one byte over it', async () => {
  const runtime = new FakeApiRuntime();
  const maxRequestSize = 64;
  const { server, baseUrl } = await startApiServer({
    runtime,
    apiLogger: quietApiLogger(),
    environment: {},
    maxFileSize: 1,
    maxRequestSize,
  });
  try {
    const boundaryBody = jsonBodyOfSize(maxRequestSize);
    const accepted = await rawPost(baseUrl, boundaryBody);
    assert.equal(accepted.status, 200);
    assert.match(accepted.requestId, /^[0-9a-f-]{36}$/i);
    assert.equal(accepted.contentType, 'application/json');
    assert.equal(accepted.body.status, 'success');

    const oversized = await rawPost(baseUrl, jsonBodyOfSize(maxRequestSize + 1));
    assert.equal(oversized.status, 400);
    assert.match(oversized.requestId, /^[0-9a-f-]{36}$/i);
    assert.equal(oversized.contentType, 'application/json');
    assert.deepEqual(oversized.body, {
      status: 'error',
      error: {
        type: 'validation_error',
        message: `Request body exceeds ${maxRequestSize} bytes`,
      },
    });
    assert.equal(runtime.calls.length, 1);
  } finally {
    await stopApiServer(server);
  }
});

test('malformed chunked JSON returns the exact validation envelope without executing', async () => {
  const runtime = new FakeApiRuntime();
  const { server, baseUrl } = await startApiServer({
    runtime,
    apiLogger: quietApiLogger(),
    environment: {},
  });
  try {
    const response = await chunkedPost(baseUrl, ['{"blueprint":', 'not-json', '}']);
    assert.equal(response.status, 400);
    assert.match(response.requestId, /^[0-9a-f-]{36}$/i);
    assert.equal(response.contentType, 'application/json');
    assert.deepEqual(response.body, {
      status: 'error',
      error: { type: 'validation_error', message: 'Malformed JSON request body' },
    });
    assert.equal(runtime.calls.length, 0);
  } finally {
    await stopApiServer(server);
  }
});

test('synchronous and asynchronous runtime failures use the same sanitized envelope', async t => {
  for (const mode of ['synchronous', 'asynchronous'] as const) {
    await t.test(mode, async () => {
      const secret = data.text(`${mode} runtime secret`, 'secret');
      let closeCount = 0;
      const runtime: ApiRuntime = {
        providerName: data.text(`${mode} provider`, 'provider'),
        model: data.text(`${mode} model`, 'model'),
        executeYaml(): Promise<Record<string, unknown>> {
          const error = new Error(`private ${secret}`);
          if (mode === 'synchronous') throw error;
          return Promise.reject(error);
        },
        close(): void { closeCount++; },
      };
      const { server, baseUrl } = await startApiServer({
        runtime,
        apiLogger: quietApiLogger(),
        environment: {},
      });
      try {
        const response = await postJson(`${baseUrl}/execute`, { blueprint: 'x' });
        assert.equal(response.status, 500);
        assert.match(response.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/i);
        assert.deepEqual(await responseJson(response), {
          status: 'error',
          error: { type: 'internal_error', message: 'An internal error occurred' },
        });
      } finally {
        await stopApiServer(server);
      }
      assert.equal(closeCount, 1);
    });
  }
});

test('logger write failures cannot change success or error responses', async () => {
  const runtime = new FakeApiRuntime();
  const logger = quietApiLogger();
  const loggingFailure = new Error(data.text('logger failure', 'logging'));
  const unsubscribe = logger.subscribe(() => { throw loggingFailure; });
  const { server, baseUrl } = await startApiServer({
    runtime,
    apiLogger: logger,
    environment: {},
  });
  try {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await responseJson(health), { status: 'ok' });

    runtime.error = new Error(data.text('runtime private error', 'private'));
    const failure = await postJson(`${baseUrl}/execute`, { blueprint: 'x' });
    assert.equal(failure.status, 500);
    assert.deepEqual(await responseJson(failure), {
      status: 'error',
      error: { type: 'internal_error', message: 'An internal error occurred' },
    });
  } finally {
    unsubscribe();
    await stopApiServer(server);
  }
});

test('invalid API size configurations fail synchronously with exact public errors', () => {
  const cases: ReadonlyArray<{
    readonly options: Parameters<typeof createApp>[0];
    readonly message: string;
  }> = [
    { options: { maxFileSize: 0 }, message: 'maxFileSize must be a positive integer' },
    { options: { maxFileSize: Number.NaN }, message: 'maxFileSize must be a positive integer' },
    { options: { maxFileSize: 1.5 }, message: 'maxFileSize must be a positive integer' },
    { options: { maxRequestSize: 0 }, message: 'maxRequestSize must be a positive integer' },
    { options: { maxRequestSize: Number.POSITIVE_INFINITY }, message: 'maxRequestSize must be a positive integer' },
    { options: { maxRequestSize: 1.5 }, message: 'maxRequestSize must be a positive integer' },
    {
      options: { maxFileSize: 10, maxRequestSize: 19 },
      message: 'maxRequestSize must accommodate one maximum-sized base64 file',
    },
  ];

  for (const item of cases) {
    const runtime = new FakeApiRuntime();
    assert.throws(
      () => createApp({
        ...item.options,
        runtime,
        apiLogger: quietApiLogger(),
        environment: {},
      }),
      error => exactConfigurationError(error, item.message),
    );
    runtime.close();
    assert.equal(runtime.closeCount, 1);
  }
});

test('environment authentication rejects blank tokens and identity without a token', () => {
  const cases = [
    {
      environment: { PIXIECORE_API_TOKEN: '   ' },
      message: 'PIXIECORE_API_TOKEN must not be empty',
    },
    {
      environment: { PIXIECORE_API_CALLER_ID: data.text('orphan caller ID', 'caller') },
      message: 'PIXIECORE_API_TOKEN is required when API caller identity variables are configured',
    },
  ] as const;

  for (const item of cases) {
    const runtime = new FakeApiRuntime();
    assert.throws(
      () => createApp({ runtime, apiLogger: quietApiLogger(), environment: item.environment }),
      error => exactConfigurationError(error, item.message),
    );
    runtime.close();
  }
});

function quietApiLogger(): PixieCoreLogger {
  return new PixieCoreLogger(new LoggingConfig({ logToConsole: false }).validate(), 'pixiecore.api');
}

function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

interface RawApiResponse {
  readonly status: number;
  readonly body: Record<string, any>;
  readonly requestId: string;
  readonly contentType: string;
}

function chunkedPost(baseUrl: string, chunks: readonly string[]): Promise<RawApiResponse> {
  const url = new URL('/execute', baseUrl);
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
    }, response => {
      const received: Buffer[] = [];
      response.on('data', chunk => received.push(Buffer.from(chunk)));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        body: JSON.parse(Buffer.concat(received).toString('utf8')) as Record<string, any>,
        requestId: String(response.headers['x-request-id'] ?? ''),
        contentType: String(response.headers['content-type'] ?? ''),
      }));
    });
    request.once('error', reject);
    for (const chunk of chunks) request.write(chunk);
    request.end();
  });
}

function rawPost(baseUrl: string, body: string): Promise<RawApiResponse> {
  const url = new URL('/execute', baseUrl);
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(body)),
      },
    }, response => {
      const received: Buffer[] = [];
      response.on('data', chunk => received.push(Buffer.from(chunk)));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        body: JSON.parse(Buffer.concat(received).toString('utf8')) as Record<string, any>,
        requestId: String(response.headers['x-request-id'] ?? ''),
        contentType: String(response.headers['content-type'] ?? ''),
      }));
    });
    request.once('error', reject);
    request.end(body);
  });
}

function jsonBodyOfSize(size: number): string {
  const prefix = '{"blueprint":"';
  const suffix = '"}';
  const padding = size - Buffer.byteLength(prefix) - Buffer.byteLength(suffix);
  assert.ok(padding >= 0);
  const body = `${prefix}${'x'.repeat(padding)}${suffix}`;
  assert.equal(Buffer.byteLength(body), size);
  return body;
}

function exactConfigurationError(error: unknown, message: string): boolean {
  assert.ok(error instanceof Error);
  assert.equal(error.constructor, ConfigurationError);
  assert.equal(error.name, 'ConfigurationError');
  assert.equal((error as ConfigurationError).code, 'configuration_error');
  assert.equal(error.message, message);
  assert.equal(error.cause, undefined);
  return true;
}
