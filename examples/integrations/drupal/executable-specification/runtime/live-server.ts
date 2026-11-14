/**
 * Hosts a single authenticated discount Blueprint over REST with a bounded
 * OpenAI provider. Drupal owns revisions; this process owns provider usage.
 */
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { PromptRuntime, createProvider, type Provider, type GenerateRequest, type GenerateResponse } from '@pixieworks/pixiecore';
import { createLunaRequestAdapter, LUNA_PLAN } from '../../../../pixieagent/luna.js';
import { loadLiveConfig, validateLiveConfig, type LiveConfig } from './config.js';
export interface LiveSpecificationHost {
    server: Server; startupId: string; close(): Promise<void>;
}
export interface LiveHostOptions {
    config: unknown; token: string; provider: Provider; templatePath: string; port?: number; host?: string;
}
interface UsageEvidence { input_tokens: number; output_tokens: number; estimated_cost_usd: number; }
/** Starts one REST process; only a trusted Drupal service has its bearer token. */
export async function startLiveSpecificationHost(options: LiveHostOptions): Promise<LiveSpecificationHost> {
    const config = validateLiveConfig(options.config);
    if (Buffer.byteLength(options.token) < 32) {
        throw new Error('A random transport token of at least 32 bytes is required.');
    }
    const parsedTemplate: unknown = parse(readFileSync(options.templatePath, 'utf8'));
    if (!isObject(parsedTemplate) || typeof parsedTemplate.prompt !== 'string')
        throw new Error('The bundled Blueprint is invalid.');
    const template = parsedTemplate;
    mkdirSync(config.statePath, { recursive: true, mode: 0o700 });
    const startupId = randomUUID();
    let providerCalls = 0;
    let observed: UsageEvidence | null = null;
    let busy = false;
    let claimed = 0;
    for (const index of [1, 2]) {
        if (existsSync(join(config.statePath, `call-${index}.claimed`))
            && !existsSync(join(config.statePath, `call-${index}.completed`))) halt(config);
    }
    const boundedProvider: Provider = {
        name: options.provider.name,
        model: config.model,
        supportsTools: options.provider.supportsTools,
        supportsMultimodal: options.provider.supportsMultimodal,
        supportsVision: () => options.provider.supportsVision(),
        supportsFileInput: () => options.provider.supportsFileInput(),
        getModelList: async () => { throw new Error('Model listing is disabled.'); },
        /** Reserves budget before sending exactly one capped generation request. */
        async generate(request: GenerateRequest): Promise<GenerateResponse> {
            if (providerCalls !== 0)
                throw new Error('Only one provider call is permitted per execution.');
            claimed = claimCall(config);
            providerCalls += 1;
            try {
                const response = await options.provider.generate({
                    ...request,
                    model: config.model,
                    maxTokens: config.maxOutputTokens,
                    signal: AbortSignal.any([
                        AbortSignal.timeout(config.requestTimeoutMs),
                        ...(request.signal ? [request.signal] : []),
                    ]),
                });
                observed = usageEvidence(response.usage);
                return response;
            }
            catch (error) {
                halt(config);
                throw error;
            }
        },
    };
    const runtime = new PromptRuntime({
        provider: boundedProvider,
        environment: {},
        temperature: config.temperature,
        maxRetry: 0,
        maxToolRounds: 0,
        toolChoice: 'none',
        usePseudoToolCalling: false,
        pluginConfigPath: 'disabled',
        mcpConfigPath: 'disabled',
        promotionsPath: 'disabled',
        logToConsole: false,
        logToFile: false,
    });
    const server = createServer((request, response) => {
        void handleRequest(request, response).catch(() => {
            if (!response.headersSent)
                send(response, 502, { status: 'error', code: 'runtime_error' });
            else
                response.end();
        });
    });
    /** Validates transport, Blueprint shape and inputs before paid dispatch. */
    async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
        response.setHeader('Cache-Control', 'no-store');
        if (request.url === '/health' && request.method === 'GET') {
            send(response, 200, { status: 'ok', mode: 'real' });
            return;
        }
        if (request.url !== '/execute' || request.method !== 'POST') {
            send(response, 404, { status: 'error', code: 'not_found' });
            return;
        }
        if (!authorized(request.headers.authorization, options.token)) {
            send(response, 401, { status: 'error', code: 'unauthorized' });
            return;
        }
        if (busy) {
            send(response, 409, { status: 'error', code: 'busy' });
            return;
        }
        busy = true;
        providerCalls = 0;
        observed = null;
        claimed = 0;
        try {
            const body = await readBody(request, config.maxRequestBytes);
            if (!isObject(body) || typeof body.blueprint !== 'string'
                || Buffer.byteLength(body.blueprint) > config.maxRequestBytes) {
                throw new TypeError('Invalid Blueprint request.');
            }
            const blueprint = parse(body.blueprint);
            if (!isObject(blueprint) || typeof blueprint.prompt !== 'string'
                || Buffer.byteLength(blueprint.prompt) < 1
                || Buffer.byteLength(blueprint.prompt) > config.maxInstructionBytes
                || !isDeepStrictEqual({ ...blueprint, examples: undefined }, { ...template, prompt: blueprint.prompt, examples: undefined })
                || (blueprint.examples !== undefined && !isDeepStrictEqual(blueprint.examples, template.examples))) {
                throw new TypeError('Only the bundled Blueprint contract is accepted.');
            }
            const inputs = validateInputs(body.inputs, config.maxInputBytes);
            const data = await runtime.executeYaml(body.blueprint, inputs, {
                maxTokens: config.maxOutputTokens,
            });
            const actual = data.final_price;
            if (typeof data.discount !== 'number' || typeof actual !== 'number' || !Number.isFinite(data.discount) || !Number.isFinite(actual)
                || Math.abs(actual - inputs.purchase_amount * (1 - data.discount)) > 1e-9) {
                throw new Error('Arithmetic validation failed.');
            }
            const usage = observed as UsageEvidence | null;
            if (!usage || providerCalls !== 1)
                throw new Error('Usage evidence is incomplete.');
            const completed = openSync(join(config.statePath, `call-${claimed}.completed`), 'wx', 0o600);
            try { writeFileSync(completed, 'completed'); fsyncSync(completed); } finally { closeSync(completed); }
            syncDirectory(config.statePath);
            send(response, 200, {
                status: 'success',
                data,
                metadata: {
                    provider: 'openai',
                    model: config.model,
                    startup_id: startupId,
                    provider_calls: providerCalls,
                    ...usage,
                },
            });
        }
        catch (error) {
            if (claimed) halt(config);
            send(response, error instanceof TypeError ? 400 : 502, {
                status: 'error',
                code: error instanceof TypeError ? 'invalid_request' : 'execution_failed',
            });
        }
        finally {
            busy = false;
        }
    }
    try {
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(options.port ?? config.port, options.host ?? config.host, () => resolve());
        });
    }
    catch (error) {
        await runtime.close();
        throw error;
    }
    let closing: Promise<void> | undefined;
    return {
        server, startupId,
        close() {
            closing ??= (async () => {
                try {
                    await new Promise<void>((resolve, reject) => {
                        server.close(error => error ? reject(error) : resolve());
                    });
                }
                finally {
                    await runtime.close();
                }
            })();
            return closing;
        },
    };
}
/** Consume one of two durable call permits. This is not a billing ledger. */
function claimCall(config: LiveConfig): number {
    if (Date.now() >= Date.parse(config.expiresAt) || existsSync(join(config.statePath, 'halted'))) {
        throw new Error('The trial is stopped or expired.');
    }
    for (const index of [1, 2]) {
        let fd: number;
        try { fd = openSync(join(config.statePath, `call-${index}.claimed`), 'wx', 0o600); }
        catch (error) { if (error instanceof Error && 'code' in error && error.code === 'EEXIST') continue; throw error; }
        try { writeFileSync(fd, new Date().toISOString()); fsyncSync(fd); }
        finally { closeSync(fd); }
        syncDirectory(config.statePath);
        return index;
    }
    throw new Error('Both approved call permits have been consumed.');
}

/** Retain failure across restarts without changing a provider-side spending limit. */
function halt(config: LiveConfig): void {
    const fd = openSync(join(config.statePath, 'halted'), 'w', 0o600);
    try { writeFileSync(fd, 'stopped'); fsyncSync(fd); }
    finally { closeSync(fd); }
    syncDirectory(config.statePath);
}

/** Persist permit directory entries before issuing a paid request. */
function syncDirectory(path: string): void {
    const fd = openSync(path, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** Validate existing provider usage and expose an estimate, never an invoice. */
function usageEvidence(usage: unknown): UsageEvidence {
    if (!isObject(usage)) throw new Error('Provider usage unavailable.');
    const input = usage?.inputTokens;
    const output = usage?.outputTokens;
    if (typeof input !== 'number' || typeof output !== 'number' || !Number.isSafeInteger(input) || input < 1 || input > LUNA_PLAN.maxInputTokens
        || !Number.isSafeInteger(output) || output < 0 || output > 512) {
        throw new Error('Provider usage was not reported correctly.');
    }
    return { input_tokens: input, output_tokens: output,
        estimated_cost_usd: (input * 200 + output * 750) / 1e9 };
}

/** Rejects structured inputs before contacting a provider. */
function validateInputs(value: unknown, maxInputBytes: number): { customer_tier: string; purchase_amount: number } {
    if (!isObject(value) || Buffer.byteLength(JSON.stringify(value)) > maxInputBytes
        || Object.keys(value).sort().join(',') !== 'customer_tier,purchase_amount'
        || typeof value.customer_tier !== 'string'
        || value.customer_tier.trim() === '' || value.customer_tier.length > 40
        || typeof value.purchase_amount !== 'number'
        || !Number.isFinite(value.purchase_amount)
        || value.purchase_amount < 0 || value.purchase_amount > 1_000_000) {
        throw new TypeError('Invalid synthetic inputs.');
    }
    return { customer_tier: value.customer_tier, purchase_amount: value.purchase_amount };
}
/** Checks the transport token using a constant-time comparison. */
function authorized(header: string | undefined, token: string): boolean {
    if (!header?.startsWith('Bearer '))
        return false;
    const supplied = Buffer.from(header.slice(7));
    const expected = Buffer.from(token);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
/** Reads one bounded JSON payload. */
async function readBody(request: IncomingMessage, maxRequestBytes: number): Promise<unknown> {
    if (!request.headers['content-type']?.startsWith('application/json')) {
        throw new TypeError('Expected application/json.');
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of request) {
        const buffer = Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > maxRequestBytes)
            throw new TypeError('Request is too large.');
        chunks.push(buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
/** Sends the narrow API envelope without request or credential data. */
function send(response: ServerResponse, code: number, value: unknown): void {
    response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value));
}
/** Narrows JSON and YAML maps before field access. */
function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** Start the existing host from explicit operator files; importing this module does not read keys. */
export async function startConfiguredLiveHost(path: string | undefined): Promise<LiveSpecificationHost> {
    const config = loadLiveConfig(path);
    if (Date.now() >= Date.parse(config.expiresAt)) throw new Error('Live trial configuration has expired.');
    const key = readFileSync(config.apiKeyPath, 'utf8').trim();
    const token = readFileSync(config.transportTokenPath, 'utf8').trim();
    const provider = createProvider('openai', {
        environment: { OPENAI_API_KEY: key, OPENAI_BASE_URL: config.baseUrl },
        model: config.model,
        requestTimeout: config.requestTimeoutMs / 1000,
        fetch: createLunaRequestAdapter(async (input, init) => {
            if (typeof init?.body !== 'string' || Buffer.byteLength(init.body) > 16384) throw new Error('Provider request is too large.');
            return fetch(input, { ...init, redirect: 'error' });
        }),
    });
    const host = await startLiveSpecificationHost({
        token,
        provider,
        config,
        templatePath: config.templatePath,
    });
    return host;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const host = await startConfiguredLiveHost(process.env.PIXIECORE_DEMO_CONFIG);
    console.log(JSON.stringify({ mode: 'real', startup_id: host.startupId }));
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () => { void host.close(); });
    }
}
