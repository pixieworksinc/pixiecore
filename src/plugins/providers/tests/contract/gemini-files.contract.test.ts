import assert from 'node:assert/strict';
import test from 'node:test';
import { LLMAPIError, createProvider } from '../../../../index.js';
import type { GenerateRequest, Provider } from '../../../../index.js';
import { testData } from '../../../../../tests/helpers/test-data.js';

const data = testData('Gemini Files contract');

interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: BodyInit | null;
}

test('same Gemini attachment deduplicates one in-flight upload', async () => {
  let startCalls = 0;
  let finalizeCalls = 0;
  let messageCalls = 0;
  let reportFinalizeStarted = (): void => undefined;
  const finalizeStarted = new Promise<void>(resolve => { reportFinalizeStarted = resolve; });
  let releaseFinalize = (): void => undefined;
  const finalizeGate = new Promise<void>(resolve => { releaseFinalize = resolve; });
  const uploadedName = data.text('deduplicated upload name', 'files/upload');
  const uploadedUri = `https://files.example/${data.text('deduplicated upload URI')}`;
  const { fetcher, calls } = recordingFetch(async call => {
    if (isUploadStart(call)) {
      startCalls++;
      return uploadStartResponse('https://upload.example/deduplicated');
    }
    if (call.url === 'https://upload.example/deduplicated') {
      finalizeCalls++;
      reportFinalizeStarted();
      await finalizeGate;
      return jsonResponse({ file: { name: uploadedName, uri: uploadedUri, mimeType: 'application/pdf' } });
    }
    if (call.url.includes(':generateContent')) {
      messageCalls++;
      return geminiResponse();
    }
    return jsonResponse({});
  });
  const provider = createGeminiProvider(fetcher);
  const request = fileRequest(largeDataUrl('application/pdf', 'deduplicated attachment'));

  try {
    const first = provider.generate(request);
    await finalizeStarted;
    const second = provider.generate(request);
    releaseFinalize();
    await Promise.all([first, second]);
    assert.equal(startCalls, 1);
    assert.equal(finalizeCalls, 1);
    assert.equal(messageCalls, 2);
    assert.equal(calls.filter(isUploadStart).length, 1);
  } finally {
    await closeProvider(provider);
  }
});

test('different Gemini attachment media and sources upload separately with MIME fallback', async () => {
  let uploadIndex = 0;
  const sessions = new Map<string, { name: string; uri: string }>();
  const { fetcher, calls } = recordingFetch(call => {
    if (isUploadStart(call)) {
      uploadIndex++;
      const session = `https://upload.example/distinct-${uploadIndex}`;
      sessions.set(session, {
        name: `files/${data.text(`distinct name ${uploadIndex}`)}`,
        uri: `https://files.example/${data.text(`distinct URI ${uploadIndex}`)}`,
      });
      return uploadStartResponse(session);
    }
    const uploaded = sessions.get(call.url);
    if (uploaded) return jsonResponse({ file: uploaded });
    if (call.url.includes(':generateContent')) return geminiResponse();
    return jsonResponse({});
  });
  const provider = createGeminiProvider(fetcher);
  try {
    await provider.generate({ messages: [{ role: 'user', content: [
      { type: 'file', source: largeDataUrl('application/pdf', 'distinct PDF') },
      { type: 'file', source: largeDataUrl('text/plain', 'distinct text') },
    ] }] });
    const starts = calls.filter(isUploadStart);
    assert.equal(starts.length, 2);
    assert.deepEqual(starts.map(call => call.headers.get('x-goog-upload-header-content-type')), [
      'application/pdf',
      'text/plain',
    ]);
    for (const call of starts) {
      assert.equal(call.headers.get('content-type'), 'application/json');
      assert.equal(call.headers.get('x-goog-upload-protocol'), 'resumable');
      assert.equal(call.headers.get('x-goog-upload-command'), 'start');
      assert.match(call.headers.get('x-goog-upload-header-content-length') ?? '', /^\d+$/);
    }
    const finalizations = calls.filter(call => sessions.has(call.url));
    assert.equal(finalizations.length, 2);
    for (const call of finalizations) {
      assert.equal(call.headers.get('x-goog-upload-offset'), '0');
      assert.equal(call.headers.get('x-goog-upload-command'), 'upload, finalize');
      assert.ok(Buffer.isBuffer(call.body));
      assert.equal(call.headers.get('content-length'), String((call.body as Buffer).byteLength));
    }
    const message = calls.find(call => call.url.includes(':generateContent'))!;
    const parts = JSON.parse(String(message.body)).contents[0].parts;
    assert.deepEqual(parts.map((part: any) => part.fileData.mimeType), [
      'application/pdf',
      'text/plain',
    ]);
    assert.deepEqual(parts.map((part: any) => part.fileData.fileUri), [
      sessions.get('https://upload.example/distinct-1')?.uri,
      sessions.get('https://upload.example/distinct-2')?.uri,
    ]);
  } finally {
    await closeProvider(provider);
  }
});

test('Gemini upload without a session URL fails before sending bytes and is retryable', async () => {
  let attempts = 0;
  const session = 'https://upload.example/retry';
  const { fetcher, calls } = recordingFetch(call => {
    if (isUploadStart(call)) {
      attempts++;
      return attempts === 1 ? new Response('') : uploadStartResponse(session);
    }
    if (call.url === session) {
      return jsonResponse({ file: {
        name: `files/${data.text('retry upload name')}`,
        uri: `https://files.example/${data.text('retry upload URI')}`,
      } });
    }
    if (call.url.includes(':generateContent')) return geminiResponse();
    return jsonResponse({});
  });
  const provider = createGeminiProvider(fetcher);
  const request = fileRequest(largeDataUrl('application/pdf', 'retry attachment'));
  try {
    await assert.rejects(
      provider.generate(request),
      error => error instanceof LLMAPIError
        && error.message === 'gemini_native Files API did not return an upload URL',
    );
    assert.equal(calls.filter(call => call.url === session).length, 0);
    await provider.generate(request);
    assert.equal(attempts, 2);
    assert.equal(calls.filter(call => call.url === session).length, 1);
  } finally {
    await closeProvider(provider);
  }
});

test('Gemini upload without a file URI is evicted and retryable', async () => {
  let finalizations = 0;
  const session = 'https://upload.example/missing-uri';
  const { fetcher, calls } = recordingFetch(call => {
    if (isUploadStart(call)) return uploadStartResponse(session);
    if (call.url === session) {
      finalizations++;
      return jsonResponse(finalizations === 1
        ? { file: { name: `files/${data.text('missing URI name')}` } }
        : { file: {
            name: `files/${data.text('recovered URI name')}`,
            uri: `https://files.example/${data.text('recovered URI')}`,
          } });
    }
    if (call.url.includes(':generateContent')) return geminiResponse();
    return jsonResponse({});
  });
  const provider = createGeminiProvider(fetcher);
  const request = fileRequest(largeDataUrl('application/pdf', 'missing URI attachment'));
  try {
    await assert.rejects(
      provider.generate(request),
      error => error instanceof LLMAPIError
        && error.message === 'gemini_native Files API response did not include a file URI',
    );
    await provider.generate(request);
    assert.equal(finalizations, 2);
    assert.equal(calls.filter(isUploadStart).length, 2);
  } finally {
    await closeProvider(provider);
  }
});

test('Gemini close best-effort deletes every named upload once after one delete fails', async () => {
  let uploadIndex = 0;
  const sessions = new Map<string, string>();
  const deleteCalls: string[] = [];
  const { fetcher, calls } = recordingFetch(call => {
    if (isUploadStart(call)) {
      uploadIndex++;
      const session = `https://upload.example/cleanup-${uploadIndex}`;
      sessions.set(session, `files/${data.text(`cleanup name ${uploadIndex}`)}`);
      return uploadStartResponse(session);
    }
    const name = sessions.get(call.url);
    if (name) return jsonResponse({ file: {
      name,
      uri: `https://files.example/${data.text(`cleanup URI ${uploadIndex}`)}`,
      mimeType: 'application/pdf',
    } });
    if (call.method === 'DELETE') {
      deleteCalls.push(call.url);
      if (deleteCalls.length === 1) throw new Error(data.text('delete failure'));
      return jsonResponse({});
    }
    if (call.url.includes(':generateContent')) return geminiResponse();
    return jsonResponse({});
  });
  const provider = createGeminiProvider(fetcher);
  await provider.generate(fileRequest(largeDataUrl('application/pdf', 'first cleanup attachment')));
  await provider.generate(fileRequest(largeDataUrl('application/pdf', 'second cleanup attachment')));

  await closeProvider(provider);
  await closeProvider(provider);
  assert.equal(deleteCalls.length, 2);
  for (const name of sessions.values()) {
    assert.ok(deleteCalls.some(url => new URL(url).pathname.endsWith(`/v1beta/${name}`)));
  }
  assert.equal(calls.filter(call => call.method === 'DELETE').length, 2);
});

function createGeminiProvider(fetcher: typeof globalThis.fetch): Provider {
  return createProvider('gemini_native', {
    environment: {
      GEMINI_NATIVE_API_KEY: data.text('Gemini Files API key', 'key'),
      GEMINI_INLINE_FILE_SIZE_LIMIT: '1',
    },
    fetch: fetcher,
  });
}

function fileRequest(source: string): GenerateRequest {
  return { messages: [{ role: 'user', content: [{ type: 'file', source }] }] };
}

function largeDataUrl(mediaType: string, label: string): string {
  return `data:${mediaType};base64,${Buffer.from(data.text(label)).toString('base64')}`;
}

function recordingFetch(
  handler: (call: RecordedCall) => Response | Promise<Response>,
): { readonly fetcher: typeof globalThis.fetch; readonly calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call = {
      url: input instanceof Request ? input.url : String(input),
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body: init.body ?? null,
    };
    calls.push(call);
    return handler(call);
  }) as typeof globalThis.fetch;
  return { fetcher, calls };
}

function isUploadStart(call: RecordedCall): boolean {
  return call.url.includes('/upload/v1beta/files') && call.method === 'POST';
}

function uploadStartResponse(url: string): Response {
  return new Response('', { headers: { 'x-goog-upload-url': url } });
}

function jsonResponse(value: unknown): Response {
  return Response.json(value);
}

function geminiResponse(): Response {
  return jsonResponse({ candidates: [{ content: { parts: [{ text: 'done' }] } }] });
}

async function closeProvider(provider: Provider): Promise<void> {
  await provider.close?.();
}
