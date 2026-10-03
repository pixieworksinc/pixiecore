import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { writeOpenAIBlueprintScorecard } from './openai-blueprint-reports.js';

const { values } = parseArgs({
  args: process.argv.slice(2),
  strict: true,
  allowPositionals: false,
  options: {
    checkpoint: { type: 'string' },
    manifest: { type: 'string' },
    json: { type: 'string' },
    markdown: { type: 'string' },
  },
});

const checkpointPath = required(values.checkpoint, '--checkpoint');
const manifestPath = required(values.manifest, '--manifest');
const jsonPath = required(values.json, '--json');
const markdownPath = required(values.markdown, '--markdown');

await writeOpenAIBlueprintScorecard(
  checkpointPath,
  manifestPath,
  jsonPath,
  markdownPath,
);
console.log(`OpenAI Blueprint scorecard: ${resolve(markdownPath)}`);

function required(value: string | undefined, name: string): string {
  if (value?.trim()) return value.trim();
  throw new TypeError(`${name} is required and must be non-blank`);
}
