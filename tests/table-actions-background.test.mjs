import {test} from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './background-harness.mjs';

test('popup file import appends unique fresh tables without changing applied site or losing newer edits',async()=>{
 const h=await harness({rules:[{id:'site',origin:'https://example.com',scope:'site',path:'/',tableId:'crimson-desert',enabled:true}]});
 h.grants.add('https://example.com/*');
 const before=(await h.send({type:'state'})).library;
 const incoming=structuredClone(before.tables[0]);incoming.entries[0].notes='Imported evidence';
 const text=JSON.stringify(incoming);
 const latest=structuredClone(before);latest.tables[0].entries[0].notes='Concurrent editor note';
 await h.send({type:'librarySave',library:latest});
 const result=await h.send({type:'importTables',text,fileName:'terms.json',url:'https://example.com/docs/a'});
 assert.equal(result.error,undefined);assert.equal(result.library.tables.length,2);
 assert.equal(result.library.tables[0].entries[0].notes,'Concurrent editor note');
 const added=result.library.tables[1];assert.notEqual(added.id,incoming.id);assert.notEqual(added.entries[0].id,incoming.entries[0].id);
 assert.equal(added.name,incoming.name+' (2)');assert.equal(added.entries[0].notes,'Imported evidence');
 assert.equal(result.page.table.id,'crimson-desert');assert.equal(result.page.enabled,true);
 assert.equal(result.rules.length,1);assert.equal(result.rules[0].tableId,'crimson-desert');
 const bad=await h.send({type:'importTables',text:'{invalid',fileName:'bad.json'});assert.ok(bad.error);
 assert.equal((await h.send({type:'libraryGet'})).library.revision,result.library.revision);
 const untrusted=await h.send({type:'importTables',text,fileName:'terms.json'},{id:'test',url:'https://example.com/'});assert.ok(untrusted.error);
});

test('saved table deletion restores tabs, clears only its references, and empty library survives restart',async()=>{
 const rules=[{id:'site',origin:'https://example.com',scope:'site',path:'/',tableId:'crimson-desert',enabled:true}];
 const h=await harness({rules});h.grants.add('https://example.com/*');
 const original=(await h.send({type:'libraryGet'})).library;
 const text=JSON.stringify({...original.tables[0],name:'Keep me'});
 await h.send({type:'importTables',text,fileName:'keep.json'});
 const current=(await h.send({type:'libraryGet'})).library,kept=structuredClone(current.tables[1]);
 await h.send({type:'saveRule',rule:{id:'other',origin:'https://example.com',scope:'page',path:'/other',tableId:kept.id,enabled:false}});
 const stale=structuredClone(original);stale.tables=[];
 assert.match((await h.send({type:'librarySave',library:stale})).error,/충돌/);
 assert.equal((await h.send({type:'state'})).rules.length,2);
 current.tables=[kept];
 const saved=await h.send({type:'librarySave',library:current});assert.equal(saved.error,undefined);
 const state=await h.send({type:'state',url:'https://example.com/docs/a'});
 assert.equal(state.rules.length,1);assert.equal(state.rules[0].id,'other');
 assert.equal(state.page.table,null);assert.equal(state.page.enabled,false);
 assert.equal(h.sent.at(-1).state.enabled,false);assert.deepEqual(structuredClone(saved.library.tables[0]),kept);
 saved.library.tables=[];const empty=await h.send({type:'librarySave',library:saved.library});assert.equal(empty.error,undefined);
 const restarted=await harness(h.store,h.indexedDB);
 assert.equal((await restarted.send({type:'libraryGet'})).library.tables.length,0);
 assert.equal((await restarted.send({type:'state'})).rules.length,0);
});


