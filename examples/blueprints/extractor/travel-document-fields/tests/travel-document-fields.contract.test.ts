import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import {
  extractPdfText,
  InputValidationError,
  MaxRetryExceededError,
  PromptRuntime,
  resolveAttachment,
  type FileContentPart,
  type GenerateRequest,
  type GenerateResponse,
  type ImageContentPart,
  type MessageContentPart,
  type Provider,
} from '@pixieworks/pixiecore';
import { runBlueprintEvaluation } from '@pixieworks/pixiecore/eval';

interface DatasetCase {
  readonly id: string;
  readonly inputs: {
    readonly file_path?: string;
    readonly image_path?: string;
    readonly requested_fields: readonly string[];
  };
  readonly expected_output: Record<string, unknown>;
}

interface DatasetFixture {
  readonly cases: readonly DatasetCase[];
}

const blueprintPath = fileURLToPath(new URL('../travel-document-fields.yaml', import.meta.url));
const datasetPath = fileURLToPath(new URL('../evaluations/travel-document-fields.yaml', import.meta.url));
const projectRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const textLayerCases = new Set(['native-text-pdf', 'multi-page-evidence', 'rotated-page', 'table-layout']);
const noTextLayerCases = new Set(['scanned-pdf-partial', 'blank-page-unreadable']);

test('travel Extractor passes every canonical document case with the real attachment', async () => {
  const dataset = YAML.parse(await readFile(datasetPath, 'utf8')) as DatasetFixture;
  const provider = new FixtureProvider(dataset.cases.map(item => ({
    content: JSON.stringify(item.expected_output),
  })));
  const seed = requiredTestSeed();

  const artifact = await runBlueprintEvaluation({
    datasetPath,
    seed,
    runtimeOptions: runtimeOptions(provider),
  });

  assert.deepEqual(artifact.summary, {
    total: dataset.cases.length,
    passed: dataset.cases.length,
    failed: 0,
    errors: 0,
  });
  assert.equal(artifact.run.seed, seed);
  assert.equal(provider.calls.length, dataset.cases.length);

  for (const [index, fixture] of dataset.cases.entries()) {
    const request = provider.calls[index]!;
    const parts = lastUserParts(request);
    const attachments = parts.filter(isAttachment);
    assert.equal(attachments.length, 1, `${fixture.id} must supply exactly one attachment`);
    const attachmentPart = attachments[0]!;
    const source = fixture.inputs.file_path ?? fixture.inputs.image_path;
    assert.ok(source, `${fixture.id} requires a fixture path`);
    assert.equal(attachmentPart.source, source);
    assert.equal(attachmentPart.type, fixture.inputs.file_path ? 'file' : 'image');

    const prompt = parts
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('');
    for (const field of fixture.inputs.requested_fields) assert.match(prompt, new RegExp(field));

    const bytes = await readFile(resolve(projectRoot, source));
    if (attachmentPart.type === 'image') {
      assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      continue;
    }
    assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-');
    const resolved = await resolveAttachment(attachmentPart);
    const extractedText = await extractPdfText(resolved);
    if (textLayerCases.has(fixture.id)) assert.match(extractedText, /\S/);
    if (noTextLayerCases.has(fixture.id)) assert.equal(extractedText, '');
  }
});

test('travel Extractor rejects zero, multiple, and empty field inputs before provider execution', async () => {
  const provider = new FixtureProvider([]);
  await using runtime = new PromptRuntime(runtimeOptions(provider));
  const filePath = 'examples/blueprints/extractor/travel-document-fields/fixtures/native-text.pdf';
  const imagePath = 'examples/blueprints/extractor/travel-document-fields/fixtures/travel-request-screenshot.png';

  await assert.rejects(
    runtime.execute(blueprintPath, { requested_fields: ['traveler_name'] }),
    error => error instanceof InputValidationError,
  );
  await assert.rejects(
    runtime.execute(blueprintPath, {
      file_path: filePath,
      image_path: imagePath,
      requested_fields: ['traveler_name'],
    }),
    error => error instanceof InputValidationError,
  );
  await assert.rejects(
    runtime.execute(blueprintPath, { file_path: filePath, requested_fields: [] }),
    error => error instanceof InputValidationError,
  );
  assert.equal(provider.calls.length, 0);
});

test('travel Extractor rejects extracted evidence with an invalid page number', async () => {
  const provider = new FixtureProvider([{
    content: JSON.stringify({
      status: 'complete',
      document_type: 'travel_request',
      fields: [{
        name: 'traveler_name',
        status: 'extracted',
        value: 'Morgan Ellis',
        source: { page: 0, evidence_text: 'Morgan Ellis' },
      }],
      warnings: [],
    }),
  }]);
  await using runtime = new PromptRuntime(runtimeOptions(provider));
  await assert.rejects(
    runtime.execute(blueprintPath, {
      file_path: 'examples/blueprints/extractor/travel-document-fields/fixtures/native-text.pdf',
      requested_fields: ['traveler_name'],
    }),
    error => error instanceof MaxRetryExceededError,
  );
  assert.equal(provider.calls.length, 1);
});

class FixtureProvider implements Provider {
  readonly name = 'travel-extractor-fixture';
  readonly model = 'offline-multimodal-fixture';
  readonly supportsTools = false;
  readonly supportsMultimodal = true;
  readonly calls: GenerateRequest[] = [];

  constructor(private readonly responses: GenerateResponse[]) {}

  generate(request: GenerateRequest): Promise<GenerateResponse> {
    this.calls.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error(`Missing fixture response for call ${this.calls.length}`);
    return Promise.resolve(response);
  }

  supportsVision(): boolean { return true; }
  supportsFileInput(): boolean { return true; }
  getModelList(): Promise<string[]> { return Promise.resolve([this.model]); }
}

function runtimeOptions(provider: Provider) {
  return {
    provider,
    maxRetry: 0,
    mcpConfigPath: 'disabled' as const,
    pluginConfigPath: 'disabled' as const,
  };
}

function lastUserParts(request: GenerateRequest): readonly MessageContentPart[] {
  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    const message = request.messages[index]!;
    if (message.role !== 'user') continue;
    if (typeof message.content === 'string') throw new TypeError('Expected multimodal content parts');
    return message.content;
  }
  throw new TypeError('Expected a user message');
}

function isAttachment(
  part: MessageContentPart,
): part is FileContentPart | ImageContentPart {
  return part.type === 'file' || part.type === 'image';
}

function requiredTestSeed(): string {
  const seed = process.env.TEST_SEED?.trim();
  if (seed) return seed;
  throw new Error('TEST_SEED is required; run this test through the PixieCore test runner');
}
