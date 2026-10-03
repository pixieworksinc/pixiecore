import { searchBlueprintCatalog } from './search.mjs';

/** @typedef {import('./search.mjs').CatalogUnit} CatalogUnit */
/**
 * @typedef {CatalogUnit & {
 *   version: string,
 *   providers: readonly string[]
 * }} DisplayCatalogUnit
 */

const response = await fetch('./catalog.json');
if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`);
const catalog = /** @type {{ units: DisplayCatalogUnit[] }} */ (await response.json());
const controls = /** @type {HTMLFormElement} */ (document.querySelector('#filters'));
const results = /** @type {HTMLElement} */ (document.querySelector('#results'));
const count = /** @type {HTMLElement} */ (document.querySelector('#result-count'));

populateSelect(
  'quality',
  catalog.units.flatMap(unit => unit.measurements.map(item => item.kind)),
);
populateSelect('provider', catalog.units.flatMap(unit => unit.providers));
populateSelect('license', catalog.units.map(unit => unit.license));

controls.addEventListener('input', render);
render();

function render() {
  const data = new FormData(controls);
  const matches = searchBlueprintCatalog(catalog.units, {
    use: data.get('use'),
    schema: data.get('schema'),
    quality: data.get('quality'),
    provider: data.get('provider'),
    license: data.get('license'),
    minScore: data.get('minScore'),
  });
  count.textContent = `${matches.length} Blueprint${matches.length === 1 ? '' : 's'}`;
  results.replaceChildren(...matches.map(renderUnit));
}

/** @param {DisplayCatalogUnit} unit */
function renderUnit(unit) {
  const article = document.createElement('article');
  const heading = document.createElement('h2');
  heading.textContent = unit.name;
  const identity = document.createElement('code');
  identity.textContent = `${unit.id} @ ${unit.version}`;
  const useCases = document.createElement('p');
  useCases.textContent = unit.use_cases.join(' · ');
  const facts = document.createElement('dl');
  addFact(facts, 'Role', unit.role_family);
  addFact(facts, 'License', unit.license);
  addFact(facts, 'Provider', unit.providers.join(', '));
  addFact(
    facts,
    'Quality',
    unit.measurements
      .map(item => `${item.kind}${item.evidence_status === 'historical' ? ' (historical)' : ''}: ${(item.score * 100).toFixed(0)}% (${item.passed_cases}/${item.total_cases})`)
      .join(', '),
  );
  article.append(heading, identity, useCases, facts);
  return article;
}

/** @param {HTMLDListElement} list @param {string} label @param {string} value */
function addFact(list, label, value) {
  const term = document.createElement('dt');
  term.textContent = label;
  const description = document.createElement('dd');
  description.textContent = value;
  list.append(term, description);
}

/** @param {string} name @param {readonly string[]} values */
function populateSelect(name, values) {
  const select = /** @type {HTMLSelectElement} */ (controls.elements.namedItem(name));
  for (const value of [...new Set(values)].sort()) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
}
