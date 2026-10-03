import type { ReleaseArtifactManifest } from './prepare-artifact.mjs';

/** Requires registry provenance tied cryptographically to the approved source and artifact. */
export function verifyRegistryProvenance(
  manifest: Readonly<ReleaseArtifactManifest>,
  dist: unknown,
  bytes: Uint8Array,
  options?: {
    fetchImpl?: typeof fetch;
    run?: (command: string, args: string[], options: { encoding: string; maxBuffer: number }) => Promise<{ stdout: string }>;
  },
): Promise<void>;

/** Checks package, digest, source, ref, hosted runner and release workflow claims. */
export function assertProvenanceStatement(statement: unknown, manifest: Readonly<ReleaseArtifactManifest>): void;
