import {loadKorean} from './i18n-harness.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {seededHarness as harness} from './background-harness.mjs';
const source=f=>readFile(new URL('../extension/'+f,import.meta.url),'utf8');
const tick=()=>new Promise(r=>setTimeout(r,0));
async function until(predicate){for(let n=0;n<100;n++){if(await predicate())return;await new Promise(r=>setTimeout(r,5));}assert.fail('popup did not reach expected state');}

test('permission approval after popup disposal preserves chosen table and applies first time',async()=>{
 const h=await harness({rules:[]});
 const state=await h.send({type:'state'});
 const table={...state.library.tables[0],id:'selected',name:'Selected table'};
 await h.send({type:'librarySave',library:{...state.library,tables:[...state.library.tables,table]}});
 h.setMode('offline');h.setRequest(()=>new Promise(()=>{}));
 const d=new JSDOM(await source('popup.html'),{runScripts:'outside-only'});
 try{
  loadKorean(d.window);for(const file of ['shared.js','library.js'])d.window.eval(await source(file));
  d.window.chrome={runtime:{getURL:p=>'chrome-extension://test/'+p,sendMessage:m=>h.send(m)},
   tabs:{query:async()=>[{id:1,url:'https://example.com/docs/a'}],sendMessage:async()=>({enabled:true,tableId:'selected',translated:1})},
   storage:{onChanged:{addListener:()=>{}}},permissions:{request:()=>new Promise(()=>{})}};
  d.window.eval(await source('site-list.js'));d.window.eval(await source('popup.js'));await h.send({type:'state'});await h.send({type:'state'});await tick();
  await until(()=>d.window.document.getElementById('table').options.length===3 && !d.window.document.getElementById('table').disabled && !d.window.document.getElementById('capture').disabled);
  // Old UI uses Apply; new UI saves selection then uses only the checkbox.
  d.window.document.getElementById('change')?.click();await tick();
  const select=d.window.document.getElementById('table');select.value='selected';
  select.dispatchEvent(new d.window.Event('change'));await h.send({type:'state'});await tick();
  await until(()=>h.store.rules.some(r=>r.tableId==='selected') && !d.window.document.getElementById('enabled').disabled);
  (d.window.document.getElementById('apply') || d.window.document.getElementById('enabled')).click();
  await h.send({type:'state'});await tick();
  await until(()=>Object.keys(h.store.activationIntents||{}).length===1);
  d.window.close(); // No popup permission continuation can run after disposal.
  h.grants.add('https://example.com/*');h.listeners.added({origins:['https://example.com/*']});
  const reopened=await h.send({type:'state',url:'https://example.com/docs/a'});
  assert.equal(reopened.page.table?.id,'selected','chosen table survives popup disposal');
  assert.equal(reopened.page.enabled,true,'background completes activation after permission approval');
  assert.equal(h.sent.at(-1).state.table.id,'selected');
 }finally{d.window.close();}
});
