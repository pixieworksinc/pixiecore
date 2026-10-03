import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [guide, issueForm] = await Promise.all([
  readFile(new URL('../../docs/blueprints/blueprint-publishing.md', import.meta.url), 'utf8'),
  readFile(new URL('../../.github/ISSUE_TEMPLATE/blueprint-package-review.yml', import.meta.url), 'utf8'),
]);

test('publisher guide defines the data-only submission and independent review boundary', () => {
  for (const heading of [
    '## Submission packet',
    '## Namespace and ownership',
    '## Prepare and verify',
    '## Publisher checklist',
    '## Reviewer checklist',
    '## Start a review',
  ]) {
    assert.match(guide, new RegExp(escapeRegExp(heading), 'u'));
  }
  assert.match(guide, /must not contain or require JavaScript, TypeScript, shell commands/u);
  assert.match(guide, /Offline fixture\s+accuracy and remote model quality are different evidence kinds/u);
  assert.match(guide, /does not claim that the `ECO-BP-006` target/u);
});

test('third-party submission form requires trust, rights, quality, and lifecycle evidence', () => {
  assert.match(issueForm, /name: Third-party Blueprint package review/u);
  for (const field of [
    'Publisher key ID and distribution reference',
    'License and fixture rights',
    'Quality evidence',
    'Compatibility and lifecycle evidence',
    'Owner, security contact, and maintenance plan',
  ]) {
    assert.match(issueForm, new RegExp(escapeRegExp(field), 'u'));
  }
  assert.match(issueForm, /contains no executable or install hook/u);
  assert.match(issueForm, /authorized to redistribute every submitted file/u);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
