import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createPluginProject } from '../../src/core/bootstrap/plugin-manager/authoring/index.js';
import {
  createPluginCatalog,
  createPluginDistributionMetadata,
  signPluginDistribution,
  verifyPluginDistribution,
} from '../../src/core/bootstrap/plugin-manager/authoring/distribution.js';
import { withTempDirectory } from '../helpers/temp.js';

test('distribution metadata binds identity, compatibility, files, provenance, and Ed25519 signature', async () => {
  await withTempDirectory(async directory => {
    const root = join(directory, 'signed-tool');
    await createPluginProject({
      directory: root,
      id: 'example.signed-tool',
      kind: 'tool',
    });
    const metadata = await createPluginDistributionMetadata(root, {
      pixiecoreVersion: '1.0.0',
      pixiecoreRange: '^1.0.0',
      provenance: {
        source: 'https://example.invalid/source.git',
        commit: '0123456789abcdef',
      },
    });
    assert.equal(metadata.plugin.id, 'example.signed-tool');
    assert.ok(Object.keys(metadata.files).includes('signed-tool.yaml'));
    assert.ok(!Object.keys(metadata.files).some(path => path.startsWith('tests/')));
    assert.ok(!Object.keys(metadata.files).some(path => /\.(?:ts|mts|cts)$/.test(path)));

    const keys = generateKeyPairSync('ed25519');
    const privateKeyPath = join(directory, 'private.pem');
    const publicKeyPath = join(directory, 'public.pem');
    await Promise.all([
      writeFile(privateKeyPath, keys.privateKey.export({ type: 'pkcs8', format: 'pem' })),
      writeFile(publicKeyPath, keys.publicKey.export({ type: 'spki', format: 'pem' })),
    ]);
    await signPluginDistribution(root, privateKeyPath);
    const verified = await verifyPluginDistribution(root, {
      pixiecoreVersion: '1.0.0',
      publicKeyPath,
      requireSignature: true,
    });
    assert.equal(verified.signature, 'verified');

    await writeFile(join(root, 'src', 'index.js'), 'export const tampered = true;\n');
    await assert.rejects(
      verifyPluginDistribution(root, { pixiecoreVersion: '1.0.0', publicKeyPath }),
      /integrity mismatch/,
    );
  });
});

test('local catalog is deterministic and rejects incompatible plugins', async () => {
  await withTempDirectory(async directory => {
    const catalogRoot = join(directory, 'catalog');
    for (const name of ['alpha', 'beta']) {
      const root = join(catalogRoot, name);
      await createPluginProject({ directory: root, id: `example.${name}`, kind: 'decorator' });
      await createPluginDistributionMetadata(root, {
        pixiecoreVersion: '1.0.0',
        pixiecoreRange: '^1.0.0',
      });
    }
    const catalog = await createPluginCatalog(catalogRoot, { pixiecoreVersion: '1.0.0' });
    assert.deepEqual(catalog.plugins.map(item => item.plugin.id), ['example.alpha', 'example.beta']);
    await assert.rejects(
      verifyPluginDistribution(join(catalogRoot, 'alpha'), { pixiecoreVersion: '2.0.0' }),
      /requires PixieCore/,
    );

    await mkdir(join(directory, 'empty'));
    assert.deepEqual(
      await createPluginCatalog(join(directory, 'empty'), { pixiecoreVersion: '1.0.0' }),
      { schema: 'pixiecore.plugin-catalog/v1', plugins: [] },
    );
    assert.ok((await readFile(join(catalogRoot, 'alpha', 'pixiecore.plugin.json'), 'utf8')).endsWith('\n'));
  });
});
