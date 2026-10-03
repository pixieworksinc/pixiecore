import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Repository catalog generator is an executable JavaScript module.
import { checkBlueprintSearchCatalog, createBlueprintSearchCatalog } from '../../scripts/generate-blueprint-catalog-site.mjs';
// @ts-expect-error The same dependency-free module is executed directly by browsers.
import { searchBlueprintCatalog } from '../../examples/blueprints/catalog-site/search.mjs';

test('search catalog is deterministic, current, and covers every reference Blueprint', async () => {
  const catalog = await createBlueprintSearchCatalog();
  assert.equal(catalog.schema, 'pixiecore.blueprint-search-catalog/v1');
  assert.equal(catalog.units.length, 8);
  assert.deepEqual(catalog.units.map((unit: { id: string }) => unit.id), [
    'classifier/travel-destination-level',
    'converter/date-normalizer',
    'extractor/travel-document-fields',
    'router/travel-approval-routing',
    'summarizer/travel-request-summary',
    'translator/travel-purpose-localizer',
    'validator/travel-request-form',
    'verifier/travel-document-evidence',
  ]);
  assert.equal(await checkBlueprintSearchCatalog(), true);

  const extractor = catalog.units.find((unit: { id: string }) => (
    unit.id === 'extractor/travel-document-fields'
  ));
  assert.ok(extractor);
  assert.ok(extractor.use_cases.includes('OCR document field extraction'));
  assert.ok(extractor.schema_terms.includes('requested_fields'));
  assert.deepEqual(extractor.providers, ['pixiecore-fixture']);
  assert.equal(extractor.measurements[0]?.kind, 'offline_contract');
  assert.equal(extractor.measurements.length, 1);
});

test('catalog search combines use, schema, quality, provider, license, and score filters', async () => {
  const { units } = await createBlueprintSearchCatalog();
  const ids = (filters: Record<string, unknown>) => searchBlueprintCatalog(units, filters)
    .map((unit: { id: string }) => unit.id);

  assert.deepEqual(ids({ use: 'OCR' }), ['extractor/travel-document-fields']);
  assert.deepEqual(ids({ schema: 'currency' }), [
    'extractor/travel-document-fields',
    'router/travel-approval-routing',
    'summarizer/travel-request-summary',
    'validator/travel-request-form',
    'verifier/travel-document-evidence',
  ]);
  assert.equal(ids({
    quality: 'offline_contract',
    provider: 'pixiecore-fixture',
    license: 'Apache-2.0',
    minScore: 1,
  }).length, 8);
  assert.deepEqual(ids({ quality: 'remote_provider', provider: 'openai' }), []);
  assert.throws(() => ids({ minScore: 1.1 }), /between 0 and 1/);
});
