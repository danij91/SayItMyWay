import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
import {harness} from './background-harness.mjs';
const source=f=>readFile(new URL('../extension/'+f,import.meta.url),'utf8');
const tick=()=>new Promise(r=>setTimeout(r,0));
async function until(predicate){for(let n=0;n<200;n++){if(predicate())return;await tick();}assert.ok(predicate(),'expected asynchronous popup result');}
async function popup(t,preferences){
 const h=await harness({rules:[]});h.grants.add('https://example.com/*');if(preferences)await h.send({type:'saveInteractionSettings',interactionSettings:preferences});
 const state=await h.send({type:'state'});await h.send({type:'selectTable',url:'https://example.com/docs/a',tableId:state.library.tables[0].id});
 const d=new JSDOM(await source('popup.html'),{runScripts:'outside-only'});t.after(()=>d.window.close());const w=d.window;w.structuredClone=structuredClone;
 let pending=0,initialized=false;
 w.chrome={runtime:{getURL:p=>'chrome-extension://test/'+p,sendMessage:async m=>{pending++;try{return await h.send(m);}finally{pending--;if(m.type==='collectionState')initialized=true;}}},tabs:{query:async()=>h.tabs,sendMessage:async()=>({})},storage:{local:{get:async()=>({appLocale:'ko',...structuredClone(h.store)}),set:async()=>{}},onChanged:{addListener(){}}}};
 for(const file of ['locales/ko.js','locales/en.js','locales/ar.js','i18n.js','shared.js','library.js','interaction-settings.js','site-list.js','popup.js'])w.eval(await source(file));
 for(let n=0;n<200;n++){await tick();if(initialized && !pending){await tick();if(!pending)break;}}
 assert.equal(initialized,true);assert.equal(pending,0);return {h,w,$:id=>w.document.getElementById(id)};
}

const binding=(code,flags={})=>({code,ctrl:false,alt:false,shift:false,meta:false,...flags});
function key(w,type,code,flags={}){w.document.dispatchEvent(new w.KeyboardEvent(type,{code,key:code==='Escape'?'Escape':code,bubbles:true,cancelable:true,...flags}));}
function record(w,$,feature,code,flags={}){$(feature+'-key').click();key(w,'keydown',code,flags);key(w,'keyup',code,flags);}
test('settings autosave without save state or leave warning and Back exits directly',async t=>{
 const {h,w,$}=await popup(t);$('settings-open').click();
 assert.equal($('main-view').hidden,true);assert.equal($('interaction-view').hidden,false);
 assert.equal($('options').target,'_blank');assert.match($('peek-key').textContent,/Shift/);
 for(const id of ['shortcuts-save','settings-state','settings-leave'])assert.equal($(id),null);
 assert.equal(w.document.querySelector('#fitting-form'),null);assert.equal(w.document.querySelectorAll('.shortcut-group').length,2);
 w.document.querySelector('[data-mode=toggle]').click();
 $('interaction-back').click();assert.equal($('interaction-view').hidden,true);
 await tick();await tick();assert.equal(h.store.interactionSettings.peekMode,'toggle');
 $('settings-open').click();assert.equal(w.document.querySelector('[data-mode=toggle]').getAttribute('aria-pressed'),'true');
 assert.equal($('shortcuts-status').textContent,'');
 await w.TextPatchI18n.setLocale('ar');assert.equal(w.document.documentElement.dir,'rtl');assert.equal($('interaction-title').textContent,w.TextPatchI18n.t('interaction_settings'));
});
test('recorder accepts Q/F2/Ctrl+Q, waits for modifier release, cancels Escape, rejects duplicate and preserves disabled bindings',async t=>{
 const {w,$}=await popup(t);$('settings-open').click();record(w,$,'peek','KeyQ');assert.equal($('peek-key').textContent,'Q');
 record(w,$,'peek','F2');assert.equal($('peek-key').textContent,'F2');
 $('peek-key').click();key(w,'keydown','ControlLeft',{ctrlKey:true});assert.equal($('peek-key').getAttribute('aria-pressed'),'true');
 key(w,'keydown','KeyQ',{ctrlKey:true});assert.equal($('peek-key').textContent,'Ctrl + Q');key(w,'keyup','ControlLeft');
 $('peek-key').click();key(w,'keydown','Escape');assert.equal($('peek-key').textContent,'Ctrl + Q');
 record(w,$,'edit','KeyQ',{ctrlKey:true});assert.equal($('edit-key').getAttribute('aria-pressed'),'true');assert.ok($('shortcuts-status').textContent);
 key(w,'keydown','Escape');assert.match($('edit-key').textContent,/Alt/);
 $('peek-key').click();key(w,'keydown','ShiftRight',{shiftKey:true});assert.equal($('peek-key').getAttribute('aria-pressed'),'true');key(w,'keyup','ShiftRight');assert.match($('peek-key').textContent,/Shift/);
 const retained=$('peek-key').textContent;$('peek-enabled').click();assert.equal($('peek-key').disabled,true);assert.equal($('peek-key').textContent,retained);$('peek-enabled').click();assert.equal($('peek-key').disabled,false);
});
test('failed autosave restores confirmed values, shows only error, and later changes persist on restart',async t=>{
 const {h,w,$}=await popup(t);$('settings-open').click();h.setStorageFailure(true);
 record(w,$,'peek','KeyQ',{ctrlKey:true});await tick();await tick();
 assert.match($('peek-key').textContent,/Shift/);assert.match($('shortcuts-status').textContent,/quota/);
 assert.equal($('peek-enabled').disabled,false);assert.equal($('interaction-back').disabled,false);
 h.setStorageFailure(false);record(w,$,'peek','KeyQ',{ctrlKey:true});await tick();await tick();
 assert.equal($('shortcuts-status').textContent,'');
 const restart=await harness(h.store,h.indexedDB);assert.deepEqual(JSON.parse(JSON.stringify((await restart.send({type:'state'})).interactionSettings.peekKey)),binding('KeyQ',{ctrl:true}));
});
test('shared binding helpers validate physical codes, migration, exact chords and release boundaries',async t=>{
 const {w}=await popup(t),api=w.TextPatchInteraction;
 const plain=v=>JSON.parse(JSON.stringify(v));
 assert.deepEqual(plain(api.validate({peekMode:'hold',peekKey:'ShiftLeft',editKey:''})),{peekMode:'hold',editMode:'hold',peekKey:binding('ShiftLeft'),editKey:null,peekEnabled:true,editEnabled:false});
 assert.equal(api.matches({code:'ShiftLeft',shiftKey:true},binding('ShiftLeft')),true);
 assert.equal(api.matches({code:'ShiftRight',shiftKey:true},binding('ShiftLeft')),false);
 assert.equal(api.matches({code:'KeyQ',key:'?',ctrlKey:true},binding('KeyQ',{ctrl:true})),true);
 assert.equal(api.matches({code:'KeyQ',ctrlKey:true,shiftKey:true},binding('KeyQ',{ctrl:true})),false);
 assert.equal(api.releases({code:'ControlRight'},binding('KeyQ',{ctrl:true})),true);
 assert.equal(api.releases({code:'KeyQ'},binding('KeyQ',{ctrl:true})),true);
 assert.equal(api.releases({code:'ShiftLeft'},binding('KeyQ',{ctrl:true})),false);
 for(const code of ['Escape','Unidentified','KeyZZ','F25'])assert.throws(()=>api.fromEvent({code}));
 assert.throws(()=>api.fromEvent({code:'KeyQ',ctrlKey:true,altKey:true}));
 assert.throws(()=>api.fromEvent({code:'AltRight',getModifierState:()=>true}));
 assert.throws(()=>api.fromEvent({code:'KeyQ',isComposing:true}));
 assert.throws(()=>api.validate({peekMode:'hold',peekKey:binding('ShiftLeft',{shift:true}),editKey:'ShiftLeft'}));
 assert.throws(()=>api.validate({peekMode:'hold',peekKey:binding('AltLeft',{ctrl:true}),editKey:null}));
 for(const flag of [null,'false',0])assert.throws(()=>api.validate({...api.defaults,peekEnabled:flag}));
});
test('peek and edit modes autosave independently and Back retains changes',async t=>{
 const {h,w,$}=await popup(t);$('settings-open').click();
 const mode=(feature,value)=>w.document.querySelector(`#${feature}-mode [data-mode=${value}]`);
 assert.equal(mode('edit','hold').getAttribute('aria-pressed'),'true');
 mode('edit','toggle').click();assert.equal(mode('peek','hold').getAttribute('aria-pressed'),'true');
 assert.equal(mode('edit','toggle').getAttribute('aria-pressed'),'true');
 assert.equal($('edit-mode-help').textContent,w.TextPatchI18n.t('interaction_edit_toggle_hint'));
 assert.equal(w.document.querySelector('[data-i18n=interaction_conflict_warning]').textContent,w.TextPatchI18n.t('interaction_conflict_warning'));
 await tick();await tick();assert.equal(h.store.interactionSettings.editMode,'toggle');assert.equal(h.store.interactionSettings.peekMode,'hold');
 mode('peek','toggle').click();mode('edit','hold').click();$('interaction-back').click();
 $('settings-open').click();assert.equal(mode('peek','toggle').getAttribute('aria-pressed'),'true');assert.equal(mode('edit','hold').getAttribute('aria-pressed'),'true');
 await until(()=>h.store.interactionSettings.editMode==='hold');assert.equal(h.store.interactionSettings.editMode,'hold');assert.equal(h.store.interactionSettings.peekMode,'toggle');
 await w.TextPatchI18n.setLocale('ar');assert.equal($('edit-mode-help').textContent,w.TextPatchI18n.t('interaction_edit_hold_hint'));
 assert.equal($('shortcuts-status').textContent,'');
});
test('all fifteen catalogs translate recorder, discard and current-table help',async()=>{
 const w=new JSDOM('',{runScripts:'outside-only'}).window;
 try{for(const locale of ['ko','en','ja','zh-Hans','zh-Hant','es','fr','de','pt-BR','ru','id','vi','th','hi','ar']){w.eval(await source('locales/'+locale+'.js'));for(const key of ['interaction_enabled','inline_delete','inline_delete_confirm','inline_delete_cancel','inline_delete_help','interaction_record_help','interaction_clear','interaction_recording','interaction_keep_editing','interaction_discard','inline_no_table','interaction_conflict_warning','interaction_edit_mode','interaction_edit_hold_hint','interaction_edit_toggle_hint','interaction_peek_hold_hint','interaction_peek_toggle_hint'])assert.ok(w.TextPatchLocales[locale][key] && !w.TextPatchLocales[locale][key].includes('??'),locale+': '+key);}}finally{w.close();}
});

test('activation saves independently, retains configured mode and binding across restart, and guards reenable conflicts',async t=>{
 const {h,w,$}=await popup(t);$('settings-open').click();record(w,$,'peek','KeyQ');w.document.querySelector('#peek-mode [data-mode=toggle]').click();
 $('peek-enabled').click();assert.equal($('peek-key').disabled,true);assert.equal(w.document.querySelector('#peek-mode [data-mode=hold]').disabled,true);
 await until(()=>h.store.interactionSettings?.peekEnabled===false);
 assert.equal(h.store.interactionSettings.peekEnabled,false);assert.equal(h.store.interactionSettings.peekMode,'toggle');assert.equal(h.store.interactionSettings.peekKey.code,'KeyQ');
 const restart=await harness(h.store,h.indexedDB);assert.equal((await restart.send({type:'state'})).interactionSettings.peekEnabled,false);
 record(w,$,'edit','KeyQ');$('peek-enabled').click();assert.equal($('peek-enabled').checked,false);assert.ok($('shortcuts-status').textContent);
 record(w,$,'edit','F2');$('peek-enabled').click();assert.equal($('peek-key').disabled,false);assert.equal($('peek-key').textContent,'Q');
});
test('legacy null shortcut can be enabled with a default without losing its mode',async t=>{
 const {h,w,$}=await popup(t,{peekMode:'toggle',editMode:'hold',peekKey:null,editKey:'AltLeft'});$('settings-open').click();
 assert.equal($('peek-enabled').checked,false);assert.equal($('peek-key').disabled,true);
 $('peek-enabled').click();assert.equal($('peek-key').disabled,false);assert.match($('peek-key').textContent,/Shift/);
 await tick();await tick();assert.equal(h.store.interactionSettings.peekEnabled,true);assert.equal(h.store.interactionSettings.peekMode,'toggle');
});

test('enabling legacy null binding chooses an available default when its usual key is active elsewhere',async t=>{
 const {h,$}=await popup(t,{peekMode:'hold',peekKey:null,editKey:'ShiftLeft'});$('settings-open').click();$('peek-enabled').click();
 assert.equal($('peek-enabled').checked,true);assert.equal($('peek-key').disabled,false);assert.equal($('peek-key').textContent,'F2');
 await tick();await tick();assert.equal(h.store.interactionSettings.peekKey.code,'F2');assert.equal(h.store.interactionSettings.editKey.code,'ShiftLeft');
});

function defer(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function delaySaves(w){
 const original=w.chrome.runtime.sendMessage,requests=[];
 w.chrome.runtime.sendMessage=async message=>{
  if(message.type!=='saveInteractionSettings')return original(message);
  const gate=defer(),result=original(message);requests.push({message,release:gate.resolve});await gate.promise;return result;
 };
 return requests;
}
test('rapid edits dispatch before popup closes and latest intent survives out-of-order responses and Back/reopen',async t=>{
 const {h,w,$}=await popup(t);const requests=delaySaves(w);$('settings-open').click();
 record(w,$,'peek','KeyQ');assert.equal(requests.length,1);
 w.document.querySelector('#peek-mode [data-mode=toggle]').click();record(w,$,'peek','F2');$('edit-enabled').click();
 assert.equal($('peek-key').disabled,false);assert.equal($('peek-enabled').disabled,false);assert.equal($('interaction-back').disabled,false);
 $('interaction-back').click();assert.equal($('interaction-view').hidden,true);$('settings-open').click();assert.equal($('peek-key').textContent,'F2');
 assert.equal(requests.length,4); // every intent dispatched while all responses remain delayed
 const last=requests[3].message.interactionSettings;assert.equal(last.peekKey.code,'F2');assert.equal(last.peekMode,'toggle');assert.equal(last.editEnabled,false);
 await until(()=>h.store.interactionSettings?.peekKey.code==='F2' && h.store.interactionSettings?.editEnabled===false);
 for(const index of [3,1,2,0]){requests[index].release();await tick();}
 assert.equal($('peek-key').textContent,'F2');assert.equal(w.document.querySelector('#peek-mode [data-mode=toggle]').getAttribute('aria-pressed'),'true');assert.equal($('edit-enabled').checked,false);
 const restart=await harness(h.store,h.indexedDB);const saved=(await restart.send({type:'state'})).interactionSettings;
 assert.equal(saved.peekKey.code,'F2');assert.equal(saved.peekMode,'toggle');assert.equal(saved.editEnabled,false);assert.equal($('shortcuts-status').textContent,'');
});
test('cancelled and invalid recordings never save, completed modifier release saves once',async t=>{
 const {w,$}=await popup(t);const requests=delaySaves(w);$('settings-open').click();
 $('peek-key').click();key(w,'keydown','Escape');assert.equal(requests.length,0);
 $('peek-key').click();key(w,'keydown','KeyQ'); // complete a valid recording first
 assert.equal(requests.length,1);requests[0].release();await tick();await tick();
 record(w,$,'edit','KeyQ');assert.equal(requests.length,1);assert.ok($('shortcuts-status').textContent);key(w,'keydown','Escape');
 $('edit-key').click();key(w,'keydown','Unidentified');key(w,'keydown','Escape');assert.equal(requests.length,1);
 $('peek-key').click();key(w,'keydown','ShiftRight',{shiftKey:true});assert.equal(requests.length,1);
 key(w,'keyup','ShiftRight');await until(()=>requests.length===2);requests[1].release();
});
test('failed older response cannot revert a newer submitted intent',async t=>{
 const {h,w,$}=await popup(t);const original=w.chrome.runtime.sendMessage,gate=defer();let count=0;
 w.chrome.runtime.sendMessage=async message=>{if(message.type==='saveInteractionSettings' && ++count===1){await gate.promise;return {error:'quota'};}return original(message);};
 $('settings-open').click();record(w,$,'peek','KeyQ');record(w,$,'peek','F2');
 await until(()=>h.store.interactionSettings?.peekKey.code==='F2');gate.resolve();await tick();
 assert.equal($('peek-key').textContent,'F2');assert.equal($('shortcuts-status').textContent,'');
});
test('failure after Back rolls back on reopen and reports error on the main view',async t=>{
 const {h,w,$}=await popup(t);const requests=delaySaves(w);$('settings-open').click();h.setStorageFailure(true);
 record(w,$,'peek','KeyQ');$('interaction-back').click();requests[0].release();await until(()=>$('status').textContent.includes('quota'));
 assert.equal($('interaction-view').hidden,true);$('settings-open').click();assert.match($('peek-key').textContent,/Shift/);assert.match($('shortcuts-status').textContent,/quota/);
});
test('lost save response reconciles from persisted storage instead of rolling back committed intent',async t=>{
 const {h,w,$}=await popup(t);const original=w.chrome.runtime.sendMessage;
 w.chrome.runtime.sendMessage=async message=>{const result=await original(message);if(message.type==='saveInteractionSettings')throw Error('connection lost');return result;};
 $('settings-open').click();record(w,$,'peek','KeyQ');await until(()=>$('shortcuts-status').textContent.includes('connection lost'));
 assert.equal($('peek-key').textContent,'Q');$('interaction-back').click();$('settings-open').click();assert.equal($('peek-key').textContent,'Q');
 const restart=await harness(h.store,h.indexedDB);assert.equal((await restart.send({type:'state'})).interactionSettings.peekKey.code,'KeyQ');
});

test('reopening settled settings refreshes external storage changes without overwriting new local intent',async t=>{
 const {h,w,$}=await popup(t);$('settings-open').click();$('interaction-back').click();
 await h.send({type:'saveInteractionSettings',interactionSettings:{...w.TextPatchInteraction.defaults,peekKey:binding('F3'),editMode:'toggle'}});
 await $('settings-open').onclick();assert.equal($('peek-key').textContent,'F3');assert.equal(w.document.querySelector('#edit-mode [data-mode=toggle]').getAttribute('aria-pressed'),'true');
 $('interaction-back').click();const get=w.chrome.storage.local.get,gate=defer();w.chrome.storage.local.get=async keys=>{const stored=await get(keys);await gate.promise;return stored;};
 const opened=$('settings-open').onclick();record(w,$,'peek','KeyQ');gate.resolve();await opened;
 assert.equal($('peek-key').textContent,'Q');await until(()=>h.store.interactionSettings.peekKey.code==='KeyQ');
});

test('disposing the popup with replies pending still persists every submitted final setting',async t=>{
 const {h,w,$}=await popup(t);const requests=delaySaves(w);$('settings-open').click();
 record(w,$,'peek','F2');w.document.querySelector('#edit-mode [data-mode=toggle]').click();$('peek-enabled').click();
 assert.equal(requests.length,3);w.close();
 await until(()=>h.store.interactionSettings?.peekEnabled===false);
 for(const request of requests)request.release();
 const restart=await harness(h.store,h.indexedDB);const saved=(await restart.send({type:'state'})).interactionSettings;
 assert.equal(saved.peekEnabled,false);assert.equal(saved.peekKey.code,'F2');assert.equal(saved.editMode,'toggle');
});
