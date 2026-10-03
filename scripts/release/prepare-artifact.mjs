#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, '..', '..');
const RELEASE_MANIFEST = 'release-manifest.json';
const SHA256 = /^[0-9a-f]{64}$/u;
const SOURCE_REVISION = /^[0-9a-f]{40}$/u;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

/** Builds one package tarball without rerunning lifecycle scripts and records its digests. */
export async function prepareReleaseArtifact({
  npmCache,
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  outputDirectory,
  sourceRevision,
  version,
}) {
  const root = resolve(repositoryRoot);
  const output = resolveRequiredPath(outputDirectory, 'outputDirectory');
  const expectedVersion = requiredValue(version, 'version');
  const revision = requiredValue(sourceRevision, 'sourceRevision').toLowerCase();
  if (!VERSION.test(expectedVersion)) throw new Error(`Invalid release version: ${expectedVersion}`);
  if (!SOURCE_REVISION.test(revision)) throw new Error('sourceRevision must be a full Git SHA');

  const packageManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (packageManifest.name !== '@pixieworks/pixiecore') {
    throw new Error('Release package name must be @pixieworks/pixiecore');
  }
  if (packageManifest.version !== expectedVersion) {
    throw new Error(`Release version ${expectedVersion} does not match package.json ${packageManifest.version}`);
  }
  if (packageManifest.repository?.url !== 'git+https://github.com/pixieworksinc/pixiecore.git') {
    throw new Error('Release repository URL does not match pixieworksinc/pixiecore');
  }
  const { stdout: headOutput } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (headOutput.trim().toLowerCase() !== revision) {
    throw new Error('sourceRevision does not match repository HEAD');
  }
  const { stdout: statusOutput } = await execFileAsync(
    'git',
    ['status', '--porcelain', '--untracked-files=no'],
    { cwd: root, encoding: 'utf8' },
  );
  if (statusOutput.trim() !== '') throw new Error('Release source has tracked changes');

  await assertEmptyOutput(output);
  await mkdir(output, { recursive: true });
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const { stdout } = await execFileAsync(npm, [
    'pack',
    '--ignore-scripts',
    '--json',
    '--silent',
    '--pack-destination',
    output,
  ], {
    cwd: root,
    encoding: 'utf8',
    env: npmCache
      ? { ...process.env, npm_config_cache: resolve(npmCache) }
      : process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  const packed = parsePackResult(stdout);
  const tarballName = basename(packed.filename);
  const tarballPath = join(output, tarballName);
  const bytes = await readFile(tarballPath);
  const manifest = Object.freeze({
    schema: 'pixiecore.release-artifact/v1',
    package: packageManifest.name,
    version: expectedVersion,
    source_revision: revision,
    tarball: tarballName,
    bytes: bytes.byteLength,
    sha256: digest(bytes, 'sha256', 'hex'),
    npm_integrity: packed.integrity,
    npm_shasum: packed.shasum,
  });
  await writeFile(join(output, RELEASE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await verifyReleaseArtifact({ outputDirectory: output });
  return manifest;
}

/** Verifies the recorded tarball bytes, npm digests, and packaged identity. */
export async function verifyReleaseArtifact({ outputDirectory }) {
  const output = resolveRequiredPath(outputDirectory, 'outputDirectory');
  const manifest = JSON.parse(await readFile(join(output, RELEASE_MANIFEST), 'utf8'));
  if (manifest.schema !== 'pixiecore.release-artifact/v1') throw new Error('Unsupported release manifest schema');
  if (manifest.package !== '@pixieworks/pixiecore') throw new Error('Unexpected release package');
  if (!VERSION.test(manifest.version ?? '')) throw new Error('Invalid manifest version');
  if (!SOURCE_REVISION.test(manifest.source_revision ?? '')) throw new Error('Invalid source revision');
  if (basename(manifest.tarball ?? '') !== manifest.tarball) throw new Error('Invalid tarball path');
  if (manifest.tarball !== `pixieworks-pixiecore-${manifest.version}.tgz`) throw new Error('Unexpected release tarball name');
  if (!SHA256.test(manifest.sha256 ?? '')) throw new Error('Invalid SHA-256 digest');

  const tarballPath = join(output, manifest.tarball);
  const bytes = await readFile(tarballPath);
  if (bytes.byteLength !== manifest.bytes) throw new Error('Release tarball size mismatch');
  if (digest(bytes, 'sha256', 'hex') !== manifest.sha256) throw new Error('Release tarball SHA-256 mismatch');
  if (`sha512-${digest(bytes, 'sha512', 'base64')}` !== manifest.npm_integrity) {
    throw new Error('Release tarball npm integrity mismatch');
  }
  if (digest(bytes, 'sha1', 'hex') !== manifest.npm_shasum) {
    throw new Error('Release tarball npm shasum mismatch');
  }

  const { stdout } = await execFileAsync('tar', ['-xOf', tarballPath, 'package/package.json'], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  const packagedManifest = JSON.parse(stdout);
  if (packagedManifest.name !== manifest.package || packagedManifest.version !== manifest.version) {
    throw new Error('Packaged identity does not match release manifest');
  }
  if (packagedManifest.repository?.url !== 'git+https://github.com/pixieworksinc/pixiecore.git') {
    throw new Error('Packaged repository URL does not match pixieworksinc/pixiecore');
  }
  return Object.freeze(manifest);
}

/** Parses the single structured result emitted by npm pack. */
function parsePackResult(stdout) {
  const result = JSON.parse(stdout);
  if (!Array.isArray(result) || result.length !== 1) throw new Error('npm pack must produce exactly one tarball');
  const [packed] = result;
  if (typeof packed?.filename !== 'string' || typeof packed?.integrity !== 'string'
    || typeof packed?.shasum !== 'string') {
    throw new Error('npm pack returned incomplete artifact metadata');
  }
  return packed;
}

/** Rejects an existing non-empty release directory. */
async function assertEmptyOutput(outputDirectory) {
  try {
    const entries = await readdir(outputDirectory);
    if (entries.length > 0) throw new Error(`outputDirectory must be empty: ${outputDirectory}`);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
}

/** Resolves one required filesystem path. */
function resolveRequiredPath(value, name) {
  return resolve(requiredValue(value, name));
}

/** Rejects missing or blank command values before further validation. */
function requiredValue(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} is required`);
  return value.trim();
}

/** Computes one release digest without exposing artifact contents. */
function digest(bytes, algorithm, encoding) {
  return createHash(algorithm).update(bytes).digest(encoding);
}

/** Reads one --name=value command option. */
function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

/** Runs the release-artifact command when invoked directly. */
async function main() {
  const manifest = await prepareReleaseArtifact({
    outputDirectory: option('output'),
    sourceRevision: option('source-revision'),
    version: option('version'),
  });
  console.log(`Prepared ${manifest.tarball} (${manifest.sha256}) from ${manifest.source_revision}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
