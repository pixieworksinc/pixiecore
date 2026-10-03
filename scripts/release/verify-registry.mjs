#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertStableReleaseVersion, verifyReleaseArtifactIdentity } from './verify-artifact.mjs';
import { verifyRegistryProvenance } from './verify-provenance.mjs';

const REGISTRY = 'https://registry.npmjs.org';
const MAX_ATTEMPTS = 121;
const RETRY_DELAY_MS = 5_000;
const BOOTSTRAP_VERSION = '0.1.0';

/** Requires an explicit, version-limited opt-in; never falls back from OIDC to a token. */
export function assertPublicationMode(mode, version, confirmation = '') {
  if (mode === 'oidc' && confirmation === '') return;
  if (mode === 'bootstrap' && version === BOOTSTRAP_VERSION
    && confirmation === `bootstrap:${BOOTSTRAP_VERSION}`) return;
  throw new Error('Invalid publication mode or bootstrap confirmation; bootstrap is limited to 0.1.0');
}

/** Compares the anonymously downloaded npm tarball with the approved local bytes. */
export async function verifyRegistryArtifact({ outputDirectory, sourceRevision, version }) {
  const manifest = await verifyReleaseArtifactIdentity({ outputDirectory, sourceRevision, version });
  const dist = await readPublishedDist(manifest);
  const bytes = await verifyDownloadedArtifact(manifest, dist, fetch);
  await verifyRegistryProvenance(manifest, dist, bytes);
  await assertLatestVersion(manifest, fetch);
  return manifest;
}

/** Admits only new increasing stable versions or an already verified exact publication. */
export async function registryPublicationRequired(manifest, fetchImpl = fetch, provenanceOptions = {}, mode = 'oidc') {
  assertStableReleaseVersion(manifest.version);
  if (mode !== 'oidc' && (mode !== 'bootstrap' || manifest.version !== BOOTSTRAP_VERSION)) {
    throw new Error('Invalid publication mode or bootstrap version');
  }
  const response = await fetchImpl(metadataUrl(manifest), {
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) {
    await assertIncreasingLatestVersion(manifest, fetchImpl, mode);
    return true;
  }
  if (!response.ok) throw new Error(`Registry lookup failed: HTTP ${response.status}`);
  const dist = publishedDist(await response.json(), manifest);
  const bytes = await verifyDownloadedArtifact(manifest, dist, fetchImpl);
  await verifyRegistryProvenance(manifest, dist, bytes, { ...provenanceOptions, fetchImpl });
  await assertLatestVersion(manifest, fetchImpl);
  return false;
}

/** Rejects backfills that would replace latest with an older version; package absence permits bootstrap. */
async function assertIncreasingLatestVersion(manifest, fetchImpl, mode) {
  const response = await fetchImpl(`${REGISTRY}/${encodeURIComponent(manifest.package)}`, {
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return;
  if (!response.ok) throw new Error(`Registry package lookup failed: HTTP ${response.status}`);
  if (mode === 'bootstrap') throw new Error('Bootstrap requires an absent package, not just an absent version');
  const metadata = await response.json();
  if (metadata?.name !== manifest.package) throw new Error('Registry package identity mismatch');
  const latest = metadata['dist-tags']?.latest;
  assertStableReleaseVersion(latest);
  if (!isNewerStableVersion(manifest.version, latest)) {
    throw new Error('New publication must be newer than the current registry latest version');
  }
}

/** Compares validated numeric SemVer components without floating-point precision loss. */
function isNewerStableVersion(candidate, current) {
  const candidateParts = candidate.split('.').map(value => BigInt(value));
  const currentParts = current.split('.').map(value => BigInt(value));
  for (let index = 0; index < candidateParts.length; index += 1) {
    if (candidateParts[index] === currentParts[index]) continue;
    return candidateParts[index] > currentParts[index];
  }
  return false;
}

/** Downloads and compares registry bytes without credentials or redirects. */
async function verifyDownloadedArtifact(manifest, dist, fetchImpl) {
  const url = registryTarballUrl(dist.tarball);
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Registry tarball download failed: HTTP ${response.status}`);
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) !== manifest.bytes) {
    throw new Error('Registry tarball size mismatch');
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body ?? []) {
    length += chunk.byteLength;
    if (length > manifest.bytes) throw new Error('Registry tarball size mismatch');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  assertRegistryArtifact(manifest, dist, bytes);
  return bytes;
}

/** Stops on a moved or unrelated latest tag rather than silently writing a distribution tag. */
async function assertLatestVersion(manifest, fetchImpl) {
  const response = await fetchImpl(`${REGISTRY}/${encodeURIComponent(manifest.package)}/latest`, {
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Registry latest lookup failed: HTTP ${response.status}`);
  const latest = await response.json();
  if (latest?.name !== manifest.package || latest?.version !== manifest.version) {
    throw new Error('Registry latest does not match the approved stable version');
  }
}

/** Rejects a registry record whose digest or downloaded bytes differ from the release artifact. */
export function assertRegistryArtifact(manifest, dist, bytes) {
  registryTarballUrl(dist?.tarball);
  if (dist.integrity !== manifest.npm_integrity || dist.shasum !== manifest.npm_shasum) {
    throw new Error('Registry integrity metadata does not match the approved artifact');
  }
  if (bytes.byteLength !== manifest.bytes) throw new Error('Registry tarball size mismatch');
  if (digest(bytes, 'sha256', 'hex') !== manifest.sha256) {
    throw new Error('Registry tarball SHA-256 mismatch');
  }
  if (`sha512-${digest(bytes, 'sha512', 'base64')}` !== manifest.npm_integrity) {
    throw new Error('Registry tarball npm integrity mismatch');
  }
  if (digest(bytes, 'sha1', 'hex') !== manifest.npm_shasum) {
    throw new Error('Registry tarball npm shasum mismatch');
  }
}

/** Accepts only HTTPS tarballs served by the official npm registry. */
function registryTarballUrl(value) {
  if (typeof value !== 'string') throw new Error('Registry tarball URL is missing');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org'
    || url.port || url.username || url.password) {
    throw new Error('Registry tarball URL must use the official npm registry');
  }
  return url;
}

/** Waits for npm's asynchronous first-publication processing, retrying only absence. */
export async function readPublishedDist(manifest, fetchImpl = fetch,
  wait = delay => new Promise(resolveDelay => setTimeout(resolveDelay, delay)), attempts = MAX_ATTEMPTS) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetchImpl(metadataUrl(manifest), {
      redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404) {
      if (attempt < attempts) {
        await wait(RETRY_DELAY_MS);
        continue;
      }
      throw new Error(`Published registry metadata was not available after ${attempts} attempts`);
    }
    if (!response.ok) throw new Error(`Registry lookup failed: HTTP ${response.status}`);
    return publishedDist(await response.json(), manifest);
  }
  throw new Error('Published registry metadata retry count must be positive');
}

/** Builds a version-specific, anonymous metadata URL on the official registry. */
function metadataUrl(manifest) {
  return `${REGISTRY}/${encodeURIComponent(manifest.package)}/${encodeURIComponent(manifest.version)}`;
}

/** Rejects missing metadata or a response for a different package/version. */
function publishedDist(metadata, manifest) {
  if (metadata?.name !== manifest.package || metadata?.version !== manifest.version) {
    throw new Error('Registry package identity mismatch');
  }
  const dist = metadata.dist;
  if (!dist?.tarball || !dist?.integrity || !dist?.shasum) throw new Error('Registry metadata is incomplete');
  return dist;
}

/** Computes a digest for registry-to-artifact comparison. */
function digest(bytes, algorithm, encoding) {
  return createHash(algorithm).update(bytes).digest(encoding);
}

/** Reads one --name=value command option. */
function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

/** Runs anonymous registry verification when invoked directly. */
async function main() {
  if (process.argv.includes('--check-existing')) {
    const mode = process.env.PIXIECORE_PUBLICATION_MODE ?? 'oidc';
    assertPublicationMode(mode, option('version'), process.env.PIXIECORE_BOOTSTRAP_CONFIRMATION ?? '');
    const manifest = await verifyReleaseArtifactIdentity({
      outputDirectory: option('output'), sourceRevision: option('source-revision'), version: option('version'),
    });
    const required = await registryPublicationRequired(manifest, fetch, {}, mode);
    console.log(`publish_required=${required}`);
    return;
  }
  const manifest = await verifyRegistryArtifact({
    outputDirectory: option('output'),
    sourceRevision: option('source-revision'),
    version: option('version'),
  });
  console.log(`Verified published ${manifest.package}@${manifest.version} (${manifest.sha256}).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
