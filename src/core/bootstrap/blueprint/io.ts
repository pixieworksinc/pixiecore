/**
 * Provides io bootstrapping behavior for PixieCore.
 */

import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import YAML from 'yaml';
import { BlueprintValidationError, ConfigurationError } from '../../contracts/errors/index.js';
import { BLUEPRINT_PACKAGE_FILENAME } from './contracts.js';

/**
 * Resolves blueprint package root for the owning PixieCore boundary.
 */
export async function resolveBlueprintPackageRoot(sourceInput: string): Promise<string> {
  const source = resolve(sourceInput);
  const stat = await lstat(source).catch(cause => {
    throw new ConfigurationError(`Cannot resolve Blueprint package source: ${sourceInput}`, { cause });
  });
  if (stat.isSymbolicLink()) {
    throw new BlueprintValidationError('Blueprint package source may not be a symbolic link');
  }
  if (stat.isDirectory()) return realpath(source);
  if (stat.isFile() && source.endsWith(BLUEPRINT_PACKAGE_FILENAME)) {
    return realpath(dirname(source));
  }
  throw new ConfigurationError(
    `Blueprint package source must be a directory or ${BLUEPRINT_PACKAGE_FILENAME}`,
  );
}

/**
 * Lists blueprint package files for the owning PixieCore boundary.
 */
export async function listBlueprintPackageFiles(rootPath: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new BlueprintValidationError(`Blueprint package may not contain symbolic links: ${path}`);
      }
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (entry.isFile() && path !== join(rootPath, BLUEPRINT_PACKAGE_FILENAME)) {
        files.push(relativeBlueprintPackagePath(rootPath, path));
        continue;
      }
      if (!entry.isFile()) {
        throw new BlueprintValidationError(`Blueprint package may contain only files and directories: ${path}`);
      }
    }
  };
  await visit(rootPath);
  return files.sort();
}

/**
 * Produces a safe blueprint package path for the owning PixieCore boundary.
 */
export function safeBlueprintPackagePath(rootPath: string, declaredPath: string): string {
  if (isAbsolute(declaredPath)) {
    throw new BlueprintValidationError(`Unsafe Blueprint package path: ${declaredPath}`);
  }
  const path = resolve(rootPath, ...declaredPath.split('/'));
  const contained = relative(rootPath, path);
  if (contained !== '..' && !contained.startsWith(`..${sep}`) && !isAbsolute(contained)) return path;
  throw new BlueprintValidationError(`Unsafe Blueprint package path: ${declaredPath}`);
}

/**
 * Handles sha256 blueprint package file for the owning PixieCore boundary.
 */
export async function sha256BlueprintPackageFile(path: string): Promise<string> {
  return `sha256-${createHash('sha256').update(await readFile(path)).digest('base64')}`;
}

/**
 * Returns blueprint package json without exposing mutable internal state.
 */
export async function readBlueprintPackageJson(path: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (cause) {
    throw new BlueprintValidationError(`Failed to read ${label}: ${path}`, { cause });
  }
}

/**
 * Returns blueprint package yaml without exposing mutable internal state.
 */
export async function readBlueprintPackageYaml(path: string, label: string): Promise<unknown> {
  try {
    return YAML.parse(await readFile(path, 'utf8'), { maxAliasCount: 0, uniqueKeys: true }) as unknown;
  } catch (cause) {
    throw new BlueprintValidationError(`Failed to read ${label}: ${path}`, { cause });
  }
}

/**
 * Writes blueprint package metadata for the owning PixieCore boundary.
 */
export async function writeBlueprintPackageMetadata(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.pixiecore-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o644,
    });
    await rename(temporary, path);
  } catch (cause) {
    await rm(temporary, { force: true });
    throw new ConfigurationError(`Failed to write Blueprint package metadata: ${path}`, { cause });
  }
}

/**
 * Copies blueprint package for the owning PixieCore boundary.
 */
export async function copyBlueprintPackage(
  rootPath: string,
  metadata: { readonly files: Readonly<Record<string, string>> },
  target: string,
): Promise<void> {
  const existing = await lstat(target).catch(cause => (
    isMissingFile(cause) ? undefined : Promise.reject(cause)
  ));
  if (existing) throw new ConfigurationError(`Blueprint package target already exists: ${target}`);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.pixiecore-${process.pid}-${Date.now()}`;
  try {
    await mkdir(temporary);
    for (const path of Object.keys(metadata.files).sort()) {
      const destination = join(temporary, ...path.split('/'));
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, await readFile(safeBlueprintPackagePath(rootPath, path)), { flag: 'wx' });
    }
    await writeFile(
      join(temporary, BLUEPRINT_PACKAGE_FILENAME),
      `${JSON.stringify(metadata, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
    await rename(temporary, target);
  } catch (cause) {
    await rm(temporary, { recursive: true, force: true });
    throw new ConfigurationError(`Failed to install Blueprint package: ${target}`, { cause });
  }
}

/**
 * Reports whether missing file.
 */
export function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * Handles package error message for the owning PixieCore boundary.
 */
export function packageErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function relativeBlueprintPackagePath(rootPath: string, path: string): string {
  return relative(rootPath, path).split(sep).join('/');
}
