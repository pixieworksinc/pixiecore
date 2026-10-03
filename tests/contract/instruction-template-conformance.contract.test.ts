import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import {
  findInstructionPlaceholders,
  renderInstructionTemplate,
} from '../../src/core/component/instruction-template/index.js';
import {
  INSTRUCTION_TEMPLATE_ADAPTER_PROTOCOL,
  INSTRUCTION_TEMPLATE_CONFORMANCE_REPORT_SCHEMA,
  runInstructionTemplateConformanceSuite,
} from '../../src/core/kernel/conformance/index.js';

interface InstructionFixture {
  readonly render_cases: readonly {
    readonly id: string;
    readonly template: string;
    readonly inputs: Readonly<Record<string, unknown>>;
    readonly expected: string;
    readonly portable?: boolean;
    readonly extension_id?: string;
  }[];
  readonly validation_cases: readonly {
    readonly id: string;
    readonly template: string;
    readonly declared_inputs: readonly string[];
    readonly expected_undeclared: readonly string[];
  }[];
}

const fixtureUrl = new URL(
  '../../conformance/pixiecore-instruction-template-v1/suite.json',
  import.meta.url,
);
const schemaUrl = new URL(
  '../../schemas/pixiecore.instruction-template-conformance-v1.schema.json',
  import.meta.url,
);
const reportSchemaUrl = new URL(
  '../../schemas/pixiecore.instruction-template-conformance-report-v1.schema.json',
  import.meta.url,
);
const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8')) as InstructionFixture;
const schema = JSON.parse(await readFile(schemaUrl, 'utf8')) as object;
const reportSchema = JSON.parse(await readFile(reportSchemaUrl, 'utf8')) as object;

test('published instruction-template fixture conforms to its data-only schema', () => {
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  assert.equal(validate(fixture), true, JSON.stringify(validate.errors));
});

test('instruction-template schema permits legacy unidentified extensions but rejects portable IDs', () => {
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const missingIdentity = structuredClone(fixture);
  delete (missingIdentity.render_cases.find(item => item.portable === false) as {
    extension_id?: string;
  }).extension_id;
  assert.equal(validate(missingIdentity), true, JSON.stringify(validate.errors));

  const portableIdentity = structuredClone(fixture);
  (portableIdentity.render_cases.find(item => item.portable !== false) as {
    extension_id?: string;
  }).extension_id = 'pixiecore.input-binding.unexpected/v1';
  assert.equal(validate(portableIdentity), false);
});

test('PixieCore passes every published instruction-template render case', async t => {
  for (const item of fixture.render_cases) {
    await t.test(item.id, () => {
      assert.equal(renderInstructionTemplate(item.template, item.inputs), item.expected);
    });
  }
});

test('PixieCore passes every published instruction-template declaration case', async t => {
  for (const item of fixture.validation_cases) {
    await t.test(item.id, () => {
      const declared = new Set(item.declared_inputs);
      const undeclared = [...new Set(
        findInstructionPlaceholders(item.template)
          .map(reference => reference.name)
          .filter(name => !declared.has(name)),
      )];
      assert.deepEqual(undeclared, item.expected_undeclared);
    });
  }
});

test('PixieCore black-box adapter emits a schema-valid passing runtime report', async () => {
  const report = await runInstructionTemplateConformanceSuite({ suite: fixture });
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(reportSchema);

  assert.equal(validate(report), true, JSON.stringify(validate.errors));
  assert.equal(report.adapter_protocol, INSTRUCTION_TEMPLATE_ADAPTER_PROTOCOL);
  assert.equal(report.schema, INSTRUCTION_TEMPLATE_CONFORMANCE_REPORT_SCHEMA);
  assert.equal(report.conformant, true);
  assert.deepEqual(report.summary, {
    total: fixture.render_cases.length + fixture.validation_cases.length,
    passed: fixture.render_cases.length + fixture.validation_cases.length,
    failed: 0,
  });
  assert.deepEqual(report.portable_summary, { total: 7, passed: 7, failed: 0 });
  assert.deepEqual(report.extension_summary, { total: 2, passed: 2, failed: 0 });
  assert.deepEqual(
    report.cases.filter(item => !item.portable).map(item => item.extension_id),
    [
      'pixiecore.input-binding.single-brace/v1',
      'pixiecore.input-binding.flat-dotted-name/v1',
    ],
  );
  for (const item of report.cases) {
    assert.equal(item.passed, true, item.id);
    if (item.kind === 'render') {
      assert.equal(item.observed.blueprint_role, 'assistant');
      assert.equal(item.observed.effective_message_role, 'user');
      assert.equal(item.observed.provider_request_count, 1);
      continue;
    }
    assert.equal(
      item.observed.provider_request_count,
      item.observed.accepted ? 1 : 0,
    );
  }
});

test('PixieCore black-box adapter reports a changed portable expectation as nonconformant', async () => {
  const changedFixture = {
    ...fixture,
    render_cases: fixture.render_cases.map((item, index) => index === 0
      ? { ...item, expected: 'intentionally different' }
      : item),
  };
  const report = await runInstructionTemplateConformanceSuite({ suite: changedFixture });

  assert.equal(report.conformant, false);
  assert.equal(report.summary.failed, 1);
  assert.equal(report.portable_summary.failed, 1);
  assert.equal(report.cases[0]?.passed, false);
});

test('extension failures remain visible without invalidating portable conformance', async () => {
  const changedFixture = {
    ...fixture,
    render_cases: fixture.render_cases.map(item => item.id === 'legacy.single-brace'
      ? { ...item, expected: 'intentionally different' }
      : item),
  };
  const report = await runInstructionTemplateConformanceSuite({ suite: changedFixture });

  assert.equal(report.conformant, true);
  assert.equal(report.portable_summary.failed, 0);
  assert.equal(report.extension_summary.failed, 1);
  assert.equal(report.summary.failed, 1);
});
