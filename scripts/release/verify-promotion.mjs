#!/usr/bin/env node

/** Binds an immutable candidate run and its tarball to the signed release tag. */
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { assertStableReleaseVersion, verifyReleaseArtifactIdentity } from './verify-artifact.mjs';

const execFileAsync = promisify(execFile);
const REPOSITORY = 'pixieworksinc/pixiecore';
const CANDIDATE_WORKFLOW = '.github/workflows/release-candidate.yml';

/** Rejects fork, failed, stale, expired or unrelated workflow artifacts before download. */
export function assertCandidateSource(run, artifact, { repository, sourceRevision, runId, artifactId }) {
  const expectedRun = positiveId(runId);
  const expectedArtifact = positiveId(artifactId);
  if (repository !== REPOSITORY) throw new Error('Unexpected candidate repository');
  if (run.id !== expectedRun || artifact.id !== expectedArtifact) throw new Error('Candidate ID mismatch');
  if (run.repository?.full_name !== repository || run.head_repository?.full_name !== repository) {
    throw new Error('Candidate must originate in the release repository, not a fork');
  }
  const repositoryId = positiveId(run.repository.id);
  if (run.head_repository.id !== repositoryId) throw new Error('Candidate head repository ID mismatch');
  if (run.path !== CANDIDATE_WORKFLOW || run.event !== 'workflow_dispatch' || run.head_branch !== '0.1.x') {
    throw new Error('Candidate must come from the release candidate workflow on 0.1.x');
  }
  if (run.status !== 'completed' || run.conclusion !== 'success') throw new Error('Candidate run did not succeed');
  if (run.head_sha !== sourceRevision || artifact.workflow_run?.head_sha !== sourceRevision) {
    throw new Error('Candidate source revision mismatch');
  }
  if (artifact.expired !== false || artifact.workflow_run?.id !== expectedRun
    || artifact.workflow_run?.repository_id !== repositoryId
    || artifact.workflow_run?.head_repository_id !== repositoryId
    || artifact.workflow_run?.head_branch !== run.head_branch) {
    throw new Error('Candidate artifact provenance or expiration mismatch');
  }
  const attempt = positiveId(run.run_attempt);
  if (artifact.name !== `pixiecore-release-candidate-${expectedRun}-${attempt}`) {
    throw new Error('Candidate artifact name or run attempt mismatch');
  }
}

/** Checks the signed annotation's source, version and unique SHA256 binding, not signer trust. */
export function assertSignedArtifactBinding(manifest, tagObject) {
  assertStableReleaseVersion(manifest.version);
  const separator = tagObject.indexOf('\n\n');
  if (separator < 0) throw new Error('Malformed annotated tag');
  const header = tagObject.slice(0, separator).split('\n');
  if (!header.includes(`object ${manifest.source_revision}`) || !header.includes('type commit')
    || !header.includes(`tag ${manifest.version}`)) throw new Error('Signed tag identity mismatch');
  const body = tagObject.slice(separator + 2);
  const signature = /(?:^|\n)-----BEGIN (PGP|SSH) SIGNATURE-----\r?\n/u.exec(body);
  if (!signature || !body.slice(signature.index).includes(`-----END ${signature[1]} SIGNATURE-----`)) {
    throw new Error('Signed tag signature envelope is missing');
  }
  const annotation = body.slice(0, signature.index);
  const lines = annotation.split(/\r?\n/u).filter(line => line.startsWith('SHA256:'));
  if (lines.length !== 1 || lines[0] !== `SHA256: ${manifest.sha256}`) {
    throw new Error('Signed tag SHA256 does not match the approved artifact');
  }
}

/** Requires GitHub to verify the same annotated tag; signer authorization remains a maintainer duty. */
export function assertGitHubTagVerification(tag, { tagId, sourceRevision, version }) {
  if (tag.sha !== tagId || tag.tag !== version || tag.object?.sha !== sourceRevision
    || tag.object?.type !== 'commit') throw new Error('GitHub signed tag identity mismatch');
  if (tag.verification?.verified !== true || tag.verification?.reason !== 'valid') {
    throw new Error('GitHub has not verified the release tag signature');
  }
}

/** Rejects a moved, deleted or lightweight remote tag before privileged side effects. */
export function assertCurrentTagReference(reference, { tagId, version }) {
  assertTagObjectId(tagId);
  assertStableReleaseVersion(version);
  if (reference.ref !== `refs/tags/${version}` || reference.object?.type !== 'tag'
    || reference.object?.sha !== tagId) throw new Error('Release tag reference changed after verification');
}

/** Allows immutable Git object IDs only, never mutable ref names or option fragments. */
function assertTagObjectId(tagId) {
  if (!/^[0-9a-f]{40}$/u.test(tagId)) throw new Error('Invalid tag object ID');
}

/** Verifies downloaded candidate bytes against the exact version, source and signed tag digest. */
export async function verifyCandidatePromotion({ outputDirectory, sourceRevision, version, tagObjectId }) {
  assertStableReleaseVersion(version);
  assertTagObjectId(tagObjectId);
  const manifest = await verifyReleaseArtifactIdentity({ outputDirectory, sourceRevision, version });
  const { stdout } = await execFileAsync('git', ['cat-file', '-p', tagObjectId], { encoding: 'utf8' });
  assertSignedArtifactBinding(manifest, stdout);
  return manifest;
}

/** Reads GitHub's authenticated metadata without treating any failure as an absent candidate. */
async function readGitHubMetadata(path) {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('Candidate metadata requires a workflow GitHub token');
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Candidate metadata unavailable: HTTP ${response.status}`);
  return response.json();
}

/** Accepts positive safe integer IDs only, never GitHub API path fragments. */
function positiveId(value) {
  if (!/^[1-9]\d*$/u.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new Error('Candidate IDs must be positive safe integers');
  }
  return Number(value);
}

/** Reads a required CLI option without falling back to a mutable latest artifact. */
function option(name) {
  const value = process.argv.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/** Checks candidate metadata before download, or the signed bytes after download. */
async function main() {
  const version = option('version');
  assertStableReleaseVersion(version);
  const tagId = option('tag-object');
  assertTagObjectId(tagId);
  if (process.argv.includes('--check-source') || process.argv.includes('--check-current-tag')) {
    assertCurrentTagReference(await readGitHubMetadata(`git/ref/tags/${version}`), { tagId, version });
  }
  if (process.argv.includes('--check-source')) {
    const runId = positiveId(option('run-id'));
    const artifactId = positiveId(option('artifact-id'));
    const [run, artifact] = await Promise.all([
      readGitHubMetadata(`actions/runs/${runId}`), readGitHubMetadata(`actions/artifacts/${artifactId}`),
    ]);
    assertCandidateSource(run, artifact, {
      repository: process.env.GITHUB_REPOSITORY,
      sourceRevision: option('source-revision'), runId, artifactId,
    });
    assertGitHubTagVerification(await readGitHubMetadata(`git/tags/${tagId}`), {
      tagId, sourceRevision: option('source-revision'), version,
    });
    console.log(`Verified candidate ${artifactId} from run ${runId}.`);
    return;
  }
  const manifest = await verifyCandidatePromotion({
    outputDirectory: option('output'), sourceRevision: option('source-revision'), version, tagObjectId: tagId,
  });
  console.log(`Verified signed artifact binding: ${manifest.sha256}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
