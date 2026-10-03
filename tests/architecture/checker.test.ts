import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { runArchitectureCheck } from '../../scripts/check-architecture.mjs';
import { withTempDirectory } from '../helpers/temp.js';

interface ArchitectureBaseline {
  schemaVersion: 1;
  migrationPhase: number;
  legacySourceFiles: string[];
  opaqueDynamicImportFiles: Array<{ file: string; reason: string }>;
  temporaryDependencyExceptions: Array<{
    rule: string;
    from: string;
    to: string;
    reason: string;
    expiresAfterPhase: number;
  }>;
}

test('architecture checker accepts transitional files and valid target dependencies', async () => {
  await withArchitectureFixture({
    'src/index.ts': [
      "export { legacy } from './legacy.js';",
      "export type { Kernel } from './core/kernel/index.js';",
      '',
    ].join('\n'),
    'src/legacy.ts': 'export const legacy = true;\n',
    'src/legacy-loader.ts': [
      'export async function load(modulePath: string): Promise<unknown> {',
      '  return import(modulePath);',
      '}',
      '',
    ].join('\n'),
    'src/core/component/value.ts': 'export interface Value { readonly value: string }\n',
    'src/core/contracts/value.ts': [
      "import type { Value } from '../component/value.js';",
      'export type Contract = Value;',
      '',
    ].join('\n'),
    'src/core/bootstrap/index.ts': [
      "import type { Contract } from '../contracts/value.js';",
      'export type Bootstrap = Contract;',
      '',
    ].join('\n'),
    'src/core/kernel/index.ts': [
      "import type { Bootstrap } from '../bootstrap/index.js';",
      'export type Kernel = Bootstrap;',
      '',
    ].join('\n'),
    'src/plugins/runtime/src/value.ts': [
      "import type { Contract } from '../../../core/contracts/value.js';",
      'export type RuntimeValue = Contract;',
      '',
    ].join('\n'),
    'src/plugins/runtime/runtime.ts': "export { activate } from './src/value.js';\n",
    'src/core/kernel/generated/core-plugin-catalog.generated.ts': [
      "import type { RuntimeValue } from '../../../plugins/runtime/runtime.js';",
      'export type Generated = RuntimeValue;',
      '',
    ].join('\n'),
  }, {
    legacySourceFiles: ['src/legacy-loader.ts', 'src/legacy.ts'],
    opaqueDynamicImportFiles: [{
      file: 'src/legacy-loader.ts',
      reason: 'Fixture runtime module loader.',
    }],
  }, async root => {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 0, result.output);
    assert.match(result.output, /Architecture check passed:/);
  });
});

test('architecture checker ratchets both unlisted and removed legacy files', async () => {
  await withArchitectureFixture({
    'src/index.ts': 'export {};\n',
    'src/new-legacy.ts': 'export {};\n',
  }, {
    legacySourceFiles: ['src/removed-legacy.ts'],
  }, async root => {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /\[legacy-source-file\]/);
    assert.match(result.output, /\[stale-legacy-source-file\]/);
  });
});

test('architecture checker reads a fresh source snapshot after fixture mutations', async () => {
  await withArchitectureFixture({
    'src/index.ts': 'export {};\n',
  }, {}, async root => {
    assert.equal(runChecker(root).exitCode, 0);

    const unsupportedDirectory = join(root, 'src', 'core', 'unsupported');
    await mkdir(unsupportedDirectory, { recursive: true });
    await writeFile(join(unsupportedDirectory, 'value.ts'), 'export const value = true;\n');
    const added = runChecker(root);
    assert.equal(added.exitCode, 1);
    assert.match(added.output, /\[unknown-core-area\]/);

    await rm(unsupportedDirectory, { recursive: true, force: true });
    assert.equal(runChecker(root).exitCode, 0);

    await writeFile(join(root, 'src', 'index.ts'), 'export const value = true;\n');
    const changed = runChecker(root);
    assert.equal(changed.exitCode, 1);
    assert.match(changed.output, /\[root-barrel-only\]/);
  });
});

test('phase 7 requires a named entry, manifest, source directory, and owned tests per core plugin', async () => {
  await withArchitectureFixture({
    'src/index.ts': 'export {};\n',
    'src/plugins/valid/valid.ts': 'export const activate = (): void => {};\n',
    'src/plugins/valid/valid.yaml': 'schema: pixiecore.plugin/v1\nid: pixiecore.valid\n',
    'src/plugins/valid/src/value.ts': 'export const value = true;\n',
    'src/plugins/valid/tests/contract/valid.test.ts': 'export {};\n',
    'src/plugins/missing-manifest/missing-manifest.ts': 'export {};\n',
    'src/plugins/missing-manifest/src/value.ts': 'export {};\n',
    'src/plugins/missing-manifest/tests/contract/value.test.ts': 'export {};\n',
    'src/plugins/missing-entry/missing-entry.yaml': 'schema: pixiecore.plugin/v1\nid: pixiecore.missing-entry\n',
    'src/plugins/missing-entry/src/value.ts': 'export {};\n',
    'src/plugins/missing-entry/tests/contract/value.test.ts': 'export {};\n',
    'src/plugins/missing-source/missing-source.ts': 'export {};\n',
    'src/plugins/missing-source/missing-source.yaml': 'schema: pixiecore.plugin/v1\nid: pixiecore.missing-source\n',
    'src/plugins/missing-source/tests/contract/value.test.ts': 'export {};\n',
    'src/plugins/missing-tests/missing-tests.ts': 'export {};\n',
    'src/plugins/missing-tests/missing-tests.yaml': 'schema: pixiecore.plugin/v1\nid: pixiecore.missing-tests\n',
    'src/plugins/missing-tests/src/value.ts': 'export {};\n',
    'src/plugins/legacy-alias/legacy-alias.ts': 'export {};\n',
    'src/plugins/legacy-alias/legacy-alias.yml': 'schema: pixiecore.plugin/v1\nid: pixiecore.legacy-alias\n',
    'src/plugins/legacy-alias/src/value.ts': 'export {};\n',
    'src/plugins/legacy-alias/tests/contract/value.test.ts': 'export {};\n',
    'src/plugins/nested/nested.ts': 'export {};\n',
    'src/plugins/nested/nested.yaml': 'schema: pixiecore.plugin/v1\nid: pixiecore.nested\n',
    'src/plugins/nested/src/value.ts': 'export {};\n',
    'src/plugins/nested/tests/contract/value.test.ts': 'export {};\n',
    'src/plugins/nested/config/plugin.yaml': 'schema: pixiecore.plugin/v1\nid: pixiecore.nested-duplicate\n',
  }, { migrationPhase: 7 }, async root => {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /\[core-plugin-manifest\]/);
    assert.match(result.output, /\[core-plugin-activator\]/);
    assert.match(result.output, /\[core-plugin-source\]/);
    assert.match(result.output, /\[core-plugin-tests\]/);
    assert.match(result.output, /\[core-plugin-manifest-location\]/);
    assert.match(result.output, /legacy-alias\.yml/);
    assert.match(result.output, /config\/plugin\.yaml/);
    assert.doesNotMatch(result.output, /src\/plugins\/valid.*core-plugin/);
  });
});

test('architecture checker recursively validates nested core plugin units', async () => {
  const nestedFixture: Record<string, string> = {
    'src/index.ts': 'export {};\n',
    'src/core/kernel/generated/core-plugin-catalog.generated.ts': [
      "import type { Child } from '../../../plugins/parent/plugins/child/child.js';",
      'export type GeneratedChild = Child;',
      '',
    ].join('\n'),
    'src/plugins/parent/parent.ts': "export type { Parent } from './src/value.js';\n",
    'src/plugins/parent/parent.yaml': 'schema: pixiecore.plugin/v1\nid: pixiecore.parent\n',
    'src/plugins/parent/src/value.ts': 'export interface Parent {}\n',
    'src/plugins/parent/tests/contract/parent.test.ts': 'export {};\n',
    'src/plugins/parent/plugins/child/child.ts': "export type { Child } from './src/value.js';\n",
    'src/plugins/parent/plugins/child/child.yaml': 'schema: pixiecore.plugin/v1\nid: pixiecore.parent.child\n',
    'src/plugins/parent/plugins/child/src/value.ts': 'export interface Child {}\n',
    'src/plugins/parent/plugins/child/tests/contract/child.test.ts': 'export {};\n',
  };
  await withArchitectureFixture(
    nestedFixture,
    { migrationPhase: 7 },
    async root => {
      const result = await runChecker(root);
      assert.equal(result.exitCode, 0, result.output);
    },
  );

  const missingNestedTests = { ...nestedFixture };
  delete missingNestedTests[
    'src/plugins/parent/plugins/child/tests/contract/child.test.ts'
  ];
  await withArchitectureFixture(
    missingNestedTests,
    { migrationPhase: 7 },
    async root => {
      const result = await runChecker(root);
      assert.equal(result.exitCode, 1);
      assert.match(result.output, /parent\/plugins\/child.*\[core-plugin-tests\]/);
    },
  );
});

test('phase 8 accepts only the final source root and kernel-to-plugin entry-point edges', async () => {
  await withArchitectureFixture({
    'src/index.ts': "export { PublicValue } from './core/kernel/runtime/index.js';\n",
    'src/core/kernel/runtime/index.ts': "export { PublicValue } from '../../../plugins/runtime/runtime.js';\n",
    'src/plugins/runtime/runtime.ts': "export { PublicValue } from './src/value.js';\n",
    'src/plugins/runtime/src/value.ts': "export const PublicValue = 'runtime';\n",
    'src/plugins/runtime/runtime.yaml': 'schema: pixiecore.plugin/v1\nid: pixiecore.runtime\n',
    'src/plugins/runtime/tests/contract/runtime.test.ts': 'export {};\n',
  }, { migrationPhase: 8 }, async root => {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 0, result.output);
    assert.match(result.output, /0 legacy files/);
  });
});

test('phase 8 rejects plugin units below src/core', async () => {
  await withArchitectureFixture({
    'src/index.ts': 'export {};\n',
    'src/core/kernel/recipe.ts': "export { recipe } from '../../plugins/recipe/recipe.js';\n",
    'src/core/plugins/other/other.ts': 'export const other = true;\n',
  }, { migrationPhase: 8 }, async root => {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /\[unknown-core-area\]/);
    assert.match(result.output, /src\/core\/plugins\/other/);
    assert.doesNotMatch(result.output, /src\/core\/kernel\/recipe\.ts.*kernel-dependency/);
  });
});

test('architecture checker groups repeated production source prefixes', async () => {
  await withArchitectureFixture({
    'src/index.ts': 'export {};\n',
    'src/core/bootstrap/blueprint-package-manager.ts': 'export {};\n',
    'src/core/bootstrap/blueprint-package-verifier.ts': 'export {};\n',
    'src/core/bootstrap/blueprint/manager.ts': 'export {};\n',
    'src/core/kernel/blueprint-package-cli.ts': 'export {};\n',
    'src/core/kernel/blueprint-preparation-cache.ts': 'export {};\n',
    'src/core/kernel/blueprint/package-cli.ts': 'export {};\n',
    'src/core/bootstrap/plugin-manager/managed-catalog.ts': 'export {};\n',
    'src/core/bootstrap/plugin-manager/managed-manifest.ts': 'export {};\n',
  }, { migrationPhase: 8 }, async root => {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /\[source-prefix-layout\]/);
    assert.match(result.output, /blueprint-package-manager, blueprint-package-verifier/);
    assert.match(result.output, /blueprint-package-cli, blueprint-preparation-cache/);
    assert.match(result.output, /managed-catalog, managed-manifest/);
    assert.doesNotMatch(result.output, /src\/core\/bootstrap\/blueprint.*source-prefix-layout/);
    assert.doesNotMatch(result.output, /src\/core\/kernel\/blueprint.*source-prefix-layout/);
  });
});

test('architecture checker rejects implementation crowds in non-leaf directories', async () => {
  await withArchitectureFixture({
    'src/index.ts': 'export {};\n',
    'src/core/kernel/runtime/execute.ts': 'export {};\n',
    'src/core/kernel/runtime/options.ts': 'export {};\n',
    'src/core/kernel/runtime/retry.ts': 'export {};\n',
    'src/core/kernel/runtime/transport/http.ts': 'export {};\n',
    'src/plugins/example/example.ts': 'export {};\n',
    'src/plugins/example/example.yaml': 'id: pixiecore.example\n',
    'src/plugins/example/src/activator.ts': 'export {};\n',
    'src/plugins/example/src/index.ts': 'export {};\n',
    'src/plugins/example/src/service.ts': 'export {};\n',
    'src/plugins/example/src/model/value.ts': 'export {};\n',
    'src/plugins/example/tests/contract/value.test.ts': 'export {};\n',
  }, { migrationPhase: 8 }, async root => {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /\[fractal-directory-layout\]/);
    assert.match(result.output, /src\/core\/kernel\/runtime/);
    assert.match(result.output, /execute\.ts, options\.ts, retry\.ts/);
    assert.doesNotMatch(result.output, /src\/plugins\/example\/src.*fractal-directory-layout/);
  });
});

test('architecture checker rejects concrete implementation inheritance but permits errors', async () => {
  await withArchitectureFixture({
    'src/index.ts': 'export {};\n',
    'src/core/kernel/composition.ts': [
      'class BaseService {}',
      'export class DerivedService extends BaseService {}',
      'export class DomainError extends Error {}',
      '',
    ].join('\n'),
  }, {}, async root => {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /\[implementation-inheritance\]/);
    assert.match(result.output, /DerivedService must compose collaborators/);
    assert.doesNotMatch(result.output, /DomainError must compose collaborators/);
  });
});

test('phase 8 rejects kernel dependencies on plugin leaf files', async () => {
  await withArchitectureFixture({
    'src/index.ts': "export { PublicValue } from './core/kernel/runtime/index.js';\n",
    'src/core/kernel/runtime/index.ts': "export { PublicValue } from '../../../plugins/runtime/src/value.js';\n",
    'src/plugins/runtime/runtime.ts': "export { PublicValue } from './src/value.js';\n",
    'src/plugins/runtime/src/value.ts': "export const PublicValue = 'runtime';\n",
    'src/plugins/runtime/runtime.yaml': 'schema: pixiecore.plugin/v1\nid: pixiecore.runtime\n',
    'src/plugins/runtime/tests/contract/runtime.test.ts': 'export {};\n',
  }, { migrationPhase: 8 }, async root => {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /\[kernel-dependency\]/);
    assert.match(result.output, /direct plugin entry points/);
  });
});

test('phase 8 prevents restoring legacy root files through the baseline', async () => {
  await withArchitectureFixture({
    'src/index.ts': 'export {};\n',
    'src/core/kernel/index.ts': 'export {};\n',
    'src/legacy.ts': 'export const legacy = true;\n',
    'src/plugins/runtime/runtime.ts': 'export {};\n',
    'src/plugins/runtime/runtime.yaml': 'schema: pixiecore.plugin/v1\nid: pixiecore.runtime\n',
    'src/plugins/runtime/src/value.ts': 'export {};\n',
    'src/plugins/runtime/tests/contract/runtime.test.ts': 'export {};\n',
  }, {
    migrationPhase: 8,
    legacySourceFiles: ['src/legacy.ts'],
  }, async root => {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /\[phase-8-legacy-baseline\]/);
    assert.match(result.output, /\[source-root-inventory\]/);
    assert.match(result.output, /src\/legacy\.ts/);
  });
});

test('phase 8 keeps the root barrel export-only and limited to public entry points', async () => {
  await withArchitectureFixture({
    'src/index.ts': [
      "export { PublicValue } from './plugins/runtime/src/value.js';",
      'const sideEffect = true;',
      'void sideEffect;',
      '',
    ].join('\n'),
    'src/core/kernel/index.ts': 'export {};\n',
    'src/plugins/runtime/runtime.ts': "export { PublicValue } from './src/value.js';\n",
    'src/plugins/runtime/src/value.ts': "export const PublicValue = 'runtime';\n",
    'src/plugins/runtime/runtime.yaml': 'schema: pixiecore.plugin/v1\nid: pixiecore.runtime\n',
    'src/plugins/runtime/tests/contract/runtime.test.ts': 'export {};\n',
  }, { migrationPhase: 8 }, async root => {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /\[root-barrel-only\]/);
    assert.match(result.output, /\[root-public-dependency\]/);
  });
});

test('phase 8 rejects external package re-exports from the root barrel', async () => {
  await withArchitectureFixture({
    'src/index.ts': [
      "export { readFile } from 'node:fs';",
      "export { externalValue } from 'external-package';",
      '',
    ].join('\n'),
  }, { migrationPhase: 8 }, async root => {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /\[root-public-dependency\]/);
    assert.match(result.output, /node:fs/);
    assert.match(result.output, /external-package/);
  });
});

test('architecture checker finds type-only cycles and inward root-barrel imports', async () => {
  await withArchitectureFixture({
    'src/index.ts': "export type { A } from './a.js';\n",
    'src/a.ts': [
      "import type { B } from './b.js';",
      'export type A = B;',
      '',
    ].join('\n'),
    'src/b.ts': [
      "import type { A } from './a.js';",
      "import type { PromptRuntime } from './index.js';",
      'export type B = A | PromptRuntime;',
      '',
    ].join('\n'),
  }, {
    legacySourceFiles: ['src/a.ts', 'src/b.ts'],
  }, async root => {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /\[dependency-cycle\]/);
    assert.match(result.output, /\[root-barrel-import\]/);
  });
});

test('architecture checker rejects a relative import that resolves outside the repository', async () => {
  await withArchitectureFixture({
    'src/index.ts': 'export {};\n',
    'src/escape.ts': '',
  }, {
    legacySourceFiles: ['src/escape.ts'],
  }, async root => {
    const outsideFile = join(dirname(root), `${basename(root)}-outside.ts`);
    try {
      await writeFile(outsideFile, 'export const outside = true;\n');
      await writeFile(
        join(root, 'src/escape.ts'),
        `import { outside } from '../../${basename(outsideFile).replace(/\.ts$/, '.js')}';\nvoid outside;\n`,
      );
      const result = await runChecker(root);
      assert.equal(result.exitCode, 1);
      assert.match(result.output, /\[source-import-escape\]/);
      assert.match(result.output, /escapes the repository/);
    } finally {
      await rm(outsideFile, { force: true });
    }
  });
});

test('architecture checker enforces all target dependency directions', async () => {
  await withArchitectureFixture({
    'src/index.ts': 'export {};\n',
    'src/core/component/bad.ts': "import type { Contract } from '../contracts/value.js';\nexport type Bad = Contract;\n",
    'src/core/contracts/value.ts': 'export interface Contract {}\n',
    'src/core/contracts/bad.ts': "import type { PluginValue } from '../../plugins/b/src/value.js';\nexport type Bad = PluginValue;\n",
    'src/core/bootstrap/bad.ts': "import type { PluginValue } from '../../plugins/b/src/value.js';\nexport type Bad = PluginValue;\n",
    'src/core/kernel/bad.ts': "import type { PluginValue } from '../../plugins/b/src/value.js';\nexport type Bad = PluginValue;\n",
    'src/plugins/a/a.ts': 'export interface OwnEntry {}\n',
    'src/plugins/a/src/bad.ts': [
      "import type { PluginValue } from '../../b/src/value.js';",
      "import type { OwnEntry } from '../a.js';",
      'export type Bad = PluginValue | OwnEntry;',
      '',
    ].join('\n'),
    'src/plugins/b/src/value.ts': 'export interface PluginValue {}\n',
  }, {}, async root => {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /\[component-dependency\]/);
    assert.match(result.output, /\[contracts-dependency\]/);
    assert.match(result.output, /\[bootstrap-dependency\]/);
    assert.match(result.output, /\[kernel-dependency\]/);
    assert.match(result.output, /\[plugin-dependency\]/);
    assert.match(result.output, /\[plugin-self-barrel\]/);
  });
});

test('architecture checker limits the kernel catalog to plugin entries and isolates plugins from kernel', async () => {
  await withArchitectureFixture({
    'src/index.ts': 'export {};\n',
    'src/core/kernel/runtime/index.ts': 'export interface Runtime {}\n',
    'src/plugins/runtime/src/value.ts': 'export const value = true;\n',
    'src/plugins/runtime/runtime.ts': [
      "import type { Runtime } from '../../core/kernel/runtime/index.js';",
      'export type Forbidden = Runtime;',
      '',
    ].join('\n'),
    'src/core/kernel/generated/core-plugin-catalog.generated.ts': [
      "import { value } from '../../../plugins/runtime/src/value.js';",
      'export const generated = value;',
      '',
    ].join('\n'),
  }, {}, async root => {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /\[kernel-dependency\]/);
    assert.match(result.output, /\[plugin-dependency\]/);
  });
});

test('architecture checker rejects unapproved computed imports', async () => {
  await withArchitectureFixture({
    'src/index.ts': 'export {};\n',
    'src/loader.ts': 'export const load = (path: string): Promise<unknown> => import(path);\n',
  }, {
    legacySourceFiles: ['src/loader.ts'],
  }, async root => {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /\[opaque-dynamic-import\]/);
  });
});

test('architecture checker requires temporary dependency exceptions to stay exact', async () => {
  const exception = {
    rule: 'bootstrap-dependency',
    from: 'src/core/bootstrap/bridge.ts',
    to: 'src/legacy.ts',
    reason: 'Removed when the legacy service becomes a contract.',
    expiresAfterPhase: 2,
  };
  await withArchitectureFixture({
    'src/index.ts': 'export {};\n',
    'src/legacy.ts': 'export interface Legacy {}\n',
    'src/core/bootstrap/bridge.ts': "import type { Legacy } from '../../legacy.js';\nexport type Bridge = Legacy;\n",
  }, {
    legacySourceFiles: ['src/legacy.ts'],
    temporaryDependencyExceptions: [exception],
  }, async root => {
    const accepted = await runChecker(root);
    assert.equal(accepted.exitCode, 0, accepted.output);

    await writeFile(join(root, 'src/core/bootstrap/bridge.ts'), 'export type Bridge = unknown;\n');
    const stale = await runChecker(root);
    assert.equal(stale.exitCode, 1);
    assert.match(stale.output, /\[stale-dependency-exception\]/);
  });
});

test('architecture checker protects examples and repository-owned custom plugins', async () => {
  await withArchitectureFixture({
    'src/index.ts': 'export {};\n',
    'examples/bad.ts': [
      "import '@pixieworks/pixiecore/internal';",
      "import '../src/index.js';",
      '',
    ].join('\n'),
    ...customPluginFixture([
      "import type { ApiOptions } from '@pixieworks/pixiecore/api';",
      "import '../../../../src/index.js';",
      'export type Options = ApiOptions;',
      '',
    ].join('\n')),
  }, {}, async root => {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /\[example-package-deep-import\]/);
    assert.match(result.output, /\[example-source-deep-import\]/);
    assert.match(result.output, /\[custom-plugin-package-deep-import\]/);
    assert.match(result.output, /\[custom-plugin-import-escape\]/);
  });
});

test('architecture checker requires Drupal-style ownership for repository custom plugins', async () => {
  await withArchitectureFixture({
    'src/index.ts': 'export {};\n',
    'custom/plugins/acme/plugin.yml': 'schema: pixiecore.plugin/v1\nid: acme.example\n',
    'custom/plugins/acme/index.ts': 'export {};\n',
  }, {}, async root => {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /\[custom-plugin-entry\]/);
    assert.match(result.output, /\[custom-plugin-manifest\]/);
    assert.match(result.output, /\[custom-plugin-source\]/);
    assert.match(result.output, /\[custom-plugin-tests\]/);
  });
});

test('architecture checker requires Drupal-style ownership for bundled example plugins', async () => {
  await withArchitectureFixture({
    'src/index.ts': 'export {};\n',
    'examples/plugin-project/custom/plugins/roles/acme/plugin.yml': [
      'schema: pixiecore.plugin/v1',
      'id: acme.example',
      '',
    ].join('\n'),
    'examples/plugin-project/custom/plugins/roles/acme/index.mjs': 'export {};\n',
  }, {}, async root => {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /\[example-custom-plugin-entry\]/);
    assert.match(result.output, /\[example-custom-plugin-manifest\]/);
    assert.match(result.output, /\[example-custom-plugin-source\]/);
    assert.match(result.output, /\[example-custom-plugin-tests\]/);
  });
});

test('architecture checker rejects the custom plugin SDK before its package export exists', async () => {
  await withArchitectureFixture({
    'src/index.ts': 'export {};\n',
    ...customPluginFixture([
      "import type { AgentRolePlugin } from '@pixieworks/pixiecore/plugin';",
      'export type Role = AgentRolePlugin;',
      '',
    ].join('\n')),
  }, {}, async root => {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /\[custom-plugin-package-deep-import\]/);
    assert.match(result.output, /pixiecore\/plugin/);
  });
});

test('architecture checker permits the custom plugin SDK after its package export exists', async () => {
  await withArchitectureFixture({
    'package.json': fixturePackageJson({ includePluginExport: true }),
    'src/index.ts': 'export {};\n',
    ...customPluginFixture([
      "import type { AgentRolePlugin } from '@pixieworks/pixiecore/plugin';",
      'export type Role = AgentRolePlugin;',
      '',
    ].join('\n')),
  }, {}, async root => {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 0, result.output);
  });
});

test('architecture checker forbids @pixieworks/pixiecore/api as a custom plugin SDK even when exported', async () => {
  await withArchitectureFixture({
    'src/index.ts': 'export {};\n',
    ...customPluginFixture([
      "import type { ApiOptions } from '@pixieworks/pixiecore/api';",
      'export type Options = ApiOptions;',
      '',
    ].join('\n')),
  }, {}, async root => {
    const result = await runChecker(root);
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /\[custom-plugin-package-deep-import\]/);
    assert.match(result.output, /declared @pixieworks\/pixiecore or @pixieworks\/pixiecore\/plugin package exports/);
  });
});

function customPluginFixture(source: string): Record<string, string> {
  return {
    'custom/plugins/acme/acme.ts': "export * from './src/index.js';\n",
    'custom/plugins/acme/acme.yaml': [
      'schema: pixiecore.plugin/v1',
      'id: acme.example',
      'entry: ./acme.js',
      '',
    ].join('\n'),
    'custom/plugins/acme/src/index.ts': source,
    'custom/plugins/acme/tests/contract/acme.test.ts': 'export {};\n',
  };
}

async function withArchitectureFixture(
  files: Record<string, string>,
  overrides: Partial<ArchitectureBaseline>,
  task: (root: string) => void | Promise<void>,
): Promise<void> {
  await withTempDirectory(async root => {
    const baseline: ArchitectureBaseline = {
      schemaVersion: 1,
      migrationPhase: 1,
      legacySourceFiles: [],
      opaqueDynamicImportFiles: [],
      temporaryDependencyExceptions: [],
      ...overrides,
    };
    const fixtureFiles: Record<string, string> = {
      'package.json': fixturePackageJson(),
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          target: 'ES2022',
        },
        include: ['src/**/*.ts'],
      }, null, 2),
      'architecture-baseline.json': JSON.stringify(baseline, null, 2),
      ...(baseline.migrationPhase >= 8 ? mandatoryRecipeFixture() : {}),
      ...files,
    };

    for (const [path, content] of Object.entries(fixtureFiles)) {
      const destination = join(root, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content);
    }
    await task(root);
  }, 'pixiecore-architecture-');
}

function mandatoryRecipeFixture(): Record<string, string> {
  return {
    'src/plugins/recipe/recipe.ts': 'export const recipe = true;\n',
    'src/plugins/recipe/recipe.yaml': [
      'schema: pixiecore.plugin/v1',
      'id: pixiecore.recipe',
      '',
    ].join('\n'),
    'src/plugins/recipe/src/value.ts': 'export const value = true;\n',
    'src/plugins/recipe/tests/contract/recipe.test.ts': 'export {};\n',
    'src/plugins/recipe/recipes/pixiecore.recipe.yaml': [
      'schema: pixiecore.recipe/v1',
      'id: pixiecore.standard',
      'locked: true',
      '',
    ].join('\n'),
  };
}

function fixturePackageJson(options: { includePluginExport?: boolean } = {}): string {
  return JSON.stringify({
    name: '@pixieworks/pixiecore',
    private: true,
    type: 'module',
    pixiecore: { plugins: './plugins' },
    exports: {
      '.': './dist/index.js',
      './api': './dist/api.js',
      ...(options.includePluginExport
        ? { './plugin': './dist/core/contracts/plugin/index.js' }
        : {}),
    },
  }, null, 2);
}

function runChecker(root: string): {
  exitCode: number;
  output: string;
} {
  const result = runArchitectureCheck({
    root,
    baseline: 'architecture-baseline.json',
  });
  return { exitCode: result.exitCode, output: result.output };
}
