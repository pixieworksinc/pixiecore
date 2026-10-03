/**
 * Defines data policy contracts shared across PixieCore boundaries.
 */

import type { JsonValue } from '../types/index.js';

/**
 * Defines the supported data policy stage values.
 */
export type DataPolicyStage = 'input' | 'output';
/**
 * Defines the supported data policy disposition values.
 */
export type DataPolicyDisposition = 'retain' | 'discard' | 'deny';

/**
 * Describes the data policy pii field contract.
 */
export interface DataPolicyPiiField {
  readonly path: string;
  readonly category: string;
}

/**
 * Describes the data policy evaluation request contract.
 */
export interface DataPolicyEvaluationRequest {
  readonly tenant_id: string;
  readonly stage: DataPolicyStage;
  readonly blueprint_id: string;
  readonly blueprint_version: string;
  readonly classification: string;
  readonly field_paths: readonly string[];
  readonly pii: readonly DataPolicyPiiField[];
}

/**
 * Describes the data policy decision contract.
 */
export interface DataPolicyDecision {
  readonly policy_id: string;
  readonly policy_version: string;
  readonly disposition: DataPolicyDisposition;
  readonly redact_paths?: readonly string[];
  readonly retention_seconds?: number;
  readonly reason_codes: readonly string[];
}

/**
 * Defines the data policy boundary implemented by adapters.
 */
export interface DataPolicyPort {
  /**
   * Evaluates the supplied case and returns its structured score.
   */
  evaluate(
    request: DataPolicyEvaluationRequest,
  ): DataPolicyDecision | Promise<DataPolicyDecision>;
}

/**
 * Supplies the input required to create prepare data retention.
 */
export interface PrepareDataRetentionInput {
  readonly stage: DataPolicyStage;
  readonly blueprintId: string;
  readonly blueprintVersion: string;
  readonly classification: string;
  readonly pii?: readonly DataPolicyPiiField[];
  readonly payload: JsonValue;
}

/**
 * Records data retention evidence.
 */
export interface DataRetentionRecord {
  readonly schema: 'pixiecore.data-retention-record/v1';
  readonly record_id: string;
  readonly tenant_id: string;
  readonly stage: DataPolicyStage;
  readonly blueprint_id: string;
  readonly blueprint_version: string;
  readonly classification: string;
  readonly pii_categories: readonly string[];
  readonly policy_id: string;
  readonly policy_version: string;
  readonly disposition: 'retain' | 'discard';
  readonly created_at: string;
  readonly expires_at: string | null;
  readonly redacted_paths: readonly string[];
  readonly reason_codes: readonly string[];
  readonly payload: JsonValue | null;
}

/**
 * Configures data policy boundary behavior.
 */
export interface DataPolicyBoundaryOptions {
  readonly tenantId: string;
  readonly policy: DataPolicyPort;
  /** Supplies the clock used to create and evaluate retention records. */
  readonly now?: () => Date;
  /** Creates an opaque identifier for a newly prepared retention record. */
  readonly createRecordId?: () => string;
}
