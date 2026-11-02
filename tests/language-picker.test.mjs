import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const read=file=>readFile(new URL('../extension/'+file,import.meta.url),'utf8');
const files=(await readdir(new URL('../extension/locales/',import.meta.url))).filter(f=>f.endsWith('.js'));
const scripts=await Promise.all([...files.map(f=>'locales/'+f),'i18n.js','shared.js','library.js','ai-request.js','ai-request-ui.js'].map(read));
const table={schemaVersion:1,id:'fixture',name:'User data العربية',entries:[{id:'r',en:'Original 日本語',ko:'',status:'untranslated'}]};
const tick=()=>new Promise(r=>setTimeout(r,0));
function storage(){
  const values={appLocale:'en'},listeners=[];
  return {values,chrome:{storage:{local:{get:async()=>({...values}),set:async patch=>{Object.assign(values,patch);for(const fn of listeners)fn({appLocale:{newValue:patch.appLocale}},'local');}},onChanged:{addListener:fn=>listeners.push(fn)}}}};
}
async function mount(t,chrome){
  const dom=new JSDOM('<body><label data-locale-chooser for="locale">Language<select id="locale"></select></label><button id="outside">Outside</button></body>',{url:'https://extension.test',runScripts:'outside-only'}),w=dom.window;
  t.after(()=>w.close());if(chrome)w.chrome=chrome;w.structuredClone=structuredClone;
  for(const source of scripts)w.eval(source);
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};await w.TextPatchI18n.ready;await tick();return w;
}
const type=(w,input,text)=>{input.focus();input.value=text;input.dispatchEvent(new w.Event('input',{bubbles:true}));};
const key=(w,input,value,extra={})=>input.dispatchEvent(new w.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true,...extra}));
const results=input=>input.parentElement.querySelector('[role=listbox]');
const values=input=>[...results(input).querySelectorAll('[role=option]')].map(n=>n.dataset.value);

const cases={
  ko:['Korean','South Korea','대한민국'],en:['English','United States','United Kingdom'],ja:['Japanese','Japan','日本'],
  'zh-Hans':['Simplified Chinese','China','中国'],'zh-Hant':['Traditional Chinese','Taiwan','臺灣'],
  es:['Spanish','Spain','España'],fr:['French','France','Belgique'],de:['German','Germany','Deutschland'],
  'pt-BR':['Portuguese','Brazil','Brasil'],ru:['Russian','Russia','Россия'],id:['Indonesian','Indonesia','Republik Indonesia'],
  vi:['Vietnamese','Vietnam','Việt Nam'],th:['Thai','Thailand','ประเทศไทย'],hi:['Hindi','India','भारत'],
  ar:['Arabic','Saudi Arabia','السعودية'],ro:['Romanian','Romania','România'],hu:['Hungarian','Hungary','Magyarország'],
  bg:['Bulgarian','Bulgaria','България'],uk:['Ukrainian','Ukraine','Україна'],la:['Latin','Vatican City','Civitas Vaticana']
};
test('shared aliases find all 20 languages through English/native language and country names, codes and partial input',async t=>{
  const w=await mount(t),i=w.TextPatchI18n;
  assert.deepEqual(Object.keys(cases),Object.keys(i.languages));
  for(const [code,terms] of Object.entries(cases))for(const term of [code,code.replaceAll('-','_'),i.languages[code],...terms]){
    assert.ok(i.searchLanguages(term).includes(code),code+': '+term);
    assert.ok(i.searchLanguages(term.toUpperCase()).includes(code),code+': case '+term);
    assert.ok(i.searchLanguages(term.slice(0,Math.max(2,term.length-2))).includes(code),code+': partial '+term);
  }
  for(const term of ['Korean','Korea','South Korea','Republic of Korea','한국','한국어','한글'])assert.ok(i.searchLanguages(term).includes('ko'),term);
  for(const term of ['Romania','România','ROMANIA','românia','român'])assert.ok(i.searchLanguages(term).includes('ro'),term);
  assert.ok(i.searchLanguages('Latina').includes('la'));
  assert.deepEqual([...i.searchLanguages('Canada')],['en','fr']);
  assert.deepEqual([...i.searchLanguages('China')],['zh-Hans','zh-Hant']);
  assert.deepEqual([...i.searchLanguages('Switzerland')],['fr','de']);
  assert.equal(i.searchLanguages('unsupported-language-xyz').length,0);
});

test('popup and editor load shared combobox styles, including the served legacy editor route',async()=>{
  for(const file of ['popup.html','editor/index.html'])assert.match(await read(file),/href="(?:\.\.\/)?language-picker\.css"/);
  assert.match(await readFile(new URL('../server.mjs',import.meta.url),'utf8'),/['"]\/language-picker\.css['"]:'extension\/language-picker\.css'/);
});

test('app combobox preserves current choice while typing, on no matches, Escape, Tab and outside blur',async t=>{
  const bus=storage(),w=await mount(t,bus.chrome),select=w.document.getElementById('locale'),input=select.languagePicker.input;
  assert.equal(select.hidden,true);assert.equal(select.tabIndex,-1);
  assert.equal(w.document.querySelectorAll('[role=combobox]').length,1);assert.equal(input.getAttribute('aria-autocomplete'),'list');
  assert.equal(w.document.querySelector('label').htmlFor,input.id);
  type(w,input,'Korea');assert.deepEqual(values(input),['ko']);
  assert.equal(select.value,'en');assert.equal(w.TextPatchI18n.locale,'en');assert.equal(bus.values.appLocale,'en');
  key(w,input,'Enter');assert.equal(select.value,'en','unhighlighted match is not implicitly chosen');
  key(w,input,'Escape');assert.equal(input.value,'English');assert.equal(input.getAttribute('aria-expanded'),'false');
  type(w,input,'unsupported-language-xyz');assert.equal(values(input).length,0);assert.equal(results(input).querySelector('[role=status]').textContent,'No search results.');
  key(w,input,'ArrowDown');key(w,input,'Enter');assert.equal(select.value,'en');
  key(w,input,'Tab');assert.equal(input.value,'English');assert.equal(select.value,'en');
  type(w,input,'România');w.document.getElementById('outside').focus();await tick();assert.equal(input.value,'English');assert.equal(select.value,'en');
});

test('mouse and keyboard explicitly select real app values, persist and synchronize open app/AI labels',async t=>{
  const bus=storage(),w=await mount(t,bus.chrome),other=await mount(t,bus.chrome),select=w.document.getElementById('locale'),input=select.languagePicker.input;
  const dialog=await other.TextPatchAIUI.open({table,loadPreferences:()=>({sourceLanguage:'English'})});
  const target=dialog.querySelector('[data-ai=targetLanguage]'),targetInput=target.languagePicker.input;
  let changes=0;select.addEventListener('change',()=>changes++);
  type(w,input,'ROMANIA');results(input).querySelector('[data-value=ro]').click();await tick();
  assert.equal(changes,1);assert.equal(select.value,'ro');assert.equal(bus.values.appLocale,'ro');assert.equal(other.TextPatchI18n.locale,'ro');assert.equal(input.value,'Română');
  assert.equal(target.value,'English','existing AI target draft is retained');assert.equal(targetInput.value,'English');
  type(w,input,'한글');key(w,input,'ArrowDown');assert.ok(input.getAttribute('aria-activedescendant'));
  key(w,input,'Enter');await tick();assert.equal(changes,2);assert.equal(select.value,'ko');assert.equal(other.TextPatchI18n.locale,'ko');
  const reopened=await other.TextPatchAIUI.open({table,loadPreferences:()=>({targetLanguage:'Latin'})});
  assert.equal(reopened.querySelector('[data-ai=targetLanguage]').languagePicker.input.value,'한국어');
  type(w,input,'Latina');key(w,input,'ArrowUp');key(w,input,'Enter');await tick();
  assert.equal(select.value,'la');assert.match(input.title,/Latina experimentalis/);assert.match(input.getAttribute('aria-label'),/Latina experimentalis/);
});

test('AI source/target use the same aliases while retaining auto, custom input and unrelated user data',async t=>{
  const w=await mount(t);await w.TextPatchI18n.setLocale('ro');
  const before=JSON.stringify(table),dialog=await w.TextPatchAIUI.open({table,loadPreferences:()=>({})}),control=name=>dialog.querySelector('[data-ai='+name+']');
  const source=control('sourceLanguage'),target=control('targetLanguage'),a=source.languagePicker.input,b=target.languagePicker.input;
  assert.equal(source.value,'auto');assert.equal(target.value,'Română');assert.equal(a.value,w.TextPatchI18n.t('ai_language_auto'));
  type(w,a,'Republic of Korea');key(w,a,'ArrowDown');key(w,a,'Enter');assert.equal(source.value,'한국어');
  type(w,b,'România');assert.equal(target.value,'Română');
  type(w,b,'Vatican');results(b).querySelector('[data-value=Latina]').click();assert.equal(target.value,'Latina');assert.equal(b.getAttribute('aria-expanded'),'false');
  type(w,b,w.TextPatchI18n.t('ai_language_custom'));key(w,b,'ArrowDown');key(w,b,'Enter');
  assert.equal(target.value,'__custom__');assert.equal(control('targetLanguageCustom').parentElement.hidden,false);
  control('targetLanguageCustom').value='Esperanto';control('instruction').value='Keep user draft';
  await w.TextPatchI18n.setLocale('ar');assert.equal(source.value,'한국어');assert.equal(target.value,'__custom__');assert.equal(control('targetLanguageCustom').value,'Esperanto');
  assert.equal(control('instruction').value,'Keep user draft');assert.equal(w.document.documentElement.dir,'rtl');assert.equal(b.dir,'auto');
  type(w,a,'auto');assert.ok(values(a).includes('auto'));key(w,a,'ArrowDown');key(w,a,'Enter');assert.equal(source.value,'auto');
  type(w,b,'custom language');assert.deepEqual(values(b),['__custom__']);key(w,b,'Escape');assert.equal(target.value,'__custom__');
  assert.equal(JSON.stringify(table),before);
});

test('IME composition cannot choose or cancel a language, and search prevents late preferences replacing interaction',async t=>{
  const w=await mount(t),select=w.document.getElementById('locale'),input=select.languagePicker.input;
  input.focus();input.dispatchEvent(new w.CompositionEvent('compositionstart',{bubbles:true}));type(w,input,'한글');
  key(w,input,'ArrowDown',{isComposing:true});key(w,input,'Enter',{isComposing:true});key(w,input,'Escape',{isComposing:true});
  assert.equal(select.value,'en');assert.equal(input.value,'한글');assert.equal(input.getAttribute('aria-expanded'),'true');
  input.dispatchEvent(new w.CompositionEvent('compositionend',{bubbles:true,data:'한글'}));assert.deepEqual(values(input),['ko']);
  key(w,input,'ArrowDown');key(w,input,'Enter');assert.equal(select.value,'ko');
  let finish;const opening=w.TextPatchAIUI.open({table,loadPreferences:()=>new Promise(r=>{finish=r;})});await tick();
  const source=w.document.querySelector('[data-ai=sourceLanguage]'),query=source.languagePicker.input;
  type(w,query,'Romania');finish({sourceLanguage:'Old source'});await opening;
  assert.equal(source.value,'auto');assert.equal(query.value,'Romania');assert.deepEqual(values(query),['Română']);
});
