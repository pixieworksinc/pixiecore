/** Conservative pre-request reservations. Prices and token counts belong to the host. */
export interface SpendPolicy {
  readonly maxInputTokens: number;
  readonly maxCostNanoUsd: number;
  readonly inputNanoUsdPerToken: number;
  readonly outputNanoUsdPerToken: number;
}

export interface SpendReservation {
  readonly inputTokensReserved: number;
  readonly outputTokenLimit: number;
  readonly reservedNanoUsd: number;
}

export interface SpendLedger {
  readonly reserve: (
    request: Readonly<Record<string, unknown>>, outputTokens: number, signal?: AbortSignal,
  ) => Promise<SpendReservation>;
  readonly snapshot: () => { readonly reservedNanoUsd: number; readonly maxCostNanoUsd: number };
}

/** One nanodollar is 10^-9 USD. The host supplies a count or a proved upper bound. */
export function createSpendLedger(
  policy: SpendPolicy,
  countInputTokens: (request: Readonly<Record<string, unknown>>) => number | Promise<number>,
): SpendLedger {
  const limits = { ...policy };
  if (![limits.maxInputTokens, limits.maxCostNanoUsd, limits.inputNanoUsdPerToken,
    limits.outputNanoUsdPerToken].every(value => Number.isSafeInteger(value) && value > 0)
    || typeof countInputTokens !== 'function') {
    throw new Error('Valid prices, budget, input limit, and an explicit token counter are required');
  }
  let reservedNanoUsd = 0;
  return {
    snapshot: () => ({ reservedNanoUsd, maxCostNanoUsd: limits.maxCostNanoUsd }),
    reserve: async (request, outputTokens, signal) => {
      signal?.throwIfAborted();
      const inputTokens = await countInputTokens(request);
      signal?.throwIfAborted();
      if (!Number.isSafeInteger(inputTokens) || inputTokens < 1 || inputTokens > limits.maxInputTokens
        || !Number.isSafeInteger(outputTokens) || outputTokens < 1) {
        throw new Error('Token limit or token counter invalid');
      }
      const charge = BigInt(inputTokens) * BigInt(limits.inputNanoUsdPerToken)
        + BigInt(outputTokens) * BigInt(limits.outputNanoUsdPerToken);
      if (charge > BigInt(limits.maxCostNanoUsd) - BigInt(reservedNanoUsd)) {
        throw new Error('Spend budget exhausted');
      }
      // No await between the final check and reservation. Concurrent callers share this ledger.
      reservedNanoUsd += Number(charge);
      return { inputTokensReserved: inputTokens, outputTokenLimit: outputTokens, reservedNanoUsd: Number(charge) };
    },
  };
}
