/** Compile only the existing live harness; the runtime was built separately. */
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import ts from 'typescript';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const output=resolve(root,'build/pixieagent');
await mkdir(output,{recursive:true});
for(const name of ['agent','budget','harness','luna']) {
  const source=await readFile(resolve(root,`examples/pixieagent/${name}.ts`),'utf8');
  const result=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},fileName:`${name}.ts`,reportDiagnostics:true});
  if(result.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error))throw Error('Harness compilation failed');
  await writeFile(resolve(output,`${name}.js`),result.outputText);
}
