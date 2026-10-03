import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { ConfigurationError } from '../../src/core/contracts/errors/index.js';
import { discoverRuntimeEnvironment } from '../../src/core/bootstrap/config/environment-discovery.js';
import { resolvePixieCorePackageRoot } from '../../src/core/bootstrap/config/package-root.js';
import { withTempDirectory } from '../helpers/temp.js';

test('owning package discovery walks upward from source and dist modules without using cwd', async () => {
  await withTempDirectory(async root => {
    const sourceModule = join(root, 'src', 'core', 'bootstrap', 'config', 'runtime-config.ts');
    const distModule = join(root, 'dist', 'core', 'bootstrap', 'config', 'runtime-config.js');
    await Promise.all([
      mkdir(dirname(sourceModule), { recursive: true }),
      mkdir(dirname(distModule), { recursive: true }),
      writeFile(join(root, 'package.json'), JSON.stringify({ name: '@pixieworks/pixiecore' }), 'utf8'),
    ]);

    assert.equal(resolvePixieCorePackageRoot(pathToFileURL(sourceModule)), root);
    assert.equal(resolvePixieCorePackageRoot(pathToFileURL(distModule)), root);
  });
});

test('owning package discovery validates the nearest package boundary', async () => {
  await withTempDirectory(async root => {
    const nestedRoot = join(root, 'nested');
    const modulePath = join(nestedRoot, 'src', 'module.ts');
    await mkdir(dirname(modulePath), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@pixieworks/pixiecore' }), 'utf8');
    await writeFile(join(nestedRoot, 'package.json'), JSON.stringify({ name: 'another-package' }), 'utf8');

    assert.throws(
      () => resolvePixieCorePackageRoot(pathToFileURL(modulePath)),
      (error: unknown) => error instanceof ConfigurationError
        && error.code === 'configuration_error'
        && /another-package/.test(error.message),
    );
  });
});

test('owning package discovery rejects invalid and missing manifests', async () => {
  await withTempDirectory(async root => {
    const invalidModule = join(root, 'invalid', 'src', 'module.ts');
    const missingModule = join(root, 'missing', 'src', 'module.ts');
    await Promise.all([
      mkdir(dirname(invalidModule), { recursive: true }),
      mkdir(dirname(missingModule), { recursive: true }),
    ]);
    await writeFile(join(root, 'invalid', 'package.json'), '{', 'utf8');

    assert.throws(
      () => resolvePixieCorePackageRoot(pathToFileURL(invalidModule)),
      (error: unknown) => error instanceof ConfigurationError && /Invalid PixieCore package manifest/.test(error.message),
    );
    assert.throws(
      () => resolvePixieCorePackageRoot(pathToFileURL(missingModule)),
      (error: unknown) => error instanceof ConfigurationError && /Could not find the owning PixieCore package/.test(error.message),
    );
  });
});

test('environment discovery preserves cwd, package, explicit-file, and process precedence', async () => {
  await withTempDirectory(async root => {
    const workingDirectory = join(root, 'working');
    const packageRoot = join(root, 'package');
    const explicitFile = join(root, 'explicit.env');
    await Promise.all([mkdir(workingDirectory), mkdir(packageRoot)]);
    await Promise.all([
      writeFile(join(workingDirectory, '.env'), [
        'CWD_ONLY=cwd',
        'PACKAGE_OVER_CWD=cwd',
        'EXPLICIT_OVER_PACKAGE=cwd',
        'PROCESS_OVER_EXPLICIT=cwd',
      ].join('\n'), 'utf8'),
      writeFile(join(packageRoot, '.env'), [
        'PACKAGE_ONLY=package',
        'PACKAGE_OVER_CWD=package',
        'EXPLICIT_OVER_PACKAGE=package',
        'PROCESS_OVER_EXPLICIT=package',
      ].join('\n'), 'utf8'),
      writeFile(explicitFile, [
        'EXPLICIT_ONLY=explicit',
        'EXPLICIT_OVER_PACKAGE=explicit',
        'PROCESS_OVER_EXPLICIT=explicit',
      ].join('\n'), 'utf8'),
    ]);
    const processEnvironment: NodeJS.ProcessEnv = {
      PROMPT_RUNTIME_ENV_FILE: explicitFile,
      PROCESS_ONLY: 'process',
      PROCESS_OVER_EXPLICIT: 'process',
    };

    const discovered = discoverRuntimeEnvironment({
      workingDirectory,
      packageRoot,
      environment: processEnvironment,
    });

    assert.equal(discovered.CWD_ONLY, 'cwd');
    assert.equal(discovered.PACKAGE_ONLY, 'package');
    assert.equal(discovered.PACKAGE_OVER_CWD, 'package');
    assert.equal(discovered.EXPLICIT_ONLY, 'explicit');
    assert.equal(discovered.EXPLICIT_OVER_PACKAGE, 'explicit');
    assert.equal(discovered.PROCESS_ONLY, 'process');
    assert.equal(discovered.PROCESS_OVER_EXPLICIT, 'process');
    assert.equal(processEnvironment.CWD_ONLY, undefined);
  });
});

test('environment discovery requires a configured explicit file but ignores absent defaults', async () => {
  await withTempDirectory(async root => {
    assert.deepEqual(discoverRuntimeEnvironment({
      workingDirectory: join(root, 'missing-working'),
      packageRoot: join(root, 'missing-package'),
      environment: {},
    }), {});

    const missing = join(root, 'missing.env');
    assert.throws(
      () => discoverRuntimeEnvironment({
        workingDirectory: join(root, 'missing-working'),
        packageRoot: join(root, 'missing-package'),
        environment: { PROMPT_RUNTIME_ENV_FILE: missing },
      }),
      (error: unknown) => error instanceof ConfigurationError
        && error.message === `Environment file not found: ${missing}`,
    );
  });
});
