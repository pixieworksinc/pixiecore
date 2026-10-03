#!/usr/bin/env node

/**
 * Compares two independent instruction-template adapter reports.
 *
 * The runner treats portable cases as the compatibility claim and reports
 * implementation extensions separately. It never loads either runtime.
 */

import { readFile, realpath } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';

const COMPARISON_SCHEMA =
  'pixiecore.instruction-template-cross-runtime-comparison/v1';

/**
 * Builds one value-free comparison from two validated adapter reports.
 *
 * @param {Record<string, unknown>} baseline First runtime report.
 * @param {Record<string, unknown>} candidate Independently produced report.
 * @returns {Record<string, unknown>} Schema-valid comparison report.
 */
export function compareInstructionTemplateReports(baseline, candidate) {
  assertSameProtocol(baseline, candidate);
  assertIndependentImplementations(baseline, candidate);

  const baselineCases = indexCases(baseline.cases, 'baseline');
  const candidateCases = indexCases(candidate.cases, 'candidate');
  assertSameCaseSet(baselineCases, candidateCases);

  const cases = [...baselineCases.values()].map((baselineCase) => {
    const candidateCase = candidateCases.get(baselineCase.id);
    if (!candidateCase) throw new TypeError(`Candidate report is missing case ${baselineCase.id}`);
    assertSameCaseContract(baselineCase, candidateCase);
    const expectedEqual = isDeepStrictEqual(baselineCase.expected, candidateCase.expected);
    const observedEqual = isDeepStrictEqual(baselineCase.observed, candidateCase.observed);
    return Object.freeze({
      id: baselineCase.id,
      kind: baselineCase.kind,
      portable: baselineCase.portable,
      ...(baselineCase.extension_id === undefined
        ? {}
        : { extension_id: baselineCase.extension_id }),
      baseline_passed: baselineCase.passed,
      candidate_passed: candidateCase.passed,
      expected_equal: expectedEqual,
      observed_equal: observedEqual,
      passed: baselineCase.passed && candidateCase.passed && expectedEqual && observedEqual,
    });
  });
  const portableSummary = summarize(cases.filter(item => item.portable));
  const extensionSummary = summarize(cases.filter(item => !item.portable));
  return Object.freeze({
    schema: COMPARISON_SCHEMA,
    adapter_protocol: baseline.adapter_protocol,
    suite: baseline.suite,
    capability: baseline.capability,
    baseline: baseline.implementation,
    candidate: candidate.implementation,
    portable_summary: portableSummary,
    extension_summary: extensionSummary,
    cases: Object.freeze(cases),
    compatible: portableSummary.failed === 0,
  });
}

function assertSameProtocol(baseline, candidate) {
  for (const field of ['adapter_protocol', 'suite', 'capability']) {
    if (baseline[field] !== candidate[field]) {
      throw new TypeError(`Adapter reports disagree on ${field}`);
    }
  }
}

function assertIndependentImplementations(baseline, candidate) {
  const baselineName = baseline.implementation.name.trim().toLowerCase();
  const candidateName = candidate.implementation.name.trim().toLowerCase();
  if (baselineName === candidateName) {
    throw new TypeError('Cross-runtime comparison requires two distinct implementation names');
  }
}

function indexCases(cases, label) {
  const result = new Map();
  for (const item of cases) {
    if (result.has(item.id)) throw new TypeError(`${label} report repeats case ${item.id}`);
    result.set(item.id, item);
  }
  return result;
}

function assertSameCaseSet(baseline, candidate) {
  if (baseline.size !== candidate.size) {
    throw new TypeError('Adapter reports contain different case counts');
  }
  for (const id of baseline.keys()) {
    if (!candidate.has(id)) throw new TypeError(`Candidate report is missing case ${id}`);
  }
}

function assertSameCaseContract(baseline, candidate) {
  if (baseline.kind !== candidate.kind
      || baseline.portable !== candidate.portable
      || baseline.extension_id !== candidate.extension_id) {
    throw new TypeError(`Adapter reports disagree on case contract ${baseline.id}`);
  }
}

function summarize(cases) {
  const passed = cases.filter(item => item.passed).length;
  return Object.freeze({ total: cases.length, passed, failed: cases.length - passed });
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new TypeError(`Cannot read ${label} report: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}

async function main(args) {
  const baselinePath = optionValue(args, '--baseline');
  const candidatePath = optionValue(args, '--candidate');
  if (!baselinePath || !candidatePath) {
    throw new TypeError(
      'Usage: compare-instruction-template-reports.mjs --baseline <report.json> --candidate <report.json>',
    );
  }
  const [reportSchema, comparisonSchema, baseline, candidate] = await Promise.all([
    readJson(
      new URL('../../schemas/pixiecore.instruction-template-conformance-report-v1.schema.json', import.meta.url),
      'adapter schema',
    ),
    readJson(
      new URL('../../schemas/pixiecore.instruction-template-cross-runtime-comparison-v1.schema.json', import.meta.url),
      'comparison schema',
    ),
    readJson(baselinePath, 'baseline'),
    readJson(candidatePath, 'candidate'),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validateReport = ajv.compile(reportSchema);
  for (const [label, report] of [['baseline', baseline], ['candidate', candidate]]) {
    if (!validateReport(report)) {
      throw new TypeError(`Invalid ${label} report: ${JSON.stringify(validateReport.errors ?? [])}`);
    }
  }
  const comparison = compareInstructionTemplateReports(baseline, candidate);
  const validateComparison = ajv.compile(comparisonSchema);
  if (!validateComparison(comparison)) {
    throw new TypeError(`Invalid comparison report: ${JSON.stringify(validateComparison.errors ?? [])}`);
  }
  process.stdout.write(`${JSON.stringify(comparison)}\n`);
  process.exitCode = comparison.compatible ? 0 : 1;
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
