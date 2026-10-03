import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const workflowPath = resolve('.github/workflows/openai-blueprint-evaluation.yml');
const source = await readFile(workflowPath, 'utf8');
const workflow = parse(source) as Workflow;

test('OpenAI evaluation workflow is manual, serialized, approval-gated, and bounded', () => {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.permissions.contents, 'read');
  assert.equal(workflow.concurrency.group, 'openai-blueprint-evaluation');
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.equal(workflow.jobs.evaluate.environment, 'openai-live');
  assert.equal(workflow.jobs.evaluate['timeout-minutes'], 180);
  const inputs = workflow.on.workflow_dispatch.inputs;
  const phase = requiredInput(inputs, 'phase');
  assert.equal(phase.type, 'choice');
  assert.deepEqual(phase.options, ['canary', 'baseline', 'repeated']);
  const dataset = requiredInput(inputs, 'dataset');
  assert.equal(dataset.type, 'choice');
  assert.equal(dataset.required, true);
  assert.deepEqual(dataset.options, [
    'all',
    'travel-document-fields',
    'travel-destination-level',
    'travel-request-summary',
    'travel-request-form',
    'travel-document-evidence',
    'date-normalizer',
    'travel-purpose-localizer',
    'travel-approval-routing',
  ]);
  assert.equal(requiredInput(inputs, 'max_calls').required, true);
  assert.equal(requiredInput(inputs, 'budget_usd').required, true);
});

test('workflow dry-runs before a secret-scoped live step with explicit ceilings', () => {
  const steps = workflow.jobs.evaluate.steps;
  const buildIndex = steps.findIndex(step => step.name === 'Build package');
  const dryRunIndex = steps.findIndex(step => step.name === 'Review effective plan');
  assert.ok(buildIndex >= 0 && buildIndex < dryRunIndex);
  const dryRun = namedStep(steps, 'Review effective plan');
  const live = namedStep(steps, 'Run guarded live matrix');
  assert.match(dryRun.run ?? '', /--dry-run/u);
  assert.match(dryRun.run ?? '', /--dataset=/u);
  for (const flag of [
    '--max-calls=',
    '--max-budget-usd=',
    '--confirm-remote-cost',
    '--confirm-key-rotated',
  ]) {
    assert.match(live.run ?? '', new RegExp(escapeRegExp(flag), 'u'));
  }
  assert.equal(live.env?.OPENAI_API_KEY, '${{ secrets.OPENAI_API_KEY }}');
  assert.doesNotMatch(live.run ?? '', /OPENAI_API_KEY|sk-proj/iu);
});

test('workflow retains only value-free result artifacts for a bounded period', () => {
  const upload = namedStep(workflow.jobs.evaluate.steps, 'Upload value-free checkpoints');
  assert.equal(upload.if, 'always()');
  assert.match(upload.uses ?? '', /^actions\/upload-artifact@[0-9a-f]{40}$/u);
  assert.equal(upload.with?.path, 'benchmarks/results/openai/**');
  assert.equal(upload.with?.['retention-days'], 14);
  assert.equal(upload.with?.['if-no-files-found'], 'warn');
});

function namedStep(steps: readonly Step[], name: string): Step {
  const step = steps.find(candidate => candidate.name === name);
  assert.ok(step, `Missing workflow step: ${name}`);
  return step;
}

function requiredInput(
  inputs: Workflow['on']['workflow_dispatch']['inputs'],
  name: string,
) {
  const input = inputs[name];
  assert.ok(input, `Missing workflow input: ${name}`);
  return input;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

interface Workflow {
  readonly on: Readonly<{
    workflow_dispatch: Readonly<{
      inputs: Readonly<Record<string, Readonly<{
        type: string;
        required: boolean;
        options?: readonly string[];
      }>>>;
    }>;
  }>;
  readonly permissions: Readonly<{ contents: string }>;
  readonly concurrency: Readonly<{ group: string; 'cancel-in-progress': boolean }>;
  readonly jobs: Readonly<{
    evaluate: Readonly<{
      environment: string;
      'timeout-minutes': number;
      steps: readonly Step[];
    }>;
  }>;
}

interface Step {
  readonly name: string;
  readonly if?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly with?: Readonly<Record<string, unknown>>;
}
