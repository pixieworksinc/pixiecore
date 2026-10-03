export interface PrepareReleaseArtifactOptions {
  readonly npmCache?: string;
  readonly repositoryRoot?: string;
  readonly outputDirectory: string;
  readonly sourceRevision: string;
  readonly version: string;
}

export interface VerifyReleaseArtifactOptions {
  readonly outputDirectory: string;
}

export interface ReleaseArtifactManifest {
  readonly schema: 'pixiecore.release-artifact/v1';
  readonly package: '@pixieworks/pixiecore';
  readonly version: string;
  readonly source_revision: string;
  readonly tarball: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly npm_integrity: string;
  readonly npm_shasum: string;
}

export function prepareReleaseArtifact(
  options: PrepareReleaseArtifactOptions,
): Promise<Readonly<ReleaseArtifactManifest>>;

export function verifyReleaseArtifact(
  options: VerifyReleaseArtifactOptions,
): Promise<Readonly<ReleaseArtifactManifest>>;
