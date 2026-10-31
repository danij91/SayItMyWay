import {loadKorean} from './i18n-harness.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const tick=()=>new Promise(r=>setTimeout(r,0));
async function options(t,{offline=false,missingPermission=false}={}){
  const d=new JSDOM(await readFile(new URL('../extension/options.html',import.meta.url),'utf8'),{url:'https://extension.test/options.html',runScripts:'outside-only'}),w=d.window;
  t.after(()=>w.close());w.structuredClone=structuredClone;
  loadKorean(w);for(const name of ['shared.js','library.js'])w.eval(await readFile(new URL('../extension/'+name,import.meta.url),'utf8'));
  let listener,clock=10000;w.Date.now=()=>clock;
  const calls=[],state={library:{tables:[{id:'one',name:'Cached'}]},rules:[{id:'r',origin:'https://example.test',scope:'page',path:'/saved',url:'https://example.test/saved?q=1',tableId:'one',enabled:false}]};
  w.chrome={storage:{onChanged:{addListener:fn=>listener=fn}},runtime:{sendMessage:async message=>{
    calls.push(message);
    if(message.type==='refresh'){if(offline)throw Error('offline');state.library.tables=[{id:'one',name:'Latest'},{id:'two',name:'Second'}];}
    if(message.type==='pageState')return {enabled:false,missingPermission};
    if(message.type==='saveRule')return {error:'Save rejected'};
    return structuredClone(state);
  }}};
  w.eval(await readFile(new URL('../extension/site-list.js',import.meta.url),'utf8'));w.eval(await readFile(new URL('../extension/options.js',import.meta.url),'utf8'));await tick();await tick();
  return {w,doc:w.document,calls,state,changed:()=>listener({libraryRevision:{}},'local'),advance:()=>clock+=2000};
}

test('sites automatically refresh on entry and focus, storage updates cannot trigger refresh loops',async t=>{
  const {w,doc,calls,changed,advance}=await options(t);
  assert.equal(doc.querySelector('#rules select').selectedOptions[0].textContent,'Latest');
  assert.equal(calls.filter(m=>m.type==='refresh').length,1);
  changed();changed();await tick();assert.equal(calls.filter(m=>m.type==='refresh').length,1);
  w.dispatchEvent(new w.Event('focus'));await tick();assert.equal(calls.filter(m=>m.type==='refresh').length,1);
  advance();w.dispatchEvent(new w.Event('focus'));await tick();assert.equal(calls.filter(m=>m.type==='refresh').length,2);
  assert.equal(doc.querySelector('#refresh,#bundle,#export,#file,#json,#rule-editor'),null);
});
test('offline refresh retains cached dropdown and missing permission keeps toggle unavailable',async t=>{
  const {doc,calls}=await options(t,{offline:true,missingPermission:true});
  assert.equal(doc.querySelector('#rules select').selectedOptions[0].textContent,'Cached');
  assert.ok(doc.querySelector('#status').textContent);
  const checkbox=doc.querySelector('#rules input[type=checkbox]');assert.equal(checkbox.disabled,true);checkbox.click();
  assert.equal(calls.some(m=>m.type==='toggleSite'),false);
  assert.equal(doc.querySelector('#rules a').getAttribute('href'),'https://example.test/saved?q=1');
});
test('failed autosave restores saved choice and reports error without activation',async t=>{
  const {doc,w,calls}=await options(t);const select=doc.querySelector('#rules select');select.value='two';select.dispatchEvent(new w.Event('change'));
  await tick();await tick();assert.equal(doc.querySelector('#rules select').value,'one');assert.equal(doc.querySelector('#status').textContent,'Save rejected');
  const save=calls.find(m=>m.type==='saveRule');assert.equal(save.activateSite,undefined);assert.equal(save.rule.enabled,false);assert.equal(save.rule.path,'/saved');
});
