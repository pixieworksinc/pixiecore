#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

import { isPrivateArchivePath } from './policy.mjs';
import { assertPublicSnapshotClean, scanPublicSnapshot } from './scan.mjs';

const execFileAsync = promisify(execFile);
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, '..', '..');

/** Exports and audits a fresh-history source candidate from one Git commit. */
export async function preparePublicSnapshot({
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  outputDirectory,
  reportPath,
  sourceRef = 'HEAD',
}) {
  const root = resolve(repositoryRoot);
  const output = resolveRequiredPath(outputDirectory, 'outputDirectory');
  const report = resolveRequiredPath(reportPath, 'reportPath');
  assertOutsideRepository(root, output, 'outputDirectory');
  assertOutsideRepository(root, report, 'reportPath');
  assertSeparatePaths(output, report);
  await assertEmptyOutput(output);

  const sourceCommit = await resolveSourceCommit(root, sourceRef);
  const trackedFiles = await listTrackedFiles(root, sourceCommit);
  const publicFiles = selectPublicSnapshotFiles(trackedFiles);
  if (publicFiles.length === 0) throw new Error('Public snapshot inventory is empty');

  await mkdir(output, { recursive: true });
  await extractArchive(root, output, sourceCommit, publicFiles);
  const audit = await scanPublicSnapshot(output);
  const privateReport = Object.freeze({
    schema: 'pixiecore.public-source-snapshot-audit/v1',
    source_commit: sourceCommit,
    generated_at: new Date().toISOString(),
    public_file_count: audit.files.length,
    public_bytes: audit.files.reduce((total, file) => total + file.bytes, 0),
    excluded_files: Object.freeze(trackedFiles.filter(isPrivateArchivePath)),
    files: audit.files,
    findings: audit.findings,
  });
  await mkdir(dirname(report), { recursive: true });
  await writeFile(report, `${JSON.stringify(privateReport, null, 2)}\n`, 'utf8');
  assertPublicSnapshotClean(audit);
  return privateReport;
}

/** Selects the approved public inventory from an ordered tracked-file list. */
export function selectPublicSnapshotFiles(trackedFiles) {
  return Object.freeze(trackedFiles.filter(path => !isPrivateArchivePath(path)));
}

/** Resolves one commit so mutable branch names never enter the private report. */
async function resolveSourceCommit(repositoryRoot, sourceRef) {
  const { stdout } = await execFileAsync(
    'git',
    ['rev-parse', '--verify', `${sourceRef}^{commit}`],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
  return stdout.trim();
}

/** Lists exactly the tracked blobs and symlinks in the selected commit. */
async function listTrackedFiles(repositoryRoot, sourceCommit) {
  const { stdout } = await execFileAsync(
    'git',
    ['ls-tree', '-r', '--name-only', '-z', sourceCommit],
    { cwd: repositoryRoot, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout.toString('utf8').split('\0').filter(Boolean).sort();
}

/** Streams a Git archive directly into the new directory without shell parsing. */
async function extractArchive(repositoryRoot, outputDirectory, sourceCommit, paths) {
  await new Promise((resolvePromise, reject) => {
    const archive = spawn('git', ['archive', '--format=tar', sourceCommit, '--', ...paths], {
      cwd: repositoryRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const extractor = spawn('tar', ['-xf', '-', '-C', outputDirectory], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    const errors = [];
    archive.stderr.on('data', chunk => errors.push(chunk));
    extractor.stderr.on('data', chunk => errors.push(chunk));
    archive.stdout.pipe(extractor.stdin);
    archive.on('error', reject);
    extractor.on('error', reject);
    let archiveCode;
    let extractorCode;
    const finish = () => {
      if (archiveCode === undefined || extractorCode === undefined) return;
      if (archiveCode === 0 && extractorCode === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`Snapshot export failed without disclosing file contents: ${Buffer.concat(errors).toString('utf8').trim()}`));
    };
    archive.on('close', code => {
      archiveCode = code;
      if (code !== 0) extractor.stdin.destroy();
      finish();
    });
    extractor.on('close', code => {
      extractorCode = code;
      finish();
    });
  });
}

/** Rejects existing non-empty targets instead of overwriting reviewed content. */
async function assertEmptyOutput(outputDirectory) {
  try {
    const entries = await readdir(outputDirectory);
    if (entries.length > 0) throw new Error(`outputDirectory must be empty: ${outputDirectory}`);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
}

/** Rejects missing CLI values before path normalization. */
function resolveRequiredPath(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} is required`);
  return resolve(value);
}

/** Keeps generated candidates and private mappings outside the source checkout. */
function assertOutsideRepository(repositoryRoot, target, name) {
  const path = relative(repositoryRoot, target);
  if (path === '' || (!path.startsWith(`..${sep}`) && path !== '..')) {
    throw new Error(`${name} must be outside the repository`);
  }
}

/** Keeps the private source mapping out of the candidate repository. */
function assertSeparatePaths(outputDirectory, reportPath) {
  const path = relative(outputDirectory, reportPath);
  if (path === '' || (!path.startsWith(`..${sep}`) && path !== '..')) {
    throw new Error('reportPath must be outside outputDirectory');
  }
}

/** Parses one required --name=value option without accepting positional input. */
function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

/** Runs the publication preparation command when invoked directly. */
async function main() {
  const result = await preparePublicSnapshot({
    outputDirectory: option('output'),
    reportPath: option('report'),
    sourceRef: option('source-ref') ?? 'HEAD',
  });
  console.log(`Prepared ${result.public_file_count} audited public files from ${result.source_commit}.`);
  console.log(`Private audit report: ${resolve(option('report'))}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
