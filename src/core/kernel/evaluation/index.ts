/**
 * Coordinates evaluation responsibilities inside the PixieCore kernel.
 */

export { compareEvaluationOutput } from './comparators.js';
export {
  createEvaluationPropertyCorpus,
  EVALUATION_PROPERTY_CORPUS_SCHEMA,
  EvaluationPropertyCorpusError,
} from './property-corpus.js';
export { runBlueprintEvaluation, runBlueprintPlayground } from './runner.js';
export {
  BLUEPRINT_BENCHMARK_SCHEMA,
  runBlueprintBenchmark,
} from './benchmark.js';
export { renderBlueprintBenchmarkScorecard } from './scorecard.js';
export type {
  BlueprintBenchmarkArtifact,
  BlueprintBenchmarkOptions,
  BlueprintBenchmarkPricing,
  BlueprintBenchmarkRunContext,
  BlueprintBenchmarkRunResult,
  BlueprintBenchmarkScorecardOptions,
  BlueprintBenchmarkTarget,
  BlueprintBenchmarkTargetResult,
  BlueprintEvaluationCaseResult,
  BlueprintEvaluationCase,
  BlueprintEvaluationDataset,
  BlueprintEvaluationResultArtifact,
  BlueprintEvaluationRunOptions,
  BlueprintPlaygroundArtifact,
  BlueprintPlaygroundExecution,
  BlueprintPlaygroundMode,
  BlueprintPlaygroundRunOptions,
  BlueprintProviderPricing,
  BlueprintProviderUsage,
  CreateEvaluationPropertyCorpusOptions,
  CustomEvaluationComparison,
  EvaluationComparisonOptions,
  EvaluationComparisonPolicy,
  EvaluationComparisonResult,
  EvaluationCustomComparator,
  EvaluationCustomComparatorContext,
  EvaluationDifference,
  EvaluationDifferenceReason,
  EvaluationPropertyCase,
  EvaluationPropertyCorpus,
  EvaluationPropertyKind,
  ExactEvaluationComparison,
  FieldsEvaluationComparison,
  NumericToleranceEvaluationComparison,
  SchemaEvaluationComparison,
  SetEvaluationComparison,
} from '../../contracts/evaluation/index.js';
