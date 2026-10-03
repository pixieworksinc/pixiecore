import assert from 'node:assert/strict';
import test from 'node:test';
import {
  composeInvoiceReview,
  InvoiceReviewDomainError,
} from '../../examples/application-composition/invoice-review.js';
import type { GenerateRequest, GenerateResponse } from '../../src/index.js';
import type { ApplicationTrace } from '../../src/core/kernel/application/index.js';
import { ScriptedProvider } from '../helpers/fake-provider.js';
import { testData } from '../helpers/test-data.js';

const data = testData('invoice review application integration');

test('invoice review composes five nodes and preserves a matched ledger result', async () => {
  const invoiceNumber = data.text('invoice number', 'INV');
  const supplier = data.text('supplier', 'supplier');
  const purchaseOrder = data.text('purchase order', 'PO');
  const subtotal = data.integer('subtotal', 100, 900);
  const tax = data.integer('tax', 1, 90);
  const total = subtotal + tax;
  const rationale = data.text('document rationale', 'rationale');
  const summary = data.text('review summary', 'summary');
  const sourceText = `${invoiceNumber} ${supplier} ${purchaseOrder} USD ${subtotal} ${tax} ${total}`;
  const extracted = {
    invoice_number: invoiceNumber,
    supplier,
    purchase_order: purchaseOrder,
    currency: 'USD',
    subtotal,
    tax,
    total,
  };
  const controller = new AbortController();
  let trace: ApplicationTrace | undefined;
  const provider = new CloseAwareProvider([
    response(extracted, controller.signal),
    response({ document_type: 'invoice', rationale }, controller.signal),
    response({ valid: true, issues: [], rules_version: '1.0.0' }, controller.signal),
    response({ status: 'matched', mismatches: [], policy_version: '1.0.0' }, controller.signal),
    response({ recommendation: 'ready_for_human_review', summary, reason_codes: [] }, controller.signal),
  ]);

  const result = await composeInvoiceReview({
    sourceText,
    ledgerRecord: {
      invoice_number: invoiceNumber,
      supplier,
      purchase_order: purchaseOrder,
      currency: 'USD',
      total,
    },
    validationRules: { version: '1.0.0', amount_tolerance: 0.01 },
    comparisonPolicy: { version: '1.0.0', amount_tolerance: 0.01 },
  }, {
    runtimeOptions: runtimeOptions(provider),
    signal: controller.signal,
    onTrace: value => { trace = value; },
  });

  assert.deepEqual(result, {
    extraction: extracted,
    classification: { document_type: 'invoice', rationale },
    validation: { valid: true, issues: [], rules_version: '1.0.0' },
    verification: { status: 'matched', mismatches: [], policy_version: '1.0.0' },
    review: { recommendation: 'ready_for_human_review', summary, reason_codes: [] },
  });
  assert.equal(provider.calls.length, 5);
  assert.equal(provider.closeCalls, 1);
  assert.ok(lastPrompt(provider.calls[0]!).includes(sourceText));
  assert.ok(lastPrompt(provider.calls[1]!).includes(invoiceNumber));
  assert.ok(lastPrompt(provider.calls[2]!).includes(String(total)));
  assert.ok(lastPrompt(provider.calls[3]!).includes(supplier));
  assert.ok(lastPrompt(provider.calls[4]!).includes('matched'));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.verification.mismatches), true);
  assert.equal(Object.isFrozen(result.review.reason_codes), true);
  assert.deepEqual(trace?.nodes.map(node => node.node_id), [
    'extract-invoice',
    'classify-invoice',
    'validate-invoice',
    'verify-invoice',
    'summarize-invoice-review',
  ]);
  assert.equal(trace?.result, 'succeeded');
});

test('invoice validation stops before ledger verification', async () => {
  const invoiceNumber = data.text('invalid invoice number', 'INV');
  const provider = new CloseAwareProvider([
    { content: JSON.stringify({
      invoice_number: invoiceNumber,
      supplier: null,
      purchase_order: null,
      currency: 'USD',
      subtotal: 10,
      tax: 1,
      total: 15,
    }) },
    { content: JSON.stringify({ document_type: 'invoice', rationale: invoiceNumber }) },
    { content: JSON.stringify({
      valid: false,
      issues: ['missing_supplier', 'missing_purchase_order', 'amount_mismatch'],
      rules_version: '1.0.0',
    }) },
  ]);

  await assert.rejects(
    composeInvoiceReview(baseInput(), { runtimeOptions: runtimeOptions(provider) }),
    error => {
      assert.ok(error instanceof InvoiceReviewDomainError);
      assert.deepEqual(error.issueCodes, [
        'missing_supplier',
        'missing_purchase_order',
        'amount_mismatch',
      ]);
      return true;
    },
  );
  assert.equal(provider.calls.length, 3);
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
    sourceText: data.text('invoice source', 'source'),
    ledgerRecord: {
      invoice_number: data.text('ledger invoice', 'INV'),
      supplier: data.text('ledger supplier', 'supplier'),
      purchase_order: data.text('ledger purchase order', 'PO'),
      currency: 'USD',
      total: data.integer('ledger total', 1, 1000),
    },
    validationRules: { version: '1.0.0', amount_tolerance: 0.01 },
    comparisonPolicy: { version: '1.0.0', amount_tolerance: 0.01 },
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
      usage: { inputTokens: 9, outputTokens: 6, totalTokens: 15 },
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
