/**
 * Defines audit contracts shared across PixieCore boundaries.
 */

/**
 * Defines the supported audit event outcome values.
 */
export type AuditEventOutcome = 'succeeded' | 'failed' | 'cancelled' | 'denied';
/**
 * Describes a audit export event.
 */
export interface AuditExportEvent { readonly timestamp: string; readonly trace_id: string; readonly source: string; readonly event: string; readonly outcome: AuditEventOutcome; readonly error_code?: string }
/**
 * Describes the audit export signature contract.
 */
export interface AuditExportSignature { readonly algorithm: 'Ed25519'; readonly key_id: string; readonly value: string }
/**
 * Describes the signed audit export contract.
 */
export interface SignedAuditExport { readonly schema: 'pixiecore.signed-audit-export/v1'; readonly export_id: string; readonly created_at: string; readonly events: readonly AuditExportEvent[]; readonly signature: AuditExportSignature }
/**
 * Supplies the input required to create create signed audit export.
 */
export interface CreateSignedAuditExportInput { readonly exportId: string; readonly createdAt: string; readonly events: readonly AuditExportEvent[] }
