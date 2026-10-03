import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createReproductionCommand,
  parseReferenceBenchmarkArgs,
  referenceBenchmarkUsage,
} from '../../examples/benchmarks/reference-blueprint.js';

const required = [
  '--dataset=evaluations/date.yaml',
  '--provider=openai',
  '--model=model-id',
  '--seed=release-seed',
  '--release=0.1.0',
  '--artifact=results/report.json',
  '--scorecard=results/report.md',
  '--confirm-remote-cost',
];

test('reference benchmark requires explicit remote-cost confirmation and release metadata', () => {
  assert.throws(
    () => parseReferenceBenchmarkArgs(required.slice(0, -1)),
    /--confirm-remote-cost/u,
  );
  const command = parseReferenceBenchmarkArgs(required);
  assert.equal(command.runsPerTarget, 3);
  assert.equal(command.targetId, 'openai:model-id');
  assert.equal(command.pricing, undefined);
  assert.match(createReproductionCommand(command), /--confirm-remote-cost/u);
  assert.match(referenceBenchmarkUsage(), /Credentials are read only from/u);
});

test('reference benchmark accepts complete pricing and rejects partial or unsafe output options', () => {
  const command = parseReferenceBenchmarkArgs([
    ...required,
    '--runs=5',
    '--currency=USD',
    '--input-price=1.25',
    '--output-price=4.5',
    '--pricing-source=provider sheet effective 2026-08-25',
  ]);
  assert.deepEqual(command.pricing, {
    currency: 'USD',
    inputPerMillionTokens: 1.25,
    outputPerMillionTokens: 4.5,
  });
  assert.equal(command.pricingSource, 'provider sheet effective 2026-08-25');
  assert.equal(command.runsPerTarget, 5);

  assert.throws(
    () => parseReferenceBenchmarkArgs([...required, '--currency=USD']),
    /must be supplied together/u,
  );
  assert.throws(
    () => parseReferenceBenchmarkArgs([
      ...required.filter(value => !value.startsWith('--scorecard=')),
      '--scorecard=results/report.json',
    ]),
    /must identify different files/u,
  );
});
