/**
 * Implements auth behavior for the api plugin.
 */

import { timingSafeEqual } from 'node:crypto';
import type { ApiCallerIdentity, ApiCallerResolver } from '../../../core/contracts/api/index.js';
import { resolveEnvironmentVariable } from '../../../core/component/environment-alias/index.js';
import { ConfigurationError } from '../../../core/contracts/errors/index.js';

const TOKEN_NAME = 'PIXIECORE_API_TOKEN';

/** Builds CLI-oriented Bearer authentication from the captured environment. */
export function createEnvironmentCallerResolver(
  environment: NodeJS.ProcessEnv,
): ApiCallerResolver | undefined {
  const token = resolveEnvironmentVariable(environment, TOKEN_NAME);
  const identity = environmentIdentity(environment);
  if (!token) {
    if (Object.keys(identity).length) {
      throw new ConfigurationError(
        'PIXIECORE_API_TOKEN is required when API caller identity variables are configured',
      );
    }
    return undefined;
  }
  if (!token.value.trim()) {
    throw new ConfigurationError(`${token.name} must not be empty`);
  }
  return request => {
    const authorization = request.headers.authorization;
    if (!matchesBearerToken(authorization, token.value)) {
      throw new Error('Invalid Bearer credential');
    }
    return identity;
  };
}

function environmentIdentity(environment: NodeJS.ProcessEnv): ApiCallerIdentity {
  const role = resolveEnvironmentVariable(
    environment,
    'PIXIECORE_API_CALLER_ROLE',
  )?.value;
  const userId = resolveEnvironmentVariable(
    environment,
    'PIXIECORE_API_CALLER_ID',
  )?.value;
  const scopeValue = resolveEnvironmentVariable(
    environment,
    'PIXIECORE_API_CALLER_SCOPES',
  )?.value;
  const scopes = scopeValue?.split(',').map(scope => scope.trim()).filter(Boolean);
  return {
    ...(role ? { role } : {}),
    ...(userId ? { userId } : {}),
    ...(scopes?.length ? { scopes } : {}),
  };
}

function matchesBearerToken(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice('Bearer '.length));
  const canonical = Buffer.from(expected);
  return supplied.length === canonical.length && timingSafeEqual(supplied, canonical);
}
