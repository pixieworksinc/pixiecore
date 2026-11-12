/** Sequential pre-request holds reconciled only from valid successful-response usage. */
import type { SpendLedger, SpendReservation } from './budget.js';
import { LUNA_BUDGET_NANO_USD, LUNA_PLAN } from './luna.js';

export interface UsageSettlement {
  readonly request: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly usageCeilingNanoUsd: number;
  readonly releasedReservationNanoUsd: number;
}

export interface SuiteSpendSnapshot {
  /** Conservative accounted usage plus the full pending hold; never actual billed cost. */
  readonly reservedNanoUsd: number;
  readonly maxCostNanoUsd: number;
  readonly usageCeilingNanoUsd: number;
  readonly pendingReservationNanoUsd: number;
  readonly requests: number;
  readonly settledRequests: number;
}

export interface SuiteSpendLedger extends SpendLedger {
  readonly snapshot: () => SuiteSpendSnapshot;
  readonly settle: (usage: unknown) => UsageSettlement;
  readonly settlements: () => readonly UsageSettlement[];
}

/** No second in-flight request or reservation release without trustworthy numeric usage. */
export function createSuiteSpendLedger(maxRequests: number): SuiteSpendLedger {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 80) {
    throw new Error('Invalid suite request cap');
  }
  let requests = 0;
  let usageCeilingNanoUsd = 0;
  let pending: SpendReservation | undefined;
  const journal: UsageSettlement[] = [];
  const charge = (input: number, output: number): number => Number(
    BigInt(input) * BigInt(LUNA_PLAN.prices.inputNanoUsdPerToken)
    + BigInt(output) * BigInt(LUNA_PLAN.prices.outputNanoUsdPerToken),
  );
  return {
    snapshot: () => ({ reservedNanoUsd: usageCeilingNanoUsd + (pending?.reservedNanoUsd ?? 0),
      maxCostNanoUsd: LUNA_BUDGET_NANO_USD, usageCeilingNanoUsd,
      pendingReservationNanoUsd: pending?.reservedNanoUsd ?? 0, requests, settledRequests: journal.length }),
    settlements: () => journal.map(entry => ({ ...entry })),
    reserve: async (_request, outputTokens, signal) => {
      signal?.throwIfAborted();
      if (pending) throw new Error('Prior suite reservation is unsettled');
      if (requests >= maxRequests) throw new Error('Suite request cap exhausted');
      if (!Number.isSafeInteger(outputTokens) || outputTokens < 1 || outputTokens > LUNA_PLAN.maxOutputTokens) {
        throw new Error('Invalid suite output bound');
      }
      const reservedNanoUsd = charge(LUNA_PLAN.maxInputTokens, outputTokens);
      if (reservedNanoUsd > LUNA_BUDGET_NANO_USD - usageCeilingNanoUsd) throw new Error('Suite spend budget exhausted');
      // No await between checking the common balance and taking the only pending hold.
      pending = { inputTokensReserved: LUNA_PLAN.maxInputTokens, outputTokenLimit: outputTokens, reservedNanoUsd };
      requests++;
      return { ...pending };
    },
    settle: usage => {
      if (!pending) throw new Error('No pending suite reservation');
      if (!usage || typeof usage !== 'object' || Array.isArray(usage)) throw new Error('Suite usage unavailable');
      const values = usage as Record<string, unknown>;
      const input = values.prompt_tokens;
      const output = values.completion_tokens;
      const total = values.total_tokens;
      if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 1 || input > LUNA_PLAN.maxInputTokens
        || typeof output !== 'number' || !Number.isSafeInteger(output) || output < 0 || output > pending.outputTokenLimit
        || typeof total !== 'number' || !Number.isSafeInteger(total) || total !== input + output) {
        throw new Error('Invalid suite token usage');
      }
      const observedCeiling = charge(input, output);
      const entry = { request: requests, inputTokens: input, outputTokens: output,
        usageCeilingNanoUsd: observedCeiling, releasedReservationNanoUsd: pending.reservedNanoUsd - observedCeiling };
      usageCeilingNanoUsd += observedCeiling;
      pending = undefined;
      journal.push(entry);
      return { ...entry };
    },
  };
}
