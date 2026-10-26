import {toggleDraftName,hasDraftName} from './editor-draft-helpers.mjs';
import {loadKorean} from './i18n-harness.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));

test('bundled editor uses message storage, preserves drafts on conflict and saves only explicitly',async t=>{
  const dom=new JSDOM(await read('extension/editor/index.html'),{url:'https://editor.test/',runScripts:'outside-only'});
  t.after(()=>dom.window.close());const w=dom.window,$=id=>w.document.getElementById(id);
  // jsdom does not implement chrome-extension URLs; the transport alone is
  // evaluated with its real location and chrome facade below.
  loadKorean(w);w.structuredClone=structuredClone;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  for(const file of ['extension/shared.js','extension/library.js'])w.eval(await read(file));
  let stored=w.TextPatch.migrate(JSON.parse(await read('extension/data/dictionary.json'))),failure='',getGate;const calls=[];
  let changed;
  const chrome={runtime:{onMessage:{addListener:listener=>changed=listener},sendMessage:async message=>{
    calls.push(structuredClone(message));
    if(message.type==='librarySave'){
      if(failure)return {error:failure};
      stored=structuredClone(message.library);stored.revision++;
    }
    const snapshot=structuredClone(stored);
    if(message.type==='libraryGet'&&getGate)await getGate;
    return {library:snapshot};
  }}};
  const transport=await read('extension/editor/transport.js');
  w.chrome=chrome;
  w.EditorStorage=Function('location','chrome',transport+';return globalThis.EditorStorage;')({protocol:'chrome-extension:'},chrome);
  w.eval(await read('extension/import-ui.js'));w.eval(await read('extension/editor/app.js'));await tick();
  assert.deepEqual(calls.map(c=>c.type),['libraryGet'],$('message').textContent);
  toggleDraftName(w);assert.equal(calls.length,1);
  failure='revision conflict';await $('save-all').onclick();
  assert.match($('save-state').textContent,/revision conflict/);
  assert.equal(hasDraftName(w),true);assert.equal($('save-all').disabled,false);
  assert.equal(stored.tables[0].name.endsWith(' draft'),false);
  failure='';await $('save-all').onclick();
  assert.equal(stored.tables[0].name.endsWith(' draft'),true);
  assert.equal($('save-all').disabled,true);assert.equal(stored.revision,2);
  assert.deepEqual(calls.map(c=>c.type),['libraryGet','librarySave','librarySave']);
  stored.tables[0].name='Collected elsewhere';changed({type:'libraryChanged'});await tick();
  assert.equal($('table-select').selectedOptions[0].textContent,'Collected elsewhere');
  $('add').click();$('form').elements.en.value='Unsubmitted original';
  stored.tables[0].name='Newer revision';const before=calls.length;
  changed({type:'libraryChanged'});await tick();
  assert.equal(calls.length,before);assert.equal($('form').elements.en.value,'Unsubmitted original');
  assert.equal($('table-select').selectedOptions[0].textContent,'Collected elsewhere');
  $('cancel').click();
  let release;getGate=new Promise(resolve=>release=resolve);
  changed({type:'libraryChanged'});await tick();
  toggleDraftName(w);assert.equal(hasDraftName(w),true);
  release();await tick();getGate=null;
  assert.equal(hasDraftName(w),true);assert.equal($('save-all').disabled,false);
  assert.equal($('table-select').selectedOptions[0].textContent,'Collected elsewhere draft');
  await $('save-all').onclick();
  getGate=new Promise(resolve=>release=resolve);
  changed({type:'libraryChanged'});await tick();
  toggleDraftName(w);await $('save-all').onclick();
  assert.equal(hasDraftName(w),false);assert.equal($('save-all').disabled,true);
  release();await tick();getGate=null;
  assert.equal(hasDraftName(w),false);assert.equal($('save-all').disabled,true);
});

test('extension message failures propagate without falling back to localhost',async()=>{
  const transport=await read('extension/editor/transport.js');
  const api=Function('location','chrome',transport+';return globalThis.EditorStorage;')({protocol:'chrome-extension:'},{runtime:{sendMessage:async()=>({error:'storage unavailable'})}});
  await assert.rejects(api.load(),/storage unavailable/);
});

test('table deletion confirms table and linked sites, stays a draft through conflict, and saves only from top Save',async t=>{
 const dom=new JSDOM(await read('extension/editor/index.html'),{url:'https://editor.test/',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window,$=id=>w.document.getElementById(id);loadKorean(w);w.structuredClone=structuredClone;
 for(const file of ['extension/shared.js','extension/library.js'])w.eval(await read(file));
 let stored=w.TextPatch.migrate(JSON.parse(await read('extension/data/dictionary.json'))),writes=0,failure=true,question;
 w.chrome={runtime:{sendMessage:async()=>({rules:[{tableId:'crimson-desert',origin:'https://a.example'},{tableId:'crimson-desert',origin:'https://b.example'}]}),onMessage:{addListener(){}}}};
 w.EditorStorage={load:async()=>structuredClone(stored),save:async value=>{writes++;if(failure)throw Error('revision conflict');stored=structuredClone(value);stored.revision++;return stored;}};
 w.confirm=message=>{question=message;return false;};w.eval(await read('extension/import-ui.js'));w.eval(await read('extension/editor/app.js'));await tick();
 assert.ok($('table-delete'));await $('table-delete').onclick();assert.equal($('table-select').options.length,1);assert.equal(writes,0);
 assert.match(question,/붉은사막/);assert.match(question,/2/);
 w.confirm=()=>true;await $('table-delete').onclick();assert.equal($('table-select').options.length,0);assert.equal(writes,0);assert.equal($('save-all').disabled,false);
 await $('save-all').onclick();assert.equal(stored.tables.length,1);assert.equal($('table-select').options.length,0);assert.equal($('save-all').disabled,false);assert.match($('message').textContent,/revision conflict/);
 failure=false;await $('save-all').onclick();assert.equal(writes,2);assert.equal(stored.tables.length,0);assert.equal($('table-delete').disabled,true);
});
