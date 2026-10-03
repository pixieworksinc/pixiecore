import { createHash } from 'node:crypto';

const UINT48_RANGE = 0x1_0000_0000_0000;
const DEFAULT_DATE_START = Date.UTC(2000, 0, 1);
const DEFAULT_DATE_END = Date.UTC(2030, 11, 31);

/**
 * The test runner supplies one generated seed for a whole test command.
 * Direct node:test invocations must explicitly provide TEST_SEED so workers
 * cannot silently derive different fixtures. Explicit seeds are reserved for
 * reproducibility tests and failure replay.
 */
export interface TestData {
  readonly seed: string;
  text(label: string, prefix?: string): string;
  person(label: string): string;
  integer(label: string, minimum: number, maximum: number): number;
  decimal(label: string, minimum: number, maximum: number, scale?: number): number;
  date(label: string, start?: Date, end?: Date): Date;
  isoDate(label: string, start?: Date, end?: Date): string;
}

/** Produces independently derived fixture values that are reproducible by seed. */
export function testData(scope: string, seed = requiredTestSeed()): TestData {
  assertNonBlank(scope, 'scope');
  assertNonBlank(seed, 'seed');

  const digest = (label: string): Buffer => {
    assertNonBlank(label, 'label');
    return createHash('sha256').update(`${seed}\u0000${scope}\u0000${label}`).digest();
  };
  const integer = (label: string, minimum: number, maximum: number): number => {
    assertIntegerRange(minimum, maximum);
    const span = maximum - minimum + 1;
    const fraction = digest(label).readUIntBE(0, 6) / UINT48_RANGE;
    return minimum + Math.floor(fraction * span);
  };

  return {
    seed,
    text(label, prefix = 'value'): string {
      assertNonBlank(prefix, 'prefix');
      return `${safePrefix(prefix)}_${digest(label).toString('hex').slice(0, 12)}`;
    },
    person(label): string {
      return `Person_${digest(label).toString('hex').slice(0, 10)}`;
    },
    integer,
    decimal(label, minimum, maximum, scale = 2): number {
      if (!Number.isInteger(scale) || scale < 1 || scale > 6) {
        throw new RangeError('decimal scale must be an integer from 1 through 6');
      }
      if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum >= maximum) {
        throw new RangeError('decimal range must contain more than one value');
      }
      const factor = 10 ** scale;
      const minimumScaled = Math.ceil(minimum * factor);
      const maximumScaled = Math.floor(maximum * factor);
      const nonInteger = findNonIntegerScaledValue(
        integer(label, minimumScaled, maximumScaled),
        minimumScaled,
        maximumScaled,
        factor,
      );
      if (nonInteger === undefined) {
        throw new RangeError('decimal range must contain a non-integer value at the requested scale');
      }
      return nonInteger / factor;
    },
    date(label, start = new Date(DEFAULT_DATE_START), end = new Date(DEFAULT_DATE_END)): Date {
      const startTime = start.getTime();
      const endTime = end.getTime();
      if (!Number.isSafeInteger(startTime) || !Number.isSafeInteger(endTime) || startTime > endTime) {
        throw new RangeError('date range must contain valid ascending timestamps');
      }
      return new Date(integer(label, startTime, endTime));
    },
    isoDate(label, start, end): string {
      return this.date(label, start, end).toISOString().slice(0, 10);
    },
  };
}

function findNonIntegerScaledValue(
  candidate: number,
  minimum: number,
  maximum: number,
  factor: number,
): number | undefined {
  if (candidate % factor !== 0) return candidate;
  if (candidate < maximum) return candidate + 1;
  if (candidate > minimum) return candidate - 1;
  return undefined;
}

function assertNonBlank(value: string, name: string): void {
  if (value.trim()) return;
  throw new TypeError(`${name} must be non-blank`);
}

function assertIntegerRange(minimum: number, maximum: number): void {
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || minimum > maximum) {
    throw new RangeError('integer range must use ascending safe integers');
  }
  if (maximum - minimum >= UINT48_RANGE) {
    throw new RangeError('integer range must contain fewer than 2^48 values');
  }
}

function safePrefix(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '_');
}

function requiredTestSeed(): string {
  const seed = process.env.TEST_SEED?.trim();
  if (seed) return seed;
  throw new Error('TEST_SEED is required; run tests through scripts/run-tests.mjs or set TEST_SEED');
}
