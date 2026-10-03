import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const workflowPath = resolve('.github/workflows/release-candidate.yml');
const source = await readFile(workflowPath, 'utf8');
const workflow = parse(source) as Workflow;

test('release candidate workflow is manual, read-only, and serialized by source revision', () => {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.on.workflow_dispatch.inputs.version.required, true);
  assert.equal(workflow.on.workflow_dispatch.inputs.version.type, 'string');
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.concurrency.group, 'release-candidate-${{ github.sha }}');
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.equal(workflow.jobs.build['timeout-minutes'], 30);
  assert.equal(workflow.jobs.build['runs-on'], 'ubuntu-latest');
});

test('release candidate workflow contains no publication authority or secret', () => {
  assert.doesNotMatch(source, /npm\s+(?:stage\s+)?publish|id-token|secrets\./u);
  for (const step of workflow.jobs.build.steps.filter(step => step.uses)) {
    assert.match(step.uses ?? '', /^actions\/[a-z-]+@[0-9a-f]{40}$/u);
  }
  const checkout = namedStep('Check out exact source');
  assert.equal(checkout.with?.['persist-credentials'], false);
  const setup = namedStep('Set up Node.js');
  assert.equal(setup.with?.['node-version'], '24');
  assert.equal(setup.with?.['package-manager-cache'], false);
});

test('release candidate workflow gates, packs once, and uploads only the release directory', () => {
  const steps = workflow.jobs.build.steps;
  const gateIndex = indexOfStep('Run release gates');
  const buildIndex = indexOfStep('Build release package once');
  const prepareIndex = indexOfStep('Prepare immutable candidate');
  const verifyIndex = indexOfStep('Verify immutable candidate package');
  const uploadIndex = indexOfStep('Upload release candidate');
  assert.ok(gateIndex < buildIndex && buildIndex < prepareIndex && prepareIndex < verifyIndex && verifyIndex < uploadIndex);
  assert.doesNotMatch(namedStep('Run release gates').run ?? '', /verify:package/u);
  assert.equal(namedStep('Build release package once').run, 'npm run prepack');
  assert.match(namedStep('Prepare immutable candidate').run ?? '', /prepare:release-artifact/u);
  const verification = namedStep('Verify immutable candidate package');
  assert.match(verification.run ?? '', /npm run verify:package --\s+--artifact-directory=release/u);
  assert.match(verification.run ?? '', /--version="\$PIXIECORE_RELEASE_VERSION"/u);
  assert.match(verification.run ?? '', /--source-revision="\$GITHUB_SHA"/u);
  assert.equal(verification.env?.PIXIECORE_RELEASE_VERSION, '${{ inputs.version }}');
  assert.doesNotMatch(steps.slice(prepareIndex + 1).map(step => step.run ?? '').join('\n'), /npm run (?:prepack|build)|npm pack/u);
  const upload = namedStep('Upload release candidate');
  assert.equal(upload.with?.path, 'release/');
  assert.equal(upload.with?.['if-no-files-found'], 'error');
  assert.equal(upload.with?.['retention-days'], 90);

  function indexOfStep(name: string): number {
    const index = steps.findIndex(step => step.name === name);
    assert.notEqual(index, -1, `Missing workflow step: ${name}`);
    return index;
  }
});

function namedStep(name: string): Step {
  const step = workflow.jobs.build.steps.find(candidate => candidate.name === name);
  assert.ok(step, `Missing workflow step: ${name}`);
  return step;
}

interface Workflow {
  readonly on: Readonly<{
    workflow_dispatch: Readonly<{
      inputs: Readonly<Record<'version', Readonly<{ required: boolean; type: string }>>>;
    }>;
  }>;
  readonly permissions: Readonly<Record<string, string>>;
  readonly concurrency: Readonly<{ group: string; 'cancel-in-progress': boolean }>;
  readonly jobs: Readonly<{
    build: Readonly<{
      'runs-on': string;
      'timeout-minutes': number;
      steps: readonly Step[];
    }>;
  }>;
}

interface Step {
  readonly name: string;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Readonly<Record<string, unknown>>;
  readonly env?: Readonly<Record<string, string>>;
}
