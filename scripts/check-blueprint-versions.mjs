#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const CONTRACT_FIELDS = [
  'role',
  'input_placeholders',
  'input_schema',
  'output_schema',
  'tools',
  'permissions',
];
const REQUIRED_FIELDS = ['name', 'version', 'role', 'prompt', 'output_schema'];
const ZERO_SHA = /^0+$/;

export function checkBlueprintTransition(
  previousSource,
  currentSource,
  path = 'Blueprint',
  { allowRemoval = false, identityChanged = false } = {},
) {
  const previous = parseBlueprint(previousSource, `${path} at base`);
  const current = parseBlueprint(currentSource, `${path} at current`);
  if (!previous.candidate && !current.candidate) return [];
  if (!previous.candidate) return validateNewBlueprint(current, path);
  if (!current.candidate) {
    return allowRemoval ? [] : [`${path}: removing a Blueprint requires a PixieCore package major bump`];
  }
  if (previous.errors.length || current.errors.length) {
    return [...prefixErrors(previous.errors, path), ...prefixErrors(current.errors, path)];
  }

  const oldVersion = parseVersion(previous.value.version);
  const newVersion = parseVersion(current.value.version);
  const errors = [];
  if (!oldVersion) errors.push(`${path}: base version must be numeric SemVer (major.minor or major.minor.patch)`);
  if (!newVersion) errors.push(`${path}: current version must be numeric SemVer (major.minor or major.minor.patch)`);
  if (!oldVersion || !newVersion) return errors;

  const contentChanged = fingerprint(previous.value, ['version']) !== fingerprint(current.value, ['version']);
  const versionOrder = compareVersions(newVersion, oldVersion);
  if (versionOrder < 0) {
    errors.push(`${path}: version cannot decrease from ${previous.value.version} to ${current.value.version}`);
    return errors;
  }
  if (contentChanged && versionOrder === 0) {
    errors.push(`${path}: content changed without a version bump (${current.value.version})`);
  }

  const contractChanged = fingerprint(previous.value, [], CONTRACT_FIELDS)
    !== fingerprint(current.value, [], CONTRACT_FIELDS);
  if (contractChanged && newVersion.major <= oldVersion.major) {
    errors.push(
      `${path}: contract fields changed, requiring a major bump above ${oldVersion.major}.x`,
    );
  }
  if (identityChanged && newVersion.major <= oldVersion.major) {
    errors.push(`${path}: changing the stable path requires a Blueprint major bump`);
  }
  return errors;
}

export function checkNewBlueprint(source, path = 'Blueprint') {
  return validateNewBlueprint(parseBlueprint(source, path), path);
}

function validateNewBlueprint(parsed, path) {
  if (!parsed.candidate) return [];
  const errors = prefixErrors(parsed.errors, path);
  if (!parsed.errors.length && !parseVersion(parsed.value.version)) {
    errors.push(`${path}: version must be numeric SemVer (major.minor or major.minor.patch)`);
  }
  return errors;
}

function parseBlueprint(source, label) {
  if (source === undefined) return { candidate: false, errors: [], value: undefined };
  let value;
  try {
    value = YAML.parse(source);
  } catch (error) {
    return {
      candidate: looksLikeBlueprintSource(source),
      errors: [`${label} is invalid YAML: ${error instanceof Error ? error.message : String(error)}`],
      value: undefined,
    };
  }
  const candidate = isRecord(value) && (
    'prompt' in value
    || 'output_schema' in value
    || ('role' in value && 'input_placeholders' in value)
  );
  if (!candidate) return { candidate: false, errors: [], value };
  const errors = [];
  for (const field of REQUIRED_FIELDS) {
    if (!(field in value)) errors.push(`${label} is missing required field ${field}`);
  }
  return { candidate: true, errors, value };
}

function looksLikeBlueprintSource(source) {
  return /(^|\n)\s*(?:prompt|output_schema|input_placeholders)\s*:/m.test(source);
}

function prefixErrors(errors, path) {
  return errors.map(error => `${path}: ${error}`);
}

function parseVersion(value) {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] ?? 0) };
}

function compareVersions(left, right) {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function fingerprint(value, omitted = [], selected) {
  const source = selected
    ? Object.fromEntries(selected.map(field => [field, normalizeSchema(value[field])]))
    : Object.fromEntries(
      Object.entries(value)
        .filter(([field]) => !omitted.includes(field))
        .map(([field, item]) => [
          field,
          field === 'input_schema' || field === 'output_schema' ? normalizeSchema(item) : item,
        ]),
    );
  return JSON.stringify(sortValue(source));
}

function normalizeSchema(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortValue(item)]),
  );
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function trackedYamlFiles(root) {
  return git(root, ['ls-files', '-z', '--', '*.yaml', '*.yml']).split('\0').filter(Boolean).sort();
}

function changedYamlFiles(root, base) {
  const fields = git(root, [
    'diff', '--name-status', '-z', '--find-renames', base, '--', '*.yaml', '*.yml',
  ]).split('\0').filter(Boolean);
  const changes = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (status.startsWith('R')) {
      changes.push({ status: 'R', previousPath: fields[index++], currentPath: fields[index++] });
    } else {
      const path = fields[index++];
      changes.push({
        status: status[0],
        previousPath: status[0] === 'A' ? undefined : path,
        currentPath: status[0] === 'D' ? undefined : path,
      });
    }
  }
  return changes;
}

function sourceAtBase(root, base, path) {
  if (!path) return undefined;
  try {
    return git(root, ['show', `${base}:${path}`]);
  } catch {
    return undefined;
  }
}

function sourceAtCurrent(root, path) {
  if (!path) return undefined;
  try {
    return readFileSync(resolve(root, path), 'utf8');
  } catch {
    return undefined;
  }
}

export function checkRepository({ root = process.cwd(), base } = {}) {
  const errors = [];
  let checked = 0;
  if (!base || ZERO_SHA.test(base)) {
    for (const path of trackedYamlFiles(root)) {
      const source = sourceAtCurrent(root, path);
      const candidateErrors = checkNewBlueprint(source, path);
      if (candidateErrors.length || parseBlueprint(source, path).candidate) checked++;
      errors.push(...candidateErrors);
    }
    return { base: undefined, checked, errors };
  }

  git(root, ['cat-file', '-e', `${base}^{commit}`]);
  const allowRemoval = packageMajorAdvanced(root, base);
  for (const change of changedYamlFiles(root, base)) {
    const displayPath = change.status === 'R'
      ? `${change.previousPath} -> ${change.currentPath}`
      : change.currentPath ?? change.previousPath;
    const previousSource = sourceAtBase(root, base, change.previousPath);
    const currentSource = sourceAtCurrent(root, change.currentPath);
    const previousCandidate = parseBlueprint(previousSource, displayPath).candidate;
    const currentCandidate = parseBlueprint(currentSource, displayPath).candidate;
    if (!previousCandidate && !currentCandidate) continue;
    checked++;
    errors.push(...checkBlueprintTransition(previousSource, currentSource, displayPath, {
      allowRemoval,
      identityChanged: change.status === 'R' && change.previousPath !== change.currentPath,
    }));
  }
  return { base, checked, errors };
}

function packageMajorAdvanced(root, base) {
  try {
    const previous = JSON.parse(git(root, ['show', `${base}:package.json`]));
    const current = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    const previousVersion = parseVersion(previous.version);
    const currentVersion = parseVersion(current.version);
    return Boolean(
      previousVersion
      && currentVersion
      && currentVersion.major > previousVersion.major,
    );
  } catch {
    return false;
  }
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--base' && args[index + 1]) options.base = args[++index];
    else if (args[index] === '--root' && args[index + 1]) options.root = args[++index];
    else throw new Error(`Unknown or incomplete argument: ${args[index]}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = checkRepository({
      root: options.root,
      base: options.base ?? process.env.PIXIECORE_BLUEPRINT_BASE_SHA,
    });
    if (result.errors.length) {
      console.error(`Blueprint version policy failed with ${result.errors.length} error(s):`);
      for (const error of result.errors) console.error(`- ${error}`);
      process.exitCode = 1;
    } else {
      const comparison = result.base ? ` against ${result.base}` : ' (current files only)';
      console.log(`Blueprint version policy passed: ${result.checked} Blueprint(s) checked${comparison}.`);
    }
  } catch (error) {
    console.error(`Blueprint version policy could not run: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
