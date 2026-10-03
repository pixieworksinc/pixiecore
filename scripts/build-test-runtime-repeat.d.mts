export type RuntimeBuildCacheMode = 'clean' | 'reuse';

export interface RuntimeBuildCacheState {
  readonly reusable: boolean;
  readonly reason: 'current' | 'explicit_clean' | 'missing_build_info' | 'missing_dist' | 'stale_dist';
}

/** Resolves the local repeat-build cache mode. */
export function resolveRuntimeBuildCacheMode(value?: string): RuntimeBuildCacheMode;

/** Inspects whether current runtime outputs can safely use incremental compilation. */
export function inspectRuntimeBuildCache(repositoryRoot?: string): Promise<RuntimeBuildCacheState>;

/** Lists JavaScript paths expected from the runtime TypeScript project. */
export function expectedRuntimeJavaScriptOutputs(repositoryRoot?: string): Promise<readonly string[]>;

/** Builds a verified local runtime using incremental state when available. */
export function buildTestRuntimeRepeat(repositoryRoot?: string): Promise<void>;
