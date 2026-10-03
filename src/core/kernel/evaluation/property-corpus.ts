/**
 * Coordinates property corpus responsibilities inside the PixieCore kernel.
 */

import { createHash } from 'node:crypto';
import { PixieCoreError } from '../../contracts/errors/index.js';
import type {
  CreateEvaluationPropertyCorpusOptions,
  EvaluationPropertyCase,
  EvaluationPropertyCorpus,
  EvaluationPropertyKind,
} from '../../contracts/evaluation/index.js';
import type { JsonValue } from '../../contracts/types/index.js';

export const EVALUATION_PROPERTY_CORPUS_SCHEMA =
  'pixiecore.evaluation-property-corpus/v1' as const;

const PROPERTY_KINDS = Object.freeze([
  'date',
  'amount',
  'locale',
  'unicode',
  'whitespace',
  'boundary',
] as const satisfies readonly EvaluationPropertyKind[]);
const DEFAULT_CASES_PER_KIND = 8;
const MAX_CASES_PER_KIND = 1_000;
const DAY_MILLISECONDS = 86_400_000;
const DATE_START = Date.UTC(1970, 0, 1);
const DATE_END = Date.UTC(2099, 11, 31);
const LOCALES = Object.freeze([
  'en-US', 'ja-JP', 'fr-FR', 'de-DE', 'ar-EG', 'zh-Hant-TW',
]);
const UNICODE_SAMPLES = Object.freeze([
  'Caf\u00e9',
  'Cafe\u0301',
  '\u6771\u4eac',
  '\ud83d\udc69\u200d\ud83d\udcbb',
  '\u0645\u0631\u062d\u0628\u0627',
  '\ud83c\uddef\ud83c\uddf5',
]);
const WHITESPACE_SAMPLES = Object.freeze([
  '', ' ', '\t', '\n', '\r\n', '\u00a0', '\u3000', ' \t\n\u00a0\u3000 ',
]);
const BOUNDARY_SAMPLES = Object.freeze([
  Number.MIN_SAFE_INTEGER,
  -1,
  0,
  1,
  Number.MAX_SAFE_INTEGER,
]);

/**
 * Reports evaluation property corpus failures.
 */
export class EvaluationPropertyCorpusError extends PixieCoreError {
  /**
   * Creates a EvaluationPropertyCorpusError with the supplied failure context.
   */
  constructor(message: string) {
    super(message, 'evaluation_property_corpus_error');
  }
}

/**
 * Creates evaluation property corpus after validating the supplied contract.
 */
export function createEvaluationPropertyCorpus(
  options: CreateEvaluationPropertyCorpusOptions,
): EvaluationPropertyCorpus {
  const seed = nonBlank(options.seed, 'seed');
  const casesPerKind = options.casesPerKind ?? DEFAULT_CASES_PER_KIND;
  if (
    !Number.isSafeInteger(casesPerKind)
    || casesPerKind < 1
    || casesPerKind > MAX_CASES_PER_KIND
  ) {
    throw new EvaluationPropertyCorpusError(
      `casesPerKind must be a safe integer from 1 through ${MAX_CASES_PER_KIND}`,
    );
  }

  const cases = PROPERTY_KINDS.flatMap(kind => (
    Array.from({ length: casesPerKind }, (_, ordinal) => (
      propertyCase(seed, kind, ordinal)
    ))
  ));
  return Object.freeze({
    schema: EVALUATION_PROPERTY_CORPUS_SCHEMA,
    seed,
    cases_per_kind: casesPerKind,
    cases: Object.freeze(cases),
  });
}

export type {
  CreateEvaluationPropertyCorpusOptions,
  EvaluationPropertyCase,
  EvaluationPropertyCorpus,
  EvaluationPropertyKind,
} from '../../contracts/evaluation/index.js';

function propertyCase(
  seed: string,
  kind: EvaluationPropertyKind,
  ordinal: number,
): EvaluationPropertyCase {
  const digest = createHash('sha256').update(`${seed}\u0000${kind}\u0000${ordinal}`).digest();
  return Object.freeze({
    id: `${kind}-${ordinal + 1}-${digest.toString('hex').slice(0, 10)}`,
    kind,
    ordinal,
    value: propertyValue(kind, digest, ordinal),
    tags: Object.freeze(['property', 'seeded', kind, ordinal < 2 ? 'anchor' : 'generated']),
  });
}

function propertyValue(
  kind: EvaluationPropertyKind,
  digest: Buffer,
  ordinal: number,
): JsonValue {
  switch (kind) {
    case 'date': return dateValue(digest, ordinal);
    case 'amount': return amountValue(digest, ordinal);
    case 'locale': return LOCALES[ordinal % LOCALES.length]!;
    case 'unicode': return `${UNICODE_SAMPLES[ordinal % UNICODE_SAMPLES.length]!}-${suffix(digest)}`;
    case 'whitespace': return WHITESPACE_SAMPLES[ordinal % WHITESPACE_SAMPLES.length]!;
    case 'boundary': return BOUNDARY_SAMPLES[ordinal % BOUNDARY_SAMPLES.length]!;
  }
}

function dateValue(digest: Buffer, ordinal: number): string {
  if (ordinal === 0) return '2000-02-29';
  if (ordinal === 1) return '2100-02-28';
  const days = Math.floor((DATE_END - DATE_START) / DAY_MILLISECONDS);
  const offset = uint48(digest) % (days + 1);
  return new Date(DATE_START + offset * DAY_MILLISECONDS).toISOString().slice(0, 10);
}

function amountValue(digest: Buffer, ordinal: number): number {
  if (ordinal === 0) return 0;
  if (ordinal === 1) return -0.01;
  const cents = uint48(digest) % 100_000_001;
  return cents / 100;
}

function uint48(digest: Buffer): number {
  return digest.readUIntBE(0, 6);
}

function suffix(digest: Buffer): string {
  return digest.toString('hex').slice(12, 20);
}

function nonBlank(value: string, name: string): string {
  if (typeof value === 'string' && value.trim()) return value;
  throw new EvaluationPropertyCorpusError(`${name} must be a non-blank string`);
}
