#!/usr/bin/env node

/** Creates or resumes a release without overwriting an existing tag, note digest or asset. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { assertStableReleaseVersion, verifyReleaseArtifactIdentity } from './verify-artifact.mjs';
import { assertCurrentTagReference } from './verify-promotion.mjs';

const execFileAsync = promisify(execFile);
const REPOSITORY = 'pixieworksinc/pixiecore';
const CREATED_RELEASE_ATTEMPTS = 11;
const CREATED_RELEASE_DELAY_MS = 1_000;

/** Resumes only a release with the approved identity, digest and already uploaded bytes. */
export async function completeGitHubRelease(manifest, {
  outputDirectory, tagObjectId, repository = REPOSITORY, fetchImpl = fetch, run = execFileAsync,
  wait = delay => new Promise(resolveDelay => setTimeout(resolveDelay, delay)),
}) {
  assertStableReleaseVersion(manifest.version);
  if (repository !== REPOSITORY) throw new Error('Unexpected release repository');
  const files = [manifest.tarball, 'release-manifest.json'];
  const endpoint = `https://api.github.com/repos/${repository}`;
  const request = async path => fetchImpl(`${endpoint}${path}`, {
    headers: { authorization: `Bearer ${process.env.GH_TOKEN ?? ''}`, accept: 'application/vnd.github+json' },
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  /** Rechecks the approved annotation; release metadata and --verify-tag prove no such binding. */
  const verifyCurrentTag = async () => {
    const response = await request(`/git/ref/tags/${manifest.version}`);
    if (!response.ok) throw new Error(`GitHub release tag lookup failed: HTTP ${response.status}`);
    assertCurrentTagReference(await response.json(), { tagId: tagObjectId, version: manifest.version });
  };
  /** Includes authenticated drafts, which the published-by-tag endpoint may omit. */
  const lookup = async () => {
    const response = await request(`/releases/tags/${manifest.version}`);
    if (response.ok) return response.json();
    if (response.status !== 404) throw new Error(`GitHub release lookup failed: HTTP ${response.status}`);
    for (let page = 1; page <= 20; page++) {
      const listed = await request(`/releases?per_page=100&page=${page}`);
      if (!listed.ok) throw new Error(`GitHub release lookup failed: HTTP ${listed.status}`);
      const releases = await listed.json();
      if (!Array.isArray(releases)) throw new Error('Malformed GitHub release list');
      const existing = releases.find(release => release.tag_name === manifest.version);
      if (existing) return existing;
      if (releases.length < 100) return undefined;
    }
    throw new Error('Release lookup exceeded its safe pagination limit');
  };
  await verifyCurrentTag();
  let release = await lookup();
  if (!release) {
    await verifyCurrentTag();
    await run('gh', [
      'release', 'create', manifest.version, ...files.map(file => join(outputDirectory, file)),
      '--repo', repository, '--title', `PixieCore ${manifest.version}`,
      '--notes', releaseDigestNotes(manifest), '--generate-notes', '--verify-tag', '--draft',
    ]);
    await verifyCurrentTag();
    release = await waitForCreatedRelease(lookup, manifest, wait);
  }
  assertGitHubReleaseIdentity(release, manifest);
  await verifyCurrentTag();

  // Verify all existing assets before uploading any missing one. Never use --clobber.
  const temporary = await mkdtemp(join(tmpdir(), 'pixiecore-release-resume-'));
  try {
    /** Reads back an asset without modifying the published release. */
    const verifyAsset = async file => {
      await run('gh', ['release', 'download', manifest.version, '--repo', repository,
        '--pattern', file, '--dir', temporary]);
      const [actual, expected] = await Promise.all([
        readFile(join(temporary, file)), readFile(join(outputDirectory, file)),
      ]);
      if (hash(actual) !== hash(expected)) throw new Error(`Existing release asset differs: ${file}`);
    };
    for (const file of files.filter(name => release.assets.some(asset => asset.name === name))) {
      await verifyAsset(file);
    }
    for (const file of files.filter(name => !release.assets.some(asset => asset.name === name))) {
      await verifyCurrentTag();
      await run('gh', ['release', 'upload', manifest.version, join(outputDirectory, file), '--repo', repository]);
      await verifyAsset(file);
    }
    const complete = await lookup();
    assertGitHubReleaseIdentity(complete, manifest);
    if (complete.assets.length !== files.length) throw new Error('Release assets are incomplete');
    if (complete.draft) {
      // Publish only after verifying every asset; never edit mismatched notes or clobber files.
      await verifyCurrentTag();
      await run('gh', ['release', 'edit', manifest.version, '--repo', repository, '--draft=false']);
      const published = await lookup();
      assertGitHubReleaseIdentity(published, manifest);
      if (published.draft || published.assets.length !== files.length) throw new Error('Release publication not confirmed');
    }
    // Also cover existing published releases. GitHub cannot atomically lock this ref with a release write.
    await verifyCurrentTag();
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return manifest;
}

/** Waits only for a just-created draft to become complete in GitHub's API. */
async function waitForCreatedRelease(lookup, manifest, wait) {
  let release;
  for (let attempt = 1; attempt <= CREATED_RELEASE_ATTEMPTS; attempt += 1) {
    release = await lookup();
    if (release && !createdReleaseIsIncomplete(release)) {
      assertGitHubReleaseIdentity(release, manifest);
      return release;
    }
    if (attempt < CREATED_RELEASE_ATTEMPTS) await wait(CREATED_RELEASE_DELAY_MS);
  }
  if (!release) throw new Error('Created GitHub release was not visible after creation');
  assertGitHubReleaseIdentity(release, manifest);
  return release;
}

/** Distinguishes transient missing fields from a present but mismatched release. */
function createdReleaseIsIncomplete(release) {
  return release.tag_name === undefined || typeof release.draft !== 'boolean'
    || typeof release.prerelease !== 'boolean' || !Array.isArray(release.assets)
    || release.body === null || release.body === undefined;
}

/** Requires immutable notes to bind the release to the candidate digest and source. */
export function assertGitHubReleaseIdentity(release, manifest) {
  if (!release || release.tag_name !== manifest.version || typeof release.draft !== 'boolean' || release.prerelease !== false
    || !Array.isArray(release.assets)) throw new Error('Existing GitHub release identity mismatch');
  const names = release.assets.map(asset => asset.name);
  if (new Set(names).size !== names.length
    || names.some(name => ![manifest.tarball, 'release-manifest.json'].includes(name))) {
    throw new Error('Existing GitHub release has unapproved assets');
  }
  const lines = (release.body ?? '').split(/\r?\n/u);
  const digestLines = lines.filter(line => line.startsWith('SHA256:'));
  const sourceLines = lines.filter(line => line.startsWith('Source revision:'));
  if (digestLines.length !== 1 || digestLines[0] !== `SHA256: ${manifest.sha256}`
    || sourceLines.length !== 1 || sourceLines[0] !== `Source revision: ${manifest.source_revision}`) {
    throw new Error('Existing GitHub release digest or source mismatch');
  }
}

/** Produces the signed artifact identity that accompanies generated change notes. */
export function releaseDigestNotes(manifest) {
  return `SHA256: ${manifest.sha256}\n\nSource revision: ${manifest.source_revision}\n`;
}

/** Compares downloaded assets without printing their contents. */
function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Reads one required CLI option. */
function option(name) {
  const value = process.argv.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/** Invokes release writes only when this dedicated CLI is explicitly executed. */
async function main() {
  if (!process.env.GH_TOKEN) throw new Error('GitHub release requires a workflow token');
  const manifest = await verifyReleaseArtifactIdentity({
    outputDirectory: option('output'), sourceRevision: option('source-revision'), version: option('version'),
  });
  await completeGitHubRelease(manifest, {
    outputDirectory: option('output'), tagObjectId: option('tag-object'), repository: process.env.GH_REPO,
  });
  console.log(`Verified GitHub release ${manifest.version} (${manifest.sha256}).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
