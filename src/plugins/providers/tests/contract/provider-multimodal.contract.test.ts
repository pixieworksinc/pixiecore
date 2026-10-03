import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  MultimodalNotSupportedError,
  cleanGeminiSchema,
  createProvider,
  shouldUseAnthropicPdfTextFallback,
} from '../../../../index.js';
import type { GenerateRequest, Provider, ProviderName } from '../../../../index.js';
import { withEnvironment } from '../../../../../tests/helpers/environment.js';
import { testData } from '../../../../../tests/helpers/test-data.js';
import { withTempDirectory } from '../../../../../tests/helpers/temp.js';

const data = testData('provider multimodal contract');
const PDF_FIXTURE_BASE64 = 'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggNTMgPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiA3MiA3MjAgVGQgKFBpeGllQ29yZSBQREYgZml4dHVyZSkgVGogRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDMxMSAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjQxMwolJUVPRgo=';

interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: BodyInit | null;
  readonly json?: Record<string, any>;
}

function recordingFetch(
  handler: (call: RecordedRequest, index: number) => Response | Promise<Response>,
): { fetcher: typeof globalThis.fetch; calls: RecordedRequest[] } {
  const calls: RecordedRequest[] = [];
  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const body = init.body ?? null;
    const call: RecordedRequest = {
      url: input instanceof Request ? input.url : String(input),
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body,
      ...(typeof body === 'string' ? { json: JSON.parse(body) as Record<string, any> } : {}),
    };
    calls.push(call);
    return handler(call, calls.length - 1);
  }) as typeof globalThis.fetch;
  return { fetcher, calls };
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

const basicRequest: GenerateRequest = { messages: [{ role: 'user', content: 'Hello' }], temperature: 0.2 };

test('all six built-in providers expose capability and model-list APIs', async () => {
  const cases: Array<{
    name: ProviderName;
    env: Record<string, string | undefined>;
    model: string;
    apiModels?: unknown;
  }> = [
    { name: 'openai', env: { OPENAI_API_KEY: 'key', OPENAI_BASE_URL: 'https://openai.example/v1' }, model: 'openai-listed', apiModels: { data: [{ id: 'openai-listed' }] } },
    { name: 'anthropic', env: { ANTHROPIC_API_KEY: 'key' }, model: 'claude-listed', apiModels: { data: [{ id: 'claude-listed' }] } },
    { name: 'gemini_native', env: { GEMINI_NATIVE_API_KEY: 'key' }, model: 'gemini-listed', apiModels: { models: [{ name: 'models/gemini-listed' }] } },
    { name: 'gemini_openai', env: { GEMINI_OPENAI_API_KEY: 'key', GEMINI_OPENAI_BASE_URL: 'https://gemini.example/v1beta/openai' }, model: 'gemini-openai-listed', apiModels: { data: [{ id: 'gemini-openai-listed' }] } },
    {
      name: 'azure_openai',
      env: {
        AZURE_OPENAI_ENDPOINT: 'https://azure.example',
        AZURE_OPENAI_DEPLOYMENT_NAME: 'azure-deployment',
        AZURE_OPENAI_API_KEY: 'key',
        AZURE_OPENAI_USE_AZURE_AD: 'false',
      },
      model: 'azure-deployment',
    },
    {
      name: 'azure_native',
      env: {
        AZURE_NATIVE_ENDPOINT: 'https://native.example/openai/v1',
        AZURE_NATIVE_DEPLOYMENT_NAME: 'native-model',
        AZURE_NATIVE_API_KEY: 'key',
        AZURE_NATIVE_USE_AZURE_AD: 'false',
      },
      model: 'native-listed',
      apiModels: { data: [{ id: 'native-listed' }] },
    },
  ];

  for (const item of cases) {
    await withEnvironment(item.env, async () => {
      const recorded = recordingFetch(() => jsonResponse(item.apiModels ?? {}));
      const provider = createProvider(item.name, { fetch: recorded.fetcher });
      assert.equal(provider.supportsTools, true);
      assert.equal(provider.supportsMultimodal, true);
      assert.equal(provider.supportsVision(), true);
      assert.equal(provider.supportsFileInput(), true);
      assert.deepEqual(await provider.getModelList(), [item.model]);
      if (item.name === 'azure_openai') assert.equal(recorded.calls.length, 0);
      else assert.match(recorded.calls[0]!.url, /models/);
    });
  }
});

test('OpenAI, Anthropic, and Gemini normalize provider token usage', async () => {
  const cases: Array<{
    name: ProviderName;
    env: Record<string, string>;
    response: Record<string, unknown>;
    expected: { inputTokens: number; outputTokens: number; totalTokens: number };
  }> = [
    {
      name: 'openai',
      env: { OPENAI_API_KEY: 'key' },
      response: {
        choices: [{ message: { content: 'done' } }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      },
      expected: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
    },
    {
      name: 'anthropic',
      env: { ANTHROPIC_API_KEY: 'key', ANTHROPIC_ENABLE_FILES_API: 'false' },
      response: {
        content: [{ type: 'text', text: 'done' }],
        usage: { input_tokens: 13, output_tokens: 5 },
      },
      expected: { inputTokens: 13, outputTokens: 5, totalTokens: 18 },
    },
    {
      name: 'gemini_native',
      env: { GEMINI_NATIVE_API_KEY: 'key' },
      response: {
        candidates: [{ content: { parts: [{ text: 'done' }] } }],
        usageMetadata: {
          promptTokenCount: 17,
          candidatesTokenCount: 3,
          totalTokenCount: 20,
        },
      },
      expected: { inputTokens: 17, outputTokens: 3, totalTokens: 20 },
    },
  ];

  for (const item of cases) {
    await withEnvironment(item.env, async () => {
      const recorded = recordingFetch(() => jsonResponse(item.response));
      const provider = createProvider(item.name, { fetch: recorded.fetcher });
      const response = await provider.generate(basicRequest);
      assert.deepEqual(response.usage, item.expected, item.name);
    });
  }
});

test('Anthropic model listing falls back for malformed and failed responses', async () => {
  const model = data.text('Anthropic fallback model', 'claude');
  for (const response of [
    () => jsonResponse({ data: data.text('malformed model payload') }),
    () => { throw new Error(data.text('model list failure')); },
  ]) {
    const provider = createProvider('anthropic', {
      environment: { ANTHROPIC_API_KEY: data.text('model list API key', 'key') },
      model,
      fetch: recordingFetch(response).fetcher,
    });
    assert.deepEqual(await provider.getModelList(), [model]);
  }
});

test('OpenAI sends local and data-URL images and PDF files as real content parts', async () => {
  await withTempDirectory(async directory => {
    const imagePath = join(directory, 'image.png');
    const pdfPath = join(directory, 'report.pdf');
    await writeFile(imagePath, Buffer.from('local-image'));
    await writeFile(pdfPath, Buffer.from('%PDF-local'));

    await withEnvironment({ OPENAI_API_KEY: 'key', OPENAI_BASE_URL: 'https://openai.example/v1' }, async () => {
      const recorded = recordingFetch(call => call.url.endsWith('/models')
        ? jsonResponse({ data: [{ id: 'gpt-a' }, { id: 'gpt-b' }] })
        : jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] }));
      const provider = createProvider('openai', { fetch: recorded.fetcher });
      await provider.generate({
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Compare everything' },
            { type: 'image', source: imagePath },
            { type: 'image', source: 'data:image/jpeg;base64,ZGF0YS1pbWFnZQ==' },
            { type: 'file', source: pdfPath },
            { type: 'file', source: 'data:application/pdf;base64,JVBERi1kYXRh' },
          ],
        }],
        schema: { type: 'object' },
      });
      assert.deepEqual(await provider.getModelList(), ['gpt-a', 'gpt-b']);
      const parts = recorded.calls[0]!.json!.messages[0].content;
      assert.deepEqual(parts.map((part: any) => part.type), ['text', 'image_url', 'image_url', 'file', 'file']);
      assert.match(parts[1].image_url.url, /^data:image\/png;base64,/);
      assert.equal(parts[2].image_url.url, 'data:image/jpeg;base64,ZGF0YS1pbWFnZQ==');
      assert.equal(
        parts[3].file.file_data,
        `data:application/pdf;base64,${Buffer.from('%PDF-local').toString('base64')}`,
      );
      assert.equal(parts[3].file.filename, 'report.pdf');
      assert.equal(parts[4].file.file_data, 'data:application/pdf;base64,JVBERi1kYXRh');
      assert.equal(recorded.calls[0]!.json!.response_format.type, 'json_schema');
    });
  });
});

test('OpenAI-compatible providers reject non-PDF file content before HTTP', async () => {
  await withEnvironment({ OPENAI_API_KEY: 'key' }, async () => {
    const recorded = recordingFetch(() => jsonResponse({}));
    const provider = createProvider('openai', { fetch: recorded.fetcher });
    await assert.rejects(
      provider.generate({ messages: [{ role: 'user', content: [{ type: 'file', source: 'data:text/plain;base64,aGVsbG8=' }] }] }),
      MultimodalNotSupportedError,
    );
    assert.equal(recorded.calls.length, 0);
  });
});

test('OpenAI accepts an existing provider file ID without re-uploading it', async () => {
  await withEnvironment({ OPENAI_API_KEY: 'key' }, async () => {
    const recorded = recordingFetch(() => jsonResponse({ choices: [{ message: { content: 'done' } }] }));
    const provider = createProvider('openai', { fetch: recorded.fetcher });
    await provider.generate({ messages: [{ role: 'user', content: [
      { type: 'file', source: 'file-existing123' },
    ] }] });
    assert.deepEqual(recorded.calls[0]!.json!.messages[0].content[0], {
      type: 'file', file: { file_id: 'file-existing123' },
    });
  });
});

test('OpenAI recursively maps JSON Schema oneOf to the supported anyOf without mutation', async () => {
  await withEnvironment({ OPENAI_API_KEY: 'key' }, async () => {
    const recorded = recordingFetch(() => jsonResponse({ choices: [{ message: { content: '{}' } }] }));
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'status'],
      properties: {
        status: { const: 'ready' },
        items: {
          type: 'array',
          items: {
            oneOf: [
              { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } } },
              { type: 'null' },
            ],
          },
        },
      },
    };
    const provider = createProvider('openai', { fetch: recorded.fetcher });
    await provider.generate({ messages: [{ role: 'user', content: 'Extract' }], schema });
    const itemSchema = recorded.calls[0]!.json!
      .response_format.json_schema.schema.properties.items.items;
    const statusSchema = recorded.calls[0]!.json!
      .response_format.json_schema.schema.properties.status;
    assert.equal(itemSchema.oneOf, undefined);
    assert.deepEqual(itemSchema.anyOf, schema.properties.items.items.oneOf);
    assert.deepEqual(statusSchema, { type: 'string', const: 'ready' });
    assert.ok('oneOf' in schema.properties.items.items);
    assert.equal('type' in schema.properties.status, false);
  });
});

test('OpenAI flattens a root union of closed objects for Structured Outputs', async () => {
  await withEnvironment({ OPENAI_API_KEY: 'key' }, async () => {
    const recorded = recordingFetch(() => jsonResponse({ choices: [{ message: { content: '{}' } }] }));
    const schema = {
      $defs: {
        classified: {
          type: 'object',
          additionalProperties: false,
          required: ['status', 'level', 'candidates'],
          properties: {
            status: { const: 'classified' },
            level: { type: 'string', enum: ['A', 'B', 'C'] },
            candidates: { type: 'array', maxItems: 0, uniqueItems: true },
          },
        },
        unknown: {
          type: 'object',
          additionalProperties: false,
          required: ['status', 'level', 'candidates'],
          properties: {
            status: { const: 'unknown' },
            level: { type: 'null' },
            candidates: { type: 'array', maxItems: 0 },
          },
        },
      },
      oneOf: [
        { $ref: '#/$defs/classified' },
        { $ref: '#/$defs/unknown' },
      ],
    };
    const provider = createProvider('openai', { fetch: recorded.fetcher });
    await provider.generate({ messages: [{ role: 'user', content: 'Classify' }], schema });
    const sent = recorded.calls[0]!.json!.response_format.json_schema.schema;
    assert.equal(sent.type, 'object');
    assert.equal(sent.additionalProperties, false);
    assert.deepEqual(sent.required, ['status', 'level', 'candidates']);
    assert.equal(sent.anyOf, undefined);
    assert.deepEqual(sent.properties.status.anyOf, [
      { type: 'string', const: 'classified' },
      { type: 'string', const: 'unknown' },
    ]);
    assert.deepEqual(sent.properties.level.anyOf, [
      { type: 'string', enum: ['A', 'B', 'C'] },
      { type: 'null' },
    ]);
    assert.deepEqual(sent.properties.candidates, {
      type: 'array',
      maxItems: 0,
      items: { type: 'null' },
    });
    assert.equal('uniqueItems' in schema.$defs.classified.properties.candidates, true);
    assert.ok('oneOf' in schema);
  });
});

test('provider image validation rejects unsupported formats before HTTP', async () => {
  const cases: Array<{ name: ProviderName; env: Record<string, string> }> = [
    { name: 'openai', env: { OPENAI_API_KEY: 'key' } },
    { name: 'anthropic', env: { ANTHROPIC_API_KEY: 'key', ANTHROPIC_ENABLE_FILES_API: 'false' } },
    { name: 'gemini_native', env: { GEMINI_NATIVE_API_KEY: 'key' } },
  ];
  for (const item of cases) {
    await withEnvironment(item.env, async () => {
      const recorded = recordingFetch(() => jsonResponse({}));
      const provider = createProvider(item.name, { fetch: recorded.fetcher });
      await assert.rejects(
        provider.generate({ messages: [{ role: 'user', content: [
          { type: 'image', source: 'data:image/bmp;base64,Ym1w' },
        ] }] }),
        MultimodalNotSupportedError,
      );
      assert.equal(recorded.calls.length, 0);
    });
  }
});

test('Anthropic maps image/PDF data URLs and uses a schema tool for structured output', async () => {
  await withEnvironment({
    ANTHROPIC_API_KEY: 'key',
    ANTHROPIC_ENABLE_FILES_API: 'false',
    ANTHROPIC_MAX_OUTPUT_TOKENS: '2048',
  }, async () => {
    const recorded = recordingFetch(() => jsonResponse({
      content: [{ type: 'tool_use', id: 'structured', name: 'emit_structured_response', input: { greeting: 'hello' } }],
    }));
    const provider = createProvider('anthropic', { fetch: recorded.fetcher });
    const response = await provider.generate({
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'Analyze' },
        { type: 'image', source: 'file-image123', mediaType: 'image/jpeg' },
        { type: 'image', source: 'https://assets.example/image.png' },
        { type: 'image', source: 'data:image/png;base64,aW1hZ2U=' },
        { type: 'file', source: 'https://assets.example/report.pdf' },
        { type: 'file', source: 'data:application/pdf;base64,JVBERi0xLjQ=' },
      ] }],
      schema: { type: 'object', properties: { greeting: { type: 'string' } }, required: ['greeting'] },
    });
    assert.equal(response.content, '{"greeting":"hello"}');
    assert.equal(response.toolCalls, undefined);
    const call = recorded.calls[0]!;
    assert.equal(call.json!.max_tokens, 2048);
    assert.equal(call.headers.get('anthropic-beta'), null);
    assert.deepEqual(call.json!.tool_choice, { type: 'tool', name: 'emit_structured_response' });
    assert.equal(call.json!.tools.at(-1).name, 'emit_structured_response');
    assert.deepEqual(call.json!.messages[0].content[1], {
      type: 'image', source: { type: 'file', file_id: 'file-image123' },
    });
    assert.deepEqual(call.json!.messages[0].content[2], {
      type: 'image', source: { type: 'url', url: 'https://assets.example/image.png' },
    });
    assert.deepEqual(call.json!.messages[0].content[3], {
      type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' },
    });
    assert.deepEqual(call.json!.messages[0].content[4], {
      type: 'document', source: { type: 'url', url: 'https://assets.example/report.pdf' },
    });
    assert.deepEqual(call.json!.messages[0].content[5], {
      type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQ=' },
    });
  });
});

test('Anthropic keeps application tools selectable alongside its structured-output tool', async () => {
  await withEnvironment({ ANTHROPIC_API_KEY: 'key', ANTHROPIC_ENABLE_FILES_API: 'false' }, async () => {
    const recorded = recordingFetch(() => jsonResponse({
      content: [{ type: 'tool_use', id: 'lookup-call', name: 'lookup', input: { id: '1' } }],
    }));
    const provider = createProvider('anthropic', { fetch: recorded.fetcher });
    const response = await provider.generate({
      messages: [{ role: 'user', content: 'Look it up' }],
      schema: { type: 'object' },
      tools: [{ name: 'lookup', description: 'Lookup', parameters: { type: 'object' } }],
      toolChoice: 'auto',
    });
    assert.deepEqual(recorded.calls[0]!.json!.tool_choice, { type: 'any' });
    assert.deepEqual(response.toolCalls, [{ id: 'lookup-call', name: 'lookup', arguments: { id: '1' } }]);
  });
});

test('Anthropic Files API uploads local PDFs, references file IDs, and cleans up', async () => {
  await withTempDirectory(async directory => {
    const pdfPath = join(directory, 'report.pdf');
    await writeFile(pdfPath, Buffer.from('%PDF-file'));
    await withEnvironment({ ANTHROPIC_API_KEY: 'key', ANTHROPIC_ENABLE_FILES_API: 'true' }, async () => {
      const recorded = recordingFetch(call => {
        if (call.url === 'https://api.anthropic.com/v1/files' && call.method === 'POST') {
          return jsonResponse({ id: 'file_uploaded' });
        }
        if (call.url === 'https://api.anthropic.com/v1/messages') return jsonResponse({ content: [{ type: 'text', text: 'done' }] });
        return jsonResponse({ deleted: true });
      });
      const provider = createProvider('anthropic', { fetch: recorded.fetcher });
      await provider.generate({ messages: [{ role: 'user', content: [
        { type: 'text', text: 'Summarize' },
        { type: 'file', source: pdfPath },
      ] }] });
      const upload = recorded.calls[0]!;
      assert.ok(upload.body instanceof FormData);
      assert.equal(upload.headers.get('anthropic-beta'), 'files-api-2025-04-14');
      assert.deepEqual(recorded.calls[1]!.json!.messages[0].content[1], {
        type: 'document', source: { type: 'file', file_id: 'file_uploaded' },
      });
      assert.equal(recorded.calls[1]!.headers.get('anthropic-beta'), 'files-api-2025-04-14');
      await closeProvider(provider);
      assert.equal(recorded.calls[2]!.method, 'DELETE');
      assert.match(recorded.calls[2]!.url, /\/v1\/files\/file_uploaded$/);
    });
  });
});

test('Anthropic legacy PDF models extract text before sending the message', async () => {
  const recorded = recordingFetch(() => jsonResponse({ content: [{ type: 'text', text: 'done' }] }));
  const provider = createProvider('anthropic', {
    environment: {
      ANTHROPIC_API_KEY: data.text('legacy PDF API key', 'key'),
      ANTHROPIC_ENABLE_FILES_API: 'false',
    },
    model: 'claude-3-haiku-20240307',
    fetch: recorded.fetcher,
  });
  await provider.generate({ messages: [{ role: 'user', content: [{
    type: 'file',
    source: `data:application/pdf;base64,${PDF_FIXTURE_BASE64}`,
    filename: 'legacy.pdf',
  }] }] });
  assert.deepEqual(recorded.calls[0]!.json!.messages[0].content, [{
    type: 'text',
    text: 'Document legacy.pdf:\n\nPixieCore PDF fixture',
  }]);
});

test('Anthropic uploads local text and keeps inline text in the message body', async () => {
  await withTempDirectory(async directory => {
    const localText = data.text('local text content');
    const inlineText = data.text('inline text content');
    const textPath = join(directory, 'notes.txt');
    await writeFile(textPath, localText, 'utf8');
    const recorded = recordingFetch(call => {
      if (call.url.endsWith('/v1/files') && call.method === 'POST') {
        return jsonResponse({ id: data.text('uploaded text file id', 'file') });
      }
      return jsonResponse({ content: [{ type: 'text', text: 'done' }] });
    });
    const provider = createProvider('anthropic', {
      environment: {
        ANTHROPIC_API_KEY: data.text('text API key', 'key'),
        ANTHROPIC_ENABLE_FILES_API: 'true',
      },
      fetch: recorded.fetcher,
    });
    try {
      await provider.generate({ messages: [{ role: 'user', content: [
        { type: 'file', source: textPath },
        { type: 'file', source: `data:text/plain;base64,${Buffer.from(inlineText).toString('base64')}`, filename: 'inline.txt' },
      ] }] });
      const upload = recorded.calls[0]!;
      assert.ok(upload.body instanceof FormData);
      const uploadedFile = upload.body.get('file');
      assert.ok(uploadedFile instanceof File);
      assert.equal(uploadedFile.type, 'text/plain');
      assert.equal(await uploadedFile.text(), localText);
      assert.deepEqual(recorded.calls[1]!.json!.messages[0].content, [
        {
          type: 'document',
          source: { type: 'file', file_id: data.text('uploaded text file id', 'file') },
        },
        { type: 'text', text: `Document inline.txt:\n\n${inlineText}` },
      ]);
    } finally {
      await closeProvider(provider);
    }
  });
});

test('Anthropic rejects unsupported document MIME types before HTTP', async () => {
  const recorded = recordingFetch(() => jsonResponse({}));
  const provider = createProvider('anthropic', {
    environment: { ANTHROPIC_API_KEY: data.text('unsupported MIME API key', 'key') },
    fetch: recorded.fetcher,
  });
  await assert.rejects(
    provider.generate({ messages: [{ role: 'user', content: [{
      type: 'file',
      source: 'data:application/octet-stream;base64,AA==',
    }] }] }),
    error => error instanceof MultimodalNotSupportedError
      && /application\/octet-stream/.test(error.message),
  );
  assert.equal(recorded.calls.length, 0);
});

test('Anthropic PDF fallback detection preserves the public model contract', () => {
  assert.equal(shouldUseAnthropicPdfTextFallback('claude-3-haiku-20240307'), true);
  assert.equal(shouldUseAnthropicPdfTextFallback('claude-3-5-sonnet-latest'), false);
});

test('Gemini Native sends inline multimodal data and recursively cleans schemas', async () => {
  await withEnvironment({ GEMINI_NATIVE_API_KEY: 'key' }, async () => {
    const recorded = recordingFetch(call => call.method === 'GET'
      ? jsonResponse({ error: { message: 'unavailable' } }, { status: 500 })
      : jsonResponse({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }));
    const provider = createProvider('gemini_native', { fetch: recorded.fetcher });
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: { date: { type: 'string', format: 'date' }, nested: { type: 'array', items: { type: 'object', additionalProperties: false } } },
    };
    await provider.generate({
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'Analyze' },
        { type: 'image', source: 'data:image/png;base64,aW1hZ2U=' },
        { type: 'file', source: 'data:application/pdf;base64,JVBERi0xLjQ=' },
      ] }],
      schema,
      tools: [{ name: 'lookup', description: 'Lookup', parameters: schema }],
    });
    const body = recorded.calls[0]!.json!;
    assert.deepEqual(body.contents[0].parts.map((part: any) => Object.keys(part)[0]), ['text', 'inlineData', 'inlineData']);
    assert.equal(body.contents[0].parts[1].inlineData.mimeType, 'image/png');
    assert.equal(body.contents[0].parts[2].inlineData.mimeType, 'application/pdf');
    assert.equal(body.generationConfig.responseSchema.additionalProperties, undefined);
    assert.equal(body.generationConfig.responseSchema.properties.date.format, undefined);
    assert.equal(body.generationConfig.responseSchema.properties.nested.items.additionalProperties, undefined);
    assert.equal(body.tools[0].functionDeclarations[0].parameters.properties.date.format, undefined);
    assert.deepEqual(await provider.getModelList(), ['gemini-2.5-flash', 'gemini-1.5-pro']);
    assert.deepEqual(cleanGeminiSchema(schema), body.generationConfig.responseSchema);
  });
});

test('Gemini Native routes attachments above the inline limit through the Files API', async () => {
  await withEnvironment({ GEMINI_NATIVE_API_KEY: 'key', GEMINI_INLINE_FILE_SIZE_LIMIT: '1' }, async () => {
    const recorded = recordingFetch(call => {
      if (call.url.includes('/upload/v1beta/files')) {
        return new Response('', { status: 200, headers: { 'x-goog-upload-url': 'https://upload.example/session' } });
      }
      if (call.url === 'https://upload.example/session') {
        return jsonResponse({ file: { name: 'files/uploaded', uri: 'https://files.example/uploaded', mimeType: 'application/pdf' } });
      }
      if (call.method === 'DELETE') return jsonResponse({});
      return jsonResponse({ candidates: [{ content: { parts: [{ text: 'done' }] } }] });
    });
    const provider = createProvider('gemini_native', { fetch: recorded.fetcher });
    await provider.generate({ messages: [{ role: 'user', content: [
      { type: 'text', text: 'Read' },
      { type: 'file', source: 'data:application/pdf;base64,JVBERi0xLjQ=' },
    ] }] });
    assert.equal(recorded.calls[0]!.headers.get('x-goog-upload-command'), 'start');
    assert.ok(Buffer.isBuffer(recorded.calls[1]!.body));
    assert.deepEqual(recorded.calls[2]!.json!.contents[0].parts[1], {
      fileData: { mimeType: 'application/pdf', fileUri: 'https://files.example/uploaded' },
    });
    await closeProvider(provider);
    assert.equal(recorded.calls[3]!.method, 'DELETE');
    assert.match(recorded.calls[3]!.url, /\/v1beta\/files\/uploaded\?key=key$/);
  });
});

test('Azure OpenAI and Azure Native use injected Azure AD bearer tokens without API keys', async () => {
  const cases: Array<{ name: ProviderName; env: Record<string, string | undefined> }> = [
    {
      name: 'azure_openai',
      env: {
        AZURE_OPENAI_ENDPOINT: 'https://azure.example',
        AZURE_OPENAI_DEPLOYMENT_NAME: 'deployment',
        AZURE_OPENAI_USE_AZURE_AD: 'true',
        AZURE_OPENAI_API_KEY: undefined,
      },
    },
    {
      name: 'azure_native',
      env: {
        AZURE_NATIVE_ENDPOINT: 'https://native.example/openai/v1',
        AZURE_NATIVE_DEPLOYMENT_NAME: 'deployment',
        AZURE_NATIVE_USE_AZURE_AD: 'true',
        AZURE_NATIVE_API_KEY: undefined,
      },
    },
  ];
  for (const item of cases) {
    await withEnvironment(item.env, async () => {
      let tokenCalls = 0;
      const recorded = recordingFetch(() => jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
      const provider = createProvider(item.name, {
        fetch: recorded.fetcher,
        azureTokenProvider: () => { tokenCalls++; return 'azure-token'; },
      });
      await provider.generate(basicRequest);
      assert.equal(tokenCalls, 1);
      assert.equal(recorded.calls[0]!.headers.get('authorization'), 'Bearer azure-token');
      assert.equal(recorded.calls[0]!.headers.get('api-key'), null);
    });
  }
});

async function closeProvider(provider: Provider): Promise<void> {
  if ('close' in provider && typeof provider.close === 'function') await provider.close();
}
