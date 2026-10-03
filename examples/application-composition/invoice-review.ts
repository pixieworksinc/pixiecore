import { fileURLToPath } from 'node:url';
import { PromptRuntime, type RuntimeOptions } from '@pixieworks/pixiecore';
import {
  createApplicationSchemaBoundary,
  ApplicationNodeError,
  executeApplicationNode,
  type ApplicationMappingSource,
  type ApplicationNodeDefinition,
  type ApplicationSchemaBoundary,
  type ApplicationTrace,
  type ApplicationTraceRecorder,
  traceApplication,
} from '@pixieworks/pixiecore/application';

export type InvoiceReviewNodeId =
  | 'extract-invoice'
  | 'classify-invoice'
  | 'validate-invoice'
  | 'verify-invoice'
  | 'summarize-invoice-review';

export interface InvoiceReviewNodeDefinition extends ApplicationNodeDefinition {
  readonly id: InvoiceReviewNodeId;
  readonly blueprintPath: string;
  readonly blueprintVersion: '1.0.1';
}

export interface InvoiceReviewInput {
  readonly sourceText: string;
  readonly ledgerRecord: Readonly<Record<string, unknown>>;
  readonly validationRules: Readonly<Record<string, unknown>>;
  readonly comparisonPolicy: Readonly<Record<string, unknown>>;
}

export interface InvoiceExtraction {
  readonly invoice_number: string | null;
  readonly supplier: string | null;
  readonly purchase_order: string | null;
  readonly currency: string | null;
  readonly subtotal: number | null;
  readonly tax: number | null;
  readonly total: number | null;
}

export interface InvoiceClassification {
  readonly document_type: 'invoice' | 'credit_note' | 'other';
  readonly rationale: string;
}

export interface InvoiceValidation {
  readonly valid: boolean;
  readonly issues: readonly string[];
  readonly rules_version: string;
}

export interface InvoiceMismatch {
  readonly field: 'invoice_number' | 'supplier' | 'purchase_order' | 'currency' | 'total';
  readonly invoice_value: string | number;
  readonly ledger_value: string | number;
}

export interface InvoiceVerification {
  readonly status: 'matched' | 'mismatch';
  readonly mismatches: readonly InvoiceMismatch[];
  readonly policy_version: string;
}

export interface InvoiceReviewSummary {
  readonly recommendation: 'ready_for_human_review' | 'manual_review';
  readonly summary: string;
  readonly reason_codes: readonly string[];
}

export interface InvoiceReviewResult {
  readonly extraction: InvoiceExtraction;
  readonly classification: InvoiceClassification;
  readonly validation: InvoiceValidation;
  readonly verification: InvoiceVerification;
  readonly review: InvoiceReviewSummary;
}

export interface InvoiceReviewOptions {
  readonly runtimeOptions?: RuntimeOptions;
  readonly signal?: AbortSignal;
  readonly traceId?: string;
  readonly onTrace?: (trace: ApplicationTrace) => void;
}

export class InvoiceReviewNodeError extends ApplicationNodeError {
  constructor(
    node: InvoiceReviewNodeDefinition,
    inputs: Readonly<Record<string, unknown>>,
    cause: unknown,
  ) {
    super('Invoice review', node, Object.keys(inputs), cause, {
      code: 'INVOICE_REVIEW_NODE_FAILED',
      name: 'InvoiceReviewNodeError',
    });
  }
}

export class InvoiceReviewDomainError extends Error {
  readonly code = 'INVOICE_NOT_REVIEWABLE';

  constructor(readonly issueCodes: readonly string[]) {
    super('Invoice validation did not permit ledger verification');
    this.name = 'InvoiceReviewDomainError';
    this.issueCodes = Object.freeze([...issueCodes]);
  }
}

function blueprint(name: string): string {
  return fileURLToPath(new URL(`./invoice-review/blueprints/${name}.yaml`, import.meta.url));
}

export const INVOICE_REVIEW_NODES: readonly InvoiceReviewNodeDefinition[] = Object.freeze([
  defineNode('extract-invoice'),
  defineNode('classify-invoice'),
  defineNode('validate-invoice'),
  defineNode('verify-invoice'),
  defineNode('summarize-invoice-review'),
]);

/** Composes five side-effect-free invoice review Blueprints. */
export async function composeInvoiceReview(
  input: InvoiceReviewInput,
  options: InvoiceReviewOptions = {},
): Promise<InvoiceReviewResult> {
  return traceApplication({
    ...(options.traceId === undefined ? {} : { traceId: options.traceId }),
    ...(options.onTrace === undefined ? {} : { onTrace: options.onTrace }),
  }, recorder => composeInvoiceReviewTraced(input, options, recorder));
}

async function composeInvoiceReviewTraced(
  input: InvoiceReviewInput,
  options: InvoiceReviewOptions,
  recorder: ApplicationTraceRecorder,
): Promise<InvoiceReviewResult> {
  const sourceText = nonBlank(input.sourceText, 'sourceText');
  const boundary = await createApplicationSchemaBoundary(INVOICE_REVIEW_NODES);
  await using runtime = new PromptRuntime(options.runtimeOptions ?? {});

  const extraction = Object.freeze(await executeNode<InvoiceExtraction>(
    runtime,
    boundary,
    recorder,
    node('extract-invoice'),
    { source_text: sourceText },
    options.signal,
  ));
  const classification = Object.freeze(await executeNode<InvoiceClassification>(
    runtime,
    boundary,
    recorder,
    node('classify-invoice'),
    { fields: extraction },
    options.signal,
    [{ nodeId: 'extract-invoice', output: extraction }],
  ));
  const validation = freezeValidation(await executeNode<InvoiceValidation>(
    runtime,
    boundary,
    recorder,
    node('validate-invoice'),
    { fields: extraction, rules: input.validationRules },
    options.signal,
    [{ nodeId: 'extract-invoice', output: extraction }],
  ));
  if (!validation.valid) throw new InvoiceReviewDomainError(validation.issues);

  const verifiableInvoice = requireVerifiableInvoice(extraction);
  const verification = freezeVerification(await executeNode<InvoiceVerification>(
    runtime,
    boundary,
    recorder,
    node('verify-invoice'),
    {
      invoice: verifiableInvoice,
      ledger_record: input.ledgerRecord,
      policy: input.comparisonPolicy,
    },
    options.signal,
    [{ nodeId: 'extract-invoice', output: extraction }],
  ));
  const review = freezeReview(await executeNode<InvoiceReviewSummary>(
    runtime,
    boundary,
    recorder,
    node('summarize-invoice-review'),
    {
      invoice: extraction,
      classification: { document_type: classification.document_type },
      validation: { valid: validation.valid, issues: [...validation.issues] },
      verification: { status: verification.status, mismatches: verification.mismatches },
    },
    options.signal,
    [
      { nodeId: 'extract-invoice', output: extraction },
      { nodeId: 'classify-invoice', output: classification },
      { nodeId: 'validate-invoice', output: validation },
      { nodeId: 'verify-invoice', output: verification },
    ],
  ));

  return Object.freeze({ extraction, classification, validation, verification, review });
}

async function executeNode<T extends object>(
  runtime: PromptRuntime,
  boundary: ApplicationSchemaBoundary,
  recorder: ApplicationTraceRecorder,
  definition: InvoiceReviewNodeDefinition,
  inputs: Record<string, unknown>,
  signal: AbortSignal | undefined,
  sources: readonly ApplicationMappingSource[] = [],
): Promise<T> {
  const outcome = await executeApplicationNode({
    node: definition,
    policy: { failureMode: 'fail-fast', retryOwner: 'runtime' },
  }, () => recorder.runNode({
    node: definition,
    logger: runtime.logger,
    ...(signal === undefined ? {} : { signal }),
  }, async () => {
    try {
      signal?.throwIfAborted();
      const validatedInputs = boundary.validateMapping({
        targetNodeId: definition.id,
        inputs,
        sources,
      });
      return await runtime.execute(
        definition.blueprintPath,
        validatedInputs,
        signal === undefined ? {} : { signal },
      ) as T;
    } catch (cause) {
      throw new InvoiceReviewNodeError(definition, inputs, cause);
    }
  }));
  if (outcome.status === 'failed') throw outcome.error;
  return outcome.value;
}

function requireVerifiableInvoice(extraction: InvoiceExtraction): Record<string, unknown> {
  const required = ['invoice_number', 'supplier', 'purchase_order', 'currency', 'total'] as const;
  const missing = required.filter(field => extraction[field] === null);
  if (missing.length > 0) {
    throw new InvoiceReviewDomainError(missing.map(field => `missing_${field}`));
  }
  return Object.fromEntries(required.map(field => [field, extraction[field]]));
}

function node(id: InvoiceReviewNodeId): InvoiceReviewNodeDefinition {
  const definition = INVOICE_REVIEW_NODES.find(candidate => candidate.id === id);
  if (definition) return definition;
  throw new Error(`Unknown invoice review node: ${id}`);
}

function defineNode(id: InvoiceReviewNodeId): InvoiceReviewNodeDefinition {
  return Object.freeze({ id, blueprintPath: blueprint(id), blueprintVersion: '1.0.1' });
}

function freezeValidation(value: InvoiceValidation): InvoiceValidation {
  return Object.freeze({ ...value, issues: Object.freeze([...value.issues]) });
}

function freezeVerification(value: InvoiceVerification): InvoiceVerification {
  return Object.freeze({
    ...value,
    mismatches: Object.freeze(value.mismatches.map(item => Object.freeze({ ...item }))),
  });
}

function freezeReview(value: InvoiceReviewSummary): InvoiceReviewSummary {
  return Object.freeze({ ...value, reason_codes: Object.freeze([...value.reason_codes]) });
}

function nonBlank(value: string, name: string): string {
  if (value.trim()) return value;
  throw new TypeError(`${name} must be non-blank`);
}
