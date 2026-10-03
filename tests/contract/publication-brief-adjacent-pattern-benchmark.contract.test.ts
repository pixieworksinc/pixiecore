import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { GenerateRequest, GenerateResponse, Provider } from '../../src/index.js';
import { createPublicationBriefApproachExecutors } from '../../examples/comparison/publication-brief/benchmark-approaches.js';
import type {
  PublicationBriefBenchmarkAssertions,
  PublicationBriefBenchmarkDataset,
} from '../../examples/comparison/publication-brief/benchmark-contract.js';
import {
  compareResult,
  createPublicationBriefBenchmarkPlan,
  parsePublicationBriefBenchmarkArgs,
  reviewPublicationBriefBenchmarkEvidence,
  runPublicationBriefBenchmark,
} from '../../examples/comparison/publication-brief/benchmark.js';
import { testData } from '../helpers/test-data.js';
import { withTempDirectory } from '../helpers/temp.js';

const data = testData('publication brief adjacent pattern benchmark');
const datasetPath = 'examples/comparison/publication-brief/benchmark-dataset.json';

test('adjacent-pattern plan fixes identical cases, four approaches, and explicit live limits', async () => {
  const command = parsePublicationBriefBenchmarkArgs([
    `--run-id=${data.text('dry run id', 'run').toLowerCase()}`,
    `--seed=${data.text('dry run seed', 'seed')}`,
    '--runs=3',
    '--dry-run',
  ]);
  const plan = await createPublicationBriefBenchmarkPlan(command);
  assert.equal(plan.cases, 4);
  assert.equal(plan.expected_provider_calls, 144);
  assert.deepEqual(plan.approaches, [
    'pixiecore-composed',
    'monolithic-prompt',
    'agent-graph',
    'code-only',
  ]);
  assert.equal(plan.model, 'gpt-4.1-mini-2025-04-14');

  assert.throws(
    () => parsePublicationBriefBenchmarkArgs([
      `--run-id=${data.text('missing confirmation id', 'run').toLowerCase()}`,
      `--seed=${data.text('missing confirmation seed', 'seed')}`,
    ]),
    /--confirm-remote-cost/u,
  );
});

test('all four executable approaches share the typed output and expose their call shape', async () => {
  const dataset = await loadDataset();
  const benchmarkCase = dataset.cases[0]!;
  const expected = resultFromAssertions(benchmarkCase.assertions);
  const providers: SmartProvider[] = [];
  const executors = createPublicationBriefApproachExecutors({
    pricing: { input_per_million_tokens: 0.4, output_per_million_tokens: 1.6 },
    createProvider: () => {
      const provider = new SmartProvider(expected);
      providers.push(provider);
      return provider;
    },
  });
  const calls: Record<string, number> = {};
  for (const executor of executors) {
    const execution = await executor.execute({
      sourceText: benchmarkCase.input.source_text,
      locale: benchmarkCase.input.locale,
    }, { run: 1, caseId: benchmarkCase.id });
    assert.deepEqual(compareResult(execution.result, benchmarkCase.assertions), []);
    calls[executor.id] = execution.usage.provider_calls;
  }
  assert.deepEqual(calls, {
    'pixiecore-composed': 5,
    'monolithic-prompt': 1,
    'agent-graph': 6,
    'code-only': 0,
  });
  assert.equal(providers.reduce((total, provider) => total + provider.calls, 0), 12);
});

test('offline provider doubles produce a schema-valid value-free completed report', async () => {
  await withTempDirectory(async directory => {
    const dataset = await loadDataset();
    const byCase = new Map(dataset.cases.map(item => [
      item.id,
      resultFromAssertions(item.assertions),
    ]));
    const command = parsePublicationBriefBenchmarkArgs([
      `--dataset=${datasetPath}`,
      `--output-root=${directory}`,
      `--run-id=${data.text('offline report id', 'report').toLowerCase()}`,
      `--seed=${data.text('offline report seed', 'seed')}`,
      '--runs=1',
      '--confirm-remote-cost',
      '--confirm-key-rotated',
      '--max-calls=144',
      '--max-budget-usd=0.5',
    ]);
    const output = await runPublicationBriefBenchmark(command, {
      environment: { OPENAI_API_KEY: 'test-only' },
      createExecutors: () => createPublicationBriefApproachExecutors({
        pricing: { input_per_million_tokens: 0.4, output_per_million_tokens: 1.6 },
        createProvider: (_approach, context) => new SmartProvider(byCase.get(context.caseId)!),
      }),
    });
    const report = JSON.parse(await readFile(output.reportPath!, 'utf8')) as {
      status: string;
      approaches: Array<{ id: string; summary: { total: number; passed: number; errors: number } }>;
      limitations: string[];
    };
    assert.equal(report.status, 'completed');
    assert.equal(report.approaches.length, 4);
    assert.deepEqual(
      report.approaches.map(item => [item.id, item.summary.total]),
      [
        ['pixiecore-composed', 4],
        ['monolithic-prompt', 4],
        ['agent-graph', 4],
        ['code-only', 4],
      ],
    );
    assert.equal(report.approaches.find(item => item.id === 'code-only')?.summary.errors, 2);
    assert.ok(report.limitations.some(item => item.includes('not a universal architecture ranking')));
    assert.doesNotMatch(JSON.stringify(report), /Orion typed export release/u);

    const reviewed = await reviewPublicationBriefBenchmarkEvidence({
      reportPath: output.reportPath!,
      datasetPath,
      outputReportPath: `${directory}/reviewed-report.json`,
      outputScorecardPath: `${directory}/reviewed-scorecard.md`,
    });
    const reviewedReport = JSON.parse(await readFile(reviewed.reportPath, 'utf8')) as {
      approaches: Array<{
        id: string;
        assertion_summary: { total: number; passed: number; failed: number };
        assertion_accuracy: number;
        usage: {
          provider_calls: number;
          input_tokens: number | null;
          output_tokens: number | null;
          total_tokens: number | null;
          estimated_cost_usd: number | null;
        };
      }>;
    };
    assert.ok(reviewedReport.approaches.every(item => item.assertion_summary.total > 0));
    const codeOnlyAccuracy = reviewedReport.approaches
      .find(item => item.id === 'code-only')?.assertion_accuracy;
    assert.ok(codeOnlyAccuracy !== undefined && codeOnlyAccuracy > 0 && codeOnlyAccuracy < 1);
    assert.deepEqual(
      reviewedReport.approaches.find(item => item.id === 'code-only')?.usage,
      {
        provider_calls: 0,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        estimated_cost_usd: 0,
      },
    );
  }, 'pixiecore-adjacent-pattern-');
});

class SmartProvider implements Provider {
  readonly name = 'fake';
  readonly model = 'fake-structured';
  readonly supportsTools = false;
  readonly supportsMultimodal = false;
  calls = 0;

  constructor(private readonly result: ReturnType<typeof resultFromAssertions>) {}

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    this.calls++;
    const properties = (request.schema?.properties ?? {}) as Record<string, unknown>;
    let content: unknown;
    if ('operations' in properties) {
      content = { operations: [
        'extract-brief',
        'classify-brief',
        'summarize-brief',
        'validate-brief',
        'localize-brief',
      ] };
    } else if ('extraction' in properties) content = this.result;
    else if ('title' in properties) content = this.result.extraction;
    else if ('category' in properties) content = this.result.classification;
    else if ('summary' in properties) content = this.result.summary;
    else if ('valid' in properties) content = this.result.validation;
    else if ('locale' in properties) content = this.result.localization;
    else throw new Error('Unknown test schema');
    return {
      content: JSON.stringify(content),
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };
  }

  supportsVision(): boolean { return false; }
  supportsFileInput(): boolean { return false; }
  async getModelList(): Promise<string[]> { return [this.model]; }
}

async function loadDataset(): Promise<PublicationBriefBenchmarkDataset> {
  return JSON.parse(await readFile(datasetPath, 'utf8')) as PublicationBriefBenchmarkDataset;
}

function resultFromAssertions(assertions: PublicationBriefBenchmarkAssertions) {
  const summary = assertions.summary_terms.join(' ');
  return {
    extraction: {
      title: assertions.title_terms.join(' '),
      audience: assertions.audience_terms.join(' '),
      facts: [...assertions.fact_terms],
    },
    classification: {
      category: assertions.category,
      rationale: 'Fixture rationale',
    },
    summary: { summary },
    validation: { valid: assertions.valid, issues: [] },
    localization: {
      locale: assertions.locale,
      localized_summary: assertions.localized_summary_terms.join(' '),
    },
  } as const;
}
