import type { ReleaseArtifactManifest } from './prepare-artifact.mjs';

/** Describes the already-prepared candidate or the explicit local-development pack fallback. */
export interface PackageInputOptions {
  readonly outputDirectory?: string;
  readonly sourceRevision?: string;
  readonly version?: string;
  readonly packCheckout: () => Promise<string>;
}

/** Resolves verified candidate bytes without invoking the checkout pack callback. */
export function selectPackageInput(options: PackageInputOptions): Promise<{
  readonly tarball: string;
  readonly manifest?: Readonly<ReleaseArtifactManifest>;
}>;
