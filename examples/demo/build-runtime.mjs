/** Compile the existing fixture host without changing its fixtures or imports. */
import {cp, mkdir, readFile, writeFile} from 'node:fs/promises';
import ts from 'typescript';
const source = new URL('../integrations/drupal/executable-specification/runtime/mock-server.ts', import.meta.url);
const result = ts.transpileModule(await readFile(source, 'utf8'), {
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext},
  fileName: 'mock-server.ts', reportDiagnostics: true,
});
if (result.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) {
  throw Error('Fixture host compilation failed');
}
const output = new URL('../../build/demo/', import.meta.url);
await mkdir(output, {recursive: true});
await cp(new URL('../integrations/drupal/executable-specification/', import.meta.url), new URL('executable-specification/', output), {recursive: true});
await cp(new URL('../integrations/drupal/pixiecore_specification/blueprints/', import.meta.url), new URL('pixiecore_specification/blueprints/', output), {recursive: true});
await writeFile(new URL('executable-specification/runtime/mock-server.js', output), result.outputText);

// Reuse the existing Luna request adapter for the optional live host.
const lunaSource = new URL('../pixieagent/luna.ts', import.meta.url);
const luna = ts.transpileModule(await readFile(lunaSource, 'utf8'), {
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext},
  fileName: 'luna.ts', reportDiagnostics: true,
});
if (luna.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) throw Error('Luna adapter compilation failed');
await mkdir(new URL('pixieagent/', output), {recursive: true});
await writeFile(new URL('pixieagent/luna.js', output), luna.outputText);

for (const name of ['config', 'live-server', 'live-server.test']) {
  const source = new URL(`../integrations/drupal/executable-specification/runtime/${name}.ts`, import.meta.url);
  const compiled = ts.transpileModule(await readFile(source, 'utf8'), {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext},
    fileName: `${name}.ts`, reportDiagnostics: true,
  });
  if (compiled.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) throw Error('Live host compilation failed');
  await writeFile(new URL(`executable-specification/runtime/${name}.js`, output), compiled.outputText);
}
