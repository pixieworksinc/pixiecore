import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { createReviewHandoff, createReviewReceipt } from '../../src/core/kernel/review/index.js';
import { testData } from '../helpers/test-data.js';

const data = testData('human review schemas');
const handoffSchema = JSON.parse(await readFile(fileURLToPath(new URL(
  '../../schemas/pixiecore.review-handoff-v1.schema.json', import.meta.url,
)), 'utf8')) as object;
const receiptSchema = JSON.parse(await readFile(fileURLToPath(new URL(
  '../../schemas/pixiecore.review-receipt-v1.schema.json', import.meta.url,
)), 'utf8')) as object;
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateHandoff = ajv.compile(handoffSchema);
const validateReceipt = ajv.compile(receiptSchema);

function artifacts() {
  const handoff = createReviewHandoff({
    reviewId: data.text('schema review ID'),
    traceId: data.text('schema trace ID'),
    createdAt: data.date('schema created at').toISOString(),
    blueprint: { name: data.text('schema blueprint'), version: '1.0', role: 'validator' },
    output: { valid: true },
    issues: [],
  });
  return {
    handoff,
    receipt: createReviewReceipt(handoff, {
      decision: 'changes_requested',
      reviewerId: data.person('schema reviewer'),
      decidedAt: data.date('schema decided at').toISOString(),
      comment: data.text('schema comment'),
    }),
  };
}

test('published review schemas accept artifacts created by the public helpers', () => {
  const { handoff, receipt } = artifacts();
  assert.equal(validateHandoff(handoff), true, JSON.stringify(validateHandoff.errors));
  assert.equal(validateReceipt(receipt), true, JSON.stringify(validateReceipt.errors));
});

test('published review schemas reject malformed or extended artifacts', () => {
  const { handoff, receipt } = artifacts();
  const invalidHandoffs = [
    { ...handoff, schema: 'pixiecore.review-handoff/v2' },
    { ...handoff, review_id: ' ' },
    { ...handoff, created_at: '2026-02-04' },
    { ...handoff, blueprint: { ...handoff.blueprint, unexpected: true } },
    { ...handoff, output: [] },
    { ...handoff, unexpected: true },
  ];
  for (const candidate of invalidHandoffs) assert.equal(validateHandoff(candidate), false);

  const invalidReceipts = [
    { ...receipt, schema: 'pixiecore.review-receipt/v2' },
    { ...receipt, decision: 'pending' },
    { ...receipt, handoff_digest: 'sha256:invalid' },
    { ...receipt, reviewer_id: '' },
    { ...receipt, reviewed_output: [] },
    { ...receipt, unexpected: true },
  ];
  for (const candidate of invalidReceipts) assert.equal(validateReceipt(candidate), false);
});
