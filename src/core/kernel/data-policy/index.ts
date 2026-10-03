/**
 * Coordinates data policy responsibilities inside the PixieCore kernel.
 */

import { PixieCoreError } from '../../contracts/errors/index.js';
import type {
  DataPolicyBoundaryOptions,
  DataPolicyDecision,
  DataPolicyEvaluationRequest,
  DataPolicyPiiField,
  DataPolicyPort,
  DataRetentionRecord,
  PrepareDataRetentionInput,
} from '../../contracts/data-policy/index.js';
import type { JsonValue } from '../../contracts/types/index.js';
import { cloneFrozenJsonValue } from '../../component/json-artifact/index.js';
import { generateTraceId } from '../../../plugins/logging/logging.js';

export type {
  DataPolicyBoundaryOptions,
  DataPolicyDecision,
  DataPolicyDisposition,
  DataPolicyEvaluationRequest,
  DataPolicyPiiField,
  DataPolicyPort,
  DataPolicyStage,
  DataRetentionRecord,
  PrepareDataRetentionInput,
} from '../../contracts/data-policy/index.js';

export const DATA_RETENTION_RECORD_SCHEMA = 'pixiecore.data-retention-record/v1' as const;
const REDACTED = '[REDACTED]';

/**
 * Reports data policy contract failures.
 */
export class DataPolicyContractError extends PixieCoreError {
  /**
   * Creates a DataPolicyContractError with the supplied failure context.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'data_policy_contract_error', options);
  }
}

/**
 * Reports data policy denied failures.
 */
export class DataPolicyDeniedError extends PixieCoreError {
  readonly reasonCodes: readonly string[];

  /**
   * Creates a DataPolicyDeniedError with the supplied failure context.
   */
  constructor(reasonCodes: readonly string[]) {
    super('Data retention denied by policy', 'data_policy_denied');
    this.reasonCodes = Object.freeze([...reasonCodes]);
  }
}

/**
 * Reports tenant isolation failures.
 */
export class TenantIsolationError extends PixieCoreError {
  /**
   * Creates a TenantIsolationError with the supplied failure context.
   */
  constructor() {
    super('Data retention record belongs to another tenant', 'tenant_isolation_error');
  }
}

/**
 * Reports data retention expired failures.
 */
export class DataRetentionExpiredError extends PixieCoreError {
  /**
   * Creates a DataRetentionExpiredError with the supplied failure context.
   */
  constructor() {
    super('Data retention record has expired', 'data_retention_expired');
  }
}

/**
 * Encapsulates data policy boundary behavior and lifecycle.
 */
export class DataPolicyBoundary {
  readonly tenantId: string;
  private readonly policy: DataPolicyPort;
  private readonly now: () => Date;
  private readonly createRecordId: () => string;

  /**
   * Creates a DataPolicyBoundary and establishes its initial state.
   */
  constructor(options: DataPolicyBoundaryOptions) {
    this.tenantId = nonBlank(options.tenantId, 'tenantId');
    if (!options.policy || typeof options.policy.evaluate !== 'function') {
      throw new DataPolicyContractError('policy must implement evaluate(request)');
    }
    this.policy = options.policy;
    this.now = options.now ?? (() => new Date());
    this.createRecordId = options.createRecordId ?? generateTraceId;
  }

  /**
   * Prepares retention according to the DataPolicyBoundary contract.
   */
  async prepareRetention(input: PrepareDataRetentionInput): Promise<DataRetentionRecord> {
    validateInput(input);
    const payload = cloneFrozenJsonValue(
      input.payload,
      'payload',
      message => new DataPolicyContractError(message),
    );
    const fieldPaths = Object.freeze(collectJsonPointers(payload));
    const pii = validatePii(input.pii ?? [], new Set(fieldPaths));
    const request: DataPolicyEvaluationRequest = Object.freeze({
      tenant_id: this.tenantId,
      stage: input.stage,
      blueprint_id: input.blueprintId,
      blueprint_version: input.blueprintVersion,
      classification: input.classification,
      field_paths: fieldPaths,
      pii,
    });
    const decision = validateDecision(await this.policy.evaluate(request), new Set(fieldPaths));
    if (decision.disposition === 'deny') throw new DataPolicyDeniedError(decision.reason_codes);

    const now = validNow(this.now());
    const retained = decision.disposition === 'retain';
    const redactedPaths = retained ? decision.redact_paths ?? [] : [];
    const recordPayload = retained ? redactPayload(payload, redactedPaths) : null;
    const expiresAt = retained
      ? expiration(now, decision.retention_seconds!)
      : null;
    return Object.freeze({
      schema: DATA_RETENTION_RECORD_SCHEMA,
      record_id: nonBlank(this.createRecordId(), 'record ID'),
      tenant_id: this.tenantId,
      stage: input.stage,
      blueprint_id: input.blueprintId,
      blueprint_version: input.blueprintVersion,
      classification: input.classification,
      pii_categories: Object.freeze([...new Set(pii.map(field => field.category))].sort()),
      policy_id: decision.policy_id,
      policy_version: decision.policy_version,
      disposition: decision.disposition,
      created_at: now.toISOString(),
      expires_at: expiresAt,
      redacted_paths: Object.freeze([...redactedPaths]),
      reason_codes: Object.freeze([...decision.reason_codes]),
      payload: recordPayload,
    });
  }

  /**
   * Loads payload and normalizes it for the DataPolicyBoundary.
   */
  readPayload(record: DataRetentionRecord): JsonValue | null {
    validateRecordIdentity(record);
    if (record.tenant_id !== this.tenantId) throw new TenantIsolationError();
    validateRecordContract(record);
    if (record.expires_at !== null && validNow(this.now()).getTime() >= Date.parse(record.expires_at)) {
      throw new DataRetentionExpiredError();
    }
    if (record.disposition === 'discard') return null;
    return cloneFrozenJsonValue(
      record.payload,
      'record.payload',
      message => new DataPolicyContractError(message),
    );
  }
}

/**
 * Creates discard data policy after validating the supplied contract.
 */
export function createDiscardDataPolicy(
  policyId = 'pixiecore.discard',
  policyVersion = '1.0.0',
): DataPolicyPort {
  const id = nonBlank(policyId, 'policyId');
  const version = nonBlank(policyVersion, 'policyVersion');
  return Object.freeze({
    /**
     * Implements the evaluate operation for the enclosing service contract.
     */
    evaluate(): DataPolicyDecision {
      return Object.freeze({
        policy_id: id,
        policy_version: version,
        disposition: 'discard',
        reason_codes: Object.freeze(['default_discard']),
      });
    },
  });
}

function validateInput(input: PrepareDataRetentionInput): void {
  if (input.stage !== 'input' && input.stage !== 'output') {
    throw new DataPolicyContractError('stage must be input or output');
  }
  nonBlank(input.blueprintId, 'blueprintId');
  nonBlank(input.blueprintVersion, 'blueprintVersion');
  nonBlank(input.classification, 'classification');
}

function validatePii(
  fields: readonly DataPolicyPiiField[],
  fieldPaths: ReadonlySet<string>,
): readonly DataPolicyPiiField[] {
  if (!Array.isArray(fields)) throw new DataPolicyContractError('pii must be an array');
  const seen = new Set<string>();
  const validated = fields.map((field, index) => {
    const path = validPointer(field.path, `pii[${index}].path`);
    const category = nonBlank(field.category, `pii[${index}].category`);
    if (!fieldPaths.has(path)) throw new DataPolicyContractError(`PII path does not exist: ${path}`);
    const key = `${path}\u0000${category}`;
    if (seen.has(key)) throw new DataPolicyContractError(`Duplicate PII declaration: ${path}/${category}`);
    seen.add(key);
    return Object.freeze({ path, category });
  });
  return Object.freeze(validated.sort((left, right) => (
    left.path.localeCompare(right.path) || left.category.localeCompare(right.category)
  )));
}

function validateDecision(
  candidate: DataPolicyDecision,
  fieldPaths: ReadonlySet<string>,
): Readonly<DataPolicyDecision> {
  if (!candidate || typeof candidate !== 'object') {
    throw new DataPolicyContractError('Policy decision must be an object');
  }
  const policyId = nonBlank(candidate.policy_id, 'decision.policy_id');
  const policyVersion = nonBlank(candidate.policy_version, 'decision.policy_version');
  if (!['retain', 'discard', 'deny'].includes(candidate.disposition)) {
    throw new DataPolicyContractError('decision.disposition must be retain, discard, or deny');
  }
  const reasonCodes = uniqueNonBlank(candidate.reason_codes, 'decision.reason_codes');
  const redactPaths = uniquePointers(candidate.redact_paths ?? [], fieldPaths);
  validateRetentionDecision(candidate, redactPaths);
  return Object.freeze({
    policy_id: policyId,
    policy_version: policyVersion,
    disposition: candidate.disposition,
    ...(redactPaths.length === 0 ? {} : { redact_paths: Object.freeze(redactPaths) }),
    ...(candidate.retention_seconds === undefined
      ? {}
      : { retention_seconds: candidate.retention_seconds }),
    reason_codes: Object.freeze(reasonCodes),
  });
}

function validateRetentionDecision(
  candidate: DataPolicyDecision,
  redactPaths: readonly string[],
): void {
  if (
    candidate.disposition !== 'retain'
    && (candidate.retention_seconds !== undefined || redactPaths.length !== 0)
  ) {
    throw new DataPolicyContractError('Only a retain decision may set retention or redaction');
  }
  if (candidate.disposition !== 'retain') return;
  if (Number.isSafeInteger(candidate.retention_seconds) && candidate.retention_seconds! >= 1) return;
  throw new DataPolicyContractError('Retain decision requires positive retention_seconds');
}

function validateRecordIdentity(record: DataRetentionRecord): void {
  if (!record || typeof record !== 'object' || record.schema !== DATA_RETENTION_RECORD_SCHEMA) {
    throw new DataPolicyContractError('Unsupported data retention record');
  }
  nonBlank(record.record_id, 'record.record_id');
  nonBlank(record.tenant_id, 'record.tenant_id');
}

function validateRecordContract(record: DataRetentionRecord): void {
  if (record.stage !== 'input' && record.stage !== 'output') {
    throw new DataPolicyContractError('record.stage must be input or output');
  }
  nonBlank(record.blueprint_id, 'record.blueprint_id');
  nonBlank(record.blueprint_version, 'record.blueprint_version');
  nonBlank(record.classification, 'record.classification');
  nonBlank(record.policy_id, 'record.policy_id');
  nonBlank(record.policy_version, 'record.policy_version');
  if (!isTimestamp(record.created_at)) {
    throw new DataPolicyContractError('record.created_at must be an RFC 3339 UTC timestamp');
  }
  uniqueNonBlank(record.pii_categories, 'record.pii_categories', true);
  uniqueNonBlank(record.reason_codes, 'record.reason_codes');
  uniquePointers(record.redacted_paths, new Set(collectJsonPointers(record.payload)));
  if (record.disposition === 'discard') {
    if (record.expires_at !== null || record.payload !== null || record.redacted_paths.length !== 0) {
      throw new DataPolicyContractError('Discarded record must not retain payload, expiry, or redaction paths');
    }
    return;
  }
  if (record.disposition !== 'retain') {
    throw new DataPolicyContractError('record.disposition must be retain or discard');
  }
  if (record.expires_at === null || !isTimestamp(record.expires_at)) {
    throw new DataPolicyContractError('Retained record requires an RFC 3339 UTC expires_at');
  }
  if (Date.parse(record.expires_at) <= Date.parse(record.created_at)) {
    throw new DataPolicyContractError('record.expires_at must be after record.created_at');
  }
}

function collectJsonPointers(value: JsonValue, path = ''): string[] {
  const pointers = [path];
  if (Array.isArray(value)) {
    value.forEach((item, index) => pointers.push(...collectJsonPointers(item, `${path}/${index}`)));
  } else if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value).sort()) {
      pointers.push(...collectJsonPointers(value[key]!, `${path}/${escapePointer(key)}`));
    }
  }
  return pointers;
}

function redactPayload(payload: JsonValue, paths: readonly string[]): JsonValue {
  let redacted = payload;
  for (const path of paths) redacted = replaceAtPointer(redacted, pointerTokens(path), REDACTED);
  return cloneFrozenJsonValue(
    redacted,
    'redacted payload',
    message => new DataPolicyContractError(message),
  );
}

function replaceAtPointer(value: JsonValue, tokens: readonly string[], replacement: JsonValue): JsonValue {
  if (tokens.length === 0) return replacement;
  const [head, ...tail] = tokens;
  if (Array.isArray(value)) {
    const index = Number(head);
    return value.map((item, itemIndex) => (
      itemIndex === index ? replaceAtPointer(item, tail, replacement) : item
    ));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      key === head ? replaceAtPointer(item, tail, replacement) : item,
    ]));
  }
  throw new DataPolicyContractError('Redaction path does not resolve to a value');
}

function uniquePointers(paths: readonly string[], available: ReadonlySet<string>): string[] {
  if (!Array.isArray(paths)) throw new DataPolicyContractError('Redaction paths must be an array');
  const unique = [...new Set(paths.map((path, index) => validPointer(path, `redact_paths[${index}]`)))].sort();
  for (const path of unique) {
    if (!available.has(path)) throw new DataPolicyContractError(`Redaction path does not exist: ${path}`);
  }
  for (let index = 0; index < unique.length; index++) {
    const parent = unique[index]!;
    if (unique.slice(index + 1).some(path => parent === '' || path.startsWith(`${parent}/`))) {
      throw new DataPolicyContractError(`Redaction paths must not overlap: ${parent || '<root>'}`);
    }
  }
  return unique;
}

function uniqueNonBlank(values: readonly string[], label: string, allowEmpty = false): string[] {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0)) {
    throw new DataPolicyContractError(`${label} must contain at least one non-blank value`);
  }
  const normalized = values.map((value, index) => nonBlank(value, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new DataPolicyContractError(`${label} must not contain duplicates`);
  }
  return [...normalized].sort();
}

function validPointer(value: string, label: string): string {
  if (typeof value !== 'string' || (value !== '' && !/^\/(?:[^~/]|~[01])*(?:\/(?:[^~/]|~[01])*)*$/u.test(value))) {
    throw new DataPolicyContractError(`${label} must be a valid JSON Pointer`);
  }
  return value;
}

function pointerTokens(pointer: string): string[] {
  if (pointer === '') return [];
  return pointer.slice(1).split('/').map(token => token.replace(/~1/gu, '/').replace(/~0/gu, '~'));
}

function escapePointer(value: string): string {
  return value.replace(/~/gu, '~0').replace(/\//gu, '~1');
}

function expiration(createdAt: Date, retentionSeconds: number): string {
  const expires = createdAt.getTime() + retentionSeconds * 1000;
  if (!Number.isSafeInteger(expires)) throw new DataPolicyContractError('Retention expiry exceeds safe timestamp range');
  const value = new Date(expires);
  if (Number.isNaN(value.getTime())) throw new DataPolicyContractError('Retention expiry is invalid');
  return value.toISOString();
}

function validNow(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new DataPolicyContractError('now() must return a valid Date');
  }
  return value;
}

function nonBlank(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new DataPolicyContractError(`${label} must be non-blank`);
  return value;
}

function isTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    && !Number.isNaN(Date.parse(value));
}
