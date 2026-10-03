/**
 * Coordinates audit responsibilities inside the PixieCore kernel.
 */

import { signDistributionValue, verifyDistributionValue } from '../../component/distribution-signature/index.js';
import type { AuditEventOutcome, AuditExportEvent, AuditExportSignature, CreateSignedAuditExportInput, SignedAuditExport } from '../../contracts/audit/index.js';
import { PixieCoreError } from '../../contracts/errors/index.js';

export type { AuditEventOutcome, AuditExportEvent, AuditExportSignature, CreateSignedAuditExportInput, SignedAuditExport } from '../../contracts/audit/index.js';
export const SIGNED_AUDIT_EXPORT_SCHEMA = 'pixiecore.signed-audit-export/v1' as const;
const OUTCOMES = new Set<AuditEventOutcome>(['succeeded', 'failed', 'cancelled', 'denied']);

/**
 * Reports audit export contract failures.
 */
export class AuditExportContractError extends PixieCoreError {
  /**
   * Creates a AuditExportContractError with the supplied failure context.
   */
  constructor(message: string, options?: ErrorOptions) { super(message, 'audit_export_contract_error', options); }
}

/**
 * Creates signed audit export after validating the supplied contract.
 */
export async function createSignedAuditExport(input: CreateSignedAuditExportInput, privateKeyPath: string): Promise<SignedAuditExport> {
  const unsigned = Object.freeze({ schema: SIGNED_AUDIT_EXPORT_SCHEMA, export_id: nonBlank(input.exportId, 'exportId'), created_at: timestamp(input.createdAt, 'createdAt'), events: validateEvents(input.events) });
  try {
    const signature = await signDistributionValue(unsigned, nonBlank(privateKeyPath, 'privateKeyPath'), 'audit export');
    return Object.freeze({ ...unsigned, signature: Object.freeze({ algorithm: signature.algorithm, key_id: signature.keyId, value: signature.value }) });
  } catch (cause) {
    if (cause instanceof AuditExportContractError) throw cause;
    throw new AuditExportContractError('Audit export could not be signed', { cause });
  }
}

/**
 * Validates signed audit export and rejects unsupported input.
 */
export async function verifySignedAuditExport(artifact: SignedAuditExport, publicKeyPath: string): Promise<boolean> {
  try {
    const unsigned = Object.freeze({ schema: artifact.schema, export_id: nonBlank(artifact.export_id, 'artifact.export_id'), created_at: timestamp(artifact.created_at, 'artifact.created_at'), events: validateEvents(artifact.events) });
    if (artifact.schema !== SIGNED_AUDIT_EXPORT_SCHEMA || artifact.signature?.algorithm !== 'Ed25519') return false;
    return await verifyDistributionValue(unsigned, { algorithm: 'Ed25519', keyId: artifact.signature.key_id, value: artifact.signature.value }, { publicKeyPath, requireSignature: true, label: 'audit export' }) === 'verified';
  } catch { return false; }
}

function validateEvents(events: readonly AuditExportEvent[]): readonly AuditExportEvent[] {
  if (!Array.isArray(events) || events.length === 0) throw new AuditExportContractError('events must contain at least one event');
  return Object.freeze(events.map((item, index) => {
    if (!item || typeof item !== 'object' || !OUTCOMES.has(item.outcome)) throw new AuditExportContractError(`events[${index}] is invalid`);
    return Object.freeze({ timestamp: timestamp(item.timestamp, `events[${index}].timestamp`), trace_id: nonBlank(item.trace_id, `events[${index}].trace_id`), source: nonBlank(item.source, `events[${index}].source`), event: nonBlank(item.event, `events[${index}].event`), outcome: item.outcome, ...(item.error_code === undefined ? {} : { error_code: nonBlank(item.error_code, `events[${index}].error_code`) }) });
  }));
}
function timestamp(value: string, label: string): string { const parsed = new Date(value); if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) throw new AuditExportContractError(`${label} must be a canonical UTC timestamp`); return value; }
function nonBlank(value: string, label: string): string { if (typeof value !== 'string' || !value.trim()) throw new AuditExportContractError(`${label} must be non-blank`); return value; }
