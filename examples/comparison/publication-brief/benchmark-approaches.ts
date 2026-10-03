import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { parse as parseYaml } from 'yaml';
import {
  PromptRuntime,
  type GenerateRequest,
  type GenerateResponse,
  type Provider,
  type RuntimeOptions,
} from '@pixieworks/pixiecore';
import {
  composePublicationBrief,
  type PublicationBriefClassification,
  type PublicationBriefExtraction,
  type PublicationBriefInput,
  type PublicationBriefLocalization,
  type PublicationBriefResult,
  type PublicationBriefSummary,
  type PublicationBriefValidation,
} from '../../application-composition/publication-brief.js';
import {
  type PublicationBriefApproachExecutor,
  type PublicationBriefBenchmarkPricing,
  type PublicationBriefBenchmarkProviderFactory,
  type PublicationBriefBenchmarkUsage,
} from './benchmark-contract.js';

const NODE_IDS = Object.freeze([
  'extract-brief',
  'classify-brief',
  'summarize-brief',
  'validate-brief',
  'localize-brief',
] as const);
type NodeId = typeof NODE_IDS[number];

interface BlueprintSpec {
  readonly role: string;
  readonly prompt: string;
  readonly output_schema: Record<string, unknown>;
}

interface MeteredProvider {
  readonly provider: Provider;
  snapshot(): PublicationBriefBenchmarkUsage;
}

const plannerSchema: Record<string, unknown> = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['operations'],
  properties: {
    operations: {
      type: 'array',
      minItems: 5,
      maxItems: 5,
      uniqueItems: true,
      items: { enum: NODE_IDS },
    },
  },
});

const blueprintPaths: Readonly<Record<NodeId, URL>> = Object.freeze({
  'extract-brief': new URL('../../application-composition/blueprints/extract-brief.yaml', import.meta.url),
  'classify-brief': new URL('../../application-composition/blueprints/classify-brief.yaml', import.meta.url),
  'summarize-brief': new URL('../../application-composition/blueprints/summarize-brief.yaml', import.meta.url),
  'validate-brief': new URL('../../application-composition/blueprints/validate-brief.yaml', import.meta.url),
  'localize-brief': new URL('../../application-composition/blueprints/localize-brief.yaml', import.meta.url),
});

const monolithicBlueprintPath = fileURLToPath(new URL(
  './monolithic-publication-brief.yaml',
  import.meta.url,
));

let blueprintCache: Promise<Readonly<Record<NodeId, BlueprintSpec>>> | undefined;

export function createPublicationBriefApproachExecutors(options: Readonly<{
  createProvider: PublicationBriefBenchmarkProviderFactory;
  pricing: PublicationBriefBenchmarkPricing;
}>): readonly PublicationBriefApproachExecutor[] {
  return Object.freeze([
    {
      id: 'pixiecore-composed',
      execute: async (input, context) => executePixieCoreComposed(input, context, options),
    },
    {
      id: 'monolithic-prompt',
      execute: async (input, context) => executeMonolithic(input, context, options),
    },
    {
      id: 'agent-graph',
      execute: async (input, context) => executeAgentGraph(input, context, options),
    },
    {
      id: 'code-only',
      execute: async input => Object.freeze({
        result: executeCodeOnly(input),
        usage: emptyUsage(),
      }),
    },
  ]);
}

async function executePixieCoreComposed(
  input: Readonly<PublicationBriefInput>,
  context: Readonly<{ run: number; caseId: string; signal?: AbortSignal }>,
  options: Readonly<{
    createProvider: PublicationBriefBenchmarkProviderFactory;
    pricing: PublicationBriefBenchmarkPricing;
  }>,
) {
  const meter = meteredProvider(
    options.createProvider('pixiecore-composed', context),
    options.pricing,
  );
  const result = await composePublicationBrief(input, {
    runtimeOptions: runtimeOptions(meter.provider),
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  });
  return Object.freeze({ result, usage: meter.snapshot() });
}

async function executeMonolithic(
  input: Readonly<PublicationBriefInput>,
  context: Readonly<{ run: number; caseId: string; signal?: AbortSignal }>,
  options: Readonly<{
    createProvider: PublicationBriefBenchmarkProviderFactory;
    pricing: PublicationBriefBenchmarkPricing;
  }>,
) {
  const meter = meteredProvider(
    options.createProvider('monolithic-prompt', context),
    options.pricing,
  );
  await using runtime = new PromptRuntime(runtimeOptions(meter.provider));
  const result = await runtime.execute(
    monolithicBlueprintPath,
    { source_text: input.sourceText, locale: input.locale },
    context.signal === undefined ? {} : { signal: context.signal },
  ) as unknown as PublicationBriefResult;
  return Object.freeze({ result, usage: meter.snapshot() });
}

async function executeAgentGraph(
  input: Readonly<PublicationBriefInput>,
  context: Readonly<{ run: number; caseId: string; signal?: AbortSignal }>,
  options: Readonly<{
    createProvider: PublicationBriefBenchmarkProviderFactory;
    pricing: PublicationBriefBenchmarkPricing;
  }>,
) {
  const meter = meteredProvider(options.createProvider('agent-graph', context), options.pricing);
  try {
    const plan = await structuredGenerate<{ readonly operations: readonly NodeId[] }>(
      meter.provider,
      plannerSchema,
      [
        'Plan a publication brief workflow for the supplied source and locale.',
        'Use each available operation exactly once and respect data dependencies.',
        `Available operations: ${NODE_IDS.join(', ')}.`,
        `Source: ${input.sourceText}`,
        `Locale: ${input.locale}`,
      ].join('\n'),
      context.signal,
    );
    assertValidPlan(plan.operations);
    const blueprints = await loadBlueprints();
    let extraction: PublicationBriefExtraction | undefined;
    let classification: PublicationBriefClassification | undefined;
    let summary: PublicationBriefSummary | undefined;
    let validation: PublicationBriefValidation | undefined;
    let localization: PublicationBriefLocalization | undefined;

    for (const operation of plan.operations) {
      switch (operation) {
        case 'extract-brief':
          extraction = await executeBlueprint<PublicationBriefExtraction>(
            meter.provider,
            blueprints[operation],
            { source_text: input.sourceText },
            context.signal,
          );
          break;
        case 'classify-brief':
          extraction = requiredValue(extraction, 'extract-brief');
          classification = await executeBlueprint<PublicationBriefClassification>(
            meter.provider,
            blueprints[operation],
            {
              title: extraction.title,
              audience: extraction.audience,
              facts: extraction.facts,
            },
            context.signal,
          );
          break;
        case 'summarize-brief':
          extraction = requiredValue(extraction, 'extract-brief');
          classification = requiredValue(classification, 'classify-brief');
          summary = await executeBlueprint<PublicationBriefSummary>(
            meter.provider,
            blueprints[operation],
            {
              title: extraction.title,
              facts: extraction.facts,
              category: classification.category,
            },
            context.signal,
          );
          break;
        case 'validate-brief':
          extraction = requiredValue(extraction, 'extract-brief');
          summary = requiredValue(summary, 'summarize-brief');
          validation = await executeBlueprint<PublicationBriefValidation>(
            meter.provider,
            blueprints[operation],
            { facts: extraction.facts, summary: summary.summary },
            context.signal,
          );
          break;
        case 'localize-brief':
          summary = requiredValue(summary, 'summarize-brief');
          localization = await executeBlueprint<PublicationBriefLocalization>(
            meter.provider,
            blueprints[operation],
            { summary: summary.summary, locale: input.locale },
            context.signal,
          );
          break;
      }
    }

    return Object.freeze({
      result: Object.freeze({
        extraction: requiredValue(extraction, 'extract-brief'),
        classification: requiredValue(classification, 'classify-brief'),
        summary: requiredValue(summary, 'summarize-brief'),
        validation: requiredValue(validation, 'validate-brief'),
        localization: requiredValue(localization, 'localize-brief'),
      }),
      usage: meter.snapshot(),
    });
  } finally {
    await meter.provider.close?.();
  }
}

function executeCodeOnly(input: Readonly<PublicationBriefInput>): PublicationBriefResult {
  if (input.locale !== 'en-US') {
    throw namedError('CODE_ONLY_UNSUPPORTED_LOCALE', 'Code-only example supports en-US only');
  }
  const title = field(input.sourceText, 'Title');
  const audience = field(input.sourceText, 'Audience');
  const category = field(input.sourceText, 'Category');
  const facts = factsField(input.sourceText);
  if (!title || !audience || !category || facts.length === 0) {
    throw namedError(
      'CODE_ONLY_UNSUPPORTED_INPUT',
      'Code-only example requires labeled Title, Audience, Category, and Facts fields',
    );
  }
  if (!['operations', 'policy', 'product', 'other'].includes(category)) {
    throw namedError('CODE_ONLY_UNSUPPORTED_CATEGORY', `Unsupported category: ${category}`);
  }
  const summary = facts.join(' ');
  return Object.freeze({
    extraction: Object.freeze({ title, audience, facts: Object.freeze(facts) }),
    classification: Object.freeze({
      category: category as PublicationBriefClassification['category'],
      rationale: 'The input declares this category.',
    }),
    summary: Object.freeze({ summary }),
    validation: Object.freeze({ valid: true, issues: Object.freeze([]) }),
    localization: Object.freeze({ locale: input.locale, localized_summary: summary }),
  });
}

async function executeBlueprint<T>(
  provider: Provider,
  blueprint: BlueprintSpec,
  inputs: Readonly<Record<string, unknown>>,
  signal: AbortSignal | undefined,
): Promise<T> {
  const rendered = render(blueprint.prompt, inputs);
  return structuredGenerate<T>(
    provider,
    blueprint.output_schema,
    rendered,
    signal,
    blueprint.role,
  );
}

async function structuredGenerate<T>(
  provider: Provider,
  schema: Record<string, unknown>,
  prompt: string,
  signal: AbortSignal | undefined,
  role = 'assistant',
): Promise<T> {
  const response = await provider.generate({
    messages: [
      {
        role: 'system',
        content: `Role: ${role}\nReturn only JSON matching this schema:\n${JSON.stringify(schema)}`,
      },
      { role: 'user', content: prompt },
    ],
    schema,
    temperature: 0,
    ...(signal === undefined ? {} : { signal }),
  });
  if (typeof response.content !== 'string') {
    throw namedError('PROVIDER_CONTENT_MISSING', 'Provider returned no text content');
  }
  let value: unknown;
  try {
    value = JSON.parse(response.content);
  } catch {
    throw namedError('PROVIDER_JSON_INVALID', 'Provider returned invalid JSON');
  }
  const validate = compile(schema);
  if (!validate(value)) {
    throw namedError('PROVIDER_SCHEMA_INVALID', 'Provider result failed its output schema');
  }
  return value as T;
}

function meteredProvider(
  source: Provider,
  pricing: PublicationBriefBenchmarkPricing,
): MeteredProvider {
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let usageComplete = true;
  const provider: Provider = {
    name: source.name,
    model: source.model,
    supportsTools: source.supportsTools,
    supportsMultimodal: source.supportsMultimodal,
    supportsVision: () => source.supportsVision(),
    supportsFileInput: () => source.supportsFileInput(),
    getModelList: signal => source.getModelList(signal),
    async generate(request: GenerateRequest): Promise<GenerateResponse> {
      calls++;
      const response = await source.generate(request);
      const usage = response.usage;
      if (
        usage?.inputTokens === undefined
        || usage.outputTokens === undefined
        || usage.totalTokens === undefined
      ) usageComplete = false;
      else {
        inputTokens += tokenCount(usage.inputTokens);
        outputTokens += tokenCount(usage.outputTokens);
        totalTokens += tokenCount(usage.totalTokens);
      }
      return response;
    },
    ...(source.close === undefined ? {} : { close: () => source.close!() }),
  };
  return Object.freeze({
    provider,
    snapshot: () => Object.freeze({
      provider_calls: calls,
      input_tokens: usageComplete && calls > 0 ? inputTokens : null,
      output_tokens: usageComplete && calls > 0 ? outputTokens : null,
      total_tokens: usageComplete && calls > 0 ? totalTokens : null,
      estimated_cost_usd: usageComplete && calls > 0
        ? (
            inputTokens * pricing.input_per_million_tokens
            + outputTokens * pricing.output_per_million_tokens
          ) / 1_000_000
        : null,
    }),
  });
}

async function loadBlueprints(): Promise<Readonly<Record<NodeId, BlueprintSpec>>> {
  blueprintCache ??= Promise.all(NODE_IDS.map(async id => {
    const source = await readFile(blueprintPaths[id], 'utf8');
    const parsed = parseYaml(source) as Partial<BlueprintSpec>;
    if (
      typeof parsed.role !== 'string'
      || typeof parsed.prompt !== 'string'
      || !parsed.output_schema
      || typeof parsed.output_schema !== 'object'
    ) throw new TypeError(`Invalid comparison Blueprint: ${id}`);
    return [id, Object.freeze({
      role: parsed.role,
      prompt: parsed.prompt,
      output_schema: Object.freeze({ ...parsed.output_schema }),
    })] as const;
  })).then(entries => Object.freeze(Object.fromEntries(entries) as Record<NodeId, BlueprintSpec>));
  return blueprintCache;
}

function runtimeOptions(provider: Provider): RuntimeOptions {
  return {
    provider,
    model: provider.model,
    temperature: 0,
    maxRetry: 0,
    mcpConfigPath: 'disabled',
    pluginConfigPath: 'disabled',
    logToConsole: false,
    logToFile: false,
  };
}

function render(template: string, inputs: Readonly<Record<string, unknown>>): string {
  return template.replace(/\{\{\s*([a-zA-Z_][\w.-]*)\s*\}\}/gu, (_match, name: string) => {
    if (!Object.hasOwn(inputs, name)) throw new TypeError(`Missing agent-graph input: ${name}`);
    const value = inputs[name];
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}

function assertValidPlan(operations: readonly NodeId[]): void {
  if (
    operations.length === 5
    && operations[0] === 'extract-brief'
    && operations[1] === 'classify-brief'
    && operations[2] === 'summarize-brief'
    && new Set(operations.slice(3)).size === 2
    && operations.slice(3).includes('validate-brief')
    && operations.slice(3).includes('localize-brief')
  ) return;
  throw namedError('AGENT_GRAPH_PLAN_INVALID', 'Planner returned a dependency-invalid graph');
}

function field(source: string, name: string): string | undefined {
  return source.match(new RegExp(`^${name}:\\s*(.+)$`, 'imu'))?.[1]?.trim();
}

function factsField(source: string): string[] {
  const marker = /^Facts:\s*$/imu.exec(source);
  if (!marker) return [];
  return source
    .slice(marker.index + marker[0].length)
    .split(/\r?\n/u)
    .map(line => line.match(/^\s*-\s+(.+)$/u)?.[1]?.trim())
    .filter((value): value is string => Boolean(value));
}

function emptyUsage(): PublicationBriefBenchmarkUsage {
  return Object.freeze({
    provider_calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    estimated_cost_usd: 0,
  });
}

function requiredValue<T>(value: T | undefined, dependency: string): T {
  if (value !== undefined) return value;
  throw namedError('AGENT_GRAPH_DEPENDENCY_MISSING', `Missing graph dependency: ${dependency}`);
}

function tokenCount(value: number): number {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  throw new TypeError('Provider token usage must be a non-negative safe integer');
}

function compile(schema: Record<string, unknown>): ValidateFunction {
  return new Ajv2020({ allErrors: true, strict: false }).compile(schema);
}

function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}
