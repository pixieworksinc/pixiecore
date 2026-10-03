/**
 * Provides package root bootstrapping behavior for PixieCore.
 */

import {
  OwningPackageRootError,
  resolveOwningPackageRoot,
} from '../../component/package-root/index.js';
import { ConfigurationError } from '../../contracts/errors/index.js';

const PIXIECORE_PACKAGE_NAME = '@pixieworks/pixiecore';

/** Finds the PixieCore package that owns a module without consulting process.cwd(). */
export function resolvePixieCorePackageRoot(moduleUrl: string | URL): string {
  try {
    return resolveOwningPackageRoot(moduleUrl, PIXIECORE_PACKAGE_NAME);
  } catch (cause) {
    if (!(cause instanceof OwningPackageRootError)) throw cause;
    throw configurationError(cause);
  }
}

function configurationError(error: OwningPackageRootError): ConfigurationError {
  if (error.failure === 'unexpected-package') {
    return new ConfigurationError(
      `Expected owning package "${PIXIECORE_PACKAGE_NAME}" but found "${error.actualName}" at ${error.path}`,
    );
  }
  if (error.failure === 'missing-package') {
    return new ConfigurationError(
      `Could not find the owning PixieCore package from ${error.path}`,
    );
  }
  const action = error.failure === 'read-manifest' ? 'Failed to read' : 'Invalid';
  return new ConfigurationError(`${action} PixieCore package manifest: ${error.path}`, {
    cause: error.cause,
  });
}
