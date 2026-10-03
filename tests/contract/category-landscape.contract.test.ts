import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const landscape = await readFile(
  new URL('../../docs/specification/category-landscape.md', import.meta.url),
  'utf8',
);

test('category landscape compares every adjacent pattern on explicit dimensions', () => {
  for (const pattern of [
    'Structured model output',
    'Prompt template',
    'Agent graph',
    'Workflow engine',
    'Code-only pipeline',
    'PixieCore Blueprint',
  ]) {
    assert.match(landscape, new RegExp(escapeRegExp(pattern), 'u'));
  }
  for (const dimension of [
    'Primary reusable unit',
    'Typed boundary',
    'Control-flow owner',
    'Evaluation unit',
    'Typical strength',
    'Typical limitation',
  ]) {
    assert.match(landscape, new RegExp(escapeRegExp(dimension), 'u'));
  }
});

test('category landscape separates measured adjacent-pattern evidence from pending claims', () => {
  assert.match(
    landscape,
    /Measured for the publication-brief corpus; not a universal ranking/u,
  );
  assert.match(landscape, /Pending `ADOPT-004`/u);
  assert.match(landscape, /must not be replaced with estimates or subjective rankings/u);
  assert.match(landscape, /does not currently claim higher accuracy, lower cost, or faster\s+development/u);
  assert.doesNotMatch(landscape, /guaranteed to outperform|always better|universally superior/iu);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
