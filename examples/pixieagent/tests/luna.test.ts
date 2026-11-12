/** Selected Luna wire compatibility preparation, with all networking blocked. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSpendLedger } from '../budget.js';
import { acceptTriageRun, createBoundedTransport, runOfflineExample } from '../harness.js';
import { checkStrictOutputSchema, createLunaRequestAdapter, LUNA_PLAN } from '../luna.js';

const schema = { type: 'object', additionalProperties: false, required: ['value'],
  properties: { value: { type: 'string' } } };
const request = (overrides: Record<string, unknown> = {}): RequestInit => ({
  method: 'POST', body: JSON.stringify({ model: LUNA_PLAN.model, max_tokens: 512,
    temperature: 0.7, messages: [{ role: 'user', content: 'Synthetic input' }],
    response_format: { type: 'json_schema', json_schema: { name: 'test', strict: true, schema } },
    ...overrides }),
});

test('Luna adapter pins completion limit, reasoning, standard tier, cache, and storage settings', async () => {
  let delegated = 0;
  const adapted = createLunaRequestAdapter(async (input, init) => {
    delegated++;
    assert.equal(input, LUNA_PLAN.endpoint);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.model, 'gpt-6-luna');
    assert.equal(body.max_completion_tokens, 512);
    assert.equal(body.reasoning_effort, 'none');
    assert.equal(body.service_tier, 'default');
    assert.equal(body.store, false);
    assert.deepEqual(body.prompt_cache_options, { mode: 'explicit' });
    assert.ok(!('max_tokens' in body) && !('temperature' in body));
    return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{}' } }] });
  });
  await adapted(LUNA_PLAN.endpoint, request());
  for (const changes of [{ model: 'other' }, { max_tokens: 513 }, { max_tokens: 0 },
    { reasoning_effort: 'high' }, { service_tier: 'priority' }, { max_completion_tokens: 512 },
    { messages: [] }, { tools: [] }, { n: 2 },
    { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://other.invalid' } }] }] },
    { messages: [{ role: 'user', content: 'text', prompt_cache_breakpoint: { mode: 'explicit' } }] }]) {
    await assert.rejects(adapted(LUNA_PLAN.endpoint, request(changes)));
  }
  await assert.rejects(adapted('https://other.invalid', request()));
  assert.equal(delegated, 1);
});

test('strict schema check rejects optional or open objects and unsupported root compositions', () => {
  checkStrictOutputSchema(schema);
  checkStrictOutputSchema({ ...schema, properties: { value: { type: ['object', 'null'],
    additionalProperties: false, required: ['x'], properties: { x: { type: 'string' } } } } });
  for (const bad of [{ ...schema, required: [] }, { ...schema, additionalProperties: true },
    { ...schema, anyOf: [schema] }, { ...schema, properties: { value: { type: 'object' } } }]) {
    assert.throws(() => checkStrictOutputSchema(bad));
  }
});

test('Luna rejects incomplete, refused, tool-bearing or ambiguous successful HTTP responses', async () => {
  const message = { role: 'assistant', content: '{"value":"valid-looking"}' };
  const choice = { finish_reason: 'stop', message };
  const invalid = [null, {}, { choices: [] }, { choices: [choice, choice] },
    ...['length', 'content_filter', 'tool_calls', 'function_call', null, undefined]
      .map(finish_reason => ({ choices: [{ ...choice, finish_reason }] })),
    ...[null, { ...message, role: 'user' }, { ...message, content: null }, { ...message, content: ' ' },
      { ...message, refusal: 'Refused despite parseable content' },
      { ...message, tool_calls: [{ id: 'unapproved-tool' }] },
      { ...message, function_call: { name: 'unapproved-tool' } }]
      .map(message => ({ choices: [{ ...choice, message }] })),
  ];
  for (const body of invalid) {
    const adapted = createLunaRequestAdapter(async () => Response.json(body));
    await assert.rejects(adapted(LUNA_PLAN.endpoint, request()));
  }
  await assert.rejects(createLunaRequestAdapter(async () => new Response('not-json'))(
    LUNA_PLAN.endpoint, request()));
  const accepted = await createLunaRequestAdapter(async () => Response.json({ choices: [{ ...choice,
    message: { ...message, refusal: null, tool_calls: [] } }] }))(LUNA_PLAN.endpoint, request());
  // Validation must leave the original body available to the Blueprint runtime.
  assert.deepEqual(await accepted.json(), { choices: [{ ...choice,
    message: { ...message, refusal: null, tool_calls: [] } }] });
});

test('Luna transport rejects altered wire controls before transmission', async () => {
  let delegated = 0;
  const ledger = createSpendLedger({ maxInputTokens: 4096, maxCostNanoUsd: 1_000_000_000,
    ...LUNA_PLAN.prices }, () => 256);
  const bounded = createBoundedTransport({ ...LUNA_PLAN, wireFormat: 'luna' }, async () => {
    delegated++; return Response.json({});
  }, ledger);
  let wire: RequestInit | undefined;
  await createLunaRequestAdapter(async (_input, init) => {
    wire = init;
    return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{}' } }] });
  })(
    LUNA_PLAN.endpoint, request());
  assert.ok(wire);
  const body = JSON.parse(String(wire.body)) as Record<string, unknown>;
  for (const overrides of [{ reasoning_effort: 'medium' }, { service_tier: 'auto' },
    { prompt_cache_options: { mode: 'implicit' } }, { store: true }, { temperature: 1 },
    { max_completion_tokens: 513 }, { max_tokens: 512 }]) {
    await assert.rejects(bounded.fetch(LUNA_PLAN.endpoint, { ...wire, body: JSON.stringify({ ...body, ...overrides }) }));
  }
  assert.equal(delegated, 0);
  assert.equal(ledger.snapshot().reservedNanoUsd, 0);
});

test('Luna profile completes actual runtime serialization with synthetic responses and no network', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Real networking prohibited'); };
  try {
    const result = await runOfflineExample('scripted', 'luna');
    assert.equal(result.status, 'passed');
    assert.equal(result.profile, 'luna');
    assert.equal(result.inputTokensSynthetic, false);
    assert.equal(result.inputAccounting, 'model-context-upper-bound');
    assert.equal(result.providerRequests, 3);
    assert.equal(result.networkRequests, 0);
    assert.equal(result.costUsd, null);
    assert.equal(result.simulatedSpend.reservedNanoUsd, 631_152_000);
    const rejected = await runOfflineExample('rejecting', 'luna');
    assert.equal(rejected.status, 'failed');
    assert.equal(rejected.providerRequests, 1);
    assert.equal(rejected.requests[0]?.status, 'failed');
  } finally {
    globalThis.fetch = saved;
  }
});

test('documented context upper bound and long-context rates stop request five below USD 1', async () => {
  const ledger = createSpendLedger({ maxInputTokens: LUNA_PLAN.maxInputTokens,
    maxCostNanoUsd: 1_000_000_000, ...LUNA_PLAN.prices }, () => LUNA_PLAN.maxInputTokens);
  let delegated = 0;
  const bounded = createBoundedTransport({ ...LUNA_PLAN, wireFormat: 'luna' }, async () => {
    delegated++;
    return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{}' } }] });
  }, ledger);
  const adapted = createLunaRequestAdapter(bounded.fetch);
  for (let index = 0; index < 4; index++) await adapted(LUNA_PLAN.endpoint, request());
  await assert.rejects(adapted(LUNA_PLAN.endpoint, request()), /Spend budget exhausted/);
  assert.equal(delegated, 4);
  assert.equal(bounded.requestCount(), 4);
  assert.equal(ledger.snapshot().reservedNanoUsd, 841_536_000);
});

test('scenario acceptance rejects empty or contradictory results even when they are valid JSON', () => {
  const classification = { category: 'security', severity: 'high', reason: 'Synthetic reason' };
  const agent = { result: classification, decisions: 2,
    observations: [{ action_id: 'classify-issue', input: {}, output: classification }] };
  acceptTriageRun(agent);
  for (const result of [null, { ...classification, reason: '' }, { ...classification, category: 'other' },
    { ...classification, severity: 'low' }]) {
    assert.throws(() => acceptTriageRun({ ...agent, result }));
  }
  assert.throws(() => acceptTriageRun({ ...agent, decisions: 1, observations: [] }));
});
