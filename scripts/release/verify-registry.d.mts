import type { ReleaseArtifactManifest } from './prepare-artifact.mjs';

/** Checks the explicit one-time bootstrap opt-in independently of registry state. */
export function assertPublicationMode(mode: string, version: string, confirmation?: string): void;

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

/** Admits an absent version only above registry latest; existing versions require exact verification. */
export function registryPublicationRequired(
  manifest: Readonly<ReleaseArtifactManifest>,
  fetchImpl?: typeof fetch,
  provenanceOptions?: Parameters<typeof import('./verify-provenance.mjs').verifyRegistryProvenance>[3],
  mode?: 'oidc' | 'bootstrap',
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
