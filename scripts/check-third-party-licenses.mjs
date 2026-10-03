import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const lockPath = join(projectRoot, 'package-lock.json');
const packagePath = join(projectRoot, 'package.json');
const noticePath = join(projectRoot, 'THIRD_PARTY_NOTICES.md');
const reviewedLicenses = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MIT',
]);

const [lock, packageJson] = await Promise.all([
  readJson(lockPath),
  readJson(packagePath),
]);
if (lock.lockfileVersion !== 3 || !isRecord(lock.packages)) {
  throw new Error('Third-party license audit requires a package-lock v3 packages map');
}
if (!isRecord(packageJson.dependencies)) {
  throw new Error('package.json dependencies must be an object');
}

const directDependencies = new Set(Object.keys(packageJson.dependencies));
const packageVersions = new Map();
for (const [lockEntryPath, entry] of Object.entries(lock.packages)) {
  if (!lockEntryPath.startsWith('node_modules/') || !isRecord(entry) || entry.dev === true) continue;
  const name = packageNameFromLockPath(lockEntryPath);
  const version = requiredString(entry.version, `${lockEntryPath} version`);
  const license = requiredString(entry.license, `${name}@${version} license`);
  if (!reviewedLicenses.has(license)) {
    throw new Error(`Unreviewed production license ${license} for ${name}@${version}`);
  }
  const key = `${name}@${version}`;
  const existing = packageVersions.get(key);
  if (existing && existing.license !== license) {
    throw new Error(`Conflicting licenses for ${key}: ${existing.license} and ${license}`);
  }
  packageVersions.set(key, {
    name,
    version,
    license,
    optional: (existing?.optional ?? true) && entry.optional === true,
  });
}

const rows = [...packageVersions.values()].sort(compareRows);
if (!rows.length) throw new Error('No production dependencies found in package-lock.json');
for (const dependency of directDependencies) {
  if (!rows.some(row => row.name === dependency)) {
    throw new Error(`Direct dependency ${dependency} is missing from the production lock graph`);
  }
}

const report = renderReport(rows, directDependencies);
await handleMode(process.argv[2], report, rows.length, directDependencies.size);

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function handleMode(mode, report, packageVersionCount, directDependencyCount) {
  if (mode === '--print') {
    process.stdout.write(report);
    return;
  }
  if (mode === '--write') {
    await writeFile(noticePath, report, 'utf8');
    console.log(`Updated ${noticePath}`);
    return;
  }
  if (mode !== undefined) throw new Error('Usage: check-third-party-licenses.mjs [--print|--write]');

  const current = (await readFile(noticePath, 'utf8')).replaceAll('\r\n', '\n');
  if (current !== report) {
    throw new Error('THIRD_PARTY_NOTICES.md is stale; review changes and run npm run update:licenses');
  }
  console.log(`Third-party notice is current: ${packageVersionCount} production package versions across ${directDependencyCount} direct dependencies.`);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function packageNameFromLockPath(path) {
  const marker = 'node_modules/';
  return path.slice(path.lastIndexOf(marker) + marker.length);
}

function compareRows(left, right) {
  if (left.name !== right.name) return left.name < right.name ? -1 : 1;
  if (left.version !== right.version) return left.version < right.version ? -1 : 1;
  return 0;
}

function renderReport(rows, directDependencies) {
  const optionalCount = rows.filter(row => row.optional).length;
  const licenseCounts = new Map();
  for (const row of rows) licenseCounts.set(row.license, (licenseCounts.get(row.license) ?? 0) + 1);
  const licenses = [...licenseCounts]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([license, count]) => `\`${license}\` (${count})`)
    .join(', ');
  const table = rows.map(row => {
    const relationship = directDependencies.has(row.name) ? 'direct' : row.optional ? 'optional' : 'transitive';
    return `| \`${escapeCell(row.name)}\` | \`${escapeCell(row.version)}\` | \`${escapeCell(row.license)}\` | ${relationship} |`;
  }).join('\n');

  return [
    '# PixieCore third-party dependency notices',
    '',
    'This file records the production dependency graph locked for the PixieCore',
    'release. It is generated deterministically from `package-lock.json` by',
    '`npm run check:licenses`. Optional platform artifacts are included even when',
    'they are not installed on the current operating system.',
    '',
    'This inventory is informational and does not replace the license text or',
    'notices shipped by each dependency. The dependency package metadata and its',
    'own license files remain authoritative.',
    '',
    'The release gate accepts only the reviewed SPDX expressions listed here. A',
    'new expression fails the gate until it is explicitly reviewed.',
    '',
    `- Production package versions: ${rows.length}`,
    `- Direct dependencies: ${directDependencies.size}`,
    `- Optional lockfile entries: ${optionalCount}`,
    `- Declared licenses: ${licenses}`,
    '',
    '| Package | Version | Declared license | Relationship |',
    '|---|---:|---|---|',
    table,
    '',
  ].join('\n');
}

function escapeCell(value) {
  return value.replaceAll('|', '\\|');
}
