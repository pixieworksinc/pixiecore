/**
 * Runs the actual PixieCore HTTP/runtime boundary with two offline fixtures.
 * This is not a pricing engine, LLM, or natural-language accuracy evaluation.
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { PromptRuntime, type GenerateRequest, type GenerateResponse, type Provider } from '@pixieworks/pixiecore';
import { createApp, type PixieCoreApiServer } from '@pixieworks/pixiecore/api';

interface DiscountFixture {
  threshold_text: string;
  inputs: { customer_tier: string; purchase_amount: number };
  expected: { discount: number; final_price: number };
}

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/customer-discount.json', import.meta.url), 'utf8')) as DiscountFixture[];
const template = parse(readFileSync(new URL('../../pixiecore_specification/blueprints/customer-discount/customer-discount.yaml', import.meta.url), 'utf8')) as { prompt: string };

/** Describes a local fixture host and its owned runtime resources. */
export interface MockSpecificationHost {
  readonly server: PixieCoreApiServer;
  readonly startupId: string;
  readonly calls: readonly GenerateRequest[];
  /** Drains HTTP and runtime resources without creating a second owner. */
  close(): Promise<void>;
}

/** Produces the only two Blueprint prompt strings supported by this fixture host. */
function renderedFixture(fixture: DiscountFixture): string {
  return template.prompt.split('strictly greater than 1000').join(`strictly greater than ${fixture.threshold_text}`)
    .replace('{{ customer_tier }}', fixture.inputs.customer_tier)
    .replace('{{ purchase_amount }}', String(fixture.inputs.purchase_amount));
}

/** Starts a loopback-only server without reading credentials or a .env file. */
export async function startMockSpecificationHost(port = 0): Promise<MockSpecificationHost> {
  const calls: GenerateRequest[] = [];
  const provider: Provider = {
    name: 'fixture-mock',
    model: 'offline-contract-fixtures',
    supportsTools: false,
    supportsMultimodal: false,
    /** Returns a fixture only for the exact rendered instruction. */
    async generate(request: GenerateRequest): Promise<GenerateResponse> {
      calls.push(structuredClone(request));
      const prompt = [...request.messages].reverse().find(message => message.role === 'user')?.content;
      // Native HTML textarea submission uses CRLF. Accept both explicit wire
      // fixtures without rewriting the instruction delivered by the runtime.
      const fixture = fixtures.find(item => {
        const expected = renderedFixture(item);
        return expected === prompt || expected.replace(/\n/g, '\r\n') === prompt;
      });
      if (!fixture) throw new Error('Mock supports only the two documented Gold/1200 fixtures.');
      return { content: JSON.stringify(fixture.expected) };
    },
    /** This demo does not accept image inputs. */
    supportsVision(): boolean { return false; },
    /** This demo does not accept file inputs. */
    supportsFileInput(): boolean { return false; },
    /** Lists the one offline fixture model. */
    async getModelList(): Promise<string[]> { return ['offline-contract-fixtures']; },
  };
  const environment = {};
  const runtime = new PromptRuntime({
    provider, environment, maxRetry: 0, pluginConfigPath: 'disabled',
    mcpConfigPath: 'disabled', promotionsPath: 'disabled',
    logToConsole: false, logToFile: false,
  });
  const server = createApp({ runtime, environment, maxFileSize: 4096, maxRequestSize: 32_768, logToConsole: false, logToFile: false });
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
    /** Closes once even when callers share ownership of the fixture host. */
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
  const port = Number(process.env.PIXIECORE_SPEC_MOCK_PORT ?? '3087');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid mock port.');
  const host = await startMockSpecificationHost(port);
  console.log(JSON.stringify({ mode: 'mock', url: `http://127.0.0.1:${port}`, startup_id: host.startupId, pid: process.pid }));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void host.close(); });
}
