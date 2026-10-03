import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import {
  DATA_RETENTION_RECORD_SCHEMA,
  DataPolicyBoundary,
  DataPolicyContractError,
  DataPolicyDeniedError,
  DataRetentionExpiredError,
  TenantIsolationError,
  createDiscardDataPolicy,
  type DataPolicyDecision,
  type DataPolicyEvaluationRequest,
  type DataPolicyPort,
} from '../../src/core/kernel/data-policy/index.js';
import { testData } from '../helpers/test-data.js';

const data = testData('data policy');
const schema = JSON.parse(await readFile(fileURLToPath(new URL(
  '../../schemas/pixiecore.data-retention-record-v1.schema.json',
  import.meta.url,
)), 'utf8')) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const createdAt = new Date('2026-08-25T12:00:00.000Z');

test('policy sees metadata and paths but not values, then redacts an expiring tenant record', async () => {
  const tenantId = data.text('tenant ID', 'tenant');
  const email = `${data.text('email local', 'user')}@example.test`;
  const secret = data.text('private account value', 'secret');
  const payload = {
    profile: { email, account: secret },
    notes: [data.text('public note'), data.text('private note')],
    'slash/key': data.text('escaped pointer value'),
  };
  let observed: DataPolicyEvaluationRequest | undefined;
  const policy: DataPolicyPort = {
    evaluate(request) {
      observed = request;
      return {
        policy_id: 'example.retention',
        policy_version: '2.1.0',
        disposition: 'retain',
        redact_paths: ['/notes/1', '/profile/account', '/profile/email', '/slash~1key'],
        retention_seconds: 3_600,
        reason_codes: ['business_record'],
      };
    },
  };
  const boundary = new DataPolicyBoundary({
    tenantId,
    policy,
    now: () => new Date(createdAt),
    createRecordId: () => data.text('record ID', 'record'),
  });
  const record = await boundary.prepareRetention({
    stage: 'input',
    blueprintId: 'example.contact_extractor',
    blueprintVersion: '1.2.0',
    classification: 'confidential',
    pii: [
      { path: '/profile/email', category: 'email_address' },
      { path: '/profile/account', category: 'account_identifier' },
    ],
    payload,
  });

  assert.ok(observed);
  assert.equal(observed.tenant_id, tenantId);
  assert.deepEqual(observed.pii, [
    { path: '/profile/account', category: 'account_identifier' },
    { path: '/profile/email', category: 'email_address' },
  ]);
  assert.ok(observed.field_paths.includes('/slash~1key'));
  assert.equal(Object.isFrozen(observed), true);
  assert.equal(Object.isFrozen(observed.field_paths), true);
  assert.doesNotMatch(JSON.stringify(observed), new RegExp(email));
  assert.doesNotMatch(JSON.stringify(observed), new RegExp(secret));

  assert.equal(record.schema, DATA_RETENTION_RECORD_SCHEMA);
  assert.equal(record.tenant_id, tenantId);
  assert.equal(record.expires_at, '2026-08-25T13:00:00.000Z');
  assert.deepEqual(record.pii_categories, ['account_identifier', 'email_address']);
  assert.deepEqual(record.payload, {
    profile: { email: '[REDACTED]', account: '[REDACTED]' },
    notes: [payload.notes[0], '[REDACTED]'],
    'slash/key': '[REDACTED]',
  });
  assert.equal(payload.profile.email, email);
  assert.equal(payload.profile.account, secret);
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.payload), true);
  assert.equal(validate(record), true, JSON.stringify(validate.errors));
  assert.deepEqual(boundary.readPayload(record), record.payload);
  assert.notEqual(boundary.readPayload(record), record.payload);
});

test('default policy discards payload and reports no implicit retention', async () => {
  const boundary = new DataPolicyBoundary({
    tenantId: data.text('discard tenant', 'tenant'),
    policy: createDiscardDataPolicy(),
    now: () => new Date(createdAt),
    createRecordId: () => data.text('discard record', 'record'),
  });
  const record = await boundary.prepareRetention({
    stage: 'output',
    blueprintId: 'example.validator',
    blueprintVersion: '1.0.0',
    classification: 'internal',
    payload: { value: data.text('discarded value') },
  });
  assert.equal(record.disposition, 'discard');
  assert.equal(record.payload, null);
  assert.equal(record.expires_at, null);
  assert.deepEqual(record.redacted_paths, []);
  assert.deepEqual(record.reason_codes, ['default_discard']);
  assert.equal(boundary.readPayload(record), null);
  assert.equal(validate(record), true, JSON.stringify(validate.errors));
});

test('deny decisions fail closed without exposing payload values', async () => {
  const privateValue = data.text('denied payload', 'private');
  const boundary = new DataPolicyBoundary({
    tenantId: data.text('denied tenant', 'tenant'),
    policy: {
      async evaluate() {
        return {
          policy_id: 'example.deny',
          policy_version: '1.0.0',
          disposition: 'deny',
          reason_codes: ['pii_not_permitted'],
        };
      },
    },
  });
  await assert.rejects(boundary.prepareRetention({
    stage: 'input',
    blueprintId: 'example.denied',
    blueprintVersion: '1.0.0',
    classification: 'restricted',
    payload: { privateValue },
  }), error => {
    assert.ok(error instanceof DataPolicyDeniedError);
    assert.deepEqual(error.reasonCodes, ['pii_not_permitted']);
    assert.doesNotMatch(error.message, new RegExp(privateValue));
    return true;
  });
});

test('tenant and expiry checks run before returning retained payload', async () => {
  let now = new Date(createdAt);
  const owner = new DataPolicyBoundary({
    tenantId: 'tenant-owner',
    policy: retainPolicy(),
    now: () => new Date(now),
    createRecordId: () => 'record-owner',
  });
  const record = await owner.prepareRetention({
    stage: 'output',
    blueprintId: 'example.output',
    blueprintVersion: '1.0.0',
    classification: 'internal',
    payload: { result: data.text('tenant result') },
  });
  const other = new DataPolicyBoundary({
    tenantId: 'tenant-other',
    policy: createDiscardDataPolicy(),
    now: () => new Date(now),
  });
  assert.throws(() => other.readPayload(record), TenantIsolationError);
  now = new Date('2026-08-25T12:01:00.000Z');
  assert.throws(() => owner.readPayload(record), DataRetentionExpiredError);
});

test('policy contracts reject undeclared PII, unsafe redaction, and ambiguous decisions', async () => {
  const base = {
    stage: 'input' as const,
    blueprintId: 'example.policy',
    blueprintVersion: '1.0.0',
    classification: 'internal',
    payload: { profile: { email: 'user@example.test' } },
  };
  const invalidDecisions: readonly DataPolicyDecision[] = [
    { policy_id: '', policy_version: '1', disposition: 'discard', reason_codes: ['reason'] },
    { policy_id: 'p', policy_version: '1', disposition: 'retain', reason_codes: ['reason'] },
    { policy_id: 'p', policy_version: '1', disposition: 'discard', retention_seconds: 10, reason_codes: ['reason'] },
    { policy_id: 'p', policy_version: '1', disposition: 'deny', redact_paths: ['/profile'], reason_codes: ['reason'] },
    { policy_id: 'p', policy_version: '1', disposition: 'retain', retention_seconds: 10, redact_paths: ['/missing'], reason_codes: ['reason'] },
    { policy_id: 'p', policy_version: '1', disposition: 'retain', retention_seconds: 10, redact_paths: ['/profile', '/profile/email'], reason_codes: ['reason'] },
    { policy_id: 'p', policy_version: '1', disposition: 'retain', retention_seconds: 10, reason_codes: [] },
  ];
  for (const decision of invalidDecisions) {
    const boundary = new DataPolicyBoundary({ tenantId: 'tenant', policy: { evaluate: () => decision } });
    await assert.rejects(boundary.prepareRetention(base), DataPolicyContractError);
  }

  const boundary = new DataPolicyBoundary({
    tenantId: 'tenant',
    policy: retainPolicy(),
  });
  await assert.rejects(boundary.prepareRetention({
    ...base,
    pii: [{ path: '/missing', category: 'email' }],
  }), /PII path does not exist/u);
  await assert.rejects(boundary.prepareRetention({
    ...base,
    pii: [
      { path: '/profile/email', category: 'email' },
      { path: '/profile/email', category: 'email' },
    ],
  }), /Duplicate PII/u);
  await assert.rejects(boundary.prepareRetention({
    ...base,
    pii: [{ path: 'profile/email', category: 'email' }],
  }), /JSON Pointer/u);
});

test('boundary construction, clocks, IDs, inputs, and record schemas fail closed', async () => {
  assert.throws(() => new DataPolicyBoundary({
    tenantId: ' ',
    policy: createDiscardDataPolicy(),
  }), /tenantId/u);
  assert.throws(() => new DataPolicyBoundary({
    tenantId: 'tenant',
    policy: {} as DataPolicyPort,
  }), /evaluate/u);
  assert.throws(() => createDiscardDataPolicy('', '1'), /policyId/u);

  const invalidClock = new DataPolicyBoundary({
    tenantId: 'tenant',
    policy: createDiscardDataPolicy(),
    now: () => new Date(Number.NaN),
  });
  await assert.rejects(invalidClock.prepareRetention({
    stage: 'output', blueprintId: 'b', blueprintVersion: '1', classification: 'c', payload: null,
  }), /valid Date/u);

  const invalidId = new DataPolicyBoundary({
    tenantId: 'tenant',
    policy: createDiscardDataPolicy(),
    createRecordId: () => ' ',
  });
  await assert.rejects(invalidId.prepareRetention({
    stage: 'output', blueprintId: 'b', blueprintVersion: '1', classification: 'c', payload: null,
  }), /record ID/u);

  const invalidInput = new DataPolicyBoundary({ tenantId: 'tenant', policy: createDiscardDataPolicy() });
  await assert.rejects(invalidInput.prepareRetention({
    stage: 'unknown' as never, blueprintId: 'b', blueprintVersion: '1', classification: 'c', payload: null,
  }), /stage/u);
  assert.throws(() => invalidInput.readPayload({ schema: 'unknown' } as never), /Unsupported/u);

  const validDiscard = {
    schema: DATA_RETENTION_RECORD_SCHEMA,
    record_id: 'record', tenant_id: 'tenant', stage: 'input',
    blueprint_id: 'blueprint', blueprint_version: '1.0.0', classification: 'internal',
    pii_categories: [], policy_id: 'policy', policy_version: '1.0.0',
    disposition: 'discard', created_at: createdAt.toISOString(), expires_at: null,
    redacted_paths: [], reason_codes: ['discard'], payload: null,
  };
  assert.equal(validate(validDiscard), true, JSON.stringify(validate.errors));
  for (const invalid of [
    { ...validDiscard, extra: true },
    { ...validDiscard, disposition: 'deny' },
    { ...validDiscard, expires_at: createdAt.toISOString() },
    { ...validDiscard, payload: { retained: true } },
    { ...validDiscard, reason_codes: [] },
  ]) assert.equal(validate(invalid), false);
});

function retainPolicy(): DataPolicyPort {
  return {
    evaluate(): DataPolicyDecision {
      return {
        policy_id: 'example.retain',
        policy_version: '1.0.0',
        disposition: 'retain',
        retention_seconds: 60,
        reason_codes: ['operational_record'],
      };
    },
  };
}
