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
