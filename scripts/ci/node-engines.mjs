/** Checks the locked dependency engines without widening the consumer contract. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

/** Returns actionable engine mismatches for development and production floors. */
export function nodeEngineErrors(policy, lockfile, nodeVersion) {
  const errors = [];
  if (!semver.satisfies(nodeVersion, policy.developmentRange)) {
    errors.push(`Development Node ${nodeVersion} must satisfy ${policy.developmentRange}`);
  }
  if (lockfile.packages[''].engines?.node !== `>=${policy.runtimeMinimum}`) {
    errors.push('Locked package runtime floor does not match Node policy');
  }
  for (const [name, entry] of Object.entries(lockfile.packages)) {
    const range = entry.engines?.node;
    if (!range) continue;
    const versions = entry.dev
      ? [...policy.developmentMinimums, nodeVersion]
      : [...policy.developmentMinimums, nodeVersion, policy.runtimeMinimum];
    for (const version of new Set(versions)) {
      if (semver.satisfies(version, range)) continue;
      errors.push(`${name || 'package'} requires ${range}, incompatible with Node ${version}`);
    }
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = new URL('../../', import.meta.url);
  const policy = JSON.parse(await readFile(new URL('scripts/ci/node-policy.json', root), 'utf8'));
  const lockfile = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'));
  const errors = nodeEngineErrors(policy, lockfile, process.versions.node);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Node engines verified: development ${policy.developmentRange}; runtime >=${policy.runtimeMinimum}`);
  }
}
