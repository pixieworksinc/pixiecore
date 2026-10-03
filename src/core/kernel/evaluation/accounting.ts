/**
 * Coordinates accounting responsibilities inside the PixieCore kernel.
 */

import type {
  BlueprintProviderUsage,
} from '../../contracts/evaluation/index.js';
import type {
  ExecutionTelemetry,
  TelemetryPricingRule,
} from '../../contracts/telemetry/index.js';
import type { RuntimeOptions } from '../../contracts/types/index.js';

const OPENAI_PRICING_SOURCE = 'https://developers.openai.com/api/docs/pricing';
const OPENAI_PRICING_VERIFIED_AT = '2026-08-26T00:00:00.000Z';

const BUNDLED_PRICING = Object.freeze([
  Object.freeze({
    provider: 'openai',
    model: 'gpt-4.1-mini',
    currency: 'USD',
    inputPerMillionTokens: 0.4,
    outputPerMillionTokens: 1.6,
    source: OPENAI_PRICING_SOURCE,
    effectiveAt: OPENAI_PRICING_VERIFIED_AT,
  }),
] satisfies readonly TelemetryPricingRule[]);

/**
 * Handles evaluation pricing rules for the owning PixieCore boundary.
 */
export function evaluationPricingRules(
  options: RuntimeOptions | undefined,
  environment: NodeJS.ProcessEnv,
  explicit: readonly TelemetryPricingRule[] | undefined,
): readonly TelemetryPricingRule[] {
  const rules = new Map<string, TelemetryPricingRule>();
  if (usesOfficialOpenAIEndpoint(options, environment)) {
    for (const rule of BUNDLED_PRICING) rules.set(pricingKey(rule), rule);
  }
  const explicitKeys = new Set<string>();
  for (const rule of explicit ?? []) {
    const key = pricingKey(rule);
    if (explicitKeys.has(key)) {
      throw new TypeError(`Duplicate evaluation pricing rule: ${rule.provider}/${rule.model}`);
    }
    explicitKeys.add(key);
    rules.set(key, rule);
  }
  return Object.freeze([...rules.values()].map(rule => Object.freeze({ ...rule })));
}

/**
 * Handles evaluation provider usage for the owning PixieCore boundary.
 */
export function evaluationProviderUsage(
  telemetry: ExecutionTelemetry,
  pricing: readonly TelemetryPricingRule[],
): readonly BlueprintProviderUsage[] {
  const rates = new Map(pricing.map(rule => [pricingKey(rule), rule]));
  const unit = telemetry.units[0];
  if (!unit) return Object.freeze([]);
  return Object.freeze(unit.provider_usage.map(item => {
    const rule = rates.get(pricingKey(item));
    return Object.freeze({
      provider: item.provider,
      model: item.model,
      calls: item.calls,
      input_tokens: item.tokens?.input_tokens ?? null,
      output_tokens: item.tokens?.output_tokens ?? null,
      total_tokens: item.tokens?.total_tokens ?? null,
      estimated_cost: item.cost === null
        ? null
        : Object.freeze({ currency: item.cost.currency, amount: item.cost.amount }),
      cost_status: item.cost_status,
      pricing: rule === undefined
        ? null
        : Object.freeze({
            currency: rule.currency,
            input_per_million_tokens: rule.inputPerMillionTokens,
            output_per_million_tokens: rule.outputPerMillionTokens,
            source: rule.source,
            effective_at: rule.effectiveAt,
          }),
    });
  }));
}

function usesOfficialOpenAIEndpoint(
  options: RuntimeOptions | undefined,
  environment: NodeJS.ProcessEnv,
): boolean {
  if (typeof options?.provider === 'object') return false;
  const provider = typeof options?.provider === 'string'
    ? options.provider
    : environment.PROMPT_RUNTIME_PROVIDER ?? 'openai';
  if (provider !== 'openai') return false;
  const baseUrl = environment.OPENAI_BASE_URL?.trim();
  if (!baseUrl) return true;
  return baseUrl.replace(/\/+$/u, '') === 'https://api.openai.com/v1';
}

function pricingKey(value: Pick<TelemetryPricingRule, 'provider' | 'model'>): string {
  return `${value.provider}\u0000${value.model}`;
}
