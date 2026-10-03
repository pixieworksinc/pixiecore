import assert from 'node:assert/strict';
import test from 'node:test';
import {
  composePublicationBrief,
  PublicationBriefNodeError,
} from '../../examples/application-composition/publication-brief.js';
import type { GenerateRequest, GenerateResponse } from '../../src/index.js';
import type { ApplicationTrace } from '../../src/core/kernel/application/index.js';
import { ScriptedProvider } from '../helpers/fake-provider.js';
import { testData } from '../helpers/test-data.js';

const data = testData('application composition integration');

test('reference composer runs five Blueprints with explicit mappings and one signal', async () => {
  const controller = new AbortController();
  const sourceText = data.text('source text', 'source');
  const title = data.text('extracted title', 'title');
  const audience = data.text('extracted audience', 'audience');
  const facts = [data.text('first fact', 'fact'), data.text('second fact', 'fact')];
  const rationale = data.text('classification rationale', 'rationale');
  const summary = data.text('summary', 'summary');
  const locale = data.text('locale', 'locale');
  const localizedSummary = data.text('localized summary', 'localized');
  const traceId = data.text('application trace ID', 'trace');
  let trace: ApplicationTrace | undefined;
  const provider = new CloseAwareProvider([
    response({ title, audience, facts }, controller.signal),
    response({ category: 'product', rationale }, controller.signal),
    response({ summary }, controller.signal),
    response({ valid: true, issues: [] }, controller.signal),
    response({ locale, localized_summary: localizedSummary }, controller.signal),
  ]);

  const result = await composePublicationBrief(
    { sourceText, locale },
    {
      runtimeOptions: runtimeOptions(provider),
      signal: controller.signal,
      traceId,
      onTrace: value => { trace = value; },
    },
  );

  assert.deepEqual(result, {
    extraction: { title, audience, facts },
    classification: { category: 'product', rationale },
    summary: { summary },
    validation: { valid: true, issues: [] },
    localization: { locale, localized_summary: localizedSummary },
  });
  assert.equal(provider.calls.length, 5);
  assert.equal(provider.closeCalls, 1);
  assert.match(lastPrompt(provider.calls[0]!), new RegExp(sourceText));
  assert.match(lastPrompt(provider.calls[1]!), new RegExp(title));
  assert.match(lastPrompt(provider.calls[1]!), new RegExp(facts[0]!));
  assert.match(lastPrompt(provider.calls[2]!), /product/u);
  assert.match(lastPrompt(provider.calls[3]!), new RegExp(summary));
  assert.match(lastPrompt(provider.calls[4]!), new RegExp(locale));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.extraction.facts), true);
  assert.equal(Object.isFrozen(result.validation.issues), true);
  assert.ok(trace);
  assert.equal(trace.trace_id, traceId);
  assert.equal(trace.result, 'succeeded');
  assert.deepEqual(trace.nodes.map(node => node.node_id), [
    'extract-brief',
    'classify-brief',
    'summarize-brief',
    'validate-brief',
    'localize-brief',
  ]);
  assert.equal(trace.nodes.every(node => node.provider_usage[0]?.calls === 1), true);
  assert.equal(trace.nodes.every(node => node.provider_usage[0]?.total_tokens === 15), true);
});

test('reference composer fails fast with node identity and preserves the cause', async () => {
  const title = data.text('failure title', 'title');
  const audience = data.text('failure audience', 'audience');
  const fact = data.text('failure fact', 'fact');
  const failure = new Error(data.text('provider failure', 'failure'));
  const provider = new CloseAwareProvider([
    { content: JSON.stringify({ title, audience, facts: [fact] }) },
    { content: JSON.stringify({ category: 'policy', rationale: fact }) },
    () => { throw failure; },
  ]);

  await assert.rejects(
    composePublicationBrief(
      { sourceText: data.text('failure source', 'source'), locale: data.text('failure locale', 'locale') },
      { runtimeOptions: runtimeOptions(provider) },
    ),
    error => {
      assert.ok(error instanceof PublicationBriefNodeError);
      assert.equal(error.node.id, 'summarize-brief');
      assert.equal(error.node.blueprintVersion, '1.0.1');
      assert.deepEqual(error.inputFields, ['category', 'facts', 'title']);
      assert.equal(error.cause, failure);
      return true;
    },
  );
  assert.equal(provider.calls.length, 3, 'nodes after the failure must not start');
  assert.equal(provider.closeCalls, 1);
});

test('reference composer does not start a node after application cancellation', async () => {
  const provider = new CloseAwareProvider([]);
  const controller = new AbortController();
  const reason = new Error(data.text('abort reason', 'abort'));
  let trace: ApplicationTrace | undefined;
  controller.abort(reason);

  await assert.rejects(
    composePublicationBrief(
      { sourceText: data.text('cancelled source', 'source'), locale: data.text('cancelled locale', 'locale') },
      {
        runtimeOptions: runtimeOptions(provider),
        signal: controller.signal,
        onTrace: value => { trace = value; },
      },
    ),
    error => {
      assert.ok(error instanceof PublicationBriefNodeError);
      assert.equal(error.node.id, 'extract-brief');
      assert.equal(error.cause, reason);
      return true;
    },
  );
  assert.equal(provider.calls.length, 0);
  assert.equal(provider.closeCalls, 1);
  assert.equal(trace?.result, 'cancelled');
  assert.equal(trace?.nodes[0]?.result, 'cancelled');
});

test('reference composer rejects blank application inputs before acquiring a runtime', async () => {
  const provider = new CloseAwareProvider([]);
  await assert.rejects(
    composePublicationBrief(
      { sourceText: ' ', locale: data.text('unused locale', 'locale') },
      { runtimeOptions: runtimeOptions(provider) },
    ),
    /sourceText must be non-blank/,
  );
  assert.equal(provider.calls.length, 0);
  assert.equal(provider.closeCalls, 0);
});

class CloseAwareProvider extends ScriptedProvider {
  closeCalls = 0;

  close(): void {
    this.closeCalls++;
  }
}

function response(
  output: Record<string, unknown>,
  signal: AbortSignal,
): (request: GenerateRequest) => GenerateResponse {
  return request => {
    assert.equal(request.signal, signal);
    return {
      content: JSON.stringify(output),
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };
  };
}

function runtimeOptions(provider: CloseAwareProvider) {
  return {
    provider,
    maxRetry: 0,
    mcpConfigPath: 'disabled' as const,
    pluginConfigPath: 'disabled' as const,
  };
}

function lastPrompt(request: GenerateRequest): string {
  const content = request.messages.at(-1)?.content;
  if (typeof content !== 'string') throw new TypeError('Expected a text prompt');
  return content;
}
