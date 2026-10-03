import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createSignedAuditExport, verifySignedAuditExport, AuditExportContractError } from '../../src/core/kernel/audit/index.js';
import type { AuditExportEvent, SignedAuditExport } from '../../src/core/kernel/audit/index.js';
import { withTempDirectory } from '../helpers/temp.js';
import { testData } from '../helpers/test-data.js';

const data = testData('signed audit export');

function auditTimestamp(label: string): string {
  return data.date(label, new Date('2020-01-01T00:00:00.000Z'), new Date('2029-12-31T23:59:59.999Z')).toISOString();
}

function auditEvent(overrides: Partial<AuditExportEvent> = {}): AuditExportEvent {
  return {
    timestamp: auditTimestamp('event timestamp'),
    trace_id: data.text('trace id'),
    source: data.text('source'),
    event: data.text('event'),
    outcome: 'succeeded',
    ...overrides,
  };
}

test('audit export signs value-free events and detects mutation or another key', async () => {
  await withTempDirectory(async directory => {
    const keys = generateKeyPairSync('ed25519');
    const other = generateKeyPairSync('ed25519');
    const privatePath = join(directory, 'private.pem');
    const publicPath = join(directory, 'public.pem');
    const otherPath = join(directory, 'other.pem');
    await Promise.all([
      writeFile(privatePath, keys.privateKey.export({ type: 'pkcs8', format: 'pem' })),
      writeFile(publicPath, keys.publicKey.export({ type: 'spki', format: 'pem' })),
      writeFile(otherPath, other.publicKey.export({ type: 'spki', format: 'pem' })),
    ]);
    const hidden = data.text('hidden audit value');
    const errorCode = data.text('error code');
    const artifact = await createSignedAuditExport({ exportId: data.text('export id'), createdAt: auditTimestamp('export timestamp'), events: [auditEvent({ outcome: 'failed', error_code: errorCode })] }, privatePath);
    assert.equal(await verifySignedAuditExport(artifact, publicPath), true);
    assert.equal(await verifySignedAuditExport({ ...artifact, export_id: hidden }, publicPath), false);
    assert.equal(await verifySignedAuditExport(artifact, otherPath), false);
    assert.doesNotMatch(JSON.stringify(artifact), new RegExp(hidden));
    assert.equal(Object.isFrozen(artifact.events), true);
    assert.equal(Object.isFrozen(artifact.events[0]), true);
    assert.equal(artifact.events[0]?.error_code, errorCode);
  });
});

test('audit export rejects values outside its strict value-free vocabulary', async () => {
  await assert.rejects(createSignedAuditExport({ exportId: '', createdAt: 'invalid', events: [] }, 'missing'), AuditExportContractError);
  await assert.rejects(createSignedAuditExport({ exportId: data.text('invalid event export id'), createdAt: auditTimestamp('invalid event export timestamp'), events: [{ ...auditEvent(), outcome: 'unknown' as never }] }, 'missing'), AuditExportContractError);

  const invalidEvents: readonly AuditExportEvent[] = [
    null as unknown as AuditExportEvent,
    { ...auditEvent(), timestamp: '2026-13-01T00:00:00.000Z' },
    { ...auditEvent(), timestamp: '2026-02-31T00:00:00.000Z' },
    { ...auditEvent(), trace_id: ' ' },
    { ...auditEvent(), source: undefined as unknown as string },
    { ...auditEvent(), event: '' },
    { ...auditEvent(), error_code: ' ' },
  ];
  for (const [index, event] of invalidEvents.entries()) {
    await assert.rejects(
      createSignedAuditExport({ exportId: data.text(`invalid export id ${index}`), createdAt: auditTimestamp(`invalid export timestamp ${index}`), events: [event] }, 'missing'),
      AuditExportContractError,
    );
  }
});

test('audit export wraps signing failures and rejects malformed signed artifacts', async () => {
  await withTempDirectory(async directory => {
    const rsaKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsaPrivatePath = join(directory, 'rsa-private.pem');
    await writeFile(rsaPrivatePath, rsaKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }));

    await assert.rejects(
      createSignedAuditExport({ exportId: data.text('rsa export id'), createdAt: auditTimestamp('rsa export timestamp'), events: [auditEvent()] }, rsaPrivatePath),
      error => error instanceof AuditExportContractError && error.cause instanceof TypeError,
    );

    const keys = generateKeyPairSync('ed25519');
    const privatePath = join(directory, 'private.pem');
    const publicPath = join(directory, 'public.pem');
    await Promise.all([
      writeFile(privatePath, keys.privateKey.export({ type: 'pkcs8', format: 'pem' })),
      writeFile(publicPath, keys.publicKey.export({ type: 'spki', format: 'pem' })),
    ]);
    const artifact = await createSignedAuditExport(
      { exportId: data.text('verification export id'), createdAt: auditTimestamp('verification export timestamp'), events: [auditEvent()] },
      privatePath,
    );
    assert.equal(await verifySignedAuditExport({ ...artifact, schema: 'unsupported' as never }, publicPath), false);
    assert.equal(await verifySignedAuditExport({ ...artifact, signature: { ...artifact.signature, algorithm: 'unsupported' as never } }, publicPath), false);
    assert.equal(await verifySignedAuditExport({ ...artifact, signature: undefined } as unknown as SignedAuditExport, publicPath), false);
    assert.equal(await verifySignedAuditExport({ ...artifact, events: [] }, publicPath), false);
  });
});
