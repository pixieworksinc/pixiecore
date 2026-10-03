import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { testData } from '../helpers/test-data.js';
import { withTempDirectory } from '../helpers/temp.js';
// @ts-expect-error Repository CI policy is an executable JavaScript module.
import { checkBlueprintTransition, checkNewBlueprint, checkRepository } from '../../scripts/check-blueprint-versions.mjs';

const data = testData('Blueprint version policy');

function blueprint(overrides: Record<string, unknown> = {}): string {
  return YAML.stringify({
    name: data.text('name', 'Blueprint'),
    version: '1.2.3',
    role: 'assistant',
    input_placeholders: [{ name: 'input', type: 'string', required: true }],
    input_schema: {
      type: 'object',
      required: ['input'],
      properties: { input: { type: 'string' } },
    },
    prompt: data.text('prompt', 'Classify'),
    output_schema: {
      type: 'object',
      required: ['result'],
      properties: { result: { type: 'string' } },
    },
    ...overrides,
  });
}

test('new Blueprints require complete fields and a numeric semantic version', () => {
  assert.deepEqual(checkNewBlueprint(blueprint()), []);
  assert.match(checkNewBlueprint(blueprint({ version: 'next' }))[0], /numeric SemVer/);
  assert.match(checkNewBlueprint(blueprint({ prompt: undefined }))[0], /missing required field prompt/);
});

test('behavior changes require a forward version bump while comments do not', () => {
  const previous = blueprint();
  assert.deepEqual(checkBlueprintTransition(previous, `# documentation only\n${previous}`), []);
  assert.match(
    checkBlueprintTransition(previous, blueprint({ prompt: data.text('changed prompt') }))[0],
    /content changed without a version bump/,
  );
  assert.deepEqual(checkBlueprintTransition(
    previous,
    blueprint({ version: '1.2.4', prompt: data.text('changed prompt') }),
  ), []);
});

test('contract changes require a major bump', () => {
  const previous = blueprint();
  const changedSchema = {
    type: 'object',
    required: ['result', 'confidence'],
    properties: {
      result: { type: 'string' },
      confidence: { type: 'number' },
    },
  };
  assert.match(
    checkBlueprintTransition(previous, blueprint({ version: '1.3.0', output_schema: changedSchema }))[0],
    /requiring a major bump/,
  );
  assert.deepEqual(checkBlueprintTransition(
    previous,
    blueprint({ version: '2.0.0', output_schema: changedSchema }),
  ), []);
});

test('human-readable names remain compatible but stable path moves require a major bump', () => {
  const previous = blueprint();
  assert.deepEqual(checkBlueprintTransition(
    previous,
    blueprint({ version: '1.2.4', name: data.text('renamed Blueprint') }),
  ), []);
  assert.match(
    checkBlueprintTransition(previous, blueprint({ version: '1.3.0' }), 'old.yaml -> new.yaml', {
      identityChanged: true,
    })[0],
    /stable path requires a Blueprint major bump/,
  );
});

test('equivalent object and JSON-string schemas do not create a contract change', () => {
  const previous = blueprint();
  const parsed = YAML.parse(previous) as Record<string, unknown>;
  const current = blueprint({
    output_schema: JSON.stringify(parsed.output_schema),
  });
  assert.deepEqual(checkBlueprintTransition(previous, current), []);
});

test('version regressions, removals, and malformed Blueprint YAML fail closed', () => {
  const previous = blueprint();
  assert.match(
    checkBlueprintTransition(previous, blueprint({ version: '1.1.9' }))[0],
    /version cannot decrease/,
  );
  assert.match(checkBlueprintTransition(previous, undefined)[0], /package major bump/);
  assert.deepEqual(checkBlueprintTransition(previous, undefined, 'Blueprint', { allowRemoval: true }), []);
  assert.match(checkNewBlueprint('name: broken\nprompt: [\n')[0], /invalid YAML/);
});

test('repository policy compares the worktree with an explicit Git base', async () => {
  await withTempDirectory(async root => {
    const path = join(root, 'examples', 'unit.yaml');
    await mkdir(join(root, 'examples'), { recursive: true });
    await writeFile(path, blueprint());
    await writeFile(join(root, 'package.json'), '{"version":"0.1.0"}\n');
    git(root, ['init', '--quiet']);
    git(root, ['config', 'user.name', data.person('git author')]);
    git(root, ['config', 'user.email', `${data.text('git email')}@example.test`]);
    git(root, ['add', '.']);
    git(root, ['commit', '--quiet', '-m', data.text('base commit')]);
    const base = git(root, ['rev-parse', 'HEAD']).trim();

    await writeFile(path, blueprint({ prompt: data.text('repository changed prompt') }));
    const failed = checkRepository({ root, base });
    assert.equal(failed.checked, 1);
    assert.match(failed.errors[0], /content changed without a version bump/);

    await writeFile(path, blueprint({
      version: '1.2.4',
      prompt: data.text('repository changed prompt'),
    }));
    assert.deepEqual(checkRepository({ root, base }).errors, []);
  }, 'pixiecore-blueprint-version-');
});

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}
