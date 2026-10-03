import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import YAML from 'yaml';
import {
  PUBLICATION_BRIEF_NODES,
} from '../../examples/application-composition/publication-brief.js';
import {
  CUSTOMER_INQUIRY_NODES,
} from '../../examples/application-composition/customer-inquiry.js';
import {
  INVOICE_REVIEW_NODES,
} from '../../examples/application-composition/invoice-review.js';
import {
  TRAVEL_APPROVAL_NODES,
} from '../../examples/application-composition/travel-approval.js';
import { BlueprintValidator } from '../../src/index.js';

const sourceUrl = new URL(
  '../../examples/application-composition/publication-brief.ts',
  import.meta.url,
);

test('reference composer depends only on the public PixieCore entry point', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const specifiers = [...source.matchAll(/from\s+['"]([^'"]+)['"]/gu)]
    .map(match => match[1]);

  assert.deepEqual(specifiers, ['node:url', '@pixieworks/pixiecore', '@pixieworks/pixiecore/application']);
  assert.doesNotMatch(source, /(?:\.\.\/)+src\//u);
  assert.doesNotMatch(source, /pixiecore\/(?:core|internal)/u);
});

test('reference composer defines five independent version-matched Blueprints', async () => {
  assert.equal(PUBLICATION_BRIEF_NODES.length, 5);
  assert.equal(new Set(PUBLICATION_BRIEF_NODES.map(node => node.id)).size, 5);

  const applicationDirectory = dirname(fileURLToPath(sourceUrl));
  const validator = new BlueprintValidator({ warn: () => undefined });
  for (const node of PUBLICATION_BRIEF_NODES) {
    const pathFromApplication = relative(applicationDirectory, node.blueprintPath);
    assert.equal(
      pathFromApplication === '..'
        || pathFromApplication.startsWith(`..${sep}`),
      false,
      `${node.id} must resolve inside its application example`,
    );
    const blueprint = await validator.validateFile(node.blueprintPath);
    assert.equal(blueprint.version, node.blueprintVersion);
  }
});

test('every reference-composer Blueprint has a valid standalone evaluation dataset', async () => {
  const applicationDirectory = dirname(fileURLToPath(sourceUrl));
  const evaluationDirectory = join(applicationDirectory, 'evaluations');
  const filenames = (await readdir(evaluationDirectory))
    .filter(filename => filename.endsWith('.yaml'))
    .sort();
  assert.equal(filenames.length, PUBLICATION_BRIEF_NODES.length);

  const schema = JSON.parse(await readFile(
    new URL('../../schemas/pixiecore.blueprint-eval-dataset-v1.schema.json', import.meta.url),
    'utf8',
  )) as object;
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  for (const filename of filenames) {
    const dataset = YAML.parse(await readFile(join(evaluationDirectory, filename), 'utf8')) as {
      blueprint?: { path?: unknown; version?: unknown };
    };
    assert.equal(validate(dataset), true, `${filename}: ${JSON.stringify(validate.errors)}`);
    const reference = dataset.blueprint;
    if (!reference || typeof reference.path !== 'string') {
      throw new TypeError(`${filename}: missing Blueprint path`);
    }
    const path = join(evaluationDirectory, reference.path);
    const blueprint = await new BlueprintValidator({ warn: () => undefined }).validateFile(path);
    assert.equal(blueprint.version, reference.version);
  }
});

test('customer inquiry composer is public-API-only with five version-matched evaluation units', async () => {
  const customerSourceUrl = new URL(
    '../../examples/application-composition/customer-inquiry.ts',
    import.meta.url,
  );
  const source = await readFile(customerSourceUrl, 'utf8');
  const specifiers = [...source.matchAll(/from\s+['"]([^'"]+)['"]/gu)]
    .map(match => match[1]);
  assert.deepEqual(specifiers, ['node:url', '@pixieworks/pixiecore', '@pixieworks/pixiecore/application']);
  assert.doesNotMatch(source, /(?:\.\.\/)+src\//u);
  assert.doesNotMatch(source, /pixiecore\/(?:core|internal)/u);
  assert.equal(CUSTOMER_INQUIRY_NODES.length, 5);
  assert.equal(new Set(CUSTOMER_INQUIRY_NODES.map(node => node.id)).size, 5);

  const applicationDirectory = dirname(fileURLToPath(customerSourceUrl));
  const evaluationDirectory = join(applicationDirectory, 'customer-inquiry', 'evaluations');
  const schema = JSON.parse(await readFile(
    new URL('../../schemas/pixiecore.blueprint-eval-dataset-v1.schema.json', import.meta.url),
    'utf8',
  )) as object;
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const filenames = (await readdir(evaluationDirectory))
    .filter(filename => filename.endsWith('.yaml'))
    .sort();
  assert.equal(filenames.length, CUSTOMER_INQUIRY_NODES.length);

  for (const node of CUSTOMER_INQUIRY_NODES) {
    const blueprint = await new BlueprintValidator({ warn: () => undefined })
      .validateFile(node.blueprintPath);
    assert.equal(blueprint.version, node.blueprintVersion);
    const datasetPath = join(evaluationDirectory, `${node.id}.yaml`);
    const dataset = YAML.parse(await readFile(datasetPath, 'utf8')) as {
      blueprint?: { path?: unknown; version?: unknown };
    };
    assert.equal(validate(dataset), true, `${node.id}: ${JSON.stringify(validate.errors)}`);
    assert.equal(dataset.blueprint?.version, node.blueprintVersion);
  }
});

test('invoice review composer is public-API-only with five version-matched evaluation units', async () => {
  const invoiceSourceUrl = new URL(
    '../../examples/application-composition/invoice-review.ts',
    import.meta.url,
  );
  const source = await readFile(invoiceSourceUrl, 'utf8');
  const specifiers = [...source.matchAll(/from\s+['"]([^'"]+)['"]/gu)]
    .map(match => match[1]);
  assert.deepEqual(specifiers, ['node:url', '@pixieworks/pixiecore', '@pixieworks/pixiecore/application']);
  assert.doesNotMatch(source, /(?:\.\.\/)+src\//u);
  assert.doesNotMatch(source, /pixiecore\/(?:core|internal)/u);
  assert.equal(INVOICE_REVIEW_NODES.length, 5);
  assert.equal(new Set(INVOICE_REVIEW_NODES.map(node => node.id)).size, 5);

  const applicationDirectory = dirname(fileURLToPath(invoiceSourceUrl));
  const evaluationDirectory = join(applicationDirectory, 'invoice-review', 'evaluations');
  const schema = JSON.parse(await readFile(
    new URL('../../schemas/pixiecore.blueprint-eval-dataset-v1.schema.json', import.meta.url),
    'utf8',
  )) as object;
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const filenames = (await readdir(evaluationDirectory))
    .filter(filename => filename.endsWith('.yaml'))
    .sort();
  assert.equal(filenames.length, INVOICE_REVIEW_NODES.length);

  for (const node of INVOICE_REVIEW_NODES) {
    const blueprint = await new BlueprintValidator({ warn: () => undefined })
      .validateFile(node.blueprintPath);
    assert.equal(blueprint.version, node.blueprintVersion);
    const datasetPath = join(evaluationDirectory, `${node.id}.yaml`);
    const dataset = YAML.parse(await readFile(datasetPath, 'utf8')) as {
      blueprint?: { version?: unknown };
    };
    assert.equal(validate(dataset), true, `${node.id}: ${JSON.stringify(validate.errors)}`);
    assert.equal(dataset.blueprint?.version, node.blueprintVersion);
  }
});

test('monolithic comparison is public-API-only and preserves the intentional five-operation contrast', async () => {
  const comparisonUrl = new URL(
    '../../examples/comparison/publication-brief/compare.ts',
    import.meta.url,
  );
  const source = await readFile(comparisonUrl, 'utf8');
  const specifiers = [...source.matchAll(/from\s+['"]([^'"]+)['"]/gu)]
    .map(match => match[1]);
  assert.deepEqual(specifiers, [
    'node:url',
    'node:path',
    '@pixieworks/pixiecore',
    '../../application-composition/publication-brief.js',
  ]);
  assert.doesNotMatch(source, /(?:\.\.\/)+src\//u);
  assert.doesNotMatch(source, /pixiecore\/(?:core|internal)/u);

  const blueprintPath = fileURLToPath(new URL(
    '../../examples/comparison/publication-brief/monolithic-publication-brief.yaml',
    import.meta.url,
  ));
  const blueprint = await new BlueprintValidator({ warn: () => undefined })
    .validateFile(blueprintPath);
  assert.equal(blueprint.version, '1.0.1');
  assert.equal(blueprint.role, 'assistant');
  assert.equal(
    typeof blueprint.output_schema === 'object'
      && Object.hasOwn(blueprint.output_schema, 'properties'),
    true,
  );
  for (const operation of ['Extract', 'Classify', 'summary', 'Validate', 'Localize']) {
    assert.match(blueprint.prompt, new RegExp(operation, 'iu'));
  }
});

test('travel approval composer uses only public PixieCore and all eight catalog units', async () => {
  const travelSourceUrl = new URL(
    '../../examples/application-composition/travel-approval.ts',
    import.meta.url,
  );
  const source = await readFile(travelSourceUrl, 'utf8');
  const specifiers = [...source.matchAll(/from\s+['"]([^'"]+)['"]/gu)]
    .map(match => match[1]);
  assert.deepEqual(specifiers, ['node:url', '@pixieworks/pixiecore', '@pixieworks/pixiecore/application']);
  assert.doesNotMatch(source, /(?:\.\.\/)+src\//u);
  assert.doesNotMatch(source, /pixiecore\/(?:core|internal)/u);

  assert.equal(TRAVEL_APPROVAL_NODES.length, 9, 'two independent dates reuse one Converter');
  assert.equal(new Set(TRAVEL_APPROVAL_NODES.map(node => node.id)).size, 9);
  assert.equal(new Set(TRAVEL_APPROVAL_NODES.map(node => node.blueprintPath)).size, 8);

  const libraryRoot = fileURLToPath(new URL('../../examples/blueprints/', import.meta.url));
  const catalog = YAML.parse(await readFile(join(libraryRoot, 'catalog.yaml'), 'utf8')) as {
    units: readonly { path: string; version: string; status: string }[];
  };
  const activeUnits = new Map(catalog.units
    .filter(unit => unit.status === 'active')
    .map(unit => [unit.path, unit.version]));
  const validator = new BlueprintValidator({ warn: () => undefined });

  for (const node of TRAVEL_APPROVAL_NODES) {
    const pathFromLibrary = relative(libraryRoot, node.blueprintPath).replaceAll('\\', '/');
    assert.equal(pathFromLibrary.startsWith('../'), false, `${node.id}: library containment`);
    assert.equal(activeUnits.get(pathFromLibrary), node.blueprintVersion, `${node.id}: catalog pin`);
    const blueprint = await validator.validateFile(node.blueprintPath);
    assert.equal(blueprint.version, node.blueprintVersion, `${node.id}: Blueprint pin`);
  }
});
