/**
 * Provides reusable environment alias primitives for PixieCore.
 */

/**
 * Describes the resolved environment variable contract.
 */
export interface ResolvedEnvironmentVariable {
  readonly name: string;
  readonly value: string;
}

/** Resolves the first defined name, allowing a canonical name before aliases. */
export function resolveEnvironmentVariable(
  environment: NodeJS.ProcessEnv,
  ...names: readonly string[]
): ResolvedEnvironmentVariable | undefined {
  for (const name of names) {
    const value = environment[name];
    if (value !== undefined) return { name, value };
  }
  return undefined;
}
