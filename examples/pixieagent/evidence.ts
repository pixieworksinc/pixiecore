/** Value-free source identity and unresolved paid-run settings for offline receipts. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { spendPolicyFor, transportPolicyFor, type TransportPolicy } from './harness.js';
import type { SpendPolicy } from './budget.js';
import { LUNA_BUDGET_NANO_USD, LUNA_PLAN, LUNA_REQUEST_RESERVATION_NANO_USD } from './luna.js';

const exec = promisify(execFile);
const base = dirname(fileURLToPath(import.meta.url));

/** Hash only this experiment's source files, including uncommitted additions. */
async function sourceHashes(directory: string, prefix = '', includeAll = false): Promise<Record<string, string>> {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));
  const hashes: Record<string, string> = {};
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      Object.assign(hashes, await sourceHashes(path, `${relative}/`, includeAll));
    }
    if (entry.isFile() && (includeAll || /\.(?:ts|mjs|yaml|txt|json)$/.test(entry.name))) {
      hashes[relative] = createHash('sha256').update(await readFile(path)).digest('hex');
    }
  }
  return hashes;
}

export interface OfflineManifest {
  readonly schema: 'pixieagent.offline-run/v0';
  readonly createdAt: string;
  readonly mode: 'offline';
  readonly profile: 'fixture' | 'luna';
  readonly nodeVersion: string;
  readonly source: {
    readonly headSha: string;
    readonly headTreeSha: string;
    readonly sha256: Readonly<Record<string, string>>;
    readonly runtime: {
      readonly packageSha256: string;
      readonly lockfileSha256: string;
      readonly distSha256: string;
      readonly nodeVersion: string;
    };
  };
  readonly fixture: {
    readonly transport: TransportPolicy;
    readonly spend: SpendPolicy;
    readonly inputTokensPerRequest: number;
    readonly syntheticPricing: boolean;
    readonly syntheticInputTokens: boolean;
    readonly inputTokensMeasured: false;
    readonly inputAccounting: 'fixture' | 'model-context-upper-bound';
  };
  readonly realModel: {
    readonly authorized: false;
    readonly provider: 'openai';
    readonly endpoint: string;
    readonly model: 'gpt-6-luna';
    readonly maxCostUsd: 1;
    readonly pricingSource: string;
    readonly inputTokenizer: null;
    readonly inputAccounting: 'model-context-upper-bound';
    readonly maximumReservationUsdPerRequest: number;
    readonly expectedThreeRequestReservationUsd: number;
    readonly maximumTransmittableRequestsWithinBudget: number;
    readonly plan: typeof LUNA_PLAN;
    readonly pending: readonly string[];
  };
}

/** Build reviewable evidence without a provider, environment discovery, or credential access. */
export async function createOfflineManifest(profile: 'fixture' | 'luna' = 'fixture'): Promise<OfflineManifest> {
  const { stdout } = await exec('git', ['-C', base, 'rev-parse', 'HEAD', 'HEAD^{tree}']);
  const [headSha, headTreeSha] = stdout.trim().split('\n');
  if (!headSha || !headTreeSha) throw new Error('Cannot establish source identity');
  const root = join(base, '..', '..');
  const digest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
  const runtime = {
    packageSha256: digest(await readFile(join(root, 'package.json'))),
    lockfileSha256: digest(await readFile(join(root, 'package-lock.json'))),
    distSha256: digest(JSON.stringify(await sourceHashes(join(root, 'dist'), '', true))),
    nodeVersion: process.version,
  };
  return {
    schema: 'pixieagent.offline-run/v0',
    createdAt: new Date().toISOString(),
    mode: 'offline' as const,
    profile,
    nodeVersion: process.version,
    source: { headSha, headTreeSha, sha256: await sourceHashes(base), runtime },
    fixture: { transport: transportPolicyFor(profile), spend: spendPolicyFor(profile),
      inputTokensPerRequest: profile === 'luna' ? LUNA_PLAN.maxInputTokens : 256,
      syntheticPricing: profile === 'fixture', syntheticInputTokens: profile === 'fixture',
      inputTokensMeasured: false, inputAccounting: profile === 'luna' ? 'model-context-upper-bound' : 'fixture' },
    realModel: {
      authorized: false, provider: 'openai', endpoint: LUNA_PLAN.endpoint, model: 'gpt-6-luna', maxCostUsd: 1,
      pricingSource: LUNA_PLAN.pricingSource, inputTokenizer: null, plan: LUNA_PLAN,
      inputAccounting: 'model-context-upper-bound',
      maximumReservationUsdPerRequest: LUNA_REQUEST_RESERVATION_NANO_USD / 1_000_000_000,
      expectedThreeRequestReservationUsd: 3 * LUNA_REQUEST_RESERVATION_NANO_USD / 1_000_000_000,
      maximumTransmittableRequestsWithinBudget: Math.min(LUNA_PLAN.maxRequests,
        Math.floor(LUNA_BUDGET_NANO_USD / LUNA_REQUEST_RESERVATION_NANO_USD)),
      pending: ['API account/model access remains unverified until the first approved request', 'explicit paid-run approval'],
    },
  };
}
