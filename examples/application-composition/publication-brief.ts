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

export type PublicationBriefNodeId =
  | 'extract-brief'
  | 'classify-brief'
  | 'summarize-brief'
  | 'validate-brief'
  | 'localize-brief';

export interface PublicationBriefNodeDefinition extends ApplicationNodeDefinition {
  readonly id: PublicationBriefNodeId;
  readonly blueprintPath: string;
  readonly blueprintVersion: '1.0.1';
}

export interface PublicationBriefInput {
  readonly sourceText: string;
  readonly locale: string;
}

export interface PublicationBriefExtraction {
  readonly title: string;
  readonly audience: string;
  readonly facts: readonly string[];
}

export interface PublicationBriefClassification {
  readonly category: 'operations' | 'policy' | 'product' | 'other';
  readonly rationale: string;
}

export interface PublicationBriefSummary {
  readonly summary: string;
}

export interface PublicationBriefValidation {
  readonly valid: boolean;
  readonly issues: readonly string[];
}

export interface PublicationBriefLocalization {
  readonly locale: string;
  readonly localized_summary: string;
}

export interface PublicationBriefResult {
  readonly extraction: PublicationBriefExtraction;
  readonly classification: PublicationBriefClassification;
  readonly summary: PublicationBriefSummary;
  readonly validation: PublicationBriefValidation;
  readonly localization: PublicationBriefLocalization;
}

export interface PublicationBriefOptions {
  readonly runtimeOptions?: RuntimeOptions;
  readonly signal?: AbortSignal;
  readonly traceId?: string;
  readonly onTrace?: (trace: ApplicationTrace) => void;
}

export class PublicationBriefNodeError extends ApplicationNodeError {
  constructor(
    node: PublicationBriefNodeDefinition,
    inputs: Readonly<Record<string, unknown>>,
    cause: unknown,
  ) {
    super('Publication brief', node, Object.keys(inputs), cause, {
      code: 'PUBLICATION_BRIEF_NODE_FAILED',
      name: 'PublicationBriefNodeError',
    });
  }
}

function blueprint(name: string): string {
  return fileURLToPath(new URL(`./blueprints/${name}.yaml`, import.meta.url));
}

export const PUBLICATION_BRIEF_NODES: readonly PublicationBriefNodeDefinition[] = Object.freeze([
  Object.freeze({
    id: 'extract-brief',
    blueprintPath: blueprint('extract-brief'),
    blueprintVersion: '1.0.1',
  }),
  Object.freeze({
    id: 'classify-brief',
    blueprintPath: blueprint('classify-brief'),
    blueprintVersion: '1.0.1',
  }),
  Object.freeze({
    id: 'summarize-brief',
    blueprintPath: blueprint('summarize-brief'),
    blueprintVersion: '1.0.1',
  }),
  Object.freeze({
    id: 'validate-brief',
    blueprintPath: blueprint('validate-brief'),
    blueprintVersion: '1.0.1',
  }),
  Object.freeze({
    id: 'localize-brief',
    blueprintPath: blueprint('localize-brief'),
    blueprintVersion: '1.0.1',
  }),
]);

/**
 * Composes five independently executable Blueprints with the existing public
 * PromptRuntime API. The host owns ordering, mappings, cancellation, and the
 * one shared runtime; each Blueprint retains its own validation and retries.
 */
export async function composePublicationBrief(
  input: PublicationBriefInput,
  options: PublicationBriefOptions = {},
): Promise<PublicationBriefResult> {
  return traceApplication({
    ...(options.traceId === undefined ? {} : { traceId: options.traceId }),
    ...(options.onTrace === undefined ? {} : { onTrace: options.onTrace }),
  }, recorder => composePublicationBriefTraced(input, options, recorder));
}

async function composePublicationBriefTraced(
  input: PublicationBriefInput,
  options: PublicationBriefOptions,
  recorder: ApplicationTraceRecorder,
): Promise<PublicationBriefResult> {
  const sourceText = nonBlank(input.sourceText, 'sourceText');
  const locale = nonBlank(input.locale, 'locale');
  const boundary = await createApplicationSchemaBoundary(PUBLICATION_BRIEF_NODES);
  await using runtime = new PromptRuntime(options.runtimeOptions ?? {});

  const extraction = freezeExtraction(await executeNode<PublicationBriefExtraction>(
    runtime,
    boundary,
    recorder,
    node('extract-brief'),
    { source_text: sourceText },
    options.signal,
  ));
  const classification = Object.freeze(await executeNode<PublicationBriefClassification>(
    runtime,
    boundary,
    recorder,
    node('classify-brief'),
    mapExtractionToClassification(extraction),
    options.signal,
    [{ nodeId: 'extract-brief', output: extraction }],
  ));
  const summary = Object.freeze(await executeNode<PublicationBriefSummary>(
    runtime,
    boundary,
    recorder,
    node('summarize-brief'),
    mapClassificationToSummary(extraction, classification),
    options.signal,
    [
      { nodeId: 'extract-brief', output: extraction },
      { nodeId: 'classify-brief', output: classification },
    ],
  ));
  const validation = freezeValidation(await executeNode<PublicationBriefValidation>(
    runtime,
    boundary,
    recorder,
    node('validate-brief'),
    mapSummaryToValidation(extraction, summary),
    options.signal,
    [
      { nodeId: 'extract-brief', output: extraction },
      { nodeId: 'summarize-brief', output: summary },
    ],
  ));
  const localization = Object.freeze(await executeNode<PublicationBriefLocalization>(
    runtime,
    boundary,
    recorder,
    node('localize-brief'),
    mapSummaryToLocalization(summary, locale),
    options.signal,
    [{ nodeId: 'summarize-brief', output: summary }],
  ));

  return Object.freeze({ extraction, classification, summary, validation, localization });
}

async function executeNode<T extends object>(
  runtime: PromptRuntime,
  boundary: ApplicationSchemaBoundary,
  recorder: ApplicationTraceRecorder,
  definition: PublicationBriefNodeDefinition,
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
        throw new PublicationBriefNodeError(definition, inputs, cause);
      }
    }));
  if (outcome.status === 'failed') throw outcome.error;
  return outcome.value;
}

function mapExtractionToClassification(
  extraction: PublicationBriefExtraction,
): Record<string, unknown> {
  return {
    title: extraction.title,
    audience: extraction.audience,
    facts: [...extraction.facts],
  };
}

function mapClassificationToSummary(
  extraction: PublicationBriefExtraction,
  classification: PublicationBriefClassification,
): Record<string, unknown> {
  return {
    title: extraction.title,
    facts: [...extraction.facts],
    category: classification.category,
  };
}

function mapSummaryToValidation(
  extraction: PublicationBriefExtraction,
  summary: PublicationBriefSummary,
): Record<string, unknown> {
  return {
    facts: [...extraction.facts],
    summary: summary.summary,
  };
}

function mapSummaryToLocalization(
  summary: PublicationBriefSummary,
  locale: string,
): Record<string, unknown> {
  return { summary: summary.summary, locale };
}

function node(id: PublicationBriefNodeId): PublicationBriefNodeDefinition {
  const definition = PUBLICATION_BRIEF_NODES.find(candidate => candidate.id === id);
  if (definition) return definition;
  throw new Error(`Unknown publication brief node: ${id}`);
}

function freezeExtraction(value: PublicationBriefExtraction): PublicationBriefExtraction {
  return Object.freeze({ ...value, facts: Object.freeze([...value.facts]) });
}

function freezeValidation(value: PublicationBriefValidation): PublicationBriefValidation {
  return Object.freeze({ ...value, issues: Object.freeze([...value.issues]) });
}

function nonBlank(value: string, name: string): string {
  if (value.trim()) return value;
  throw new TypeError(`${name} must be non-blank`);
}
