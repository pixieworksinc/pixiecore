import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';
import { testData } from '../helpers/test-data.js';

const [notes, changelog, security, policy, workflowSource] = await Promise.all([
  readFile('docs/project/release-notes-0.1.0.md', 'utf8'),
  readFile('CHANGELOG.md', 'utf8'),
  readFile('SECURITY.md', 'utf8'),
  readFile('docs/project/release-policy.md', 'utf8'),
  readFile('.github/workflows/release.yml', 'utf8'),
]);
const workflow = parse(workflowSource) as ReleaseWorkflow;

test('release documents preserve the published 0.1.0 identity without stale candidate claims', () => {
  assertPublishedReleaseDocuments(notes, changelog, security);
  // These values identify the immutable first release, not generated test data.
  for (const value of [
    '696c75bd704dd8ba90a2435f8a9b52dc8b987681',
    '88e60d3d37cd1e728b6b3f35cc45ee60297b237c',
    'f84e8f31eb417dcc1319d66f5f7a8eb3e94b8750df036aa33aadcc38b002977b',
    'https://github.com/pixieworksinc/pixiecore/actions/runs/37162087728',
    'https://www.npmjs.com/package/@pixieworks/pixiecore/v/0.1.0',
  ]) assert.ok(notes.includes(value), `Missing first-release evidence: ${value}`);
  assert.match(changelog, /## Unreleased\n\nChanges below are not part of the published `0\.1\.0` artifact\./u);
});

test('release documentation guard rejects the original unpublished and unsigned claims', () => {
  for (const staleNotes of [
    `${notes}\nIt has not yet been tagged or published to npm.`,
    `${notes}\nnpm remains unpublished during the source-publication flow.`,
  ]) {
    assert.throws(() => assertPublishedReleaseDocuments(staleNotes, changelog, security));
  }
  assert.throws(() => assertPublishedReleaseDocuments(notes,
    changelog.replace('## 0.1.0 - 2026-10-03', '## 0.1.0 - planned'), security));
  assert.throws(() => assertPublishedReleaseDocuments(notes, changelog,
    `${security}\nIt does not retroactively describe the historical 0.1.0 tag or artifact as signed.`));
});

test('next-release instructions track the actual workflow inputs and environment', () => {
  assertWorkflowInstructions(policy, workflow);
  assert.doesNotMatch(policy, /authentication: bootstrap|bootstrap_confirmation|bootstrap:0\.1\.0|NPM_BOOTSTRAP_TOKEN/u);
  assert.doesNotMatch(policy, /either package absence or/u);
  assert.match(policy, /must confirm an existing package with a stable/u);
  assert.match(policy, /actual OIDC publication remains\s+to be verified/u);
  assert.match(policy, /existing version caused\s+that step to be skipped/u);
  assert.match(policy, /Do not publish an extra version merely to exercise OIDC/u);
  assert.match(policy, /https:\/\/github\.com\/pixieworksinc\/pixiecore\/issues\/1/u);
});

test('new required workflow inputs fail when release instructions have not been updated', () => {
  const undocumentedInput = testData('release-documentation').text('input').replaceAll('-', '_');
  assert.throws(() => assertWorkflowInstructions(policy, {
    ...workflow,
    on: {
      workflow_dispatch: {
        inputs: { ...workflow.on.workflow_dispatch.inputs, [undocumentedInput]: { required: true } },
      },
    },
  }), /Undocumented required release input/u);
});

/** Rejects pre-publication descriptions that no longer describe the first release. */
function assertPublishedReleaseDocuments(releaseNotes: string, changeLog: string, securityPolicy: string): void {
  assert.match(releaseNotes, /was published on 2026-10-03/u);
  assert.match(changeLog, /## 0\.1\.0 - 2026-10-03/u);
  assert.doesNotMatch(`${releaseNotes}\n${changeLog}`,
    /not yet been tagged or published|remains unpublished|have not been published|0\.1\.0 - planned/u);
  assert.doesNotMatch(securityPolicy, /does not\s+retroactively describe/u);
}

/** Keeps operator instructions aligned with the required dispatch contract. */
function assertWorkflowInstructions(instructions: string, releaseWorkflow: ReleaseWorkflow): void {
  for (const [input, definition] of Object.entries(releaseWorkflow.on.workflow_dispatch.inputs)) {
    if (!definition.required) continue;
    assert.ok(instructions.includes(`\`${input}\``), `Undocumented required release input: ${input}`);
  }
  assert.ok(instructions.includes(`environment \`${releaseWorkflow.jobs.publish.environment.name}\``));
}

interface ReleaseWorkflow {
  readonly on: {
    readonly workflow_dispatch: {
      readonly inputs: Readonly<Record<string, { readonly required?: boolean }>>;
    };
  };
  readonly jobs: { readonly publish: { readonly environment: { readonly name: string } } };
}
