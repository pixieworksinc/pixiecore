import { mkdir, open, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createProvider } from '@pixieworks/pixiecore';
import {
  renderBlueprintBenchmarkScorecard,
  runBlueprintBenchmark,
  type BlueprintBenchmarkPricing,
} from '@pixieworks/pixiecore/eval';

export interface ReferenceBenchmarkCommand {
  readonly datasetPath: string;
  readonly provider: string;
  readonly model: string;
  readonly targetId: string;
  readonly runsPerTarget: number;
  readonly seed: string;
  readonly release: string;
  readonly artifactPath: string;
  readonly scorecardPath: string;
  readonly methodology: string;
  readonly pricing?: BlueprintBenchmarkPricing;
  readonly pricingSource?: string;
}

const DEFAULT_METHODOLOGY =
  'Versioned dataset comparisons executed through the public PixieCore runtime.';

export function parseReferenceBenchmarkArgs(args: readonly string[]): ReferenceBenchmarkCommand {
  const { values } = parseArgs({
    args: [...args],
    strict: true,
    allowPositionals: false,
    options: {
      dataset: { type: 'string' },
      provider: { type: 'string' },
      model: { type: 'string' },
      'target-id': { type: 'string' },
      runs: { type: 'string', default: '3' },
      seed: { type: 'string' },
      release: { type: 'string' },
      artifact: { type: 'string' },
      scorecard: { type: 'string' },
      methodology: { type: 'string', default: DEFAULT_METHODOLOGY },
      currency: { type: 'string' },
      'input-price': { type: 'string' },
      'output-price': { type: 'string' },
      'pricing-source': { type: 'string' },
      'confirm-remote-cost': { type: 'boolean', default: false },
    },
  });
  if (!values['confirm-remote-cost']) {
    throw new TypeError(
      'Remote benchmark requires --confirm-remote-cost because provider calls may incur charges',
    );
  }
  const provider = required(values.provider, '--provider');
  const model = required(values.model, '--model');
  const command: ReferenceBenchmarkCommand = {
    datasetPath: required(values.dataset, '--dataset'),
    provider,
    model,
    targetId: optional(values['target-id']) ?? `${provider}:${model}`,
    runsPerTarget: positiveInteger(values.runs, '--runs'),
    seed: required(values.seed, '--seed'),
    release: required(values.release, '--release'),
    artifactPath: required(values.artifact, '--artifact'),
    scorecardPath: required(values.scorecard, '--scorecard'),
    methodology: required(values.methodology, '--methodology'),
    ...pricing(values),
  };
  if (resolve(command.artifactPath) === resolve(command.scorecardPath)) {
    throw new TypeError('--artifact and --scorecard must identify different files');
  }
  return Object.freeze(command);
}

export async function runReferenceBenchmark(
  command: ReferenceBenchmarkCommand,
): Promise<Readonly<{ artifactPath: string; scorecardPath: string }>> {
  const artifact = await runBlueprintBenchmark({
    datasetPath: command.datasetPath,
    runsPerTarget: command.runsPerTarget,
    seed: command.seed,
    targets: [{
      id: command.targetId,
      ...(command.pricing === undefined ? {} : { pricing: command.pricing }),
      createRuntimeOptions: () => ({
        provider: createProvider(command.provider, { model: command.model }),
        model: command.model,
        maxRetry: 0,
        mcpConfigPath: 'disabled',
        pluginConfigPath: 'disabled',
        logToConsole: false,
        logToFile: false,
      }),
    }],
  });
  const scorecard = renderBlueprintBenchmarkScorecard(artifact, {
    release: command.release,
    generatedAt: new Date().toISOString(),
    reproductionCommand: createReproductionCommand(command),
    methodology: command.methodology,
    ...(command.pricingSource === undefined ? {} : { pricingSource: command.pricingSource }),
  });
  const artifactPath = resolve(command.artifactPath);
  const scorecardPath = resolve(command.scorecardPath);
  await writeOutputs(
    artifactPath,
    `${JSON.stringify(artifact, null, 2)}\n`,
    scorecardPath,
    scorecard,
  );
  return Object.freeze({ artifactPath, scorecardPath });
}

export function createReproductionCommand(command: ReferenceBenchmarkCommand): string {
  const options = [
    ['dataset', command.datasetPath],
    ['provider', command.provider],
    ['model', command.model],
    ['target-id', command.targetId],
    ['runs', String(command.runsPerTarget)],
    ['seed', command.seed],
    ['release', command.release],
    ['artifact', command.artifactPath],
    ['scorecard', command.scorecardPath],
    ['methodology', command.methodology],
    ...(command.pricing === undefined ? [] : [
      ['currency', command.pricing.currency],
      ['input-price', String(command.pricing.inputPerMillionTokens)],
      ['output-price', String(command.pricing.outputPerMillionTokens)],
      ['pricing-source', command.pricingSource!],
    ]),
  ] as const;
  return [
    'npm run benchmark:reference --',
    ...options.map(([name, value]) => `--${name}=${shellQuote(value)}`),
    '--confirm-remote-cost',
  ].join(' ');
}

export function referenceBenchmarkUsage(): string {
  return `Usage:
  npm run benchmark:reference -- \\
    --dataset=<evaluation.yaml> --provider=<provider> --model=<model> \\
    --runs=<count> --seed=<seed> --release=<version> \\
    --artifact=<result.json> --scorecard=<scorecard.md> \\
    --confirm-remote-cost

Credentials are read only from the provider's documented environment variables.
Pricing is optional. When supplied, --currency, --input-price, --output-price,
and --pricing-source are all required.`;
}

function pricing(values: Readonly<{
  currency?: string;
  'input-price'?: string;
  'output-price'?: string;
  'pricing-source'?: string;
}>):
  | Readonly<{ pricing: BlueprintBenchmarkPricing; pricingSource: string }>
  | Readonly<Record<string, never>> {
  const fields = [
    values.currency,
    values['input-price'],
    values['output-price'],
    values['pricing-source'],
  ];
  if (fields.every(value => value === undefined)) return {};
  if (fields.some(value => value === undefined)) {
    throw new TypeError(
      '--currency, --input-price, --output-price, and --pricing-source must be supplied together',
    );
  }
  return {
    pricing: Object.freeze({
      currency: required(values.currency, '--currency'),
      inputPerMillionTokens: nonNegativeNumber(values['input-price'], '--input-price'),
      outputPerMillionTokens: nonNegativeNumber(values['output-price'], '--output-price'),
    }),
    pricingSource: required(values['pricing-source'], '--pricing-source'),
  };
}

function required(value: string | undefined, name: string): string {
  if (value?.trim()) return value.trim();
  throw new TypeError(`${name} is required and must be non-blank`);
}

function optional(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function positiveInteger(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 100) return parsed;
  throw new TypeError(`${name} must be an integer from 1 through 100`);
}

function nonNegativeNumber(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  throw new TypeError(`${name} must be a non-negative number`);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function writeOutputs(
  artifactPath: string,
  artifact: string,
  scorecardPath: string,
  scorecard: string,
): Promise<void> {
  await Promise.all([
    mkdir(dirname(artifactPath), { recursive: true }),
    mkdir(dirname(scorecardPath), { recursive: true }),
  ]);
  let artifactFile: FileHandle | undefined;
  let scorecardFile: FileHandle | undefined;
  try {
    artifactFile = await open(artifactPath, 'wx');
    scorecardFile = await open(scorecardPath, 'wx');
    await Promise.all([
      artifactFile.writeFile(artifact, 'utf8'),
      scorecardFile.writeFile(scorecard, 'utf8'),
    ]);
  } catch (error) {
    await Promise.allSettled([
      artifactFile?.close(),
      scorecardFile?.close(),
    ]);
    await Promise.allSettled([
      ...(artifactFile === undefined ? [] : [unlink(artifactPath)]),
      ...(scorecardFile === undefined ? [] : [unlink(scorecardPath)]),
    ]);
    throw error;
  }
  await Promise.all([artifactFile.close(), scorecardFile.close()]);
}

async function main(): Promise<void> {
  if (process.argv.slice(2).includes('--help')) {
    console.log(referenceBenchmarkUsage());
    return;
  }
  const output = await runReferenceBenchmark(parseReferenceBenchmarkArgs(process.argv.slice(2)));
  console.log(`Benchmark artifact: ${output.artifactPath}`);
  console.log(`Benchmark scorecard: ${output.scorecardPath}`);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
