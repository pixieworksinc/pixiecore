import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { basename, isAbsolute, relative } from 'node:path';
import { LLMAPIError, LoggingConfig, PixieCoreLogger } from '../../../../index.js';
import { FakeApiRuntime } from '../../../../../tests/helpers/fake-api-runtime.js';
import { responseJson, startApiServer, stopApiServer } from '../../../../../tests/helpers/http-server.js';
import { withTempDirectory } from '../../../../../tests/helpers/temp.js';

test('multiple same-name base64 uploads stay distinct, reach runtime, and are removed after success', async () => {
  await withTempDirectory(async root => {
    const runtime = new FakeApiRuntime();
    const observedPaths: string[] = [];
    const observedContent: string[] = [];
    runtime.onExecute = async call => {
      const filePaths = call.inputs.file_path;
      const imagePath = call.inputs.image_path;
      assert.ok(Array.isArray(filePaths));
      assert.equal(typeof imagePath, 'string');
      for (const path of [...filePaths, imagePath] as string[]) {
        observedPaths.push(path);
        observedContent.push((await readFile(path)).toString('utf8'));
      }
      return { count: observedPaths.length };
    };
    const { server, baseUrl } = await startApiServer({
      runtime,
      apiLogger: quietApiLogger(),
      environment: {},
      maxFileSize: 10,
      tempRoot: root,
    });
    try {
      const response = await postJson(`${baseUrl}/execute`, {
        blueprint: 'x',
        files: {
          file_path: [
            { filename: '../../\0unsafe name.pdf', content: Buffer.from('123456789').toString('base64') },
            { filename: 'same.pdf', content: Buffer.from('abcdefghi').toString('base64') },
          ],
          image_path: [{ filename: 'same.pdf', content: Buffer.from('image1234').toString('base64') }],
        },
      });
      assert.equal(response.status, 200);
      assert.deepEqual((await responseJson(response)).data, { count: 3 });
      assert.deepEqual(observedContent, ['123456789', 'abcdefghi', 'image1234']);
      assert.equal(new Set(observedPaths.map(path => basename(path))).size, 3);
      for (const path of observedPaths) {
        const fromRoot = relative(root, path);
        assert.equal(isAbsolute(fromRoot) || fromRoot.startsWith('..'), false);
        assert.doesNotMatch(basename(path), /[\0/\\]/);
      }
      for (const path of observedPaths) await assert.rejects(access(path), { code: 'ENOENT' });
    } finally { await stopApiServer(server); }
  });
});

test('invalid and individually oversized uploads return file_upload_error', async () => {
  await withTempDirectory(async root => {
    const runtime = new FakeApiRuntime();
    const { server, baseUrl } = await startApiServer({
      runtime,
      apiLogger: quietApiLogger(),
      environment: {},
      maxFileSize: 10,
      tempRoot: root,
    });
    try {
      const invalid = await postJson(`${baseUrl}/execute`, {
        blueprint: 'x', files: { file_path: [{ filename: 'bad.pdf', content: '!!!not-base64!!!' }] },
      });
      assert.equal(invalid.status, 400);
      assert.equal((await responseJson(invalid)).error.type, 'file_upload_error');

      const nonCanonical = await postJson(`${baseUrl}/execute`, {
        blueprint: 'x', files: { file_path: [{ filename: 'bad.pdf', content: 'Zh==' }] },
      });
      assert.equal(nonCanonical.status, 400);
      assert.equal((await responseJson(nonCanonical)).error.type, 'file_upload_error');

      const oversized = await postJson(`${baseUrl}/execute`, {
        blueprint: 'x', files: { file_path: [{ filename: 'big.pdf', content: Buffer.alloc(11, 1).toString('base64') }] },
      });
      assert.equal(oversized.status, 400);
      const body = await responseJson(oversized);
      assert.equal(body.error.type, 'file_upload_error');
      assert.match(body.error.message, /exceeds 10 bytes/);
      assert.equal(runtime.calls.length, 0);
      assert.deepEqual(await readdir(root), []);
    } finally { await stopApiServer(server); }
  });
});

test('an aborted streamed body does not execute and leaves the server healthy', async () => {
  const runtime = new FakeApiRuntime();
  const { server, baseUrl } = await startApiServer({
    runtime,
    apiLogger: quietApiLogger(),
    environment: {},
  });
  try {
    const url = new URL('/execute', baseUrl);
    let markReceived!: () => void;
    const received = new Promise<void>(resolve => { markReceived = resolve; });
    server.prependOnceListener('request', request => {
      request.once('data', () => markReceived());
    });
    const request = httpRequest(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'transfer-encoding': 'chunked',
      },
    });
    request.on('error', () => undefined);
    const closed = new Promise<void>(resolve => request.once('close', () => resolve()));
    request.write('{"blueprint":"partial');
    await received;
    request.destroy();
    await closed;

    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await responseJson(health), { status: 'ok' });
    assert.equal(runtime.calls.length, 0);
  } finally {
    await stopApiServer(server);
  }
});

test('temporary uploads are removed when runtime execution fails', async () => {
  await withTempDirectory(async root => {
    const runtime = new FakeApiRuntime();
    let observedPath = '';
    runtime.onExecute = async call => {
      observedPath = call.inputs.file_path as string;
      assert.equal((await readFile(observedPath)).toString(), 'payload');
      throw new LLMAPIError('provider unavailable');
    };
    const { server, baseUrl } = await startApiServer({ runtime, apiLogger: quietApiLogger(), environment: {}, maxFileSize: 10, tempRoot: root });
    try {
      const response = await postJson(`${baseUrl}/execute`, {
        blueprint: 'x', files: { file_path: [{ filename: 'file.pdf', content: Buffer.from('payload').toString('base64') }] },
      });
      assert.equal(response.status, 502);
      assert.equal((await responseJson(response)).error.type, 'llm_api_error');
      assert.ok(observedPath);
      await assert.rejects(access(observedPath), { code: 'ENOENT' });
    } finally { await stopApiServer(server); }
  });
});

test('closing the HTTP server closes its shared runtime exactly once', async () => {
  const runtime = new FakeApiRuntime();
  const { server } = await startApiServer({ runtime, apiLogger: quietApiLogger(), environment: {} });
  await stopApiServer(server);
  await server.closeResources();
  assert.equal(runtime.closeCount, 1);
});

function quietApiLogger(): PixieCoreLogger {
  return new PixieCoreLogger(new LoggingConfig({ logToConsole: false }).validate(), 'pixiecore.api');
}
function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
