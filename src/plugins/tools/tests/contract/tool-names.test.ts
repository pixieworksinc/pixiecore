import test from 'node:test';
import assert from 'node:assert/strict';
import { convertToolCallNames, makeSafeToolName, sanitizeToolNames } from '../../../../index.js';
test('sanitizes incompatible names and reverses call names', () => {
  const { tools, mapping } = sanitizeToolNames([{ name: 'mcp.fetch.html', description: '', parameters: {} }]);
  assert.match(tools[0]!.name, /^tool_[a-f0-9]+$/);
  assert.equal(convertToolCallNames([{ id: '1', name: tools[0]!.name, arguments: {} }], mapping)[0]!.name, 'mcp.fetch.html');
});
test('safe names stay unchanged and collisions get a suffix', () => {
  const names = new Set<string>(); assert.equal(makeSafeToolName('weather', names), 'weather'); assert.notEqual(makeSafeToolName('weather', names), 'weather');
});
