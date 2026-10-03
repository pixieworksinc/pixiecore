import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string): Promise<string> => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const [governance, maintainers, conduct, contributing, goodFirstBlueprint, decisionIndex, template, firstDecision] = await Promise.all([
  read('GOVERNANCE.md'),
  read('MAINTAINERS.md'),
  read('CODE_OF_CONDUCT.md'),
  read('CONTRIBUTING.md'),
  read('.github/ISSUE_TEMPLATE/good-first-blueprint.yml'),
  read('docs/decisions/README.md'),
  read('docs/decisions/0000-template.md'),
  read('docs/decisions/0001-project-governance.md'),
]);

test('project charter publishes roles, responsibilities, decisions, conflicts, and amendments', () => {
  for (const heading of [
    '## Project charter',
    '## Roles',
    '### Contributors',
    '### Reviewers',
    '### Maintainers',
    '### Project Lead',
    '## Decision process',
    '## Transparency and conflicts',
    '## Amendments',
  ]) {
    assert.match(governance, new RegExp(escapeRegExp(heading), 'u'));
  }
  assert.match(governance, /implementation-independent POP specification/u);
  assert.match(governance, /Silence is not consent\./u);
  assert.match(governance, /accepted records are not silently\s+rewritten/u);
});

test('maintainer roster states real authority and current continuity risk', () => {
  assert.match(maintainers, /`@naoi` \| Project Lead and Maintainer \| Yes \| Yes/u);
  assert.match(maintainers, /single release-capable maintainer/u);
  assert.match(maintainers, /explicit continuity risk/u);
  assert.doesNotMatch(maintainers, /at least two current maintainers|distributed ownership already exists/iu);
});

test('Code of Conduct defines behavior, private reporting, recusal, and enforcement', () => {
  for (const heading of ['## Our standard', '## Reporting', '## Enforcement', '## Scope and changes']) {
    assert.match(conduct, new RegExp(escapeRegExp(heading), 'u'));
  }
  assert.match(conduct, /Do not publish sensitive incident details in a public issue\./u);
  assert.match(conduct, /Conflicted maintainers must recuse\./u);
  assert.match(conduct, /unsubstantiated good-faith report is not/u);
});

test('contributor path defines reproducible Blueprint work, review targets, and release cadence', () => {
  for (const heading of [
    '## Local setup',
    '## Good-first Blueprint workflow',
    '## Pull requests',
    '## Review service targets',
    '## Release cadence',
  ]) {
    assert.match(contributing, new RegExp(escapeRegExp(heading), 'u'));
  }
  assert.match(contributing, /TEST_SEED=<reported-seed> npm test/u);
  assert.match(contributing, /within five business days/u);
  assert.match(contributing, /within ten\s+business days/u);
  assert.match(contributing, /at\s+least monthly/u);
  assert.match(goodFirstBlueprint, /name: Good-first Blueprint/u);
  assert.match(goodFirstBlueprint, /Fixture provenance and rights/u);
  assert.match(goodFirstBlueprint, /offline fixtures/u);
});

test('decision log has a reusable lifecycle and one accepted governance record', () => {
  assert.match(decisionIndex, /Valid statuses are `proposed`, `accepted`, `rejected`, `superseded`, and\s+`withdrawn`\./u);
  assert.match(decisionIndex, /\[0001\]\(0001-project-governance\.md\) \| accepted/u);
  for (const field of [
    '- Status:',
    '- Date:',
    '- Participants:',
    '- Conflicts and recusals:',
    '- Supersedes:',
    '- Superseded by:',
    '## Compatibility and migration',
    '## Evidence',
  ]) {
    assert.match(template, new RegExp(escapeRegExp(field), 'u'));
    assert.match(firstDecision, new RegExp(escapeRegExp(field), 'u'));
  }
  assert.match(firstDecision, /- Status: accepted/u);
  assert.match(firstDecision, /single-maintainer continuity risk/u);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
