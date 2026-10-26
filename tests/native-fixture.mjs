import {cp} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Copy runtime code and currency rates, never ignored user libraries,
// split tables or backups. Migration tests may explicitly supply their own copy.
export async function copyNativeExtension(destination,source=fileURLToPath(new URL('../extension/',import.meta.url))){
  await cp(source,destination,{recursive:true,filter:file=>{
    const relative=path.relative(source,file).split(path.sep).join('/');
    return !relative.startsWith('data/') || ['data/eurofxref-2026-10-23.xml'].includes(relative);
  }});
}
