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

export type CustomerInquiryNodeId =
  | 'extract-inquiry'
  | 'classify-inquiry'
  | 'summarize-inquiry'
  | 'validate-inquiry'
  | 'route-inquiry';

export interface CustomerInquiryNodeDefinition extends ApplicationNodeDefinition {
  readonly id: CustomerInquiryNodeId;
  readonly blueprintPath: string;
  readonly blueprintVersion: '1.0.1';
}

export interface CustomerInquiryInput {
  readonly sourceText: string;
  readonly customerTier: 'standard' | 'premium';
  readonly classificationPolicy: Readonly<Record<string, unknown>>;
  readonly routingPolicy: Readonly<Record<string, unknown>>;
}

export interface CustomerInquiryExtraction {
  readonly customer_id: string | null;
  readonly channel: 'email' | 'chat' | 'web' | 'phone' | null;
  readonly locale: string | null;
  readonly subject: string | null;
  readonly message: string | null;
}

export interface CustomerInquiryClassification {
  readonly category: 'billing' | 'technical' | 'account' | 'other';
  readonly priority: 'urgent' | 'normal';
  readonly rationale: string;
  readonly policy_version: string;
}

export interface CustomerInquirySummary {
  readonly summary: string;
}

export interface CustomerInquiryValidation {
  readonly valid: boolean;
  readonly issues: readonly string[];
}

export interface CustomerInquiryRouting {
  readonly status: 'routed' | 'no_match' | 'ambiguous';
  readonly queue: string | null;
  readonly owner: string | null;
  readonly rule_id: string | null;
  readonly sla_hours: number | null;
  readonly policy_version: string;
}

export interface CustomerInquiryResult {
  readonly extraction: CustomerInquiryExtraction;
  readonly classification: CustomerInquiryClassification;
  readonly summary: CustomerInquirySummary;
  readonly validation: CustomerInquiryValidation;
  readonly routing: CustomerInquiryRouting;
}

export interface CustomerInquiryOptions {
  readonly runtimeOptions?: RuntimeOptions;
  readonly signal?: AbortSignal;
  readonly traceId?: string;
  readonly onTrace?: (trace: ApplicationTrace) => void;
}

export class CustomerInquiryNodeError extends ApplicationNodeError {
  constructor(
    node: CustomerInquiryNodeDefinition,
    inputs: Readonly<Record<string, unknown>>,
    cause: unknown,
  ) {
    super('Customer inquiry', node, Object.keys(inputs), cause, {
      code: 'CUSTOMER_INQUIRY_NODE_FAILED',
      name: 'CustomerInquiryNodeError',
    });
  }
}

export class CustomerInquiryDomainError extends Error {
  readonly code = 'CUSTOMER_INQUIRY_NOT_ROUTABLE';

  constructor(readonly issueCodes: readonly string[]) {
    super('Customer inquiry validation did not permit routing');
    this.name = 'CustomerInquiryDomainError';
    this.issueCodes = Object.freeze([...issueCodes]);
  }
}

function blueprint(name: string): string {
  return fileURLToPath(new URL(`./customer-inquiry/blueprints/${name}.yaml`, import.meta.url));
}

export const CUSTOMER_INQUIRY_NODES: readonly CustomerInquiryNodeDefinition[] = Object.freeze([
  defineNode('extract-inquiry'),
  defineNode('classify-inquiry'),
  defineNode('summarize-inquiry'),
  defineNode('validate-inquiry'),
  defineNode('route-inquiry'),
]);

/**
 * Composes five independently executable customer-inquiry Blueprints. The
 * host owns mappings, validation stop conditions, lifecycle, and routing
 * policy injection. The routing Blueprint recommends but performs no action.
 */
export async function composeCustomerInquiry(
  input: CustomerInquiryInput,
  options: CustomerInquiryOptions = {},
): Promise<CustomerInquiryResult> {
  return traceApplication({
    ...(options.traceId === undefined ? {} : { traceId: options.traceId }),
    ...(options.onTrace === undefined ? {} : { onTrace: options.onTrace }),
  }, recorder => composeCustomerInquiryTraced(input, options, recorder));
}

async function composeCustomerInquiryTraced(
  input: CustomerInquiryInput,
  options: CustomerInquiryOptions,
  recorder: ApplicationTraceRecorder,
): Promise<CustomerInquiryResult> {
  const sourceText = nonBlank(input.sourceText, 'sourceText');
  const boundary = await createApplicationSchemaBoundary(CUSTOMER_INQUIRY_NODES);
  await using runtime = new PromptRuntime(options.runtimeOptions ?? {});

  const extraction = Object.freeze(await executeNode<CustomerInquiryExtraction>(
    runtime,
    boundary,
    recorder,
    node('extract-inquiry'),
    { source_text: sourceText },
    options.signal,
  ));
  const classificationInputs = requireClassifiableExtraction(extraction);
  const classification = Object.freeze(await executeNode<CustomerInquiryClassification>(
    runtime,
    boundary,
    recorder,
    node('classify-inquiry'),
    { ...classificationInputs, policy: input.classificationPolicy },
    options.signal,
    [{ nodeId: 'extract-inquiry', output: extraction }],
  ));
  const summary = Object.freeze(await executeNode<CustomerInquirySummary>(
    runtime,
    boundary,
    recorder,
    node('summarize-inquiry'),
    {
      ...classificationInputs,
      category: classification.category,
    },
    options.signal,
    [
      { nodeId: 'extract-inquiry', output: extraction },
      { nodeId: 'classify-inquiry', output: classification },
    ],
  ));
  const validation = freezeValidation(await executeNode<CustomerInquiryValidation>(
    runtime,
    boundary,
    recorder,
    node('validate-inquiry'),
    {
      inquiry: extraction,
      classification: {
        category: classification.category,
        priority: classification.priority,
      },
    },
    options.signal,
    [
      { nodeId: 'extract-inquiry', output: extraction },
      { nodeId: 'classify-inquiry', output: classification },
    ],
  ));
  if (!validation.valid) throw new CustomerInquiryDomainError(validation.issues);

  const routing = Object.freeze(await executeNode<CustomerInquiryRouting>(
    runtime,
    boundary,
    recorder,
    node('route-inquiry'),
    {
      request: {
        category: classification.category,
        priority: classification.priority,
        customer_tier: input.customerTier,
      },
      policy: input.routingPolicy,
    },
    options.signal,
    [{ nodeId: 'classify-inquiry', output: classification }],
  ));

  return Object.freeze({ extraction, classification, summary, validation, routing });
}

async function executeNode<T extends object>(
  runtime: PromptRuntime,
  boundary: ApplicationSchemaBoundary,
  recorder: ApplicationTraceRecorder,
  definition: CustomerInquiryNodeDefinition,
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
      throw new CustomerInquiryNodeError(definition, inputs, cause);
    }
  }));
  if (outcome.status === 'failed') throw outcome.error;
  return outcome.value;
}

function requireClassifiableExtraction(
  extraction: CustomerInquiryExtraction,
): { readonly subject: string; readonly message: string } {
  if (extraction.subject?.trim() && extraction.message?.trim()) {
    return { subject: extraction.subject, message: extraction.message };
  }
  const issueCodes = [
    ...(extraction.subject?.trim() ? [] : ['missing_subject']),
    ...(extraction.message?.trim() ? [] : ['missing_message']),
  ];
  throw new CustomerInquiryDomainError(issueCodes);
}

function node(id: CustomerInquiryNodeId): CustomerInquiryNodeDefinition {
  const definition = CUSTOMER_INQUIRY_NODES.find(candidate => candidate.id === id);
  if (definition) return definition;
  throw new Error(`Unknown customer inquiry node: ${id}`);
}

function defineNode(id: CustomerInquiryNodeId): CustomerInquiryNodeDefinition {
  return Object.freeze({
    id,
    blueprintPath: blueprint(id),
    blueprintVersion: '1.0.1',
  });
}

function freezeValidation(value: CustomerInquiryValidation): CustomerInquiryValidation {
  return Object.freeze({ ...value, issues: Object.freeze([...value.issues]) });
}

function nonBlank(value: string, name: string): string {
  if (value.trim()) return value;
  throw new TypeError(`${name} must be non-blank`);
}
