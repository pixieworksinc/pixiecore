/** Verifies a transferred release artifact against an approved source and version. */
export function verifyReleaseArtifactIdentity(options: {
  readonly outputDirectory: string;
  readonly sourceRevision: string;
  readonly version: string;
}): Promise<Readonly<ReleaseArtifactManifest>>;
import type { ReleaseArtifactManifest } from './prepare-artifact.mjs';

/** Rejects prereleases and nonnumeric tags before publication. */
export function assertStableReleaseVersion(version: string): void;
