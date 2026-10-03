/**
 * Provides environment discovery bootstrapping behavior for PixieCore.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { ConfigurationError } from '../../contracts/errors/index.js';

/**
 * Carries environment discovery state across a boundary.
 */
export interface EnvironmentDiscoveryContext {
  readonly workingDirectory: string;
  readonly packageRoot: string;
  readonly environment: NodeJS.ProcessEnv;
}

/** Loads PixieCore's environment files in increasing-precedence order. */
export function discoverRuntimeEnvironment(
  context: EnvironmentDiscoveryContext,
): NodeJS.ProcessEnv {
  const cwdFile = resolve(context.workingDirectory, '.env');
  const packageFile = resolve(context.packageRoot, '.env');
  const explicitFile = context.environment.PROMPT_RUNTIME_ENV_FILE;
  const fromFiles: Record<string, string> = {};

  for (const path of unique([cwdFile, packageFile, explicitFile])) {
    const exists = existsSync(path);
    if (!exists && path === explicitFile) {
      throw new ConfigurationError(`Environment file not found: ${path}`);
    }
    if (!exists) continue;
    try { Object.assign(fromFiles, parse(readFileSync(path))); }
    catch (cause) {
      throw new ConfigurationError(`Failed to read environment file: ${path}`, { cause });
    }
  }
  return { ...fromFiles, ...context.environment };
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
