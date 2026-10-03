import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ConfigurationError,
  LoggingConfig,
  PromptRuntime,
  PixieCoreLogger,
  captureLogs,
  configureLogging,
  generateTraceId,
  getLogger,
  getTraceId,
  logExecutionComplete,
  logExecutionRetry,
  logExecutionStart,
  logLlmRequest,
  logLlmResponse,
  logToolExecution,
  logValidationResult,
  runWithTraceId,
  sanitizeLogMessage,
  sanitizePayload,
  setTraceId,
  truncatePayload,
} from '../../../../index.js';
import { ScriptedProvider } from '../../../../../tests/helpers/fake-provider.js';
import { RecordingLoggerPort } from '../../../../../tests/helpers/recording-logger.js';
import { testData } from '../../../../../tests/helpers/test-data.js';
import { withTempDirectory } from '../../../../../tests/helpers/temp.js';

const data = testData('logging contract');

test('trace IDs are UUIDs and remain isolated across asynchronous execution contexts', async () => {
  setTraceId(null);
  assert.equal(getTraceId(), 'no-trace');
  const ids = new Set(Array.from({ length: 100 }, generateTraceId));
  assert.equal(ids.size, 100);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

  const values = await Promise.all([
    runWithTraceId('trace-a', async () => { await delay(10); return getTraceId(); }),
    runWithTraceId('trace-b', async () => { await delay(1); return getTraceId(); }),
  ]);
  assert.deepEqual(values, ['trace-a', 'trace-b']);
  setTraceId('manual-trace');
  assert.equal(getTraceId(), 'manual-trace');
  setTraceId(null);
});

test('message and nested payload sanitization redact credentials without mutating callers', () => {
  const key = `sk-${'a'.repeat(48)}`;
  const message = sanitizeLogMessage(`Using api_key: "${key}"; Authorization: Bearer abc123xyz`);
  assert.doesNotMatch(message, /abc123xyz/);
  assert.doesNotMatch(message, new RegExp(key));
  assert.match(message, /\*\*\*REDACTED\*\*\*/);

  const original = {
    api_key: 'secret-key',
    model: 'gpt-test',
    headers: { Authorization: 'Bearer secret-token', 'Content-Type': 'application/json' },
    nested: [{ password: 'pass', custom_token: 'custom-value' }],
    note: 'account=visible custom-pattern-123',
  };
  const sanitized = sanitizePayload(original, {
    sensitiveFields: ['custom_token'],
    customValuePatterns: ['custom-pattern-\\d+'],
  });
  assert.equal(sanitized.api_key, '***REDACTED***');
  assert.equal(sanitized.headers.Authorization, '***REDACTED***');
  assert.equal(sanitized.headers['Content-Type'], 'application/json');
  assert.equal(sanitized.nested[0]?.password, '***REDACTED***');
  assert.equal(sanitized.nested[0]?.custom_token, '***REDACTED***');
  assert.doesNotMatch(sanitized.note, /custom-pattern-123/);
  assert.equal(original.api_key, 'secret-key');
  assert.equal(original.headers.Authorization, 'Bearer secret-token');
});

test('message sanitization keeps text logs on one physical line', () => {
  const sanitized = sanitizeLogMessage('safe\nforged log line\rAuthorization: Bearer hidden');
  assert.equal(sanitized, 'safe\\nforged log line\\rAuthorization: ***REDACTED***');
  assert.doesNotMatch(sanitized, /[\r\n]/);
});

test('payload truncation preserves small values and reports the original byte size for large values', () => {
  const small = { key: 'value' };
  assert.equal(truncatePayload(small, 1000), small);
  const large = truncatePayload({ data: 'x'.repeat(200_000) }, 100_000);
  assert.ok('_truncated' in large);
  assert.equal(large._truncated, true);
  assert.ok(large._original_size > 100_000);
  assert.match(large._content, /\[TRUNCATED\]$/);
  assert.throws(() => truncatePayload({}, 0), ConfigurationError);
});

test('sanitization handles case, regex flags, circular values, bigint, errors, and typed arrays immutably', () => {
  const fieldSecret = data.text('case-insensitive field secret', 'secret');
  const regexSecret = data.text('regex secret', 'RegexSecret').toUpperCase();
  const errorSecret = data.text('error secret', 'token');
  const original: Record<string, unknown> = {
    API_KEY: fieldSecret,
    PaSsWoRd: fieldSecret,
    MixedSecret: fieldSecret,
    note: regexSecret,
    count: BigInt(data.integer('bigint', 10_000, 99_999)),
    error: new Error(`failure ${errorSecret}`),
    bytes: new Uint16Array([data.integer('typed integer', 1, 255)]),
  };
  original.circular = original;

  const sanitized = sanitizePayload(original, {
    sensitiveFields: ['mixedsecret'],
    customValuePatterns: [/regexsecret_[A-F0-9]+/i, new RegExp(errorSecret, 'i')],
  }) as Record<string, unknown>;

  assert.equal(sanitized.API_KEY, '***REDACTED***');
  assert.equal(sanitized.PaSsWoRd, '***REDACTED***');
  assert.equal(sanitized.MixedSecret, '***REDACTED***');
  assert.equal(sanitized.note, '***REDACTED***');
  assert.equal(sanitized.count, String(original.count));
  assert.deepEqual(sanitized.error, { name: 'Error', message: 'failure ***REDACTED***' });
  assert.equal(sanitized.bytes, '[Binary: 2 bytes]');
  assert.equal(sanitized.circular, '[Circular]');
  assert.equal(original.API_KEY, fieldSecret);
  assert.equal((original.error as Error).message, `failure ${errorSecret}`);
  assert.ok(original.bytes instanceof Uint16Array);
  assert.equal(original.circular, original);
});

test('disabled sanitization preserves credentials while cloning special and circular values', () => {
  const secret = data.text('disabled sanitizer secret', 'secret');
  const caller: Record<string, unknown> = {
    API_KEY: secret,
    count: 42n,
    bytes: new Uint8Array([1, 2, 3]),
  };
  caller.circular = caller;
  const logger = new PixieCoreLogger(new LoggingConfig({
    logToConsole: false,
    sanitizeCredentials: false,
  }).validate());
  const capture = captureLogs(logger);
  try {
    logger.info(`credential ${secret}`, caller);
    assert.equal(capture.records[0]?.message, `credential ${secret}`);
    assert.equal(capture.records[0]?.API_KEY, secret);
    assert.equal(capture.records[0]?.count, '42');
    assert.equal(capture.records[0]?.bytes, '[Binary: 3 bytes]');
    assert.equal(capture.records[0]?.circular, '[Circular]');
    assert.equal(caller.API_KEY, secret);
    assert.equal(caller.count, 42n);
    assert.ok(caller.bytes instanceof Uint8Array);
    assert.equal(caller.circular, caller);
  } finally {
    capture.close();
  }
});

test('UTF-8 payload truncation ends at a complete code point and reports original bytes', () => {
  const payload = { value: '🙂'.repeat(data.integer('emoji count', 8, 16)) };
  const maxSize = 24;
  const truncated = truncatePayload(payload, maxSize);
  assert.ok('_truncated' in truncated);
  assert.equal(truncated._original_size, Buffer.byteLength(JSON.stringify(payload)));
  assert.doesNotMatch(truncated._content, /\uFFFD/);
  assert.match(truncated._content, /\[TRUNCATED\]$/);
  assert.ok(Buffer.byteLength(truncated._content) <= maxSize);
});

test('logging configuration supports PixieCore and prompt-runtime environment names with validation', async () => {
  const defaults = new LoggingConfig().validate();
  assert.equal(defaults.logLevel, 'INFO');
  assert.equal(defaults.logToFile, false);
  assert.equal(defaults.logDir, './logs');
  assert.equal(defaults.logFile, 'pixiecore.log');
  assert.equal(defaults.auditFile, 'pixiecore_audit.jsonl');

  await withTempDirectory(async root => {
    const config = LoggingConfig.fromEnvironment({
      PIXIECORE_LOG_LEVEL: 'DEBUG',
      PIXIECORE_LOG_TO_FILE: 'true',
      PIXIECORE_LOG_DIR: join(root, 'logs'),
      PIXIECORE_LOG_MAX_BYTES: '1000',
      PIXIECORE_LOG_BACKUP_COUNT: '2',
      PIXIECORE_AUDIT_MAX_BYTES: '2000',
      PIXIECORE_AUDIT_BACKUP_COUNT: '3',
      PIXIECORE_MAX_PAYLOAD_SIZE: '500',
      PIXIECORE_LOG_FULL_PAYLOADS: 'true',
      PIXIECORE_SENSITIVE_FIELDS: 'custom_token,private_data',
    });
    assert.equal(config.logLevel, 'DEBUG');
    assert.equal(config.logToFile, true);
    assert.equal(config.maxPayloadSize, 500);
    assert.deepEqual(config.sensitiveFields, ['custom_token', 'private_data']);
    await access(config.logDir);
  });

  assert.throws(() => LoggingConfig.fromEnvironment({ PROMPT_RUNTIME_LOG_LEVEL: 'INVALID' }), /Invalid log level/);
  assert.throws(() => LoggingConfig.fromEnvironment({ PROMPT_RUNTIME_LOG_TO_FILE: 'perhaps' }), /must be a boolean/);
  assert.throws(() => new LoggingConfig({ customValuePatterns: ['['] }).validate(), /Invalid credential sanitization pattern/);
});

test('rotating text and JSONL audit files contain sanitized traceable records', async () => {
  await withTempDirectory(async root => {
    const config = new LoggingConfig({
      logToConsole: false,
      logToFile: true,
      logDir: root,
      logMaxBytes: 300,
      logBackupCount: 2,
      auditMaxBytes: 700,
      auditBackupCount: 2,
      logFullPayloads: true,
      maxPayloadSize: 2000,
    }).validate();
    const logger = new PixieCoreLogger(config);
    const secret = `sk-${'z'.repeat(48)}`;
    runWithTraceId('file-trace', () => {
      for (let index = 0; index < 8; index++) logger.info(`message ${index} api_key: "${secret}"`, { Authorization: 'Bearer hidden-token' });
      logExecutionStart('blueprint', { api_key: secret }, logger);
      logLlmRequest('openai', 'model', { headers: { Authorization: 'Bearer hidden-token' } }, logger);
      logLlmResponse('openai', 'model', { output: 'ok' }, 12.3, logger);
      logValidationResult('schema', false, 'invalid', logger);
      logToolExecution('tool', { token: 'hidden' }, undefined, 3.2, 'failed', logger);
      logExecutionComplete('success', { result: 'ok' }, 20, 0, logger);
      logExecutionRetry('runtime', 'output_validation', 1, logger);
    });

    const names = await readdir(root);
    assert.ok(names.includes('pixiecore.log'));
    assert.ok(names.includes('pixiecore.log.1'));
    assert.ok(names.filter(name => name.startsWith('pixiecore.log.')).length <= 2);
    assert.ok(names.includes('pixiecore_audit.jsonl'));
    assert.ok(names.some(name => name.startsWith('pixiecore_audit.jsonl.')));

    for (const name of names.filter(name => name.startsWith('pixiecore'))) {
      const text = await readFile(join(root, name), 'utf8');
      assert.doesNotMatch(text, new RegExp(secret));
      assert.doesNotMatch(text, /hidden-token/);
      if (name.startsWith('pixiecore_audit.jsonl')) {
        for (const line of text.trim().split('\n').filter(Boolean)) {
          const record = JSON.parse(line) as Record<string, unknown>;
          assert.equal(record.kind, 'audit');
          assert.equal(record.trace_id, 'file-trace');
        }
      }
    }
  });
});

test('audit helpers expose structured steps and the logger name remains independently identifiable', () => {
  const logger = new PixieCoreLogger(new LoggingConfig({ logToConsole: false, logFullPayloads: true }).validate(), 'pixiecore.api');
  const capture = captureLogs(logger);
  try {
    runWithTraceId('audit-trace', () => {
      logExecutionStart('sample', { input: 'value' }, logger);
      logLlmRequest('openai', 'model', { messages: [] }, logger);
      logLlmResponse('openai', 'model', 'response', 1, logger);
      logValidationResult('schema', true, undefined, logger);
      logToolExecution('tool', {}, 'result', 2, null, logger);
      logExecutionComplete('success', { output: 'value' }, 3, 0, logger);
      logExecutionRetry('application', 'temporary_failure', 1, logger);
    });
    assert.deepEqual(capture.records.map(record => record.step), [
      'execution_start', 'llm_call', 'llm_call', 'validation', 'tool_execution',
      'execution_complete', 'execution_retry',
    ]);
    assert.equal(capture.records.at(-1)?.retry_owner, 'application');
    assert.equal(capture.records.at(-1)?.attempt, 1);
    assert.ok(capture.records.every(record => record.name === 'pixiecore.api.audit'));
    assert.ok(capture.records.every(record => record.trace_id === 'audit-trace'));
  } finally { capture.close(); }

  const configured = configureLogging({ logLevel: 'DEBUG', logToConsole: false });
  assert.equal(configured.logLevel, 'DEBUG');
  assert.equal(getLogger().name, 'pixiecore');
});

test('large audit payloads are bounded without discarding event metadata', () => {
  const logger = new PixieCoreLogger(new LoggingConfig({
    logToConsole: false,
    logFullPayloads: true,
    maxPayloadSize: 128,
  }).validate());
  const capture = captureLogs(logger);
  try {
    logLlmRequest('openai', 'model', { messages: [{ content: 'x'.repeat(2_000) }] }, logger);
    const [record] = capture.records;
    assert.equal(record?.step, 'llm_call');
    assert.equal(record?.event, 'request');
    assert.equal((record?.request as { _truncated?: unknown })._truncated, true);
  } finally { capture.close(); }
});

test('PromptRuntime emits execution, provider, validation, and tool audit events under one trace', async () => {
  const logger = new PixieCoreLogger(new LoggingConfig({ logToConsole: false, logFullPayloads: true }).validate());
  const capture = captureLogs(logger);
  const provider = new ScriptedProvider([
    { toolCalls: [{ id: 'call-1', name: 'echo', arguments: { value: 'ok' } }] },
    { content: '{"result":"done"}' },
  ]);
  const runtime = new PromptRuntime({ provider, logger, mcpConfigPath: 'disabled' })
    .registerTool({ name: 'echo', description: 'Echo', parameters: { type: 'object' }, execute: args => args.value });
  try {
    await runWithTraceId('runtime-trace', () => runtime.executeYaml(`
name: Logged runtime
version: '1.0'
role: assistant
prompt: Complete it
output_schema: '{"type":"object","properties":{"result":{"type":"string"}},"required":["result"]}'
`));
    const steps = new Set(capture.records.filter(record => record.kind === 'audit').map(record => record.step));
    for (const step of ['execution_start', 'llm_call', 'validation', 'tool_execution', 'execution_complete']) assert.ok(steps.has(step), `missing ${step}`);
    assert.ok(capture.records.every(record => record.trace_id === 'runtime-trace'));
  } finally {
    capture.close();
    await runtime.close();
    setTraceId(null);
  }
});

test('PromptRuntime safely adapts an implementation-independent logger port', async () => {
  const logger = new RecordingLoggerPort();
  const provider = new ScriptedProvider([{ content: '{"result":"ok"}' }]);
  const runtime = new PromptRuntime({ provider, logger, mcpConfigPath: 'disabled' });
  try {
    const result = await runtime.executeYaml(`
name: Structural logger
version: '1.0'
role: assistant
prompt: Return a result for {value}
input_placeholders:
  - name: value
    type: string
    required: true
output_schema: '{"type":"object","properties":{"result":{"type":"string"}},"required":["result"]}'
`, { value: 'visible' });

    assert.deepEqual(result, { result: 'ok' });
    assert.ok(runtime.logger instanceof PixieCoreLogger);
    assert.equal(runtime.loggingConfig.logFullPayloads, true);
    const auditRecords = logger.records.filter(record => record.kind === 'audit');
    const steps = auditRecords.map(record => record.step);
    for (const step of ['execution_start', 'llm_call', 'validation', 'execution_complete']) {
      assert.ok(steps.includes(step), `missing ${step}`);
    }
    const executionStart = auditRecords.find(record => record.step === 'execution_start');
    assert.deepEqual(executionStart?.inputs, { value: 'visible' });
  } finally {
    await runtime.close();
    await runtime.close();
  }
  assert.deepEqual(logger.closedNames, []);
});

test('logger adaptation leaves custom file persistence under application control', async () => {
  await withTempDirectory(async root => {
    const logDir = join(root, 'delegate-owned-logs');
    const logger = new RecordingLoggerPort('independent', {
      logToConsole: false,
      logToFile: true,
      logDir,
    });
    const runtime = new PromptRuntime({
      provider: new ScriptedProvider([]),
      logger,
      mcpConfigPath: 'disabled',
    });
    try {
      assert.equal(runtime.loggingConfig.logToFile, true);
      await assert.rejects(access(logDir), { code: 'ENOENT' });
    } finally {
      await runtime.close();
    }
  });
});
