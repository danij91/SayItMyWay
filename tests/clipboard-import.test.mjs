import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {seededHarness} from './background-harness.mjs';
import {toggleDraftName} from './editor-draft-helpers.mjs';
const read=f=>readFile(new URL('../extension/'+f,import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function until(fn){for(let n=0;n<200;n++){if(fn())return;await tick();}assert.ok(fn(),'UI operation completed');}
const ordinary=JSON.stringify({format:'text-patch-table',version:2,name:'Pasted terms',entries:[{original:'Hello',replacement:'Bonjour'}]});
async function setup(t,surface){
 const h=await seededHarness();
 const d=new JSDOM(await read(surface==='popup'?'popup.html':'editor/index.html'),{runScripts:'outside-only',url:'chrome-extension://test/'+(surface==='popup'?'popup.html':'editor/index.html')});
 const w=d.window,$=id=>w.document.getElementById(id);t.after(()=>w.close());w.structuredClone=structuredClone;w.TextEncoder=TextEncoder;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 let content=ordinary,reads=0,permissions=0,granted=true,readImpl;
 const calls=[];let inflight=0,initialized=false;
 w.chrome={runtime:{getURL:p=>'chrome-extension://test/'+p,sendMessage:async message=>{calls.push(message);inflight++;try{return await h.send(message);}finally{inflight--;if(message.type==='collectionState')initialized=true;}},onMessage:{addListener(){}}},tabs:{query:async()=>h.tabs,sendMessage:async()=>({})},permissions:{request:args=>{permissions++;assert.deepEqual(JSON.parse(JSON.stringify(args)),{permissions:['clipboardRead']});return Promise.resolve(granted);}},storage:{local:{get:async()=>({appLocale:'en',...structuredClone(h.store)}),set:async()=>{}},onChanged:{addListener(){}}}};
 Object.defineProperty(w.navigator,'clipboard',{configurable:true,value:{readText:()=>{reads++;return readImpl?readImpl():Promise.resolve(content);}}});
 for(const f of ['locales/ko.js','locales/en.js','i18n.js','shared.js','library.js','editor/import.js','ai-request-ui.js','import-ui.js',...(surface==='popup'?['interaction-settings.js','site-list.js','popup.js']:['editor/transport.js','editor/app.js'])])w.eval(await read(f));
 await until(()=>surface==='popup'?initialized&&inflight===0&&!$('import-open').disabled:!$('load-retry').hidden||$('table-select').options.length>0);
 const saved=async()=>JSON.parse(JSON.stringify((await h.send({type:'libraryGet'})).library));
 return {w,$,h,calls,saved,reads:()=>reads,permissions:()=>permissions,content:v=>content=v,grant:v=>granted=v,defer:fn=>readImpl=fn};
}
for(const surface of ['popup','editor']){
 test(surface+': chooser and file gesture never read clipboard; Escape returns focus',async t=>{
  const p=await setup(t,surface),{$,w}=p;let picked=0;$('import-file').click=()=>picked++;
  $('import-open').click();assert.equal($('import-editor').open,true);assert.equal(w.document.activeElement,$('import-file-choice'));
  $('import-file-choice').click();assert.equal(picked,1);assert.equal(p.reads(),0);assert.equal(p.permissions(),0);
  $('import-editor').dispatchEvent(new w.Event('cancel',{cancelable:true}));assert.equal($('import-editor').open,false);assert.equal(w.document.activeElement,$('import-open'));assert.equal(p.reads(),0);
 });
 test(surface+': clipboard creates a new table through validated import, editor saves only at top',async t=>{
  const p=await setup(t,surface),{$}=p,before=await p.saved(),rules=JSON.stringify(p.h.store.rules);
  $('import-open').click();const importing=$('import-clipboard').onclick();assert.equal(p.permissions(),1,'permission starts synchronously in the gesture');await importing;
  assert.equal($('import-editor').open,false,$('import-error').textContent);assert.equal(p.reads(),1);
  if(surface==='editor'){assert.deepEqual(await p.saved(),before);assert.equal($('table-select').options.length,before.tables.length+1);await $('save-all').onclick();}
  const after=await p.saved();assert.equal(after.tables.length,before.tables.length+1);assert.deepEqual(after.tables[0],before.tables[0]);assert.equal(after.tables.at(-1).entries[0].ko,'Bonjour');
  assert.equal(JSON.stringify(p.h.store.rules),rules);assert.equal(p.calls.some(m=>['selectTable','toggleSite','activateSite'].includes(m.type)),false);
 });
 test(surface+': denied, empty, malformed, multiple fences, prose and UTF-8 oversize leave data intact and retry works',async t=>{
  const p=await setup(t,surface),{$}=p,before=await p.saved();$('import-open').click();
  p.grant(false);await $('import-clipboard').onclick();assert.equal(p.reads(),0);assert.equal($('import-error').textContent,p.w.TextPatchI18n.t('import_clipboard_denied'));
  p.grant(true);
  for(const [value,key] of [['  ','import_clipboard_empty'],['{','import_text_invalid'],['```json\n{}\n```\n```json\n{}\n```','import_text_invalid'],['Here is JSON:\n{}','import_text_invalid'],['"'+'\u00e9'.repeat(2_500_000)+'"','import_text_too_large'],['{"format":"text-patch-table","version":1,"entries":[{}]}',null]]){
   p.content(value);await $('import-clipboard').onclick();assert.equal($('import-editor').open,true);assert.ok($('import-error').textContent);if(key)assert.equal($('import-error').textContent,p.w.TextPatchI18n.t(key));assert.deepEqual(await p.saved(),before);assert.equal($('import-clipboard').disabled,false);
  }
  p.content('```json\n'+ordinary+'\n```');await $('import-clipboard').onclick();assert.equal($('import-editor').open,false,$('import-error').textContent);
 });
 test(surface+': unsupported and browser denial are actionable without mutation',async t=>{
  const p=await setup(t,surface),{$,w}=p,before=await p.saved();$('import-open').click();
  const clipboard=w.navigator.clipboard;Object.defineProperty(w.navigator,'clipboard',{configurable:true,value:undefined});await $('import-clipboard').onclick();assert.equal($('import-error').textContent,w.TextPatchI18n.t('import_clipboard_unsupported'));assert.equal(p.permissions(),0);
  Object.defineProperty(w.navigator,'clipboard',{configurable:true,value:clipboard});p.defer(()=>Promise.reject(new w.DOMException('blocked','NotAllowedError')));await $('import-clipboard').onclick();assert.equal($('import-error').textContent,w.TextPatchI18n.t('import_clipboard_denied'));assert.deepEqual(await p.saved(),before);
 });
 test(surface+': pending reads reject reentry, can cancel, ignore late text and retry',async t=>{
  const p=await setup(t,surface),{$}=p,before=await p.saved();let finish;p.defer(()=>new Promise(resolve=>finish=resolve));$('import-open').click();
  const pending=$('import-clipboard').onclick();await until(()=>!!finish);await $('import-clipboard').onclick();assert.equal(p.reads(),1);assert.equal($('import-file-choice').disabled,true);
  $('import-cancel').click();assert.equal($('import-editor').open,false);finish(ordinary);await pending;assert.deepEqual(await p.saved(),before);
  p.defer(null);$('import-open').click();await $('import-clipboard').onclick();assert.equal($('import-editor').open,false);
 });
 test(surface+': cancellation during permission request prevents the later clipboard read',async t=>{
  const p=await setup(t,surface),{$}=p,before=await p.saved();let grant;
  p.w.chrome.permissions.request=()=>new Promise(resolve=>grant=resolve);
  $('import-open').click();const pending=$('import-clipboard').onclick();assert.equal(typeof grant,'function');
  $('import-cancel').click();grant(true);await pending;assert.equal(p.reads(),0);assert.deepEqual(await p.saved(),before);
 });
 test(surface+': linked AI clipboard previews, cancels without saving, and applies explicitly to original',async t=>{
  const p=await setup(t,surface),{$,w}=p;const library=await p.saved();library.tables[0].entries=library.tables[0].entries.slice(0,2).map(e=>({...e,ko:''}));await p.h.send({type:'librarySave',library});
  const table=(await p.saved()).tables[0],{record}=await p.h.send({type:'aiRequestRecord',table});
  p.content(JSON.stringify({format:'text-patch-table',version:2,aiRequest:{version:1,id:record.id},entries:[{requestRow:'0',original:table.entries[0].en,replacement:'Safe pasted fill'}]}));
  const before=await p.saved();$('import-open').click();let pending=$('import-clipboard').onclick();await until(()=>w.document.querySelector('[data-ai-result]'));
  let dialog=w.document.querySelector('[data-ai-result]');assert.match(dialog.textContent,new RegExp(table.name));dialog.querySelector('button').click();await pending;assert.deepEqual(await p.saved(),before);assert.equal($('import-editor').open,true);
  pending=$('import-clipboard').onclick();await until(()=>w.document.querySelector('[data-ai-result]'));dialog=w.document.querySelector('[data-ai-result]');dialog.querySelector('[data-ai-result-apply]').click();await pending;
  const after=await p.saved();assert.equal(after.tables.length,before.tables.length);assert.equal(after.tables[0].id,table.id);assert.equal(after.tables[0].entries[0].ko,'Safe pasted fill');assert.equal($('import-editor').open,false);
 });
}
test('editor: dirty draft blocks linked clipboard preview and keeps all edits',async t=>{
 const p=await setup(t,'editor'),{$}=p,before=await p.saved();toggleDraftName(p.w);
 p.content(JSON.stringify({format:'text-patch-table',version:2,aiRequest:{version:1,id:'unneeded-for-dirty-guard'},entries:[]}));$('import-open').click();await $('import-clipboard').onclick();assert.equal($('import-error').textContent,p.w.TextPatchI18n.t('ai_save_first'));assert.equal(p.calls.some(m=>m.type==='aiResultPreview'),false);assert.deepEqual(await p.saved(),before);assert.equal($('save-all').disabled,false);
});
test('generic web editor: direct Clipboard API fallback needs no extension permission service',async t=>{
 const p=await setup(t,'editor');delete p.w.chrome.permissions;p.$('import-open').click();await p.$('import-clipboard').onclick();assert.equal(p.reads(),1);assert.equal(p.permissions(),0);assert.equal(p.$('import-editor').open,false);
});
