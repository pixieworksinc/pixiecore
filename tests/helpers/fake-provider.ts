import type { GenerateRequest, GenerateResponse, Provider } from '../../src/index.js';

export type ResponseScript = GenerateResponse | ((request: GenerateRequest) => GenerateResponse | Promise<GenerateResponse>);

export class ScriptedProvider implements Provider {
  readonly name: string;
  readonly model: string;
  readonly supportsTools = true;
  readonly supportsMultimodal = true;
  readonly calls: GenerateRequest[] = [];

  constructor(private readonly responses: ResponseScript[], options: { name?: string; model?: string } = {}) {
    this.name = options.name ?? 'fake';
    this.model = options.model ?? 'fake-1';
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    this.calls.push(structuredClone(request));
    const response = this.responses.shift();
    if (!response) throw new Error(`No scripted response for provider call ${this.calls.length}`);
    return typeof response === 'function' ? response(request) : response;
  }

  supportsVision(): boolean { return true; }
  supportsFileInput(): boolean { return true; }
  async getModelList(): Promise<string[]> { return [this.model]; }
}
