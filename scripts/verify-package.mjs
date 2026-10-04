import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { discoverCorePluginManifests } from './generate-core-plugin-catalog.mjs';
import { selectPackageInput } from './release/package-input.mjs';
import { verifyReleaseArtifactIdentity } from './release/verify-artifact.mjs';

const EXPECTED_PACKAGE_EXPORTS = [
  '.',
  './adoption/snapshot-schema.json',
  './api',
  './apisix',
  './application',
  './application/partial-result-schema.json',
  './application/trace-schema.json',
  './audit',
  './audit/schema.json',
  './blueprint-packages',
  './blueprint/package-schema.json',
  './blueprint/quality-catalog-schema.json',
  './blueprint/schema.json',
  './blueprint/v1-schema.json',
  './cache',
  './cache/record-schema.json',
  './conformance',
  './data-policy',
  './data-policy/record-schema.json',
  './eval',
  './eval/benchmark-schema.json',
  './eval/dataset-schema.json',
  './eval/property-corpus-schema.json',
  './eval/result-schema.json',
  './fallback',
  './fallback/receipt-schema.json',
  './instruction-template/conformance-report-schema.json',
  './instruction-template/conformance-schema.json',
  './instruction-template/conformance-suite.json',
  './instruction-template/cross-runtime-comparison-schema.json',
  './jit',
  './jit/admission-report-schema.json',
  './jit/program-schema.json',
  './jit/promotions-schema.json',
  './mcp-server',
  './package.json',
  './plugin',
  './plugin/package-schema.json',
  './plugin/schema.json',
  './pop/blueprint-package-schema.json',
  './pop/blueprint-schema.json',
  './pop/conformance-report-schema.json',
  './pop/conformance-suite-schema.json',
  './pop/conformance-suite.json',
  './pop/evaluation-dataset-schema.json',
  './pop/evaluation-result-schema.json',
  './rag',
  './rag/chunk-metadata-schema.json',
  './recipe/schema.json',
  './recipe/standard.yaml',
  './review',
  './review/handoff-schema.json',
  './review/receipt-schema.json',
  './telemetry',
  './telemetry/schema.json',
];
const EXPECTED_BIN_NAMES = ['pixiecore'];
const PACKAGE_FOOTPRINT_BUDGET = Object.freeze({
  maxFileCount: 527,
  // Includes the v2 Scenario schema, its serializer, and public authoring types
  // while retaining the legacy v1 schema. Measured 0.2 footprint: 1,224,931 bytes.
  maxUnpackedBytes: 1_226_000,
});
const EXPECTED_API_EXPORT = Object.freeze({
  types: './dist/core/kernel/api/index.d.ts',
  import: './dist/core/kernel/api/index.js',
});
const EXPECTED_APISIX_EXPORT = Object.freeze({
  types: './dist/core/kernel/apisix/index.d.ts',
  import: './dist/core/kernel/apisix/index.js',
});
const EXPECTED_APPLICATION_EXPORT = Object.freeze({
  types: './dist/core/kernel/application/index.d.ts',
  import: './dist/core/kernel/application/index.js',
});
const EXPECTED_AUDIT_EXPORT = Object.freeze({ types: './dist/core/kernel/audit/index.d.ts', import: './dist/core/kernel/audit/index.js' });
const EXPECTED_BLUEPRINT_PACKAGES_EXPORT = Object.freeze({
  types: './dist/core/kernel/blueprint/packages.d.ts',
  import: './dist/core/kernel/blueprint/packages.js',
});
const EXPECTED_CACHE_EXPORT = Object.freeze({
  types: './dist/core/kernel/cache/index.d.ts',
  import: './dist/core/kernel/cache/index.js',
});
const EXPECTED_CONFORMANCE_EXPORT = Object.freeze({
  types: './dist/core/kernel/conformance/index.d.ts',
  import: './dist/core/kernel/conformance/index.js',
});
const EXPECTED_DATA_POLICY_EXPORT = Object.freeze({
  types: './dist/core/kernel/data-policy/index.d.ts',
  import: './dist/core/kernel/data-policy/index.js',
});
const EXPECTED_EVALUATION_EXPORT = Object.freeze({
  types: './dist/core/kernel/evaluation/index.d.ts',
  import: './dist/core/kernel/evaluation/index.js',
});
const EXPECTED_FALLBACK_EXPORT = Object.freeze({
  types: './dist/core/kernel/fallback/index.d.ts',
  import: './dist/core/kernel/fallback/index.js',
});
const EXPECTED_JIT_EXPORT = Object.freeze({
  types: './dist/core/kernel/jit/index.d.ts',
  import: './dist/core/kernel/jit/index.js',
});
const EXPECTED_PLUGIN_EXPORT = Object.freeze({
  types: './dist/core/contracts/plugin/index.d.ts',
  import: './dist/core/contracts/plugin/index.js',
});
const EXPECTED_REVIEW_EXPORT = Object.freeze({
  types: './dist/core/kernel/review/index.d.ts',
  import: './dist/core/kernel/review/index.js',
});
const EXPECTED_RAG_EXPORT = Object.freeze({
  types: './dist/core/kernel/rag/index.d.ts',
  import: './dist/core/kernel/rag/index.js',
});
const EXPECTED_TELEMETRY_EXPORT = Object.freeze({
  types: './dist/core/kernel/telemetry/index.d.ts',
  import: './dist/core/kernel/telemetry/index.js',
});
const EXPECTED_MCP_SERVER_EXPORT = Object.freeze({
  types: './dist/core/kernel/mcp-server/index.d.ts',
  import: './dist/core/kernel/mcp-server/index.js',
});
const EXPECTED_PLUGIN_SCHEMA_TARGET = './schemas/pixiecore.plugin-v1.schema.json';
const EXPECTED_ADOPTION_SNAPSHOT_SCHEMA_TARGET = './schemas/pixiecore.adoption-snapshot-v1.schema.json';
const EXPECTED_BLUEPRINT_SCHEMA_TARGET = './schemas/pixiecore.blueprint-v2.schema.json';
const EXPECTED_BLUEPRINT_PACKAGE_SCHEMA_TARGET = './schemas/pixiecore.blueprint-package-v1.schema.json';
const EXPECTED_BLUEPRINT_QUALITY_CATALOG_SCHEMA_TARGET = './schemas/pixiecore.blueprint-quality-catalog-v1.schema.json';
const EXPECTED_PLUGIN_PACKAGE_SCHEMA_TARGET = './schemas/pixiecore.plugin-package-v1.schema.json';
const EXPECTED_RECIPE_SCHEMA_TARGET = './schemas/pixiecore.recipe-v1.schema.json';
const EXPECTED_STANDARD_RECIPE_TARGET = './dist/plugins/recipe/recipes/pixiecore.recipe.yaml';
const EXPECTED_POP_BLUEPRINT_SCHEMA_TARGET = './schemas/pop.blueprint-0.1.schema.json';
const EXPECTED_POP_EVALUATION_DATASET_SCHEMA_TARGET = './schemas/pop.evaluation-dataset-0.1.schema.json';
const EXPECTED_POP_EVALUATION_RESULT_SCHEMA_TARGET = './schemas/pop.evaluation-result-0.1.schema.json';
const EXPECTED_POP_BLUEPRINT_PACKAGE_SCHEMA_TARGET = './schemas/pop.blueprint-package-0.1.schema.json';
const EXPECTED_POP_CONFORMANCE_SUITE_SCHEMA_TARGET = './schemas/pop.conformance-suite-0.1.schema.json';
const EXPECTED_POP_CONFORMANCE_SUITE_TARGET = './conformance/pop-0.1/suite.json';
const EXPECTED_POP_CONFORMANCE_REPORT_SCHEMA_TARGET = './schemas/pop.conformance-report-0.1.schema.json';
const EXPECTED_SAFE_CACHE_RECORD_SCHEMA_TARGET = './schemas/pixiecore.safe-cache-record-v1.schema.json';
const EXPECTED_DATA_RETENTION_RECORD_SCHEMA_TARGET = './schemas/pixiecore.data-retention-record-v1.schema.json';
const EXPECTED_CLI_TARGET = './dist/core/kernel/cli/index.js';
const EXPECTED_EVAL_DATASET_SCHEMA_TARGET = './schemas/pixiecore.blueprint-eval-dataset-v1.schema.json';
const EXPECTED_EVAL_PROPERTY_CORPUS_SCHEMA_TARGET = './schemas/pixiecore.evaluation-property-corpus-v1.schema.json';
const EXPECTED_APPLICATION_TRACE_SCHEMA_TARGET = './schemas/pixiecore.application-trace-v1.schema.json';
const EXPECTED_APPLICATION_PARTIAL_RESULT_SCHEMA_TARGET = './schemas/pixiecore.application-partial-result-v1.schema.json';
const EXPECTED_SIGNED_AUDIT_EXPORT_SCHEMA_TARGET = './schemas/pixiecore.signed-audit-export-v1.schema.json';
const EXPECTED_EVAL_RESULT_SCHEMA_TARGET = './schemas/pixiecore.blueprint-eval-result-v1.schema.json';
const EXPECTED_EVAL_BENCHMARK_SCHEMA_TARGET = './schemas/pixiecore.blueprint-benchmark-v1.schema.json';
const EXPECTED_PROVIDER_FALLBACK_RECEIPT_SCHEMA_TARGET = './schemas/pixiecore.provider-fallback-receipt-v1.schema.json';
const EXPECTED_INSTRUCTION_TEMPLATE_CONFORMANCE_SCHEMA_TARGET = './schemas/pixiecore.instruction-template-conformance-v1.schema.json';
const EXPECTED_INSTRUCTION_TEMPLATE_CONFORMANCE_REPORT_SCHEMA_TARGET = './schemas/pixiecore.instruction-template-conformance-report-v1.schema.json';
const EXPECTED_INSTRUCTION_TEMPLATE_CONFORMANCE_SUITE_TARGET = './conformance/pixiecore-instruction-template-v1/suite.json';
const EXPECTED_INSTRUCTION_TEMPLATE_CROSS_RUNTIME_COMPARISON_SCHEMA_TARGET = './schemas/pixiecore.instruction-template-cross-runtime-comparison-v1.schema.json';
const EXPECTED_JIT_PROGRAM_SCHEMA_TARGET = './schemas/pixiecore.jit-program-v1.schema.json';
const EXPECTED_JIT_ADMISSION_REPORT_SCHEMA_TARGET = './schemas/pixiecore.jit-admission-report-v1.schema.json';
const EXPECTED_JIT_PROMOTIONS_SCHEMA_TARGET = './schemas/pixiecore.jit-promotions-v1.schema.json';
const EXPECTED_REVIEW_HANDOFF_SCHEMA_TARGET = './schemas/pixiecore.review-handoff-v1.schema.json';
const EXPECTED_REVIEW_RECEIPT_SCHEMA_TARGET = './schemas/pixiecore.review-receipt-v1.schema.json';
const EXPECTED_RAG_CHUNK_METADATA_SCHEMA_TARGET = './schemas/pixiecore.rag-chunk-metadata-v1.schema.json';
const EXPECTED_TELEMETRY_SCHEMA_TARGET = './schemas/pixiecore.execution-telemetry-v1.schema.json';
const EXPECTED_START_SCRIPT = 'node dist/core/kernel/cli/index.js serve';
const REMOVED_FLAT_ENTRY_POINTS = [
  'dist/api.d.ts',
  'dist/api.js',
  'dist/cli.d.ts',
  'dist/cli.js',
];
const EXPECTED_USAGE = 'Usage: pixiecore serve | mcp serve | execute <blueprint.yaml> [--inputs={...}] | execute-yaml <file> [--inputs={...}] | blueprint create <directory> --operation=<operation> [--name=<name>] | blueprint validate <blueprint.yaml> | blueprint test <unit-directory> | blueprint eval <dataset.yaml> [--seed=<seed>] [--output=<result.json>] | blueprint inspect <blueprint.yaml> | blueprint play <dataset.yaml> --case=<id> [--mode=mock|real|both] | application inspect <application.graph.yaml> [--format=json|mermaid] | plugin <command> ...';
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const corePluginRoot = join(projectRoot, 'src', 'plugins');
const CORE_PLUGIN_MANIFESTS = (await discoverCorePluginManifests(projectRoot))
  .map(manifestPath => relative(corePluginRoot, manifestPath))
  .sort();
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const runtimeExportSnapshot = await readJson(
  join(projectRoot, 'tests', 'fixtures', 'public-runtime-exports.json'),
);
const sourceManifest = await readJson(join(projectRoot, 'package.json'));
const temporaryRoot = await mkdtemp(join(tmpdir(), 'pixiecore-package-'));

try {
  const packDirectory = join(temporaryRoot, 'pack');
  const consumerDirectory = join(temporaryRoot, 'consumer');
  const executionDirectory = join(consumerDirectory, 'work', 'nested');
  await mkdir(packDirectory);
  await mkdir(consumerDirectory);
  await mkdir(executionDirectory, { recursive: true });

  const artifactDirectory = option('artifact-directory');
  const sourceRevision = option('source-revision');
  const version = option('version');
  const { tarball, manifest: candidateManifest } = await selectPackageInput({
    outputDirectory: artifactDirectory,
    sourceRevision,
    version,
    packCheckout: async () => {
      await run(npm, withNpmCache([
        'pack', '--silent', '--pack-destination', packDirectory,
      ]), { cwd: projectRoot });
      const tarballs = (await readdir(packDirectory)).filter(name => name.endsWith('.tgz'));
      assert.equal(tarballs.length, 1, `Expected one package tarball, found ${tarballs.length}`);
      return join(packDirectory, tarballs[0]);
    },
  });

  await writeFile(join(consumerDirectory, 'package.json'), JSON.stringify({
    name: 'pixiecore-package-smoke',
    private: true,
    type: 'module',
  }, null, 2));

  await run(npm, withNpmCache([
    'install',
    '--engine-strict',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    tarball,
  ]), { cwd: consumerDirectory });

  const packageDirectory = join(
    consumerDirectory,
    'node_modules',
    ...sourceManifest.name.split('/'),
  );
  const installedManifest = await readJson(join(packageDirectory, 'package.json'));
  assert.equal(installedManifest.name, sourceManifest.name);
  assert.equal(installedManifest.version, sourceManifest.version);
  for (const field of ['main', 'types', 'type', 'sideEffects', 'engines']) {
    assert.deepEqual(installedManifest[field], sourceManifest[field]);
  }
  assert.deepEqual(installedManifest.exports, sourceManifest.exports);
  assert.deepEqual(installedManifest.bin, sourceManifest.bin);
  assert.equal(installedManifest.type, 'module');
  assert.equal(installedManifest.sideEffects, false);
  assert.equal(installedManifest.engines?.node, '>=22.13.0');
  assert.equal(hasCondition(installedManifest.exports, 'require'), false);
  const rootExport = installedManifest.exports?.['.'];
  assert.ok(rootExport && typeof rootExport === 'object' && !Array.isArray(rootExport));
  assert.equal(installedManifest.main, rootExport.import);
  assert.equal(installedManifest.types, rootExport.types);
  assert.deepEqual(installedManifest.exports?.['./api'], EXPECTED_API_EXPORT);
  assert.deepEqual(installedManifest.exports?.['./apisix'], EXPECTED_APISIX_EXPORT);
  assert.deepEqual(installedManifest.exports?.['./application'], EXPECTED_APPLICATION_EXPORT);
  assert.deepEqual(installedManifest.exports?.['./audit'], EXPECTED_AUDIT_EXPORT);
  assert.deepEqual(
    installedManifest.exports?.['./blueprint-packages'],
    EXPECTED_BLUEPRINT_PACKAGES_EXPORT,
  );
  assert.deepEqual(installedManifest.exports?.['./cache'], EXPECTED_CACHE_EXPORT);
  assert.deepEqual(installedManifest.exports?.['./conformance'], EXPECTED_CONFORMANCE_EXPORT);
  assert.deepEqual(installedManifest.exports?.['./data-policy'], EXPECTED_DATA_POLICY_EXPORT);
  assert.equal(
    installedManifest.exports?.['./adoption/snapshot-schema.json'],
    EXPECTED_ADOPTION_SNAPSHOT_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./application/trace-schema.json'],
    EXPECTED_APPLICATION_TRACE_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./application/partial-result-schema.json'],
    EXPECTED_APPLICATION_PARTIAL_RESULT_SCHEMA_TARGET,
  );
  assert.equal(installedManifest.exports?.['./audit/schema.json'], EXPECTED_SIGNED_AUDIT_EXPORT_SCHEMA_TARGET);
  assert.equal(
    installedManifest.exports?.['./data-policy/record-schema.json'],
    EXPECTED_DATA_RETENTION_RECORD_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./cache/record-schema.json'],
    EXPECTED_SAFE_CACHE_RECORD_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./blueprint/schema.json'],
    EXPECTED_BLUEPRINT_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./blueprint/v1-schema.json'],
    './schemas/pixiecore.blueprint-v1.schema.json',
  );
  assert.equal(
    installedManifest.exports?.['./blueprint/package-schema.json'],
    EXPECTED_BLUEPRINT_PACKAGE_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./blueprint/quality-catalog-schema.json'],
    EXPECTED_BLUEPRINT_QUALITY_CATALOG_SCHEMA_TARGET,
  );
  assert.deepEqual(installedManifest.exports?.['./eval'], EXPECTED_EVALUATION_EXPORT);
  assert.deepEqual(installedManifest.exports?.['./fallback'], EXPECTED_FALLBACK_EXPORT);
  assert.deepEqual(installedManifest.exports?.['./jit'], EXPECTED_JIT_EXPORT);
  assert.deepEqual(
    installedManifest.exports?.['./mcp-server'],
    EXPECTED_MCP_SERVER_EXPORT,
  );
  assert.deepEqual(installedManifest.exports?.['./plugin'], EXPECTED_PLUGIN_EXPORT);
  assert.deepEqual(installedManifest.exports?.['./rag'], EXPECTED_RAG_EXPORT);
  assert.deepEqual(installedManifest.exports?.['./review'], EXPECTED_REVIEW_EXPORT);
  assert.deepEqual(installedManifest.exports?.['./telemetry'], EXPECTED_TELEMETRY_EXPORT);
  assert.equal(
    installedManifest.exports?.['./fallback/receipt-schema.json'],
    EXPECTED_PROVIDER_FALLBACK_RECEIPT_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./instruction-template/conformance-schema.json'],
    EXPECTED_INSTRUCTION_TEMPLATE_CONFORMANCE_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./instruction-template/conformance-report-schema.json'],
    EXPECTED_INSTRUCTION_TEMPLATE_CONFORMANCE_REPORT_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./instruction-template/conformance-suite.json'],
    EXPECTED_INSTRUCTION_TEMPLATE_CONFORMANCE_SUITE_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./instruction-template/cross-runtime-comparison-schema.json'],
    EXPECTED_INSTRUCTION_TEMPLATE_CROSS_RUNTIME_COMPARISON_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./jit/program-schema.json'],
    EXPECTED_JIT_PROGRAM_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./jit/admission-report-schema.json'],
    EXPECTED_JIT_ADMISSION_REPORT_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./jit/promotions-schema.json'],
    EXPECTED_JIT_PROMOTIONS_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./eval/dataset-schema.json'],
    EXPECTED_EVAL_DATASET_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./eval/property-corpus-schema.json'],
    EXPECTED_EVAL_PROPERTY_CORPUS_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./eval/result-schema.json'],
    EXPECTED_EVAL_RESULT_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./eval/benchmark-schema.json'],
    EXPECTED_EVAL_BENCHMARK_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./plugin/schema.json'],
    EXPECTED_PLUGIN_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./plugin/package-schema.json'],
    EXPECTED_PLUGIN_PACKAGE_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./recipe/schema.json'],
    EXPECTED_RECIPE_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./recipe/standard.yaml'],
    EXPECTED_STANDARD_RECIPE_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./pop/blueprint-schema.json'],
    EXPECTED_POP_BLUEPRINT_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./pop/evaluation-dataset-schema.json'],
    EXPECTED_POP_EVALUATION_DATASET_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./pop/evaluation-result-schema.json'],
    EXPECTED_POP_EVALUATION_RESULT_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./pop/blueprint-package-schema.json'],
    EXPECTED_POP_BLUEPRINT_PACKAGE_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./pop/conformance-suite-schema.json'],
    EXPECTED_POP_CONFORMANCE_SUITE_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./pop/conformance-suite.json'],
    EXPECTED_POP_CONFORMANCE_SUITE_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./pop/conformance-report-schema.json'],
    EXPECTED_POP_CONFORMANCE_REPORT_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./review/handoff-schema.json'],
    EXPECTED_REVIEW_HANDOFF_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./review/receipt-schema.json'],
    EXPECTED_REVIEW_RECEIPT_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./rag/chunk-metadata-schema.json'],
    EXPECTED_RAG_CHUNK_METADATA_SCHEMA_TARGET,
  );
  assert.equal(
    installedManifest.exports?.['./telemetry/schema.json'],
    EXPECTED_TELEMETRY_SCHEMA_TARGET,
  );
  assert.equal(installedManifest.bin?.pixiecore, EXPECTED_CLI_TARGET);
  assert.equal(installedManifest.scripts?.start, EXPECTED_START_SCRIPT);

  await verifyPackageTargets(packageDirectory, installedManifest);
  await verifyRemovedFlatEntryPoints(packageDirectory);
  await verifyCorePluginArtifacts(packageDirectory);
  const packageFootprint = await verifyLeanPackageBoundary(packageDirectory);
  await assertManagedProjectArtifactsAbsent(packageDirectory);
  await assertPathMissing(
    join(packageDirectory, 'conformance', 'validators', 'python', 'pop_validator.py'),
  );
  await assertPathMissing(
    join(
      packageDirectory,
      'conformance',
      'evidence',
      'independent-runtime-instruction-template-v1.json',
    ),
  );
  const instructionAdapterResult = await run(process.execPath, [
    join(packageDirectory, 'conformance', 'adapters', 'pixiecore-instruction-template.mjs'),
    '--suite',
    join(packageDirectory, 'conformance', 'pixiecore-instruction-template-v1', 'suite.json'),
  ], { cwd: packageDirectory });
  const instructionAdapterReport = JSON.parse(instructionAdapterResult.stdout);
  assert.equal(
    instructionAdapterReport.schema,
    'pixiecore.instruction-template-conformance-report/v1',
  );
  assert.equal(instructionAdapterReport.conformant, true);
  assert.equal(instructionAdapterReport.summary.failed, 0);
  const installedBaselineReportPath = join(consumerDirectory, 'pixiecore-instruction-report.json');
  await writeFile(installedBaselineReportPath, instructionAdapterResult.stdout);
  const independentInstructionReport = structuredClone(instructionAdapterReport);
  independentInstructionReport.implementation.name = 'IndependentRuntime';
  const installedCandidateReportPath = join(consumerDirectory, 'independent-instruction-report.json');
  await writeFile(installedCandidateReportPath, JSON.stringify(independentInstructionReport));
  const crossRuntimeResult = await run(process.execPath, [
    join(
      packageDirectory,
      'conformance',
      'runners',
      'compare-instruction-template-reports.mjs',
    ),
    '--baseline',
    installedBaselineReportPath,
    '--candidate',
    installedCandidateReportPath,
  ], { cwd: packageDirectory });
  const crossRuntimeReport = JSON.parse(crossRuntimeResult.stdout);
  assert.equal(crossRuntimeReport.compatible, true);
  assert.deepEqual(crossRuntimeReport.portable_summary, { total: 7, passed: 7, failed: 0 });
  assert.deepEqual(crossRuntimeReport.extension_summary, { total: 2, passed: 2, failed: 0 });
  const changedInstructionSuite = await readJson(
    join(packageDirectory, 'conformance', 'pixiecore-instruction-template-v1', 'suite.json'),
  );
  changedInstructionSuite.render_cases[0].expected = 'package smoke mismatch';
  const changedInstructionSuitePath = join(consumerDirectory, 'changed-instruction-suite.json');
  await writeFile(changedInstructionSuitePath, JSON.stringify(changedInstructionSuite));
  const nonconformantAdapterResult = await run(process.execPath, [
    join(packageDirectory, 'conformance', 'adapters', 'pixiecore-instruction-template.mjs'),
    '--suite',
    changedInstructionSuitePath,
  ], { cwd: packageDirectory, expectedExitCodes: [1] });
  assert.equal(JSON.parse(nonconformantAdapterResult.stdout).conformant, false);
  const invalidInstructionSuitePath = join(consumerDirectory, 'invalid-instruction-suite.json');
  await writeFile(invalidInstructionSuitePath, '{');
  const invalidAdapterResult = await run(process.execPath, [
    join(packageDirectory, 'conformance', 'adapters', 'pixiecore-instruction-template.mjs'),
    '--suite',
    invalidInstructionSuitePath,
  ], { cwd: packageDirectory, expectedExitCodes: [2] });
  assert.equal(invalidAdapterResult.stdout, '');
  assert.match(invalidAdapterResult.stderr, /JSON/u);
  await access(join(packageDirectory, 'LICENSE'), constants.R_OK);
  const [sourceNotice, installedNotice] = await Promise.all([
    readFile(join(projectRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8'),
    readFile(join(packageDirectory, 'THIRD_PARTY_NOTICES.md'), 'utf8'),
  ]);
  assert.equal(installedNotice, sourceNotice);
  const installedReadme = await readFile(join(packageDirectory, 'README.md'), 'utf8');
  const exampleReferences = new Set(
    [...installedReadme.matchAll(/(?<!\/)\bexamples\/[A-Za-z0-9._/-]+\.ya?ml\b/g)]
      .map(match => match[0]),
  );
  assert.ok(exampleReferences.size > 0, 'Packed README must reference at least one YAML example');
  for (const reference of exampleReferences) {
    await access(resolvePackageTarget(packageDirectory, `./${reference}`), constants.R_OK);
  }

  const [typedConsumer, pluginTypedConsumer] = await Promise.all([
    readFile(
      join(projectRoot, 'tests', 'fixtures', 'public-package-consumer.ts.fixture'),
      'utf8',
    ),
    readFile(
      join(projectRoot, 'tests', 'fixtures', 'plugin-package-consumer.ts.fixture'),
      'utf8',
    ),
  ]);
  await Promise.all([
    writeFile(join(consumerDirectory, 'consumer.ts'), typedConsumer),
    writeFile(join(consumerDirectory, 'plugin-consumer.ts'), pluginTypedConsumer),
  ]);
  await writeFile(join(consumerDirectory, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      exactOptionalPropertyTypes: true,
      forceConsistentCasingInFileNames: true,
      lib: ['ES2022', 'DOM'],
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      noEmit: true,
      noUncheckedIndexedAccess: true,
      skipLibCheck: false,
      strict: true,
      target: 'ES2022',
      typeRoots: [join(projectRoot, 'node_modules', '@types')],
      types: ['node'],
      verbatimModuleSyntax: true,
    },
    files: ['./consumer.ts', './plugin-consumer.ts'],
  }, null, 2));
  await run(process.execPath, [
    join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--project',
    join(consumerDirectory, 'tsconfig.json'),
  ], { cwd: consumerDirectory });

  const installedEnvironmentPath = join(packageDirectory, '.env');
  const installedMcpPath = join(packageDirectory, 'mcp.json');
  await writeFile(installedEnvironmentPath, 'PIXIECORE_INSTALLED_ENV_MARKER=package-root\n');
  await writeFile(installedMcpPath, JSON.stringify({
    mcpServers: {
      installed_package_root: {
        command: process.execPath,
        args: ['--eval', '/* lazy installed-package marker */'],
      },
    },
  }, null, 2));
  await run(process.execPath, [
    '--input-type=module',
    '--eval',
    consumerSmokeSource(
      runtimeExportSnapshot,
      sourceManifest,
      installedMcpPath,
      packageDirectory,
    ),
  ], { cwd: executionDirectory });
  await Promise.all([rm(installedEnvironmentPath), rm(installedMcpPath)]);

  const wrongBoundaryDirectory = join(consumerDirectory, 'wrong-boundary');
  const wrongBoundaryModule = join(wrongBoundaryDirectory, 'src', 'probe.mjs');
  await mkdir(dirname(wrongBoundaryModule), { recursive: true });
  await Promise.all([
    writeFile(join(wrongBoundaryDirectory, 'package.json'), JSON.stringify({
      name: 'not-pixiecore',
      private: true,
      type: 'module',
    }, null, 2)),
    writeFile(wrongBoundaryModule, 'export {};\n'),
  ]);
  await run(process.execPath, [
    '--input-type=module',
    '--eval',
    installedNegativeResolutionSmokeSource(packageDirectory, wrongBoundaryModule),
  ], { cwd: executionDirectory });

  const environmentPluginDirectory = join(consumerDirectory, 'plugin-discovery', 'environment');
  const firstRelativePluginDirectory = join(executionDirectory, 'plugins-first');
  const secondRelativePluginDirectory = join(executionDirectory, 'plugins-second');
  await Promise.all([
    writeInstalledMarkerPlugin(environmentPluginDirectory, 'environment', true),
    writeInstalledMarkerPlugin(firstRelativePluginDirectory, 'first'),
    writeInstalledMarkerPlugin(secondRelativePluginDirectory, 'second'),
  ]);
  await run(process.execPath, [
    '--input-type=module',
    '--eval',
    installedPluginDiscoverySmokeSource(environmentPluginDirectory),
  ], { cwd: executionDirectory });

  const managedProjectDirectory = join(consumerDirectory, 'managed-project');
  const managedPluginRoot = join(managedProjectDirectory, 'plugins');
  const managedConfigDirectory = join(managedProjectDirectory, 'config');
  const managedConfigPath = join(managedConfigDirectory, 'managed-state.yml');
  const enabledManagedMarker = join(managedProjectDirectory, 'enabled-imported.txt');
  const disabledManagedMarker = join(managedProjectDirectory, 'disabled-imported.txt');
  await Promise.all([
    writeInstalledManagedToolPlugin(
      managedPluginRoot,
      'enabled',
      'package.enabled',
      enabledManagedMarker,
      'managed package works',
    ),
    writeInstalledManagedToolPlugin(
      managedPluginRoot,
      'disabled',
      'package.disabled',
      disabledManagedMarker,
      'disabled plugin ran',
    ),
    mkdir(managedConfigDirectory, { recursive: true }),
  ]);
  await writeFile(managedConfigPath, [
    'schema: pixiecore.plugins/v1',
    'roots:',
    '  - ../plugins',
    'enabled:',
    '  - package.enabled',
    'disabled:',
    '  - package.disabled',
    '',
  ].join('\n'));
  await Promise.all([
    assertManagedProjectArtifactsAbsent(executionDirectory),
    assertManagedProjectArtifactsAbsent(consumerDirectory),
  ]);
  await run(process.execPath, [
    '--input-type=module',
    '--eval',
    installedManagedPluginSmokeSource(managedConfigPath),
  ], { cwd: executionDirectory });
  assert.equal(await readFile(enabledManagedMarker, 'utf8'), 'package.enabled imported\n');
  await assertPathMissing(disabledManagedMarker);
  await Promise.all([
    assertManagedProjectArtifactsAbsent(executionDirectory),
    assertManagedProjectArtifactsAbsent(consumerDirectory),
  ]);

  const pluginDirectory = join(consumerDirectory, 'plugins', 'package-smoke');
  await mkdir(pluginDirectory, { recursive: true });
  await writeFile(join(pluginDirectory, 'plugin.yml'), [
    'name: Package smoke provider',
    'module: ./provider.mjs',
    '',
  ].join('\n'));
  await writeFile(join(pluginDirectory, 'provider.mjs'), String.raw`
    export default {
      providers: [{
        name: 'package_smoke_cli',
        model: 'package-smoke-cli-model',
        supportsTools: false,
        supportsMultimodal: false,
        supportsVision: () => false,
        supportsFileInput: () => false,
        getModelList: async () => ['package-smoke-cli-model'],
        generate: async () => ({ content: '{"greeting":"Hello from installed PixieCore"}' }),
      }],
    };
  `);

  const bins = normalizeBins(installedManifest);
  assert.deepEqual(Object.keys(bins).sort(), EXPECTED_BIN_NAMES);
  const cliShim = installedBinShim(consumerDirectory, 'pixiecore');
  await access(cliShim, process.platform === 'win32' ? constants.R_OK : constants.X_OK);
  const cliTarget = resolvePackageTarget(packageDirectory, bins.pixiecore);
  const firstLine = (await readFile(cliTarget, 'utf8')).split(/\r?\n/, 1)[0];
  assert.equal(firstLine, '#!/usr/bin/env node');

  const cliEnvironment = {
    PROMPT_RUNTIME_PROVIDER: 'package_smoke_cli',
    PROMPT_RUNTIME_PLUGINS_DIR: join(consumerDirectory, 'plugins'),
    PROMPT_RUNTIME_LOG_TO_FILE: 'false',
  };
  const helloBlueprint = join(packageDirectory, 'examples', 'hello.yaml');
  for (const command of ['execute', 'execute-yaml']) {
    const execution = await runBin(cliShim, [
      command,
      helloBlueprint,
      '--inputs={"name":"Package"}',
    ], { cwd: executionDirectory, env: cliEnvironment });
    assert.deepEqual(JSON.parse(execution.stdout), { greeting: 'Hello from installed PixieCore' });
    assert.equal(execution.stderr, '');
  }

  const scaffoldDirectory = join(consumerDirectory, 'generated-converter');
  const scaffoldCreation = await runBin(cliShim, [
    'blueprint',
    'create',
    scaffoldDirectory,
    '--operation=converter',
    '--name=Generated converter',
  ], { cwd: executionDirectory });
  assert.equal(
    scaffoldCreation.stdout,
    `Created Blueprint scaffold at ${scaffoldDirectory}\n`,
  );
  assert.equal(scaffoldCreation.stderr, '');
  const scaffoldBlueprint = await readFile(
    join(scaffoldDirectory, 'generated-converter.yaml'),
    'utf8',
  );
  assert.match(scaffoldBlueprint, /name: "Generated converter"/u);
  assert.match(scaffoldBlueprint, /exactly one Converter operation/u);
  await Promise.all([
    access(join(scaffoldDirectory, 'README.md'), constants.R_OK),
    access(join(scaffoldDirectory, 'evaluations', 'generated-converter.yaml'), constants.R_OK),
    access(join(scaffoldDirectory, 'tests', 'generated-converter.contract.test.ts'), constants.R_OK),
  ]);
  const scaffoldValidation = await runBin(cliShim, [
    'blueprint', 'validate', join(scaffoldDirectory, 'generated-converter.yaml'),
  ], { cwd: executionDirectory });
  assert.equal(scaffoldValidation.stdout, 'Blueprint valid: Generated converter (0.1.0)\n');
  const scaffoldInspection = await runBin(cliShim, [
    'blueprint', 'inspect', join(scaffoldDirectory, 'generated-converter.yaml'),
  ], { cwd: executionDirectory });
  assert.deepEqual(JSON.parse(scaffoldInspection.stdout).input_fields, ['input']);
  const scaffoldTest = await runBin(
    cliShim,
    ['blueprint', 'test', scaffoldDirectory],
    { cwd: executionDirectory },
  );
  assert.deepEqual(JSON.parse(scaffoldTest.stdout), {
    valid: true,
    unit: 'generated-converter',
    blueprint: 'generated-converter.yaml',
    version: '0.1.0',
    dataset: join('evaluations', 'generated-converter.yaml'),
    contract_test: join('tests', 'generated-converter.contract.test.ts'),
  });
  const repeatedScaffold = await runBin(cliShim, [
    'blueprint',
    'create',
    scaffoldDirectory,
    '--operation=router',
  ], { cwd: executionDirectory, expectedExitCodes: [1] });
  assert.equal(repeatedScaffold.stdout, '');
  assert.match(repeatedScaffold.stderr, /^PixieCore: /u);
  assert.equal(
    await readFile(join(scaffoldDirectory, 'generated-converter.yaml'), 'utf8'),
    scaffoldBlueprint,
  );
  const scaffoldPlayground = await runBin(cliShim, [
    'blueprint',
    'play',
    join(scaffoldDirectory, 'evaluations', 'generated-converter.yaml'),
    '--case=canonical-example',
  ], { cwd: executionDirectory });
  const scaffoldPlaygroundArtifact = JSON.parse(scaffoldPlayground.stdout);
  assert.equal(scaffoldPlaygroundArtifact.schema, 'pixiecore.blueprint-playground/v1');
  assert.equal(scaffoldPlaygroundArtifact.mode, 'mock');
  assert.deepEqual(scaffoldPlaygroundArtifact.mock.output, { result: 'fixture result' });

  const applicationGraph = join(
    projectRoot,
    'examples',
    'application-composition',
    'publication-brief.graph.yaml',
  );
  const applicationInspection = await runBin(
    cliShim,
    ['application', 'inspect', applicationGraph],
    { cwd: executionDirectory },
  );
  assert.equal(
    JSON.parse(applicationInspection.stdout).schema,
    'pixiecore.application-graph-inspection/v1',
  );
  const applicationMermaid = await runBin(
    cliShim,
    ['application', 'inspect', applicationGraph, '--format=mermaid'],
    { cwd: executionDirectory },
  );
  assert.match(applicationMermaid.stdout, /^flowchart TD\n/u);

  const authoredPlugin = join(consumerDirectory, 'authored-tool');
  const authoredConfig = join(consumerDirectory, 'authored-consumer', 'pixiecore.plugins.yml');
  await runBin(cliShim, [
    'plugin', 'create', authoredPlugin,
    '--id=package.authored-tool',
    '--kind=tool',
  ], { cwd: executionDirectory });
  const authoredValidation = await runBin(
    cliShim,
    ['plugin', 'validate', authoredPlugin],
    { cwd: executionDirectory },
  );
  assert.equal(JSON.parse(authoredValidation.stdout).id, 'package.authored-tool');
  await runBin(cliShim, ['plugin', 'test', authoredPlugin], { cwd: executionDirectory });
  await runBin(cliShim, ['plugin', 'provenance', authoredPlugin], { cwd: executionDirectory });
  const authoredVerification = await runBin(
    cliShim,
    ['plugin', 'verify', authoredPlugin],
    { cwd: executionDirectory },
  );
  assert.equal(JSON.parse(authoredVerification.stdout).signature, 'absent');
  await runBin(cliShim, [
    'plugin', 'install', authoredPlugin,
    `--config=${authoredConfig}`,
    '--enable',
  ], { cwd: executionDirectory });
  await runBin(cliShim, [
    'plugin', 'disable', 'package.authored-tool',
    `--config=${authoredConfig}`,
  ], { cwd: executionDirectory });
  const authoredCatalog = await runBin(
    cliShim,
    ['plugin', 'catalog', authoredPlugin],
    { cwd: executionDirectory },
  );
  assert.deepEqual(
    JSON.parse(authoredCatalog.stdout).plugins.map(item => item.plugin.id),
    ['package.authored-tool'],
  );

  const usage = await runBin(cliShim, [], {
    cwd: executionDirectory,
    expectedExitCodes: [2],
  });
  assert.equal(usage.stdout, '');
  assert.equal(usage.stderr, `${EXPECTED_USAGE}\n`);

  const operationalFailure = await runBin(cliShim, [
    'execute',
    join(executionDirectory, 'missing-blueprint.yaml'),
  ], {
    cwd: executionDirectory,
    env: cliEnvironment,
    expectedExitCodes: [1],
  });
  assert.equal(operationalFailure.stdout, '');
  assert.match(operationalFailure.stderr, /^PixieCore: /);
  assert.doesNotMatch(operationalFailure.stderr, /\n\s+at /);

  if (candidateManifest) {
    assert.deepEqual(await verifyReleaseArtifactIdentity({
      outputDirectory: artifactDirectory, sourceRevision, version,
    }), candidateManifest, 'Candidate identity or bytes changed during installed-package verification');
    console.log(`Verified unchanged candidate SHA-256: ${candidateManifest.sha256}.`);
  }
  console.log(
    'Packed PixieCore artifact passed install, declarations, dynamic exports, notices, '
      + 'plugin SDK/schema, conformance, runtime, managed-plugin policy, HTTP, and '
      + `installed-bin smoke checks (${packageFootprint.fileCount} files, `
      + `${packageFootprint.unpackedBytes} unpacked bytes).`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

/** Reads one optional --name=value argument without choosing a fallback candidate identity. */
function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

async function verifyPackageTargets(packageDirectory, manifest) {
  const exportEntries = packageExportEntries(manifest.exports);
  assert.deepEqual(exportEntries.map(([subpath]) => subpath).sort(), EXPECTED_PACKAGE_EXPORTS);
  for (const [subpath, declaration] of exportEntries) {
    const targets = collectPackageTargets(declaration);
    assert.ok(targets.length > 0, `Package export ${subpath} must declare at least one target`);
    for (const target of targets) {
      await access(resolvePackageTarget(packageDirectory, target), constants.R_OK);
    }
  }

  assert.equal(typeof manifest.main, 'string');
  assert.equal(typeof manifest.types, 'string');
  await access(resolvePackageTarget(packageDirectory, manifest.main), constants.R_OK);
  await access(resolvePackageTarget(packageDirectory, manifest.types), constants.R_OK);

  const bins = normalizeBins(manifest);
  assert.deepEqual(Object.keys(bins).sort(), EXPECTED_BIN_NAMES);
  for (const target of Object.values(bins)) {
    await access(resolvePackageTarget(packageDirectory, target), constants.R_OK);
  }
}

async function verifyRemovedFlatEntryPoints(packageDirectory) {
  await Promise.all(
    REMOVED_FLAT_ENTRY_POINTS.map(path => assertPathMissing(join(packageDirectory, path))),
  );
}

async function verifyCorePluginArtifacts(packageDirectory) {
  await assertManagedProjectArtifactsAbsent(packageDirectory);
  const installedPluginRoot = join(packageDirectory, 'dist', 'plugins');
  const installedManifests = (await collectRelativeFiles(installedPluginRoot))
    .filter(path => path.endsWith('.yaml')
      && basename(path) === `${basename(dirname(path))}.yaml`)
    .sort();
  assert.deepEqual(
    installedManifests,
    CORE_PLUGIN_MANIFESTS,
  );

  for (const manifestRelativePath of CORE_PLUGIN_MANIFESTS) {
    const directory = dirname(manifestRelativePath);
    const name = basename(manifestRelativePath, '.yaml');
    const sourceManifest = join(corePluginRoot, manifestRelativePath);
    const installedManifest = join(installedPluginRoot, manifestRelativePath);
    assert.equal(await readFile(installedManifest, 'utf8'), await readFile(sourceManifest, 'utf8'));
    await access(join(installedPluginRoot, directory, `${name}.js`), constants.R_OK);
    await access(join(installedPluginRoot, directory, `${name}.d.ts`), constants.R_OK);
    await access(join(installedPluginRoot, directory, 'src', 'activator.js'), constants.R_OK);
    await assertPathMissing(join(installedPluginRoot, directory, 'tests'));
  }

  const generatedRoot = join(
    packageDirectory,
    'dist',
    'core',
    'kernel',
    'generated',
  );
  await access(join(generatedRoot, 'core-plugin-catalog.generated.js'), constants.R_OK);
  await access(join(generatedRoot, 'core-plugin-catalog.generated.d.ts'), constants.R_OK);
  const recipePluginRoot = join(packageDirectory, 'dist', 'plugins', 'recipe');
  const sourceRecipePluginRoot = join(projectRoot, 'src', 'plugins', 'recipe');
  await access(join(recipePluginRoot, 'recipe.js'), constants.R_OK);
  await access(join(recipePluginRoot, 'src', 'activator.js'), constants.R_OK);
  await access(join(recipePluginRoot, 'src', 'generated', 'core-recipe.generated.js'), constants.R_OK);
  for (const relativePath of ['recipe.yaml', 'recipes/pixiecore.recipe.yaml']) {
    assert.equal(
      await readFile(join(recipePluginRoot, relativePath), 'utf8'),
      await readFile(join(sourceRecipePluginRoot, relativePath), 'utf8'),
    );
  }
  await assertPathMissing(join(recipePluginRoot, 'tests'));
  await access(join(packageDirectory, 'schemas', 'pixiecore.recipe-v1.schema.json'), constants.R_OK);

  for (const excludedPath of ['src', 'custom', 'plugins', 'recipes', 'tests']) {
    await assert.rejects(
      access(join(packageDirectory, excludedPath), constants.R_OK),
      error => error?.code === 'ENOENT',
    );
  }
}

async function verifyPluginEcosystemArtifacts(packageDirectory) {
  const relativePaths = [
    'schemas/pixiecore.plugin-v1.schema.json',
    'schemas/pixiecore.plugin-package-v1.schema.json',
    'docs/plugins/plugin-authoring.md',
    'examples/plugin-project/pixiecore.plugins.yml',
    'examples/plugin-project/custom/plugins/roles/converter/converter.ts',
    'examples/plugin-project/custom/plugins/roles/converter/converter.mjs',
    'examples/plugin-project/custom/plugins/roles/converter/converter.yaml',
    'examples/plugin-project/custom/plugins/roles/converter/src/prompts.ts',
    'examples/plugin-project/custom/plugins/roles/converter/src/prompts.mjs',
    'examples/plugin-project/custom/plugins/roles/converter/tests/converter.test.ts',
    'examples/plugin-project/custom/plugins/roles/classifier/classifier.ts',
    'examples/plugin-project/custom/plugins/roles/classifier/classifier.mjs',
    'examples/plugin-project/custom/plugins/roles/classifier/classifier.yaml',
    'examples/plugin-project/custom/plugins/roles/classifier/src/prompts.ts',
    'examples/plugin-project/custom/plugins/roles/classifier/src/prompts.mjs',
    'examples/plugin-project/custom/plugins/roles/classifier/tests/classifier.test.ts',
  ];
  for (const relativePath of relativePaths) {
    const [source, installed] = await Promise.all([
      readFile(join(projectRoot, relativePath), 'utf8'),
      readFile(join(packageDirectory, relativePath), 'utf8'),
    ]);
    assert.equal(installed, source, `Packed plugin ecosystem artifact drifted: ${relativePath}`);
  }
  const authoringExamplesRoot = join('examples', 'plugin-authoring');
  for (const relativePath of await collectRelativeFiles(join(projectRoot, authoringExamplesRoot))) {
    const artifactPath = join(authoringExamplesRoot, relativePath);
    const [source, installed] = await Promise.all([
      readFile(join(projectRoot, artifactPath), 'utf8'),
      readFile(join(packageDirectory, artifactPath), 'utf8'),
    ]);
    assert.equal(installed, source, `Packed plugin example drifted: ${artifactPath}`);
  }
}

async function verifyApplicationCompositionArtifacts(packageDirectory) {
  const relativeRoot = join('examples', 'application-composition');
  const sourceRoot = join(projectRoot, relativeRoot);
  const relativePaths = await collectRelativeFiles(sourceRoot);
  assert.ok(relativePaths.includes('travel-approval.ts'));
  assert.ok(relativePaths.includes('publication-brief.graph.yaml'));
  assert.ok(relativePaths.includes('customer-inquiry.ts'));
  assert.ok(relativePaths.includes('invoice-review.ts'));
  assert.deepEqual(
    relativePaths.filter(path => path.startsWith('blueprints/')).length,
    5,
  );
  assert.deepEqual(
    relativePaths.filter(path => path.startsWith('evaluations/')).length,
    5,
  );
  assert.deepEqual(
    relativePaths.filter(path => path.startsWith('customer-inquiry/blueprints/')).length,
    5,
  );
  assert.deepEqual(
    relativePaths.filter(path => path.startsWith('customer-inquiry/evaluations/')).length,
    5,
  );
  assert.deepEqual(
    relativePaths.filter(path => path.startsWith('invoice-review/blueprints/')).length,
    5,
  );
  assert.deepEqual(
    relativePaths.filter(path => path.startsWith('invoice-review/evaluations/')).length,
    5,
  );
  for (const relativePath of relativePaths) {
    const artifactPath = join(relativeRoot, relativePath);
    const [source, installed] = await Promise.all([
      readFile(join(projectRoot, artifactPath), 'utf8'),
      readFile(join(packageDirectory, artifactPath), 'utf8'),
    ]);
    assert.equal(installed, source, `Packed application example drifted: ${artifactPath}`);
  }
}

async function verifyIntegrationArtifacts(packageDirectory) {
  const relativeRoot = join('examples', 'integrations');
  const sourceRoot = join(projectRoot, relativeRoot);
  const relativePaths = await collectRelativeFiles(sourceRoot);
  for (const required of [
    'README.md',
    'mcp-client.ts',
    'langchain/agent.mjs.example',
    'drupal/pixiecore_integration/pixiecore_integration.info.yml',
    'drupal/pixiecore_integration/pixiecore_integration.services.yml',
    'drupal/pixiecore_integration/src/PixieCoreClient.php',
    'drupal/pixiecore_integration/tests/src/Unit/PixieCoreClientTest.php',
  ]) {
    assert.ok(relativePaths.includes(required), `Missing packed integration example: ${required}`);
  }
  for (const relativePath of relativePaths) {
    const artifactPath = join(relativeRoot, relativePath);
    const [source, installed] = await Promise.all([
      readFile(join(projectRoot, artifactPath)),
      readFile(join(packageDirectory, artifactPath)),
    ]);
    assert.deepEqual(installed, source, `Packed integration example drifted: ${artifactPath}`);
  }
}

async function verifyApplicationComparisonArtifacts(packageDirectory) {
  const relativeRoot = join('examples', 'comparison', 'publication-brief');
  const required = [
    'README.md',
    'benchmark-approaches.ts',
    'benchmark-contract.ts',
    'benchmark-dataset-v1.schema.json',
    'benchmark-dataset.json',
    'benchmark-report-v1.schema.json',
    'benchmark.ts',
    'compare.ts',
    'monolithic-publication-brief.yaml',
    'review-benchmark.ts',
  ];
  for (const relativePath of required) {
    const artifactPath = join(relativeRoot, relativePath);
    const [source, installed] = await Promise.all([
      readFile(join(projectRoot, artifactPath), 'utf8'),
      readFile(join(packageDirectory, artifactPath), 'utf8'),
    ]);
    assert.equal(installed, source, `Packed comparison example drifted: ${artifactPath}`);
  }
}

async function verifyReferenceBlueprintArtifacts(packageDirectory) {
  const relativeRoot = join('examples', 'blueprints');
  const sourceRoot = join(projectRoot, relativeRoot);
  const relativePaths = await collectRelativeFiles(sourceRoot);
  assert.ok(relativePaths.includes('catalog.yaml'));
  assert.ok(relativePaths.includes('quality-catalog.yaml'));
  assert.ok(relativePaths.includes('catalog-site/catalog.json'));
  assert.ok(relativePaths.includes('catalog-site/index.html'));
  assert.ok(relativePaths.includes('catalog-site/app.mjs'));
  assert.ok(relativePaths.includes('catalog-site/search.mjs'));
  assert.ok(relativePaths.includes('converter/date-normalizer/date-normalizer.yaml'));
  assert.ok(relativePaths.includes('converter/date-normalizer/README.md'));
  assert.ok(relativePaths.includes('converter/date-normalizer/evaluations/date-normalizer.yaml'));
  assert.ok(relativePaths.includes('converter/date-normalizer/tests/date-normalizer.contract.test.ts'));
  assert.ok(relativePaths.includes('classifier/travel-destination-level/travel-destination-level.yaml'));
  assert.ok(relativePaths.includes('classifier/travel-destination-level/README.md'));
  assert.ok(relativePaths.includes('classifier/travel-destination-level/evaluations/travel-destination-level.yaml'));
  assert.ok(relativePaths.includes('classifier/travel-destination-level/fixtures/travel-policy-v1.yaml'));
  assert.ok(relativePaths.includes('classifier/travel-destination-level/tests/travel-destination-level.contract.test.ts'));
  assert.ok(relativePaths.includes('summarizer/travel-request-summary/travel-request-summary.yaml'));
  assert.ok(relativePaths.includes('summarizer/travel-request-summary/README.md'));
  assert.ok(relativePaths.includes('summarizer/travel-request-summary/evaluations/travel-request-summary.yaml'));
  assert.ok(relativePaths.includes('summarizer/travel-request-summary/fixtures/travel-request-v1.yaml'));
  assert.ok(relativePaths.includes('summarizer/travel-request-summary/tests/travel-request-summary.contract.test.ts'));
  assert.ok(relativePaths.includes('validator/travel-request-form/travel-request-form.yaml'));
  assert.ok(relativePaths.includes('validator/travel-request-form/README.md'));
  assert.ok(relativePaths.includes('validator/travel-request-form/evaluations/travel-request-form.yaml'));
  assert.ok(relativePaths.includes('validator/travel-request-form/fixtures/travel-form-rules-v1.yaml'));
  assert.ok(relativePaths.includes('validator/travel-request-form/tests/travel-request-form.contract.test.ts'));
  assert.ok(relativePaths.includes('verifier/travel-document-evidence/travel-document-evidence.yaml'));
  assert.ok(relativePaths.includes('verifier/travel-document-evidence/README.md'));
  assert.ok(relativePaths.includes('verifier/travel-document-evidence/evaluations/travel-document-evidence.yaml'));
  assert.ok(relativePaths.includes('verifier/travel-document-evidence/fixtures/travel-document-evidence-v1.yaml'));
  assert.ok(relativePaths.includes('verifier/travel-document-evidence/fixtures/verification-policy-v1.yaml'));
  assert.ok(relativePaths.includes('verifier/travel-document-evidence/tests/travel-document-evidence.contract.test.ts'));
  assert.ok(relativePaths.includes('router/travel-approval-routing/travel-approval-routing.yaml'));
  assert.ok(relativePaths.includes('router/travel-approval-routing/README.md'));
  assert.ok(relativePaths.includes('router/travel-approval-routing/evaluations/travel-approval-routing.yaml'));
  assert.ok(relativePaths.includes('router/travel-approval-routing/fixtures/travel-approval-routing-v1.csv'));
  assert.ok(relativePaths.includes('router/travel-approval-routing/tests/travel-approval-routing.contract.test.ts'));
  assert.ok(relativePaths.includes('translator/travel-purpose-localizer/travel-purpose-localizer.yaml'));
  assert.ok(relativePaths.includes('translator/travel-purpose-localizer/README.md'));
  assert.ok(relativePaths.includes('translator/travel-purpose-localizer/evaluations/travel-purpose-localizer.yaml'));
  assert.ok(relativePaths.includes('translator/travel-purpose-localizer/fixtures/localization-policy-v1.yaml'));
  assert.ok(relativePaths.includes('translator/travel-purpose-localizer/tests/travel-purpose-localizer.contract.test.ts'));
  assert.ok(relativePaths.includes('extractor/travel-document-fields/travel-document-fields.yaml'));
  assert.ok(relativePaths.includes('extractor/travel-document-fields/README.md'));
  assert.ok(relativePaths.includes('extractor/travel-document-fields/evaluations/travel-document-fields.yaml'));
  assert.ok(relativePaths.includes('extractor/travel-document-fields/tests/travel-document-fields.contract.test.ts'));
  for (const fixture of [
    'blank-page.pdf',
    'multi-page.pdf',
    'native-text.pdf',
    'rotated.pdf',
    'scanned.pdf',
    'table.pdf',
    'travel-request-screenshot.png',
  ]) {
    assert.ok(relativePaths.includes(`extractor/travel-document-fields/fixtures/${fixture}`));
  }
  for (const relativePath of relativePaths) {
    const artifactPath = join(relativeRoot, relativePath);
    const [source, installed] = await Promise.all([
      readFile(join(projectRoot, artifactPath)),
      readFile(join(packageDirectory, artifactPath)),
    ]);
    assert.deepEqual(installed, source, `Packed reference Blueprint drifted: ${artifactPath}`);
  }
  const installedCatalogRoot = join(packageDirectory, relativeRoot, 'catalog-site');
  const [catalog, searchModule] = await Promise.all([
    readFile(join(installedCatalogRoot, 'catalog.json'), 'utf8').then(JSON.parse),
    import(pathToFileURL(join(installedCatalogRoot, 'search.mjs')).href),
  ]);
  const ocrMatches = searchModule.searchBlueprintCatalog(catalog.units, { use: 'OCR' });
  assert.deepEqual(ocrMatches.map(unit => unit.id), ['extractor/travel-document-fields']);
  assert.deepEqual(
    searchModule.searchBlueprintCatalog(catalog.units, { quality: 'remote_provider' })
      .map(unit => unit.id),
    [
      'classifier/travel-destination-level',
      'converter/date-normalizer',
      'extractor/travel-document-fields',
      'router/travel-approval-routing',
      'summarizer/travel-request-summary',
      'translator/travel-purpose-localizer',
      'validator/travel-request-form',
      'verifier/travel-document-evidence',
    ],
  );
}

async function verifyOpenAIBenchmarkEvidence(packageDirectory) {
  const repeatedRoot = join(
    'benchmarks',
    'results',
    'openai',
    'repeated',
    'rpe-007-repeated-20260826-live-1',
  );
  for (const relativePath of [
    'README.md',
    'checkpoint.json',
    'extractor-attachment-quality.json',
    'extractor-attachment-quality.md',
    'scorecard.json',
    'scorecard.md',
  ]) {
    const artifactPath = join(repeatedRoot, relativePath);
    const [source, installed] = await Promise.all([
      readFile(join(projectRoot, artifactPath), 'utf8'),
      readFile(join(packageDirectory, artifactPath), 'utf8'),
    ]);
    assert.equal(installed, source, `Packed OpenAI benchmark evidence drifted: ${artifactPath}`);
    assert.doesNotMatch(
      installed,
      /(?:^|["'])\/(?:Users|home)\/|OPENAI_API_KEY|sk-proj-|actual_output|expected_output/u,
      `Packed OpenAI benchmark evidence contains a forbidden value: ${artifactPath}`,
    );
  }
  const summarizerRoot = join(
    'benchmarks',
    'results',
    'openai',
    'repeated',
    'sa-001-summarizer-v2-20260901-2',
  );
  for (const relativePath of ['checkpoint.json', 'scorecard.json', 'scorecard.md']) {
    const artifactPath = join(summarizerRoot, relativePath);
    const [source, installed] = await Promise.all([
      readFile(join(projectRoot, artifactPath), 'utf8'),
      readFile(join(packageDirectory, artifactPath), 'utf8'),
    ]);
    assert.equal(installed, source, `Packed OpenAI benchmark evidence drifted: ${artifactPath}`);
    assert.doesNotMatch(
      installed,
      /(?:^|["'])\/(?:Users|home)\/|OPENAI_API_KEY|sk-proj-|actual_output|expected_output/u,
      `Packed OpenAI benchmark evidence contains a forbidden value: ${artifactPath}`,
    );
  }
  const adjacentRoot = join(
    'benchmarks',
    'results',
    'openai',
    'adjacent-patterns',
    'adopt-003-20260826-live-2',
  );
  for (const relativePath of [
    'report.json',
    'reviewed-report.json',
    'reviewed-scorecard.md',
    'scorecard.md',
  ]) {
    const artifactPath = join(adjacentRoot, relativePath);
    const [source, installed] = await Promise.all([
      readFile(join(projectRoot, artifactPath), 'utf8'),
      readFile(join(packageDirectory, artifactPath), 'utf8'),
    ]);
    assert.equal(installed, source, `Packed adjacent-pattern evidence drifted: ${artifactPath}`);
    assert.doesNotMatch(
      installed,
      /(?:^|["'])\/(?:Users|home)\/|OPENAI_API_KEY|sk-proj-|actual_output|expected_output|source_text/u,
      `Packed adjacent-pattern evidence contains a forbidden value: ${artifactPath}`,
    );
  }
}

async function verifyOcrDemoArtifacts(packageDirectory) {
  const relativeRoot = join('examples', 'demos', 'ocr-document-review');
  for (const relativePath of ['README.md', 'demo.yaml', 'run.mjs']) {
    const artifactPath = join(relativeRoot, relativePath);
    const [source, installed] = await Promise.all([
      readFile(join(projectRoot, artifactPath), 'utf8'),
      readFile(join(packageDirectory, artifactPath), 'utf8'),
    ]);
    assert.equal(installed, source, `Packed OCR demo drifted: ${artifactPath}`);
  }
  const result = await run(process.execPath, [
    join(packageDirectory, relativeRoot, 'run.mjs'),
    '--mode=mock',
  ], { cwd: packageDirectory });
  assert.equal(result.stderr, '');
  const artifact = JSON.parse(result.stdout);
  assert.equal(artifact.schema, 'pixiecore.blueprint-playground/v1');
  assert.equal(artifact.case.id, 'scanned-pdf-partial');
  assert.equal(artifact.mode, 'mock');
  assert.equal(artifact.mock.provider, 'playground-mock');
  assert.equal(artifact.real, undefined);
}

async function verifyLeanPackageBoundary(packageDirectory) {
  const relativeFiles = await collectRelativeFiles(packageDirectory);
  for (const relativePath of relativeFiles) {
    assert.doesNotMatch(
      relativePath,
      /(?:^|[\\/])(?:\.idea|\.vscode)(?:[\\/]|$)|(?:^|[\\/])\.DS_Store$/u,
      `Editor metadata must not be packed: ${relativePath}`,
    );
  }
  const sizes = await Promise.all(
    relativeFiles.map(relativePath => stat(join(packageDirectory, relativePath))),
  );
  const unpackedBytes = sizes.reduce((total, entry) => total + entry.size, 0);
  const fileCount = relativeFiles.length;

  assert.ok(
    unpackedBytes <= PACKAGE_FOOTPRINT_BUDGET.maxUnpackedBytes,
    `Packed artifact is ${unpackedBytes} bytes; budget is `
      + `${PACKAGE_FOOTPRINT_BUDGET.maxUnpackedBytes}`,
  );
  assert.ok(
    fileCount <= PACKAGE_FOOTPRINT_BUDGET.maxFileCount,
    `Packed artifact has ${fileCount} files; budget is `
      + `${PACKAGE_FOOTPRINT_BUDGET.maxFileCount}`,
  );

  for (const relativePath of ['examples/hello.yaml', 'examples/analyze.yaml']) {
    const [source, installed] = await Promise.all([
      readFile(join(projectRoot, relativePath), 'utf8'),
      readFile(join(packageDirectory, relativePath), 'utf8'),
    ]);
    assert.equal(installed, source, `Packed smoke Blueprint drifted: ${relativePath}`);
  }

  for (const relativePath of [
    'adoption',
    'benchmarks',
    'docs',
    'examples/application-composition',
    'examples/blueprints',
    'examples/comparison',
    'examples/demos',
    'examples/integrations',
    'examples/plugin-authoring',
    'examples/plugin-project',
  ]) {
    await assertPathMissing(join(packageDirectory, relativePath));
  }

  return { fileCount, unpackedBytes };
}

async function assertManagedProjectArtifactsAbsent(root) {
  await Promise.all([
    assertPathMissing(join(root, 'pixiecore.plugins.yml')),
    assertPathMissing(join(root, 'custom')),
  ]);
}

async function assertPathMissing(path) {
  await assert.rejects(
    access(path, constants.R_OK),
    error => error?.code === 'ENOENT',
  );
}

async function collectRelativeFiles(root) {
  const files = [];
  const visit = async (directory, prefix) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path, relativePath);
      else if (entry.isFile()) files.push(relativePath);
    }
  };
  await visit(root, '');
  return files;
}

function packageExportEntries(exportsDeclaration) {
  if (typeof exportsDeclaration === 'string' || Array.isArray(exportsDeclaration)) {
    return [['.', exportsDeclaration]];
  }
  assert.ok(exportsDeclaration && typeof exportsDeclaration === 'object', 'Package exports must be declared');
  const entries = Object.entries(exportsDeclaration);
  const subpathEntries = entries.filter(([key]) => key.startsWith('.'));
  if (subpathEntries.length === 0) return [['.', exportsDeclaration]];
  assert.equal(subpathEntries.length, entries.length, 'Package exports cannot mix subpaths and conditions');
  for (const [subpath] of subpathEntries) {
    assert.doesNotMatch(subpath, /\*/, `Wildcard export ${subpath} needs an explicit package smoke probe`);
  }
  return subpathEntries;
}

function collectPackageTargets(declaration, targets = []) {
  if (typeof declaration === 'string') {
    targets.push(declaration);
    return targets;
  }
  if (declaration === null) return targets;
  if (Array.isArray(declaration)) {
    for (const value of declaration) collectPackageTargets(value, targets);
    return targets;
  }
  assert.equal(typeof declaration, 'object', 'Package target declarations must contain strings');
  for (const value of Object.values(declaration)) collectPackageTargets(value, targets);
  return targets;
}

function hasCondition(declaration, condition) {
  if (!declaration || typeof declaration !== 'object') return false;
  if (Array.isArray(declaration)) return declaration.some(value => hasCondition(value, condition));
  if (Object.hasOwn(declaration, condition)) return true;
  return Object.values(declaration).some(value => hasCondition(value, condition));
}

function resolvePackageTarget(packageDirectory, target) {
  assert.equal(typeof target, 'string');
  assert.match(target, /^\.\//, `Package target must be relative: ${target}`);
  const targetPath = resolve(packageDirectory, target);
  const relativeTarget = relative(packageDirectory, targetPath);
  assert.ok(
    relativeTarget !== '..'
      && !relativeTarget.startsWith(`..${sep}`)
      && !isAbsolute(relativeTarget),
    `Package target escapes the package: ${target}`,
  );
  return targetPath;
}

function normalizeBins(manifest) {
  if (typeof manifest.bin === 'string') return { [manifest.name]: manifest.bin };
  assert.ok(manifest.bin && typeof manifest.bin === 'object', 'Package bin must be declared');
  for (const [name, target] of Object.entries(manifest.bin)) {
    assert.equal(typeof target, 'string', `Package bin ${name} must have a string target`);
  }
  return manifest.bin;
}

function installedBinShim(consumerDirectory, name) {
  const suffix = process.platform === 'win32' ? '.cmd' : '';
  return join(consumerDirectory, 'node_modules', '.bin', `${name}${suffix}`);
}

function runBin(path, args, options) {
  return run(path, args, { ...options, shell: process.platform === 'win32' });
}

function withNpmCache(args) {
  const cache = process.env.PIXIECORE_NPM_CACHE;
  return cache ? [...args, '--cache', cache] : args;
}

function consumerSmokeSource(snapshot, manifest, installedMcpPath, packageDirectory) {
  return String.raw`
    import assert from 'node:assert/strict';
    import { realpath } from 'node:fs/promises';
    import { join } from 'node:path';
    import { fileURLToPath } from 'node:url';
    import packageJson from '@pixieworks/pixiecore/package.json' with { type: 'json' };
    import blueprintSchema from '@pixieworks/pixiecore/blueprint/schema.json' with { type: 'json' };
    import legacyBlueprintSchema from '@pixieworks/pixiecore/blueprint/v1-schema.json' with { type: 'json' };
    import blueprintPackageSchema from '@pixieworks/pixiecore/blueprint/package-schema.json' with { type: 'json' };
    import blueprintQualityCatalogSchema from '@pixieworks/pixiecore/blueprint/quality-catalog-schema.json' with { type: 'json' };
    import pluginSchema from '@pixieworks/pixiecore/plugin/schema.json' with { type: 'json' };
    import applicationTraceSchema from '@pixieworks/pixiecore/application/trace-schema.json' with { type: 'json' };
    import applicationPartialResultSchema from '@pixieworks/pixiecore/application/partial-result-schema.json' with { type: 'json' };
    import signedAuditExportSchema from '@pixieworks/pixiecore/audit/schema.json' with { type: 'json' };
    import safeCacheRecordSchema from '@pixieworks/pixiecore/cache/record-schema.json' with { type: 'json' };
    import dataRetentionRecordSchema from '@pixieworks/pixiecore/data-policy/record-schema.json' with { type: 'json' };
    import evaluationPropertyCorpusSchema from '@pixieworks/pixiecore/eval/property-corpus-schema.json' with { type: 'json' };
    import evaluationBenchmarkSchema from '@pixieworks/pixiecore/eval/benchmark-schema.json' with { type: 'json' };
    import providerFallbackReceiptSchema from '@pixieworks/pixiecore/fallback/receipt-schema.json' with { type: 'json' };
    import instructionTemplateConformanceReportSchema from '@pixieworks/pixiecore/instruction-template/conformance-report-schema.json' with { type: 'json' };
    import jitProgramSchema from '@pixieworks/pixiecore/jit/program-schema.json' with { type: 'json' };
    import jitAdmissionReportSchema from '@pixieworks/pixiecore/jit/admission-report-schema.json' with { type: 'json' };
    import jitPromotionsSchema from '@pixieworks/pixiecore/jit/promotions-schema.json' with { type: 'json' };
    import pluginPackageSchema from '@pixieworks/pixiecore/plugin/package-schema.json' with { type: 'json' };
    import popBlueprintSchema from '@pixieworks/pixiecore/pop/blueprint-schema.json' with { type: 'json' };
    import popEvaluationDatasetSchema from '@pixieworks/pixiecore/pop/evaluation-dataset-schema.json' with { type: 'json' };
    import popEvaluationResultSchema from '@pixieworks/pixiecore/pop/evaluation-result-schema.json' with { type: 'json' };
    import popBlueprintPackageSchema from '@pixieworks/pixiecore/pop/blueprint-package-schema.json' with { type: 'json' };
    import popConformanceReportSchema from '@pixieworks/pixiecore/pop/conformance-report-schema.json' with { type: 'json' };
    import popConformanceSuiteSchema from '@pixieworks/pixiecore/pop/conformance-suite-schema.json' with { type: 'json' };
    import popConformanceSuite from '@pixieworks/pixiecore/pop/conformance-suite.json' with { type: 'json' };
    import ragChunkMetadataSchema from '@pixieworks/pixiecore/rag/chunk-metadata-schema.json' with { type: 'json' };
    import reviewHandoffSchema from '@pixieworks/pixiecore/review/handoff-schema.json' with { type: 'json' };
    import reviewReceiptSchema from '@pixieworks/pixiecore/review/receipt-schema.json' with { type: 'json' };
    import executionTelemetrySchema from '@pixieworks/pixiecore/telemetry/schema.json' with { type: 'json' };
    import * as pixiecore from '@pixieworks/pixiecore';
    import * as api from '@pixieworks/pixiecore/api';
    import * as application from '@pixieworks/pixiecore/application';
    import * as audit from '@pixieworks/pixiecore/audit';
    import * as blueprintPackages from '@pixieworks/pixiecore/blueprint-packages';
    import * as cache from '@pixieworks/pixiecore/cache';
    import * as conformance from '@pixieworks/pixiecore/conformance';
    import * as dataPolicy from '@pixieworks/pixiecore/data-policy';
    import * as evaluation from '@pixieworks/pixiecore/eval';
    import * as fallback from '@pixieworks/pixiecore/fallback';
    import * as jit from '@pixieworks/pixiecore/jit';
    import * as mcpServer from '@pixieworks/pixiecore/mcp-server';
    import * as pluginSdk from '@pixieworks/pixiecore/plugin';
    import * as rag from '@pixieworks/pixiecore/rag';
    import * as review from '@pixieworks/pixiecore/review';
    import * as telemetry from '@pixieworks/pixiecore/telemetry';

    const snapshot = ${JSON.stringify(snapshot)};
    const expectedPackage = ${JSON.stringify({ name: manifest.name, version: manifest.version })};
    const expectedPackageDirectory = ${JSON.stringify(packageDirectory)};
    assert.equal(
      await realpath(fileURLToPath(import.meta.resolve('@pixieworks/pixiecore'))),
      await realpath(join(expectedPackageDirectory, 'dist', 'index.js')),
    );
    assert.deepEqual(Object.keys(pixiecore).sort(), [...snapshot['@pixieworks/pixiecore']].sort());
    assert.deepEqual(Object.keys(api).sort(), [...snapshot['@pixieworks/pixiecore/api']].sort());
    assert.deepEqual(
      Object.keys(application).sort(),
      [...snapshot['@pixieworks/pixiecore/application']].sort(),
    );
    assert.deepEqual(Object.keys(audit).sort(), [...snapshot['@pixieworks/pixiecore/audit']].sort());
    assert.deepEqual(
      Object.keys(blueprintPackages).sort(),
      [...snapshot['@pixieworks/pixiecore/blueprint-packages']].sort(),
    );
    assert.deepEqual(Object.keys(cache).sort(), [...snapshot['@pixieworks/pixiecore/cache']].sort());
    assert.deepEqual(
      Object.keys(conformance).sort(),
      [...snapshot['@pixieworks/pixiecore/conformance']].sort(),
    );
    assert.deepEqual(Object.keys(dataPolicy).sort(), [...snapshot['@pixieworks/pixiecore/data-policy']].sort());
    assert.deepEqual(Object.keys(evaluation).sort(), [...snapshot['@pixieworks/pixiecore/eval']].sort());
    assert.deepEqual(Object.keys(fallback).sort(), [...snapshot['@pixieworks/pixiecore/fallback']].sort());
    assert.deepEqual(Object.keys(jit).sort(), [...snapshot['@pixieworks/pixiecore/jit']].sort());
    assert.deepEqual(Object.keys(mcpServer).sort(), [...snapshot['@pixieworks/pixiecore/mcp-server']].sort());
    assert.deepEqual(Object.keys(pluginSdk).sort(), [...snapshot['@pixieworks/pixiecore/plugin']].sort());
    assert.deepEqual(Object.keys(rag).sort(), [...snapshot['@pixieworks/pixiecore/rag']].sort());
    assert.deepEqual(Object.keys(review).sort(), [...snapshot['@pixieworks/pixiecore/review']].sort());
    assert.deepEqual(Object.keys(telemetry).sort(), [...snapshot['@pixieworks/pixiecore/telemetry']].sort());
    assert.equal(packageJson.name, expectedPackage.name);
    assert.equal(packageJson.version, expectedPackage.version);
    assert.equal(blueprintSchema.title, 'PixieCore Blueprint v2');
    assert.equal(legacyBlueprintSchema.title, 'PixieCore Blueprint v1');
    assert.equal(blueprintPackageSchema.properties.schema.const, 'pixiecore.blueprint-package/v1');
    assert.equal(blueprintQualityCatalogSchema.properties.schema.const, 'pixiecore.blueprint-quality-catalog/v1');
    assert.deepEqual(
      blueprintSchema.required,
      ['name', 'version', 'role', 'prompt', 'output_schema'],
    );
    assert.equal(pluginSchema.properties.schema.const, 'pixiecore.plugin/v1');
    assert.equal(applicationTraceSchema.properties.schema.const, 'pixiecore.application-trace/v1');
    assert.equal(applicationPartialResultSchema.properties.schema.const, 'pixiecore.application-partial-result/v1');
    assert.equal(signedAuditExportSchema.properties.schema.const, 'pixiecore.signed-audit-export/v1');
    assert.equal(safeCacheRecordSchema.properties.schema.const, 'pixiecore.safe-cache-record/v1');
    assert.equal(dataRetentionRecordSchema.properties.schema.const, 'pixiecore.data-retention-record/v1');
    assert.equal(evaluationPropertyCorpusSchema.properties.schema.const, 'pixiecore.evaluation-property-corpus/v1');
    assert.equal(evaluationBenchmarkSchema.properties.schema.const, 'pixiecore.blueprint-benchmark/v1');
    assert.equal(providerFallbackReceiptSchema.properties.schema.const, 'pixiecore.provider-fallback-receipt/v1');
    assert.equal(jitProgramSchema.title, 'PixieCore deterministic JIT program');
    assert.equal(jitAdmissionReportSchema.properties.schema.const, 'pixiecore.jit-admission-report/v1');
    assert.equal(jitPromotionsSchema.properties.schema.const, 'pixiecore.jit-promotions/v1');
    assert.equal(typeof jit.runJitAdmission, 'function');
    assert.equal(instructionTemplateConformanceReportSchema.properties.schema.const, 'pixiecore.instruction-template-conformance-report/v1');
    assert.equal(pluginSchema.title, 'PixieCore managed custom plugin manifest');
    assert.equal(pluginPackageSchema.properties.schema.const, 'pixiecore.plugin-package/v1');
    assert.equal(popBlueprintSchema.properties.schema.const, 'pop.blueprint/0.1');
    assert.equal(popEvaluationDatasetSchema.properties.schema.const, 'pop.evaluation-dataset/0.1');
    assert.equal(popEvaluationResultSchema.properties.schema.const, 'pop.evaluation-result/0.1');
    assert.equal(popBlueprintPackageSchema.properties.schema.const, 'pop.blueprint-package/0.1');
    assert.equal(popConformanceReportSchema.properties.schema.const, 'pop.conformance-report/0.1');
    assert.equal(popConformanceSuiteSchema.properties.schema.const, 'pop.conformance-suite/0.1');
    assert.equal(popConformanceSuite.schema, 'pop.conformance-suite/0.1');
    assert.equal(popConformanceSuite.specification, 'pop-core/0.1');
    assert.equal(ragChunkMetadataSchema.properties.schema.const, 'pixiecore.rag-chunk-metadata/v1');
    assert.equal(reviewHandoffSchema.properties.schema.const, 'pixiecore.review-handoff/v1');
    assert.equal(reviewReceiptSchema.properties.schema.const, 'pixiecore.review-receipt/v1');
    assert.equal(executionTelemetrySchema.properties.schema.const, 'pixiecore.execution-telemetry/v1');
    assert.equal(typeof pixiecore.PromptRuntime, 'function');
    assert.ok(new pixiecore.BlueprintValidationError('package smoke') instanceof pixiecore.PixieCoreError);
    assert.equal(typeof api.createApp, 'function');
    assert.equal(typeof application.createApplicationSchemaBoundary, 'function');
    const executionController = new application.ApplicationExecutionController({
      maxBudgetUnits: 1,
      maxConcurrent: 1,
      rateLimit: { maxStarts: 1, intervalMs: 1_000 },
      deadlineAt: new Date(Date.now() + 10_000),
    });
    assert.equal(await executionController.run(
      { unitId: 'package-smoke', budgetUnits: 1 },
      ({ signal }) => !signal.aborted,
    ), true);
    assert.equal(typeof blueprintPackages.verifyBlueprintPackage, 'function');
    const records = new Map();
    const safeCache = new cache.SafeContentCache({
      tenantId: 'package-tenant',
      port: {
        read: key => records.get(key) ?? null,
        write: record => { records.set(record.cache_key, record); },
        delete: key => { records.delete(key); },
        invalidate: () => 0,
      },
      now: () => new Date(0),
    });
    const cacheResult = await safeCache.getOrCompute({
      namespace: 'package',
      resourceId: 'smoke',
      resourceVersion: '1.0.0',
      invalidationVersion: '1',
      sensitivity: 'non-sensitive',
      ttlSeconds: 60,
      content: { value: true },
    }, () => ({ verified: true }));
    assert.equal(cacheResult.status, 'miss');
    const blueprintCache = new cache.BlueprintExecutionCache({
      tenantId: 'package-tenant',
      port: {
        read: () => { throw new Error('default-sensitive execution must not read'); },
        write: () => { throw new Error('default-sensitive execution must not write'); },
        delete: () => { throw new Error('default-sensitive execution must not delete'); },
        invalidate: () => { throw new Error('default-sensitive execution must not invalidate'); },
      },
    });
    const blueprintCacheResult = await blueprintCache.getOrCompute({
      blueprint: { id: 'package.blueprint', version: '1.0.0' },
      provider: { id: 'package-provider', version: '1.0.0' },
      model: { id: 'package-model', version: '2026-08-25' },
      tools: [],
      policy: { id: 'package-policy', version: '1.0.0' },
      invalidationVersion: '1',
      ttlSeconds: 60,
      input: { value: true },
    }, () => ({ verified: true }));
    assert.equal(blueprintCacheResult.status, 'bypass');
    assert.equal(typeof conformance.runPopConformanceSuite, 'function');
    assert.equal(typeof conformance.runInstructionTemplateConformanceSuite, 'function');
    const discardBoundary = new dataPolicy.DataPolicyBoundary({
      tenantId: 'package-tenant',
      policy: dataPolicy.createDiscardDataPolicy(),
      now: () => new Date(0),
      createRecordId: () => 'package-record',
    });
    const discardRecord = await discardBoundary.prepareRetention({
      stage: 'output',
      blueprintId: 'package.blueprint',
      blueprintVersion: '1.0.0',
      classification: 'internal',
      payload: { value: true },
    });
    assert.equal(discardRecord.payload, null);
    assert.equal(discardBoundary.readPayload(discardRecord), null);
    const fallbackResult = await fallback.executeWithProviderFallback({
      targets: [{
        id: 'package-primary', provider: 'fixture', model: 'fixture',
        quality: {
          score: 1, dataset_id: 'package-dataset', dataset_version: '1.0.0',
          measured_at: '2026-08-25T00:00:00.000Z',
        },
      }],
      policy: {
        policy_id: 'package-policy', policy_version: '1.0.0',
        fallback_error_codes: ['provider_unavailable'],
        minimum_quality_score: 1, maximum_quality_drop: 0,
      },
    }, () => true);
    assert.equal(fallbackResult.value, true);
    assert.equal(fallbackResult.receipt.fallback_used, false);
    const conformanceReport = await conformance.runPopConformanceSuite();
    assert.equal(conformanceReport.conformant, true);
    assert.equal(conformanceReport.summary.failed, 0);
    const instructionTemplateReport = await conformance.runInstructionTemplateConformanceSuite();
    assert.equal(instructionTemplateReport.conformant, true);
    assert.equal(instructionTemplateReport.summary.failed, 0);
    assert.equal(typeof application.executeApplicationNode, 'function');
    assert.equal(typeof application.createApplicationPartialResult, 'function');
    assert.equal(typeof evaluation.createEvaluationPropertyCorpus, 'function');
    assert.equal(typeof evaluation.runBlueprintPlayground, 'function');
    assert.equal(typeof evaluation.runBlueprintBenchmark, 'function');
    const telemetryArtifact = new telemetry.ExecutionTelemetryRecorder({
      telemetryId: 'package-telemetry',
    }).finish();
    assert.equal(telemetryArtifact.schema, 'pixiecore.execution-telemetry/v1');
    assert.equal(telemetryArtifact.totals.unit_count, 0);
    assert.equal(typeof mcpServer.createPixieCoreMcpServer, 'function');
    assert.equal(api.OPENAPI_DOCUMENT.info.title, 'PixieCore REST API');

    const handoff = review.createReviewHandoff({
      reviewId: 'package-review',
      traceId: 'package-trace',
      createdAt: new Date(0).toISOString(),
      blueprint: { name: 'package-smoke', version: '1.0' },
      output: { valid: true },
    });
    const receipt = review.createReviewReceipt(handoff, {
      decision: 'approved',
      reviewerId: 'package-reviewer',
      decidedAt: new Date(1).toISOString(),
    });
    assert.equal(review.verifyReviewReceipt(handoff, receipt), true);
    const ragMetadata = rag.createRagChunkMetadata({
      namespace: 'package.knowledge',
      chunkType: 'paragraph',
      field: 'body',
      version: '1',
      accessLevel: 'authenticated',
      sensitivity: 'internal',
      updatedAt: new Date(0).toISOString(),
      author: 'package-smoke',
    });
    assert.equal(ragMetadata.schema, 'pixiecore.rag-chunk-metadata/v1');
    let ragRetrievalCalls = 0;
    const ragChunk = { id: 'package-chunk', content: 'package knowledge', metadata: ragMetadata };
    const ragBoundary = new rag.RagRetrievalBoundary({
      store: {
        index: chunks => { assert.equal(chunks.length, 1); },
        retrieve: request => {
          ragRetrievalCalls++;
          assert.equal(request.scope.namespace, 'package.knowledge');
          return [{ chunk: ragChunk, score: 0.9 }];
        },
      },
      authorization: {
        authorize: request => request.namespace === 'package.knowledge',
      },
      scope: {
        namespace: 'package.knowledge',
        accessLevels: ['authenticated'],
        sensitivities: ['internal'],
      },
      maxResults: 2,
    });
    await ragBoundary.index([ragChunk]);
    const ragTool = ragBoundary.createTool({ name: 'retrieve_package_knowledge' });
    assert.deepEqual(Object.keys(ragTool.parameters.properties).sort(), ['limit', 'query']);
    assert.equal((await ragTool.execute({ query: 'package' })).length, 1);
    assert.equal(ragRetrievalCalls, 1);

    const coreManager = new pixiecore.PluginManager(undefined, {});
    try {
      assert.equal(coreManager.getAgentRole('assistant'), coreManager.getAgentRole('default'));
      assert.ok(coreManager.getAgentRole('assistant') instanceof pixiecore.DefaultAgentRole);
      assert.deepEqual(
        coreManager.getDecorators().map(decorator => [
          decorator.constructor.name,
          decorator.priority,
          decorator.stage,
        ]),
        [
          ['SchemaGuard', 10, 'after'],
          ['PermissionGuard', 20, 'before'],
          ['SelfEvalDecorator', 30, 'after'],
        ],
      );
      assert.deepEqual(
        [...coreManager.providers.keys()],
        ['openai', 'anthropic', 'azure_openai', 'azure_native', 'gemini_native', 'gemini_openai', 'apisix'],
      );
      for (const name of coreManager.providers.keys()) {
        assert.equal(coreManager.isBuiltInProvider(name), true);
      }
    } finally {
      await coreManager.close();
    }

    delete process.env.PROMPT_RUNTIME_ENV_FILE;
    delete process.env.PIXIECORE_INSTALLED_ENV_MARKER;
    const discoveredEnvironment = pixiecore.getRuntimeEnvironment();
    assert.equal(discoveredEnvironment.PIXIECORE_INSTALLED_ENV_MARKER, 'package-root');
    assert.equal(process.env.PIXIECORE_INSTALLED_ENV_MARKER, undefined);

    const installedMcpPath = ${JSON.stringify(installedMcpPath)};
    const installedMcp = await pixiecore.McpManager.fromAutoDiscovery(undefined, { environment: {} });
    try {
      assert.deepEqual(
        await Promise.all(installedMcp.configPaths.map(path => realpath(path))),
        [await realpath(installedMcpPath)],
      );
      assert.deepEqual(Object.keys(installedMcp.config.mcpServers), ['installed_package_root']);
      assert.equal(installedMcp.isLoaded, false);
      assert.equal(installedMcp.connectionCount, 0);
    } finally {
      await installedMcp.close();
    }

    const blueprint = 'name: package-smoke\nversion: "1.0"\nrole: assistant\nprompt: Return JSON\noutput_schema:\n  type: object\n  required: [message]\n  properties:\n    message:\n      type: string\n';
    const makeProvider = (name, close) => ({
      name,
      model: name + '-model',
      supportsTools: false,
      supportsMultimodal: false,
      supportsVision: () => false,
      supportsFileInput: () => false,
      getModelList: async () => [name + '-model'],
      generate: async () => ({ content: '{"message":"installed"}' }),
      ...(close ? { close } : {}),
    });

    let runtimeProviderCloseCount = 0;
    const runtime = new pixiecore.PromptRuntime({
      provider: makeProvider('package-smoke', async () => { runtimeProviderCloseCount++; }),
      environment: {},
      mcpConfigPath: 'disabled',
    });
    try {
      const result = await runtime.executeYaml(blueprint);
      assert.deepEqual(result, { message: 'installed' });
      const scenarioSource = JSON.stringify({
        name: 'Installed Scenario prompt',
        version: '1.0.0',
        role: 'assistant',
        input_placeholders: [{ name: 'value', type: 'number', required: true }],
        prompt: { Scenario: [{
          Role: 'reasoning-hint-without-plugin',
          Instruction: {
            Given: 'Input {{ value }}',
            When: 'Review the input',
            Then: 'Return the installed smoke result',
          },
        }] },
        output_schema: {
          type: 'object',
          required: ['message'],
          properties: { message: { type: 'string' } },
        },
      });
      assert.deepEqual(await runtime.executeYaml(scenarioSource, { value: 42 }),
        { message: 'installed' });
    } finally {
      await runtime.close();
    }
    await runtime.close();
    assert.equal(runtimeProviderCloseCount, 1);

    let apiProviderCloseCount = 0;
    const apiRuntime = new pixiecore.PromptRuntime({
      provider: makeProvider('package-smoke-api', async () => { apiProviderCloseCount++; }),
      environment: {},
      mcpConfigPath: 'disabled',
    });
    const server = api.createApp({ runtime: apiRuntime, environment: {} });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    try {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const baseUrl = 'http://127.0.0.1:' + address.port;

      const healthResponse = await fetch(baseUrl + '/health');
      assert.equal(healthResponse.status, 200);
      assert.deepEqual(await healthResponse.json(), { status: 'ok' });

      const executeResponse = await fetch(baseUrl + '/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blueprint, inputs: {} }),
      });
      assert.equal(executeResponse.status, 200);
      const executeBody = await executeResponse.json();
      assert.equal(executeBody.status, 'success');
      assert.deepEqual(executeBody.data, { message: 'installed' });
      assert.equal(executeBody.metadata.provider, 'package-smoke-api');
      assert.equal(executeBody.metadata.model, 'package-smoke-api-model');
      assert.equal(typeof executeBody.metadata.duration_ms, 'number');
    } finally {
      if (server.listening) {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
      await server.closeResources();
    }
    await server.closeResources();
    assert.equal(apiProviderCloseCount, 1);
  `;
}

function installedNegativeResolutionSmokeSource(packageDirectory, wrongBoundaryModule) {
  const componentUrl = pathToFileURL(join(
    packageDirectory,
    'dist',
    'core',
    'component',
    'package-root',
    'index.js',
  )).href;
  return String.raw`
    import assert from 'node:assert/strict';
    import { pathToFileURL } from 'node:url';

    for (const specifier of ['@pixieworks/pixiecore/private', '@pixieworks/pixiecore/dist/index.js']) {
      await assert.rejects(
        import(specifier),
        error => error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED',
      );
    }

    const { OwningPackageRootError, resolveOwningPackageRoot } = await import(
      ${JSON.stringify(componentUrl)}
    );
    assert.throws(
      () => resolveOwningPackageRoot(
        pathToFileURL(${JSON.stringify(wrongBoundaryModule)}),
        '@pixieworks/pixiecore',
      ),
      error => error instanceof OwningPackageRootError
        && error.failure === 'unexpected-package'
        && error.actualName === 'not-pixiecore',
    );
  `;
}

function installedPluginExamplesSmokeSource(pluginConfigPath) {
  return String.raw`
    import assert from 'node:assert/strict';
    import { PluginManager } from '@pixieworks/pixiecore';

    const manager = new PluginManager(undefined, {}, {
      pluginConfigPath: ${JSON.stringify(pluginConfigPath)},
    });
    try {
      await manager.load();
      const converter = manager.getAgentRole('converter');
      const classifier = manager.getAgentRole('classifier');
      assert.ok(converter);
      assert.ok(classifier);
      assert.equal(
        (await converter.apply('installed converter', {}, {})).messages.at(-1)?.content,
        'installed converter',
      );
      assert.equal(
        (await classifier.apply('installed classifier', {}, {})).messages.at(-1)?.content,
        'installed classifier',
      );
      const byId = new Map(manager.getPluginStatus().plugins.map(plugin => [plugin.id, plugin]));
      assert.equal(byId.get('example.converter')?.state, 'activated');
      assert.equal(byId.get('example.classifier')?.state, 'activated');
    } finally {
      await manager.close();
    }
  `;
}

function installedPluginDiscoverySmokeSource(environmentPluginDirectory) {
  return String.raw`
    import assert from 'node:assert/strict';
    import { resolve } from 'node:path';
    import { PluginManager } from '@pixieworks/pixiecore';

    const environmentPluginDirectory = ${JSON.stringify(environmentPluginDirectory)};
    const environment = { PROMPT_RUNTIME_PLUGINS_DIR: environmentPluginDirectory };
    const environmentManager = new PluginManager(undefined, environment);
    try {
      assert.deepEqual(environmentManager.getPluginDirectories(), [resolve(environmentPluginDirectory)]);
      await environmentManager.load();
      assert.equal(await environmentManager.getTool('installed_marker')?.execute({}), 'environment');
      assert.equal(await environmentManager.getTool('environment_only')?.execute({}), 'environment-only');
    } finally {
      await environmentManager.close();
    }

    const relativeDirectories = ['./plugins-first', './plugins-second'];
    const explicitManager = new PluginManager(relativeDirectories, environment);
    try {
      assert.deepEqual(
        explicitManager.getPluginDirectories(),
        relativeDirectories.map(directory => resolve(process.cwd(), directory)),
      );
      await explicitManager.load();
      assert.equal(explicitManager.getTool('environment_only'), undefined);
      assert.equal(await explicitManager.getTool('installed_marker')?.execute({}), 'second');
    } finally {
      await explicitManager.close();
    }
  `;
}

async function writeInstalledMarkerPlugin(directory, marker, includeEnvironmentOnly = false) {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'plugin.yml'), [
    `name: ${JSON.stringify(`Installed ${marker} marker`)}`,
    'module: ./plugin.mjs',
    '',
  ].join('\n'));
  await writeFile(join(directory, 'plugin.mjs'), `
const marker = ${JSON.stringify(marker)};
const tools = [{
  name: 'installed_marker',
  description: marker,
  parameters: { type: 'object' },
  execute() { return marker; },
}];
if (${JSON.stringify(includeEnvironmentOnly)}) {
  tools.push({
    name: 'environment_only',
    description: 'environment-only',
    parameters: { type: 'object' },
    execute() { return 'environment-only'; },
  });
}
export default { tools };
`);
}

async function writeInstalledManagedToolPlugin(
  root,
  directory,
  id,
  importMarkerPath,
  toolResult,
) {
  const pluginDirectory = join(root, directory);
  await mkdir(pluginDirectory, { recursive: true });
  await writeFile(join(pluginDirectory, 'plugin.yml'), [
    'schema: pixiecore.plugin/v1',
    `id: ${id}`,
    `name: ${JSON.stringify(`Installed managed ${directory}`)}`,
    'version: 0.1.0',
    'entry: ./plugin.mjs',
    '',
  ].join('\n'));
  await writeFile(join(pluginDirectory, 'plugin.mjs'), `
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(importMarkerPath)}, ${JSON.stringify(`${id} imported\n`)});
export default {
  tools: [{
    name: ${JSON.stringify(`managed_${directory}`)},
    description: ${JSON.stringify(id)},
    parameters: { type: 'object' },
    execute() { return ${JSON.stringify(toolResult)}; },
  }],
};
`);
}

function installedManagedPluginSmokeSource(managedConfigPath) {
  return String.raw`
    import assert from 'node:assert/strict';
    import { createApp } from '@pixieworks/pixiecore/api';

    const server = createApp({
      environment: {},
      mcpConfigPath: 'disabled',
      pluginConfigPath: ${JSON.stringify(managedConfigPath)},
      provider: {
        name: 'installed-managed-smoke',
        model: 'installed-managed-smoke',
        supportsTools: false,
        supportsMultimodal: false,
        async generate() { return { content: '{}' }; },
      },
    });
    try {
      const manager = server.runtime.pluginManager;
      await manager.load();
      assert.equal(await manager.getTool('managed_enabled')?.execute({}), 'managed package works');
      assert.equal(manager.getTool('managed_disabled'), undefined);
      const byId = new Map(manager.getPluginStatus().plugins.map(plugin => [plugin.id, plugin]));
      assert.equal(byId.get('package.enabled')?.state, 'activated');
      assert.equal(byId.get('package.disabled')?.state, 'disabled');
    } finally {
      await server.closeResources();
    }
  `;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function run(command, args, options = {}) {
  const expectedExitCodes = options.expectedExitCodes ?? [0];
  const result = await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env, npm_config_update_notifier: 'false' },
      shell: options.shell ?? false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolvePromise({ code, stdout, stderr }));
  });
  if (result.code !== null && expectedExitCodes.includes(result.code)) return result;
  throw new Error([
    `${command} ${args.join(' ')} exited with ${result.code ?? 'no status'}`,
    result.stdout,
    result.stderr,
  ].filter(Boolean).join('\n'));
}
