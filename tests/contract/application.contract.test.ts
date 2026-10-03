import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { PixieCoreError } from '../../src/core/contracts/errors/index.js';
import { PixieCoreLogger, logLlmResponse } from '../../src/plugins/logging/logging.js';
import {
  APPLICATION_PARTIAL_RESULT_SCHEMA,
  ApplicationMappingError,
  ApplicationNodeError,
  ApplicationContractError,
  ApplicationTraceRecorder,
  APPLICATION_TRACE_SCHEMA,
  APPLICATION_GRAPH_INSPECTION_SCHEMA,
  createApplicationPartialResult,
  createApplicationSchemaBoundary,
  executeApplicationNode,
  inspectApplicationGraph,
  renderApplicationGraphMermaid,
  traceApplication,
  type ApplicationTrace,
  type ApplicationNodeDefinition,
  type ApplicationGraphNodeDefinition,
} from '../../src/core/kernel/application/index.js';
import { testData } from '../helpers/test-data.js';
import { withTempDirectory } from '../helpers/temp.js';

const data = testData('application contract');

test('application boundary validates source output and normalized target input', async () => {
  await withFixtureNodes(async nodes => {
    const boundary = await createApplicationSchemaBoundary(nodes);
    const mapped = boundary.validateMapping({
      targetNodeId: 'target',
      inputs: { headline: 'Release', count: '3' },
      sources: [{ nodeId: 'source', output: { title: 'Release' } }],
    });

    assert.deepEqual(mapped, { headline: 'Release', count: 3 });
  });
});

test('application boundary reports target mapping fields without retaining their values', async () => {
  await withFixtureNodes(async nodes => {
    const boundary = await createApplicationSchemaBoundary(nodes);
    const sensitive = 'confidential-mapping-value';

    assert.throws(
      () => boundary.validateMapping({
        targetNodeId: 'target',
        inputs: { headline: sensitive, count: 'not-an-integer' },
        sources: [{ nodeId: 'source', output: { title: 'Release' } }],
      }),
      error => {
        assert.ok(error instanceof ApplicationMappingError);
        assert.equal(error.code, 'application_mapping_error');
        assert.equal(error.stage, 'target-input');
        assert.equal(error.nodeId, 'target');
        assert.deepEqual(error.inputFields, ['count', 'headline']);
        assert.deepEqual(error.sourceNodeIds, ['source']);
        assert.match(error.message, /Node: target/u);
        assert.match(error.message, /Blueprint: .*target\.yaml @ 1\.0\.0/u);
        assert.match(error.message, /Fields: count, headline/u);
        assert.match(error.message, /Suggestion:/u);
        assert.doesNotMatch(JSON.stringify(error), new RegExp(sensitive));
        return true;
      },
    );
  });
});

test('application node errors expose value-free diagnostic context and optional replay', () => {
  const node = fixtureTraceNode();
  const sensitive = data.text('sensitive node value', 'secret');
  const cause = new Error(data.text('node cause', 'failure'));
  const error = new ApplicationNodeError(
    'Fixture application',
    node,
    ['headline', 'count', 'headline'],
    cause,
    {
      replayCommand: 'npm test -- fixture-application',
      suggestions: ['Check the fixture mapping.'],
    },
  );

  assert.equal(error.code, 'application_node_error');
  assert.equal(error.cause, cause);
  assert.equal(error.node, node);
  assert.deepEqual(error.inputFields, ['count', 'headline']);
  assert.match(error.message, new RegExp(`Node: ${node.id}`));
  assert.match(error.message, /Blueprint: unused-in-trace-test\.yaml @ 1\.2\.3/u);
  assert.match(error.message, /Fields: count, headline/u);
  assert.match(error.message, /Reproduce: npm test -- fixture-application/u);
  assert.match(error.message, /Suggestion: Check the fixture mapping\./u);
  assert.doesNotMatch(error.message, new RegExp(sensitive));
});

test('application boundary identifies an invalid upstream output before target execution', async () => {
  await withFixtureNodes(async nodes => {
    const boundary = await createApplicationSchemaBoundary(nodes);

    assert.throws(
      () => boundary.validateMapping({
        targetNodeId: 'target',
        inputs: { headline: 'Release', count: 3 },
        sources: [{ nodeId: 'source', output: { title: 17 } }],
      }),
      error => {
        assert.ok(error instanceof ApplicationMappingError);
        assert.equal(error.stage, 'source-output');
        assert.equal(error.nodeId, 'target');
        assert.deepEqual(error.sourceNodeIds, ['source']);
        assert.ok(error.cause instanceof Error);
        return true;
      },
    );
  });
});

test('application boundary rejects version drift and duplicate node identities during preflight', async () => {
  await withFixtureNodes(async nodes => {
    await assert.rejects(
      createApplicationSchemaBoundary([
        { ...nodes[0]!, blueprintVersion: '2.0.0' },
        nodes[1]!,
      ]),
      error => error instanceof ApplicationMappingError
        && error.stage === 'definition'
        && /declares version 2\.0\.0/u.test(error.message),
    );
    await assert.rejects(
      createApplicationSchemaBoundary([nodes[0]!, { ...nodes[1]!, id: 'source' }]),
      error => error instanceof ApplicationMappingError
        && error.stage === 'definition'
        && /duplicate node id/u.test(error.message),
    );
  });
});

test('application graph inspection resolves node schemas and renders stable Mermaid offline', async () => {
  await withFixtureNodes(async definitions => {
    const nodes: ApplicationGraphNodeDefinition[] = [
      definitions[0]!,
      { ...definitions[1]!, dependsOn: ['source'] },
    ];
    const inspection = await inspectApplicationGraph({
      name: 'Fixture graph',
      version: '1.0.0',
      nodes,
    });

    assert.equal(inspection.schema, APPLICATION_GRAPH_INSPECTION_SCHEMA);
    assert.deepEqual(inspection.edges, [{ from: 'source', to: 'target' }]);
    assert.deepEqual(inspection.nodes.map(node => node.id), ['source', 'target']);
    assert.deepEqual(inspection.nodes[0]?.input_schema, {
      type: 'object', properties: {}, additionalProperties: true,
    });
    assert.deepEqual(
      Object.keys((inspection.nodes[1]?.input_schema as { properties: object }).properties),
      ['headline', 'count'],
    );
    assert.equal(Object.isFrozen(inspection), true);
    assert.equal(Object.isFrozen(inspection.nodes[1]?.output_schema), true);

    const mermaid = renderApplicationGraphMermaid(inspection);
    assert.match(mermaid, /^flowchart TD\n/u);
    assert.match(mermaid, /source.*extractor · 1\.0\.0.*out: title/u);
    assert.match(mermaid, /target.*summarizer · 1\.0\.0.*in: count, headline/u);
    assert.match(mermaid, /node_0 --> node_1/u);
  });
});

test('application graph inspection rejects unknown, repeated, self, and cyclic dependencies', async () => {
  await withFixtureNodes(async definitions => {
    const source = definitions[0]!;
    const target = definitions[1]!;
    const invalid: readonly ApplicationGraphNodeDefinition[][] = [
      [source, { ...target, dependsOn: [''] }],
      [source, { ...target, dependsOn: ['missing'] }],
      [source, { ...target, dependsOn: ['source', 'source'] }],
      [{ ...source, dependsOn: ['source'] }, target],
      [{ ...source, dependsOn: ['target'] }, { ...target, dependsOn: ['source'] }],
    ];

    for (const nodes of invalid) {
      await assert.rejects(
        inspectApplicationGraph({ name: 'Invalid graph', version: '1.0', nodes }),
        ApplicationContractError,
      );
    }
  });
});

test('application graph inspection validates its header before reading nodes', async () => {
  for (const definition of [
    { name: '', version: '1.0', nodes: [] },
    { name: 'Graph', version: '1', nodes: [] },
    { name: 'Graph', version: '1.0', nodes: [] },
  ]) {
    await assert.rejects(
      inspectApplicationGraph(definition),
      ApplicationContractError,
    );
  }
});

test('application graph derives every placeholder input type when input_schema is absent', async () => {
  await withTempDirectory(async directory => {
    const path = join(directory, 'typed.yaml');
    await writeFile(path, JSON.stringify({
      name: 'Typed input node',
      version: '1.0',
      role: 'custom-role',
      prompt: 'Inspect typed inputs.',
      input_placeholders: [
        'legacy',
        { name: 'integer_value', type: 'integer', required: true },
        { name: 'float_value', type: 'float' },
        { name: 'number_value', type: 'number' },
        { name: 'boolean_value', type: 'boolean' },
        { name: 'array_value', type: 'array' },
        { name: 'object_value', type: 'object' },
        { name: 'file_value', type: 'file' },
        { name: 'image_value', type: 'image' },
      ],
      output_schema: 'true',
    }), 'utf8');

    const inspection = await inspectApplicationGraph({
      name: 'Typed graph',
      version: '1.0',
      nodes: [{ id: 'typed', blueprintPath: path, blueprintVersion: '1.0' }],
    });
    const inputSchema = inspection.nodes[0]?.input_schema as {
      properties: Record<string, { type: string }>;
      required: string[];
    };
    assert.deepEqual(
      Object.fromEntries(Object.entries(inputSchema.properties).map(([name, value]) => (
        [name, value.type]
      ))),
      {
        legacy: 'string',
        integer_value: 'integer',
        float_value: 'number',
        number_value: 'number',
        boolean_value: 'boolean',
        array_value: 'array',
        object_value: 'object',
        file_value: 'string',
        image_value: 'string',
      },
    );
    assert.deepEqual(inputSchema.required, ['legacy', 'integer_value']);
    assert.equal(inspection.nodes[0]?.output_schema, true);
    assert.match(renderApplicationGraphMermaid(inspection), /out: \(open\)/u);
  });
});

test('application trace correlates node versions, duration, provider calls, tokens, and result', async () => {
  const logger = new PixieCoreLogger();
  const traceId = data.text('successful trace ID', 'trace');
  const node = fixtureTraceNode();
  let emitted: ApplicationTrace | undefined;

  const value = await traceApplication({
    traceId,
    onTrace: trace => { emitted = trace; },
  }, recorder => recorder.runNode({ node, logger }, async () => {
    logLlmResponse('fixture-provider', 'fixture-model', {
      content: '{}',
      usage: { inputTokens: 13, outputTokens: 5, totalTokens: 18 },
    }, 2, logger);
    return data.text('traced return value');
  }));

  assert.equal(value, data.text('traced return value'));
  assert.ok(emitted);
  assert.equal(emitted.schema, APPLICATION_TRACE_SCHEMA);
  assert.equal(emitted.trace_id, traceId);
  assert.equal(emitted.result, 'succeeded');
  assert.equal(emitted.nodes.length, 1);
  assert.deepEqual(emitted.nodes[0]?.provider_usage, [{
    provider: 'fixture-provider',
    model: 'fixture-model',
    calls: 1,
    input_tokens: 13,
    output_tokens: 5,
    total_tokens: 18,
  }]);
  assert.equal(emitted.nodes[0]?.node_id, node.id);
  assert.equal(emitted.nodes[0]?.blueprint_version, node.blueprintVersion);
  assert.equal(emitted.nodes[0]?.result, 'succeeded');
  assert.equal(Object.isFrozen(emitted), true);
  assert.equal(Object.isFrozen(emitted.nodes), true);
  assert.equal(Object.isFrozen(emitted.nodes[0]?.provider_usage), true);
});

test('application trace emits a value-free failed node and preserves the original failure', async () => {
  const logger = new PixieCoreLogger();
  const failure = new PixieCoreError(data.text('trace failure message'), 'fixture_failure');
  let emitted: ApplicationTrace | undefined;

  await assert.rejects(
    traceApplication({ onTrace: trace => { emitted = trace; } }, recorder => (
      recorder.runNode({ node: fixtureTraceNode(), logger }, async () => { throw failure; })
    )),
    error => error === failure,
  );

  assert.ok(emitted);
  assert.equal(emitted.result, 'failed');
  assert.equal(emitted.nodes[0]?.result, 'failed');
  assert.equal(emitted.nodes[0]?.error_code, 'fixture_failure');
  assert.doesNotMatch(JSON.stringify(emitted), new RegExp(failure.message));
});

test('application execution keeps fail-fast and recoverable failure ownership explicit', async () => {
  const failure = new PixieCoreError(data.text('node failure message'), 'node_failure');
  const node = fixtureTraceNode();

  await assert.rejects(
    executeApplicationNode({
      node,
      policy: { failureMode: 'fail-fast', retryOwner: 'runtime' },
    }, async () => { throw failure; }),
    error => error === failure,
  );

  const outcome = await executeApplicationNode({
    node,
    policy: { failureMode: 'recoverable', retryOwner: 'host' },
  }, async () => { throw failure; });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.error, failure);
  assert.deepEqual(outcome.failure, {
    node_id: node.id,
    blueprint_version: node.blueprintVersion,
    error_code: 'node_failure',
    attempts: 1,
    retry_owner: 'host',
  });
  assert.equal(Object.isFrozen(outcome.failure), true);
});

test('only application-owned retry policy repeats a selected failure', async () => {
  const retryable = new PixieCoreError(data.text('retryable failure'), 'retryable_failure');
  const attempts: number[] = [];
  const retryChecks: number[] = [];
  const outcome = await executeApplicationNode({
    node: fixtureTraceNode(),
    policy: { failureMode: 'recoverable', retryOwner: 'application', maxAttempts: 3 },
    shouldRetry: (error, attempt) => {
      assert.equal(error, retryable);
      retryChecks.push(attempt);
      return true;
    },
  }, async context => {
    attempts.push(context.attempt);
    if (context.attempt < 3) throw retryable;
    return data.text('retry success');
  });

  assert.deepEqual(attempts, [1, 2, 3]);
  assert.deepEqual(retryChecks, [1, 2]);
  assert.equal(outcome.status, 'succeeded');
  assert.equal(outcome.attempts, 3);
});

test('application cancellation bypasses recovery and retry', async () => {
  const controller = new AbortController();
  const reason = new Error(data.text('custom cancellation reason'));
  let calls = 0;
  controller.abort(reason);

  await assert.rejects(
    executeApplicationNode({
      node: fixtureTraceNode(),
      policy: { failureMode: 'recoverable', retryOwner: 'application', maxAttempts: 2 },
      signal: controller.signal,
      shouldRetry: () => true,
    }, async () => { calls++; }),
    error => error === reason,
  );
  assert.equal(calls, 0);
});

test('application partial result clones outputs and excludes in-memory errors', async () => {
  const failure = new PixieCoreError(data.text('private partial failure'), 'partial_failure');
  const outcome = await executeApplicationNode({
    node: fixtureTraceNode(),
    policy: { failureMode: 'recoverable', retryOwner: 'host' },
  }, async () => { throw failure; });
  assert.equal(outcome.status, 'failed');
  const mutableOutputs = { completed: { count: 1 } };
  const partial = createApplicationPartialResult({
    outputs: mutableOutputs,
    failures: [outcome.failure],
  });
  mutableOutputs.completed.count = 2;

  assert.equal(partial.schema, APPLICATION_PARTIAL_RESULT_SCHEMA);
  assert.equal(partial.result, 'partial');
  assert.deepEqual(partial.outputs, { completed: { count: 1 } });
  assert.equal(Object.isFrozen(partial), true);
  assert.equal(Object.isFrozen(partial.outputs.completed), true);
  assert.doesNotMatch(JSON.stringify(partial), new RegExp(failure.message));
});

test('application execution rejects ambiguous retry ownership', async () => {
  await assert.rejects(
    executeApplicationNode({
      node: fixtureTraceNode(),
      policy: { failureMode: 'fail-fast', retryOwner: 'runtime', maxAttempts: 2 },
    }, async () => undefined),
    error => error instanceof ApplicationContractError
      && /only to application-owned retries/u.test(error.message),
  );
  await assert.rejects(
    executeApplicationNode({
      node: fixtureTraceNode(),
      policy: { failureMode: 'recoverable', retryOwner: 'application', maxAttempts: 2 },
    }, async () => undefined),
    error => error instanceof ApplicationContractError
      && /require shouldRetry/u.test(error.message),
  );
});

test('application execution validates policy discriminants, identity, and attempts', async () => {
  const node = fixtureTraceNode();
  const invalidOptions = [
    {
      node,
      policy: { failureMode: 'unknown', retryOwner: 'runtime' },
    },
    {
      node,
      policy: { failureMode: 'fail-fast', retryOwner: 'unknown' },
    },
    {
      node: { ...node, id: ' ' },
      policy: { failureMode: 'fail-fast', retryOwner: 'runtime' },
    },
    {
      node,
      policy: { failureMode: 'recoverable', retryOwner: 'application', maxAttempts: 0 },
    },
  ] as const;
  for (const options of invalidOptions) {
    await assert.rejects(
      executeApplicationNode(options as never, async () => undefined),
      ApplicationContractError,
    );
  }

  const outcome = await executeApplicationNode({
    node,
    policy: { failureMode: 'recoverable', retryOwner: 'application' },
  }, async () => data.text('single application attempt'));
  assert.equal(outcome.status, 'succeeded');
  assert.equal(outcome.attempts, 1);
});

test('application-owned retry stops when its predicate declines', async () => {
  const failure = new Error(data.text('declined retry failure'));
  let calls = 0;
  const outcome = await executeApplicationNode({
    node: fixtureTraceNode(),
    policy: { failureMode: 'recoverable', retryOwner: 'application', maxAttempts: 3 },
    shouldRetry: () => false,
  }, async () => {
    calls++;
    throw failure;
  });
  assert.equal(calls, 1);
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.failure.error_code, 'Error');
});

test('AbortError propagates even without an explicit signal', async () => {
  const failure = new DOMException(data.text('abort error message'), 'AbortError');
  await assert.rejects(
    executeApplicationNode({
      node: fixtureTraceNode(),
      policy: { failureMode: 'recoverable', retryOwner: 'host' },
    }, async () => { throw failure; }),
    error => error === failure,
  );
});

test('application trace validates identity and cannot accept nodes after completion', async () => {
  assert.throws(() => new ApplicationTraceRecorder(' '), /non-blank/u);
  const recorder = new ApplicationTraceRecorder(data.text('finished trace'));
  const first = recorder.finish('succeeded');
  assert.equal(recorder.finish('failed'), first);
  await assert.rejects(
    recorder.runNode({ node: fixtureTraceNode(), logger: new PixieCoreLogger() }, async () => undefined),
    /already complete/u,
  );
  const cancelled = new ApplicationTraceRecorder(data.text('cancelled trace'))
    .finishFailure(new DOMException(data.text('cancelled trace reason'), 'AbortError'));
  assert.equal(cancelled.result, 'cancelled');
});

test('successful trace callback failures remain callback failures', async () => {
  const callbackFailure = new Error(data.text('trace callback failure'));
  await assert.rejects(
    traceApplication({ onTrace: () => { throw callbackFailure; } }, async () => undefined),
    error => error === callbackFailure,
  );
});

test('partial-result contract validates JSON outputs and value-free failure records', () => {
  const baseFailure = {
    node_id: data.text('partial node'),
    blueprint_version: '1.2.3',
    error_code: data.text('partial error code'),
    attempts: 1,
    retry_owner: 'runtime' as const,
  };
  const complete = createApplicationPartialResult({ outputs: { complete: true } });
  assert.equal(complete.result, 'succeeded');
  assert.deepEqual(complete.failures, []);

  for (const failure of [
    { ...baseFailure, node_id: ' ' },
    { ...baseFailure, attempts: 0 },
    { ...baseFailure, retry_owner: 'unknown' },
  ]) {
    assert.throws(
      () => createApplicationPartialResult({ outputs: {}, failures: [failure as never] }),
      ApplicationContractError,
    );
  }
  assert.throws(
    () => createApplicationPartialResult({ outputs: { invalid: undefined } as never }),
    ApplicationContractError,
  );
});

async function withFixtureNodes(
  task: (nodes: readonly ApplicationNodeDefinition[]) => void | Promise<void>,
): Promise<void> {
  await withTempDirectory(async directory => {
    const sourcePath = join(directory, 'source.yaml');
    const targetPath = join(directory, 'target.yaml');
    await Promise.all([
      writeFile(sourcePath, JSON.stringify({
        name: 'Source',
        version: '1.0.0',
        role: 'extractor',
        prompt: 'Extract a title.',
        output_schema: {
          type: 'object',
          additionalProperties: false,
          required: ['title'],
          properties: { title: { type: 'string' } },
        },
      }), 'utf8'),
      writeFile(targetPath, JSON.stringify({
        name: 'Target',
        version: '1.0.0',
        role: 'summarizer',
        prompt: 'Summarize {headline} in {count} parts.',
        input_placeholders: [
          { name: 'headline', type: 'string', required: true },
          { name: 'count', type: 'integer', required: true },
        ],
        input_schema: {
          type: 'object',
          additionalProperties: false,
          required: ['headline', 'count'],
          properties: {
            headline: { type: 'string', minLength: 1 },
            count: { type: 'integer', minimum: 1 },
          },
        },
        output_schema: {
          type: 'object',
          additionalProperties: false,
          required: ['summary'],
          properties: { summary: { type: 'string' } },
        },
      }), 'utf8'),
    ]);
    await task([
      { id: 'source', blueprintPath: sourcePath, blueprintVersion: '1.0.0' },
      { id: 'target', blueprintPath: targetPath, blueprintVersion: '1.0.0' },
    ]);
  });
}

function fixtureTraceNode(): ApplicationNodeDefinition {
  return {
    id: data.text('trace node ID', 'node'),
    blueprintPath: 'unused-in-trace-test.yaml',
    blueprintVersion: '1.2.3',
  };
}
