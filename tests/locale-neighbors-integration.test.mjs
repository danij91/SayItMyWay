import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,mkdir,cp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {buildExtension} from '../scripts/extension-build.mjs';

const read=file=>readFile(new URL('../'+file,import.meta.url),'utf8');
const added={ro:'Română',hu:'Magyar',bg:'Български',uk:'Українська',la:'Latina'};
const files=(await readdir(new URL('../extension/locales/',import.meta.url))).filter(f=>f.endsWith('.js'));
const scripts=await Promise.all([...files.map(f=>'locales/'+f),'i18n.js','shared.js','library.js','ai-request.js','ai-request-ui.js'].map(f=>read('extension/'+f)));
const tokens=value=>[...value.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
const table={schemaVersion:1,id:'fixture',name:'User data العربية {p0}',entries:[{id:'row',en:'Original 日本語',ko:'',status:'untranslated',notes:'Keep {p0}'}]};
const control=(dialog,name)=>dialog.querySelector('[data-ai="'+name+'"]');

async function mount(t,{language='en-US',chrome}={}){
  const dom=new JSDOM('<body><label data-locale-chooser><select></select></label><p data-i18n="saved_2"></p></body>',{url:'https://extension.test',runScripts:'outside-only'}),w=dom.window;
  t.after(()=>w.close());w.structuredClone=structuredClone;
  Object.defineProperty(w.navigator,'language',{value:language});if(chrome)w.chrome=chrome;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  for(const source of scripts)w.eval(source);
  await w.TextPatchI18n.ready;await new Promise(r=>setTimeout(r,0));return w;
}

test('Latin independently defines all English keys, exact tokens and fragments, with only three identical literals',async()=>{
  const c=vm.createContext({}),source=await read('extension/locales/la.js');
  vm.runInContext(source,c);assert.deepEqual(Object.keys(c.TextPatchLocales),['la']);
  const enContext=vm.createContext({});vm.runInContext(await read('extension/locales/en.js'),enContext);
  const {en}=enContext.TextPatchLocales,{la}=c.TextPatchLocales;
  assert.deepEqual(Object.keys(la).sort(),Object.keys(en).sort());
  assert.equal([...source.matchAll(/^  "[^"]+":/gm)].length,Object.keys(en).length);
  assert.doesNotMatch(source,/TextPatchLocales\.en|\.\.\./);
  for(const [key,value] of Object.entries(la)){
    assert.ok(value.trim(),key);assert.deepEqual(tokens(value),tokens(en[key]),key);
    assert.equal(value.startsWith(' '),en[key].startsWith(' '),key);
    assert.equal(value.endsWith(' '),en[key].endsWith(' '),key);
    assert.doesNotMatch(value,/\uFFFD|\?{2,}|[\u0000-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u,key);
  }
  assert.deepEqual(Object.keys(en).filter(k=>en[k]===la[k]).sort(),['p0_p1','status','text_table_patch']);
  for(const literal of ['format:"text-patch-table"','version:2','name','defaults','captureSources','original','selector','notes','aiRequest','requestRow'])assert.ok(la.return_a_portable_table_json_object_with_formattextpatchtable.includes(literal),literal);
  for(const key of ['verified_game_terms_need_an_official_source_url','game_terms_need_an_official_https_source_or'])assert.ok(la[key].includes('사용자 확인:'),key);
  assert.match(la.app_language,/Latina experimentalis/);
});

for(const [tag,locale] of [['ro-RO','ro'],['RO_md','ro'],['hu-HU','hu'],['bg-BG','bg'],['uk-UA','uk'],['la-VA','la'],['LA_latn_VA','la']])test('regional browser locale '+tag+' resolves to '+locale,async t=>{
  const w=await mount(t,{language:tag});
  assert.equal(w.TextPatchI18n.locale,locale);assert.equal(w.document.documentElement.lang,locale);assert.equal(w.document.documentElement.dir,'ltr');
  assert.equal(w.document.querySelector('p').textContent,w.TextPatchLocales[locale].saved_2);
});

test('all five choices persist, synchronize, reopen, and expose the Latin notice through the chooser',async t=>{
  const values={},listeners=[],chrome={storage:{local:{get:async()=>({...values}),set:async patch=>{Object.assign(values,patch);for(const listener of listeners)listener({appLocale:{newValue:patch.appLocale}},'local');}},onChanged:{addListener:listener=>listeners.push(listener)}}};
  const a=await mount(t,{chrome}),b=await mount(t,{chrome,language:'ar-EG'});
  for(const [locale,name] of Object.entries(added)){
    const select=a.document.querySelector('select');
    assert.equal([...select.options].find(o=>o.value===locale).textContent,name);
    select.value=locale;select.dispatchEvent(new a.Event('change'));await new Promise(r=>setTimeout(r,0));
    assert.equal(values.appLocale,locale);assert.equal(b.TextPatchI18n.locale,locale);assert.equal(b.document.documentElement.dir,'ltr');
    const reopened=await mount(t,{chrome,language:'ar-EG'});assert.equal(reopened.TextPatchI18n.locale,locale);
  }
  const chooser=a.document.querySelector('select');assert.equal(chooser.options.length,21);
  assert.match(chooser.title,/Latina experimentalis/);assert.match(chooser.getAttribute('aria-label'),/Latina experimentalis/);
  await a.TextPatchI18n.setLocale('ar');assert.equal(b.document.documentElement.dir,'rtl');assert.doesNotMatch(chooser.title,/Latina experimentalis/);
});

test('new dialogs offer all 21 autonyms, default to selected app language and preserve edited choices on switching',async t=>{
  const w=await mount(t),before=JSON.stringify(table);
  for(const [locale,name] of Object.entries(added)){
    await w.TextPatchI18n.setLocale(locale);
    const dialog=await w.TextPatchAIUI.open({table,loadPreferences:async()=>({targetLanguage:'English'})});
    assert.equal(control(dialog,'sourceLanguage').value,'auto');assert.equal(control(dialog,'targetLanguage').value,name);
    for(const field of ['sourceLanguage','targetLanguage'])for(const autonym of Object.values(added))assert.ok([...control(dialog,field).options].some(o=>o.value===autonym),field+' '+autonym);
    const result=w.TextPatchAI.build({table,task:'translation',targetLanguage:name,requestId:'fixture-request'});
    assert.ok(result.text.includes(w.TextPatchI18n.t('ai_response_language',{p0:name})));
    const start=w.TextPatchI18n.t('json_data_start')+'\n\n',end='\n\n'+w.TextPatchI18n.t('json_data_end');
    const data=JSON.parse(result.text.slice(result.text.indexOf(start)+start.length,result.text.lastIndexOf(end)));
    assert.equal(data.format,'text-patch-table');assert.equal(data.version,2);assert.equal(data.aiRequest.id,'fixture-request');
    assert.equal(data.entries[0].original,table.entries[0].en);assert.equal(data.entries[0].replacement,'');assert.equal(data.entries[0].requestRow,'0');assert.equal(data.entries[0].notes,'Keep {p0}');
    control(dialog,'sourceLanguage').value='Română';control(dialog,'targetLanguage').value='Magyar';
    await w.TextPatchI18n.setLocale('en');assert.equal(control(dialog,'sourceLanguage').value,'Română');assert.equal(control(dialog,'targetLanguage').value,'Magyar');
  }
  assert.equal(JSON.stringify(table),before);
});

test('every HTML loader and background import loads all catalogs before the registry',async()=>{
  for(const file of ['popup.html','manager.html','options.html','editor/index.html','background.js']){
    const source=await read('extension/'+file);
    for(const locale of Object.keys(added)){
      const name='locales/'+locale+'.js';assert.ok(source.includes(name),file+' '+locale);assert.ok(source.indexOf(name)<source.indexOf('i18n.js'),file+' order '+locale);
      assert.equal(source.split(name).length-1,1,file+' exactly once '+locale);
    }
  }
});

test('production build includes all 21 app catalogs and only supported Chrome metadata',async t=>{
  // Chrome's primary locale list includes ro/hu/bg/uk, excludes la:
  // https://developer.chrome.com/docs/extensions/reference/api/i18n#locales
  const root=await mkdtemp(path.join(os.tmpdir(),'text-patch-neighbor-build-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'extension'));await cp(new URL('../extension/',import.meta.url),path.join(root,'extension'),{recursive:true});
  const output=await buildExtension(root);
  for(const file of files)assert.equal(await readFile(path.join(output,'locales',file),'utf8'),await read('extension/locales/'+file));
  for(const locale of ['ro','hu','bg','uk'])assert.equal(JSON.parse(await readFile(path.join(output,'_locales',locale,'messages.json'),'utf8')).appName.message,'SayItMyWay');
  await assert.rejects(readFile(path.join(output,'_locales/la/messages.json')),{code:'ENOENT'});
  assert.equal(JSON.parse(await readFile(path.join(output,'manifest.json'),'utf8')).version,JSON.parse(await read('extension/manifest.json')).version);
});
