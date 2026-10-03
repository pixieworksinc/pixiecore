import assert from 'node:assert/strict';
import test from 'node:test';
import {
  composeCustomerInquiry,
  CustomerInquiryDomainError,
} from '../../examples/application-composition/customer-inquiry.js';
import type { GenerateRequest, GenerateResponse } from '../../src/index.js';
import type { ApplicationTrace } from '../../src/core/kernel/application/index.js';
import { ScriptedProvider } from '../helpers/fake-provider.js';
import { testData } from '../helpers/test-data.js';

const data = testData('customer inquiry application integration');

test('customer inquiry composes five independent nodes and returns a routing recommendation', async () => {
  const customerId = data.text('customer ID', 'customer');
  const subject = data.text('inquiry subject', 'subject');
  const message = data.text('inquiry message', 'message');
  const rationale = data.text('classification rationale', 'rationale');
  const summary = data.text('inquiry summary', 'summary');
  const queue = data.text('routing queue', 'queue');
  const owner = data.text('routing owner', 'owner');
  const ruleId = `rule:${data.text('routing rule', 'route').replaceAll('_', '-')}`;
  const sourceText = `Customer: ${customerId}. Subject: ${subject}. Message: ${message}.`;
  const controller = new AbortController();
  let trace: ApplicationTrace | undefined;
  const provider = new CloseAwareProvider([
    response({ customer_id: customerId, channel: 'web', locale: 'en-US', subject, message }, controller.signal),
    response({ category: 'billing', priority: 'urgent', rationale, policy_version: '1.0.0' }, controller.signal),
    response({ summary }, controller.signal),
    response({ valid: true, issues: [] }, controller.signal),
    response({
      status: 'routed',
      queue,
      owner,
      rule_id: ruleId,
      sla_hours: 1,
      policy_version: '1.0.0',
    }, controller.signal),
  ]);

  const result = await composeCustomerInquiry({
    sourceText,
    customerTier: 'premium',
    classificationPolicy: { version: '1.0.0', urgent_terms: ['immediate'] },
    routingPolicy: {
      version: '1.0.0',
      rules: [{
        id: ruleId,
        category: 'billing',
        priority: 'urgent',
        customer_tier: 'premium',
        queue,
        owner,
        sla_hours: 1,
      }],
    },
  }, {
    runtimeOptions: runtimeOptions(provider),
    signal: controller.signal,
    traceId: data.text('trace ID', 'trace'),
    onTrace: value => { trace = value; },
  });

  assert.deepEqual(result, {
    extraction: { customer_id: customerId, channel: 'web', locale: 'en-US', subject, message },
    classification: { category: 'billing', priority: 'urgent', rationale, policy_version: '1.0.0' },
    summary: { summary },
    validation: { valid: true, issues: [] },
    routing: {
      status: 'routed',
      queue,
      owner,
      rule_id: ruleId,
      sla_hours: 1,
      policy_version: '1.0.0',
    },
  });
  assert.equal(provider.calls.length, 5);
  assert.equal(provider.closeCalls, 1);
  assert.ok(lastPrompt(provider.calls[0]!).includes(sourceText));
  assert.ok(lastPrompt(provider.calls[1]!).includes(subject));
  assert.ok(lastPrompt(provider.calls[2]!).includes('billing'));
  assert.ok(lastPrompt(provider.calls[3]!).includes(customerId));
  assert.ok(lastPrompt(provider.calls[4]!).includes('premium'));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.validation.issues), true);
  assert.deepEqual(trace?.nodes.map(node => node.node_id), [
    'extract-inquiry',
    'classify-inquiry',
    'summarize-inquiry',
    'validate-inquiry',
    'route-inquiry',
  ]);
  assert.equal(trace?.result, 'succeeded');
});

test('customer inquiry stops before classification when required extracted text is absent', async () => {
  const provider = new CloseAwareProvider([{
    content: JSON.stringify({
      customer_id: data.text('missing field customer', 'customer'),
      channel: 'chat',
      locale: null,
      subject: null,
      message: data.text('remaining message', 'message'),
    }),
  }]);

  await assert.rejects(
    composeCustomerInquiry(baseInput(), { runtimeOptions: runtimeOptions(provider) }),
    error => {
      assert.ok(error instanceof CustomerInquiryDomainError);
      assert.deepEqual(error.issueCodes, ['missing_subject']);
      return true;
    },
  );
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.closeCalls, 1);
});

test('customer inquiry validation prevents the routing node from starting', async () => {
  const subject = data.text('invalid inquiry subject', 'subject');
  const message = data.text('invalid inquiry message', 'message');
  const provider = new CloseAwareProvider([
    { content: JSON.stringify({ customer_id: null, channel: 'email', locale: null, subject, message }) },
    { content: JSON.stringify({ category: 'account', priority: 'normal', rationale: subject, policy_version: '1.0.0' }) },
    { content: JSON.stringify({ summary: message }) },
    { content: JSON.stringify({ valid: false, issues: ['missing_customer_id'] }) },
  ]);

  await assert.rejects(
    composeCustomerInquiry(baseInput(), { runtimeOptions: runtimeOptions(provider) }),
    error => {
      assert.ok(error instanceof CustomerInquiryDomainError);
      assert.deepEqual(error.issueCodes, ['missing_customer_id']);
      return true;
    },
  );
  assert.equal(provider.calls.length, 4);
  assert.equal(provider.closeCalls, 1);
});

class CloseAwareProvider extends ScriptedProvider {
  closeCalls = 0;

  close(): void {
    this.closeCalls++;
  }
}

function baseInput() {
  return {
    sourceText: data.text('inquiry source', 'source'),
    customerTier: 'standard' as const,
    classificationPolicy: { version: '1.0.0', urgent_terms: ['immediate'] },
    routingPolicy: {
      version: '1.0.0',
      rules: [{
        id: 'route:default',
        category: '*',
        priority: '*',
        customer_tier: '*',
        queue: 'general',
        owner: 'triage',
        sla_hours: 24,
      }],
    },
  };
}

function response(
  output: Record<string, unknown>,
  signal: AbortSignal,
): (request: GenerateRequest) => GenerateResponse {
  return request => {
    assert.equal(request.signal, signal);
    return {
      content: JSON.stringify(output),
      usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
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
