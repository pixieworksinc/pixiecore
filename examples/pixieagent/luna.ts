/** Selected GPT-6 Luna request preparation. Transport must be supplied explicitly. */
export const LUNA_PLAN = Object.freeze({
  provider: 'openai', model: 'gpt-6-luna',
  endpoint: 'https://api.openai.com/v1/chat/completions',
  maxCostUsd: 1, maxRequests: 5, maxInputTokens: 1_050_000, maxOutputTokens: 512,
  maxRequestBytes: 16 * 1024,
  reasoningEffort: 'none', serviceTier: 'default',
  inputAccounting: 'model-context-upper-bound',
  prices: Object.freeze({ inputNanoUsdPerToken: 200, outputNanoUsdPerToken: 750,
    standardShortInputNanoUsdPerToken: 100, standardShortOutputNanoUsdPerToken: 500,
    cachedInputNanoUsdPerToken: 10, cacheWrite30mNanoUsdPerToken: 125,
    cacheWrite12hNanoUsdPerToken: 250 }),
  pricingSource: 'https://developers.openai.com/api/docs/pricing',
  specificationSource: 'https://developers.openai.com/api/docs/guides/latest-model',
  verifiedOn: '2026-11-09',
});

export const LUNA_BUDGET_NANO_USD = LUNA_PLAN.maxCostUsd * 1_000_000_000;
export const LUNA_REQUEST_RESERVATION_NANO_USD = LUNA_PLAN.maxInputTokens * LUNA_PLAN.prices.inputNanoUsdPerToken
  + LUNA_PLAN.maxOutputTokens * LUNA_PLAN.prices.outputNanoUsdPerToken;

/** A local check of the strict object rules used by this experiment, not a complete API validator. */
export function checkStrictOutputSchema(schema: unknown, root = true): void {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('Invalid output schema');
  const node = schema as Record<string, unknown>;
  if (root && (node.type !== 'object' || 'anyOf' in node)) throw new Error('Expected an object schema root');
  for (const keyword of ['allOf', 'oneOf', 'not', 'if', 'then', 'else', '$ref']) {
    if (keyword in node) throw new Error('Unsupported schema composition in this experiment');
  }
  if (node.type === 'object' || (Array.isArray(node.type) && node.type.includes('object'))) {
    if (node.additionalProperties !== false || !node.properties
      || typeof node.properties !== 'object' || Array.isArray(node.properties)
      || !Array.isArray(node.required)) throw new Error('Strict objects must be closed with required properties');
    const properties = node.properties as Record<string, unknown>;
    if (Object.keys(properties).length !== node.required.length
      || !Object.keys(properties).every(key => (node.required as unknown[]).includes(key))) {
      throw new Error('All object fields must be required');
    }
    Object.values(properties).forEach(property => checkStrictOutputSchema(property, false));
  }
  if (node.items) checkStrictOutputSchema(node.items, false);
  if (Array.isArray(node.anyOf)) node.anyOf.forEach(branch => checkStrictOutputSchema(branch, false));
}

/** Convert only the existing PixieCore wire shape; never opens a connection itself. */
export function createLunaRequestAdapter(transport: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    if (String(input) !== LUNA_PLAN.endpoint || init?.method !== 'POST' || typeof init.body !== 'string') {
      throw new Error('Unexpected Luna transport request');
    }
    const request: unknown = JSON.parse(init.body);
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Expected JSON request');
    const body = request as Record<string, unknown>;
    const fields = ['model', 'messages', 'temperature', 'max_tokens', 'response_format'];
    if (body.model !== LUNA_PLAN.model || Object.keys(body).some(key => !fields.includes(key))
      || !Number.isSafeInteger(body.max_tokens) || Number(body.max_tokens) < 1
      || Number(body.max_tokens) > LUNA_PLAN.maxOutputTokens
      || !Array.isArray(body.messages) || body.messages.length === 0) {
      throw new Error('Unexpected model, fields, messages, or output-token limit');
    }
    if (!body.messages.every(message => {
      if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
      const item = message as Record<string, unknown>;
      return ['system', 'developer', 'user', 'assistant'].includes(String(item.role))
        && typeof item.content === 'string'
        && Object.keys(item).every(key => ['role', 'content'].includes(key));
    })) throw new Error('Only plain text messages without attachments or tools are permitted');
    const format = body.response_format as Record<string, unknown> | undefined;
    const jsonSchema = format?.json_schema as Record<string, unknown> | undefined;
    if (format?.type !== 'json_schema' || jsonSchema?.strict !== true) throw new Error('Strict output required');
    checkStrictOutputSchema(jsonSchema.schema);
    // Reject cache breakpoints before disabling implicit caching. No hidden paid cache writes.
    if (JSON.stringify(body).includes('"prompt_cache_breakpoint"')) throw new Error('Cache breakpoints prohibited');
    const response = await transport(input, { ...init, body: JSON.stringify({
      model: LUNA_PLAN.model, messages: body.messages,
      response_format: body.response_format, max_completion_tokens: body.max_tokens,
      reasoning_effort: LUNA_PLAN.reasoningEffort, service_tier: LUNA_PLAN.serviceTier,
      prompt_cache_options: { mode: 'explicit' }, store: false,
    }) });
    // HTTP failures retain the runtime's existing error handling and no-retry policy.
    if (!response.ok) return response;
    const data: unknown = await response.clone().json();
    checkLunaResponse(data);
    return response;
  };
}

/** Parseable content alone cannot make an interrupted or refused completion successful. */
function checkLunaResponse(data: unknown): void {
  const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!record(data) || !Array.isArray(data.choices) || data.choices.length !== 1) {
    throw new Error('Expected one complete Luna assistant response');
  }
  const choice: unknown = data.choices[0];
  if (!record(choice) || choice.finish_reason !== 'stop' || !record(choice.message)) {
    throw new Error('Luna completion did not finish normally');
  }
  const message = choice.message;
  if (message.role !== 'assistant' || typeof message.content !== 'string' || !message.content.trim()
    || message.refusal != null || message.function_call != null
    || (message.tool_calls !== undefined && (!Array.isArray(message.tool_calls) || message.tool_calls.length > 0))) {
    throw new Error('Expected non-refused Luna text without tool calls');
  }
}
