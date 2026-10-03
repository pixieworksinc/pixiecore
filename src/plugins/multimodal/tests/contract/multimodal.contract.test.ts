import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  InputTypeError,
  InputValidationError,
  MultimodalNotSupportedError,
  PromptRuntime,
  attachmentBytes,
  contentParts,
  contentText,
  enhanceMessagesWithMultimodal,
  extractPdfText,
  makeDataUrl,
  mimeFromName,
  normalizeAttachmentInput,
  parseDataUrl,
  resolveAttachment,
} from '../../../../index.js';
import type { Message, ResolvedAttachment } from '../../../../index.js';
import { ScriptedProvider } from '../../../../../tests/helpers/fake-provider.js';
import { withTempDirectory } from '../../../../../tests/helpers/temp.js';

const yaml = `
name: Multimodal
version: '1.0'
role: assistant
prompt: Analyze the supplied sources
output_schema: '{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"]}'
`;

async function pdfFixture(name: string): Promise<Buffer> {
  const base64 = await readFile(new URL(`../../../../../tests/fixtures/${name}.base64`, import.meta.url), 'utf8');
  return Buffer.from(base64.trim(), 'base64');
}

test('multimodal enhancement attaches normalized inputs to every user message', () => {
  const provider = new ScriptedProvider([]);
  const system: Message = { role: 'system', content: 'System' };
  const assistant: Message = { role: 'assistant', content: 'Assistant' };
  const messages: Message[] = [
    system,
    { role: 'user', content: 'First' },
    assistant,
    { role: 'user', content: [{ type: 'text', text: 'Second' }] },
  ];
  const dataUrl = 'data:image/png;base64,aW1hZ2U=';
  const enhanced = enhanceMessagesWithMultimodal(messages, {
    image_path: [dataUrl, '/tmp/second.jpg'],
    file_path: '/tmp/report.pdf',
  }, provider);

  assert.equal(enhanced[0], system);
  assert.equal(enhanced[2], assistant);
  for (const index of [1, 3]) {
    const message = enhanced[index]!;
    assert.equal(message.role, 'user');
    assert.deepEqual(typeof message.content === 'string' ? [] : message.content.slice(-3), [
      { type: 'image', source: dataUrl },
      { type: 'image', source: '/tmp/second.jpg' },
      { type: 'file', source: '/tmp/report.pdf' },
    ]);
  }
});

test('runtime enhances history and generated prompt before the first provider call', async () => {
  const provider = new ScriptedProvider([{ content: '{"ok":true}' }]);
  const runtime = new PromptRuntime({ provider, mcpConfigPath: 'disabled' });
  try {
    await runtime.executeYaml(yaml, {
      image_path: ['/tmp/one.png', '/tmp/two.jpg'],
      file_path: ['data:application/pdf;base64,JVBERi0xLjQ='],
    }, {
      messages: [
        { role: 'user', content: 'Earlier question' },
        { role: 'assistant', content: 'Earlier answer' },
      ],
    });
    const users = provider.calls[0]!.messages.filter(message => message.role === 'user');
    assert.equal(users.length, 2);
    for (const message of users) {
      assert.ok(Array.isArray(message.content));
      assert.equal(message.content.filter(part => part.type === 'image').length, 2);
      assert.equal(message.content.filter(part => part.type === 'file').length, 1);
    }
  } finally {
    await runtime.close();
  }
});

test('invalid multimodal input types fail before a provider call', async () => {
  const provider = new ScriptedProvider([{ content: '{"ok":true}' }]);
  const runtime = new PromptRuntime({ provider, mcpConfigPath: 'disabled' });
  try {
    await assert.rejects(
      runtime.executeYaml(yaml, { image_path: 123 }),
      (error: unknown) => error instanceof InputTypeError && /image_path must be str or list\[str\]/.test(error.message),
    );
    await assert.rejects(
      runtime.executeYaml(yaml, { file_path: ['ok.pdf', 123] }),
      (error: unknown) => error instanceof InputTypeError && /file_path must be str or list\[str\]/.test(error.message),
    );
    assert.equal(provider.calls.length, 0);
  } finally {
    await runtime.close();
  }
});

test('data URLs require a valid base64 payload', () => {
  assert.equal(parseDataUrl('https://example.com/image.png'), undefined);
  assert.throws(() => parseDataUrl('data:image/png'), /must contain a data payload/);
  assert.throws(() => parseDataUrl('data:image/png,not-base64'), InputValidationError);
  assert.throws(() => parseDataUrl('data:image/png;base64,!!!'), InputValidationError);
  assert.throws(() => parseDataUrl('data:image/png;base64,Zh=='), /invalid base64 data/);
  assert.deepEqual(parseDataUrl('data:text/plain;charset=utf-8;base64,aGVsbG8='), {
    mediaType: 'text/plain',
    data: Buffer.from('hello'),
  });
});

test('public multimodal helpers preserve content, input, MIME, and data URL contracts', () => {
  const mixed = [
    { type: 'text' as const, text: 'first' },
    { type: 'file' as const, source: 'report.pdf' },
    { type: 'text' as const, text: 'second' },
  ];
  assert.deepEqual(contentParts('plain'), [{ type: 'text', text: 'plain' }]);
  assert.deepEqual(contentParts(''), []);
  assert.deepEqual(contentParts(mixed), mixed);
  assert.notEqual(contentParts(mixed), mixed);
  assert.equal(contentText(mixed), 'firstsecond');

  const paths = ['first.png', 'second.png'];
  const normalized = normalizeAttachmentInput(paths, 'image_path');
  assert.deepEqual(normalized, paths);
  assert.notEqual(normalized, paths);
  assert.deepEqual(normalizeAttachmentInput(null, 'file_path'), []);
  assert.deepEqual(normalizeAttachmentInput('report.pdf', 'file_path'), ['report.pdf']);

  assert.equal(mimeFromName('PHOTO.JPEG', 'image'), 'image/jpeg');
  assert.equal(mimeFromName('unknown', 'image'), 'image/jpeg');
  assert.equal(mimeFromName('unknown', 'file'), 'application/octet-stream');
  assert.equal(makeDataUrl('text/plain', Buffer.from('hello')), 'data:text/plain;base64,aGVsbG8=');
});

test('attachment resolution preserves provider IDs, URLs, data URLs, and local files', async () => {
  assert.deepEqual(await resolveAttachment({
    type: 'image',
    source: 'file_image123',
    mediaType: 'image/png',
    detail: 'high',
  }), {
    kind: 'image',
    source: 'file_image123',
    fileId: 'file_image123',
    mediaType: 'image/png',
    filename: 'image.png',
    detail: 'high',
  });

  assert.deepEqual(await resolveAttachment({
    type: 'file',
    source: 'data:text/plain;base64,aGVsbG8=',
  }), {
    kind: 'file',
    source: 'data:text/plain;base64,aGVsbG8=',
    mediaType: 'text/plain',
    filename: 'file.txt',
    data: Buffer.from('hello'),
    dataUrl: 'data:text/plain;base64,aGVsbG8=',
  });

  assert.deepEqual(await resolveAttachment({
    type: 'file',
    source: 'https://example.com/files/report.pdf?download=1',
  }), {
    kind: 'file',
    source: 'https://example.com/files/report.pdf?download=1',
    url: 'https://example.com/files/report.pdf?download=1',
    mediaType: 'application/pdf',
    filename: 'report.pdf',
  });

  await withTempDirectory(async directory => {
    const path = join(directory, 'notes.TXT');
    await writeFile(path, 'local text');
    assert.deepEqual(await resolveAttachment({ type: 'file', source: path }), {
      kind: 'file',
      source: path,
      mediaType: 'text/plain',
      filename: 'notes.TXT',
      data: Buffer.from('local text'),
      dataUrl: 'data:text/plain;base64,bG9jYWwgdGV4dA==',
    });
    await assert.rejects(
      resolveAttachment({ type: 'file', source: join(directory, 'missing.txt') }),
      InputValidationError,
    );
  });
  await assert.rejects(
    resolveAttachment({ type: 'image', source: '' }),
    /image attachment source cannot be empty/,
  );
});

test('attachment bytes preserve inline data and normalize remote failures', async () => {
  const data = Buffer.from('inline');
  const inline: ResolvedAttachment = {
    kind: 'file',
    source: 'inline',
    mediaType: 'text/plain',
    filename: 'inline.txt',
    data,
  };
  assert.equal(await attachmentBytes(inline), data);

  const remote: ResolvedAttachment = {
    kind: 'file',
    source: 'https://example.com/report.txt',
    url: 'https://example.com/report.txt',
    mediaType: 'text/plain',
    filename: 'report.txt',
  };
  assert.deepEqual(
    Array.from(await attachmentBytes(remote, async () => new Response('remote data'))),
    Array.from(Buffer.from('remote data')),
  );
  await assert.rejects(
    attachmentBytes(remote, async () => new Response('missing', { status: 404 })),
    /Unable to fetch attachment \(404\)/,
  );
  await assert.rejects(
    attachmentBytes(remote, async () => { throw new Error('offline'); }),
    /Unable to fetch attachment/,
  );
  const providerFile: ResolvedAttachment = {
    kind: 'file',
    source: 'file-existing',
    fileId: 'file-existing',
    mediaType: 'application/octet-stream',
    filename: 'file',
  };
  await assert.rejects(attachmentBytes(providerFile), /does not contain readable data/);
});

test('real offline PDF extraction preserves item and page ordering', async () => {
  const onePage = await pdfFixture('pdf-one-page');
  const twoPages = await pdfFixture('pdf-two-pages');
  assert.equal(await extractPdfText({
    kind: 'file',
    source: 'fixture:one-page',
    mediaType: 'application/pdf',
    filename: 'one-page.pdf',
    data: onePage,
  }), 'PixieCore PDF fixture');
  assert.equal(await extractPdfText({
    kind: 'file',
    source: 'fixture:two-pages',
    mediaType: 'application/pdf',
    filename: 'two-pages.pdf',
    data: twoPages,
  }), 'First item Last item\n\nSecond page');
});

test('PDF extraction rejects invalid bytes without hanging parser cleanup', async () => {
  await assert.rejects(extractPdfText({
    kind: 'file',
    source: 'fixture:invalid',
    mediaType: 'application/pdf',
    filename: 'invalid.pdf',
    data: Buffer.from('not a PDF'),
  }));
});

test('PDF extraction preserves normalized attachment byte failures', async () => {
  const source = 'https://example.invalid/unavailable.pdf';
  await assert.rejects(
    extractPdfText({
      kind: 'file',
      source,
      url: source,
      mediaType: 'application/pdf',
      filename: 'unavailable.pdf',
    }, async () => { throw new Error('offline fixture'); }),
    (error: unknown) => error instanceof InputValidationError
      && error.message === `Unable to fetch attachment: ${source}`
      && error.cause instanceof Error
      && error.cause.message === 'offline fixture',
  );
});

test('provider capabilities are enforced before a provider call', async () => {
  class TextOnlyProvider extends ScriptedProvider {
    override supportsVision(): boolean { return false; }
    override supportsFileInput(): boolean { return false; }
  }
  const provider = new TextOnlyProvider([{ content: '{"ok":true}' }], { name: 'text-only', model: 'text-1' });
  const runtime = new PromptRuntime({ provider, mcpConfigPath: 'disabled' });
  try {
    await assert.rejects(
      runtime.executeYaml(yaml, { image_path: '/tmp/image.png' }),
      (error: unknown) => error instanceof MultimodalNotSupportedError
        && /text-1/.test(error.message)
        && /gpt-4o/.test(error.message)
        && /claude-3/.test(error.message)
        && /gemini-1\.5/.test(error.message),
    );
    await assert.rejects(
      runtime.executeYaml(yaml, { file_path: '/tmp/file.pdf' }),
      (error: unknown) => error instanceof MultimodalNotSupportedError && /does not support file inputs/.test(error.message),
    );
    assert.equal(provider.calls.length, 0);
  } finally {
    await runtime.close();
  }
});
