/**
 * Sends five fixed adapter examples through the real HTTP/PromptRuntime path.
 * The provider replays exact fixtures; it does not evaluate model accuracy.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { PromptRuntime, type GenerateRequest, type GenerateResponse, type Provider } from '@pixieworks/pixiecore';
import { ApiError, createApp, type ApiRuntime, type PixieCoreApiServer } from '@pixieworks/pixiecore/api';

interface AdapterFixture {
  id: string;
  label: string;
  inputs: { source_format: 'json' | 'csv' | 'text'; source_text: string };
  expected: { customer_tier: string; purchase_amount: number } | { error: 'missing_fields' | 'ambiguous_input' };
}

const directory = new URL('../../pixiecore_specification/blueprints/customer-adapter/', import.meta.url);
const blueprint = readFileSync(new URL('customer-adapter.yaml', directory), 'utf8');
const template = parse(blueprint) as { prompt: string };
const fixtures = JSON.parse(readFileSync(new URL('cases.json', directory), 'utf8')) as AdapterFixture[];

/** Describes one fixture-only adapter host and its owned runtime resources. */
export interface AdapterHost {
  readonly server: PixieCoreApiServer;
  readonly startupId: string;
  /** Captures requests only when explicitly enabled by a test. */
  readonly calls: readonly GenerateRequest[];
  /** Drains the HTTP server and runtime once for all owners. */
  close(): Promise<void>;
}

/** Builds the one documented rendered prompt for a fixed input example. */
function renderedFixture(fixture: AdapterFixture): string {
  return template.prompt
    .replace('{{ source_format }}', fixture.inputs.source_format)
    .replace('{{ source_text }}', fixture.inputs.source_text);
}

/** Starts the adapter; request capture is opt-in for tests and disabled normally. */
export async function startAdapterHost(port = 0, captureRequests = false): Promise<AdapterHost> {
  const calls: GenerateRequest[] = [];
  const provider: Provider = {
    name: 'adapter-fixture',
    model: 'offline-contract-fixtures',
    supportsTools: false,
    supportsMultimodal: false,
    /** Replays a result only when the entire rendered instruction matches. */
    async generate(request: GenerateRequest): Promise<GenerateResponse> {
      if (captureRequests) calls.push(structuredClone(request));
      const prompt = [...request.messages].reverse().find(message => message.role === 'user')?.content;
      const fixture = fixtures.find(item => renderedFixture(item) === prompt);
      if (!fixture) throw new ApiError('unsupported_adapter_fixture', 'Adapter fixture input is not supported.', 422);
      return { content: JSON.stringify(fixture.expected) };
    },
    /** This example has no vision inputs. */
    supportsVision(): boolean { return false; },
    /** This example has no uploaded-file inputs. */
    supportsFileInput(): boolean { return false; },
    /** Reports the only fixture model without opening a connection. */
    async getModelList(): Promise<string[]> { return ['offline-contract-fixtures']; },
  };
  const environment = {};
  const runtime = new PromptRuntime({
    provider, environment, maxRetry: 0, maxToolRounds: 0, toolChoice: 'none',
    usePseudoToolCalling: false, pluginConfigPath: 'disabled',
    mcpConfigPath: 'disabled', promotionsPath: 'disabled',
    logToConsole: false, logToFile: false,
  });
  const adapter: ApiRuntime = {
    providerName: provider.name,
    model: provider.model,
    /** Keeps the fixed Blueprint and conversation contract at the boundary. */
    async executeYaml(yaml, inputs, options): Promise<Record<string, unknown>> {
      if (yaml !== blueprint || options?.messages?.length) {
        throw new ApiError('invalid_adapter_request', 'Only the bundled adapter Blueprint is accepted.', 400);
      }
      return runtime.executeYaml(yaml, inputs, options);
    },
    /** Releases the same runtime used for every adapter request. */
    close(): Promise<void> { return runtime.close(); },
  };
  const server = createApp({ runtime: adapter, environment, maxFileSize: 4096, maxRequestSize: 32_768, logToConsole: false, logToFile: false });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
  } catch (error) {
    await server.closeResources();
    throw error;
  }
  let closing: Promise<void> | undefined;
  return {
    server, startupId: randomUUID(), calls,
    /** Closes safely when both startup failure and signal handling drain it. */
    close(): Promise<void> {
      closing ??= (async (): Promise<void> => {
        try {
          if (server.listening) {
            await new Promise<void>((resolve, reject) => {
              server.close(error => { error ? reject(error) : resolve(); });
            });
          }
        } finally {
          await server.closeResources();
        }
      })();
      return closing;
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PIXIECORE_ADAPTER_MOCK_PORT ?? '3088');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid adapter mock port.');
  const host = await startAdapterHost(port);
  console.log(JSON.stringify({ mode: 'fixture', url: `http://127.0.0.1:${port}`, startup_id: host.startupId, pid: process.pid }));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void host.close(); });
}
