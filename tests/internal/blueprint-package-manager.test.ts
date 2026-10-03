import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { chmod, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  BLUEPRINT_PACKAGE_FILENAME,
  installBlueprintPackage,
  readBlueprintPackageState,
  resolveEnabledBlueprintPackages,
  rollbackBlueprintPackage,
  setBlueprintPackageProvenance,
  setBlueprintPackageEnabled,
  signBlueprintPackage,
  upgradeBlueprintPackage,
  verifyBlueprintPackage,
} from '../../src/core/bootstrap/blueprint/manager.js';
import { testData } from '../helpers/test-data.js';
import { withTempDirectory } from '../helpers/temp.js';

const data = testData('blueprint package manager');
const token = data.text('publisher', 'id').split('_').at(-1)!;
const packageName = `example.${token}.travel`;
const namespace = `example.${token}`;
const blueprintId = `${namespace}.date-normalizer`;

test('Blueprint packages install idempotently and enable-disable through atomic state', async () => {
  await withTempDirectory(async directory => {
    const source = join(directory, 'source');
    const configPath = join(directory, 'consumer', 'pixiecore.blueprints.yml');
    await writePackage(source, { packageName, namespace, blueprintId, version: '1.0.0' });

    const installed = await installBlueprintPackage({
      source: join(source, BLUEPRINT_PACKAGE_FILENAME),
      configPath,
      pixiecoreVersion: '0.1.0',
      enable: true,
    });
    assert.equal(installed.enabled, true);
    assert.equal(installed.version, '1.0.0');
    assert.match(await readFile(join(installed.path, 'blueprints', 'date-normalizer.yaml'), 'utf8'), /1\.0\.0/u);
    assert.equal((await stat(configPath)).mode & 0o777, 0o600);

    const again = await installBlueprintPackage({
      source,
      configPath,
      pixiecoreVersion: '0.1.0',
    });
    assert.equal(again.path, installed.path);

    assert.equal((await setBlueprintPackageEnabled(configPath, packageName, false)).enabled, false);
    assert.deepEqual(
      await resolveEnabledBlueprintPackages(configPath, { pixiecoreVersion: '0.1.0' }),
      [],
    );
    assert.equal((await installBlueprintPackage({
      source,
      configPath,
      pixiecoreVersion: '0.1.0',
      enable: true,
    })).enabled, true);
    assert.equal(
      (await resolveEnabledBlueprintPackages(configPath, { pixiecoreVersion: '0.1.0' }))[0]
        ?.metadata.package.name,
      packageName,
    );
    const state = await readBlueprintPackageState(configPath);
    assert.deepEqual(state.packages[packageName], {
      active: '1.0.0',
      enabled: true,
      installed: ['1.0.0'],
      history: [],
    });
  });
});

test('Blueprint package upgrade retains activation and rollback restores the prior pin', async () => {
  await withTempDirectory(async directory => {
    const first = join(directory, 'v1');
    const second = join(directory, 'v2');
    const configPath = join(directory, 'consumer', 'pixiecore.blueprints.yml');
    await writePackage(first, { packageName, namespace, blueprintId, version: '1.0.0' });
    await writePackage(second, { packageName, namespace, blueprintId, version: '1.1.0' });
    await installBlueprintPackage({
      source: first,
      configPath,
      pixiecoreVersion: '0.1.0',
      enable: true,
    });
    await setBlueprintPackageEnabled(configPath, packageName, false);

    await assert.rejects(
      installBlueprintPackage({
        source: second,
        configPath,
        pixiecoreVersion: '0.1.0',
      }),
      /use upgrade for 1\.1\.0/u,
    );

    const upgraded = await upgradeBlueprintPackage({
      source: second,
      configPath,
      pixiecoreVersion: '0.1.0',
    });
    assert.equal(upgraded.operation, 'upgrade');
    assert.equal(upgraded.enabled, false);
    let entry = (await readBlueprintPackageState(configPath)).packages[packageName]!;
    assert.deepEqual(entry, {
      active: '1.1.0',
      enabled: false,
      installed: ['1.0.0', '1.1.0'],
      history: ['1.0.0'],
    });

    await assert.rejects(
      installBlueprintPackage({
        source: first,
        configPath,
        pixiecoreVersion: '0.1.0',
        enable: true,
      }),
      /use rollback or upgrade/u,
    );
    entry = await rollbackBlueprintPackage(configPath, packageName);
    assert.equal(entry.active, '1.0.0');
    assert.equal(entry.enabled, false);
    assert.deepEqual(entry.history, []);
    assert.equal((await upgradeBlueprintPackage({
      source: second,
      configPath,
      pixiecoreVersion: '0.1.0',
    })).version, '1.1.0');
    assert.equal((await rollbackBlueprintPackage(configPath, packageName)).active, '1.0.0');
    await assert.rejects(
      rollbackBlueprintPackage(configPath, packageName),
      /has no rollback version/u,
    );
    await assert.rejects(
      upgradeBlueprintPackage({
        source: first,
        configPath,
        pixiecoreVersion: '0.1.0',
      }),
      /must be newer than 1\.0\.0/u,
    );
  });
});

test('Blueprint package verification rejects integrity, compatibility, missing sources, and ID collisions', async () => {
  await withTempDirectory(async directory => {
    const source = join(directory, 'source');
    const configPath = join(directory, 'consumer', 'pixiecore.blueprints.yml');
    await writePackage(source, { packageName, namespace, blueprintId, version: '1.0.0' });
    await assert.rejects(
      verifyBlueprintPackage(source, { pixiecoreVersion: '1.0.0' }),
      /requires PixieCore \^0\.1\.0/u,
    );

    await installBlueprintPackage({ source, configPath, pixiecoreVersion: '0.1.0' });
    const colliding = join(directory, 'colliding');
    await writePackage(colliding, {
      packageName: `${namespace}.alternative`,
      namespace,
      blueprintId,
      version: '1.0.0',
    });
    await assert.rejects(
      installBlueprintPackage({ source: colliding, configPath, pixiecoreVersion: '0.1.0' }),
      /Blueprint id collision/u,
    );

    await writeFile(join(source, 'blueprints', 'date-normalizer.yaml'), 'tampered: true\n');
    await assert.rejects(
      verifyBlueprintPackage(source, { pixiecoreVersion: '0.1.0' }),
      /integrity mismatch/u,
    );

    const nonFile = join(directory, 'non-file');
    await mkdir(nonFile);
    await writeFile(join(nonFile, BLUEPRINT_PACKAGE_FILENAME), '{}\n');
    await chmod(join(nonFile, BLUEPRINT_PACKAGE_FILENAME), 0o600);
    await assert.rejects(
      verifyBlueprintPackage(join(nonFile, 'missing'), { pixiecoreVersion: '0.1.0' }),
      /Cannot resolve Blueprint package source/u,
    );
  });
});

test('Blueprint package state rejects package names that could escape the managed root', async () => {
  await withTempDirectory(async directory => {
    const configPath = join(directory, 'pixiecore.blueprints.yml');
    await writeFile(configPath, [
      'schema: pixiecore.blueprint-packages/v1',
      'packages:',
      '  "../escape":',
      '    active: 1.0.0',
      '    enabled: true',
      '    installed: [1.0.0]',
      '    history: []',
      '',
    ].join('\n'));
    await assert.rejects(
      readBlueprintPackageState(configPath),
      /invalid package name/u,
    );
  });
});

test('Blueprint package verification covers schema, inventory, identity, and Blueprint failures', async () => {
  await withTempDirectory(async directory => {
    const invalidMetadata = join(directory, 'invalid-metadata');
    await mkdir(invalidMetadata);
    await writeFile(join(invalidMetadata, BLUEPRINT_PACKAGE_FILENAME), '{}\n');
    await assert.rejects(
      verifyBlueprintPackage(invalidMetadata, { pixiecoreVersion: '0.1.0' }),
      /Invalid Blueprint package metadata/u,
    );
    await writeFile(join(invalidMetadata, BLUEPRINT_PACKAGE_FILENAME), '{invalid json\n');
    await assert.rejects(
      verifyBlueprintPackage(invalidMetadata, { pixiecoreVersion: '0.1.0' }),
      /Failed to read Blueprint package metadata/u,
    );

    const extraFile = join(directory, 'extra-file');
    await writePackage(extraFile, { packageName, namespace, blueprintId, version: '1.0.0' });
    await writeFile(join(extraFile, 'undeclared.txt'), data.text('undeclared file'));
    await assert.rejects(
      verifyBlueprintPackage(extraFile, { pixiecoreVersion: '0.1.0' }),
      /file inventory does not match/u,
    );

    const linkedFile = join(directory, 'linked-file');
    await writePackage(linkedFile, { packageName, namespace, blueprintId, version: '1.0.0' });
    await symlink(join(linkedFile, 'blueprints', 'date-normalizer.yaml'), join(linkedFile, 'linked.yaml'));
    await assert.rejects(
      verifyBlueprintPackage(linkedFile, { pixiecoreVersion: '0.1.0' }),
      /may not contain symbolic links/u,
    );

    const wrongNamespace = join(directory, 'wrong-namespace');
    await writePackage(wrongNamespace, { packageName, namespace, blueprintId, version: '1.0.0' });
    const wrongNamespaceMetadata = await readMetadata(wrongNamespace);
    wrongNamespaceMetadata.package.namespace = 'example.unrelated';
    await writeMetadata(wrongNamespace, wrongNamespaceMetadata);
    await assert.rejects(
      verifyBlueprintPackage(wrongNamespace, { pixiecoreVersion: '0.1.0' }),
      /must belong to package namespace/u,
    );

    const duplicateId = join(directory, 'duplicate-id');
    await writePackage(duplicateId, { packageName, namespace, blueprintId, version: '1.0.0' });
    const duplicateMetadata = await readMetadata(duplicateId);
    duplicateMetadata.blueprints.push({ ...duplicateMetadata.blueprints[0]! });
    await writeMetadata(duplicateId, duplicateMetadata);
    await assert.rejects(
      verifyBlueprintPackage(duplicateId, { pixiecoreVersion: '0.1.0' }),
      /Duplicate Blueprint id/u,
    );

    const missingBlueprintInventory = join(directory, 'missing-blueprint-inventory');
    await writePackage(missingBlueprintInventory, { packageName, namespace, blueprintId, version: '1.0.0' });
    const missingInventoryMetadata = await readMetadata(missingBlueprintInventory);
    missingInventoryMetadata.blueprints[0]!.path = BLUEPRINT_PACKAGE_FILENAME;
    await writeMetadata(missingBlueprintInventory, missingInventoryMetadata);
    await assert.rejects(
      verifyBlueprintPackage(missingBlueprintInventory, { pixiecoreVersion: '0.1.0' }),
      /inventory is missing declared Blueprint/u,
    );

    const invalidBlueprint = join(directory, 'invalid-blueprint');
    await writePackage(invalidBlueprint, { packageName, namespace, blueprintId, version: '1.0.0' });
    await replaceBlueprint(invalidBlueprint, 'version: 1.0.0\n');
    await assert.rejects(
      verifyBlueprintPackage(invalidBlueprint, { pixiecoreVersion: '0.1.0' }),
      /Invalid packaged Blueprint/u,
    );

    const mismatchedVersion = join(directory, 'mismatched-version');
    await writePackage(mismatchedVersion, { packageName, namespace, blueprintId, version: '1.0.0' });
    const mismatchedMetadata = await readMetadata(mismatchedVersion);
    mismatchedMetadata.blueprints[0]!.version = '2.0.0';
    await writeMetadata(mismatchedVersion, mismatchedMetadata);
    await assert.rejects(
      verifyBlueprintPackage(mismatchedVersion, { pixiecoreVersion: '0.1.0' }),
      /version does not match metadata/u,
    );

    const optionalCompatibility = join(directory, 'optional-compatibility');
    await writePackage(optionalCompatibility, { packageName, namespace, blueprintId, version: '1.0.0' });
    const optionalMetadata = await readMetadata(optionalCompatibility);
    delete optionalMetadata.compatibility.pixiecore;
    await writeMetadata(optionalCompatibility, optionalMetadata);
    assert.equal(
      (await verifyBlueprintPackage(optionalCompatibility, { pixiecoreVersion: '9.0.0' }))
        .metadata.package.name,
      packageName,
    );
    await assert.rejects(
      verifyBlueprintPackage(optionalCompatibility, {
        pixiecoreVersion: '9.0.0',
        popVersion: '9.0.0',
      }),
      /requires POP \^0\.1\.0/u,
    );
    await assert.rejects(
      verifyBlueprintPackage(wrongNamespace, { pixiecoreVersion: 'invalid' }),
      /Invalid PixieCore compatibility/u,
    );

    const ordinaryFile = join(directory, 'ordinary.json');
    await writeFile(ordinaryFile, '{}\n');
    await assert.rejects(
      verifyBlueprintPackage(ordinaryFile, { pixiecoreVersion: '0.1.0' }),
      /must be a directory or/u,
    );
    const sourceLink = join(directory, 'source-link');
    await symlink(optionalCompatibility, sourceLink);
    await assert.rejects(
      verifyBlueprintPackage(sourceLink, { pixiecoreVersion: '0.1.0' }),
      /source may not be a symbolic link/u,
    );
  });
});

test('Blueprint package lifecycle rejects absent state, occupied targets, and changed same-version metadata', async () => {
  await withTempDirectory(async directory => {
    const source = join(directory, 'source');
    const configPath = join(directory, 'consumer', 'pixiecore.blueprints.yml');
    await writePackage(source, { packageName, namespace, blueprintId, version: '1.0.0' });
    await assert.rejects(
      upgradeBlueprintPackage({ source, configPath, pixiecoreVersion: '0.1.0' }),
      /is not installed/u,
    );
    await assert.rejects(
      setBlueprintPackageEnabled(configPath, packageName, true),
      /is not installed/u,
    );

    const occupiedConfig = join(directory, 'occupied', 'pixiecore.blueprints.yml');
    const occupiedTarget = join(
      directory,
      'occupied',
      'blueprints',
      'packages',
      ...packageName.split('.'),
      '1.0.0',
    );
    await mkdir(occupiedTarget, { recursive: true });
    await assert.rejects(
      installBlueprintPackage({
        source,
        configPath: occupiedConfig,
        pixiecoreVersion: '0.1.0',
      }),
      /target already exists/u,
    );

    await installBlueprintPackage({ source, configPath, pixiecoreVersion: '0.1.0' });
    const metadata = await readMetadata(source);
    metadata.package.license = 'MIT';
    await writeMetadata(source, metadata);
    await assert.rejects(
      installBlueprintPackage({ source, configPath, pixiecoreVersion: '0.1.0' }),
      /different contents/u,
    );

    const unreadableState = join(directory, 'state-directory');
    await mkdir(unreadableState);
    await assert.rejects(
      readBlueprintPackageState(unreadableState),
      /Failed to read Blueprint package state/u,
    );
  });
});

test('Blueprint packages bind provenance and Ed25519 signatures to a pinned publisher', async () => {
  await withTempDirectory(async directory => {
    const first = join(directory, 'signed-v1');
    const second = join(directory, 'signed-v2');
    const unsigned = join(directory, 'unsigned-v3');
    const configPath = join(directory, 'consumer', 'pixiecore.blueprints.yml');
    const keys = await writeKeyPair(directory, 'publisher');
    const otherKeys = await writeKeyPair(directory, 'other-publisher');
    await writePackage(first, { packageName, namespace, blueprintId, version: '1.0.0' });
    await setBlueprintPackageProvenance(first, {
      source: 'https://example.invalid/publisher/travel-blueprints.git',
      commit: '0123456789abcdef',
    }, { pixiecoreVersion: '0.1.0' });
    const signed = await signBlueprintPackage(first, keys.privateKeyPath, {
      pixiecoreVersion: '0.1.0',
    });
    assert.equal(signed.provenance?.commit, '0123456789abcdef');
    assert.equal((await verifyBlueprintPackage(first, {
      pixiecoreVersion: '0.1.0',
      publicKeyPath: keys.publicKeyPath,
      requireSignature: true,
    })).signature, 'verified');
    await assert.rejects(
      verifyBlueprintPackage(first, {
        pixiecoreVersion: '0.1.0',
        publicKeyPath: otherKeys.publicKeyPath,
      }),
      /key ID does not match/u,
    );

    const installed = await installBlueprintPackage({
      source: first,
      configPath,
      pixiecoreVersion: '0.1.0',
      publicKeyPath: keys.publicKeyPath,
      requireSignature: true,
      enable: true,
    });
    assert.equal(installed.signature, 'verified');
    const publisherKeyId = signed.signature?.keyId;
    assert.equal((await readBlueprintPackageState(configPath)).packages[packageName]?.publisherKeyId, publisherKeyId);

    const otherPackage = join(directory, 'other-signed-package');
    const otherPackageName = `${namespace}.other-package`;
    await writePackage(otherPackage, {
      packageName: otherPackageName,
      namespace,
      blueprintId: `${namespace}.other-blueprint`,
      version: '1.0.0',
    });
    await signBlueprintPackage(otherPackage, otherKeys.privateKeyPath, { pixiecoreVersion: '0.1.0' });
    assert.equal((await installBlueprintPackage({
      source: otherPackage,
      configPath,
      pixiecoreVersion: '0.1.0',
      publicKeyPath: otherKeys.publicKeyPath,
      requireSignature: true,
    })).signature, 'verified');

    await writePackage(second, { packageName, namespace, blueprintId, version: '1.1.0' });
    await signBlueprintPackage(second, keys.privateKeyPath, { pixiecoreVersion: '0.1.0' });
    const upgraded = await upgradeBlueprintPackage({
      source: second,
      configPath,
      pixiecoreVersion: '0.1.0',
      publicKeyPath: keys.publicKeyPath,
      requireSignature: true,
    });
    assert.equal(upgraded.signature, 'verified');
    assert.equal((await rollbackBlueprintPackage(configPath, packageName)).publisherKeyId, publisherKeyId);

    await writePackage(unsigned, { packageName, namespace, blueprintId, version: '1.2.0' });
    await assert.rejects(
      upgradeBlueprintPackage({ source: unsigned, configPath, pixiecoreVersion: '0.1.0' }),
      /requires the pinned publisher key/u,
    );
    await signBlueprintPackage(unsigned, otherKeys.privateKeyPath, { pixiecoreVersion: '0.1.0' });
    await assert.rejects(
      upgradeBlueprintPackage({
        source: unsigned,
        configPath,
        pixiecoreVersion: '0.1.0',
        publicKeyPath: otherKeys.publicKeyPath,
      }),
      /requires the pinned publisher key/u,
    );

    const tampered = await readMetadata(first);
    tampered.package.license = 'MIT';
    await writeMetadata(first, tampered);
    await assert.rejects(
      verifyBlueprintPackage(first, {
        pixiecoreVersion: '0.1.0',
        publicKeyPath: keys.publicKeyPath,
      }),
      /signature is invalid/u,
    );
  });
});

test('Blueprint package dependencies constrain enable, disable, and rollback transitions', async () => {
  await withTempDirectory(async directory => {
    const dependencyV1 = join(directory, 'dependency-v1');
    const dependencyV2 = join(directory, 'dependency-v2');
    const consumer = join(directory, 'consumer-package');
    const configPath = join(directory, 'consumer', 'pixiecore.blueprints.yml');
    const dependencyName = `example.${token}.shared`;
    await writePackage(dependencyV1, {
      packageName: dependencyName,
      namespace,
      blueprintId: `${namespace}.shared-v1`,
      version: '1.0.0',
    });
    await writePackage(dependencyV2, {
      packageName: dependencyName,
      namespace,
      blueprintId: `${namespace}.shared-v2`,
      version: '2.0.0',
    });
    await writePackage(consumer, { packageName, namespace, blueprintId, version: '1.0.0' }, {
      [dependencyName]: '^2.0.0',
    });

    await assert.rejects(
      installBlueprintPackage({ source: consumer, configPath, pixiecoreVersion: '0.1.0' }),
      /requires missing dependency/u,
    );
    await installBlueprintPackage({
      source: dependencyV1,
      configPath,
      pixiecoreVersion: '0.1.0',
      enable: true,
    });
    await assert.rejects(
      installBlueprintPackage({ source: consumer, configPath, pixiecoreVersion: '0.1.0' }),
      /active 1\.0\.0/u,
    );
    await upgradeBlueprintPackage({ source: dependencyV2, configPath, pixiecoreVersion: '0.1.0' });
    await installBlueprintPackage({
      source: consumer,
      configPath,
      pixiecoreVersion: '0.1.0',
      enable: true,
    });
    await assert.rejects(
      setBlueprintPackageEnabled(configPath, dependencyName, false),
      /enabled package .* depends on it/u,
    );
    await assert.rejects(
      rollbackBlueprintPackage(configPath, dependencyName),
      /requires .* target 1\.0\.0/u,
    );
    await setBlueprintPackageEnabled(configPath, packageName, false);
    assert.equal((await setBlueprintPackageEnabled(configPath, dependencyName, false)).enabled, false);
    await assert.rejects(
      setBlueprintPackageEnabled(configPath, packageName, true),
      /requires enabled dependency/u,
    );
  });
});

test('Blueprint package metadata rejects invalid provenance and dependency declarations', async () => {
  await withTempDirectory(async directory => {
    const source = join(directory, 'source');
    await writePackage(source, { packageName, namespace, blueprintId, version: '1.0.0' });
    await assert.rejects(
      setBlueprintPackageProvenance(source, { source: '  ' }, { pixiecoreVersion: '0.1.0' }),
      /source must be non-empty/u,
    );
    await assert.rejects(
      setBlueprintPackageProvenance(source, { commit: 'not-hex' }, { pixiecoreVersion: '0.1.0' }),
      /commit must be a hexadecimal revision/u,
    );
    const metadata = await readMetadata(source);
    metadata.dependencies = { [packageName]: '^1.0.0' };
    await writeMetadata(source, metadata);
    await assert.rejects(
      verifyBlueprintPackage(source, { pixiecoreVersion: '0.1.0' }),
      /may not depend on itself/u,
    );
    metadata.dependencies = { [`${namespace}.other`]: 'not-a-range' };
    await writeMetadata(source, metadata);
    await assert.rejects(
      verifyBlueprintPackage(source, { pixiecoreVersion: '0.1.0' }),
      /Invalid Blueprint package dependency range/u,
    );
  });
});

test('Blueprint package state rejects malformed and internally inconsistent entries', async () => {
  await withTempDirectory(async directory => {
    const configPath = join(directory, 'pixiecore.blueprints.yml');
    const entry = (overrides: readonly string[] = []): string => [
      'schema: pixiecore.blueprint-packages/v1',
      'packages:',
      `  ${packageName}:`,
      '    active: 1.0.0',
      '    enabled: true',
      '    installed: [1.0.0]',
      '    history: []',
      ...overrides,
      '',
    ].join('\n');
    const invalidStates = [
      '[]\n',
      'schema: wrong\npackages: {}\n',
      'schema: pixiecore.blueprint-packages/v1\npackages: {}\nextra: true\n',
      `schema: pixiecore.blueprint-packages/v1\npackages:\n  ${packageName}: invalid\n`,
      entry(['    extra: true']),
      entry().replace('active: 1.0.0', 'active: ""'),
      entry().replace('enabled: true', 'enabled: yes'),
      entry().replace('installed: [1.0.0]', 'installed: invalid'),
      entry().replace('installed: [1.0.0]', 'installed: [invalid]'),
      entry().replace('installed: [1.0.0]', 'installed: [1.0.0, 1.0.0]'),
      entry().replace('active: 1.0.0', 'active: 2.0.0'),
      entry().replace('history: []', 'history: [2.0.0]'),
      'schema: pixiecore.blueprint-packages/v1\nschema: duplicate\npackages: {}\n',
    ];
    for (const [index, source] of invalidStates.entries()) {
      await writeFile(configPath, source);
      await assert.rejects(
        readBlueprintPackageState(configPath),
        `invalid state ${index}`,
      );
    }
  });
});

interface PackageFixture {
  readonly packageName: string;
  readonly namespace: string;
  readonly blueprintId: string;
  readonly version: string;
}

interface MutablePackageMetadata {
  schema: string;
  package: { name: string; namespace: string; version: string; license: string };
  compatibility: { pop: string; pixiecore?: string };
  blueprints: Array<{ id: string; version: string; path: string }>;
  files: Record<string, string>;
  dependencies?: Record<string, string>;
  provenance?: { source?: string; commit?: string };
  signature?: { algorithm: 'Ed25519'; keyId: string; value: string };
}

async function writePackage(
  root: string,
  fixture: PackageFixture,
  dependencies?: Readonly<Record<string, string>>,
): Promise<void> {
  const blueprintPath = join(root, 'blueprints', 'date-normalizer.yaml');
  await mkdir(join(root, 'blueprints'), { recursive: true });
  const blueprint = [
    `name: ${data.text(`name ${fixture.packageName} ${fixture.version}`, 'Blueprint')}`,
    `version: ${fixture.version}`,
    'role: converter',
    'prompt: Convert {value} to an ISO date.',
    'input_placeholders:',
    '  - value',
    'output_schema:',
    '  type: object',
    '  required: [date]',
    '  properties:',
    '    date:',
    '      type: string',
    '',
  ].join('\n');
  await writeFile(blueprintPath, blueprint);
  const checksum = `sha256-${createHash('sha256').update(blueprint).digest('base64')}`;
  await writeFile(join(root, BLUEPRINT_PACKAGE_FILENAME), `${JSON.stringify({
    schema: 'pixiecore.blueprint-package/v1',
    package: {
      name: fixture.packageName,
      namespace: fixture.namespace,
      version: fixture.version,
      license: 'Apache-2.0',
    },
    compatibility: { pop: '^0.1.0', pixiecore: '^0.1.0' },
    blueprints: [{
      id: fixture.blueprintId,
      version: fixture.version,
      path: 'blueprints/date-normalizer.yaml',
    }],
    files: { 'blueprints/date-normalizer.yaml': checksum },
    ...(dependencies === undefined ? {} : { dependencies }),
  }, null, 2)}\n`);
}

async function writeKeyPair(
  directory: string,
  name: string,
): Promise<{ readonly privateKeyPath: string; readonly publicKeyPath: string }> {
  const keys = generateKeyPairSync('ed25519');
  const privateKeyPath = join(directory, `${name}-private.pem`);
  const publicKeyPath = join(directory, `${name}-public.pem`);
  await Promise.all([
    writeFile(privateKeyPath, keys.privateKey.export({ type: 'pkcs8', format: 'pem' })),
    writeFile(publicKeyPath, keys.publicKey.export({ type: 'spki', format: 'pem' })),
  ]);
  return { privateKeyPath, publicKeyPath };
}

async function readMetadata(root: string): Promise<MutablePackageMetadata> {
  return JSON.parse(await readFile(join(root, BLUEPRINT_PACKAGE_FILENAME), 'utf8')) as MutablePackageMetadata;
}

async function writeMetadata(root: string, metadata: MutablePackageMetadata): Promise<void> {
  await writeFile(join(root, BLUEPRINT_PACKAGE_FILENAME), `${JSON.stringify(metadata, null, 2)}\n`);
}

async function replaceBlueprint(root: string, source: string): Promise<void> {
  await writeFile(join(root, 'blueprints', 'date-normalizer.yaml'), source);
  const metadata = await readMetadata(root);
  metadata.files['blueprints/date-normalizer.yaml'] = `sha256-${createHash('sha256').update(source).digest('base64')}`;
  await writeMetadata(root, metadata);
}
