import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const source=file=>readFile(new URL('../extension/'+file,import.meta.url),'utf8');
const codes=['ko','en','ja','zh-Hans','zh-Hant','es','fr','de','pt-BR','ru','id','vi','th','hi','ar'];
test('Arabic catalog covers every key and preserves interpolation tokens without bidi controls',async()=>{
  const dom=new JSDOM('',{runScripts:'outside-only'});
  try{
    for(const code of ['en','ko','ar'])dom.window.eval(await source('locales/'+code+'.js'));
    const {en,ko,ar}=dom.window.TextPatchLocales;
    assert.ok(Object.keys(ar).length>=312);
    for(const catalog of [ko,ar]){
      assert.deepEqual(Object.keys(catalog).sort(),Object.keys(en).sort());
      for(const key of Object.keys(en)){
        const tokens=s=>[...s.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
        assert.deepEqual(tokens(catalog[key]),tokens(en[key]),key);
        assert.doesNotMatch(catalog[key],/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/,key);
      }
    }
    assert.deepEqual(Object.keys(JSON.parse(await source('_locales/ar/messages.json'))).sort(),['appDescription','appName']);
  }finally{dom.window.close();}
});
test('all app surfaces and service worker load the complete locale registry',async()=>{
  for(const file of ['popup.html','options.html','manager.html','editor/index.html','background.js']){
    const text=await source(file);
    for(const code of codes)assert.ok(text.includes('locales/'+code+'.js'),file+' '+code);
  }
});
test('Arabic switching isolates mixed table data and preserves drafts, AI choices and exported strings',async()=>{
  const dom=new JSDOM(await source('editor/index.html'),{url:'https://extension.test/',runScripts:'outside-only'}),w=dom.window;
  try{
    w.structuredClone=structuredClone;w.confirm=()=>true;
    w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
    for(const file of ['locales/en.js','locales/ko.js','locales/ar.js','i18n.js','shared.js','library.js','editor/import.js','ai-request.js','ai-request-ui.js'])w.eval(await source(file));
    await w.TextPatchI18n.ready;
    const seed=JSON.parse(await source('data/dictionary.json')),library=w.TextPatch.migrate(seed);
    const table=library.tables[0],mixed='العربية Latin 한국어 123 (42) /?';
    table.name=mixed;Object.assign(table.entries[0],{en:'English 한국어 123 (س)',ko:'العربية ABC 42 (한)',status:'review'});
    const before=JSON.stringify(library),calls=[];
    w.EditorStorage={load:async()=>structuredClone(library),save:async()=>{calls.push('save');}};
    w.eval(await source('editor/app.js'));await new Promise(r=>setTimeout(r,0));
    const $=id=>w.document.getElementById(id),i=w.TextPatchI18n;
    assert.equal($('app-locale').options.length,15);
    assert.equal($('rows').firstChild.children[0].dir,'auto');
    assert.equal($('rows').firstChild.children[0].textContent,'English 한국어 123 (س)');
    $('table-rename').click();$('table-name').value=mixed+' draft';$('table-form').dispatchEvent(new w.Event('submit',{cancelable:true}));$('add').click();
    const form=$('form');form.elements.en.value=mixed;form.elements.ko.value='نص 한국어 (12)';form.elements.en.dispatchEvent(new w.Event('input',{bubbles:true}));
    const ai=await w.TextPatchAIUI.open({table,loadPreferences:async()=>({sourceLanguage:'한국어',targetLanguage:'العربية',instruction:mixed})});
    ai.querySelector('[data-ai=targetLanguage]').value='العربية';ai.querySelector('[data-ai=targetLanguage]').dispatchEvent(new w.Event('change'));
    for(const locale of ['ar','en','ko','ar']){
      await i.setLocale(locale);
      assert.equal(w.document.documentElement.dir,locale==='ar'?'rtl':'ltr');
      assert.equal($('editor').open,true);assert.equal(form.elements.en.value,mixed);assert.equal(form.elements.ko.value,'نص 한국어 (12)');
      assert.equal(ai.querySelector('[data-ai=sourceLanguage]').value,'한국어');assert.equal(ai.querySelector('[data-ai=targetLanguage]').value,'العربية');
      assert.equal(ai.querySelector('[data-ai=instruction]').value,mixed);assert.equal(ai.querySelector('[data-ai=instruction]').dir,'auto');
      assert.equal(ai.querySelector('.ai-request-summary').dir,'auto');assert.equal($('save-all').disabled,false);
    }
    const request=w.TextPatchAI.build({table,task:'translation',sourceLanguage:'한국어',targetLanguage:'العربية'});
    assert.doesNotMatch(request.text,/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/);
    assert.deepEqual(calls,[]);assert.equal(JSON.stringify(library),before);
    assert.equal(form.elements.selector.dir,'ltr');assert.equal(form.elements.context.dir,'ltr');
    delete w.TextPatchLocales.ar.saved_2;assert.equal(i.t('saved_2'),'Saved');
    assert.equal(i.t('active_replacement_count',{count:1}),'تم الاستبدال في 1 موضع');
  }finally{w.close();}
});
