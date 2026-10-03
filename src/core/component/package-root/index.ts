/**
 * Provides reusable package root primitives for PixieCore.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Defines the supported owning package root failure values.
 */
export type OwningPackageRootFailure =
  | 'read-manifest'
  | 'invalid-manifest'
  | 'unexpected-package'
  | 'missing-package';

/** Generic package-boundary discovery failure without PixieCore dependencies. */
export class OwningPackageRootError extends Error {
  /**
   * Creates a OwningPackageRootError with the supplied failure context.
   */
  constructor(
    public readonly failure: OwningPackageRootFailure,
    public readonly path: string,
    public readonly expectedName: string,
    public readonly actualName?: string,
    options?: ErrorOptions,
  ) {
    super(`Owning package discovery failed (${failure}): ${path}`, options);
    this.name = 'OwningPackageRootError';
  }
}

/** Walks upward to the nearest package.json and validates its package name. */
export function resolveOwningPackageRoot(
  moduleUrl: string | URL,
  expectedName: string,
): string {
  const modulePath = fileURLToPath(moduleUrl);
  let directory = dirname(modulePath);

  while (true) {
    const manifestPath = join(directory, 'package.json');
    const manifest = readPackageManifest(manifestPath, expectedName);
    if (manifest !== undefined) {
      const actualName = typeof manifest.name === 'string' ? manifest.name : '<missing>';
      if (actualName !== expectedName) {
        throw new OwningPackageRootError(
          'unexpected-package',
          manifestPath,
          expectedName,
          actualName,
        );
      }
      return directory;
    }

    const parent = dirname(directory);
    if (parent === directory) {
      throw new OwningPackageRootError('missing-package', modulePath, expectedName);
    }
    directory = parent;
  }
}

function readPackageManifest(
  path: string,
  expectedName: string,
): Record<string, unknown> | undefined {
  let source: string;
  try { source = readFileSync(path, 'utf8'); }
  catch (cause) {
    if (isMissingFile(cause)) return undefined;
    throw new OwningPackageRootError(
      'read-manifest',
      path,
      expectedName,
      undefined,
      { cause },
    );
  }

  try {
    const parsed: unknown = JSON.parse(source);
    if (!isRecord(parsed)) throw new TypeError('package.json must contain a JSON object');
    return parsed;
  } catch (cause) {
    throw new OwningPackageRootError(
      'invalid-manifest',
      path,
      expectedName,
      undefined,
      { cause },
    );
  }
}

function isMissingFile(value: unknown): boolean {
  return value instanceof Error && 'code' in value && value.code === 'ENOENT';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
