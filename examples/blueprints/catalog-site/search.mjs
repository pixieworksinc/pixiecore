/**
 * @typedef {object} CatalogMeasurement
 * @property {string} kind
 * @property {string} provider
 * @property {number} score
 * @property {number} passed_cases
 * @property {number} total_cases
 * @property {'current'|'historical'} [evidence_status]
 */

/**
 * @typedef {object} CatalogUnit
 * @property {string} id
 * @property {string} name
 * @property {string} role_family
 * @property {readonly string[]} use_cases
 * @property {readonly string[]} schema_terms
 * @property {string} license
 * @property {readonly CatalogMeasurement[]} measurements
 */

/**
 * @typedef {object} CatalogFilters
 * @property {unknown} [use]
 * @property {unknown} [schema]
 * @property {unknown} [quality]
 * @property {unknown} [provider]
 * @property {unknown} [license]
 * @property {unknown} [minScore]
 */

/**
 * @template {CatalogUnit} T
 * @param {readonly T[]} units
 * @param {CatalogFilters} [filters]
 * @returns {T[]}
 */
export function searchBlueprintCatalog(units, filters = {}) {
  if (!Array.isArray(units)) throw new TypeError('Catalog units must be an array');
  const query = normalize(filters.use);
  const schema = normalize(filters.schema);
  const quality = normalize(filters.quality);
  const provider = normalize(filters.provider);
  const license = normalize(filters.license);
  const minScore = parseMinScore(filters.minScore);

  return units.filter(unit => {
    if (query && !includesText([
      unit.id,
      unit.name,
      unit.role_family,
      ...(unit.use_cases ?? []),
    ], query)) return false;
    if (schema && !includesText(unit.schema_terms ?? [], schema)) return false;
    if (license && normalize(unit.license) !== license) return false;
    return (/** @type {readonly CatalogMeasurement[]} */ (unit.measurements ?? []))
      .some(measurement => (
      measurement.evidence_status !== 'historical'
      &&
      (!quality || normalize(measurement.kind) === quality)
      && (!provider || normalize(measurement.provider) === provider)
      && (minScore === undefined || measurement.score >= minScore)
      ));
  }).sort((left, right) => left.id.localeCompare(right.id));
}

/** @param {readonly string[]} values @param {string} query */
function includesText(values, query) {
  return values.some(value => normalize(value).includes(query));
}

/** @param {unknown} value */
function normalize(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** @param {unknown} value */
function parseMinScore(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new TypeError('Minimum score must be between 0 and 1');
  }
  return number;
}
