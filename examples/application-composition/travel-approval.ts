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

export type TravelApprovalNodeId =
  | 'extract-document'
  | 'normalize-start-date'
  | 'normalize-end-date'
  | 'classify-destination'
  | 'validate-form'
  | 'verify-evidence'
  | 'summarize-request'
  | 'localize-summary'
  | 'route-approval';

export interface TravelApprovalNodeDefinition extends ApplicationNodeDefinition {
  readonly id: TravelApprovalNodeId;
  readonly blueprintPath: string;
  readonly blueprintVersion: '1.0.1' | '1.0.2' | '1.1.1';
}

export interface TravelAttachment {
  readonly filePath: string | null;
  readonly imagePath: string | null;
}

export interface TravelApprovalForm {
  readonly employeeId: string;
  readonly travelerName: string;
  readonly documentNumber: string;
  readonly purpose: string;
  readonly startDateText: string;
  readonly endDateText: string;
  readonly destinationCity: string;
  readonly destinationCountryCode: string;
  readonly estimatedCost: number;
  readonly currency: string;
}

export interface LocalizationProtectedTerm {
  readonly kind: 'person' | 'organization' | 'place' | 'identifier' | 'amount';
  readonly value: string;
}

export interface TravelApprovalInput {
  readonly attachment: TravelAttachment;
  readonly form: TravelApprovalForm;
  readonly travelPolicy: Record<string, unknown>;
  readonly validationRules: Record<string, unknown>;
  readonly comparisonPolicy: Record<string, unknown>;
  readonly localizationPolicy: Record<string, unknown>;
  readonly target: { readonly language: 'en' | 'ja'; readonly locale: 'en-US' | 'ja-JP' };
  readonly routingTableVersion: string;
  readonly routingCsv: string;
  readonly maxSummaryCharacters: number;
  readonly approvalNotes?: readonly string[];
  readonly protectedTerms?: readonly LocalizationProtectedTerm[];
}

export interface ExtractedSource {
  readonly page: number;
  readonly evidence_text: string;
}

export interface ExtractedField {
  readonly name: string;
  readonly status: 'extracted' | 'not_found' | 'unreadable';
  readonly value: string | null;
  readonly source: ExtractedSource | null;
}

export interface TravelExtraction {
  readonly status: 'complete' | 'partial' | 'unreadable';
  readonly document_type: 'travel_request' | 'unknown';
  readonly fields: readonly ExtractedField[];
  readonly warnings: readonly Record<string, unknown>[];
}

export interface DateConversion {
  readonly status: 'converted' | 'invalid' | 'ambiguous' | 'unsupported';
  readonly normalized_date: string | null;
  readonly reason_code: string;
}

export interface DestinationClassification {
  readonly status: 'classified' | 'ambiguous' | 'unknown';
  readonly level: 'A' | 'B' | 'C' | null;
  readonly canonical_city: string | null;
  readonly country_code: string | null;
  readonly matched_rule: string | null;
  readonly reason_code: string;
  readonly policy_version: string;
  readonly candidates: readonly Record<string, unknown>[];
}

export interface FormValidation {
  readonly form_valid: boolean;
  readonly rules_version: string;
  readonly field_results: readonly Record<string, unknown>[];
}

export interface EvidenceVerification {
  readonly overall_status: 'verified' | 'mismatch' | 'incomplete';
  readonly policy_version: string;
  readonly field_results: readonly Record<string, unknown>[];
}

export interface TravelSummary {
  readonly status: 'summarized' | 'insufficient_facts';
  readonly summary: string | null;
  readonly character_count: number;
  readonly claims: readonly Record<string, unknown>[];
  readonly omitted_source_fields: readonly string[];
  readonly missing_source_fields: readonly string[];
}

export interface TravelLocalization {
  readonly status: 'localized' | 'unchanged';
  readonly localized_text: string;
  readonly source_language: 'en' | 'ja';
  readonly target_language: 'en' | 'ja';
  readonly target_locale: 'en-US' | 'ja-JP';
  readonly policy_version: string;
  readonly protected_term_results: readonly Record<string, unknown>[];
  readonly changes: readonly Record<string, unknown>[];
}

export interface ApprovalRouting {
  readonly status: 'routed' | 'no_match' | 'ambiguous' | 'unavailable';
  readonly next_user: string | null;
  readonly matched_rule: string | null;
  readonly matched_priority: number | null;
  readonly reason_code: string;
  readonly routing_table_version: string;
  readonly candidates: readonly Record<string, unknown>[];
}

export interface TravelApprovalResult {
  readonly extraction: TravelExtraction;
  readonly startDate: DateConversion;
  readonly endDate: DateConversion;
  readonly classification: DestinationClassification;
  readonly validation: FormValidation;
  readonly verification: EvidenceVerification;
  readonly summary: TravelSummary;
  readonly localization: TravelLocalization;
  readonly routing: ApprovalRouting;
}

export interface TravelApprovalOptions {
  readonly runtimeOptions?: RuntimeOptions;
  readonly signal?: AbortSignal;
  readonly traceId?: string;
  readonly onTrace?: (trace: ApplicationTrace) => void;
}

export class TravelApprovalNodeError extends ApplicationNodeError {
  constructor(
    node: TravelApprovalNodeDefinition,
    inputs: Readonly<Record<string, unknown>>,
    cause: unknown,
  ) {
    super('Travel approval', node, Object.keys(inputs), cause, {
      code: 'TRAVEL_APPROVAL_NODE_FAILED',
      name: 'TravelApprovalNodeError',
    });
  }
}

const REQUESTED_DOCUMENT_FIELDS = Object.freeze([
  'traveler_name',
  'document_number',
  'trip_start_date',
  'trip_end_date',
  'destination',
  'business_purpose',
  'estimated_amount',
  'currency',
] as const);

function referenceBlueprint(path: string): string {
  return fileURLToPath(new URL(`../blueprints/${path}`, import.meta.url));
}

export const TRAVEL_APPROVAL_NODES: readonly TravelApprovalNodeDefinition[] = Object.freeze([
  defineNode('extract-document', 'extractor/travel-document-fields/travel-document-fields.yaml', '1.1.1'),
  defineNode('normalize-start-date', 'converter/date-normalizer/date-normalizer.yaml', '1.0.2'),
  defineNode('normalize-end-date', 'converter/date-normalizer/date-normalizer.yaml', '1.0.2'),
  defineNode('classify-destination', 'classifier/travel-destination-level/travel-destination-level.yaml', '1.0.2'),
  defineNode('validate-form', 'validator/travel-request-form/travel-request-form.yaml', '1.0.1'),
  defineNode('verify-evidence', 'verifier/travel-document-evidence/travel-document-evidence.yaml', '1.0.1'),
  defineNode('summarize-request', 'summarizer/travel-request-summary/travel-request-summary.yaml', '1.0.2'),
  defineNode('localize-summary', 'translator/travel-purpose-localizer/travel-purpose-localizer.yaml', '1.0.1'),
  defineNode('route-approval', 'router/travel-approval-routing/travel-approval-routing.yaml', '1.0.2'),
]);

/**
 * Composes all eight reference Role families through the public PromptRuntime.
 * The host owns ordering, typed mappings, domain stop conditions, cancellation,
 * and one shared runtime. The Converter is called once per independent date.
 */
export async function composeTravelApproval(
  input: TravelApprovalInput,
  options: TravelApprovalOptions = {},
): Promise<TravelApprovalResult> {
  return traceApplication({
    ...(options.traceId === undefined ? {} : { traceId: options.traceId }),
    ...(options.onTrace === undefined ? {} : { onTrace: options.onTrace }),
  }, recorder => composeTravelApprovalTraced(input, options, recorder));
}

async function composeTravelApprovalTraced(
  input: TravelApprovalInput,
  options: TravelApprovalOptions,
  recorder: ApplicationTraceRecorder,
): Promise<TravelApprovalResult> {
  validateApplicationInput(input);
  const boundary = await createApplicationSchemaBoundary(TRAVEL_APPROVAL_NODES);
  await using runtime = new PromptRuntime(options.runtimeOptions ?? {});

  const extractionInputs = mapInputToExtraction(input);
  const extraction = await executeNode<TravelExtraction>(
    runtime,
    boundary,
    recorder,
    node('extract-document'),
    extractionInputs,
    options.signal,
  );

  const startInputs = { date_text: input.form.startDateText };
  const startDate = await executeNode<DateConversion>(
    runtime,
    boundary,
    recorder,
    node('normalize-start-date'),
    startInputs,
    options.signal,
  );
  const normalizedStartDate = requireConvertedDate(
    node('normalize-start-date'),
    startInputs,
    startDate,
  );

  const endInputs = { date_text: input.form.endDateText };
  const endDate = await executeNode<DateConversion>(
    runtime,
    boundary,
    recorder,
    node('normalize-end-date'),
    endInputs,
    options.signal,
  );
  const normalizedEndDate = requireConvertedDate(
    node('normalize-end-date'),
    endInputs,
    endDate,
  );

  const classificationInputs = mapInputToClassification(input);
  const classification = await executeNode<DestinationClassification>(
    runtime,
    boundary,
    recorder,
    node('classify-destination'),
    classificationInputs,
    options.signal,
  );
  requireClassifiedDestination(node('classify-destination'), classificationInputs, classification);

  const validation = await executeMappedNode<FormValidation>(
    runtime,
    boundary,
    recorder,
    node('validate-form'),
    () => mapToValidation(input, normalizedStartDate, normalizedEndDate),
    options.signal,
    [
      { nodeId: 'normalize-start-date', output: startDate },
      { nodeId: 'normalize-end-date', output: endDate },
    ],
  );
  const verification = await executeMappedNode<EvidenceVerification>(
    runtime,
    boundary,
    recorder,
    node('verify-evidence'),
    () => mapToVerification(input, extraction, normalizedStartDate, normalizedEndDate),
    options.signal,
    [
      { nodeId: 'extract-document', output: extraction },
      { nodeId: 'normalize-start-date', output: startDate },
      { nodeId: 'normalize-end-date', output: endDate },
    ],
  );
  const summary = await executeMappedNode<TravelSummary>(
    runtime,
    boundary,
    recorder,
    node('summarize-request'),
    () => mapToSummary(input, classification, validation, verification, normalizedStartDate, normalizedEndDate),
    options.signal,
    [
      { nodeId: 'normalize-start-date', output: startDate },
      { nodeId: 'normalize-end-date', output: endDate },
      { nodeId: 'classify-destination', output: classification },
      { nodeId: 'validate-form', output: validation },
      { nodeId: 'verify-evidence', output: verification },
    ],
  );
  const summaryText = requireSummary(node('summarize-request'), summary);
  const localization = await executeMappedNode<TravelLocalization>(
    runtime,
    boundary,
    recorder,
    node('localize-summary'),
    () => mapToLocalization(input, classification, summaryText),
    options.signal,
    [
      { nodeId: 'classify-destination', output: classification },
      { nodeId: 'summarize-request', output: summary },
    ],
  );
  const routing = await executeMappedNode<ApprovalRouting>(
    runtime,
    boundary,
    recorder,
    node('route-approval'),
    () => mapToRouting(input, classification),
    options.signal,
    [{ nodeId: 'classify-destination', output: classification }],
  );

  return cloneAndFreeze({
    extraction,
    startDate,
    endDate,
    classification,
    validation,
    verification,
    summary,
    localization,
    routing,
  });
}

async function executeMappedNode<T extends object>(
  runtime: PromptRuntime,
  boundary: ApplicationSchemaBoundary,
  recorder: ApplicationTraceRecorder,
  definition: TravelApprovalNodeDefinition,
  mapInputs: () => Record<string, unknown>,
  signal: AbortSignal | undefined,
  sources: readonly ApplicationMappingSource[] = [],
): Promise<T> {
  let inputs: Record<string, unknown> = {};
  const outcome = await executeApplicationNode({
    node: definition,
    policy: { failureMode: 'fail-fast', retryOwner: 'runtime' },
  }, () => recorder.runNode({
      node: definition,
      logger: runtime.logger,
      ...(signal === undefined ? {} : { signal }),
    }, async () => {
      try {
        inputs = mapInputs();
        signal?.throwIfAborted();
        inputs = boundary.validateMapping({
          targetNodeId: definition.id,
          inputs,
          sources,
        });
        return await runtime.execute(
          definition.blueprintPath,
          inputs,
          signal === undefined ? {} : { signal },
        ) as T;
      } catch (cause) {
        throw new TravelApprovalNodeError(definition, inputs, cause);
      }
    }));
  if (outcome.status === 'failed') throw outcome.error;
  return outcome.value;
}

async function executeNode<T extends object>(
  runtime: PromptRuntime,
  boundary: ApplicationSchemaBoundary,
  recorder: ApplicationTraceRecorder,
  definition: TravelApprovalNodeDefinition,
  inputs: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<T> {
  return executeMappedNode(runtime, boundary, recorder, definition, () => inputs, signal);
}

function mapInputToExtraction(input: TravelApprovalInput): Record<string, unknown> {
  return {
    file_path: input.attachment.filePath,
    image_path: input.attachment.imagePath,
    requested_fields: [...REQUESTED_DOCUMENT_FIELDS],
  };
}

function mapInputToClassification(input: TravelApprovalInput): Record<string, unknown> {
  return {
    destination: {
      city: input.form.destinationCity,
      country_code: input.form.destinationCountryCode,
    },
    policy: input.travelPolicy,
  };
}

function mapToValidation(
  input: TravelApprovalInput,
  startDate: string,
  endDate: string,
): Record<string, unknown> {
  return {
    form: {
      employee_id: input.form.employeeId,
      purpose: input.form.purpose,
      start_date: startDate,
      end_date: endDate,
      destination_country_code: input.form.destinationCountryCode,
      estimated_cost: input.form.estimatedCost,
      currency: input.form.currency,
    },
    rules: input.validationRules,
  };
}

function mapToVerification(
  input: TravelApprovalInput,
  extraction: TravelExtraction,
  startDate: string,
  endDate: string,
): Record<string, unknown> {
  return {
    submitted_fields: {
      traveler_name: input.form.travelerName,
      document_number: input.form.documentNumber,
      start_date: startDate,
      end_date: endDate,
      total_amount: input.form.estimatedCost,
      currency: input.form.currency,
    },
    extracted_fields: {
      traveler_name: mapEvidenceField(extraction, 'traveler_name'),
      document_number: mapEvidenceField(extraction, 'document_number'),
      start_date: mapEvidenceField(extraction, 'trip_start_date'),
      end_date: mapEvidenceField(extraction, 'trip_end_date'),
      total_amount: mapEvidenceField(extraction, 'estimated_amount', parseExtractedAmount),
      currency: mapEvidenceField(extraction, 'currency'),
    },
    comparison_policy: input.comparisonPolicy,
  };
}

function mapToSummary(
  input: TravelApprovalInput,
  classification: DestinationClassification,
  validation: FormValidation,
  verification: EvidenceVerification,
  startDate: string,
  endDate: string,
): Record<string, unknown> {
  return {
    request: {
      purpose: input.form.purpose,
      start_date: startDate,
      end_date: endDate,
      destinations: [`${classification.canonical_city}, ${classification.country_code}`],
      total_cost: { amount: input.form.estimatedCost, currency: input.form.currency },
      approval_notes: [
        ...(input.approvalNotes ?? []),
        `Destination policy level: ${classification.level}`,
        `Form validation: ${validation.form_valid ? 'valid' : 'invalid'}`,
        `Evidence verification: ${verification.overall_status}`,
      ],
    },
    max_characters: input.maxSummaryCharacters,
  };
}

function mapToLocalization(
  input: TravelApprovalInput,
  classification: DestinationClassification,
  summary: string,
): Record<string, unknown> {
  const candidates: LocalizationProtectedTerm[] = [
    { kind: 'person', value: input.form.travelerName },
    { kind: 'identifier', value: input.form.documentNumber },
    { kind: 'place', value: classification.canonical_city! },
    ...(input.protectedTerms ?? []),
  ];
  const protectedTerms = uniqueProtectedTerms(candidates)
    .filter(term => summary.includes(term.value));
  return {
    source_text: summary,
    source_language: 'en',
    target: input.target,
    protected_terms: protectedTerms,
    policy: input.localizationPolicy,
  };
}

function mapToRouting(
  input: TravelApprovalInput,
  classification: DestinationClassification,
): Record<string, unknown> {
  return {
    request: {
      country_code: input.form.destinationCountryCode,
      destination_level: classification.level,
      estimated_cost: input.form.estimatedCost,
      currency: input.form.currency,
    },
    routing_table_version: input.routingTableVersion,
    routing_csv: input.routingCsv,
  };
}

function mapEvidenceField(
  extraction: TravelExtraction,
  name: string,
  transform: (value: string) => string | number = value => value,
): Record<string, unknown> {
  const matches = extraction.fields.filter(field => field.name === name);
  if (matches.length !== 1) throw new TypeError(`Expected exactly one extracted field: ${name}`);
  const field = matches[0]!;
  if (field.status === 'not_found') return { status: 'not_found', value: null, evidence: null };
  if (field.status === 'unreadable') {
    throw new TypeError(`Cannot map unreadable field without page evidence: ${name}`);
  }
  if (field.value === null || field.source === null) {
    throw new TypeError(`Extracted field is missing value or source: ${name}`);
  }
  return {
    status: 'found',
    value: transform(field.value),
    evidence: { page: field.source.page, text: field.source.evidence_text },
  };
}

function parseExtractedAmount(value: string): number {
  const normalized = value.replaceAll(',', '');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new TypeError(`Extracted amount is not a canonical decimal: ${value}`);
  }
  const amount = Number(normalized);
  if (Number.isFinite(amount)) return amount;
  throw new TypeError(`Extracted amount is outside the numeric range: ${value}`);
}

function requireConvertedDate(
  definition: TravelApprovalNodeDefinition,
  inputs: Record<string, unknown>,
  result: DateConversion,
): string {
  if (result.status === 'converted' && result.normalized_date !== null) {
    return result.normalized_date;
  }
  throw new TravelApprovalNodeError(
    definition,
    inputs,
    new TypeError(`Date conversion did not produce a normalized date: ${result.reason_code}`),
  );
}

function requireClassifiedDestination(
  definition: TravelApprovalNodeDefinition,
  inputs: Record<string, unknown>,
  result: DestinationClassification,
): asserts result is DestinationClassification & {
  readonly status: 'classified';
  readonly level: 'A' | 'B' | 'C';
  readonly canonical_city: string;
  readonly country_code: string;
} {
  if (
    result.status === 'classified'
    && result.level !== null
    && result.canonical_city !== null
    && result.country_code !== null
  ) return;
  throw new TravelApprovalNodeError(
    definition,
    inputs,
    new TypeError(`Destination classification is not routable: ${result.status}`),
  );
}

function requireSummary(definition: TravelApprovalNodeDefinition, result: TravelSummary): string {
  if (result.status === 'summarized' && result.summary !== null) return result.summary;
  throw new TravelApprovalNodeError(
    definition,
    {},
    new TypeError('Travel request has insufficient facts for localization'),
  );
}

function uniqueProtectedTerms(
  values: readonly LocalizationProtectedTerm[],
): LocalizationProtectedTerm[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = `${value.kind}\0${value.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validateApplicationInput(input: TravelApprovalInput): void {
  const filePath = nullableNonBlank(input.attachment.filePath, 'attachment.filePath');
  const imagePath = nullableNonBlank(input.attachment.imagePath, 'attachment.imagePath');
  if ((filePath === null) === (imagePath === null)) {
    throw new TypeError('Exactly one of attachment.filePath or attachment.imagePath is required');
  }
  nonBlank(input.form.startDateText, 'form.startDateText');
  nonBlank(input.form.endDateText, 'form.endDateText');
  nonBlank(input.routingTableVersion, 'routingTableVersion');
  nonBlank(input.routingCsv, 'routingCsv');
  if (
    !Number.isInteger(input.maxSummaryCharacters)
    || input.maxSummaryCharacters < 40
    || input.maxSummaryCharacters > 500
  ) {
    throw new TypeError('maxSummaryCharacters must be an integer from 40 through 500');
  }
}

function nullableNonBlank(value: string | null, name: string): string | null {
  if (value === null) return null;
  return nonBlank(value, name);
}

function nonBlank(value: string, name: string): string {
  if (value.trim()) return value;
  throw new TypeError(`${name} must be non-blank`);
}

function defineNode(
  id: TravelApprovalNodeId,
  path: string,
  blueprintVersion: TravelApprovalNodeDefinition['blueprintVersion'],
): TravelApprovalNodeDefinition {
  return Object.freeze({ id, blueprintPath: referenceBlueprint(path), blueprintVersion });
}

function node(id: TravelApprovalNodeId): TravelApprovalNodeDefinition {
  const definition = TRAVEL_APPROVAL_NODES.find(candidate => candidate.id === id);
  if (definition) return definition;
  throw new Error(`Unknown travel approval node: ${id}`);
}

function cloneAndFreeze<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
