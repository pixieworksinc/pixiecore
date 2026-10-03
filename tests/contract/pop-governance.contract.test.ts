import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string): Promise<string> => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const [
  governance,
  rfcIndex,
  template,
  decision,
  instructionDeliveryDraft,
  inputBindingDraft,
] = await Promise.all([
  read('docs/specification/pop-governance.md'),
  read('docs/rfcs/README.md'),
  read('docs/rfcs/0000-template.md'),
  read('docs/decisions/0002-pop-governance.md'),
  read('docs/rfcs/0001-instruction-text-delivery.md'),
  read('docs/rfcs/0002-input-binding-syntax.md'),
]);

test('POP governance separates change classes and defines an auditable lifecycle', () => {
  for (const changeClass of [
    'Editorial',
    'Compatible normative',
    'Incompatible normative',
    'Governance or name usage',
  ]) {
    assert.match(governance, new RegExp(changeClass, 'u'));
  }
  assert.match(governance, /RFC statuses are `draft`, `proposed`, `accepted`, `rejected`, `withdrawn`, and\s+`superseded`\./u);
  assert.match(governance, /Material revisions restart the review period\./u);
  assert.match(rfcIndex, /A draft has no normative\s+effect/u);
});

test('POP votes have explicit review periods, quorum, approval, and recusal rules', () => {
  assert.match(governance, /Compatible normative \| 14 calendar days \|[^\n]+minimum 1 \| More than half/u);
  assert.match(governance, /Incompatible normative \| 30 calendar days \| At least 2[^\n]+\| At least two thirds/u);
  assert.match(governance, /Governance or name usage \| 30 calendar days \| At least 2[^\n]+\| At least two thirds/u);
  assert.match(governance, /Silence is never a vote\./u);
  assert.match(governance, /does not vote, and does not\s+count toward quorum/u);
  assert.match(governance, /urgency does not lower quorum\./u);
});

test('POP compatibility preserves identifiers and requires a bounded deprecation path', () => {
  assert.match(governance, /Published POP identifiers are immutable compatibility boundaries\./u);
  assert.match(governance, /compatible normative change publishes a new minor/u);
  assert.match(governance, /incompatible normative change publishes a new major/u);
  assert.match(governance, /at least 180 calendar days/u);
  assert.match(governance, /remain archived and addressable after support\s+ends/u);
  assert.match(governance, /PixieCore package versions and POP specification versions are independent\./u);
});

test('project-name claims are evidence-bound without asserting registration or certification', () => {
  assert.match(governance, /does not claim that either\s+name is a registered trademark/u);
  assert.match(governance, /no official logo or certification program/u);
  assert.match(governance, /must identify the profile, suite version, implementation version,\s+and result date/u);
  assert.match(governance, /must not use\s+“official”, “certified”, “approved”/u);
});

test('the RFC template and bootstrap decision preserve required evidence and final-call fields', () => {
  for (const field of [
    '- Change class:',
    '- Affected artifacts:',
    '- Conflicts and recusals:',
    '## Compatibility and migration',
    '## Security, privacy, cost, and interoperability',
    '## Conformance and independent evidence',
    '## Review record',
    '## Final call',
    '- Quorum result:',
  ]) {
    assert.match(template, new RegExp(escapeRegExp(field), 'u'));
  }
  assert.match(decision, /sole bootstrap exception/u);
  assert.match(decision, /cannot finalize breaking, governance, or project-name changes/u);
});

test('instruction delivery remains a non-normative draft with explicit evidence gaps', () => {
  assert.match(rfcIndex, /POP-RFC-0001[^\n]+`draft`[^\n]+Compatible normative/u);
  assert.match(instructionDeliveryDraft, /- Status: draft/u);
  assert.match(instructionDeliveryDraft, /This draft has no normative effect\./u);
  assert.match(instructionDeliveryDraft, /POP Core 0\.1 and its schemas and suite remain unchanged/u);
  assert.match(instructionDeliveryDraft, /No independent runtime adapter result has been recorded/u);
  assert.match(instructionDeliveryDraft, /placeholder-like `token`[^]*MUST NOT become a required authoring syntax/u);
});

test('portable input binding remains a language-neutral non-normative draft', () => {
  assert.match(rfcIndex, /POP-RFC-0002[^\n]+`draft`[^\n]+Compatible normative/u);
  assert.match(inputBindingDraft, /- Status: draft/u);
  assert.match(inputBindingDraft, /This draft has no normative effect\./u);
  assert.match(inputBindingDraft, /`\{\{ name \}\}`/u);
  assert.match(inputBindingDraft, /Go, Rust, Java, Python/u);
  assert.match(inputBindingDraft, /full Mustache templates/u);
  assert.match(
    inputBindingDraft,
    /initial public snapshot does not distribute an\s+external runtime report/u,
  );
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
