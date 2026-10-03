#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyReleaseArtifact } from './prepare-artifact.mjs';

/** Rejects prereleases and nonnumeric tags before any publication side effect. */
export function assertStableReleaseVersion(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version)) {
    throw new Error('Publication requires a stable numeric X.Y.Z version');
  }
}

/** Verifies a transferred release artifact against the expected release identity. */
export async function verifyReleaseArtifactIdentity({
  outputDirectory,
  sourceRevision,
  version,
}) {
  const expectedVersion = requiredValue(version, 'version');
  const expectedRevision = requiredValue(sourceRevision, 'sourceRevision').toLowerCase();
  const manifest = await verifyReleaseArtifact({ outputDirectory });
  if (manifest.version !== expectedVersion) {
    throw new Error(`Release artifact version ${manifest.version} does not match ${expectedVersion}`);
  }
  if (manifest.source_revision !== expectedRevision) {
    throw new Error('Release artifact source revision does not match the approved release source');
  }
  return manifest;
}

/** Reads one required --name=value command option. */
function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

/** Rejects a missing or blank command value. */
function requiredValue(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} is required`);
  return value.trim();
}

/** Runs transferred-artifact verification when invoked directly. */
async function main() {
  const manifest = await verifyReleaseArtifactIdentity({
    outputDirectory: option('output'),
    sourceRevision: option('source-revision'),
    version: option('version'),
  });
  console.log(`Verified ${manifest.tarball} (${manifest.sha256}) from ${manifest.source_revision}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
