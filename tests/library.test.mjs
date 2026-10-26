import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from '../server.mjs';

test('migration preserves original rows and defaults, saves multiple tables and survives restart',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'tables-'));
 const dataPath=path.join(dir,'dictionary.json');
 await copyFile(new URL('../extension/data/dictionary.json',import.meta.url),dataPath);
 const original=await readFile(dataPath,'utf8');let server,base;
 const start=async()=>{server=await createServer({dataPath});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;};
 const stop=()=>new Promise(r=>server.close(r));
 const get=async()=> (await fetch(base+'/api/library')).json();
 const put=data=>fetch(base+'/api/library',{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(data)});
 try{
  await start();const library=await get();
  assert.deepEqual(library.tables[0].entries,JSON.parse(original).entries);
  assert.deepEqual(library.tables[0].defaults,{matchMode:'exact',caseSensitive:false,translatePlaceholders:true});
  library.tables.push({...structuredClone(library.tables[0]),id:'copy',name:'Copy'});
  library.tables[1].entries[0].matchMode='word';library.tables[1].entries[0].caseSensitive=true;
  const response=await put(library);assert.equal(response.status,200);const saved=await response.json();
  assert.equal((await put(library)).status,409);
  const invalid=structuredClone(saved);invalid.tables[1].entries[0].matchMode='regex';assert.equal((await put(invalid)).status,400);
  assert.equal((await fetch(base+'/api/dictionary',{method:'PUT'})).status,410);
  await stop();await start();assert.deepEqual(await get(),saved);
  assert.deepEqual((await (await fetch(base+'/api/dictionary')).json()).entries,JSON.parse(original).entries);
  assert.equal(await readFile(dataPath,'utf8'),original);
 }finally{if(server?.listening)await stop();await rm(dir,{recursive:true,force:true});}
});

test('canonical per-table JSON and retained manifest backups recover previous revisions',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'table-backup-'));
 const dataPath=path.join(dir,'dictionary.json');
 await copyFile(new URL('../extension/data/dictionary.json',import.meta.url),dataPath);
 let server=await createServer({dataPath});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const initial=await (await fetch(base+'/api/library')).json();
  const manifest=JSON.parse(await readFile(path.join(dir,'library.json'),'utf8'));
  assert.equal(manifest.storageVersion,1);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir,manifest.tableFiles[0]),'utf8')),initial.tables[0]);
  for(const name of ['First rename','Second rename']){
   const data=await (await fetch(base+'/api/library')).json();data.tables[0].name=name;
   assert.equal((await fetch(base+'/api/library',{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(data)})).status,200);
  }
  const firstBackup=JSON.parse(await readFile(path.join(dir,'library.json.rev-1.bak'),'utf8'));
  assert.deepEqual(JSON.parse(await readFile(path.join(dir,firstBackup.tableFiles[0]),'utf8')),initial.tables[0]);
  await new Promise(r=>server.close(r));
  await copyFile(path.join(dir,'library.json.rev-1.bak'),path.join(dir,'library.json'));
  server=await createServer({dataPath});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  assert.deepEqual(await (await fetch('http://127.0.0.1:'+server.address().port+'/api/library')).json(),initial);
 }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});

test('existing bundle migration preserves metadata and can save again, missing canonical files fail closed',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'table-existing-'));
 const dataPath=path.join(dir,'dictionary.json'),libraryPath=path.join(dir,'library.json');
 await copyFile(new URL('../extension/data/dictionary.json',import.meta.url),dataPath);
 const seed=JSON.parse(await readFile(dataPath,'utf8'));
 const library=TextPatch.migrate(seed);delete library.tables[0].defaults;
 library.tables[0].entries[0].customEvidence={retained:true};library.revision=8;
 const {writeFile}=await import('node:fs/promises');await writeFile(libraryPath,JSON.stringify(library));
 let server;
 try{
  server=await createServer({dataPath});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  const loaded=await (await fetch(base+'/api/library')).json();
  assert.equal(loaded.revision,8);assert.deepEqual(loaded.tables[0].entries,library.tables[0].entries);
  loaded.tables[0].name='Renamed';
  const result=await fetch(base+'/api/library',{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(loaded)});assert.equal(result.status,200);
  await new Promise(r=>server.close(r));
  const manifest=JSON.parse(await readFile(libraryPath,'utf8'));
  await rm(path.join(dir,manifest.tableFiles[0]));
  await assert.rejects(createServer({dataPath}),/누락/);
  assert.equal(await readFile(libraryPath,'utf8'),JSON.stringify(manifest,null,2)+'\n');
 }finally{if(server?.listening)await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
