import type { ReleaseArtifactManifest } from './prepare-artifact.mjs';

/** Creates or resumes only the approved release, never overwriting differing assets. */
export function completeGitHubRelease(
  manifest: Readonly<ReleaseArtifactManifest>,
  options: {
    outputDirectory: string;
    /** Immutable annotated tag object admitted by candidate verification. */
    tagObjectId: string;
    repository?: string;
    fetchImpl?: typeof fetch;
    run?: (command: string, args: string[]) => Promise<unknown>;
    wait?: (milliseconds: number) => Promise<void>;
  },
): Promise<Readonly<ReleaseArtifactManifest>>;

/** Checks the tag, stable identity, digest, source and approved assets, including resumable drafts. */
export function assertGitHubReleaseIdentity(release: unknown, manifest: Readonly<ReleaseArtifactManifest>): void;

/** Returns digest and source lines for the generated GitHub release notes. */
export function releaseDigestNotes(manifest: Readonly<ReleaseArtifactManifest>): string;
