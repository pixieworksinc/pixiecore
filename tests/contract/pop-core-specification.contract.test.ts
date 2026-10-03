import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const specification = await readFile(
  new URL('../../docs/specification/pop-core-specification-0.1.md', import.meta.url),
  'utf8',
);
const normalizedSpecification = specification.replace(/\s+/gu, ' ');

test('POP Core 0.1 specifies every implementation-independent contract boundary', () => {
  for (const heading of [
    '## 1. Scope',
    '## 4. Blueprint abstract data model',
    '## 6. Validation and execution',
    '## 7. Errors',
    '## 8. Semantic evaluation',
    '## 9. Application composition',
    '## 10. Security and side effects',
    '## 11. Versioning and compatibility',
    '## 12. Conformance',
  ]) {
    assert.match(specification, new RegExp(escapeRegExp(heading), 'u'));
  }
  assert.match(normalizedSpecification, /A Blueprint is a versioned declaration of exactly one cognitive operation\./u);
  assert.match(normalizedSpecification, /A successful execution MUST return one JSON object satisfying the declared output schema\./u);
  assert.match(normalizedSpecification, /An evaluation result MUST distinguish schema pass rate from semantic pass rate\./u);
  assert.match(specification, /POP Core 0\.1 Validator/u);
  assert.match(specification, /POP Core 0\.1 Runtime/u);
});

test('POP Core 0.1 does not depend on one implementation or host language', () => {
  assert.doesNotMatch(
    specification,
    /PixieCore|TypeScript|PromptRuntime|node_modules|src\/|\.ts\b/u,
  );
  assert.match(
    normalizedSpecification,
    /does not select a programming language, file format, model provider, transport, storage system/u,
  );
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
