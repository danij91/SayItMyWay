import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from '../server.mjs';
test('library rejects unauthorized and invalid saves without changing revision or evidence',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'table-api-')),dataPath=path.join(dir,'dictionary.json');
 await copyFile(new URL('../extension/data/dictionary.json',import.meta.url),dataPath);
 const server=await createServer({dataPath});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  const importUI=await fetch(base+'/import-ui.js');assert.equal(importUI.status,200);assert.match(await importUI.text(),/TextPatchImportUI/);
  const initial=await (await fetch(base+'/api/library')).json();
  const put=(body,headers={Origin:base,'Content-Type':'application/json'})=>fetch(base+'/api/library',{method:'PUT',headers,body:typeof body==='string'?body:JSON.stringify(body)});
  assert.equal((await put(initial,{'Content-Type':'application/json'})).status,403);
  assert.equal((await put(initial,{Origin:'https://attacker.example','Content-Type':'application/json'})).status,403);
  assert.equal((await put('{')).status,400);
  for(const mutate of [
   x=>x.tables[0].id=123,
   x=>x.tables[0].defaults.caseSensitive='true',
   x=>x.tables[0].entries[0].caseSensitive='false',
   x=>x.tables[0].entries.push(x.tables[0].entries[0]),
   x=>x.tables[0].entries[0].ko=null,
   x=>x.tables[0].entries[0].selector=42,
   x=>x.tables.splice(0,1),
   x=>x.tables[0].excludedTerms='none'
  ]){const invalid=structuredClone(initial);mutate(invalid);assert.equal((await put(invalid)).status,400);}
  assert.equal((await put(' '.repeat(5_000_001))).status,413);
  assert.deepEqual(await (await fetch(base+'/api/library')).json(),initial);
 }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
