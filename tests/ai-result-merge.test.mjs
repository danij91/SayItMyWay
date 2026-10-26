import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {IDBFactory} from 'fake-indexeddb';
import {IDBObjectStore} from 'fake-indexeddb';
const read=file=>readFile(new URL('../extension/'+file,import.meta.url),'utf8');
async function setup(indexedDB=new IDBFactory()){
  const c=vm.createContext({indexedDB,structuredClone,URL,TextEncoder,crypto:globalThis.crypto});
  for(const file of ['locales/ko.js','locales/en.js','i18n.js','shared.js','library.js','editor/import.js','repository.js'])vm.runInContext(await read(file),c);
  const repo=c.LibraryRepository.create({indexedDB});
  const library=c.TextPatch.migrate(JSON.parse(await read('data/dictionary.json')));
  library.tables[0].entries=library.tables[0].entries.slice(0,4).map((row,i)=>({...row,ko:i===3?'Existing':'',status:i===3?'review':'untranslated'}));
  await repo.initialize(async()=>library);
  return {repo,c,indexedDB};
}
test('trusted linked results survive restart and fill only unchanged blank rows atomically',async()=>{
  const {repo,indexedDB}=await setup(),base=await repo.get(),table=base.tables[0];
  const request=await repo.recordAIRequest(table);
  const result={format:'text-patch-table',version:2,aiRequest:{version:1,id:request.id},entries:table.entries.slice(0,3).map((row,i)=>({requestRow:String(i),original:row.en,replacement:'AI '+i}))};
  base.tables[0].entries[1].notes='Edited after request';await repo.save(base);
  const restarted=(await setup(indexedDB)).repo;
  const preview=await restarted.aiResult(JSON.stringify(result),false);
  assert.equal(preview.filled,2);assert.equal(preview.preserved,2);
  const newer=await restarted.get();newer.tables[0].entries[2].ko='User edit';await restarted.save(newer);
  const applied=await restarted.aiResult(JSON.stringify(result),true);
  assert.equal(applied.filled,1);
  assert.deepEqual(Array.from(applied.library.tables[0].entries,row=>row.ko),['AI 0','','User edit','Existing']);
  assert.equal(applied.library.tables[0].entries[0].status,'untranslated');
  const again=await restarted.aiResult(JSON.stringify(result),true);
  assert.equal(again.filled,0);assert.equal(again.library.revision,applied.library.revision);
});
test('deleted destination restores the full trusted snapshot and invalid linkage never writes',async()=>{
  const {repo}=await setup(),base=await repo.get(),table=base.tables[0],request=await repo.recordAIRequest(table);
  const input={format:'text-patch-table',version:2,aiRequest:{version:1,id:request.id},entries:[{requestRow:'0',original:table.entries[0].en,replacement:'Safe'}]};
  for(const mutate of [x=>x.aiRequest.id='unknown',x=>x.entries.push(x.entries[0]),x=>x.entries[0].requestRow='9000',x=>x.entries[0].original='Mismatch',x=>x.aiRequest=null]){
    const bad=structuredClone(input);mutate(bad);await assert.rejects(async()=>repo.aiResult(JSON.stringify(bad),true));
    assert.equal((await repo.get()).revision,base.revision);
  }
  base.tables=[];await repo.save(base);
  const restored=await repo.aiResult(JSON.stringify(input),true),copy=restored.library.tables[0];
  assert.equal(copy.entries.length,4);assert.notEqual(copy.id,table.id);
  assert.equal(copy.entries[0].ko,'Safe');assert.equal(copy.entries[3].ko,'Existing');
  assert.deepEqual(structuredClone(copy.defaults),structuredClone(table.defaults));assert.deepEqual(structuredClone(copy.excludedCategories),structuredClone(table.excludedCategories));
  const again=await repo.aiResult(JSON.stringify(input),true);assert.equal(again.library.tables.length,1);assert.equal(again.changed,false);
});
test('editing then reverting a row after request still protects it',async()=>{
  const {repo}=await setup(),base=await repo.get(),table=base.tables[0],request=await repo.recordAIRequest(table);
  const changed=structuredClone(base);changed.tables[0].entries[0].notes='Temporary edit';await repo.save(changed);
  const reverted=await repo.get();reverted.tables[0].entries[0]=table.entries[0];await repo.save(reverted);
  const result=await repo.aiResult(JSON.stringify({format:'text-patch-table',version:2,aiRequest:{version:1,id:request.id},entries:[{requestRow:'0',original:table.entries[0].en,replacement:'AI'}]}),true);
  assert.equal(result.filled,0);assert.equal(result.library.tables[0].entries[0].ko,'');
});
test('partial results after recovery fill remaining blanks but preserve edits in the restored table',async()=>{
  const {repo}=await setup(),base=await repo.get(),table=base.tables[0],request=await repo.recordAIRequest(table);
  const response=indices=>JSON.stringify({format:'text-patch-table',version:2,aiRequest:{version:1,id:request.id},entries:indices.map(i=>({requestRow:String(i),original:table.entries[i].en,replacement:'AI '+i,notes:'Invented notes',status:'verified'}))});
  base.tables=[];await repo.save(base);
  let result=await repo.aiResult(response([0]),true);
  assert.equal(result.library.tables[0].entries[0].notes,table.entries[0].notes);
  assert.equal(result.library.tables[0].entries[0].status,'untranslated');
  const draft=await repo.get();draft.tables[0].entries[2].notes='Restored user note';await repo.save(draft);
  result=await repo.aiResult(response([1,2]),true);
  assert.equal(result.filled,1);assert.equal(result.library.tables[0].entries[1].ko,'AI 1');assert.equal(result.library.tables[0].entries[2].ko,'');
});
test('quota failure rolls back both fills and recovery destination receipt',async()=>{
  const {repo}=await setup(),base=await repo.get(),table=base.tables[0],request=await repo.recordAIRequest(table);
  const text=JSON.stringify({format:'text-patch-table',version:2,aiRequest:{version:1,id:request.id},entries:[{requestRow:'0',original:table.entries[0].en,replacement:'AI'}]});
  const put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value,key){if(key.startsWith('ai-request:'))throw Error('QuotaExceededError');return put.call(this,value,key);};
  try{await assert.rejects(repo.aiResult(text,true),/Quota/);}finally{IDBObjectStore.prototype.put=put;}
  assert.equal((await repo.get()).revision,base.revision);assert.equal((await repo.aiResult(text,true)).filled,1);
});
test('deleted rows stay deleted and concurrent applications fill once without losing current rows',async()=>{
  const {repo,indexedDB}=await setup(),base=await repo.get(),table=base.tables[0],request=await repo.recordAIRequest(table);
  const text=JSON.stringify({format:'text-patch-table',version:2,aiRequest:{version:1,id:request.id},entries:[0,1].map(i=>({requestRow:String(i),original:table.entries[i].en,replacement:'AI '+i}))});
  const deletedId=table.entries[1].id;base.tables[0].entries.splice(1,1);await repo.save(base);
  const other=(await setup(indexedDB)).repo;
  const results=await Promise.all([repo.aiResult(text,true),other.aiResult(text,true)]);
  assert.deepEqual(results.map(result=>result.filled).sort(),[0,1]);
  const saved=await repo.get();assert.equal(saved.tables[0].entries.length,3);assert.equal(saved.tables[0].entries.some(row=>row.id===deletedId),false);
  assert.equal(saved.revision,3);
});
test('stale request creation fails instead of trusting a returned or caller-supplied baseline',async()=>{
 const {repo}=await setup(),base=await repo.get(),table=structuredClone(base.tables[0]);
 base.tables[0].entries[0].notes='Newer';await repo.save(base);
 await assert.rejects(repo.recordAIRequest(table));
});

test('minimal row AI fills only replacement, ignores legacy metadata edits and returned metadata',async()=>{
 const {repo}=await setup(),base=await repo.get();
 base.tables[0].entries=[{id:'minimal',en:'Hello',ko:''}];await repo.save(base);
 const table=(await repo.get()).tables[0],request=await repo.recordAIRequest(table);
 const draft=await repo.get();Object.assign(draft.tables[0].entries[0],{status:'verified',kind:'game',category:'legacy',context:'old',source:'',evidence:''});await repo.save(draft);
 const before=(await repo.get()).tables[0].entries[0];
 const result=await repo.aiResult(JSON.stringify({format:'text-patch-table',version:2,aiRequest:{version:1,id:request.id},entries:[{requestRow:'0',original:'Hello',replacement:'World',status:'review',notes:'invented',selector:'.invented'}]}),true);
 assert.equal(result.filled,1);assert.deepEqual(result.library.tables[0].entries[0],{...before,ko:'World'});
 const clean=await repo.get();clean.tables[0].entries=[{id:'clean',en:'New',ko:''}];await repo.save(clean);
 const cleanTable=(await repo.get()).tables[0],cleanRequest=await repo.recordAIRequest(cleanTable);
 const filled=await repo.aiResult(JSON.stringify({format:'text-patch-table',version:2,aiRequest:{version:1,id:cleanRequest.id},entries:[{requestRow:'0',original:'New',replacement:'Value'}]}),true);
 assert.deepEqual(filled.library.tables[0].entries[0],{id:'clean',en:'New',ko:'Value'});
});
