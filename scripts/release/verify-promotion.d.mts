/** Validates immutable GitHub candidate run and artifact metadata. */
export function assertCandidateSource(
  run: unknown,
  artifact: unknown,
  expected: { repository: string; sourceRevision: string; runId: string | number; artifactId: string | number },
): void;

/** Checks tag annotation identity and digest without claiming cryptographic signer trust. */
export function assertSignedArtifactBinding(
  manifest: { version: string; source_revision: string; sha256: string },
  tagObject: string,
): void;

/** Requires GitHub verification of the exact release tag object. */
export function assertGitHubTagVerification(
  tag: unknown,
  expected: { tagId: string; sourceRevision: string; version: string },
): void;

/** Verifies the candidate tarball, source and signed tag digest before promotion. */
export function verifyCandidatePromotion(options: {
  outputDirectory: string; sourceRevision: string; version: string; tagObjectId: string;
}): Promise<Readonly<import('./prepare-artifact.mjs').ReleaseArtifactManifest>>;

/** Rejects changes to the remote tag name after its immutable object was approved. */
export function assertCurrentTagReference(
  reference: unknown,
  expected: { tagId: string; version: string },
): void;
