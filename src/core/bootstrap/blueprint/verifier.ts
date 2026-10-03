/**
 * Provides verifier bootstrapping behavior for PixieCore.
 */

import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { resolvePixieCorePackageRoot } from '../config/package-root.js';
import { BlueprintValidationError } from '../../contracts/errors/index.js';
import {
  signDistributionValue,
  verifyDistributionValue,
  type DistributionSignature,
} from '../distribution-signatures.js';
import {
  BLUEPRINT_PACKAGE_FILENAME,
  CURRENT_POP_VERSION,
  type BlueprintPackageMetadata,
  type BlueprintPackageProvenance,
  type VerifiedBlueprintPackage,
} from './contracts.js';
import {
  listBlueprintPackageFiles,
  packageErrorMessage,
  readBlueprintPackageJson,
  readBlueprintPackageYaml,
  resolveBlueprintPackageRoot,
  safeBlueprintPackagePath,
  sha256BlueprintPackageFile,
  writeBlueprintPackageMetadata,
} from './io.js';

interface SemverRuntime {
  /**
   * Checks whether the supplied value satisfies the declared constraint.
   */
  satisfies(version: string, range: string): boolean;
  /**
   * Returns the canonical value when the input is valid, otherwise null.
   */
  valid(version: string): string | null;
  /**
   * Checks whether the supplied value falls within the permitted range.
   */
  validRange(range: string): string | null;
}

const semver = createRequire(import.meta.url)('semver') as SemverRuntime;
let metadataValidator: Promise<ValidateFunction> | undefined;
let blueprintValidator: Promise<ValidateFunction> | undefined;

/**
 * Validates blueprint package and rejects unsupported input.
 */
export async function verifyBlueprintPackage(
  sourceInput: string,
  options: {
    readonly pixiecoreVersion: string;
    readonly popVersion?: string;
    readonly publicKeyPath?: string;
    readonly requireSignature?: boolean;
  },
): Promise<VerifiedBlueprintPackage> {
  const rootPath = await resolveBlueprintPackageRoot(sourceInput);
  const metadata = await validatedMetadata(rootPath);
  validateCompatibility(metadata, options.pixiecoreVersion, options.popVersion ?? CURRENT_POP_VERSION);
  validatePackageIdentity(metadata);
  await validateInventory(rootPath, metadata);
  await validateBlueprints(rootPath, metadata);
  const signature = await verifySignature(metadata, options);
  return Object.freeze({ rootPath, metadata, signature });
}

/**
 * Signs blueprint package for the owning PixieCore boundary.
 */
export async function signBlueprintPackage(
  sourceInput: string,
  privateKeyPath: string,
  versions: { readonly pixiecoreVersion: string; readonly popVersion?: string },
): Promise<BlueprintPackageMetadata> {
  const verified = await verifyBlueprintPackage(sourceInput, versions);
  const unsigned = withoutSignature(verified.metadata);
  let signature: DistributionSignature;
  try {
    signature = await signDistributionValue(unsigned, resolve(privateKeyPath), 'Blueprint package');
  } catch (cause) {
    throw new BlueprintValidationError(packageErrorMessage(cause), { cause });
  }
  const signed = Object.freeze({ ...unsigned, signature });
  await writeBlueprintPackageMetadata(join(verified.rootPath, BLUEPRINT_PACKAGE_FILENAME), signed);
  return signed;
}

/**
 * Sets blueprint package provenance for the owning PixieCore boundary.
 */
export async function setBlueprintPackageProvenance(
  sourceInput: string,
  provenance: BlueprintPackageProvenance,
  versions: { readonly pixiecoreVersion: string; readonly popVersion?: string },
): Promise<BlueprintPackageMetadata> {
  const verified = await verifyBlueprintPackage(sourceInput, versions);
  const metadata = Object.freeze({
    ...withoutSignature(verified.metadata),
    provenance: Object.freeze(validateProvenance(provenance)),
  });
  await writeBlueprintPackageMetadata(join(verified.rootPath, BLUEPRINT_PACKAGE_FILENAME), metadata);
  return metadata;
}

function validateCompatibility(
  metadata: BlueprintPackageMetadata,
  pixiecoreVersion: string,
  popVersion: string,
): void {
  for (const [name, version, range] of [
    ['POP', popVersion, metadata.compatibility.pop],
    ['PixieCore', pixiecoreVersion, metadata.compatibility.pixiecore],
  ] as const) {
    if (range === undefined) continue;
    if (!semver.valid(version) || !semver.validRange(range)) {
      throw new BlueprintValidationError(`Invalid ${name} compatibility version or range`);
    }
    if (semver.satisfies(version, range)) continue;
    throw new BlueprintValidationError(
      `Blueprint package requires ${name} ${range}; current ${version}`,
    );
  }
}

function validatePackageIdentity(metadata: BlueprintPackageMetadata): void {
  const ids = new Set<string>();
  for (const blueprint of metadata.blueprints) {
    if (!blueprint.id.startsWith(`${metadata.package.namespace}.`)) {
      throw new BlueprintValidationError(
        `Blueprint id must belong to package namespace ${metadata.package.namespace}: ${blueprint.id}`,
      );
    }
    if (ids.has(blueprint.id)) {
      throw new BlueprintValidationError(`Duplicate Blueprint id in package: ${blueprint.id}`);
    }
    ids.add(blueprint.id);
  }
  for (const [name, range] of Object.entries(metadata.dependencies ?? {})) {
    if (name === metadata.package.name) {
      throw new BlueprintValidationError('Blueprint package may not depend on itself');
    }
    if (!semver.validRange(range)) {
      throw new BlueprintValidationError(`Invalid Blueprint package dependency range: ${name}@${range}`);
    }
  }
}

async function validatedMetadata(rootPath: string): Promise<BlueprintPackageMetadata> {
  const metadataPath = join(rootPath, BLUEPRINT_PACKAGE_FILENAME);
  const value = await readBlueprintPackageJson(metadataPath, 'Blueprint package metadata');
  const validate = await getMetadataValidator();
  if (!validate(value)) {
    throw new BlueprintValidationError(
      `Invalid Blueprint package metadata: ${formatValidationErrors(validate)}`,
    );
  }
  return value as BlueprintPackageMetadata;
}

async function validateInventory(
  rootPath: string,
  metadata: BlueprintPackageMetadata,
): Promise<void> {
  const declaredFiles = Object.keys(metadata.files).sort();
  const actualFiles = await listBlueprintPackageFiles(rootPath);
  if (JSON.stringify(actualFiles) !== JSON.stringify(declaredFiles)) {
    throw new BlueprintValidationError('Blueprint package file inventory does not match metadata');
  }
  for (const path of declaredFiles) {
    const actual = await sha256BlueprintPackageFile(safeBlueprintPackagePath(rootPath, path));
    if (actual !== metadata.files[path]) {
      throw new BlueprintValidationError(`Blueprint package integrity mismatch: ${path}`);
    }
  }
}

async function validateBlueprints(
  rootPath: string,
  metadata: BlueprintPackageMetadata,
): Promise<void> {
  const validate = await getBlueprintValidator();
  for (const blueprint of metadata.blueprints) {
    if (!Object.hasOwn(metadata.files, blueprint.path)) {
      throw new BlueprintValidationError(
        `Blueprint package inventory is missing declared Blueprint: ${blueprint.path}`,
      );
    }
    const value = await readBlueprintPackageYaml(
      safeBlueprintPackagePath(rootPath, blueprint.path),
      'Blueprint',
    );
    if (!validate(value)) {
      throw new BlueprintValidationError(
        `Invalid packaged Blueprint ${blueprint.path}: ${formatValidationErrors(validate)}`,
      );
    }
    if (record(value).version !== blueprint.version) {
      throw new BlueprintValidationError(
        `Packaged Blueprint version does not match metadata: ${blueprint.id}`,
      );
    }
  }
}

async function verifySignature(
  metadata: BlueprintPackageMetadata,
  options: {
    readonly publicKeyPath?: string;
    readonly requireSignature?: boolean;
  },
) {
  try {
    return await verifyDistributionValue(withoutSignature(metadata), metadata.signature, {
      ...(options.publicKeyPath === undefined ? {} : { publicKeyPath: resolve(options.publicKeyPath) }),
      ...(options.requireSignature === undefined ? {} : { requireSignature: options.requireSignature }),
      label: 'Blueprint package',
    });
  } catch (cause) {
    throw new BlueprintValidationError(packageErrorMessage(cause), { cause });
  }
}

function withoutSignature(metadata: BlueprintPackageMetadata): BlueprintPackageMetadata {
  const { signature: _signature, ...unsigned } = metadata;
  return unsigned;
}

function validateProvenance(value: BlueprintPackageProvenance): BlueprintPackageProvenance {
  if (value.source !== undefined && !value.source.trim()) {
    throw new BlueprintValidationError('Blueprint package provenance source must be non-empty');
  }
  if (value.commit !== undefined && !/^[0-9a-f]{7,64}$/iu.test(value.commit)) {
    throw new BlueprintValidationError('Blueprint package provenance commit must be a hexadecimal revision');
  }
  return {
    ...(value.source === undefined ? {} : { source: value.source }),
    ...(value.commit === undefined ? {} : { commit: value.commit }),
  };
}

async function getMetadataValidator(): Promise<ValidateFunction> {
  metadataValidator ??= compileSchema('pixiecore.blueprint-package-v1.schema.json');
  return metadataValidator;
}

async function getBlueprintValidator(): Promise<ValidateFunction> {
  blueprintValidator ??= compileSchema('pixiecore.blueprint-v1.schema.json');
  return blueprintValidator;
}

async function compileSchema(filename: string): Promise<ValidateFunction> {
  const root = resolvePixieCorePackageRoot(import.meta.url);
  const schema = await readBlueprintPackageJson(join(root, 'schemas', filename), `${filename} schema`);
  return new Ajv2020({ allErrors: true, strict: true }).compile(schema as object);
}

function formatValidationErrors(validate: ValidateFunction): string {
  return validate.errors?.map(error => `${error.instancePath || '/'} ${error.message}`).join('; ')
    ?? 'unknown schema error';
}

function record(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new BlueprintValidationError('Blueprint package data must contain objects');
}
