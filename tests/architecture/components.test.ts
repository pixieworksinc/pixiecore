import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ResourceStack,
  isClosableResource,
} from '../../src/core/component/resource-stack/index.js';
import type { LoggerPort } from '../../src/core/contracts/logging/index.js';
import { LoggingConfig, PixieCoreLogger } from '../../src/plugins/logging/logging.js';

test('resource stack closes owned resources once in reverse acquisition order', async () => {
  const events: string[] = [];
  const resources = new ResourceStack();
  resources.add({ close: () => { events.push('first'); } });
  resources.add({ close: async () => { events.push('second'); } });
  resources.add({});

  await resources.close();
  await resources.close();

  assert.deepEqual(events, ['second', 'first']);
});

test('resource stack aggregates cleanup failures after attempting every resource', async () => {
  const events: string[] = [];
  const resources = new ResourceStack();
  resources.add({ close: () => { events.push('first'); throw new Error('first failure'); } });
  resources.add({ close: () => { events.push('second'); throw new Error('second failure'); } });

  await assert.rejects(resources.close('cleanup failed'), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.message, 'cleanup failed');
    assert.equal(error.errors.length, 2);
    return true;
  });
  assert.deepEqual(events, ['second', 'first']);
});

test('resource ownership ignores arrays even when they expose close()', async () => {
  let closeCount = 0;
  const array = Object.assign([], { close: () => { closeCount++; } });
  const resources = new ResourceStack();

  assert.equal(isClosableResource(array), false);
  resources.add(array);
  await resources.close();

  assert.equal(closeCount, 0);
});

test('resource stack rejects additions after cleanup has started', async () => {
  const resources = new ResourceStack();
  await resources.close();

  assert.throws(
    () => resources.add({ close: () => undefined }),
    { name: 'Error', message: 'Resource stack is closed' },
  );
});

test('the concrete logger satisfies the implementation-independent logger port', () => {
  const logger: LoggerPort = new PixieCoreLogger(
    new LoggingConfig({ logToConsole: false }).validate(),
  );
  assert.equal(typeof logger.child('child').info, 'function');
});
