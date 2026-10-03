import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findInstructionPlaceholders,
  isInstructionPlaceholderName,
  isPortableInstructionPlaceholderName,
  renderInstructionTemplate,
} from '../../src/core/component/instruction-template/index.js';

test('instruction templates render Mustache and legacy bindings without altering other text', () => {
  const template = [
    'canonical={{ name }}',
    'compact={{count}}',
    'legacy={ active }',
    'object={{ payload }}',
    'null={{ null_value }}',
    'undefined={{ undefined_value }}',
    'missing={{ missing }}',
    'json={"type":"object"}',
  ].join('\n');

  assert.equal(renderInstructionTemplate(template, {
    name: 'Ada',
    count: 3,
    active: false,
    payload: { id: 7 },
    null_value: null,
    undefined_value: undefined,
  }), [
    'canonical=Ada',
    'compact=3',
    'legacy=false',
    'object={"id":7}',
    'null=',
    'undefined=',
    'missing={{ missing }}',
    'json={"type":"object"}',
  ].join('\n'));
});

test('instruction placeholder discovery reports immutable source spans and syntax', () => {
  const template = 'A {{ alpha }} B {legacy.name} C {{{ nested }}}';
  const references = findInstructionPlaceholders(template);

  assert.deepEqual(references, [
    { name: 'alpha', syntax: 'mustache', start: 2, end: 13, source: '{{ alpha }}' },
    {
      name: 'legacy.name',
      syntax: 'legacy-single-brace',
      start: 16,
      end: 29,
      source: '{legacy.name}',
    },
    { name: 'nested', syntax: 'mustache', start: 33, end: 45, source: '{{ nested }}' },
  ]);
  assert.equal(Object.isFrozen(references), true);
  assert.equal(Object.isFrozen(references[0]), true);
  assert.equal(renderInstructionTemplate(template, {
    alpha: 'one',
    'legacy.name': 'two',
    nested: 'three',
  }), 'A one B two C {three}');
});

test('instruction placeholder discovery ignores non-bindings and identifies portable names', () => {
  assert.deepEqual(
    findInstructionPlaceholders('plain text, {"json":true}, and {{\nname }}'),
    [],
  );
  assert.equal(renderInstructionTemplate('plain text', {}), 'plain text');
  assert.equal(isPortableInstructionPlaceholderName('customer_id'), true);
  assert.equal(isPortableInstructionPlaceholderName('customer.id'), false);
  assert.equal(isPortableInstructionPlaceholderName('customer-id'), false);
  assert.equal(isPortableInstructionPlaceholderName('9customer'), false);
  assert.equal(isInstructionPlaceholderName('customer.id'), true);
  assert.equal(isInstructionPlaceholderName('customer-id'), true);
  assert.equal(isInstructionPlaceholderName('customer name'), false);
});
