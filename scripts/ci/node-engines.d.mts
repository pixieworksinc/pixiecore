/** Describes the development and installed-consumer engine validation boundary. */
export interface NodePolicy {
  readonly runtimeMinimum: string;
  readonly developmentRange: string;
  readonly developmentMinimums: readonly string[];
}

/** Only engine metadata is read; no dependency code or install script executes. */
export interface LockedEngines {
  readonly packages: Readonly<Record<string, Readonly<{
    dev?: boolean;
    engines?: Readonly<{ node?: string }>;
  }>>>;
}

/** Returns every mismatch rather than silently ignoring npm engine warnings. */
export function nodeEngineErrors(
  policy: NodePolicy,
  lockfile: LockedEngines,
  nodeVersion: string,
): string[];
