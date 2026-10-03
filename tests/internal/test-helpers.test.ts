import assert from 'node:assert/strict';
import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { FakeApiRuntime } from '../helpers/fake-api-runtime.js';
import { startApiServer, stopApiServer } from '../helpers/http-server.js';
import { RecordingLoggerPort } from '../helpers/recording-logger.js';
import { testData } from '../helpers/test-data.js';
import { withTempDirectory } from '../helpers/temp.js';

test('withTempDirectory removes its directory after a successful task', async () => {
  const data = testData('temporary directory success cleanup');
  const expected = data.text('task result');
  let directory = '';

  const actual = await withTempDirectory(async path => {
    directory = path;
    const fixture = join(path, `${data.text('fixture file')}.txt`);
    await writeFile(fixture, data.text('fixture content'));
    await access(fixture);
    return expected;
  }, `${data.text('directory prefix', 'pixiecore-helper')}-`);

  assert.equal(actual, expected);
  await assert.rejects(access(directory), { code: 'ENOENT' });
});

test('withTempDirectory removes its directory while preserving a task failure', async () => {
  const data = testData('temporary directory failure cleanup');
  const taskFailure = new Error(data.text('task failure', 'task-failed'));
  let directory = '';

  await assert.rejects(
    withTempDirectory(async path => {
      directory = path;
      await writeFile(join(path, `${data.text('fixture file')}.txt`), data.text('fixture content'));
      throw taskFailure;
    }, `${data.text('directory prefix', 'pixiecore-helper')}-`),
    error => {
      assert.equal(error, taskFailure);
      return true;
    },
  );

  await assert.rejects(access(directory), { code: 'ENOENT' });
});

test('API server helpers close each resource exactly once', async () => {
  const data = testData('API helper resource cleanup');
  const runtime = new FakeApiRuntime();
  const logger = new RecordingLoggerPort(data.text('logger name', 'logger'));
  const { server } = await startApiServer({ runtime, logger, environment: {} });

  await stopApiServer(server);
  await stopApiServer(server);

  assert.equal(server.listening, false);
  assert.equal(runtime.closeCount, 1);
  assert.deepEqual(logger.closedNames, ['pixiecore.api']);
});

test('API server helper exposes cleanup errors without closing resources twice', async () => {
  const data = testData('API helper cleanup failure');
  const cleanupFailure = new Error(data.text('cleanup failure', 'cleanup-failed'));
  const runtime = new FakeApiRuntime();
  const logger = new RecordingLoggerPort(data.text('logger name', 'logger'));
  let runtimeCloseCount = 0;
  runtime.close = () => {
    runtimeCloseCount++;
    throw cleanupFailure;
  };
  const { server } = await startApiServer({ runtime, logger, environment: {} });

  let observedError: unknown;
  try {
    await stopApiServer(server);
    assert.fail('Expected API resource cleanup to fail');
  } catch (error) {
    observedError = error;
  }

  assert.ok(observedError instanceof AggregateError);
  assert.deepEqual(observedError.errors, [cleanupFailure]);
  assert.equal(server.listening, false);
  assert.equal(runtimeCloseCount, 1);
  assert.deepEqual(logger.closedNames, ['pixiecore.api']);
  await assert.rejects(server.closeResources(), error => error === observedError);
  assert.equal(runtimeCloseCount, 1);
  assert.deepEqual(logger.closedNames, ['pixiecore.api']);
});
