#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = dirname(SCRIPT_DIRECTORY);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const REPOSITORY_CODE_EXTENSIONS = new Set([
  ...SOURCE_EXTENSIONS,
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);
const CORE_LAYERS = new Set(['component', 'contracts', 'bootstrap', 'kernel']);
const EXCEPTIONABLE_RULES = new Set([
  'bootstrap-dependency',
  'kernel-dependency',
  'plugin-dependency',
]);

if (isMainModule()) {
  const command = runArchitectureCheck(parseArguments(process.argv.slice(2)));
  const destination = command.exitCode === 0 ? process.stdout : process.stderr;
  destination.write(command.output);
  process.exitCode = command.exitCode;
}

/**
 * Runs the architecture checker without process or console side effects.
 *
 * The CLI and fixture tests share this boundary so repeated checks do not need
 * to reload TypeScript and the checker implementation in child processes.
 */
export function runArchitectureCheck(options = {}) {
  const repositoryRoot = resolve(options.root ?? DEFAULT_REPOSITORY_ROOT);
  const projectPath = resolveFromRoot(repositoryRoot, options.project ?? 'tsconfig.json');
  const baselinePath = resolveFromRoot(
    repositoryRoot,
    options.baseline ?? 'scripts/architecture-baseline.json',
  );
  const result = checkArchitecture({ repositoryRoot, projectPath, baselinePath });

  if (result.violations.length > 0) {
    return Object.freeze({
      exitCode: 1,
      output: [
        `Architecture check failed with ${result.violations.length} violation(s):`,
        ...result.violations.map(formatViolation),
        '',
      ].join('\n'),
      result,
    });
  }

  return Object.freeze({
    exitCode: 0,
    output: `Architecture check passed: ${result.sourceFileCount} source files, `
      + `${result.internalEdgeCount} internal edges, `
      + `${result.legacyFileCount} legacy files.\n`,
    result,
  });
}

/** Evaluates architecture policy for already-resolved repository paths. */
export function checkArchitecture({ repositoryRoot, projectPath, baselinePath }) {
  const violations = [];
  const sourceRoot = resolve(repositoryRoot, 'src');
  const baseline = loadBaseline(baselinePath, repositoryRoot, violations);
  const packageMetadata = loadPackageMetadata(repositoryRoot, violations);
  const parsedConfig = loadTypeScriptConfig(projectPath, violations);

  if (!parsedConfig) {
    return {
      violations: sortViolations(violations),
      sourceFileCount: 0,
      internalEdgeCount: 0,
      legacyFileCount: baseline.legacySourceFiles.size,
    };
  }

  const sourceFiles = loadArchitectureSourceFiles({
    fileNames: parsedConfig.fileNames,
    sourceRoot,
    repositoryRoot,
    violations,
  });
  const sourceFilePaths = new Set(sourceFiles.map(sourceFile => resolve(sourceFile.fileName)));
  const scannedSourceFiles = walkFiles(sourceRoot)
    .filter(file => SOURCE_EXTENSIONS.has(sourceExtension(file)))
    .filter(file => !isCorePluginTestFile(repositoryPath(repositoryRoot, file)))
    .map(file => resolve(file));

  for (const file of scannedSourceFiles) {
    if (sourceFilePaths.has(file)) continue;
    addViolation(violations, {
      rule: 'tsconfig-source-coverage',
      file: repositoryPath(repositoryRoot, file),
      message: 'Source file is not included by the architecture checker TypeScript project.',
    });
  }

  checkLegacyInventory({
    repositoryRoot,
    sourceRoot,
    baseline,
    violations,
  });
  checkFinalSourceRootInventory({
    repositoryRoot,
    sourceRoot,
    baseline,
    violations,
  });
  checkSourcePrefixLayout({ repositoryRoot, sourceRoot, violations });
  checkFractalDirectoryLayout({ repositoryRoot, sourceRoot, violations });
  checkCorePluginInventory({
    repositoryRoot,
    pluginsRoot: packageMetadata.corePluginsRoot,
    baseline,
    violations,
  });
  checkMandatoryRecipePluginInventory({
    repositoryRoot,
    pluginsRoot: packageMetadata.corePluginsRoot,
    baseline,
    violations,
  });
  checkRootBarrel({ repositoryRoot, sourceFiles, violations });
  checkImplementationInheritance({ repositoryRoot, sourceFiles, violations });

  const resolutionCache = ts.createModuleResolutionCache(
    repositoryRoot,
    fileName => ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase(),
    parsedConfig.options,
  );
  const edges = [];
  const opaqueImportFiles = new Set();

  for (const sourceFile of sourceFiles) {
    const fromAbsolute = resolve(sourceFile.fileName);
    const from = repositoryPath(repositoryRoot, fromAbsolute);

    for (const dependency of collectDependencies(sourceFile)) {
      if (dependency.opaque) {
        opaqueImportFiles.add(from);
        if (!baseline.opaqueDynamicImportFiles.has(from)) {
          addNodeViolation(violations, sourceFile, dependency.node, {
            rule: 'opaque-dynamic-import',
            file: from,
            message: 'Computed dynamic imports require an explicit capability allowlist entry.',
          });
        }
        continue;
      }

      const specifier = dependency.specifier;
      if (!specifier) continue;

      if (isSelfPackageSpecifier(specifier, packageMetadata.name)) {
        addNodeViolation(violations, sourceFile, dependency.node, {
          rule: 'source-self-package-import',
          file: from,
          message: `Internal source must not import the package through ${JSON.stringify(specifier)}.`,
        });
        continue;
      }

      const resolution = ts.resolveModuleName(
        specifier,
        fromAbsolute,
        parsedConfig.options,
        ts.sys,
        resolutionCache,
      ).resolvedModule;

      if (!resolution) {
        if (isLocalSpecifier(specifier)) {
          addNodeViolation(violations, sourceFile, dependency.node, {
            rule: 'unresolved-relative-import',
            file: from,
            message: `Cannot resolve local module ${JSON.stringify(specifier)}.`,
          });
        }
        continue;
      }

      const targetAbsolute = resolve(resolution.resolvedFileName);
      if (resolution.isExternalLibraryImport
          || isWithin(resolve(repositoryRoot, 'node_modules'), targetAbsolute)) {
        continue;
      }
      if (!isWithin(repositoryRoot, targetAbsolute)) {
        if (isLocalSpecifier(specifier)) {
          addNodeViolation(violations, sourceFile, dependency.node, {
            rule: 'source-import-escape',
            file: from,
            target: normalizeRepositoryPath(relative(repositoryRoot, targetAbsolute)),
            message: `Local source dependency escapes the repository: ${targetAbsolute}.`,
          });
        }
        continue;
      }

      const target = repositoryPath(repositoryRoot, targetAbsolute);
      if (!isWithin(sourceRoot, targetAbsolute)) {
        addNodeViolation(violations, sourceFile, dependency.node, {
          rule: 'source-import-escape',
          file: from,
          target,
          message: `Source dependency escapes src/: ${target}.`,
        });
        continue;
      }

      if (!sourceFilePaths.has(targetAbsolute)) {
        addNodeViolation(violations, sourceFile, dependency.node, {
          rule: 'untracked-source-dependency',
          file: from,
          target,
          message: `Resolved source dependency is not part of the TypeScript project: ${target}.`,
        });
        continue;
      }

      if (isLocalSpecifier(specifier)
          && SOURCE_EXTENSIONS.has(sourceExtension(targetAbsolute))
          && !hasRuntimeJavaScriptExtension(specifier)) {
        addNodeViolation(violations, sourceFile, dependency.node, {
          rule: 'relative-import-extension',
          file: from,
          target,
          message: `Local TypeScript dependency must use its emitted JavaScript extension: ${JSON.stringify(specifier)}.`,
        });
      }

      const edge = {
        from,
        fromAbsolute,
        target,
        targetAbsolute,
        sourceFile,
        node: dependency.node,
      };
      edges.push(edge);

      if (target === 'src/index.ts' && from !== target) {
        addNodeViolation(violations, sourceFile, dependency.node, {
          rule: 'root-barrel-import',
          file: from,
          target,
          message: 'Internal source must not import the public root barrel.',
        });
      }
    }
  }

  for (const allowedFile of baseline.opaqueDynamicImportFiles) {
    if (opaqueImportFiles.has(allowedFile)) continue;
    addViolation(violations, {
      rule: 'stale-opaque-import-allowlist',
      file: allowedFile,
      message: 'Opaque dynamic-import allowlist entry is unused or its file no longer exists.',
    });
  }

  checkTargetDependencies({
    baseline,
    edges,
    repositoryRoot,
    violations,
  });
  checkCycles({ sourceFiles, edges, repositoryRoot, violations });
  checkExamples({ repositoryRoot, packageMetadata, violations });
  checkCustomPlugins({ repositoryRoot, packageMetadata, violations });

  return {
    violations: sortViolations(violations),
    sourceFileCount: sourceFiles.length,
    internalEdgeCount: new Set(edges.map(edge => `${edge.from}\0${edge.target}`)).size,
    legacyFileCount: baseline.legacySourceFiles.size,
  };
}

/**
 * Parses only configured production source files for architecture inspection.
 *
 * Architecture rules consume syntax and module resolution, not TypeScript type
 * checking. Avoiding `createProgram()` prevents every fixture invocation from
 * parsing default library declarations while keeping a fresh source snapshot
 * for each checker invocation.
 */
function loadArchitectureSourceFiles({ fileNames, sourceRoot, repositoryRoot, violations }) {
  const sourceFiles = [];
  for (const fileName of fileNames) {
    const absolutePath = resolve(fileName);
    if (!isWithin(sourceRoot, absolutePath)) continue;

    let text;
    try {
      text = readFileSync(absolutePath, 'utf8');
    }
    catch (error) {
      addViolation(violations, {
        rule: 'tsconfig-source-read',
        file: repositoryPath(repositoryRoot, absolutePath),
        message: `Cannot read TypeScript source: ${errorMessage(error)}.`,
      });
      continue;
    }

    sourceFiles.push(ts.createSourceFile(
      absolutePath,
      text,
      ts.ScriptTarget.Latest,
      false,
      sourceScriptKind(absolutePath),
    ));
  }
  return sourceFiles.sort((left, right) => left.fileName.localeCompare(right.fileName));
}

/** Selects the parser mode required by an architecture-project source path. */
function sourceScriptKind(fileName) {
  return sourceExtension(fileName) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function checkImplementationInheritance({ repositoryRoot, sourceFiles, violations }) {
  for (const sourceFile of sourceFiles) {
    const file = repositoryPath(repositoryRoot, sourceFile.fileName);
    if (file.includes('/tests/')) continue;
    const visit = node => {
      if (ts.isClassDeclaration(node)) {
        const inheritance = node.heritageClauses?.find(
          clause => clause.token === ts.SyntaxKind.ExtendsKeyword,
        );
        if (inheritance) {
          const className = node.name?.text ?? '<anonymous>';
          if (!className.endsWith('Error')) {
            addNodeViolation(violations, sourceFile, inheritance, {
              rule: 'implementation-inheritance',
              file,
              message: `${className} must compose collaborators instead of extending an implementation class.`,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
}

function checkCorePluginInventory({ repositoryRoot, pluginsRoot, baseline, violations }) {
  if (baseline.migrationPhase < 7) return;
  if (!existsSync(pluginsRoot)) {
    addViolation(violations, {
      rule: 'core-plugin-inventory',
      file: 'src/plugins',
      message: 'Phase 7 requires the canonical core plugin directory.',
    });
    return;
  }

  for (const unit of discoverCorePluginUnits(pluginsRoot)) {
    const { pluginRoot, name } = unit;
    const manifest = resolve(pluginRoot, `${name}.yaml`);
    const activator = resolve(pluginRoot, `${name}.ts`);
    const implementation = resolve(pluginRoot, 'src');
    const tests = resolve(pluginRoot, 'tests');
    const pluginPath = repositoryPath(repositoryRoot, pluginRoot);
    if (!existsSync(manifest)) {
      addViolation(violations, {
        rule: 'core-plugin-manifest',
        file: pluginPath,
        message: `Every core plugin unit requires canonical ${name}.yaml.`,
      });
    }
    if (!existsSync(activator)) {
      addViolation(violations, {
        rule: 'core-plugin-activator',
        file: pluginPath,
        message: `Every core plugin unit requires ${name}.ts.`,
      });
    }
    if (!existsSync(implementation)) {
      addViolation(violations, {
        rule: 'core-plugin-source',
        file: pluginPath,
        message: 'Every core plugin unit requires src/.',
      });
    }
    const ownedTests = existsSync(tests)
      ? walkFiles(tests).filter(file => file.endsWith('.test.ts'))
      : [];
    if (ownedTests.length === 0) {
      addViolation(violations, {
        rule: 'core-plugin-tests',
        file: pluginPath,
        message: 'Every core plugin unit requires at least one tests/**/*.test.ts file.',
      });
    }
    const childPluginsRoot = resolve(pluginRoot, 'plugins');
    for (const file of walkFiles(pluginRoot)
      .filter(path => !isWithin(childPluginsRoot, path))) {
      const normalized = normalizeRepositoryPath(file);
      if (!normalized.endsWith('.yml') && !normalized.endsWith('.yaml')) continue;
      if (resolve(file) === manifest) continue;
      if (name === 'recipe'
          && repositoryPath(repositoryRoot, file)
            === `${pluginPath}/recipes/pixiecore.recipe.yaml`) {
        continue;
      }
      addViolation(violations, {
        rule: 'core-plugin-manifest-location',
        file: repositoryPath(repositoryRoot, file),
        message: `Core manifests must use ${name}.yaml at the plugin unit root.`,
      });
    }
  }
}

function discoverCorePluginUnits(pluginsRoot) {
  const units = [];
  const visit = (containerRoot, parentRoot) => {
    const entries = readdirSync(containerRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const pluginRoot = resolve(containerRoot, entry.name);
      units.push({
        pluginRoot,
        name: entry.name,
        ...(parentRoot === undefined ? {} : { parentRoot }),
      });
      const children = resolve(pluginRoot, 'plugins');
      if (existsSync(children)) visit(children, pluginRoot);
    }
  };
  visit(pluginsRoot, undefined);
  return units;
}

function checkMandatoryRecipePluginInventory({ repositoryRoot, pluginsRoot, baseline, violations }) {
  if (baseline.migrationPhase < 8) return;
  const recipeRoot = resolve(pluginsRoot, 'recipe');
  const required = [
    ['recipe.ts', 'mandatory-recipe-plugin-entry'],
    ['recipe.yaml', 'mandatory-recipe-plugin-manifest'],
    ['src', 'mandatory-recipe-plugin-source'],
    ['tests', 'mandatory-recipe-plugin-tests'],
    ['recipes/pixiecore.recipe.yaml', 'mandatory-standard-recipe'],
  ];
  for (const [path, rule] of required) {
    if (existsSync(resolve(recipeRoot, path))) continue;
    addViolation(violations, {
      rule,
      file: repositoryPath(repositoryRoot, resolve(recipeRoot, path)),
      message: `The mandatory Recipe plugin requires ${path}.`,
    });
  }
  if (!existsSync(resolve(recipeRoot, 'tests'))) return;
  const ownedTests = walkFiles(resolve(recipeRoot, 'tests'))
    .filter(file => file.endsWith('.test.ts'));
  if (ownedTests.length > 0) return;
  addViolation(violations, {
    rule: 'mandatory-recipe-plugin-tests',
    file: repositoryPath(repositoryRoot, resolve(recipeRoot, 'tests')),
    message: 'The mandatory Recipe plugin requires at least one tests/**/*.test.ts file.',
  });
}

function checkLegacyInventory({ repositoryRoot, sourceRoot, baseline, violations }) {
  const actualLegacyFiles = new Set(
    walkFiles(sourceRoot)
      .map(file => repositoryPath(repositoryRoot, file))
      .filter(file => file !== 'src/index.ts'
        && !file.startsWith('src/core/')
        && !file.startsWith('src/plugins/')),
  );

  for (const file of actualLegacyFiles) {
    if (baseline.legacySourceFiles.has(file)) continue;
    addViolation(violations, {
      rule: 'legacy-source-file',
      file,
      message: 'New files must be created under src/core/ or src/plugins/; this legacy path is not baselined.',
    });
  }

  for (const file of baseline.legacySourceFiles) {
    if (actualLegacyFiles.has(file)) continue;
    addViolation(violations, {
      rule: 'stale-legacy-source-file',
      file,
      message: 'Legacy baseline entry no longer exists and must be removed.',
    });
  }
}

function checkFinalSourceRootInventory({ repositoryRoot, sourceRoot, baseline, violations }) {
  if (baseline.migrationPhase < 8) return;

  for (const file of baseline.legacySourceFiles) {
    addViolation(violations, {
      rule: 'phase-8-legacy-baseline',
      file,
      message: 'Phase 8 forbids legacy source baseline entries.',
    });
  }

  const entries = existsSync(sourceRoot)
    ? readdirSync(sourceRoot, { withFileTypes: true })
    : [];
  const rootBarrel = entries.find(entry => entry.name === 'index.ts');
  const coreDirectory = entries.find(entry => entry.name === 'core');
  const pluginsDirectory = entries.find(entry => entry.name === 'plugins');

  if (!rootBarrel?.isFile()) {
    addViolation(violations, {
      rule: 'source-root-inventory',
      file: 'src/index.ts',
      message: 'Phase 8 requires src/index.ts as the only source-root public file.',
    });
  }
  if (!coreDirectory?.isDirectory()) {
    addViolation(violations, {
      rule: 'source-root-inventory',
      file: 'src/core',
      message: 'Phase 8 requires src/core as the only source-root code directory.',
    });
  }
  if (!pluginsDirectory?.isDirectory()) {
    addViolation(violations, {
      rule: 'source-root-inventory',
      file: 'src/plugins',
      message: 'The canonical bundled plugin directory must be parallel to src/core.',
    });
  }

  for (const entry of entries) {
    if (entry.name === 'index.ts' || entry.name === 'core' || entry.name === 'plugins') continue;
    addViolation(violations, {
      rule: 'source-root-inventory',
      file: `src/${entry.name}`,
      message: 'The final source root permits only index.ts, core, and plugins directly below src/.',
    });
  }
}

function checkSourcePrefixLayout({ repositoryRoot, sourceRoot, violations }) {
  const filesByDirectory = new Map();
  for (const file of walkFiles(sourceRoot)) {
    const path = repositoryPath(repositoryRoot, file);
    if (!SOURCE_EXTENSIONS.has(sourceExtension(file))) continue;
    if (!path.startsWith('src/core/') && !path.startsWith('src/plugins/')) continue;
    if (path.includes('/tests/') || path.includes('/generated/')) continue;
    const directory = dirname(path);
    const files = filesByDirectory.get(directory) ?? [];
    files.push(basename(path, sourceExtension(path)));
    filesByDirectory.set(directory, files);
  }

  for (const [directory, stems] of filesByDirectory) {
    const suffixesByPrefix = new Map();
    for (const stem of stems) {
      const separator = stem.indexOf('-');
      if (separator < 1) continue;
      const prefix = stem.slice(0, separator);
      const suffixes = suffixesByPrefix.get(prefix) ?? [];
      suffixes.push(stem);
      suffixesByPrefix.set(prefix, suffixes);
    }
    for (const [prefix, suffixes] of suffixesByPrefix) {
      if (suffixes.length < 2 && !stems.includes(prefix)) continue;
      const grouped = stems
        .filter(stem => stem === prefix || stem.startsWith(`${prefix}-`))
        .sort();
      addViolation(violations, {
        rule: 'source-prefix-layout',
        file: directory,
        message: `Group ${grouped.join(', ')} under ${directory}/${prefix}/ and remove the repeated prefix.`,
      });
    }
  }
}

function checkFractalDirectoryLayout({ repositoryRoot, sourceRoot, violations }) {
  const visit = directory => {
    const entries = readdirSync(directory, { withFileTypes: true });
    const childDirectories = entries.filter(entry => entry.isDirectory());
    const sourceFiles = entries
      .filter(entry => entry.isFile() && SOURCE_EXTENSIONS.has(sourceExtension(entry.name)))
      .map(entry => resolve(directory, entry.name));

    if (childDirectories.length > 0) {
      const implementationFiles = sourceFiles
        .filter(file => !isStructuralBoundaryFile(repositoryRoot, file))
        .map(file => basename(file))
        .sort();
      if (implementationFiles.length >= 3) {
        const path = repositoryPath(repositoryRoot, directory);
        addViolation(violations, {
          rule: 'fractal-directory-layout',
          file: path,
          message: `Move non-leaf implementation files ${implementationFiles.join(', ')} into responsibility-named child directories.`,
        });
      }
    }

    for (const entry of childDirectories) {
      if (entry.name === 'generated') continue;
      visit(resolve(directory, entry.name));
    }
  };

  visit(sourceRoot);
}

function isStructuralBoundaryFile(repositoryRoot, file) {
  const path = repositoryPath(repositoryRoot, file);
  const name = basename(path);
  if (name === 'index.ts') return true;
  const directory = dirname(path);
  if (directory.startsWith('src/plugins/') && basename(directory) === 'src') {
    return new Set(['activator.ts', 'factory.ts', 'service.ts']).has(name);
  }
  return path === 'src/core/bootstrap/plugin-manager/manager.ts'
    || path === 'src/core/bootstrap/distribution-signatures.ts';
}

function checkRootBarrel({ repositoryRoot, sourceFiles, violations }) {
  const rootBarrel = sourceFiles.find(
    sourceFile => repositoryPath(repositoryRoot, sourceFile.fileName) === 'src/index.ts',
  );
  if (!rootBarrel) {
    addViolation(violations, {
      rule: 'missing-root-barrel',
      file: 'src/index.ts',
      message: 'The package root barrel is missing from the TypeScript project.',
    });
    return;
  }

  for (const statement of rootBarrel.statements) {
    if (ts.isExportDeclaration(statement)) {
      const moduleSpecifier = statement.moduleSpecifier;
      if (!moduleSpecifier) continue;
      if (ts.isStringLiteralLike(moduleSpecifier)
          && isLocalSpecifier(moduleSpecifier.text)) {
        continue;
      }
      const specifier = ts.isStringLiteralLike(moduleSpecifier)
        ? moduleSpecifier.text
        : moduleSpecifier.getText(rootBarrel);
      addNodeViolation(violations, rootBarrel, moduleSpecifier, {
        rule: 'root-public-dependency',
        file: 'src/index.ts',
        message: `The public root may re-export only local contracts, kernel entry points, and direct bundled plugin entries; ${JSON.stringify(specifier)} is external.`,
      });
      continue;
    }
    if (ts.isEmptyStatement(statement)) continue;
    addNodeViolation(violations, rootBarrel, statement, {
      rule: 'root-barrel-only',
      file: 'src/index.ts',
      message: 'src/index.ts may contain export declarations only.',
    });
  }
}

function checkTargetDependencies({ baseline, edges, repositoryRoot, violations }) {
  const exceptionByFingerprint = new Map();
  const usedExceptions = new Set();

  for (const exception of baseline.temporaryDependencyExceptions) {
    const fingerprint = dependencyFingerprint(exception.rule, exception.from, exception.to);
    if (exceptionByFingerprint.has(fingerprint)) {
      addViolation(violations, {
        rule: 'duplicate-dependency-exception',
        file: exception.from,
        target: exception.to,
        message: `Duplicate temporary dependency exception for ${exception.rule}.`,
      });
      continue;
    }
    exceptionByFingerprint.set(fingerprint, exception);

    if (!EXCEPTIONABLE_RULES.has(exception.rule)) {
      addViolation(violations, {
        rule: 'invalid-dependency-exception',
        file: exception.from,
        target: exception.to,
        message: `${exception.rule} is not an exceptionable architecture rule.`,
      });
    }
    if (baseline.migrationPhase > exception.expiresAfterPhase) {
      addViolation(violations, {
        rule: 'expired-dependency-exception',
        file: exception.from,
        target: exception.to,
        message: `Temporary dependency exception expired after phase ${exception.expiresAfterPhase}.`,
      });
    }
  }

  for (const edge of edges) {
    const sourceArea = classifySourceArea(edge.from);
    const targetArea = classifySourceArea(edge.target);

    if (sourceArea.kind === 'unknown-core') {
      addNodeViolation(violations, edge.sourceFile, edge.node, {
        rule: 'unknown-core-area',
        file: edge.from,
        target: edge.target,
        message: `File is outside the allowed src/core areas: ${edge.from}.`,
      });
      continue;
    }
    if (targetArea.kind === 'unknown-core') {
      addNodeViolation(violations, edge.sourceFile, edge.node, {
        rule: 'unknown-core-area',
        file: edge.from,
        target: edge.target,
        message: `Dependency targets an unknown src/core area: ${edge.target}.`,
      });
      continue;
    }

    let violation;
    if (sourceArea.kind === 'root') {
      const isAllowedCoreEntry = targetArea.kind === 'target'
        && ['contracts', 'kernel'].includes(targetArea.layer);
      const isDirectPluginEntry = targetArea.kind === 'target'
        && targetArea.layer === 'plugins'
        && targetArea.file === `${targetArea.pluginRoot}/${targetArea.plugin}.ts`;
      if (targetArea.kind === 'target' && !isAllowedCoreEntry && !isDirectPluginEntry) {
        violation = {
          rule: 'root-public-dependency',
          message: 'The public root may re-export only contracts, kernel entry points, and direct bundled plugin entries.',
        };
      }
    } else if (sourceArea.kind === 'target') {
      violation = targetDependencyViolation(sourceArea, targetArea, edge);
    }

    if (!violation) continue;
    const fingerprint = dependencyFingerprint(violation.rule, edge.from, edge.target);
    const exception = exceptionByFingerprint.get(fingerprint);
    if (exception && baseline.migrationPhase <= exception.expiresAfterPhase) {
      usedExceptions.add(fingerprint);
      continue;
    }

    addNodeViolation(violations, edge.sourceFile, edge.node, {
      rule: violation.rule,
      file: edge.from,
      target: edge.target,
      message: violation.message,
    });
  }

  for (const [fingerprint, exception] of exceptionByFingerprint) {
    if (usedExceptions.has(fingerprint)) continue;
    addViolation(violations, {
      rule: 'stale-dependency-exception',
      file: exception.from,
      target: exception.to,
      message: `Temporary dependency exception for ${exception.rule} is unused.`,
    });
  }

  for (const file of walkFiles(resolve(repositoryRoot, 'src/core'))) {
    const path = repositoryPath(repositoryRoot, file);
    if (classifySourceArea(path).kind !== 'unknown-core') continue;
    addViolation(violations, {
      rule: 'unknown-core-area',
      file: path,
      message: 'Files under src/core must belong to component, contracts, bootstrap, or kernel.',
    });
  }
}

function targetDependencyViolation(source, target, edge) {
  if (source.layer === 'component') {
    if (target.kind !== 'target' || target.layer !== 'component') {
      return {
        rule: 'component-dependency',
        message: 'Components may depend only on other components and external packages.',
      };
    }
    return undefined;
  }

  if (source.layer === 'contracts') {
    if (target.kind !== 'target' || !['component', 'contracts'].includes(target.layer)) {
      return {
        rule: 'contracts-dependency',
        message: 'Contracts may depend only on components and other contracts.',
      };
    }
    return undefined;
  }

  if (source.layer === 'bootstrap') {
    if (target.kind !== 'target'
        || !['component', 'contracts', 'bootstrap'].includes(target.layer)) {
      return {
        rule: 'bootstrap-dependency',
        message: 'Bootstrap may depend only on components, contracts, and bootstrap internals.',
      };
    }
    return undefined;
  }

  if (source.layer === 'kernel') {
    if (target.kind === 'target'
        && target.layer === 'plugins'
        && target.file === `${target.pluginRoot}/${target.plugin}.ts`) {
      return undefined;
    }
    if (target.kind !== 'target'
        || !['component', 'contracts', 'bootstrap', 'kernel'].includes(target.layer)) {
      return {
        rule: 'kernel-dependency',
        message: 'Kernel may depend on core layers and direct plugin entry points, but not plugin leaf files.',
      };
    }
    return undefined;
  }

  if (source.layer === 'plugins') {
    if (target.kind === 'target' && ['component', 'contracts'].includes(target.layer)) {
      return undefined;
    }
    if (target.kind === 'target'
        && target.layer === 'plugins'
        && target.pluginRoot === source.pluginRoot) {
      if (target.file === `${source.pluginRoot}/${source.plugin}.ts`
          && source.file !== target.file) {
        return {
          rule: 'plugin-self-barrel',
          message: 'Files inside a plugin must import leaf files, not their own plugin entry point.',
        };
      }
      return undefined;
    }
    if (target.kind === 'target'
        && target.layer === 'plugins'
        && source.pluginRoot.startsWith(`${target.pluginRoot}/plugins/`)
        && target.file === `${target.pluginRoot}/${target.plugin}.ts`) {
      return undefined;
    }
    return {
      rule: 'plugin-dependency',
      message: 'Core plugins may depend only on components, contracts, files in the same plugin, and a direct ancestor plugin entry.',
    };
  }

  return undefined;
}

function checkCycles({ sourceFiles, edges, repositoryRoot, violations }) {
  const files = sourceFiles.map(sourceFile => repositoryPath(repositoryRoot, sourceFile.fileName));
  const graph = new Map(files.map(file => [file, new Set()]));
  for (const edge of edges) graph.get(edge.from)?.add(edge.target);

  const indexByFile = new Map();
  const lowLinkByFile = new Map();
  const stack = [];
  const onStack = new Set();
  let nextIndex = 0;

  const visit = file => {
    indexByFile.set(file, nextIndex);
    lowLinkByFile.set(file, nextIndex);
    nextIndex += 1;
    stack.push(file);
    onStack.add(file);

    for (const dependency of graph.get(file) ?? []) {
      if (!indexByFile.has(dependency)) {
        visit(dependency);
        lowLinkByFile.set(
          file,
          Math.min(lowLinkByFile.get(file), lowLinkByFile.get(dependency)),
        );
      } else if (onStack.has(dependency)) {
        lowLinkByFile.set(
          file,
          Math.min(lowLinkByFile.get(file), indexByFile.get(dependency)),
        );
      }
    }

    if (lowLinkByFile.get(file) !== indexByFile.get(file)) return;
    const component = [];
    let current;
    do {
      current = stack.pop();
      onStack.delete(current);
      component.push(current);
    } while (current !== file);

    const isSelfCycle = component.length === 1 && graph.get(file)?.has(file);
    if (component.length <= 1 && !isSelfCycle) return;
    component.sort();
    addViolation(violations, {
      rule: 'dependency-cycle',
      file: component[0],
      message: `Dependency cycle: ${component.join(' -> ')}${component.length > 1 ? ` -> ${component[0]}` : ''}.`,
    });
  };

  for (const file of [...files].sort()) {
    if (!indexByFile.has(file)) visit(file);
  }
}

function checkExamples({ repositoryRoot, packageMetadata, violations }) {
  const examplesRoot = resolve(repositoryRoot, 'examples');
  checkOwnedPluginSourceLayouts({
    root: resolve(examplesRoot, 'plugin-project/custom/plugins'),
    repositoryRoot,
    violations,
    rulePrefix: 'example-custom-plugin',
  });
  for (const file of walkFiles(examplesRoot).filter(isRepositoryCodeFile)) {
    const sourceFile = parseLooseSourceFile(file);
    const from = repositoryPath(repositoryRoot, file);
    for (const dependency of collectDependencies(sourceFile)) {
      if (dependency.opaque || !dependency.specifier) continue;
      const specifier = dependency.specifier;
      if (isSelfPackageSpecifier(specifier, packageMetadata.name)
          && !packageMetadata.exports.has(specifier)) {
        addNodeViolation(violations, sourceFile, dependency.node, {
          rule: 'example-package-deep-import',
          file: from,
          message: `Example imports undeclared package subpath ${JSON.stringify(specifier)}.`,
        });
      }
      if (isLocalSpecifier(specifier)) {
        const target = resolve(dirname(file), stripSpecifierSuffix(specifier));
        if (isWithin(resolve(repositoryRoot, 'src'), target)) {
          addNodeViolation(violations, sourceFile, dependency.node, {
            rule: 'example-source-deep-import',
            file: from,
            target: repositoryPath(repositoryRoot, target),
            message: 'Examples must use declared package exports instead of importing src directly.',
          });
        }
      }
    }
  }
}

function checkCustomPlugins({ repositoryRoot, packageMetadata, violations }) {
  const customRoot = resolve(repositoryRoot, 'custom/plugins');
  const files = walkFiles(customRoot);
  const manifestDirectories = checkOwnedPluginSourceLayouts({
    root: customRoot,
    repositoryRoot,
    violations,
    rulePrefix: 'custom-plugin',
  });

  for (const file of files.filter(isRepositoryCodeFile)) {
    const absoluteFile = resolve(file);
    const pluginRoot = nearestManifestDirectory(absoluteFile, customRoot, manifestDirectories);
    const from = repositoryPath(repositoryRoot, absoluteFile);
    if (!pluginRoot) {
      addViolation(violations, {
        rule: 'custom-plugin-root',
        file: from,
        message: 'Custom plugin code must be contained by a directory with <name>.yaml or legacy plugin.yml.',
      });
      continue;
    }

    const sourceFile = parseLooseSourceFile(absoluteFile);
    for (const dependency of collectDependencies(sourceFile)) {
      if (dependency.opaque) {
        addNodeViolation(violations, sourceFile, dependency.node, {
          rule: 'custom-plugin-opaque-import',
          file: from,
          message: 'Repository-owned custom plugins may not use computed dynamic imports.',
        });
        continue;
      }
      if (!dependency.specifier) continue;
      const specifier = dependency.specifier;
      const supportedPluginApi = [packageMetadata.name, `${packageMetadata.name}/plugin`];
      if (isSelfPackageSpecifier(specifier, packageMetadata.name)
          && (!supportedPluginApi.includes(specifier)
            || !packageMetadata.exports.has(specifier))) {
        addNodeViolation(violations, sourceFile, dependency.node, {
          rule: 'custom-plugin-package-deep-import',
          file: from,
          message: `Custom plugins may import only declared ${packageMetadata.name} or ${packageMetadata.name}/plugin package exports.`,
        });
      }
      if (isLocalSpecifier(specifier)) {
        const target = resolve(dirname(absoluteFile), stripSpecifierSuffix(specifier));
        if (!isWithin(pluginRoot, target)) {
          addNodeViolation(violations, sourceFile, dependency.node, {
            rule: 'custom-plugin-import-escape',
            file: from,
            target: repositoryPath(repositoryRoot, target),
            message: 'A custom plugin may not import files outside its own plugin root.',
          });
        }
      }
    }
  }
}

function checkOwnedPluginSourceLayouts({
  root,
  repositoryRoot,
  violations,
  rulePrefix,
}) {
  const manifestDirectories = new Set(
    walkFiles(root)
      .filter(file => {
        const directory = dirname(resolve(file));
        return basename(file) === `${basename(directory)}.yaml`
          || basename(file) === 'plugin.yml';
      })
      .map(file => dirname(resolve(file))),
  );

  for (const pluginRoot of manifestDirectories) {
    const name = basename(pluginRoot);
    const pluginPath = repositoryPath(repositoryRoot, pluginRoot);
    const required = [
      [`${name}.ts`, `${rulePrefix}-entry`, `Repository-owned plugin requires ${name}.ts.`],
      [`${name}.yaml`, `${rulePrefix}-manifest`, `Repository-owned plugin requires ${name}.yaml.`],
      ['src', `${rulePrefix}-source`, 'Repository-owned plugin requires src/.'],
    ];
    for (const [relativePath, rule, message] of required) {
      if (existsSync(resolve(pluginRoot, relativePath))) continue;
      addViolation(violations, { rule, file: pluginPath, message });
    }
    const tests = resolve(pluginRoot, 'tests');
    const ownedTests = existsSync(tests)
      ? walkFiles(tests).filter(file => file.endsWith('.test.ts'))
      : [];
    if (ownedTests.length === 0) {
      addViolation(violations, {
        rule: `${rulePrefix}-tests`,
        file: pluginPath,
        message: 'Repository-owned plugin requires at least one tests/**/*.test.ts file.',
      });
    }
  }
  return manifestDirectories;
}

function collectDependencies(sourceFile) {
  const dependencies = [];
  const addLiteral = (node, literal) => {
    dependencies.push({ node, specifier: literal.text, opaque: false });
  };

  const visit = node => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        addLiteral(node.moduleSpecifier, node.moduleSpecifier);
      }
    } else if (ts.isImportEqualsDeclaration(node)
        && ts.isExternalModuleReference(node.moduleReference)
        && node.moduleReference.expression
        && ts.isStringLiteralLike(node.moduleReference.expression)) {
      addLiteral(node.moduleReference.expression, node.moduleReference.expression);
    } else if (ts.isImportTypeNode(node)
        && ts.isLiteralTypeNode(node.argument)
        && ts.isStringLiteralLike(node.argument.literal)) {
      addLiteral(node.argument.literal, node.argument.literal);
    } else if (ts.isCallExpression(node) && isImportOrRequireCall(node)) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument)) {
        addLiteral(argument, argument);
      } else {
        dependencies.push({ node, specifier: undefined, opaque: true });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return dependencies;
}

function isImportOrRequireCall(node) {
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  return ts.isIdentifier(node.expression) && node.expression.text === 'require';
}

function classifySourceArea(file) {
  if (file === 'src/index.ts') return { kind: 'root', file };
  if (file.startsWith('src/plugins/')) {
    const parts = file.split('/');
    if (parts.length < 4) return { kind: 'unknown-core', file };
    let pluginIndex = 2;
    while (parts[pluginIndex + 1] === 'plugins' && parts[pluginIndex + 2]) {
      pluginIndex += 2;
    }
    const plugin = parts[pluginIndex];
    const pluginRoot = parts.slice(0, pluginIndex + 1).join('/');
    return {
      kind: 'target',
      layer: 'plugins',
      plugin,
      pluginRoot,
      file,
    };
  }
  if (!file.startsWith('src/core/')) return { kind: 'legacy', file };
  const parts = file.split('/');
  const layer = parts[2];
  if (!CORE_LAYERS.has(layer)) return { kind: 'unknown-core', file };
  return { kind: 'target', layer, file };
}


function isCorePluginTestFile(file) {
  const area = classifySourceArea(file);
  return area.kind === 'target'
    && area.layer === 'plugins'
    && file.startsWith(`${area.pluginRoot}/tests/`);
}

function loadBaseline(path, repositoryRoot, violations) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    addViolation(violations, {
      rule: 'architecture-baseline',
      file: repositoryPath(repositoryRoot, path),
      message: `Cannot read architecture baseline: ${errorMessage(error)}.`,
    });
    return emptyBaseline();
  }

  if (!isRecord(value) || value.schemaVersion !== 1) {
    addViolation(violations, {
      rule: 'architecture-baseline',
      file: repositoryPath(repositoryRoot, path),
      message: 'Architecture baseline must be an object with schemaVersion 1.',
    });
    return emptyBaseline();
  }

  const migrationPhase = Number.isInteger(value.migrationPhase) && value.migrationPhase >= 1
    ? value.migrationPhase
    : 1;
  if (migrationPhase !== value.migrationPhase) {
    addViolation(violations, {
      rule: 'architecture-baseline',
      file: repositoryPath(repositoryRoot, path),
      message: 'migrationPhase must be a positive integer.',
    });
  }

  const legacySourceFiles = stringSet(value.legacySourceFiles, 'legacySourceFiles', path, repositoryRoot, violations);
  const opaqueEntries = objectArray(
    value.opaqueDynamicImportFiles,
    'opaqueDynamicImportFiles',
    path,
    repositoryRoot,
    violations,
  );
  const opaqueDynamicImportFiles = new Set();
  for (const entry of opaqueEntries) {
    if (typeof entry.file !== 'string' || entry.file.length === 0
        || typeof entry.reason !== 'string' || entry.reason.trim().length === 0) {
      addViolation(violations, {
        rule: 'architecture-baseline',
        file: repositoryPath(repositoryRoot, path),
        message: 'Each opaqueDynamicImportFiles entry requires non-empty file and reason strings.',
      });
      continue;
    }
    opaqueDynamicImportFiles.add(normalizeRepositoryPath(entry.file));
  }

  const exceptionEntries = objectArray(
    value.temporaryDependencyExceptions,
    'temporaryDependencyExceptions',
    path,
    repositoryRoot,
    violations,
  );
  const temporaryDependencyExceptions = [];
  for (const entry of exceptionEntries) {
    if (typeof entry.rule !== 'string'
        || typeof entry.from !== 'string'
        || typeof entry.to !== 'string'
        || typeof entry.reason !== 'string'
        || entry.reason.trim().length === 0
        || !Number.isInteger(entry.expiresAfterPhase)
        || entry.expiresAfterPhase < 1) {
      addViolation(violations, {
        rule: 'architecture-baseline',
        file: repositoryPath(repositoryRoot, path),
        message: 'Each temporary dependency exception requires rule/from/to/reason and a non-expired integer expiresAfterPhase.',
      });
      continue;
    }
    temporaryDependencyExceptions.push({
      rule: entry.rule,
      from: normalizeRepositoryPath(entry.from),
      to: normalizeRepositoryPath(entry.to),
      reason: entry.reason,
      expiresAfterPhase: entry.expiresAfterPhase,
    });
  }

  return {
    migrationPhase,
    legacySourceFiles,
    opaqueDynamicImportFiles,
    temporaryDependencyExceptions,
  };
}

function emptyBaseline() {
  return {
    migrationPhase: 1,
    legacySourceFiles: new Set(),
    opaqueDynamicImportFiles: new Set(),
    temporaryDependencyExceptions: [],
  };
}

function loadPackageMetadata(repositoryRoot, violations) {
  const path = resolve(repositoryRoot, 'package.json');
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    addViolation(violations, {
      rule: 'package-metadata',
      file: 'package.json',
      message: `Cannot read package metadata: ${errorMessage(error)}.`,
    });
    return {
      name: '@pixieworks/pixiecore',
      exports: new Set(['@pixieworks/pixiecore']),
      corePluginsRoot: resolve(repositoryRoot, 'src', 'plugins'),
    };
  }

  const name = typeof value.name === 'string' && value.name.length > 0 ? value.name : '@pixieworks/pixiecore';
  const configuredPlugins = value.pixiecore?.plugins;
  if (configuredPlugins !== './plugins') {
    addViolation(violations, {
      rule: 'package-plugin-root',
      file: 'package.json',
      message: 'package.json requires pixiecore.plugins to be ./plugins.',
    });
  }
  const packageExports = new Set();
  if (typeof value.exports === 'string' || Array.isArray(value.exports)) {
    packageExports.add(name);
  } else if (isRecord(value.exports)) {
    for (const key of Object.keys(value.exports)) {
      if (key === '.') packageExports.add(name);
      else if (key.startsWith('./')) packageExports.add(`${name}/${key.slice(2)}`);
    }
  }
  return {
    name,
    exports: packageExports,
    corePluginsRoot: resolve(repositoryRoot, 'src', './plugins'),
  };
}

function loadTypeScriptConfig(path, violations) {
  const readResult = ts.readConfigFile(path, ts.sys.readFile);
  if (readResult.error) {
    addViolation(violations, {
      rule: 'typescript-project',
      file: path,
      message: flattenDiagnostic(readResult.error),
    });
    return undefined;
  }
  const parsed = ts.parseJsonConfigFileContent(
    readResult.config,
    ts.sys,
    dirname(path),
    undefined,
    path,
  );
  for (const diagnostic of parsed.errors) {
    addViolation(violations, {
      rule: 'typescript-project',
      file: path,
      message: flattenDiagnostic(diagnostic),
    });
  }
  return parsed.errors.length === 0 ? parsed : undefined;
}

function parseArguments(arguments_) {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!['--root', '--project', '--baseline'].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = arguments_[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    index += 1;
    if (argument === '--root') options.root = value;
    if (argument === '--project') options.project = value;
    if (argument === '--baseline') options.baseline = value;
  }
  return options;
}

function stringSet(value, field, path, repositoryRoot, violations) {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    addViolation(violations, {
      rule: 'architecture-baseline',
      file: repositoryPath(repositoryRoot, path),
      message: `${field} must be an array of repository-relative path strings.`,
    });
    return new Set();
  }
  const normalized = value.map(normalizeRepositoryPath);
  if (new Set(normalized).size !== normalized.length) {
    addViolation(violations, {
      rule: 'architecture-baseline',
      file: repositoryPath(repositoryRoot, path),
      message: `${field} contains duplicate paths.`,
    });
  }
  return new Set(normalized);
}

function objectArray(value, field, path, repositoryRoot, violations) {
  if (!Array.isArray(value) || value.some(entry => !isRecord(entry))) {
    addViolation(violations, {
      rule: 'architecture-baseline',
      file: repositoryPath(repositoryRoot, path),
      message: `${field} must be an array of objects.`,
    });
    return [];
  }
  return value;
}

function parseLooseSourceFile(path) {
  const extension = extname(path).toLowerCase();
  const scriptKind = extension === '.tsx'
    ? ts.ScriptKind.TSX
    : extension === '.jsx'
      ? ts.ScriptKind.JSX
      : ['.js', '.mjs', '.cjs'].includes(extension)
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, scriptKind);
}

function nearestManifestDirectory(file, customRoot, manifestDirectories) {
  let current = dirname(file);
  while (isWithin(customRoot, current)) {
    if (manifestDirectories.has(current)) return current;
    if (current === customRoot) break;
    current = dirname(current);
  }
  return undefined;
}

function walkFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files.sort();
}

function sourceExtension(path) {
  if (path.endsWith('.d.ts')) return '.ts';
  if (path.endsWith('.d.mts')) return '.mts';
  if (path.endsWith('.d.cts')) return '.cts';
  return extname(path).toLowerCase();
}

function isRepositoryCodeFile(path) {
  return REPOSITORY_CODE_EXTENSIONS.has(sourceExtension(path));
}

function hasRuntimeJavaScriptExtension(specifier) {
  return /\.(?:js|mjs|cjs)(?:[?#].*)?$/.test(specifier);
}

function isLocalSpecifier(specifier) {
  return specifier.startsWith('./') || specifier.startsWith('../') || isAbsolute(specifier);
}

function isSelfPackageSpecifier(specifier, packageName) {
  return specifier === packageName || specifier.startsWith(`${packageName}/`);
}

function isWithin(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function repositoryPath(repositoryRoot, path) {
  const value = relative(repositoryRoot, resolve(path));
  return normalizeRepositoryPath(value || '.');
}

function normalizeRepositoryPath(path) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function stripSpecifierSuffix(specifier) {
  return specifier.replace(/[?#].*$/, '');
}

function resolveFromRoot(root, path) {
  return isAbsolute(path) ? path : resolve(root, path);
}

function dependencyFingerprint(rule, from, to) {
  return `${rule}\0${from}\0${to}`;
}

function addNodeViolation(violations, sourceFile, node, violation) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  addViolation(violations, {
    ...violation,
    line: position.line + 1,
    column: position.character + 1,
  });
}

function addViolation(violations, violation) {
  violations.push({ line: 1, column: 1, ...violation });
}

function sortViolations(violations) {
  return violations.sort((left, right) =>
    left.file.localeCompare(right.file)
      || left.line - right.line
      || left.column - right.column
      || left.rule.localeCompare(right.rule)
      || (left.target ?? '').localeCompare(right.target ?? ''));
}

function formatViolation(violation) {
  return `${violation.file}:${violation.line}:${violation.column} [${violation.rule}] ${violation.message}`;
}

function flattenDiagnostic(diagnostic) {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Determines whether this module is the invoked CLI entry point. */
function isMainModule() {
  return process.argv[1] !== undefined
    && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
