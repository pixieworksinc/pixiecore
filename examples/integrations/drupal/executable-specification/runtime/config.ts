/** Explicit operator settings for the existing two-call live demonstration. */
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export interface LiveSettings {
  expiresAt: string; statePath: string; templatePath: string; apiKeyPath: string; transportTokenPath: string;
}
export type LiveConfig = LiveSettings & typeof LIMITS;

const LIMITS = Object.freeze({ model: 'gpt-6-luna', baseUrl: 'https://api.openai.com/v1',
  host: '127.0.0.1', port: 3087, maxOutputTokens: 512, temperature: 0,
  requestTimeoutMs: 30000, maxRequestBytes: 16384, maxInstructionBytes: 8192, maxInputBytes: 2048 });

/** Keep the provider and limits fixed; operator files supply only paths and expiry. */
export function validateLiveConfig(input: unknown): LiveConfig {
  const value = input as Record<string, unknown>;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid live demo configuration.');
  const fields = ['expiresAt', 'statePath', 'templatePath', 'apiKeyPath', 'transportTokenPath'];
  if (fields.some(key => typeof value[key] !== 'string' || !(value[key] as string).trim())
    || Object.keys(value).some(key => !fields.includes(key) && (!Object.hasOwn(LIMITS, key) || value[key] !== LIMITS[key as keyof typeof LIMITS]))) {
    throw Error('Unexpected live demo configuration fields.');
  }
  if (!Number.isFinite(Date.parse(value.expiresAt as string)) || fields.slice(1).some(key => !isAbsolute(value[key] as string))) {
    throw Error('Live settings require an explicit deadline and absolute paths.');
  }
  return Object.freeze({ ...value, ...LIMITS }) as LiveConfig;
}

/** Read only an explicitly selected nonsecret settings file. */
export function loadLiveConfig(path: string | undefined): LiveConfig {
  if (!path?.trim()) throw Error('PIXIECORE_DEMO_CONFIG must name a settings file.');
  return validateLiveConfig(JSON.parse(readFileSync(path, 'utf8')));
}
