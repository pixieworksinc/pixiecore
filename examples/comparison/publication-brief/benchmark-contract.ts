import type { Provider } from '@pixieworks/pixiecore';
import type {
  PublicationBriefInput,
  PublicationBriefResult,
} from '../../application-composition/publication-brief.js';

export const PUBLICATION_BRIEF_BENCHMARK_APPROACHES = Object.freeze([
  'pixiecore-composed',
  'monolithic-prompt',
  'agent-graph',
  'code-only',
] as const);

export type PublicationBriefBenchmarkApproach =
  typeof PUBLICATION_BRIEF_BENCHMARK_APPROACHES[number];

export interface PublicationBriefBenchmarkAssertions {
  readonly title_terms: readonly string[];
  readonly audience_terms: readonly string[];
  readonly fact_terms: readonly string[];
  readonly category: 'operations' | 'policy' | 'product' | 'other';
  readonly summary_terms: readonly string[];
  readonly valid: boolean;
  readonly locale: string;
  readonly localized_summary_terms: readonly string[];
}

export interface PublicationBriefBenchmarkCase {
  readonly id: string;
  readonly input: Readonly<{
    source_text: string;
    locale: string;
  }>;
  readonly assertions: PublicationBriefBenchmarkAssertions;
}

export interface PublicationBriefBenchmarkDataset {
  readonly schema: 'pixiecore.publication-brief-comparison-dataset/v1';
  readonly name: string;
  readonly version: string;
  readonly sensitivity: 'synthetic';
  readonly cases: readonly PublicationBriefBenchmarkCase[];
}

export interface PublicationBriefBenchmarkUsage {
  readonly provider_calls: number;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly total_tokens: number | null;
  readonly estimated_cost_usd: number | null;
}

export interface PublicationBriefApproachExecution {
  readonly result: PublicationBriefResult;
  readonly usage: PublicationBriefBenchmarkUsage;
}

export interface PublicationBriefApproachExecutor {
  readonly id: PublicationBriefBenchmarkApproach;
  execute(
    input: Readonly<PublicationBriefInput>,
    context: Readonly<{ run: number; caseId: string; signal?: AbortSignal }>,
  ): Promise<PublicationBriefApproachExecution>;
}

export type PublicationBriefBenchmarkProviderFactory = (
  approach: Exclude<PublicationBriefBenchmarkApproach, 'code-only'>,
  context: Readonly<{ run: number; caseId: string }>,
) => Provider;

export interface PublicationBriefBenchmarkPricing {
  readonly input_per_million_tokens: number;
  readonly output_per_million_tokens: number;
}

export interface PublicationBriefBenchmarkArchitecture {
  readonly provider_calls_per_case: number;
  readonly independently_testable_units: number;
  readonly cognitive_operations: 5;
  readonly orchestration_owner: 'pixiecore-application' | 'single-prompt' | 'model-planner' | 'host-code';
}

export const PUBLICATION_BRIEF_BENCHMARK_ARCHITECTURE: Readonly<
  Record<PublicationBriefBenchmarkApproach, PublicationBriefBenchmarkArchitecture>
> = Object.freeze({
  'pixiecore-composed': Object.freeze({
    provider_calls_per_case: 5,
    independently_testable_units: 5,
    cognitive_operations: 5,
    orchestration_owner: 'pixiecore-application',
  }),
  'monolithic-prompt': Object.freeze({
    provider_calls_per_case: 1,
    independently_testable_units: 1,
    cognitive_operations: 5,
    orchestration_owner: 'single-prompt',
  }),
  'agent-graph': Object.freeze({
    provider_calls_per_case: 6,
    independently_testable_units: 6,
    cognitive_operations: 5,
    orchestration_owner: 'model-planner',
  }),
  'code-only': Object.freeze({
    provider_calls_per_case: 0,
    independently_testable_units: 5,
    cognitive_operations: 5,
    orchestration_owner: 'host-code',
  }),
});
