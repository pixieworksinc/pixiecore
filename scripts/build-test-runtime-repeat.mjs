#!/usr/bin/env node

import { access, mkdir, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanTestRuntime } from './clean-test-runtime.mjs';

const DEFAULT_REPOSITORY_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CACHE_MODE_VARIABLE = 'PIXIECORE_TEST_RUNTIME_CACHE';
const CACHE_DIRECTORY = '.pixiecore';
const BUILD_INFO_FILENAME = 'test-runtime.tsbuildinfo';

if (isMainModule()) await buildTestRuntimeRepeat(DEFAULT_REPOSITORY_ROOT);

/** Rebuild mode accepted by the local repeat lane. */
export function resolveRuntimeBuildCacheMode(value = process.env[CACHE_MODE_VARIABLE]) {
  if (value === undefined) return 'reuse';

  const normalized = value.trim();
  if (normalized === 'reuse' || normalized === 'clean') return normalized;
  throw new Error(`${CACHE_MODE_VARIABLE} must be either reuse or clean`);
}

/**
 * Inspects whether a previous runtime build can safely be reused.
 *
 * The TypeScript compiler validates source and compiler-option changes on every
 * incremental invocation. This guard independently rejects absent, stale, or
 * partially deleted emitted JavaScript before that invocation starts.
 */
export async function inspectRuntimeBuildCache(repositoryRoot = DEFAULT_REPOSITORY_ROOT) {
  const root = resolve(repositoryRoot);
  const buildInfoPath = join(root, CACHE_DIRECTORY, BUILD_INFO_FILENAME);
  if (!await isFile(buildInfoPath)) return Object.freeze({ reusable: false, reason: 'missing_build_info' });

  const expectedOutputs = await expectedRuntimeJavaScriptOutputs(root);
  const distDirectory = join(root, 'dist');
  if (!await isDirectory(distDirectory)) return Object.freeze({ reusable: false, reason: 'missing_dist' });

  const actualOutputs = await collectFiles(distDirectory, path => path.endsWith('.js'));
  const expected = new Set(expectedOutputs);
  const actual = new Set(actualOutputs.map(path => relative(distDirectory, path)));
  if (actual.size !== expected.size || [...actual].some(path => !expected.has(path))) {
    return Object.freeze({ reusable: false, reason: 'stale_dist' });
  }

  return Object.freeze({ reusable: true, reason: 'current' });
}

/** Returns every JavaScript path emitted by the runtime TypeScript project. */
export async function expectedRuntimeJavaScriptOutputs(repositoryRoot = DEFAULT_REPOSITORY_ROOT) {
  const root = resolve(repositoryRoot);
  const sourceDirectory = join(root, 'src');
  const sourceFiles = await collectFiles(sourceDirectory, path => path.endsWith('.ts')
    && !path.endsWith('.d.ts')
    && !relative(sourceDirectory, path).split(sep).includes('tests'));

  return Object.freeze(sourceFiles
    .map(path => relative(sourceDirectory, path).replace(/\.ts$/u, '.js'))
    .sort());
}

/**
 * Builds the test runtime without discarding a verified local compiler cache.
 *
 * A missing or suspicious cache falls back to the same clean compilation used
 * by `npm test`. A failed incremental compiler invocation also retries clean,
 * so a damaged build-info file cannot create a false green result.
 */
export async function buildTestRuntimeRepeat(repositoryRoot = DEFAULT_REPOSITORY_ROOT) {
  const root = resolve(repositoryRoot);
  const mode = resolveRuntimeBuildCacheMode();
  const state = mode === 'reuse'
    ? await inspectRuntimeBuildCache(root)
    : Object.freeze({ reusable: false, reason: 'explicit_clean' });

  if (!state.reusable) {
    process.stdout.write(`Test runtime repeat build: clean (${state.reason}).\n`);
    await buildCleanRuntime(root);
    return;
  }

  try {
    await compileIncrementally(root);
  }
  catch {
    process.stdout.write('Test runtime repeat build: incremental compiler failed; rebuilding clean.\n');
    await buildCleanRuntime(root);
    return;
  }

  await copyPluginManifests(root);
  process.stdout.write('Test runtime repeat build: reused incremental compiler state.\n');
}

/** Performs the same runtime compilation semantics used by the authoritative suite. */
async function buildCleanRuntime(repositoryRoot) {
  await cleanTestRuntime(repositoryRoot);
  await compileIncrementally(repositoryRoot);
  await copyPluginManifests(repositoryRoot);
}

/** Runs TypeScript with the local-only runtime build-info location. */
async function compileIncrementally(repositoryRoot) {
  const buildInfoPath = join(repositoryRoot, CACHE_DIRECTORY, BUILD_INFO_FILENAME);
  await mkdir(dirname(buildInfoPath), { recursive: true });
  await run(repositoryRoot, resolve(repositoryRoot, 'node_modules', '.bin', 'tsc'), [
    '-p',
    'tsconfig.runtime.json',
    '--incremental',
    '--tsBuildInfoFile',
    buildInfoPath,
  ]);
}

/** Copies plugin manifests after either clean or incremental compilation. */
async function copyPluginManifests(repositoryRoot) {
  await run(repositoryRoot, process.execPath, [
    '--import',
    'tsx',
    'scripts/copy-core-plugin-manifests.mjs',
  ]);
}

/** Executes one inherited-output child process and rejects non-zero results. */
async function run(repositoryRoot, command, argumentsList) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, argumentsList, {
      cwd: repositoryRoot,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) return resolvePromise();
      reject(new Error(`${command} exited with ${code ?? 'an unknown status'}`));
    });
  });
}

/** Collects regular files recursively in deterministic path order. */
async function collectFiles(directory, includes) {
  if (!await isDirectory(directory)) return [];

  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(path, includes);
    if (!entry.isFile() || !includes(path)) return [];
    return [path];
  }));
  return files.flat().sort();
}

/** Determines whether a path is an accessible regular file. */
async function isFile(path) {
  try { return (await stat(path)).isFile(); }
  catch { return false; }
}

/** Determines whether a path is an accessible directory. */
async function isDirectory(path) {
  try {
    await access(path, constants.R_OK);
    return (await stat(path)).isDirectory();
  }
  catch { return false; }
}

/** Determines whether this module is the invoked repeat-build entry point. */
function isMainModule() {
  return process.argv[1] !== undefined
    && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
