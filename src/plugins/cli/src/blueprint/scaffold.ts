/**
 * Implements scaffold behavior for the cli plugin.
 */

import type { CliBlueprintScaffoldFile } from '../../../../core/contracts/cli/index.js';

export const BLUEPRINT_OPERATIONS = Object.freeze([
  'extractor',
  'classifier',
  'summarizer',
  'validator',
  'verifier',
  'converter',
  'translator',
  'router',
] as const);

/**
 * Defines the supported blueprint operation values.
 */
export type BlueprintOperation = typeof BLUEPRINT_OPERATIONS[number];

/** Creates the complete data returned to the filesystem adapter. */
export function createBlueprintScaffoldFiles(
  slug: string,
  operation: BlueprintOperation,
  displayName = titleFromSlug(slug),
): readonly CliBlueprintScaffoldFile[] {
  assertSlug(slug);
  assertDisplayName(displayName);
  const yamlName = JSON.stringify(displayName);
  const operationLabel = titleFromSlug(operation);
  const files: CliBlueprintScaffoldFile[] = [
    {
      relativePath: `${slug}.yaml`,
      contents: `name: ${yamlName}\nversion: 0.1.0\nrole: assistant\ntemperature: 0\ninput_placeholders:\n  - name: input\n    type: string\n    required: true\ninput_schema:\n  type: object\n  additionalProperties: false\n  required: [input]\n  properties:\n    input: { type: string, minLength: 1, pattern: '\\S' }\nprompt: |\n  Feature: ${displayName}\n    Scenario: Perform one ${operationLabel} operation\n      Given the caller supplies {{ input }}\n      And the accepted domain and ambiguity policy are documented\n      When the caller requests exactly one ${operationLabel} operation\n      Then the result contains only the documented ${operationLabel} outcome\noutput_schema:\n  type: object\n  additionalProperties: false\n  required: [result]\n  properties:\n    result: { type: string, minLength: 1, pattern: '\\S' }\n`,
    },
    {
      relativePath: 'README.md',
      contents: `# ${displayName}\n\nThis ${operationLabel} Blueprint performs one cognitive operation. Replace this paragraph with its bounded domain, ambiguity policy, unsupported inputs, and expected quality threshold.\n\n## Execute and evaluate\n\n\`\`\`bash\nnpx --package @pixieworks/pixiecore pixiecore execute ${slug}.yaml --inputs='{"input":"fixture input"}'\nnpx --package @pixieworks/pixiecore pixiecore blueprint eval evaluations/${slug}.yaml\n\`\`\`\n\nThe generated contract test is offline and uses only public PixieCore APIs.\n`,
    },
    {
      relativePath: `evaluations/${slug}.yaml`,
      contents: `schema: pixiecore.blueprint-eval-dataset/v1\nname: ${yamlName}\nversion: 0.1.0\nblueprint:\n  path: ../${slug}.yaml\n  version: 0.1.0\ntags: [${operation}, scaffold]\ncases:\n  - id: canonical-example\n    tags: [canonical]\n    inputs:\n      input: fixture input\n    expected_output:\n      result: fixture result\n    comparison: { mode: exact }\n`,
    },
    {
      relativePath: `tests/${slug}.contract.test.ts`,
      contents: contractTest(slug, displayName),
    },
  ];
  return Object.freeze(files.map(file => Object.freeze(file)));
}

function contractTest(slug: string, displayName: string): string {
  return `import assert from 'node:assert/strict';\nimport { createHash, randomUUID } from 'node:crypto';\nimport test from 'node:test';\nimport { fileURLToPath } from 'node:url';\nimport { PromptRuntime, type GenerateRequest, type Provider } from '@pixieworks/pixiecore';\n\nconst blueprintPath = fileURLToPath(new URL('../${slug}.yaml', import.meta.url));\nconst seed = process.env.TEST_SEED?.trim() || randomUUID();\nconst input = \`fixture_\${createHash('sha256').update(seed).digest('hex').slice(0, 12)}\`;\n\ntest(${JSON.stringify(`${displayName} executes through the public runtime`)}, async t => {\n  t.diagnostic(\`TEST_SEED=\${seed}\`);\n  const provider = new FixtureProvider();\n  await using runtime = new PromptRuntime({\n    provider,\n    maxRetry: 0,\n    mcpConfigPath: 'disabled',\n    pluginConfigPath: 'disabled',\n  });\n\n  const result = await runtime.execute(blueprintPath, { input });\n\n  assert.deepEqual(result, { result: input });\n  assert.equal(provider.calls.length, 1);\n});\n\nclass FixtureProvider implements Provider {\n  readonly name = 'offline-fixture';\n  readonly model = 'offline-fixture';\n  readonly supportsTools = false;\n  readonly supportsMultimodal = false;\n  readonly calls: GenerateRequest[] = [];\n\n  generate(request: GenerateRequest) {\n    this.calls.push(request);\n    return Promise.resolve({ content: JSON.stringify({ result: input }) });\n  }\n\n  supportsVision(): boolean { return false; }\n  supportsFileInput(): boolean { return false; }\n  getModelList(): Promise<string[]> { return Promise.resolve([this.model]); }\n}\n`;
}

function titleFromSlug(value: string): string {
  return value.split('-').map(segment => (
    segment ? `${segment[0]!.toUpperCase()}${segment.slice(1)}` : segment
  )).join(' ');
}

function assertSlug(slug: string): void {
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) return;
  throw new TypeError('Blueprint directory name must be lowercase kebab-case');
}

function assertDisplayName(value: string): void {
  if (value.trim() && !/[\r\n]/u.test(value)) return;
  throw new TypeError('--name must be non-blank and single-line');
}
