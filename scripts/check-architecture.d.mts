/** Options accepted by the side-effect-free architecture checker boundary. */
export interface ArchitectureCheckOptions {
  readonly root?: string;
  readonly project?: string;
  readonly baseline?: string;
}

/** Summary returned by one architecture policy evaluation. */
export interface ArchitectureCheckResult {
  readonly violations: readonly unknown[];
  readonly sourceFileCount: number;
  readonly internalEdgeCount: number;
  readonly legacyFileCount: number;
}

/** Rendered result shared by the CLI and direct tests. */
export interface ArchitectureCheckCommandResult {
  readonly exitCode: 0 | 1;
  readonly output: string;
  readonly result: ArchitectureCheckResult;
}

/** Runs the architecture checker without process or console side effects. */
export function runArchitectureCheck(
  options?: ArchitectureCheckOptions,
): ArchitectureCheckCommandResult;

/** Evaluates architecture policy for already-resolved repository paths. */
export function checkArchitecture(options: {
  readonly repositoryRoot: string;
  readonly projectPath: string;
  readonly baselinePath: string;
}): ArchitectureCheckResult;
