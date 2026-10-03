import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createReviewHandoff,
  createReviewReceipt,
  ReviewContractError,
  reviewHandoffDigest,
  verifyReviewReceipt,
} from '../../src/core/kernel/review/index.js';
import type { HumanReviewHandoff } from '../../src/core/kernel/review/index.js';
import { testData } from '../helpers/test-data.js';

const data = testData('human review contract');

function handoff() {
  return createReviewHandoff({
    reviewId: data.text('review ID', 'review'),
    traceId: data.text('trace ID', 'trace'),
    createdAt: data.date('created at').toISOString(),
    blueprint: {
      name: data.text('blueprint name', 'blueprint'),
      version: '1.0',
      role: 'extractor',
    },
    output: { invoice_number: data.text('invoice number', 'invoice') },
    issues: [{
      code: data.text('issue code', 'uncertain_field'),
      message: data.text('issue message', 'Check field'),
      severity: 'warning',
      path: '/invoice_number',
    }],
    metadata: { source: data.text('source', 'upload') },
  });
}

test('review handoffs clone and freeze caller-owned JSON values', () => {
  const output = { nested: { value: data.text('nested output') } };
  const metadata = { page: data.integer('page', 1, 40) };
  const result = createReviewHandoff({
    reviewId: data.text('immutable review ID'),
    traceId: data.text('immutable trace ID'),
    createdAt: data.date('immutable created at').toISOString(),
    blueprint: { name: data.text('immutable blueprint'), version: '1.0' },
    output,
    metadata,
  });

  output.nested.value = data.text('caller mutation');
  metadata.page += 1;
  assert.notEqual((result.output.nested as { value: string }).value, output.nested.value);
  assert.notEqual(result.metadata?.page, metadata.page);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.output), true);
  assert.equal(Object.isFrozen(result.output.nested), true);
});

test('review receipts bind the decision to the exact handoff', () => {
  const original = handoff();
  const receipt = createReviewReceipt(original, {
    decision: 'approved',
    reviewerId: data.person('reviewer'),
    decidedAt: data.date('decided at').toISOString(),
    comment: data.text('comment', 'Approved'),
    reviewedOutput: { invoice_number: data.text('corrected invoice', 'invoice') },
  });

  assert.equal(receipt.review_id, original.review_id);
  assert.equal(receipt.trace_id, original.trace_id);
  assert.equal(receipt.handoff_digest, reviewHandoffDigest(original));
  assert.equal(verifyReviewReceipt(original, receipt), true);

  const altered = {
    ...original,
    output: { invoice_number: data.text('altered invoice', 'invoice') },
  } satisfies HumanReviewHandoff;
  assert.equal(verifyReviewReceipt(altered, receipt), false);
  assert.equal(verifyReviewReceipt(original, { ...receipt, trace_id: data.text('wrong trace') }), false);
});

test('handoff digest is stable across object property order', () => {
  const original = handoff();
  const reordered = {
    output: original.output,
    blueprint: original.blueprint,
    created_at: original.created_at,
    trace_id: original.trace_id,
    review_id: original.review_id,
    schema: original.schema,
    ...(original.metadata === undefined ? {} : { metadata: original.metadata }),
    ...(original.issues === undefined ? {} : { issues: original.issues }),
  } satisfies HumanReviewHandoff;
  assert.equal(reviewHandoffDigest(reordered), reviewHandoffDigest(original));
});

test('review constructors reject ambiguous identities, timestamps, and JSON', () => {
  const base = {
    reviewId: data.text('invalid review ID'),
    traceId: data.text('invalid trace ID'),
    createdAt: data.date('invalid created at').toISOString(),
    blueprint: { name: data.text('invalid blueprint'), version: '1.0' },
    output: { value: data.text('valid output') },
  };
  const invalidHandoffs = [
    () => createReviewHandoff({ ...base, reviewId: '   ' }),
    () => createReviewHandoff({ ...base, createdAt: '2026-02-04' }),
    () => createReviewHandoff({ ...base, createdAt: '2026-02-31T00:00:00.000Z' }),
    () => createReviewHandoff({ ...base, blueprint: { ...base.blueprint, name: '' } }),
    () => createReviewHandoff({ ...base, output: { value: Number.NaN } }),
    () => createReviewHandoff({ ...base, output: { value: new Date() } as never }),
    () => createReviewHandoff({ ...base, issues: [{ code: 'x', message: 'x', severity: 'warning', path: 'not-a-pointer' }] }),
  ];
  for (const operation of invalidHandoffs) assert.throws(operation, ReviewContractError);

  const original = handoff();
  assert.throws(() => createReviewReceipt(original, {
    decision: 'unknown' as 'approved',
    reviewerId: data.person('invalid decision reviewer'),
    decidedAt: data.date('invalid decision time').toISOString(),
  }), ReviewContractError);
  assert.throws(() => createReviewReceipt(original, {
    decision: 'rejected',
    reviewerId: ' ',
    decidedAt: data.date('invalid reviewer time').toISOString(),
  }), ReviewContractError);
});
