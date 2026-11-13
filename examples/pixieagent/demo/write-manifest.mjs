/** Produce an integrity manifest inside the immutable runtime image. */
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const files={};
async function walk(path){
  for(const entry of (await readdir(resolve(root,path),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const name=`${path}/${entry.name}`;
    if(entry.isDirectory())await walk(name);
    else files[name]=createHash('sha256').update(await readFile(resolve(root,name))).digest('hex');
  }
}
for(const path of ['dist','schemas','node_modules','examples/pixieagent'])await walk(path);
for(const name of ['package.json','package-lock.json'])files[name]=createHash('sha256').update(await readFile(resolve(root,name))).digest('hex');
await writeFile(resolve(root,'bundle-manifest.json'),JSON.stringify({files}));
