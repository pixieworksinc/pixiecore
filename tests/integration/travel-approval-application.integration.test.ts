import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import YAML from 'yaml';
import {
  composeTravelApproval,
  TravelApprovalNodeError,
  type TravelApprovalInput,
} from '../../examples/application-composition/travel-approval.js';
import type { GenerateRequest, GenerateResponse } from '../../src/index.js';
import type { ApplicationTrace } from '../../src/core/kernel/application/index.js';
import { ScriptedProvider, type ResponseScript } from '../helpers/fake-provider.js';
import { testData } from '../helpers/test-data.js';

const data = testData('travel approval application integration');
const fixtureRoot = 'examples/blueprints';

test('travel approval application composes eight Role families with explicit mappings', async () => {
  const input = await canonicalInput();
  const controller = new AbortController();
  const expected = canonicalOutputs(input);
  const traceId = data.text('travel trace ID', 'trace');
  let trace: ApplicationTrace | undefined;
  const provider = new CloseAwareProvider(expected.responses.map(output =>
    response(output, controller.signal)));

  const result = await composeTravelApproval(input, {
    runtimeOptions: runtimeOptions(provider),
    signal: controller.signal,
    traceId,
    onTrace: value => { trace = value; },
  });

  assert.equal(provider.calls.length, 9);
  assert.equal(provider.closeCalls, 1);
  assert.deepEqual(result, expected.result);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.extraction.fields), true);
  assert.equal(Object.isFrozen(result.verification.field_results), true);
  assert.equal(Object.isFrozen(result.localization.changes), true);
  assert.ok(trace);
  assert.equal(trace.trace_id, traceId);
  assert.equal(trace.result, 'succeeded');
  assert.equal(trace.nodes.length, 9);
  assert.deepEqual(trace.nodes.map(node => node.node_id), [
    'extract-document',
    'normalize-start-date',
    'normalize-end-date',
    'classify-destination',
    'validate-form',
    'verify-evidence',
    'summarize-request',
    'localize-summary',
    'route-approval',
  ]);
  assert.equal(trace.nodes.every(node => node.provider_usage[0]?.total_tokens === 9), true);

  assert.match(lastPrompt(provider.calls[0]!), /document_number/);
  assert.match(lastPrompt(provider.calls[1]!), new RegExp(escapeRegExp(input.form.startDateText)));
  assert.match(lastPrompt(provider.calls[2]!), new RegExp(escapeRegExp(input.form.endDateText)));
  assert.match(lastPrompt(provider.calls[3]!), new RegExp(escapeRegExp(input.form.destinationCity)));
  assert.match(lastPrompt(provider.calls[4]!), /2026-09-14/);
  assert.match(lastPrompt(provider.calls[5]!), new RegExp(escapeRegExp(input.form.documentNumber)));
  assert.match(lastPrompt(provider.calls[6]!), /Evidence verification: verified/);
  assert.match(lastPrompt(provider.calls[7]!), /Northstar Labs/);
  assert.match(lastPrompt(provider.calls[8]!), /route:level-a-standard/);
});

test('travel approval application fails fast with verifier identity and cause', async () => {
  const input = await canonicalInput();
  const expected = canonicalOutputs(input);
  const failure = new Error(data.text('verification provider failure', 'failure'));
  const responses: ResponseScript[] = [
    ...expected.responses.slice(0, 5),
    () => { throw failure; },
  ];
  const provider = new CloseAwareProvider(responses);

  await assert.rejects(
    composeTravelApproval(input, { runtimeOptions: runtimeOptions(provider) }),
    error => {
      assert.ok(error instanceof TravelApprovalNodeError);
      assert.equal(error.node.id, 'verify-evidence');
      assert.equal(error.node.blueprintVersion, '1.0.1');
      assert.deepEqual(error.inputFields, [
        'comparison_policy',
        'extracted_fields',
        'submitted_fields',
      ]);
      assert.equal(error.cause, failure);
      return true;
    },
  );
  assert.equal(provider.calls.length, 6, 'nodes after verifier failure must not start');
  assert.equal(provider.closeCalls, 1);
});

test('travel approval application treats a non-converted date as a domain stop', async () => {
  const input = await canonicalInput();
  const expected = canonicalOutputs(input);
  const provider = new CloseAwareProvider([
    expected.responses[0]!,
    {
      content: JSON.stringify({
        status: 'ambiguous',
        normalized_date: null,
        reason_code: 'ambiguous_numeric_order',
      }),
    },
  ]);

  await assert.rejects(
    composeTravelApproval(input, { runtimeOptions: runtimeOptions(provider) }),
    error => {
      assert.ok(error instanceof TravelApprovalNodeError);
      assert.equal(error.node.id, 'normalize-start-date');
      assert.match(String(error.cause), /did not produce a normalized date/);
      return true;
    },
  );
  assert.equal(provider.calls.length, 2);
  assert.equal(provider.closeCalls, 1);
});

test('travel approval application does not start a node after cancellation', async () => {
  const input = await canonicalInput();
  const provider = new CloseAwareProvider([]);
  const controller = new AbortController();
  const reason = new Error(data.text('travel abort reason', 'abort'));
  let trace: ApplicationTrace | undefined;
  controller.abort(reason);

  await assert.rejects(
    composeTravelApproval(input, {
      runtimeOptions: runtimeOptions(provider),
      signal: controller.signal,
      onTrace: value => { trace = value; },
    }),
    error => {
      assert.ok(error instanceof TravelApprovalNodeError);
      assert.equal(error.node.id, 'extract-document');
      assert.equal(error.cause, reason);
      return true;
    },
  );
  assert.equal(provider.calls.length, 0);
  assert.equal(provider.closeCalls, 1);
  assert.equal(trace?.result, 'cancelled');
  assert.equal(trace?.nodes[0]?.result, 'cancelled');
});

test('travel approval application rejects attachment ambiguity before acquiring a runtime', async () => {
  const input = await canonicalInput();
  const provider = new CloseAwareProvider([]);

  await assert.rejects(
    composeTravelApproval({
      ...input,
      attachment: { filePath: null, imagePath: null },
    }, { runtimeOptions: runtimeOptions(provider) }),
    /Exactly one of attachment\.filePath or attachment\.imagePath is required/,
  );
  assert.equal(provider.calls.length, 0);
  assert.equal(provider.closeCalls, 0);
});

async function canonicalInput(): Promise<TravelApprovalInput> {
  const [travelPolicy, validationRules, comparisonPolicy, localizationPolicy, routingCsv] = await Promise.all([
    readYaml(`${fixtureRoot}/classifier/travel-destination-level/fixtures/travel-policy-v1.yaml`),
    readYaml(`${fixtureRoot}/validator/travel-request-form/fixtures/travel-form-rules-v1.yaml`),
    readYaml(`${fixtureRoot}/verifier/travel-document-evidence/fixtures/verification-policy-v1.yaml`),
    readYaml(`${fixtureRoot}/translator/travel-purpose-localizer/fixtures/localization-policy-v1.yaml`),
    readFile(`${fixtureRoot}/router/travel-approval-routing/fixtures/travel-approval-routing-v1.csv`, 'utf8'),
  ]);
  return {
    attachment: {
      filePath: `${fixtureRoot}/extractor/travel-document-fields/fixtures/native-text.pdf`,
      imagePath: null,
    },
    form: {
      employeeId: `EMP-${data.integer('employee digits', 100000, 999999)}`,
      travelerName: data.text('traveler name', 'Traveler'),
      documentNumber: data.text('document number', 'TR'),
      purpose: 'Northstar Labs customer planning workshop',
      startDateText: '2026年9月14日',
      endDateText: '2026年9月18日',
      destinationCity: 'New York',
      destinationCountryCode: 'US',
      estimatedCost: 2840.5,
      currency: 'USD',
    },
    travelPolicy,
    validationRules,
    comparisonPolicy,
    localizationPolicy,
    target: { language: 'ja', locale: 'ja-JP' },
    routingTableVersion: '2026.1.0',
    routingCsv,
    maxSummaryCharacters: 300,
    approvalNotes: ['Customer renewal meeting'],
    protectedTerms: [{ kind: 'organization', value: 'Northstar Labs' }],
  };
}

function canonicalOutputs(input: TravelApprovalInput) {
  const source = (text: string, page = 1) => ({ page, evidence_text: text });
  const evidence = (text: string, page = 1) => ({ page, text });
  const extraction = {
    status: 'complete',
    document_type: 'travel_request',
    fields: [
      { name: 'traveler_name', status: 'extracted', value: input.form.travelerName, source: source(input.form.travelerName) },
      { name: 'document_number', status: 'extracted', value: input.form.documentNumber, source: source(input.form.documentNumber) },
      { name: 'trip_start_date', status: 'extracted', value: '2026-09-14', source: source('Start: 2026-09-14') },
      { name: 'trip_end_date', status: 'extracted', value: '2026-09-18', source: source('End: 2026-09-18') },
      { name: 'destination', status: 'extracted', value: 'New York, US', source: source('Destination: New York, US') },
      { name: 'business_purpose', status: 'extracted', value: input.form.purpose, source: source(input.form.purpose) },
      { name: 'estimated_amount', status: 'extracted', value: '2840.5', source: source('Total: 2840.5', 2) },
      { name: 'currency', status: 'extracted', value: 'USD', source: source('Currency: USD', 2) },
    ],
    warnings: [],
  } as const;
  const startDate = { status: 'converted', normalized_date: '2026-09-14', reason_code: 'none' } as const;
  const endDate = { status: 'converted', normalized_date: '2026-09-18', reason_code: 'none' } as const;
  const classification = {
    status: 'classified',
    level: 'A',
    canonical_city: 'New York',
    country_code: 'US',
    matched_rule: 'city:new-york-us',
    reason_code: 'listed_location',
    policy_version: '2026.1.0',
    candidates: [],
  } as const;
  const fieldOrder = [
    'employee_id', 'purpose', 'start_date', 'end_date',
    'destination_country_code', 'estimated_cost', 'currency',
  ];
  const validation = {
    form_valid: true,
    rules_version: '2026.1.0',
    field_results: fieldOrder.map(field => ({ field, valid: true, error_codes: [] })),
  };
  const verification = {
    overall_status: 'verified',
    policy_version: '2026.1.0',
    field_results: [
      matched('traveler_name', input.form.travelerName, evidence(input.form.travelerName)),
      matched('document_number', input.form.documentNumber, evidence(input.form.documentNumber)),
      matched('start_date', '2026-09-14', evidence('Start: 2026-09-14')),
      matched('end_date', '2026-09-18', evidence('End: 2026-09-18')),
      matched('total_amount', 2840.5, evidence('Total: 2840.5', 2)),
      matched('currency', 'USD', evidence('Currency: USD', 2)),
    ],
  } as const;
  const summaryText = 'Northstar Labs customer planning workshop in New York, US from 2026-09-14 to 2026-09-18. Estimated cost: USD 2840.5. Destination policy level A; form valid; evidence verified.';
  const summary = {
    status: 'summarized',
    summary: summaryText,
    character_count: [...summaryText].length,
    claims: [
      {
        text: 'Northstar Labs customer planning workshop in New York, US from 2026-09-14 to 2026-09-18.',
        source_fields: ['request.purpose', 'request.start_date', 'request.end_date', 'request.destinations'],
      },
      {
        text: 'Estimated cost: USD 2840.5.',
        source_fields: ['request.total_cost.amount', 'request.total_cost.currency'],
      },
      {
        text: 'Destination policy level A; form valid; evidence verified.',
        source_fields: ['request.approval_notes'],
      },
    ],
    omitted_source_fields: [],
    missing_source_fields: [],
  } as const;
  const localizedText = 'Northstar Labsの顧客計画ワークショップを、2026-09-14から2026-09-18までNew York, USで実施します。見積費用はUSD 2840.5です。目的地レベルA、フォーム有効、証憑照合済みです。';
  const localization = {
    status: 'localized',
    localized_text: localizedText,
    source_language: 'en',
    target_language: 'ja',
    target_locale: 'ja-JP',
    policy_version: '2026.1.0',
    protected_term_results: [
      { kind: 'place', value: 'New York', preserved: true, source_occurrences: 1, output_occurrences: 1 },
      { kind: 'organization', value: 'Northstar Labs', preserved: true, source_occurrences: 1, output_occurrences: 1 },
    ],
    changes: [{
      kind: 'translation',
      source_fragment: 'customer planning workshop',
      localized_fragment: '顧客計画ワークショップ',
    }],
  } as const;
  const routing = {
    status: 'routed',
    next_user: 'supervisor-a@example.test',
    matched_rule: 'route:level-a-standard',
    matched_priority: 20,
    reason_code: 'best_priority_match',
    routing_table_version: '2026.1.0',
    candidates: [],
  } as const;
  const responses = [
    extraction, startDate, endDate, classification, validation,
    verification, summary, localization, routing,
  ].map(output => ({ content: JSON.stringify(output) }));
  return {
    responses,
    result: {
      extraction,
      startDate,
      endDate,
      classification,
      validation,
      verification,
      summary,
      localization,
      routing,
    },
  };
}

function matched(field: string, value: string | number, evidence: { page: number; text: string }) {
  return {
    field,
    status: 'matched',
    submitted_value: value,
    extracted_value: value,
    evidence,
    reason_code: 'exact_match',
  };
}

class CloseAwareProvider extends ScriptedProvider {
  closeCalls = 0;

  close(): void {
    this.closeCalls++;
  }
}

function response(
  output: GenerateResponse,
  signal: AbortSignal,
): (request: GenerateRequest) => GenerateResponse {
  return request => {
    assert.equal(request.signal, signal);
    return {
      ...output,
      usage: { inputTokens: 6, outputTokens: 3, totalTokens: 9 },
    };
  };
}

function runtimeOptions(provider: CloseAwareProvider) {
  return {
    provider,
    maxRetry: 0,
    mcpConfigPath: 'disabled' as const,
    pluginConfigPath: 'disabled' as const,
  };
}

async function readYaml(path: string): Promise<Record<string, unknown>> {
  return YAML.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

function lastPrompt(request: GenerateRequest): string {
  const content = request.messages.at(-1)?.content;
  if (typeof content === 'string') return content;
  if (!content) throw new TypeError('Expected a user prompt');
  return content.filter(part => part.type === 'text').map(part => part.text).join('');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
