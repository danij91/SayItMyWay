import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {IDBFactory,IDBObjectStore} from 'fake-indexeddb';
const source=f=>readFile(new URL('../extension/'+f,import.meta.url),'utf8');
const seed=JSON.parse(await source('data/dictionary.json'));
async function setup(indexedDB=new IDBFactory()) {
 const c=vm.createContext({indexedDB,structuredClone,URL,TextEncoder,console});
 for(const f of ['shared.js','library.js','collection.js','repository.js'])vm.runInContext(await source(f),c);
 return {c,indexedDB,repo:c.LibraryRepository.create({indexedDB}),library:c.TextPatch.migrate(seed)};
}
test('repository saves atomically, rejects stale drafts and persists across instances',async()=>{
 const {repo,library,indexedDB}=await setup();
 await repo.initialize(async()=>library);
 const a=await repo.get(),b=await repo.get();a.tables[0].entries[0].notes='Edited note';
 const saved=await repo.save(a);assert.equal(saved.revision,2);assert.equal(saved.tables[0].revision,seed.revision+1);
 await assert.rejects(repo.save(b),/충돌|변경/);
 const restarted=await setup(indexedDB);assert.equal((await restarted.repo.get()).tables[0].entries[0].notes,'Edited note');
 let called=false;await restarted.repo.initialize(async()=>{called=true;return library;});assert.equal(called,false);
 const invalid=await repo.get();invalid.tables[0].entries[0].status='bad';await assert.rejects(repo.save(invalid));
 assert.equal((await repo.get()).revision,2);
});

test('migration prefers newest revision, cache wins ties, missing and conflicting tables remain accessible',async()=>{
 const {c,library}=await setup();
 for(const newer of ['cache','bundle','tie']){
  const cache=structuredClone(library),bundle=structuredClone(library);
  cache.revision=newer==='cache'?9:8;bundle.revision=newer==='bundle'?9:8;
  cache.tables[0].entries[0].notes='Cache original';bundle.tables[0].entries[0].notes='Bundled original';
  cache.customMetadata={retained:'cache'};bundle.customMetadata={retained:'bundle'};
  bundle.tables.push({...structuredClone(bundle.tables[0]),id:'bundle-only',name:'Bundle only'});
  cache.tables.push({...structuredClone(cache.tables[0]),id:'cache-only',name:'Cache only'});
  const merged=c.LibraryRepository.mergeMigration(cache,bundle),winner=newer==='bundle'?'Bundled original':'Cache original';
  assert.equal(merged.tables.find(t=>t.id==='crimson-desert').entries[0].notes,winner);
  assert.ok(merged.tables.some(t=>t.id==='cache-only'));assert.ok(merged.tables.some(t=>t.id==='bundle-only'));
  const conflict=merged.tables.find(t=>t.migrationConflict);
  assert.equal(conflict.migrationConflict.originalId,'crimson-desert');assert.notEqual(conflict.entries[0].notes,winner);
  assert.ok(conflict.excludedCategories.includes('지명'));assert.ok(conflict.entries[0].evidence);
  assert.ok(merged.migrationSources[0].metadata.customMetadata);
 }
});

test('split bundled manifest loads metadata and fails closed on corrupt or missing referenced files',async()=>{
 const {c,library,repo}=await setup(),table=library.tables[0];
 const manifest={schemaVersion:2,revision:20,storageVersion:1,tableFiles:['tables/generation/crimson-desert.json'],custom:'Preserved'};
 const files={'data/library.json':manifest,'data/tables/generation/crimson-desert.json':table};
 const fetcher=async file=>({ok:file in files,status:file in files?200:404,json:async()=>structuredClone(files[file])});
 const loaded=await c.LibraryRepository.bundled(fetcher,p=>p);assert.equal(loaded.revision,20);assert.equal(loaded.custom,'Preserved');
 assert.equal(loaded.tables[0].entries.length,147);
 delete files['data/tables/generation/crimson-desert.json'];
 await assert.rejects(repo.initialize(()=>c.LibraryRepository.bundled(fetcher,p=>p)),/파일/);
 await assert.rejects(repo.get(),/초기화/);
 files['data/tables/generation/crimson-desert.json']=table;
 await repo.initialize(()=>c.LibraryRepository.bundled(fetcher,p=>p));assert.equal((await repo.get()).revision,20);
 files['data/library.json']={bad:true};await assert.rejects(c.LibraryRepository.bundled(fetcher,p=>p));
 files['data/library.json']={...manifest,tableFiles:['../escape.json']};await assert.rejects(c.LibraryRepository.bundled(fetcher,p=>p));
});

test('capture commits rows and durable receipt together; quota failure rolls both back and restart recovers exact counts',async()=>{
 const {repo,library,indexedDB}=await setup();await repo.initialize(async()=>library);
 const request={operationId:'stable-operation',tableId:'new-capture',createName:'Collected',candidates:['Original'],source:{url:'https://example.com/path?q=private#hash',title:'Title',language:'en',capturedAt:'2026-10-20T00:00:00Z'}};
 const put=IDBObjectStore.prototype.put;let writes=0;
 IDBObjectStore.prototype.put=function(...args){if(++writes===2)throw Error('QuotaExceededError');return put.apply(this,args);};
 try{await assert.rejects(repo.capture(request),/Quota/);}finally{IDBObjectStore.prototype.put=put;}
 assert.equal((await repo.get()).revision,1);assert.equal((await repo.get()).tables.length,1);
 const result=await repo.capture(request);assert.equal(result.added,1);assert.equal(result.library.revision,2);
 const restarted=(await setup(indexedDB)).repo,recovered=await restarted.capture(request);
 assert.equal(recovered.added,1);assert.equal(recovered.total,1);assert.equal(recovered.library.revision,2);
 assert.equal(recovered.library.tables[1].captureSources[0].url,'https://example.com/path');
 const draft=await restarted.get();draft.tables[1].entries[0].notes='Editor metadata';await restarted.save(draft);
 const appended=await restarted.capture({tableId:'new-capture',candidates:['Original','Second']});
 assert.equal(appended.added,1);assert.equal(appended.library.tables[1].entries[0].notes,'Editor metadata');
 assert.equal(appended.library.tables[1].entries[1].status,'untranslated');
 assert.equal(appended.library.tables[1].entries[1].ko,'');
});

test('concurrent repository instances serialize revision comparison and never overwrite the winning edit',async()=>{
 const {repo,indexedDB,library}=await setup();await repo.initialize(async()=>library);
 const other=(await setup(indexedDB)).repo,a=await repo.get(),b=await other.get();
 a.tables[0].name='First writer';b.tables[0].name='Second writer';
 const results=await Promise.allSettled([repo.save(a),other.save(b)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.filter(r=>r.status==='rejected').length,1);
 assert.equal((await other.get()).revision,2);
 const winner=results.find(r=>r.status==='fulfilled').value;assert.equal((await repo.get()).tables[0].name,winner.tables[0].name);
});
