/**
 * Provides deterministic provenance checks for natural-language summaries.
 *
 * This comparator deliberately does not attempt to judge prose similarity.
 * It checks the typed facts and traceability invariants a summarizer can prove
 * without an additional model call.
 */

import type {
  EvaluationComparisonResult,
  EvaluationCustomComparator,
  EvaluationCustomComparatorContext,
  EvaluationDifference,
} from '../../contracts/evaluation/index.js';
import type { JsonObject } from '../../contracts/types/index.js';

/** Identifies the built-in deterministic traceable-summary comparator. */
export const TRACEABLE_SUMMARY_COMPARATOR_ID = 'pixiecore.traceable-summary-v1';

interface TraceableSummaryConfig {
  readonly sourceFields: readonly string[];
  readonly priority: readonly string[];
}

const comparators = new Map<string, EvaluationCustomComparator>([
  [TRACEABLE_SUMMARY_COMPARATOR_ID, compareTraceableSummary],
]);

/**
 * Returns a PixieCore-owned custom comparator when the identifier is reserved.
 *
 * A caller cannot replace a built-in comparator through the supplied custom
 * map. This keeps versioned dataset semantics stable across evaluation hosts.
 */
export function getBuiltInEvaluationComparator(
  comparatorId: string,
): EvaluationCustomComparator | undefined {
  return comparators.get(comparatorId);
}

/**
 * Validates a summary by using its claim provenance and source-field partition.
 *
 * The result is deterministic: it does not call a provider, embed an evaluator
 * model, or accept a sentence merely because it resembles the expected prose.
 */
function compareTraceableSummary(
  context: EvaluationCustomComparatorContext,
): EvaluationComparisonResult {
  const differences: EvaluationDifference[] = [];
  const config = parseConfig(context.config, differences);
  const inputs = context.inputs;
  if (!inputs) {
    differences.push(difference('/inputs', 'traceable summary comparison requires case inputs'));
    return comparison(differences);
  }
  if (!config) return comparison(differences);

  const maxCharacters = inputs.max_characters;
  const validMaximum = typeof maxCharacters === 'number'
    && Number.isSafeInteger(maxCharacters)
    && maxCharacters >= 1;
  if (!validMaximum) {
    differences.push(difference('/inputs/max_characters', 'must be a positive safe integer'));
  }

  const available = new Map(config.sourceFields.map(field => [
    field,
    hasSuppliedValue(readInputField(inputs, field)),
  ]));
  const expectedStatus = [...available.values()].some(Boolean)
    ? 'summarized'
    : 'insufficient_facts';
  if (context.actual.status !== expectedStatus) {
    differences.push(difference('/status', `must be ${expectedStatus}`));
  }

  const summary = context.actual.summary;
  if (expectedStatus === 'insufficient_facts') {
    validateInsufficientResult(context.actual, config.sourceFields, differences);
    return comparison(differences);
  }

  if (typeof summary !== 'string' || !summary.trim()) {
    differences.push(difference('/summary', 'must be a non-blank string'));
  } else {
    validateSummaryLength(
      summary,
      context.actual.character_count,
      validMaximum ? maxCharacters : undefined,
      differences,
    );
  }

  const partition = validateSourcePartition(context.actual, config, available, differences);
  if (typeof summary === 'string' && summary.trim()) {
    validateClaimCoverage(summary, partition.claimTexts, differences);
  }
  validatePriority(partition.claimed, partition.omitted, config.priority, differences);
  return comparison(differences);
}

function parseConfig(
  value: Readonly<JsonObject>,
  differences: EvaluationDifference[],
): TraceableSummaryConfig | undefined {
  const sourceFields = stringArray(value.source_fields, '/config/source_fields', differences);
  if (!sourceFields?.length) {
    differences.push(difference('/config/source_fields', 'must contain at least one unique source field'));
    return undefined;
  }
  if (new Set(sourceFields).size !== sourceFields.length) {
    differences.push(difference('/config/source_fields', 'must not contain duplicate source fields'));
    return undefined;
  }
  const priority = value.priority === undefined
    ? sourceFields
    : stringArray(value.priority, '/config/priority', differences);
  if (!priority?.length) {
    differences.push(difference('/config/priority', 'must contain every source field'));
    return undefined;
  }
  if (!sameSet(priority, sourceFields) || priority.length !== sourceFields.length) {
    differences.push(difference('/config/priority', 'must be an ordered permutation of source_fields'));
    return undefined;
  }
  return Object.freeze({ sourceFields: Object.freeze([...sourceFields]), priority: Object.freeze([...priority]) });
}

function validateInsufficientResult(
  actual: Readonly<JsonObject>,
  sourceFields: readonly string[],
  differences: EvaluationDifference[],
): void {
  if (actual.summary !== null) differences.push(difference('/summary', 'must be null when no source facts exist'));
  if (actual.character_count !== 0) differences.push(difference('/character_count', 'must be 0 when no source facts exist'));
  if (!Array.isArray(actual.claims) || actual.claims.length !== 0) {
    differences.push(difference('/claims', 'must be empty when no source facts exist'));
  }
  if (!Array.isArray(actual.omitted_source_fields) || actual.omitted_source_fields.length !== 0) {
    differences.push(difference('/omitted_source_fields', 'must be empty when no source facts exist'));
  }
  const missing = stringArray(actual.missing_source_fields, '/missing_source_fields', differences);
  if (!missing || !sameSet(missing, sourceFields) || missing.length !== sourceFields.length) {
    differences.push(difference('/missing_source_fields', 'must list every unavailable source field exactly once'));
  }
}

function validateSummaryLength(
  summary: string,
  characterCount: unknown,
  maxCharacters: unknown,
  differences: EvaluationDifference[],
): void {
  const count = [...summary].length;
  if (characterCount !== count) {
    differences.push(difference('/character_count', 'must equal the Unicode code-point length of summary'));
  }
  if (typeof maxCharacters === 'number' && count > maxCharacters) {
    differences.push(difference('/summary', 'exceeds input max_characters'));
  }
}

function validateSourcePartition(
  actual: Readonly<JsonObject>,
  config: TraceableSummaryConfig,
  available: ReadonlyMap<string, boolean>,
  differences: EvaluationDifference[],
): Readonly<{
  claimed: ReadonlySet<string>;
  omitted: ReadonlySet<string>;
  claimTexts: readonly string[];
}> {
  const counts = new Map(config.sourceFields.map(field => [field, 0]));
  const claimed = new Set<string>();
  const claimTexts: string[] = [];
  const claims = actual.claims;
  if (!Array.isArray(claims) || claims.length === 0) {
    differences.push(difference('/claims', 'must contain at least one traceable claim'));
  } else {
    claims.forEach((claim, index) => {
      if (!isJsonObject(claim)) {
        differences.push(difference(`/claims/${index}`, 'must be an object'));
        return;
      }
      if (typeof claim.text !== 'string' || !claim.text.trim()) {
        differences.push(difference(`/claims/${index}/text`, 'must be a non-blank string'));
      } else {
        claimTexts.push(claim.text);
      }
      const fields = stringArray(claim.source_fields, `/claims/${index}/source_fields`, differences);
      if (!fields?.length) {
        differences.push(difference(`/claims/${index}/source_fields`, 'must contain at least one source field'));
        return;
      }
      for (const field of fields) countField(field, counts, claimed, differences, `/claims/${index}/source_fields`);
    });
  }

  const omitted = validatePartitionList(
    actual.omitted_source_fields,
    '/omitted_source_fields',
    counts,
    differences,
  );
  const missing = validatePartitionList(
    actual.missing_source_fields,
    '/missing_source_fields',
    counts,
    differences,
  );

  for (const field of config.sourceFields) {
    const count = counts.get(field) ?? 0;
    if (count !== 1) {
      differences.push(difference('/claims', `source field ${field} must appear exactly once in the partition`));
    }
    if (available.get(field) && missing.has(field)) {
      differences.push(difference('/missing_source_fields', `provided source field ${field} cannot be missing`));
    }
    if (!available.get(field) && !missing.has(field)) {
      differences.push(difference('/missing_source_fields', `unavailable source field ${field} must be missing`));
    }
  }
  return Object.freeze({
    claimed: claimed,
    omitted,
    claimTexts: Object.freeze(claimTexts),
  });
}

function validatePartitionList(
  value: unknown,
  pointer: string,
  counts: Map<string, number>,
  differences: EvaluationDifference[],
): ReadonlySet<string> {
  const fields = stringArray(value, pointer, differences) ?? [];
  const accepted = new Set<string>();
  for (const field of fields) {
    if (accepted.has(field)) {
      differences.push(difference(pointer, `source field ${field} appears more than once`));
      continue;
    }
    accepted.add(field);
    countField(field, counts, undefined, differences, pointer);
  }
  return accepted;
}

function countField(
  field: string,
  counts: Map<string, number>,
  claimed: Set<string> | undefined,
  differences: EvaluationDifference[],
  pointer: string,
): void {
  const count = counts.get(field);
  if (count === undefined) {
    differences.push(difference(pointer, `unknown source field ${field}`));
    return;
  }
  counts.set(field, count + 1);
  claimed?.add(field);
}

function validateClaimCoverage(
  summary: string,
  claimTexts: readonly string[],
  differences: EvaluationDifference[],
): void {
  let residue = summary;
  for (const claim of claimTexts) residue = residue.replace(claim, '');
  if (/[\p{L}\p{N}]/u.test(residue)) {
    differences.push(difference('/summary', 'contains meaningful text outside declared claims'));
  }
}

function validatePriority(
  claimed: ReadonlySet<string>,
  omitted: ReadonlySet<string>,
  priority: readonly string[],
  differences: EvaluationDifference[],
): void {
  for (let index = 0; index < priority.length; index++) {
    const higher = priority[index]!;
    if (!omitted.has(higher)) continue;
    const lowerIncluded = priority.slice(index + 1).find(field => claimed.has(field));
    if (lowerIncluded !== undefined) {
      differences.push(difference(
        '/omitted_source_fields',
        `cannot omit higher-priority ${higher} while claiming ${lowerIncluded}`,
      ));
    }
  }
}

function readInputField(inputs: Readonly<JsonObject>, field: string): unknown {
  let current: unknown = inputs;
  for (const segment of field.split('.')) {
    if (!isJsonObject(current) || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function hasSuppliedValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function stringArray(
  value: unknown,
  pointer: string,
  differences: EvaluationDifference[],
): readonly string[] | undefined {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    differences.push(difference(pointer, 'must be an array of non-blank strings'));
    return undefined;
  }
  return value;
}

function sameSet(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every(value => second.includes(value));
}

function isJsonObject(value: unknown): value is Readonly<JsonObject> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function difference(pointer: string, detail: string): EvaluationDifference {
  return Object.freeze({ pointer, reason: 'not_equal', detail });
}

function comparison(differences: readonly EvaluationDifference[]): EvaluationComparisonResult {
  return Object.freeze({
    passed: differences.length === 0,
    differences: Object.freeze([...differences]),
  });
}
