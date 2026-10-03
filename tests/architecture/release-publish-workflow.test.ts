import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { withTempDirectory } from '../helpers/temp.js';
import { testData } from '../helpers/test-data.js';

const workflowPath = resolve('.github/workflows/release.yml');
const source = await readFile(workflowPath, 'utf8');
const workflow = parse(source) as Workflow;

test('publish workflow is manual, tag-bound, and serialized across package versions', () => {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.on.workflow_dispatch.inputs.version.required, true);
  assert.equal(workflow.on.workflow_dispatch.inputs.confirmation.required, true);
  assert.equal(workflow.on.workflow_dispatch.inputs.candidate_run_id.required, true);
  assert.equal(workflow.on.workflow_dispatch.inputs.candidate_artifact_id.required, true);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  // All versions share one queue so independently admitted candidates cannot race latest.
  assert.equal(workflow.concurrency.group, 'release-pixiecore');
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.equal(workflow.jobs.build.outputs.revision, '${{ steps.release_source.outputs.revision }}');
  assert.match(namedStep('build', 'Assert approved release context').run ?? '', /GITHUB_REF_TYPE/u);
  assert.match(namedStep('build', 'Assert approved release context').run ?? '', /pixieworksinc\/pixiecore/u);
  assert.match(namedStep('build', 'Assert approved release context').run ?? '', /PIXIECORE_REPOSITORY_PRIVATE/u);
  assert.match(namedStep('build', 'Assert approved release context').run ?? '', /git cat-file -t/u);
  assert.match(namedStep('build', 'Assert approved release context').run ?? '', /BEGIN \(PGP\|SSH\) SIGNATURE/u);
  assert.match(namedStep('build', 'Assert approved release context').run ?? '', /origin\/0\.1\.x/u);
  assert.match(namedStep('build', 'Assert approved release context').run ?? '', /assertStableReleaseVersion/u);
});

test('promotion checks immutable candidate provenance and signed bytes without rebuilding', () => {
  assert.deepEqual(workflow.jobs.build.permissions, { contents: 'read', actions: 'read' });
  assert.doesNotMatch(source, /npm ci|npm pack|prepack|prepare:release-artifact/u);
  const steps = workflow.jobs.build.steps.map(step => step.name);
  const sequence = ['Verify candidate source and signed tag', 'Download approved candidate by immutable ID',
    'Verify signed candidate bytes', 'Upload immutable release artifact'] as const;
  for (let index = 1; index < sequence.length; index++) {
    const previous = sequence[index - 1];
    const current = sequence[index];
    assert.ok(previous && current);
    assert.ok(steps.indexOf(previous) < steps.indexOf(current));
  }
  assert.match(namedStep('build', sequence[0]).run ?? '', /verify-promotion\.mjs --check-source/u);
  assert.match(namedStep('build', sequence[2]).run ?? '', /verify-promotion\.mjs/u);
  const download = namedStep('build', sequence[1]).with;
  assert.equal(download?.['artifact-ids'], '${{ inputs.candidate_artifact_id }}');
  assert.equal(download?.['run-id'], '${{ inputs.candidate_run_id }}');
  assert.equal(download?.repository, '${{ github.repository }}');
  assert.equal(download?.['github-token'], '${{ github.token }}');
  assert.equal(download?.['merge-multiple'], true);
  assert.equal(download?.path, 'release');
});

test('only the publish job receives OIDC authority and it publishes the verified tarball', () => {
  assert.deepEqual(workflow.jobs.publish.needs, 'build');
  assert.deepEqual(workflow.jobs.publish.environment, { name: 'release' });
  assert.deepEqual(workflow.jobs.publish.permissions, {
    contents: 'read',
    'id-token': 'write',
  });
  assert.deepEqual(workflow.jobs.github_release.needs, ['build', 'publish']);
  assert.deepEqual(workflow.jobs.github_release.permissions, { contents: 'write' });
  assert.equal(namedStep('publish', 'Set up Node.js for trusted publishing').with?.['node-version'], '24');
  assert.match(namedStep('publish', 'Ensure supported npm CLI').run ?? '', /npm install --global npm@11\.21\.0 --ignore-scripts --registry=https:\/\/registry\.npmjs\.org/u);
  assert.match(namedStep('publish', 'Ensure supported npm CLI').run ?? '', /test "\$\(npm --version\)" = "11\.21\.0"/u);
  assert.match(namedStep('publish', 'Ensure supported npm CLI').run ?? '', /minor === 5 && patch < 1/u);
  assert.match(namedStep('publish', 'Verify transferred release artifact').run ?? '', /verify-promotion\.mjs/u);
  assert.match(namedStep('publish', 'Check existing registry version').run ?? '', /verify-registry\.mjs --check-existing/u);
  assert.equal(namedStep('publish', 'Check existing registry version').env?.GH_TOKEN, '${{ github.token }}');
  assert.equal(namedStep('publish', 'Publish immutable package through OIDC').if,
    "steps.registry_version.outputs.publish_required == 'true' && inputs.authentication == 'oidc'");
  assert.equal(namedStep('publish', 'Publish immutable package through OIDC').env, undefined);
  const names = workflow.jobs.publish.steps.map(step => step.name);
  assert.ok(names.indexOf('Check existing registry version') < names.indexOf('Publish immutable package through OIDC'));
  assert.match(namedStep('publish', 'Publish immutable package through OIDC').run ?? '', /release-manifest\.json/u);
  assert.match(namedStep('publish', 'Publish immutable package through OIDC').run ?? '', /npm publish "\.\/release\/\$tarball"/u);
  assert.match(namedStep('publish', 'Publish immutable package through OIDC').run ?? '', /--tag latest --registry=https:\/\/registry\.npmjs\.org/u);
  assert.match(namedStep('publish', 'Verify anonymously published package bytes').run ?? '', /verify:registry-artifact/u);
  assert.equal(namedStep('publish', 'Verify anonymously published package bytes').env?.GH_TOKEN, '${{ github.token }}');
  assert.match(namedStep('publish', 'Verify anonymously published package bytes').run ?? '', /needs\.build\.outputs\.revision/u);
  assert.ok(namedStep('github_release', 'Check out release verifier'));
  assert.equal(namedStep('github_release', 'Set up Node.js').with?.['node-version'], '24');
  assert.match(namedStep('github_release', 'Verify release assets again').run ?? '', /verify-promotion\.mjs/u);
  assert.match(namedStep('github_release', 'Verify release assets again').run ?? '', /needs\.build\.outputs\.revision/u);
  assert.match(namedStep('github_release', 'Create GitHub release with verified artifacts').run ?? '', /github-release\.mjs/u);
  assert.match(namedStep('github_release', 'Create GitHub release with verified artifacts').run ?? '', /--output=release/u);
  assert.equal(namedStep('github_release', 'Create GitHub release with verified artifacts').env?.GH_REPO, '${{ github.repository }}');
});

test('bootstrap is explicit, version-bound, and the only step with a package credential', () => {
  const inputs = workflow.on.workflow_dispatch.inputs;
  assert.equal(inputs.authentication.required, true);
  assert.equal(inputs.authentication.type, 'choice');
  assert.equal(inputs.authentication.default, 'oidc');
  assert.deepEqual(inputs.authentication.options, ['oidc', 'bootstrap']);
  assert.equal(inputs.bootstrap_confirmation.required, false);
  for (const [job, name] of [['build', 'Assert approved release context'],
    ['publish', 'Check existing registry version']] as const) {
    const step = namedStep(job, name);
    assert.equal(step.env?.PIXIECORE_PUBLICATION_MODE, '${{ inputs.authentication }}');
    assert.equal(step.env?.PIXIECORE_BOOTSTRAP_CONFIRMATION, '${{ inputs.bootstrap_confirmation }}');
  }
  assert.match(namedStep('build', 'Assert approved release context').run ?? '', /assertPublicationMode/u);
  const bootstrap = namedStep('publish', 'Bootstrap first package with provenance');
  assert.equal(bootstrap.if,
    "steps.registry_version.outputs.publish_required == 'true' && inputs.authentication == 'bootstrap'");
  assert.deepEqual(bootstrap.env, { NODE_AUTH_TOKEN: '${{ secrets.NPM_BOOTSTRAP_TOKEN }}' });
  const privilegedSteps = Object.values(workflow.jobs).flatMap(job => job.steps)
    .filter(step => /secrets\./u.test(JSON.stringify(step)));
  assert.deepEqual(privilegedSteps, [bootstrap]);
  assert.match(bootstrap.run ?? '', /test -n "\$NODE_AUTH_TOKEN"/u);
  assert.match(bootstrap.run ?? '', /npm publish "\.\/release\/\$tarball" --ignore-scripts --provenance --access public/u);
  assert.match(bootstrap.run ?? '', /umask 077/u);
  assert.match(bootstrap.run ?? '', /trap 'rm -f "\$npm_config_userconfig"' EXIT/u);
  assert.match(bootstrap.run ?? '', /'\/\/registry\.npmjs\.org\/:_authToken=\$\{NODE_AUTH_TOKEN\}'/u);
  assert.doesNotMatch(bootstrap.run ?? '', /set -x|echo.*\$NODE_AUTH_TOKEN/u);
  const names = workflow.jobs.publish.steps.map(step => step.name);
  assert.ok(names.indexOf('Check existing registry version') < names.indexOf(bootstrap.name));
  assert.ok(names.indexOf(bootstrap.name) < names.indexOf('Verify anonymously published package bytes'));
});

test('bootstrap shell fails without a credential and cleans configuration on success and failure', async () => {
  const fakeToken = testData('bootstrap shell').text('synthetic credential');
  for (const [token, exitCode] of [['', 0], [fakeToken, 0], [fakeToken, 1]] as const) {
    await withTempDirectory(async directory => {
      const bin = join(directory, 'bin');
      const runner = join(directory, 'runner');
      await mkdir(bin);
      await mkdir(runner);
      await mkdir(join(directory, 'release'));
      await writeFile(join(directory, 'release/release-manifest.json'), JSON.stringify({ tarball: 'approved.tgz' }));
      // Replace npm entirely: this test cannot contact a registry or publish a package.
      await writeFile(join(bin, 'npm'), `#!${process.execPath}
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = process.env.npm_config_userconfig;
assert.equal(fs.readFileSync(path, 'utf8'), '//registry.npmjs.org/:_authToken=$' + '{NODE_AUTH_TOKEN}\\n');
assert.equal(fs.statSync(path).mode & 0o777, 0o600);
assert.ok(process.env.NODE_AUTH_TOKEN);
fs.writeFileSync('invocation.json', JSON.stringify(process.argv.slice(2)));
process.exit(Number(process.env.MOCK_EXIT));
`, { mode: 0o700 });
      const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c',
        namedStep('publish', 'Bootstrap first package with provenance').run ?? ''], {
        cwd: directory, encoding: 'utf8',
        env: { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, RUNNER_TEMP: runner,
          NODE_AUTH_TOKEN: token, MOCK_EXIT: String(exitCode) },
      });
      assert.equal(result.status, token ? exitCode : 1, result.stderr);
      assert.deepEqual(await readdir(runner), [], 'Temporary npm configuration must be removed');
      assert.ok(!(result.stdout + result.stderr).includes(fakeToken), 'Never log the credential');
      if (!token) {
        await assert.rejects(readFile(join(directory, 'invocation.json')), { code: 'ENOENT' });
        return;
      }
      assert.deepEqual(JSON.parse(await readFile(join(directory, 'invocation.json'), 'utf8')),
        ['publish', './release/approved.tgz', '--ignore-scripts', '--provenance', '--access', 'public',
          '--tag', 'latest', '--registry=https://registry.npmjs.org']);
    });
  }
});

test('every third-party action is pinned and verified artifact transfer stays within one publish run', () => {
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps.filter(step => step.uses)) {
      assert.match(step.uses ?? '', /^actions\/[a-z-]+@[0-9a-f]{40}$/u);
    }
  }
  const name = 'pixiecore-release-${{ github.run_id }}-${{ github.run_attempt }}';
  assert.equal(namedStep('build', 'Upload immutable release artifact').with?.name, name);
  assert.equal(namedStep('build', 'Upload immutable release artifact').id, 'release_artifact');
  assert.equal(workflow.jobs.build.outputs.artifact_id, '${{ steps.release_artifact.outputs.artifact-id }}');
  for (const job of ['publish', 'github_release'] as const) {
    const download = namedStep(job, 'Download immutable release artifact');
    assert.equal(download.with?.['artifact-ids'], '${{ needs.build.outputs.artifact_id }}');
    assert.equal(download.with?.['merge-multiple'], true);
    assert.equal(download.with?.path, 'release');
    assert.equal(download.with?.name, undefined);
    assert.doesNotMatch(JSON.stringify(download), /github\.run_attempt/u,
      'Failed-job reruns must retain the successful build artifact, not recompute its attempt');
  }
});

test('privileged jobs check out only the immutable tag object admitted by the build job', () => {
  assert.equal(workflow.jobs.build.outputs.tag_object, '${{ steps.release_source.outputs.tag_object }}');
  const admission = namedStep('build', 'Assert approved release context').run ?? '';
  assert.match(admission, /git rev-parse --verify "refs\/tags\/\$GITHUB_REF_NAME"/u);
  assert.match(admission, /test "\$release_commit" = "\$\(git rev-parse HEAD\)"/u);
  assert.match(admission, /test "\$release_commit" = "\$GITHUB_SHA"/u);
  assert.match(admission, /tag_object=%s/u);
  for (const [job, verification] of [
    ['publish', 'Verify transferred release artifact'],
    ['github_release', 'Verify release assets again'],
  ] as const) {
    const checkout = namedStep(job, 'Check out release verifier');
    assert.equal(checkout.with?.ref, '${{ needs.build.outputs.tag_object }}');
    assert.equal(checkout.with?.['fetch-depth'], 0);
    const step = namedStep(job, verification);
    assert.match(step.run ?? '', /--tag-object="\$\{\{ needs\.build\.outputs\.tag_object \}\}"/u);
    assert.match(step.run ?? '', /--check-current-tag/u);
    assert.equal(step.env?.GH_TOKEN, '${{ github.token }}');
  }
  for (const name of ['Verify candidate source and signed tag', 'Verify signed candidate bytes']) {
    assert.match(namedStep('build', name).run ?? '', /--tag-object="\$\{\{ steps\.release_source\.outputs\.tag_object \}\}"/u);
  }
});

function namedStep(jobName: keyof Workflow['jobs'], name: string): Step {
  const step = workflow.jobs[jobName].steps.find(candidate => candidate.name === name);
  assert.ok(step, `Missing ${jobName} workflow step: ${name}`);
  return step;
}

interface Workflow {
  readonly on: Readonly<{
    workflow_dispatch: Readonly<{
      inputs: Readonly<Record<'version' | 'confirmation' | 'candidate_run_id' | 'candidate_artifact_id' | 'authentication' | 'bootstrap_confirmation', Readonly<{ required: boolean; type: string; default?: string; options?: readonly string[] }>>>;
    }>;
  }>;
  readonly permissions: Readonly<Record<string, string>>;
  readonly concurrency: Readonly<{ group: string; 'cancel-in-progress': boolean }>;
  readonly jobs: Readonly<{
    build: ReleaseBuildJob;
    publish: ReleaseJob;
    github_release: ReleaseJob;
  }>;
}

interface ReleaseBuildJob extends ReleaseJob {
  readonly outputs: Readonly<Record<'revision' | 'tag_object' | 'artifact_id', string>>;
}

interface ReleaseJob {
  readonly needs?: string | readonly string[];
  readonly permissions?: Readonly<Record<string, string>>;
  readonly environment?: Readonly<Record<'name', string>>;
  readonly steps: readonly Step[];
}

interface Step {
  readonly id?: string;
  readonly name: string;
  readonly uses?: string;
  readonly run?: string;
  readonly if?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly with?: Readonly<Record<string, unknown>>;
}
