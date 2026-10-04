import type { ReleaseArtifactManifest } from './prepare-artifact.mjs';

export interface RegistryDist {
  readonly tarball: string;
  readonly integrity: string;
  readonly shasum: string;
}

export function assertRegistryArtifact(
  manifest: Readonly<ReleaseArtifactManifest>,
  dist: Readonly<RegistryDist>,
  bytes: Uint8Array,
): void;

/** Requires an existing package; absent versions must advance latest and existing versions need exact verification. */
export function registryPublicationRequired(
  manifest: Readonly<ReleaseArtifactManifest>,
  fetchImpl?: typeof fetch,
  provenanceOptions?: Parameters<typeof import('./verify-provenance.mjs').verifyRegistryProvenance>[3],
): Promise<boolean>;

export function verifyRegistryArtifact(options: {
  readonly outputDirectory: string;
  readonly sourceRevision: string;
  readonly version: string;
}): Promise<Readonly<ReleaseArtifactManifest>>;

/** Waits for newly published metadata, retrying only anonymous 404 responses. */
export function readPublishedDist(
  manifest: Readonly<ReleaseArtifactManifest>,
  fetchImpl?: typeof fetch,
  wait?: (milliseconds: number) => Promise<void>,
  attempts?: number,
): Promise<Readonly<RegistryDist>>;
