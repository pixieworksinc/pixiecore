import type { ApiMessage, ApiRuntime } from '../../src/core/kernel/api/index.js';
import type { ExecuteOptions } from '../../src/index.js';

export interface ApiRuntimeCall {
  yaml: string;
  inputs: Record<string, unknown>;
  options: ExecuteOptions;
}

export class FakeApiRuntime implements ApiRuntime {
  readonly providerName = 'test-provider';
  readonly model = 'test-model';
  readonly calls: ApiRuntimeCall[] = [];
  result: Record<string, unknown> = { greeting: 'hello' };
  error?: Error;
  closeCount = 0;
  onExecute?: (call: ApiRuntimeCall) => Record<string, unknown> | Promise<Record<string, unknown>>;

  async executeYaml(yaml: string, inputs: Record<string, unknown> = {}, options: ExecuteOptions = {}): Promise<Record<string, unknown>> {
    const call = { yaml, inputs, options };
    this.calls.push(call);
    if (this.onExecute) return this.onExecute(call);
    if (this.error) throw this.error;
    return this.result;
  }

  close(): void { this.closeCount++; }
}

export function apiMessages(options: ExecuteOptions): ApiMessage[] | undefined {
  return options.messages?.filter((message): message is ApiMessage =>
    (message.role === 'system' || message.role === 'user' || message.role === 'assistant')
    && typeof message.content === 'string');
}
