/**
 * Coordinates config responsibilities inside the PixieCore kernel.
 */

import { ConfigurationError } from '../../contracts/errors/index.js';
import { discoverRuntimeEnvironment } from '../../bootstrap/config/environment-discovery.js';
import { resolvePixieCorePackageRoot } from '../../bootstrap/config/package-root.js';
import { LoggingConfig } from '../../../plugins/logging/logging.js';
import type { ProviderName, RuntimeOptions, ToolChoice } from '../../contracts/types/index.js';

const int = (name: string, value: string | number | undefined, fallback: number, minimum = 0): number => {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && !/^[-+]?\d+$/.test(value.trim())) {
    throw new ConfigurationError(`${name} must be an integer`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new ConfigurationError(`${name} must be an integer`);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new ConfigurationError(`${name} must be at least ${minimum}`);
  return parsed;
};
const num = (name: string, value: string | number | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new ConfigurationError(`${name} must be a finite number`);
  return parsed;
};
const bool = (name: string, value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  throw new ConfigurationError(`${name} must be a boolean`);
};
const toolChoice = (value: string | undefined): ToolChoice | undefined => {
  if (value === undefined || value.trim() === '') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'auto' || normalized === 'required' || normalized === 'none') return normalized;
  throw new ConfigurationError('PROMPT_RUNTIME_TOOL_CHOICE must be auto, required, or none');
};

/**
 * Describes the runtime config contract.
 */
export interface RuntimeConfig {
  provider: ProviderName; temperature: number; maxRetry: number; requestTimeout: number;
  maxToolRounds: number; strictValidation: boolean; usePseudoToolCalling: boolean;
  maxPayloadSize: number; toolChoice?: ToolChoice; model?: string;
}
/**
 * Returns config without exposing mutable internal state.
 */
export function getConfig(overrides: RuntimeOptions = {}, environment?: NodeJS.ProcessEnv): RuntimeConfig {
  const env = getRuntimeEnvironment(environment);
  const model = overrides.model ?? env.PROMPT_RUNTIME_MODEL;
  const defaultToolChoice = overrides.toolChoice ?? toolChoice(env.PROMPT_RUNTIME_TOOL_CHOICE);
  return {
    provider: (typeof overrides.provider === 'string' ? overrides.provider : env.PROMPT_RUNTIME_PROVIDER ?? 'openai') as ProviderName,
    temperature: num('PROMPT_RUNTIME_TEMPERATURE', overrides.temperature ?? env.PROMPT_RUNTIME_TEMPERATURE, 0.7),
    maxRetry: int('PROMPT_RUNTIME_MAX_RETRY', overrides.maxRetry ?? env.PROMPT_RUNTIME_MAX_RETRY, 3),
    requestTimeout: int('PROMPT_RUNTIME_REQUEST_TIMEOUT', overrides.requestTimeout ?? env.PROMPT_RUNTIME_REQUEST_TIMEOUT, 60, 1),
    maxToolRounds: int('PROMPT_RUNTIME_MAX_TOOL_ROUNDS', overrides.maxToolRounds ?? env.PROMPT_RUNTIME_MAX_TOOL_ROUNDS, 10),
    maxPayloadSize: int('PROMPT_RUNTIME_MAX_PAYLOAD_SIZE', overrides.maxPayloadSize ?? env.PROMPT_RUNTIME_MAX_PAYLOAD_SIZE, 100 * 1024, 1),
    strictValidation: overrides.strictValidation ?? bool('PROMPT_RUNTIME_STRICT_VALIDATION', env.PROMPT_RUNTIME_STRICT_VALIDATION, true),
    usePseudoToolCalling: overrides.usePseudoToolCalling ?? bool('PROMPT_RUNTIME_USE_PSEUDO_TOOL_CALLING', env.PROMPT_RUNTIME_USE_PSEUDO_TOOL_CALLING, false),
    ...(defaultToolChoice === undefined ? {} : { toolChoice: defaultToolChoice }),
    ...(model === undefined ? {} : { model }),
  };
}

/**
 * Returns logging config without exposing mutable internal state.
 */
export function getLoggingConfig(overrides: RuntimeOptions = {}, environment?: NodeJS.ProcessEnv): LoggingConfig {
  return LoggingConfig.fromEnvironment(getRuntimeEnvironment(environment), overrides);
}

/** Resolves one immutable environment snapshot for every runtime subsystem. */
export function getRuntimeEnvironment(environment?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (environment !== undefined) return { ...environment };
  return discoverRuntimeEnvironment({
    workingDirectory: process.cwd(),
    packageRoot: resolvePixieCorePackageRoot(import.meta.url),
    environment: process.env,
  });
}
