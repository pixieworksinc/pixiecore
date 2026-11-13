/** Verify the test harness blocks ambient network calls before they are opened. */
import assert from 'node:assert/strict';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import net from 'node:net';
import { test } from 'node:test';
import tls from 'node:tls';

test('the offline test preload blocks ambient network entry points', async () => {
  const blocked = /Network is disabled for PixieAgent offline tests/;
  await assert.rejects(globalThis.fetch('https://example.invalid/'), blocked);
  assert.throws(() => http.get('http://example.invalid/'), blocked);
  assert.throws(() => http2.connect('https://example.invalid/'), blocked);
  assert.throws(() => https.request('https://example.invalid/'), blocked);
  assert.throws(() => net.connect(443, 'example.invalid'), blocked);
  assert.throws(() => new net.Socket().connect(443, 'example.invalid'), blocked);
  assert.throws(() => tls.connect(443, 'example.invalid'), blocked);
});
