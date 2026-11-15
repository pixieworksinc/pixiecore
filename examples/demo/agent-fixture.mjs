/** CI-only preload. Every provider request is validated and answered in memory. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

assert.equal(process.env.PIXIEAGENT_CI_FIXTURE, '1', 'Fixture preload is for isolated CI only');
const root = '/runtime/examples/pixieagent/evaluation';
/** @type {{id: string, goal: string}[]} */
const cases = JSON.parse(readFileSync(join(root, 'cases.json'), 'utf8')).cases;
/** @type {Record<string, unknown[]>} */
const fixtures = JSON.parse(readFileSync(join(root, 'fixtures.json'), 'utf8')).responses;
assert.equal(cases.length, 6);
const responses = cases.flatMap(entry => fixtures[entry.id] ?? []);
assert.equal(responses.length, 18);
const recordPath = '/state/provider-fixture.json';
let calls = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')).calls : 0;

// Never retain or delegate to the native fetch. Even a malformed request cannot
// contact a provider, before or after the container loses its edge network.
/** @type {typeof globalThis.fetch} */
const fixtureFetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  assert.equal(url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(init?.method, 'POST');
  assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture-not-a-provider-credential-ci');
  assert.equal(typeof init?.body, 'string');
  const body = JSON.parse(String(init?.body));
  assert.equal(body.model, 'gpt-6-luna');
  assert.ok(Number.isInteger(body.max_completion_tokens) && body.max_completion_tokens > 0 && body.max_completion_tokens <= 512);
  assert.ok(Array.isArray(body.messages));
  assert.ok(calls < responses.length, 'The fixture permits exactly eighteen provider responses');
  const entry = cases[Math.floor(calls / 3)];
  assert.ok(entry);
  /** @type {{content: string}[]} */
  const messages = body.messages;
  assert.ok(messages.every(message => typeof message.content === 'string'));
  assert.ok(messages.some(message => message.content.includes(entry.goal)), 'Unexpected case input or provider request order');
  const content = responses[calls];
  calls += 1;
  writeFileSync(recordPath, JSON.stringify({ calls }), { mode: 0o600 });
  await delay(100, undefined, { signal: init?.signal ?? undefined });
  const response = Response.json({
    usage: { prompt_tokens: 256, completion_tokens: 128, total_tokens: 384 },
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content) } }],
  });
  Object.defineProperty(response, 'url', { value: url });
  return response;
};
globalThis.fetch = fixtureFetch;
