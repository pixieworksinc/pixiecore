import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import {
  FORBIDDEN_PRODUCT_NAMES,
  PRIVATE_ARCHIVE_PREFIXES,
  PRIVATE_ARCHIVE_PATHS,
  PRIVATE_PATH_PATTERNS,
  SECRET_PATTERNS,
  hasForbiddenPublicPathPart,
  isPrivateArchivePath,
} from './policy.mjs';

/** Scans one exported tree without returning matched secret or private values. */
export async function scanPublicSnapshot(snapshotRoot) {
  const root = resolve(snapshotRoot);
  const files = await listFiles(root);
  const findings = [];
  const inventory = [];

  for (const path of files) {
    const absolutePath = join(root, path);
    const information = await lstat(absolutePath);
    if (information.isSymbolicLink()) {
      findings.push(finding('symbolic-link', path));
      continue;
    }
    if (!information.isFile()) continue;

    if (isPrivateArchivePath(path)) findings.push(finding('private-archive-path', path));
    if (hasForbiddenPublicPathPart(path)) findings.push(finding('forbidden-path-part', path));
    for (const rule of FORBIDDEN_PRODUCT_NAMES) {
      if (rule.pattern.test(path)) findings.push(finding(`${rule.id}-path`, path));
    }

    const bytes = await readFile(absolutePath);
    const content = bytes.toString('utf8');
    inventory.push(Object.freeze({
      path,
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }));
    for (const rule of [
      ...FORBIDDEN_PRODUCT_NAMES,
      ...SECRET_PATTERNS,
      ...PRIVATE_PATH_PATTERNS,
    ]) {
      if (rule.pattern.test(content)) findings.push(finding(rule.id, path));
    }
  }

  return Object.freeze({
    files: Object.freeze(inventory.sort((left, right) => left.path.localeCompare(right.path))),
    findings: Object.freeze(findings.sort(compareFindings)),
    excluded_prefixes: PRIVATE_ARCHIVE_PREFIXES,
    excluded_paths: PRIVATE_ARCHIVE_PATHS,
  });
}

/** Throws a value-free summary when a snapshot violates publication policy. */
export function assertPublicSnapshotClean(report) {
  if (report.findings.length === 0) return;
  const summary = report.findings
    .map(item => `${item.rule}: ${item.path}`)
    .join('\n');
  throw new Error(`Public snapshot audit found ${report.findings.length} issue(s):\n${summary}`);
}

/** Recursively lists ordinary files and symbolic links in stable order. */
async function listFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = join(directory, entry.name);
    const path = relative(root, absolutePath).split('\\').join('/');
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, absolutePath));
      continue;
    }
    files.push(path);
  }
  return files;
}

/** Creates a finding that deliberately omits matched content. */
function finding(rule, path) {
  return Object.freeze({ rule, path });
}

/** Keeps audit output deterministic across platforms. */
function compareFindings(left, right) {
  return left.path.localeCompare(right.path) || left.rule.localeCompare(right.rule);
}
