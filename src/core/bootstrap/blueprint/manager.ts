/**
 * Provides manager bootstrapping behavior for PixieCore.
 */

import { createRequire } from 'node:module';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BlueprintValidationError, ConfigurationError } from '../../contracts/errors/index.js';
import {
  BLUEPRINT_PACKAGE_FILENAME,
  BLUEPRINT_PACKAGE_STATE_SCHEMA,
  CURRENT_POP_VERSION,
  DEFAULT_BLUEPRINT_PACKAGE_DIRECTORY,
  DEFAULT_BLUEPRINT_PACKAGE_STATE_FILENAME,
  type BlueprintPackageInstallOptions,
  type BlueprintPackageInstallResult,
  type BlueprintPackageMetadata,
  type BlueprintPackageState,
  type BlueprintPackageStateEntry,
  type VerifiedBlueprintPackage,
} from './contracts.js';
import {
  copyBlueprintPackage,
  readBlueprintPackageJson,
} from './io.js';
import {
  blueprintPackageVersionPath,
  freezeBlueprintPackageStateEntry,
  installedBlueprintPackagePath,
  mutableBlueprintPackageState,
  readBlueprintPackageState,
  sortBlueprintPackageVersions,
  writeBlueprintPackageState,
} from './state.js';
import {
  setBlueprintPackageProvenance,
  signBlueprintPackage,
  verifyBlueprintPackage,
} from './verifier.js';

export {
  BLUEPRINT_PACKAGE_FILENAME,
  BLUEPRINT_PACKAGE_STATE_SCHEMA,
  CURRENT_POP_VERSION,
  DEFAULT_BLUEPRINT_PACKAGE_DIRECTORY,
  DEFAULT_BLUEPRINT_PACKAGE_STATE_FILENAME,
  readBlueprintPackageState,
  setBlueprintPackageProvenance,
  signBlueprintPackage,
  verifyBlueprintPackage,
};

export type {
  BlueprintPackageInstallOptions,
  BlueprintPackageInstallResult,
  BlueprintPackageMetadata,
  BlueprintPackageProvenance,
  BlueprintPackageState,
  BlueprintPackageStateEntry,
  VerifiedBlueprintPackage,
} from './contracts.js';

interface SemverRuntime {
  /**
   * Compares the supplied values according to the configured evaluation policy.
   */
  compare(left: string, right: string): number;
  /**
   * Checks whether the supplied value satisfies the declared constraint.
   */
  satisfies(version: string, range: string): boolean;
}

const semver = createRequire(import.meta.url)('semver') as SemverRuntime;

/**
 * Installs blueprint package for the owning PixieCore boundary.
 */
export async function installBlueprintPackage(
  options: BlueprintPackageInstallOptions,
): Promise<BlueprintPackageInstallResult> {
  const verified = await verifyBlueprintPackage(options.source, options);
  const configPath = resolve(options.configPath);
  const state = await readBlueprintPackageState(configPath);
  const current = state.packages[verified.metadata.package.name];
  if (current?.installed.includes(verified.metadata.package.version)) {
    return reinstallBlueprintPackage(configPath, state, current, verified, options);
  }
  if (current) {
    throw new ConfigurationError(
      `Blueprint package ${verified.metadata.package.name} is already installed at ${current.active}; use upgrade for ${verified.metadata.package.version}`,
    );
  }
  await assertPackageDependencies(state, verified.metadata, options.enable === true);
  await assertNoBlueprintCollisions(state, verified.metadata, options);
  return installNewBlueprintPackage(configPath, state, verified, options.enable ?? false);
}

/**
 * Upgrades blueprint package for the owning PixieCore boundary.
 */
export async function upgradeBlueprintPackage(
  options: Omit<BlueprintPackageInstallOptions, 'enable'>,
): Promise<BlueprintPackageInstallResult> {
  const verified = await verifyBlueprintPackage(options.source, options);
  const configPath = resolve(options.configPath);
  const state = await readBlueprintPackageState(configPath);
  const name = verified.metadata.package.name;
  const current = state.packages[name];
  if (!current) throw new ConfigurationError(`Blueprint package is not installed: ${name}`);
  if (semver.compare(verified.metadata.package.version, current.active) <= 0) {
    throw new ConfigurationError(
      `Blueprint package upgrade must be newer than ${current.active}: ${verified.metadata.package.version}`,
    );
  }
  assertPublisherKey(current, verified);
  await assertPackageDependencies(state, verified.metadata, current.enabled);
  await assertNoBlueprintCollisions(state, verified.metadata, options);
  const target = installedBlueprintPackagePath(state, verified.metadata);
  const alreadyInstalled = current.installed.includes(verified.metadata.package.version);
  if (alreadyInstalled) await assertInstalledPackageMatches(state, verified.metadata, options);
  else await copyBlueprintPackage(verified.rootPath, verified.metadata, target);
  try {
    await activateVersion(
      configPath,
      state,
      name,
      verified.metadata.package.version,
      current.enabled,
      verified.signature === 'verified' ? verified.metadata.signature?.keyId : undefined,
    );
  } catch (cause) {
    if (!alreadyInstalled) await rm(target, { recursive: true, force: true });
    throw cause;
  }
  return resultFor(verified, target, current.enabled, 'upgrade');
}

/**
 * Sets blueprint package enabled for the owning PixieCore boundary.
 */
export async function setBlueprintPackageEnabled(
  configPathInput: string,
  name: string,
  enabled: boolean,
): Promise<BlueprintPackageStateEntry> {
  const configPath = resolve(configPathInput);
  const state = await readBlueprintPackageState(configPath);
  const current = state.packages[name];
  if (!current) throw new ConfigurationError(`Blueprint package is not installed: ${name}`);
  if (enabled) {
    await assertPackageDependencies(state, await installedMetadata(state, name, current.active), true);
  } else {
    await assertNoEnabledDependents(state, name, current.active, true);
  }
  const mutable = mutableBlueprintPackageState(state);
  mutable.packages[name]!.enabled = enabled;
  await writeBlueprintPackageState(configPath, mutable);
  return freezeBlueprintPackageStateEntry(mutable.packages[name]!);
}

/**
 * Rolls back blueprint package for the owning PixieCore boundary.
 */
export async function rollbackBlueprintPackage(
  configPathInput: string,
  name: string,
): Promise<BlueprintPackageStateEntry> {
  const configPath = resolve(configPathInput);
  const state = await readBlueprintPackageState(configPath);
  const current = state.packages[name];
  if (!current) throw new ConfigurationError(`Blueprint package is not installed: ${name}`);
  const previous = current.history.at(-1);
  if (!previous) throw new ConfigurationError(`Blueprint package has no rollback version: ${name}`);
  if (current.enabled) {
    await assertPackageDependencies(state, await installedMetadata(state, name, previous), true);
    await assertNoEnabledDependents(state, name, previous, false);
  }
  const mutable = mutableBlueprintPackageState(state);
  const entry = mutable.packages[name]!;
  entry.active = previous;
  entry.history.pop();
  await writeBlueprintPackageState(configPath, mutable);
  return freezeBlueprintPackageStateEntry(entry);
}

/** Resolves a validated, immutable snapshot of every enabled active package. */
export async function resolveEnabledBlueprintPackages(
  configPathInput: string,
  versions: { readonly pixiecoreVersion: string; readonly popVersion?: string },
): Promise<readonly VerifiedBlueprintPackage[]> {
  const state = await readBlueprintPackageState(configPathInput);
  const packages: VerifiedBlueprintPackage[] = [];
  for (const name of Object.keys(state.packages).sort()) {
    const entry = state.packages[name]!;
    if (!entry.enabled) continue;
    packages.push(await verifyBlueprintPackage(
      blueprintPackageVersionPath(state.packagesRoot, name, entry.active),
      versions,
    ));
  }
  for (const item of packages) await assertPackageDependencies(state, item.metadata, true);
  return Object.freeze(packages);
}

async function reinstallBlueprintPackage(
  configPath: string,
  state: BlueprintPackageState,
  current: BlueprintPackageStateEntry,
  verified: VerifiedBlueprintPackage,
  options: BlueprintPackageInstallOptions,
): Promise<BlueprintPackageInstallResult> {
  await assertInstalledPackageMatches(state, verified.metadata, options);
  assertPublisherKey(current, verified);
  await assertPackageDependencies(state, verified.metadata, options.enable === true);
  if (options.enable && current.active !== verified.metadata.package.version) {
    throw new ConfigurationError(
      `Blueprint package ${verified.metadata.package.name}@${verified.metadata.package.version} is not active; use rollback or upgrade to change the version pin`,
    );
  }
  if (options.enable && !current.enabled) {
    await activateVersion(
      configPath,
      state,
      verified.metadata.package.name,
      verified.metadata.package.version,
      true,
    );
  }
  return resultFor(
    verified,
    installedBlueprintPackagePath(state, verified.metadata),
    options.enable ?? current.enabled,
    'install',
  );
}

async function installNewBlueprintPackage(
  configPath: string,
  state: BlueprintPackageState,
  verified: VerifiedBlueprintPackage,
  enabled: boolean,
): Promise<BlueprintPackageInstallResult> {
  const target = installedBlueprintPackagePath(state, verified.metadata);
  await copyBlueprintPackage(verified.rootPath, verified.metadata, target);
  try {
    const mutable = mutableBlueprintPackageState(state);
    mutable.packages[verified.metadata.package.name] = {
      active: verified.metadata.package.version,
      enabled,
      installed: [verified.metadata.package.version],
      history: [],
      ...(verified.signature === 'verified' && verified.metadata.signature
        ? { publisherKeyId: verified.metadata.signature.keyId }
        : {}),
    };
    await writeBlueprintPackageState(configPath, mutable);
  } catch (cause) {
    await rm(target, { recursive: true, force: true });
    throw cause;
  }
  return resultFor(verified, target, enabled, 'install');
}

async function activateVersion(
  configPath: string,
  state: BlueprintPackageState,
  name: string,
  version: string,
  enabled: boolean,
  publisherKeyId?: string,
): Promise<void> {
  const mutable = mutableBlueprintPackageState(state);
  const current = mutable.packages[name];
  if (!current) throw new ConfigurationError(`Blueprint package is not installed: ${name}`);
  if (!current.installed.includes(version)) {
    current.installed = sortBlueprintPackageVersions([...current.installed, version]);
  }
  if (current.active !== version) {
    current.history.push(current.active);
    current.active = version;
  }
  current.enabled = enabled;
  if (!current.publisherKeyId && publisherKeyId) current.publisherKeyId = publisherKeyId;
  await writeBlueprintPackageState(configPath, mutable);
}

async function assertInstalledPackageMatches(
  state: BlueprintPackageState,
  metadata: BlueprintPackageMetadata,
  versions: { readonly pixiecoreVersion: string; readonly popVersion?: string },
): Promise<void> {
  const path = installedBlueprintPackagePath(state, metadata);
  const installed = await verifyBlueprintPackage(path, versions);
  if (JSON.stringify(installed.metadata) === JSON.stringify(metadata)) return;
  throw new ConfigurationError(
    `Installed Blueprint package version has different contents: ${metadata.package.name}@${metadata.package.version}`,
  );
}

async function assertNoBlueprintCollisions(
  state: BlueprintPackageState,
  candidate: BlueprintPackageMetadata,
  versions: { readonly pixiecoreVersion: string; readonly popVersion?: string },
): Promise<void> {
  const candidateIds = new Set(candidate.blueprints.map(blueprint => blueprint.id));
  const compatibility = {
    pixiecoreVersion: versions.pixiecoreVersion,
    ...(versions.popVersion === undefined ? {} : { popVersion: versions.popVersion }),
  };
  for (const [name, entry] of Object.entries(state.packages)) {
    if (name === candidate.package.name) continue;
    for (const version of entry.installed) {
      const metadata = (await verifyBlueprintPackage(
        blueprintPackageVersionPath(state.packagesRoot, name, version),
        compatibility,
      )).metadata;
      const collision = metadata.blueprints.find(blueprint => candidateIds.has(blueprint.id));
      if (!collision) continue;
      throw new ConfigurationError(
        `Blueprint id collision between ${candidate.package.name} and ${name}: ${collision.id}`,
      );
    }
  }
}

function resultFor(
  verified: VerifiedBlueprintPackage,
  path: string,
  enabled: boolean,
  operation: BlueprintPackageInstallResult['operation'],
): BlueprintPackageInstallResult {
  return Object.freeze({
    name: verified.metadata.package.name,
    version: verified.metadata.package.version,
    path,
    enabled,
    operation,
    signature: verified.signature,
  });
}

function assertPublisherKey(
  current: BlueprintPackageStateEntry,
  verified: VerifiedBlueprintPackage,
): void {
  if (!current.publisherKeyId) return;
  if (verified.signature === 'verified'
      && verified.metadata.signature?.keyId === current.publisherKeyId) return;
  throw new BlueprintValidationError(
    `Blueprint package upgrade requires the pinned publisher key ${current.publisherKeyId}`,
  );
}

async function assertPackageDependencies(
  state: BlueprintPackageState,
  metadata: BlueprintPackageMetadata,
  requireEnabled: boolean,
): Promise<void> {
  for (const [name, range] of Object.entries(metadata.dependencies ?? {})) {
    const dependency = state.packages[name];
    if (!dependency) {
      throw new ConfigurationError(
        `Blueprint package ${metadata.package.name} requires missing dependency ${name}@${range}`,
      );
    }
    if (!semver.satisfies(dependency.active, range)) {
      throw new ConfigurationError(
        `Blueprint package ${metadata.package.name} requires ${name}@${range}; active ${dependency.active}`,
      );
    }
    if (requireEnabled && !dependency.enabled) {
      throw new ConfigurationError(
        `Blueprint package ${metadata.package.name} requires enabled dependency ${name}`,
      );
    }
  }
}

async function assertNoEnabledDependents(
  state: BlueprintPackageState,
  name: string,
  targetVersion: string,
  disabling: boolean,
): Promise<void> {
  for (const [candidateName, entry] of Object.entries(state.packages)) {
    if (!entry.enabled || candidateName === name) continue;
    const metadata = await installedMetadata(state, candidateName, entry.active);
    const range = metadata.dependencies?.[name];
    if (range === undefined) continue;
    if (!semver.satisfies(targetVersion, range)) {
      throw new ConfigurationError(
        `Blueprint package ${candidateName} requires ${name}@${range}; target ${targetVersion}`,
      );
    }
    if (disabling) {
      throw new ConfigurationError(
        `Cannot disable Blueprint package ${name}; enabled package ${candidateName} depends on it`,
      );
    }
  }
}

async function installedMetadata(
  state: BlueprintPackageState,
  name: string,
  version: string,
): Promise<BlueprintPackageMetadata> {
  return await readBlueprintPackageJson(
    join(blueprintPackageVersionPath(state.packagesRoot, name, version), BLUEPRINT_PACKAGE_FILENAME),
    'installed Blueprint package metadata',
  ) as BlueprintPackageMetadata;
}
