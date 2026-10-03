import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigurationError, LLMAPIError, createProvider } from '../../../../index.js';
import type { GenerateRequest, Message, ProviderName } from '../../../../index.js';
import { withEnvironment } from '../../../../../tests/helpers/environment.js';
import { testData } from '../../../../../tests/helpers/test-data.js';

const data = testData('providers contract');

interface RecordedRequest {
  url: string;
  headers: Headers;
  body: Record<string, any>;
}

function recordingFetch(responseBody: unknown): { fetcher: typeof globalThis.fetch; calls: RecordedRequest[] } {
  const calls: RecordedRequest[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof init?.body !== 'string') assert.fail('Expected a JSON string request body');
    calls.push({
      url: input instanceof Request ? input.url : String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(init.body) as Record<string, any>,
    });
    return new Response(JSON.stringify(responseBody), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { fetcher, calls };
}

const tools = [{ name: 'lookup', description: 'Look up a value', parameters: { type: 'object' } }];
const toolMessages: Message[] = [
  { role: 'user', content: 'Look it up' },
  {
    role: 'assistant',
    content: '',
    toolCalls: [
      { id: 'call_ok', name: 'lookup', arguments: { key: 'a' }, providerMetadata: { thoughtSignature: 'signed' } },
      { id: 'call_fail', name: 'lookup', arguments: { key: 'b' } },
    ],
  },
  { role: 'tool', toolCallId: 'call_ok', name: 'lookup', content: '{"value":1}' },
  { role: 'tool', toolCallId: 'call_fail', name: 'lookup', content: 'lookup failed', isError: true },
];
const request: GenerateRequest = { messages: toolMessages, tools, toolChoice: 'required', temperature: 0.2 };

test('OpenAI-compatible providers send linked assistant calls and tool results', async () => {
  const cases: Array<{
    name: ProviderName;
    env: Record<string, string | undefined>;
    expectedUrl: string;
    authorization?: string;
    apiKey?: string;
  }> = [
    {
      name: 'openai',
      env: { OPENAI_API_KEY: 'openai-key', OPENAI_BASE_URL: 'https://openai.example/v1' },
      expectedUrl: 'https://openai.example/v1/chat/completions',
      authorization: 'Bearer openai-key',
    },
    {
      name: 'gemini_openai',
      env: { GEMINI_OPENAI_API_KEY: 'gemini-key', GEMINI_OPENAI_BASE_URL: 'https://gemini.example/v1beta/openai' },
      expectedUrl: 'https://gemini.example/v1beta/openai/chat/completions',
      authorization: 'Bearer gemini-key',
    },
    {
      name: 'azure_native',
      env: {
        AZURE_NATIVE_API_KEY: 'native-key',
        AZURE_NATIVE_ENDPOINT: 'https://native.example/openai/v1/',
        AZURE_NATIVE_DEPLOYMENT_NAME: 'native-model',
      },
      expectedUrl: 'https://native.example/openai/v1/chat/completions',
      authorization: 'Bearer native-key',
    },
    {
      name: 'azure_openai',
      env: {
        AZURE_OPENAI_API_KEY: 'azure-key',
        AZURE_OPENAI_ENDPOINT: 'https://azure.example/',
        AZURE_OPENAI_DEPLOYMENT_NAME: 'deployment-a',
        AZURE_OPENAI_API_VERSION: '2024-10-21',
      },
      expectedUrl: 'https://azure.example/openai/deployments/deployment-a/chat/completions?api-version=2024-10-21',
      apiKey: 'azure-key',
    },
  ];

  for (const item of cases) {
    await withEnvironment(item.env, async () => {
      const recorded = recordingFetch({ choices: [{ message: { content: '{"result":"ok"}' } }] });
      const provider = createProvider(item.name, { fetch: recorded.fetcher });
      await provider.generate(request);
      const call = recorded.calls[0]!;
      assert.equal(call.url, item.expectedUrl);
      assert.equal(call.headers.get('authorization'), item.authorization ?? null);
      assert.equal(call.headers.get('api-key'), item.apiKey ?? null);
      assert.equal(call.body.tool_choice, 'required');
      assert.deepEqual(call.body.messages[1].tool_calls, [
        { id: 'call_ok', type: 'function', function: { name: 'lookup', arguments: '{"key":"a"}' } },
        { id: 'call_fail', type: 'function', function: { name: 'lookup', arguments: '{"key":"b"}' } },
      ]);
      assert.deepEqual(call.body.messages.slice(2), [
        { role: 'tool', content: '{"value":1}', tool_call_id: 'call_ok' },
        { role: 'tool', content: 'lookup failed', tool_call_id: 'call_fail' },
      ]);
    });
  }
});

test('Anthropic sends one linked tool_result batch and marks individual errors', async () => {
  await withEnvironment({ ANTHROPIC_API_KEY: 'anthropic-key' }, async () => {
    const recorded = recordingFetch({
      content: [{ type: 'tool_use', id: 'next_call', name: 'lookup', input: { key: 'next' } }],
    });
    const provider = createProvider('anthropic', { fetch: recorded.fetcher });
    const response = await provider.generate(request);
    assert.deepEqual(response.toolCalls, [{ id: 'next_call', name: 'lookup', arguments: { key: 'next' } }]);
    const call = recorded.calls[0]!;
    assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(call.headers.get('x-api-key'), 'anthropic-key');
    assert.deepEqual(call.body.tool_choice, { type: 'any' });
    assert.deepEqual(call.body.messages[1].content, [
      { type: 'tool_use', id: 'call_ok', name: 'lookup', input: { key: 'a' } },
      { type: 'tool_use', id: 'call_fail', name: 'lookup', input: { key: 'b' } },
    ]);
    assert.deepEqual(call.body.messages[2], {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'call_ok', content: '{"value":1}' },
        { type: 'tool_result', tool_use_id: 'call_fail', content: 'lookup failed', is_error: true },
      ],
    });
  });
});

test('Gemini Native links functionCall and functionResponse parts with IDs', async () => {
  await withEnvironment({ GEMINI_NATIVE_API_KEY: 'gemini-key' }, async () => {
    const recorded = recordingFetch({
      candidates: [{ content: { parts: [{ functionCall: { id: 'next_call', name: 'lookup', args: { key: 'next' } }, thoughtSignature: 'next-signed' }] } }],
    });
    const provider = createProvider('gemini_native', { fetch: recorded.fetcher });
    const response = await provider.generate(request);
    assert.deepEqual(response.toolCalls, [{
      id: 'next_call', name: 'lookup', arguments: { key: 'next' }, providerMetadata: { thoughtSignature: 'next-signed' },
    }]);
    const call = recorded.calls[0]!;
    assert.match(call.url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:generateContent\?key=gemini-key$/);
    assert.deepEqual(call.body.toolConfig, { functionCallingConfig: { mode: 'ANY' } });
    assert.deepEqual(call.body.contents[1].parts, [
      { functionCall: { id: 'call_ok', name: 'lookup', args: { key: 'a' } }, thoughtSignature: 'signed' },
      { functionCall: { id: 'call_fail', name: 'lookup', args: { key: 'b' } }, },
    ]);
    assert.deepEqual(call.body.contents[2], {
      role: 'user',
      parts: [
        { functionResponse: { id: 'call_ok', name: 'lookup', response: { value: 1 } } },
        { functionResponse: { id: 'call_fail', name: 'lookup', response: { error: 'lookup failed' } } },
      ],
    });
  });
});

test('provider errors redact credentials and normalize line breaks', async () => {
  const provider = createProvider('openai', {
    environment: { OPENAI_API_KEY: 'request-secret' },
    fetch: async () => Response.json({
      error: { message: 'Authorization: Bearer response-secret\napi_key=request-secret' },
    }, { status: 401 }),
  });
  await assert.rejects(provider.generate({ messages: [{ role: 'user', content: 'Hello' }] }), error => {
    assert.ok(error instanceof LLMAPIError);
    assert.doesNotMatch(error.message, /response-secret|request-secret/);
    assert.match(error.message, /\*\*\*REDACTED\*\*\*/);
    assert.doesNotMatch(error.message, /[\r\n]/);
    return true;
  });
});

test('caller abort reaches fetch and preserves a sanitized public error with the original cause', async () => {
  const secret = data.text('caller abort secret', 'secret');
  const abortReason = new Error(`Authorization: Bearer ${secret}`);
  const controller = new AbortController();
  let reportFetchStarted = (): void => undefined;
  const fetchStarted = new Promise<void>(resolve => { reportFetchStarted = resolve; });
  let receivedSignal: AbortSignal | undefined;
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal;
    assert.ok(signal instanceof AbortSignal);
    receivedSignal = signal;
    reportFetchStarted();
    return new Promise<Response>((_resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }) as typeof globalThis.fetch;
  const provider = createProvider('openai', {
    environment: { OPENAI_API_KEY: data.text('caller abort API key', 'key') },
    fetch: fetcher,
  });

  const pending = provider.generate({
    messages: [{ role: 'user', content: data.text('caller abort prompt') }],
    signal: controller.signal,
  });
  await fetchStarted;
  assert.equal(receivedSignal?.aborted, false);
  controller.abort(abortReason);
  await assert.rejects(pending, error => {
    assert.ok(error instanceof LLMAPIError);
    assert.equal(error.cause, abortReason);
    assert.doesNotMatch(error.message, new RegExp(secret));
    assert.match(error.message, /Authorization: \*\*\*REDACTED\*\*\*/);
    return true;
  });
  assert.equal(receivedSignal?.aborted, true);
});

test('provider timeout supplies an already-aborted signal without a timing race', async () => {
  const timeoutReason = new DOMException(data.text('timeout reason'), 'TimeoutError');
  const timeoutController = new AbortController();
  timeoutController.abort(timeoutReason);
  const originalTimeout = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');
  let requestedMilliseconds: number | undefined;
  Object.defineProperty(AbortSignal, 'timeout', {
    configurable: true,
    value: (milliseconds: number): AbortSignal => {
      requestedMilliseconds = milliseconds;
      return timeoutController.signal;
    },
  });
  const requestTimeout = data.integer('provider timeout seconds', 2, 30);
  const provider = createProvider('openai', {
    environment: { OPENAI_API_KEY: data.text('timeout API key', 'key') },
    requestTimeout,
    fetch: (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      assert.ok(init?.signal instanceof AbortSignal);
      assert.equal(init.signal.aborted, true);
      throw init.signal.reason;
    }) as typeof globalThis.fetch,
  });

  try {
    await assert.rejects(
      provider.generate({ messages: [{ role: 'user', content: data.text('timeout prompt') }] }),
      error => error instanceof LLMAPIError
        && error.cause === timeoutReason
        && error.message.includes(timeoutReason.message),
    );
    assert.equal(requestedMilliseconds, requestTimeout * 1000);
  } finally {
    if (originalTimeout) Object.defineProperty(AbortSignal, 'timeout', originalTimeout);
  }
});

test('non-JSON provider error bodies are normalized and sanitized', async () => {
  const secret = data.text('non-JSON upstream secret', 'secret');
  const provider = createProvider('openai', {
    environment: { OPENAI_API_KEY: data.text('non-JSON API key', 'key') },
    fetch: async () => new Response(
      `Authorization: Bearer ${secret}\nupstream unavailable`,
      { status: 502, statusText: 'Bad Gateway' },
    ),
  });

  await assert.rejects(
    provider.generate({ messages: [{ role: 'user', content: data.text('non-JSON prompt') }] }),
    error => error instanceof LLMAPIError
      && error.code === 'llm_api_error'
      && /API call failed \(502\)/.test(error.message)
      && !error.message.includes(secret)
      && !/[\r\n]/.test(error.message),
  );
});

test('malformed successful JSON is rejected consistently by each provider protocol', async () => {
  const secret = data.text('malformed success secret', 'secret');
  const cases = [
    {
      name: 'openai' as const,
      environment: { OPENAI_API_KEY: data.text('malformed OpenAI key', 'key') },
    },
    {
      name: 'anthropic' as const,
      environment: {
        ANTHROPIC_API_KEY: data.text('malformed Anthropic key', 'key'),
        ANTHROPIC_ENABLE_FILES_API: 'false',
      },
    },
    {
      name: 'gemini_native' as const,
      environment: { GEMINI_NATIVE_API_KEY: data.text('malformed Gemini key', 'key') },
    },
  ];

  for (const fixture of cases) {
    const provider = createProvider(fixture.name, {
      environment: fixture.environment,
      fetch: async () => new Response(`not-json ${secret}`, { status: 200 }),
    });
    await assert.rejects(
      provider.generate({ messages: [{ role: 'user', content: data.text(`malformed ${fixture.name} prompt`) }] }),
      error => error instanceof LLMAPIError
        && error.code === 'llm_api_error'
        && error.message === `${fixture.name} API response was not valid JSON`
        && !error.message.includes(secret),
    );
  }
});

test('provider model lists deduplicate IDs and use documented malformed-list fallbacks', async () => {
  const duplicate = data.text('duplicate model ID', 'model');
  const cases: Array<{
    readonly name: 'openai' | 'anthropic' | 'gemini_native';
    readonly environment: NodeJS.ProcessEnv;
    readonly payload: unknown;
  }> = [
    {
      name: 'openai',
      environment: { OPENAI_API_KEY: data.text('model OpenAI key', 'key') },
      payload: { data: [{ id: duplicate }, { id: duplicate }] },
    },
    {
      name: 'anthropic',
      environment: { ANTHROPIC_API_KEY: data.text('model Anthropic key', 'key') },
      payload: { data: [{ id: duplicate }, { id: duplicate }] },
    },
    {
      name: 'gemini_native',
      environment: { GEMINI_NATIVE_API_KEY: data.text('model Gemini key', 'key') },
      payload: { models: [{ name: `models/${duplicate}` }, { name: `models/${duplicate}` }] },
    },
  ];
  for (const fixture of cases) {
    const provider = createProvider(fixture.name, {
      environment: fixture.environment,
      fetch: async () => Response.json(fixture.payload),
    });
    assert.deepEqual(await provider.getModelList(), [duplicate]);
  }

  const fallback = data.text('OpenAI model fallback', 'model');
  const provider = createProvider('openai', {
    environment: { OPENAI_API_KEY: data.text('fallback OpenAI key', 'key') },
    model: fallback,
    fetch: async () => Response.json({ data: data.text('malformed model list') }),
  });
  assert.deepEqual(await provider.getModelList(), [fallback]);
});

test('provider endpoints reject non-HTTP and credential-bearing URLs', () => {
  assert.throws(() => createProvider('openai', {
    environment: { OPENAI_API_KEY: 'key', OPENAI_BASE_URL: 'file:///private/provider' },
  }), ConfigurationError);
  assert.throws(() => createProvider('openai', {
    environment: { OPENAI_API_KEY: 'key', OPENAI_BASE_URL: 'https://user:password@example.test/v1' },
  }), ConfigurationError);
});
