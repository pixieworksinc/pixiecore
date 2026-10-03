/** Immutable full-suite shard descriptor. */
export interface TestShard {
  readonly id: string;
  readonly files: readonly string[];
  readonly isolated: boolean;
  readonly estimatedDurationMs: number;
}

/** Result of one completed test shard. */
export interface TestShardResult {
  readonly id: string;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  /** Wall-clock duration observed for this spawned shard process. */
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Value-free profile recorded from one full-suite shard execution. */
export interface TestShardProfile {
  readonly schema: 'pixiecore.test-shard-profile/v1';
  readonly node_version: string;
  readonly platform: string;
  readonly architecture: string;
  readonly shard_concurrency: number;
  readonly test_seed: string | null;
  readonly shards: readonly {
    readonly id: string;
    readonly file_count: number;
    readonly estimated_duration_ms: number;
    readonly observed_duration_ms: number;
    readonly estimate_difference_ratio: number;
    readonly estimate_needs_review: boolean;
  }[];
}

/** Aggregated TAP counters from all shards. */
export interface TestShardTotals {
  readonly tests: number;
  readonly pass: number;
  readonly fail: number;
  readonly skipped: number;
}

/** Creates the complete, non-overlapping full-suite shard catalog. */
export function createTestShards(repositoryRoot?: string): readonly TestShard[];

/** Creates version-stable Node.js test-runner arguments for one shard. */
export function createTestShardArguments(
  descriptor: Pick<TestShard, 'files' | 'isolated'>,
): readonly string[];

/** Resolves the bounded local test-shard concurrency setting. */
export function resolveTestShardConcurrency(value?: string): number;

/** Resolves an optional profile path only when it remains inside the repository. */
export function resolveTestShardProfilePath(
  repositoryRoot: string,
  configuredPath?: string,
): string | undefined;

/** Returns the longest-first execution order without changing catalog order. */
export function scheduleTestShards(shards: readonly TestShard[]): readonly TestShard[];

/** Creates a value-free profile from catalog descriptors and completed results. */
export function createTestShardProfile(
  shards: readonly TestShard[],
  results: readonly TestShardResult[],
  concurrency: number,
): TestShardProfile;

/** Returns a value-free default-on warning when an estimate needs review. */
export function createTestShardEstimateWarning(profile: TestShardProfile): string | undefined;

/** Writes a value-free profile atomically. */
export function writeTestShardProfile(profilePath: string, profile: TestShardProfile): void;

/** Aggregates final TAP counters while ignoring nested child TAP summaries. */
export function summarizeTapOutputs(outputs: readonly string[]): TestShardTotals;

/** Runs every shard concurrently and prints deterministic, grouped TAP output. */
export function runTestShards(repositoryRoot?: string): Promise<{
  readonly exitCode: 0 | 1;
  readonly results: readonly TestShardResult[];
  readonly totals: TestShardTotals;
}>;
