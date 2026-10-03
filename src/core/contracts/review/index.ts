/**
 * Defines review contracts shared across PixieCore boundaries.
 */

import type { JsonObject } from '../types/index.js';

/**
 * Defines the supported review decision values.
 */
export type ReviewDecision = 'approved' | 'rejected' | 'changes_requested';
/**
 * Defines the supported review issue severity values.
 */
export type ReviewIssueSeverity = 'info' | 'warning' | 'error';

/**
 * Describes the review blueprint reference contract.
 */
export interface ReviewBlueprintReference {
  readonly name: string;
  readonly version: string;
  readonly role?: string;
}

/**
 * Describes the review issue contract.
 */
export interface ReviewIssue {
  readonly code: string;
  readonly message: string;
  readonly severity: ReviewIssueSeverity;
  readonly path?: string;
}

/**
 * Describes the human review handoff contract.
 */
export interface HumanReviewHandoff {
  readonly schema: 'pixiecore.review-handoff/v1';
  readonly review_id: string;
  readonly trace_id: string;
  readonly created_at: string;
  readonly blueprint: ReviewBlueprintReference;
  readonly output: JsonObject;
  readonly issues?: readonly ReviewIssue[];
  readonly metadata?: JsonObject;
}

/**
 * Describes the human review receipt contract.
 */
export interface HumanReviewReceipt {
  readonly schema: 'pixiecore.review-receipt/v1';
  readonly review_id: string;
  readonly trace_id: string;
  readonly handoff_digest: string;
  readonly decision: ReviewDecision;
  readonly reviewer_id: string;
  readonly decided_at: string;
  readonly comment?: string;
  readonly reviewed_output?: JsonObject;
  readonly metadata?: JsonObject;
}

/**
 * Supplies the input required to create create review handoff.
 */
export interface CreateReviewHandoffInput {
  readonly reviewId: string;
  readonly traceId: string;
  readonly createdAt: string;
  readonly blueprint: ReviewBlueprintReference;
  readonly output: JsonObject;
  readonly issues?: readonly ReviewIssue[];
  readonly metadata?: JsonObject;
}

/**
 * Supplies the input required to create create review receipt.
 */
export interface CreateReviewReceiptInput {
  readonly decision: ReviewDecision;
  readonly reviewerId: string;
  readonly decidedAt: string;
  readonly comment?: string;
  readonly reviewedOutput?: JsonObject;
  readonly metadata?: JsonObject;
}
