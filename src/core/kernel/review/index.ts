/**
 * Coordinates review responsibilities inside the PixieCore kernel.
 */

import { createHash } from 'node:crypto';
import {
  canonicalJson,
  cloneFrozenJsonObject,
} from '../../component/json-artifact/index.js';
import { PixieCoreError } from '../../contracts/errors/index.js';
import type {
  CreateReviewHandoffInput,
  CreateReviewReceiptInput,
  HumanReviewHandoff,
  HumanReviewReceipt,
  ReviewBlueprintReference,
  ReviewDecision,
  ReviewIssue,
} from '../../contracts/review/index.js';
import type { JsonObject } from '../../contracts/types/index.js';

export const REVIEW_HANDOFF_SCHEMA = 'pixiecore.review-handoff/v1' as const;
export const REVIEW_RECEIPT_SCHEMA = 'pixiecore.review-receipt/v1' as const;

const REVIEW_DECISIONS = new Set<ReviewDecision>([
  'approved',
  'rejected',
  'changes_requested',
]);
const REVIEW_ISSUE_SEVERITIES = new Set(['info', 'warning', 'error']);
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Reports review contract failures.
 */
export class ReviewContractError extends PixieCoreError {
  /**
   * Creates a ReviewContractError with the supplied failure context.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'review_contract_error', options);
  }
}

/**
 * Creates review handoff after validating the supplied contract.
 */
export function createReviewHandoff(input: CreateReviewHandoffInput): HumanReviewHandoff {
  const blueprint = cloneBlueprintReference(input.blueprint);
  const issues = input.issues?.map((issue, index) => cloneIssue(issue, index));
  const handoff: HumanReviewHandoff = {
    schema: REVIEW_HANDOFF_SCHEMA,
    review_id: nonBlank(input.reviewId, 'reviewId'),
    trace_id: nonBlank(input.traceId, 'traceId'),
    created_at: canonicalTimestamp(input.createdAt, 'createdAt'),
    blueprint,
    output: cloneJsonObject(input.output, 'output'),
    ...(issues === undefined ? {} : { issues }),
    ...(input.metadata === undefined
      ? {}
      : { metadata: cloneJsonObject(input.metadata, 'metadata') }),
  };
  return deepFreeze(handoff);
}

/**
 * Creates review receipt after validating the supplied contract.
 */
export function createReviewReceipt(
  handoff: HumanReviewHandoff,
  input: CreateReviewReceiptInput,
): HumanReviewReceipt {
  assertHandoffIdentity(handoff);
  if (!REVIEW_DECISIONS.has(input.decision)) {
    throw new ReviewContractError(`decision must be one of ${[...REVIEW_DECISIONS].join(', ')}`);
  }

  const receipt: HumanReviewReceipt = {
    schema: REVIEW_RECEIPT_SCHEMA,
    review_id: handoff.review_id,
    trace_id: handoff.trace_id,
    handoff_digest: reviewHandoffDigest(handoff),
    decision: input.decision,
    reviewer_id: nonBlank(input.reviewerId, 'reviewerId'),
    decided_at: canonicalTimestamp(input.decidedAt, 'decidedAt'),
    ...(input.comment === undefined ? {} : { comment: nonBlank(input.comment, 'comment') }),
    ...(input.reviewedOutput === undefined
      ? {}
      : { reviewed_output: cloneJsonObject(input.reviewedOutput, 'reviewedOutput') }),
    ...(input.metadata === undefined
      ? {}
      : { metadata: cloneJsonObject(input.metadata, 'metadata') }),
  };
  return deepFreeze(receipt);
}

/**
 * Handles review handoff digest for the owning PixieCore boundary.
 */
export function reviewHandoffDigest(handoff: HumanReviewHandoff): string {
  assertHandoffIdentity(handoff);
  try {
    return `sha256:${createHash('sha256').update(canonicalJson(handoff)).digest('hex')}`;
  } catch (error) {
    throw new ReviewContractError('handoff must contain only JSON values', { cause: error });
  }
}

/**
 * Validates review receipt and rejects unsupported input.
 */
export function verifyReviewReceipt(
  handoff: HumanReviewHandoff,
  receipt: HumanReviewReceipt,
): boolean {
  try {
    return receipt.schema === REVIEW_RECEIPT_SCHEMA
      && receipt.review_id === handoff.review_id
      && receipt.trace_id === handoff.trace_id
      && receipt.handoff_digest === reviewHandoffDigest(handoff);
  } catch {
    return false;
  }
}

export type {
  CreateReviewHandoffInput,
  CreateReviewReceiptInput,
  HumanReviewHandoff,
  HumanReviewReceipt,
  ReviewBlueprintReference,
  ReviewDecision,
  ReviewIssue,
  ReviewIssueSeverity,
} from '../../contracts/review/index.js';

function cloneBlueprintReference(reference: ReviewBlueprintReference): ReviewBlueprintReference {
  return Object.freeze({
    name: nonBlank(reference.name, 'blueprint.name'),
    version: nonBlank(reference.version, 'blueprint.version'),
    ...(reference.role === undefined ? {} : { role: nonBlank(reference.role, 'blueprint.role') }),
  });
}

function cloneIssue(issue: ReviewIssue, index: number): ReviewIssue {
  if (!REVIEW_ISSUE_SEVERITIES.has(issue.severity)) {
    throw new ReviewContractError(
      `issues[${index}].severity must be one of ${[...REVIEW_ISSUE_SEVERITIES].join(', ')}`,
    );
  }
  return Object.freeze({
    code: nonBlank(issue.code, `issues[${index}].code`),
    message: nonBlank(issue.message, `issues[${index}].message`),
    severity: issue.severity,
    ...(issue.path === undefined ? {} : { path: jsonPointer(issue.path, `issues[${index}].path`) }),
  });
}

function assertHandoffIdentity(handoff: HumanReviewHandoff): void {
  if (handoff.schema !== REVIEW_HANDOFF_SCHEMA) {
    throw new ReviewContractError(`handoff.schema must be ${REVIEW_HANDOFF_SCHEMA}`);
  }
  nonBlank(handoff.review_id, 'handoff.review_id');
  nonBlank(handoff.trace_id, 'handoff.trace_id');
}

function nonBlank(value: string, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ReviewContractError(`${path} must be a non-blank string`);
  }
  return value;
}

function canonicalTimestamp(value: string, path: string): string {
  nonBlank(value, path);
  const parsed = new Date(value);
  if (
    !CANONICAL_TIMESTAMP.test(value)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString() !== value
  ) {
    throw new ReviewContractError(`${path} must be a canonical UTC ISO 8601 timestamp`);
  }
  return value;
}

function jsonPointer(value: string, path: string): string {
  if (!/^(?:\/(?:[^~/]|~[01])*)*$/.test(value)) {
    throw new ReviewContractError(`${path} must be an RFC 6901 JSON Pointer`);
  }
  return value;
}

function cloneJsonObject(value: JsonObject, path: string): JsonObject {
  return cloneFrozenJsonObject(
    value,
    path,
    message => new ReviewContractError(message),
  ) as JsonObject;
}

function deepFreeze<Value extends object>(value: Value): Value {
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === 'object' && !Object.isFrozen(nested)) deepFreeze(nested);
  }
  return Object.freeze(value);
}
