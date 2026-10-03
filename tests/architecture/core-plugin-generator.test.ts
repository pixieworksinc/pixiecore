import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { runCorePluginCatalog } from '../../scripts/generate-core-plugin-catalog.mjs';
import { withTempDirectory } from '../helpers/temp.js';

test('core catalog generation is deterministic and its check rejects stale or untrusted input', async () => {
  await withTempDirectory(async root => {
    const pluginRoot = join(root, 'src', 'plugins', 'example');
    await mkdir(pluginRoot, { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: 'catalog-fixture',
      private: true,
      type: 'module',
      version: '1.0.0',
      pixiecore: { plugins: './plugins' },
    }));
    await writeFile(join(pluginRoot, 'example.yaml'), manifestSource());
    await writeFile(join(pluginRoot, 'example.ts'), activatorSource());

    const firstWrite = await runGenerator(root, '--write');
    assert.equal(firstWrite.exitCode, 0, firstWrite.output);
    const generatedPath = join(
      root,
      'src',
      'core',
      'kernel',
      'generated',
      'core-plugin-catalog.generated.ts',
    );
    const firstBytes = await readFile(generatedPath, 'utf8');

    const current = await runGenerator(root, '--check');
    assert.equal(current.exitCode, 0, current.output);
    await writeFile(generatedPath, `${firstBytes}// stale\n`);
    const stale = await runGenerator(root, '--check');
    assert.equal(stale.exitCode, 1, stale.output);
    assert.match(stale.output, /is stale/);

    const secondWrite = await runGenerator(root, '--write');
    assert.equal(secondWrite.exitCode, 0, secondWrite.output);
    assert.equal(await readFile(generatedPath, 'utf8'), firstBytes);

    await writeFile(join(pluginRoot, 'example.yaml'), `${manifestSource()}enabled: false\n`);
    const trustedField = await runGenerator(root, '--check');
    assert.equal(trustedField.exitCode, 1, trustedField.output);
    assert.match(trustedField.output, /may not define trusted field enabled/);

    await writeFile(
      join(pluginRoot, 'example.yaml'),
      manifestSource().replace('pixiecore.example', 'acme.example'),
    );
    const spoofedId = await runGenerator(root, '--check');
    assert.equal(spoofedId.exitCode, 1, spoofedId.output);
    assert.match(spoofedId.output, /reserved pixiecore namespace/);

    await writeFile(
      join(pluginRoot, 'example.yaml'),
      manifestSource().replace("version: '1.0.0'", "version: '1.0.0-01'"),
    );
    const invalidVersion = await runGenerator(root, '--check');
    assert.equal(invalidVersion.exitCode, 1, invalidVersion.output);
    assert.match(invalidVersion.output, /version must be SemVer 2\.0/);

    await writeFile(join(pluginRoot, 'example.yaml'), manifestSource());
    await writeFile(
      join(pluginRoot, 'example.ts'),
      activatorSource().replace('export class ExampleRole {}\n', ''),
    );
    const missingExport = await runGenerator(root, '--check');
    assert.equal(missingExport.exitCode, 1, missingExport.output);
    assert.match(missingExport.output, /does not export component ExampleRole/);

    await writeFile(
      join(pluginRoot, 'example.ts'),
      activatorSource().replace(
        'export const createCorePluginActivator = () => ({ activate() {} });',
        'const sharedActivator = { activate() {} };\nexport const createCorePluginActivator = () => sharedActivator;',
      ),
    );
    const reusedActivator = await runGenerator(root, '--check');
    assert.equal(reusedActivator.exitCode, 1, reusedActivator.output);
    assert.match(reusedActivator.output, /must return fresh values/);
  });
});

test('core catalog recursively discovers nested units and enforces parent id prefixes', async () => {
  await withTempDirectory(async root => {
    const parentRoot = join(root, 'src', 'plugins', 'parent');
    const childRoot = join(parentRoot, 'plugins', 'child');
    await Promise.all([
      mkdir(parentRoot, { recursive: true }),
      mkdir(childRoot, { recursive: true }),
    ]);
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: 'recursive-catalog-fixture',
      private: true,
      type: 'module',
      version: '1.0.0',
      pixiecore: { plugins: './plugins' },
    }));
    await Promise.all([
      writeFile(
        join(parentRoot, 'parent.yaml'),
        manifestSource()
          .replaceAll('pixiecore.example', 'pixiecore.parent')
          .replaceAll('Catalog Fixture', 'Parent Fixture')
          .replaceAll('./example.js', './parent.js'),
      ),
      writeFile(join(parentRoot, 'parent.ts'), activatorSource()),
      writeFile(
        join(childRoot, 'child.yaml'),
        manifestSource()
          .replaceAll('pixiecore.example', 'pixiecore.parent.child')
          .replaceAll('Catalog Fixture', 'Child Fixture')
          .replaceAll('./example.js', './child.js'),
      ),
      writeFile(join(childRoot, 'child.ts'), activatorSource()),
    ]);

    const generated = await runGenerator(root, '--write');
    assert.equal(generated.exitCode, 0, generated.output);
    const catalog = await readFile(join(
      root,
      'src',
      'core',
      'kernel',
      'generated',
      'core-plugin-catalog.generated.ts',
    ), 'utf8');
    const parentOffset = catalog.indexOf('plugins/parent/parent.js');
    const childOffset = catalog.indexOf('plugins/parent/plugins/child/child.js');
    assert.ok(parentOffset >= 0);
    assert.ok(childOffset > parentOffset);
    assert.match(catalog, /parentId: "pixiecore\.parent"/);

    await writeFile(
      join(childRoot, 'child.yaml'),
      manifestSource()
        .replaceAll('pixiecore.example', 'pixiecore.unrelated')
        .replaceAll('Catalog Fixture', 'Invalid Child Fixture')
        .replaceAll('./example.js', './child.js'),
    );
    const mismatch = await runGenerator(root, '--check');
    assert.equal(mismatch.exitCode, 1, mismatch.output);
    assert.match(mismatch.output, /Nested core plugin id must begin with pixiecore\.parent\./);
  });
});

test('core catalog generation validates dependency policy and emits dependencies first', async () => {
  await withTempDirectory(async root => {
    await writePolicyFixture(root, policyManifests());

    const generated = await runGenerator(root, '--write');
    assert.equal(generated.exitCode, 0, generated.output);
    const catalog = await readFile(join(
      root,
      'src',
      'core',
      'kernel',
      'generated',
      'core-plugin-catalog.generated.ts',
    ), 'utf8');
    const dependencyOffset = catalog.indexOf("plugins/zeta/zeta.js");
    const requiredDependentOffset = catalog.indexOf("plugins/alpha/alpha.js");
    const optionalDependentOffset = catalog.indexOf("plugins/beta/beta.js");
    assert.ok(dependencyOffset >= 0);
    assert.ok(dependencyOffset < requiredDependentOffset);
    assert.ok(requiredDependentOffset < optionalDependentOffset);

    await expectPolicyFailure(root, policyManifests({
      alpha: { requires: { 'pixiecore.zeta': 'not-a-range' } },
    }), /requires\.pixiecore\.zeta must be an npm-compatible version range/);
    await expectPolicyFailure(root, policyManifests({
      beta: { optional_requires: { 'pixiecore.alpha': 'not-a-range' } },
    }), /optional_requires\.pixiecore\.alpha must be an npm-compatible version range/);
    await expectPolicyFailure(root, policyManifests({
      alpha: { conflicts: { 'pixiecore.future': 'not-a-range' } },
    }), /conflicts\.pixiecore\.future must be an npm-compatible version range/);

    await expectPolicyFailure(root, policyManifests({
      alpha: { requires: { 'acme.zeta': '^1.0.0' } },
    }), /requires may reference only core plugin ids, found acme\.zeta/);
    await expectPolicyFailure(root, policyManifests({
      alpha: { conflicts: { 'acme.zeta': '^1.0.0' } },
    }), /conflicts may reference only core plugin ids, found acme\.zeta/);

    await expectPolicyFailure(root, policyManifests({
      alpha: { requires: { 'pixiecore.missing': '^1.0.0' } },
    }), /pixiecore\.alpha requires missing core plugin pixiecore\.missing/);
    await expectPolicyFailure(root, policyManifests({
      alpha: { requires: { 'pixiecore.zeta': '^2.0.0' } },
    }), /pixiecore\.alpha requires pixiecore\.zeta@\^2\.0\.0, found 1\.0\.0/);
    await expectPolicyFailure(root, policyManifests({
      beta: { optional_requires: { 'pixiecore.alpha': '^2.0.0' } },
    }), /pixiecore\.beta optionally requires pixiecore\.alpha@\^2\.0\.0, found 1\.0\.0/);
    await expectPolicyFailure(root, policyManifests({
      alpha: { conflicts: { 'pixiecore.zeta': '*' } },
    }), /pixiecore\.alpha conflicts with selected core plugin pixiecore\.zeta@1\.0\.0/);
    await expectPolicyFailure(root, policyManifests({
      zeta: { requires: { 'pixiecore.beta': '^1.0.0' } },
    }), /Core plugin dependency cycle: pixiecore\.alpha -> pixiecore\.beta -> pixiecore\.zeta/);
  });
});

test('core catalog accepts trusted service and command metadata', async () => {
  await withTempDirectory(async root => {
    const pluginRoot = join(root, 'src', 'plugins', 'services');
    await mkdir(pluginRoot, { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: 'core-service-fixture',
      private: true,
      type: 'module',
      version: '1.0.0',
      pixiecore: { plugins: './plugins' },
    }));
    const manifest = `schema: pixiecore.plugin/v1
id: pixiecore.services
name: Core Services
version: '1.0.0'
description: Registers service and command factories without running them.
entry: ./services.js
requires: {}
optional_requires: {}
conflicts: {}
components:
  - type: service
    export: RuntimeService
    service_id: pixiecore.runtime.service
  - type: command
    export: CliCommands
    command_names: [execute, execute-yaml, serve]
`;
    await writeFile(join(pluginRoot, 'services.yaml'), manifest);
    await writeFile(join(pluginRoot, 'services.ts'), `
export const RuntimeService = {};
export const CliCommands = {};
export const createCorePluginActivator = () => ({ activate() {} });
`);

    const generated = await runGenerator(root, '--write');
    assert.equal(generated.exitCode, 0, generated.output);
    const catalog = await readFile(join(
      root,
      'src',
      'core',
      'kernel',
      'generated',
      'core-plugin-catalog.generated.ts',
    ), 'utf8');
    assert.match(catalog, /service_id: "pixiecore\.runtime\.service"/);
    assert.match(catalog, /command_names: Object\.freeze/);

    await writeFile(
      join(pluginRoot, 'services.yaml'),
      manifest.replace('[execute, execute-yaml, serve]', '[execute, execute]'),
    );
    const duplicateCommand = await runGenerator(root, '--check');
    assert.equal(duplicateCommand.exitCode, 1, duplicateCommand.output);
    assert.match(duplicateCommand.output, /requires unique components\[1\]\.command_names/);
  });
});

function manifestSource(): string {
  return `schema: pixiecore.plugin/v1
id: pixiecore.example
name: Catalog Fixture
version: '1.0.0'
description: Exercises deterministic catalog generation.
entry: ./example.js
requires: {}
optional_requires: {}
conflicts: {}
components:
  - type: agent_role
    export: ExampleRole
    roles_supported: [example]
`;
}

function activatorSource(): string {
  return `export class ExampleRole {}
export const createCorePluginActivator = () => ({ activate() {} });
`;
}

interface FixtureManifest {
  readonly schema: 'pixiecore.plugin/v1';
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly entry: `./${string}.js`;
  readonly requires: Readonly<Record<string, string>>;
  readonly optional_requires: Readonly<Record<string, string>>;
  readonly conflicts: Readonly<Record<string, string>>;
  readonly components: readonly [{
    readonly type: 'agent_role';
    readonly export: 'ExampleRole';
    readonly roles_supported: readonly ['example'];
  }];
}

type PolicyManifestOverrides = Partial<Record<
  'alpha' | 'beta' | 'zeta',
  Partial<Pick<FixtureManifest, 'requires' | 'optional_requires' | 'conflicts'>>
>>;

function policyManifests(overrides: PolicyManifestOverrides = {}): readonly FixtureManifest[] {
  return [
    fixtureManifest('pixiecore.alpha', {
      requires: { 'pixiecore.zeta': '^1.0.0' },
      ...overrides.alpha,
    }),
    fixtureManifest('pixiecore.beta', {
      optional_requires: { 'pixiecore.alpha': '^1.0.0' },
      ...overrides.beta,
    }),
    fixtureManifest('pixiecore.zeta', overrides.zeta),
  ];
}

function fixtureManifest(
  id: string,
  overrides: Partial<Pick<FixtureManifest, 'requires' | 'optional_requires' | 'conflicts'>> = {},
): FixtureManifest {
  const directory = id.slice('pixiecore.'.length);
  return {
    schema: 'pixiecore.plugin/v1',
    id,
    name: `Fixture ${id}`,
    version: '1.0.0',
    description: `Exercises dependency policy for ${id}.`,
    entry: `./${directory}.js`,
    requires: {},
    optional_requires: {},
    conflicts: {},
    components: [{
      type: 'agent_role',
      export: 'ExampleRole',
      roles_supported: ['example'],
    }],
    ...overrides,
  };
}

async function writePolicyFixture(
  root: string,
  manifests: readonly FixtureManifest[],
): Promise<void> {
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'core-policy-fixture',
    private: true,
    type: 'module',
    version: '1.0.0',
    pixiecore: { plugins: './plugins' },
  }));
  for (const manifest of manifests) {
    const directory = manifest.id.slice('pixiecore.'.length);
    const pluginRoot = join(root, 'src', 'plugins', directory);
    await mkdir(pluginRoot, { recursive: true });
    await writeFile(join(pluginRoot, `${directory}.yaml`), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(join(pluginRoot, `${directory}.ts`), `export class ExampleRole {}
export const createCorePluginActivator = () => ({ activate() {} });
`);
  }
}

async function expectPolicyFailure(
  root: string,
  manifests: readonly FixtureManifest[],
  pattern: RegExp,
): Promise<void> {
  await writePolicyFixture(root, manifests);
  const result = await runGenerator(root, '--check');
  assert.equal(result.exitCode, 1, result.output);
  assert.match(result.output, pattern);
}

async function runGenerator(root: string, mode: '--write' | '--check') {
  return runCorePluginCatalog({ root, mode: mode.slice(2) as 'write' | 'check' });
}
