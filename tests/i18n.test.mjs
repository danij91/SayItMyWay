import {toggleDraftName,hasDraftName} from './editor-draft-helpers.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const source=file=>readFile(new URL('../extension/'+file,import.meta.url),'utf8');
const scripts=await Promise.all(['locales/ko.js','locales/en.js','locales/ar.js','i18n.js'].map(source));
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function storage(initial={}){
  const values={...initial},listeners=[];
  return {values,chrome:{storage:{local:{get:async()=>({...values}),set:async patch=>{Object.assign(values,patch);for(const listener of listeners)listener(Object.fromEntries(Object.entries(patch).map(([key,newValue])=>[key,{newValue}])),'local');}},onChanged:{addListener:listener=>listeners.push(listener)}}}};
}
async function mount(t,{html='<body><p data-i18n="saved_2"></p></body>',language='en-US',chrome,waitReady=true}={}){
  const dom=new JSDOM(html,{url:'https://extension.test/',runScripts:'outside-only'}),w=dom.window;
  t.after(()=>w.close());Object.defineProperty(w.navigator,'language',{value:language,configurable:true});if(chrome)w.chrome=chrome;
  for(const script of scripts)w.eval(script);if(waitReady)await w.TextPatchI18n.ready;await tick();return w;
}
test('ko/en catalogs have matching keys and parameters; missing keys fall back safely and text remains inert',async t=>{
  const w=await mount(t),i=w.TextPatchI18n,{ko,en}=w.TextPatchLocales;
  assert.deepEqual(Object.keys(ko).sort(),Object.keys(en).sort());
  for(const key of Object.keys(en))assert.deepEqual([...ko[key].matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),[...en[key].matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),key);
  assert.equal(i.t('copied_the_request_for_all_p0_rows',{p0:405}),'Copied the request for all 405 rows.');
  assert.equal(i.t('unknown.key'),'unknown.key');
  assert.equal(i.t('toString'),'toString');assert.equal(i.t('__proto__'),'__proto__');
  await i.setLocale('ko');delete ko.saved_2;assert.equal(i.t('saved_2'),'Saved');
  const node=w.document.querySelector('p');i.text(node,()=>i.t('delete_entry_p0',{p0:'<img src=x onerror=alert(1)>'}));
  assert.equal(node.querySelector('img'),null);assert.match(node.textContent,/<img/);
  assert.equal(i.message('Invalid field: en'),'잘못된 필드: en');
});
for(const [language,expected] of [['ko-KR','ko'],['KO','ko'],['en-GB','en'],['ja-JP','ja'],['zh-TW','zh-Hant'],['zh-HK','zh-Hant'],['zh-Hant-CN','zh-Hant'],['zh-CN','zh-Hans'],['zh-SG','zh-Hans'],['zh-Hans-TW','zh-Hans'],['pt','pt-BR'],['pt-PT','pt-BR'],['pt-BR','pt-BR'],['ar-EG','ar'],['ar-SA','ar'],['AR_ae','ar'],['unknown','en'],['kok-IN','en']])test('initial browser language '+language+' selects '+expected,async t=>{
  const w=await mount(t,{language});assert.equal(w.TextPatchI18n.locale,expected);assert.equal(w.document.documentElement.lang,expected);
});
test('saved choice wins over browser default, persists and synchronizes between open pages',async t=>{
  const bus=storage({appLocale:'en'}),a=await mount(t,{language:'ko',chrome:bus.chrome}),b=await mount(t,{language:'ko',chrome:bus.chrome});
  assert.equal(a.TextPatchI18n.locale,'en');await a.TextPatchI18n.setLocale('ko');
  assert.equal(bus.values.appLocale,'ko');assert.equal(b.document.querySelector('p').textContent,'저장됨');
  const reopened=await mount(t,{chrome:bus.chrome});assert.equal(reopened.TextPatchI18n.locale,'ko');
  const fallback=await mount(t,{chrome:storage({appLocale:'invalid'}).chrome,language:'en'});assert.equal(fallback.TextPatchI18n.locale,'en');
});
test('extension browser UI locale takes precedence over navigator language',async t=>{
  const w=await mount(t,{language:'en-US',chrome:{i18n:{getUILanguage:()=> 'ko-KR'}}});assert.equal(w.TextPatchI18n.locale,'ko');
});

test('persisted Arabic override wins over regional default and synchronizes direction across pages',async t=>{
  const bus=storage({appLocale:'ar'}),a=await mount(t,{language:'zh-HK',chrome:bus.chrome}),b=await mount(t,{language:'pt-PT',chrome:bus.chrome});
  assert.equal(a.TextPatchI18n.locale,'ar');assert.equal(a.document.documentElement.dir,'rtl');
  assert.equal(b.TextPatchI18n.locale,'ar');assert.equal(b.document.documentElement.dir,'rtl');
  await a.TextPatchI18n.setLocale('en');assert.equal(b.document.documentElement.dir,'ltr');
  const reopened=await mount(t,{language:'ar-EG',chrome:bus.chrome});assert.equal(reopened.TextPatchI18n.locale,'en');
});
test('late initialization and rapid writes cannot revert the latest explicit language choice',async t=>{
  let release;const listeners=[],writes=[],chrome={storage:{local:{get:()=>new Promise(resolve=>release=resolve),set:async patch=>{writes.push(patch.appLocale);for(const fn of listeners)fn({appLocale:{newValue:patch.appLocale}},'local');}},onChanged:{addListener:fn=>listeners.push(fn)}}};
  const w=await mount(t,{chrome,language:'ko',waitReady:false});
  const first=w.TextPatchI18n.setLocale('ko'),second=w.TextPatchI18n.setLocale('en');release({appLocale:'ko'});await Promise.all([first,second,w.TextPatchI18n.ready]);
  assert.deepEqual(writes,['ko','en']);assert.equal(w.TextPatchI18n.locale,'en');
});
test('storage failures retain a usable browser default and a chosen local language',async t=>{
  const w=await mount(t,{language:'ko',chrome:{storage:{local:{get:async()=>{throw Error('unavailable');},set:async()=>{throw Error('quota');}}}}});
  assert.equal(w.TextPatchI18n.locale,'ko');await assert.rejects(w.TextPatchI18n.setLocale('en'),/quota/);assert.equal(w.document.querySelector('p').textContent,'Saved');
});

test('editor language chooser is click-only and closes on choice, Escape and outside click',async t=>{
 const w=await mount(t,{html:await source('editor/index.html')});w.structuredClone=structuredClone;
 for(const file of ['shared.js','library.js'])w.eval(await source(file));
 const saved=w.TextPatch.migrate(JSON.parse(await source('data/dictionary.json')));
 w.EditorStorage={load:async()=>structuredClone(saved)};w.eval(await source('import-ui.js'));w.eval(await source('editor/app.js'));await tick();
 const menu=w.document.getElementById('editor-language'),trigger=menu.querySelector('summary'),select=menu.querySelector('select');
 assert.equal(menu.open,false);trigger.dispatchEvent(new w.Event('mouseover'));assert.equal(menu.open,false);
 trigger.click();assert.equal(menu.open,true);select.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(menu.open,false);assert.equal(w.document.activeElement,trigger);
 trigger.click();select.value='ar';select.dispatchEvent(new w.Event('change'));await tick();assert.equal(menu.open,false);assert.equal(w.document.documentElement.dir,'rtl');
 trigger.click();w.document.querySelector('main').click();assert.equal(menu.open,false);
});
test('popup language choice synchronizes an editor draft, open entry and AI inputs without saves or data translation',async t=>{
  const bus=storage({appLocale:'ko'}),calls=[];
  const w=await mount(t,{html:await source('editor/index.html'),chrome:bus.chrome});
  w.structuredClone=structuredClone;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  for(const file of ['shared.js','library.js','ai-request.js','ai-request-ui.js','editor/import.js'])w.eval(await source(file));
  const saved=w.TextPatch.migrate(JSON.parse(await source('data/dictionary.json'))),before=JSON.stringify(saved);
  w.EditorStorage={load:async()=>{calls.push('load');return structuredClone(saved);},save:async()=>{calls.push('save');throw Error('unexpected save');}};
  w.eval(await source('import-ui.js'));w.eval(await source('editor/app.js'));await tick();const $=id=>w.document.getElementById(id);
  toggleDraftName(w);$('query').value='Search';$('query').dispatchEvent(new w.Event('input'));
  $('add').click();const form=$('form');form.elements.en.value='미저장 original';form.elements.ko.value='Untouched replacement';form.elements.notes.value='사용자 확인: evidence';
  form.elements.en.dispatchEvent(new w.Event('input',{bubbles:true}));
  const popup=await mount(t,{html:await source('popup.html'),chrome:bus.chrome});const chooser=popup.document.getElementById('app-locale');chooser.value='en';chooser.dispatchEvent(new popup.Event('change'));await tick();
  assert.equal(w.document.documentElement.lang,'en');assert.equal($('save-all').textContent,'Save');assert.equal($('save-state').textContent,'Not saved');
  assert.equal($('app-locale').value,'en');assert.equal($('editor').open,true);assert.equal(form.elements.en.value,'미저장 original');assert.equal(form.elements.ko.value,'Untouched replacement');assert.equal(form.elements.notes.value,'사용자 확인: evidence');
  assert.equal($('query').value,'Search');assert.equal(hasDraftName(w),true);assert.deepEqual(calls,['load']);assert.equal(JSON.stringify(saved),before);assert.equal($('defaults-placeholder'),null);
  const table={schemaVersion:1,id:'t',name:'한국어 user table',entries:[{id:'r',en:'原文',ko:'',status:'untranslated'}]};
  const dialog=await w.TextPatchAIUI.open({table,loadPreferences:async()=>({sourceLanguage:'Japanese',targetLanguage:'French',instruction:'keep MY choices'})});
  dialog.querySelector('[data-ai=targetLanguage]').value='__custom__';dialog.querySelector('[data-ai=targetLanguageCustom]').value='French';dialog.querySelector('[data-ai=targetLanguage]').dispatchEvent(new w.Event('change'));
  await w.TextPatchI18n.setLocale('ko');assert.equal(dialog.querySelector('[data-ai=targetLanguage]').value,'__custom__');assert.equal(dialog.querySelector('[data-ai=targetLanguageCustom]').value,'French');assert.equal(dialog.querySelector('[data-ai=sourceLanguage]').value,'__custom__');assert.equal(dialog.querySelector('[data-ai=sourceLanguageCustom]').value,'Japanese');assert.equal(dialog.querySelector('[data-ai=instruction]').value,'keep MY choices');
  assert.equal(dialog.querySelector('[data-ai=copy]').textContent,'요청 복사');assert.equal(dialog.querySelector('h2').textContent,'AI 요청');assert.equal(dialog.querySelector('.ai-request-summary').textContent,'한국어 user table');
  const korean=w.TextPatchAI.build({table,task:'translation',sourceLanguage:'Japanese',targetLanguage:'French'});assert.match(korean.text,/목적 언어 French/);
  await w.TextPatchI18n.setLocale('en');const english=w.TextPatchAI.build({table,task:'translation',sourceLanguage:'Japanese',targetLanguage:'French'});assert.match(english.text,/target language French/);assert.match(english.text,/"original": "原文"/);assert.match(english.text,/"replacement": ""/);
  assert.equal(form.elements.en.value,'미저장 original');assert.deepEqual(calls,['load']);assert.equal(JSON.stringify(saved),before);
});
