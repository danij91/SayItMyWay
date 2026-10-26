import {loadKorean} from './i18n-harness.mjs';
﻿import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const scripts=await Promise.all(['shared.js','library.js','ai-request.js','ai-request-ui.js'].map(file=>readFile(new URL('../extension/'+file,import.meta.url),'utf8')));
const row=i=>({id:'r'+i,en:'<img src=x> '+i,ko:'',status:'untranslated'});
const table={schemaVersion:1,id:'t',name:'<img src=x onerror=alert(1)>',entries:Array.from({length:405},(_,i)=>row(i))};
function setup({chrome}={}){
  const dom=new JSDOM('<body><button>AI</button></body>',{url:'http://localhost',runScripts:'outside-only'}),w=dom.window;
  if(chrome)w.chrome=chrome;
  loadKorean(w);w.structuredClone=structuredClone;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  for(const script of scripts)w.eval(script);
  return dom;
}
const control=(dialog,name)=>dialog.querySelector('[data-ai="'+name+'"]');
test('each new dialog defaults to the current app language endonym, ignoring saved targets',async()=>{
  const dom=setup(),w=dom.window;let copied;
  Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text=>{copied=text;}}});
  try{
    assert.equal(Object.keys(w.TextPatchI18n.languages).length,15);
    for(const [locale,endonym] of Object.entries(w.TextPatchI18n.languages)){
      await w.TextPatchI18n.setLocale(locale);
      for(const prefs of [{},{targetLanguage:'English'},{targetLanguage:'Esperanto'},{targetLanguage:''}]){
        const dialog=await w.TextPatchAIUI.open({table,loadPreferences:()=>prefs});
        assert.equal(control(dialog,'targetLanguage').value,endonym,locale+' '+JSON.stringify(prefs));
        await control(dialog,'copy').onclick();
        assert.equal(copied,w.TextPatchAI.build({table,task:'translation',sourceLanguage:'auto',targetLanguage:endonym}).text);
      }
    }
  }finally{w.close();}
});
function setLanguage(dialog,name,value){
  const select=control(dialog,name);
  select.value=[...select.options].some(o=>o.value===value)?value:'__custom__';
  if(select.value==='__custom__')control(dialog,name+'Custom').value=value;
}
test('opening waits for persisted app locale readiness before choosing the target',async()=>{
  let finishLocale;
  const dom=setup({chrome:{storage:{local:{get:()=>new Promise(resolve=>{finishLocale=resolve;})}}}}),w=dom.window;
  try{
    const opening=w.TextPatchAIUI.open({table,loadPreferences:()=>({targetLanguage:'Esperanto'})});
    assert.equal(w.document.querySelector('dialog'),null);
    finishLocale({appLocale:'ja'});
    const dialog=await opening;
    assert.equal(control(dialog,'targetLanguage').value,'日本語');
  }finally{w.close();}
});
test('delayed preferences retain opening target and other preferences; reopening uses current locale',async()=>{
  const dom=setup(),w=dom.window;let finishPreferences;
  try{
    await w.TextPatchI18n.setLocale('ja');
    const opening=w.TextPatchAIUI.open({table,loadPreferences:()=>new Promise(resolve=>{finishPreferences=resolve;})});
    await Promise.resolve();
    const dialog=w.document.querySelector('dialog');
    assert.equal(control(dialog,'targetLanguage').value,'日本語');
    await w.TextPatchI18n.setLocale('ar');
    finishPreferences({task:'replacement',sourceLanguage:'Old source',targetLanguage:'Esperanto',instruction:'keep concise'});
    await opening;
    assert.equal(control(dialog,'targetLanguage').value,'日本語');
    assert.equal(control(dialog,'task').value,'replacement');
    assert.equal(control(dialog,'sourceLanguageCustom').value,'Old source');
    assert.equal(control(dialog,'instruction').value,'keep concise');
    setLanguage(dialog,'targetLanguage','Manual target');control(dialog,'targetLanguage').dispatchEvent(new w.Event('change'));
    await w.TextPatchI18n.setLocale('fr');
    assert.equal(control(dialog,'targetLanguageCustom').value,'Manual target');
    const reopened=await w.TextPatchAIUI.open({table});
    assert.equal(dialog.isConnected,false);
    assert.equal(control(reopened,'targetLanguage').value,'Français');
  }finally{w.close();}
});
const siteRule=(id,origin,extra={})=>({id,origin,scope:'site',path:'/',tableId:'t',enabled:true,...extra});
function extensionState(w,state,tabs=[]){
  w.chrome={runtime:{id:'test-extension',sendMessage:async message=>{assert.equal(message.type,'state');return state;}},tabs:{query:async()=>tabs}};
}
test('website inference prefers explicit page then latest valid capture and remains optional',async()=>{
  const dom=setup(),w=dom.window;
  try{
    const captured={...table,captureSources:[
      {url:'https://new.example/path?q=secret#hash',title:'Latest',language:'fr',capturedAt:'2026-10-20T00:00:00Z'},
      {url:'https://old.example/',capturedAt:'2025-01-01T00:00:00Z'},
      {url:'file:///invalid',capturedAt:'2027-01-01T00:00:00Z'}]};
    let dialog=await w.TextPatchAIUI.open({table:captured,page:{url:'https://user:pass@explicit.example/a?q=secret#hash'}});
    assert.equal(control(dialog,'websiteURL').value,'https://explicit.example/a');
    dialog=await w.TextPatchAIUI.open({table:captured});
    assert.equal(control(dialog,'websiteURL').value,'https://new.example/path');
    dialog=await w.TextPatchAIUI.open({table});assert.equal(control(dialog,'websiteURL').value,'');
  }finally{w.close();}
});
test('language dropdowns expose every endonym with source auto and preserve manually selected custom drafts',async()=>{
  const dom=setup(),w=dom.window;let saved;
  try{
    let dialog=await w.TextPatchAIUI.open({table}),$=name=>control(dialog,name);
    assert.equal($('sourceLanguage').tagName,'SELECT');assert.equal($('targetLanguage').tagName,'SELECT');
    assert.equal($('sourceLanguage').value,'auto');assert.equal($('targetLanguage').value,'한국어');
    for(const name of Object.values(w.TextPatchI18n.languages)){
      assert.ok([...$('sourceLanguage').options].some(o=>o.textContent===name));
      assert.ok([...$('targetLanguage').options].some(o=>o.textContent===name));
    }
    dialog=await w.TextPatchAIUI.open({table,loadPreferences:()=>({sourceLanguage:'Old source',targetLanguage:'Esperanto'}),savePreferences:p=>{saved=p;}});
    assert.equal($('sourceLanguage').value,'__custom__');assert.equal($('sourceLanguageCustom').value,'Old source');
    assert.equal($('targetLanguage').value,'한국어');assert.equal($('targetLanguageCustom').value,'');
    setLanguage(dialog,'targetLanguage','Esperanto');$('targetLanguage').dispatchEvent(new w.Event('change'));
    assert.equal($('targetLanguageCustom').parentElement.hidden,false);
    $('targetLanguage').value='العربية';$('targetLanguage').dispatchEvent(new w.Event('change'));
    assert.equal($('targetLanguageCustom').parentElement.hidden,true);
    await w.TextPatchI18n.setLocale('en');assert.equal($('targetLanguage').value,'العربية');
    $('targetLanguage').value='__custom__';$('targetLanguage').dispatchEvent(new w.Event('change'));
    assert.equal($('targetLanguageCustom').value,'Esperanto');
    await $('copy').onclick();assert.equal(saved.targetLanguage,'Esperanto');assert.equal(saved.sourceLanguage,'Old source');
    $('targetLanguageCustom').value='';$('targetLanguageCustom').dispatchEvent(new w.Event('input'));
    await $('copy').onclick();assert.equal(w.document.activeElement,$('targetLanguageCustom'));assert.match($('status').textContent,/target language/);
  }finally{w.close();}
});
test('enabled linked site inference prefers an open matching rule then stable first and honors origin and specific rule state',async()=>{
  const dom=setup(),w=dom.window;
  const state={enabled:true,rules:[siteRule('first','https://first.example'),siteRule('second','https://second.example'),siteRule('third','https://third.example')],originEnabled:{}};
  const open=async()=>control(await w.TextPatchAIUI.open({table}),'websiteURL').value;
  try{
    extensionState(w,state,[{url:'https://second.example/open?q=private',title:'Open site',active:true}]);
    assert.equal(await open(),'https://second.example/open');
    extensionState(w,state,[]);assert.equal(await open(),'https://first.example/');
    state.originEnabled['https://first.example']=false;
    assert.equal(await open(),'https://second.example/');
    state.rules[1].enabled=false;assert.equal(await open(),'https://third.example/');
    state.rules.push(siteRule('third-page','https://third.example',{scope:'page',path:'/paused',enabled:false}));
    extensionState(w,state,[{url:'https://third.example/paused',active:true}]);
    assert.equal(await open(),'https://third.example/');
    state.rules.push(siteRule('other-table','https://third.example',{scope:'page',path:'/other',tableId:'other'}));
    extensionState(w,state,[{url:'https://third.example/other',active:true}]);
    assert.equal(await open(),'https://third.example/');
    state.enabled=false;assert.equal(await open(),'');
    state.originEnabled['https://third.example']=true;assert.equal(await open(),'https://third.example/');
    state.rules[0].enabled=false;state.rules[1].enabled=true;state.enabled=true;
    const captured={...table,captureSources:[{url:'https://capture.example/',title:'Captured'}]};
    assert.equal(control(await w.TextPatchAIUI.open({table:captured}),'websiteURL').value,'https://capture.example/');
    w.chrome={runtime:{sendMessage:()=>{throw Error('HTTP editor must not query');}}};
    assert.equal(await open(),'');
    w.chrome={runtime:{id:'test',sendMessage:async()=>{throw Error('unavailable');}}};
    assert.equal(await open(),'');
  }finally{w.close();}
});

test('manual or cleared website and language drafts survive delayed state and preferences',async()=>{
  const dom=setup(),w=dom.window;let finishState,finishPreferences;
  try{
    for(const manual of ['https://manual.example/',''])for(const target of ['My language','العربية','']){
      w.chrome={runtime:{id:'test',sendMessage:()=>new Promise(resolve=>{finishState=resolve;})}};
      const opening=w.TextPatchAIUI.open({table,loadPreferences:()=>new Promise(resolve=>{finishPreferences=resolve;})});
      await Promise.resolve();
      const dialog=w.document.querySelector('dialog'),$=name=>control(dialog,name);
      $('websiteURL').value=manual;$('websiteURL').dispatchEvent(new w.Event('input'));
      setLanguage(dialog,'targetLanguage',target);$('targetLanguage').dispatchEvent(new w.Event('change'));
      finishPreferences({targetLanguage:'العربية',instruction:'late'});
      finishState({enabled:true,rules:[siteRule('linked','https://late.example')],originEnabled:{}});
      await opening;assert.equal($('websiteURL').value,manual);
      assert.equal($('targetLanguage').value,target==='My language'?'__custom__':target);
      if(target==='My language')assert.equal($('targetLanguageCustom').value,target);
    }
    let resolveOld;
    w.chrome.runtime.sendMessage=()=>new Promise(resolve=>{resolveOld=resolve;});
    const old=w.TextPatchAIUI.open({table});
    await Promise.resolve();
    control(w.document.querySelector('dialog'),'close').click();
    const latest=await w.TextPatchAIUI.open({table,page:{url:'https://reopened.example'}});
    resolveOld({enabled:true,rules:[siteRule('linked','https://old.example')]});await old;
    assert.equal(control(latest,'websiteURL').value,'https://reopened.example/');
    const loading=w.TextPatchAIUI.open({table,page:{url:'https://original.example'},loadPreferences:()=>new Promise(resolve=>{finishPreferences=resolve;})});
    await Promise.resolve();
    const dialog=w.document.querySelector('dialog');control(dialog,'websiteURL').value='';control(dialog,'websiteURL').dispatchEvent(new w.Event('input'));
    finishPreferences({websiteURL:'https://remembered.example',targetLanguage:'Esperanto'});await loading;
    assert.equal(control(dialog,'websiteURL').value,'');assert.equal(control(dialog,'targetLanguage').value,'한국어');assert.equal(control(dialog,'targetLanguageCustom').value,'');
  }finally{w.close();}
});

test('edited website is sanitized in prompt, clears mismatched metadata, validates invalid addresses and never persists URL',async()=>{
  const dom=setup(),w=dom.window;let copied,saved;
  Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text=>{copied=text;}}});
  const context=text=>JSON.parse(text.split(w.TextPatchI18n.t('current_page_context_separate_from_table_capture_sources'))[1].split('\n\n')[0]);
  try{
    const dialog=await w.TextPatchAIUI.open({table,page:{url:'https://original.example/page',title:'Original title',language:'ja'},savePreferences:p=>{saved=p;}}),$=name=>control(dialog,name);
    $('targetLanguage').value='English';await $('copy').onclick();
    assert.deepEqual(context(copied),{url:'https://original.example/page',title:'Original title',language:'ja'});
    $('websiteURL').value='https://user:password@edited.example/page?q=private#secret';$('websiteURL').dispatchEvent(new w.Event('input'));
    await $('copy').onclick();assert.deepEqual(context(copied),{url:'https://edited.example/page',title:'',language:''});
    assert.doesNotMatch(copied,/Original title|password|q=private|#secret/);assert.equal('websiteURL' in saved,false);assert.equal('page' in saved,false);
    for(const url of ['ftp://invalid.example','example.com','https://']){
      copied=null;$('websiteURL').value=url;await $('copy').onclick();assert.equal(copied,null);assert.equal(w.document.activeElement,$('websiteURL'));
    }
    $('websiteURL').value='';await $('copy').onclick();assert.equal(context(copied),null);
    assert.equal(table.captureSources,undefined);
  }finally{w.close();}
});
test('one action validates then copies all rows without exposing prompt; rejection guides download',async()=>{
  const dom=setup(),w=dom.window;let saved,clipboard,calls=0;
  Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text=>{clipboard=text;calls++;}}});
  try{
    const dialog=await w.TextPatchAIUI.open({table,page:{title:'<svg onload=alert(1)>'},loadPreferences:async()=>({targetLanguage:''}),savePreferences:async value=>{saved=value;}}),$=name=>control(dialog,name);
    assert.equal(dialog.querySelector('img,svg,[data-ai=output],[data-ai=generate],[data-ai=select]'),null);
    $('targetLanguage').value='';$('targetLanguage').dispatchEvent(new w.Event('change'));
    await $('copy').onclick();assert.match($('status').textContent,/언어/);assert.equal(calls,0);
    setLanguage(dialog,'targetLanguage','Arabic');await $('copy').onclick();assert.equal(saved.targetLanguage,'Arabic');
    assert.match($('status').textContent,/405행.*복사/);assert.match(clipboard,/Arabic/);assert.match(clipboard,/<img src=x> 404/);
    w.navigator.clipboard.writeText=async()=>{throw Error('denied');};await $('copy').onclick();
    assert.match($('status').textContent,/파일 받기/);assert.equal(w.document.activeElement,$('download'));
    assert.equal(dialog.querySelector('[data-ai=output]'),null);
    $('task').value='replacement';$('task').dispatchEvent(new w.Event('input'));
    assert.equal($('targetLanguage').parentElement.hidden,true);assert.equal($('instruction').parentElement.hidden,false);
    await $('copy').onclick();assert.match($('status').textContent,/지시/);
    $('instruction').value='Shorten labels';w.navigator.clipboard.writeText=async text=>{clipboard=text;};await $('copy').onclick();assert.match(clipboard,/Shorten labels/);
    $('close').click();assert.equal(w.document.querySelector('dialog'),null);
  }finally{w.close();}
});
test('request delivery waits for durable recording and recording failure never delivers unlinked output',async()=>{
  const dom=setup(),w=dom.window;let copied,release,fail=false;
  Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text=>{copied=text;}}});
  try{
    const dialog=await w.TextPatchAIUI.open({table,recordRequest:async()=>{if(fail)throw Error('Storage failed');await new Promise(resolve=>release=resolve);return {id:'trusted-request'};}});
    const copying=control(dialog,'copy').onclick();assert.equal(copied,undefined);release();await copying;
    assert.match(copied,/"aiRequest"/);assert.match(copied,/trusted-request/);assert.match(copied,/"requestRow": "404"/);
    copied=undefined;fail=true;await control(dialog,'copy').onclick();assert.equal(copied,undefined);assert.match(control(dialog,'status').textContent,/Storage failed/);
  }finally{w.close();}
});
test('oversized request downloads one complete UTF-8 file, cleans URL and handles errors',async()=>{
  const dom=setup(),w=dom.window;let clipboardCalls=0,blob,filename,revoked;
  Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async()=>{clipboardCalls++;}}});
  w.URL.createObjectURL=value=>{blob=value;return 'blob:test';};w.URL.revokeObjectURL=value=>{revoked=value;};
  w.HTMLAnchorElement.prototype.click=function(){filename=this.download;};
  try{
    const big={...table,name:'../bad:name',entries:[{...row(0),en:'한😀'.repeat(150000),notes:'metadata'.repeat(30000)},...table.entries]};
    const dialog=await w.TextPatchAIUI.open({table:big}),$=name=>control(dialog,name);setLanguage(dialog,'targetLanguage','Esperanto');
    await $('copy').onclick();assert.equal(clipboardCalls,0);assert.match($('status').textContent,/긴 요청.*파일 받기/);
    await $('download').onclick();assert.match($('status').textContent,/전체 406행/);assert.equal(blob.type,'text/plain;charset=utf-8');
    const text=await new Promise((resolve,reject)=>{const reader=new w.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsText(blob,'UTF-8');});
    const payload=JSON.parse(text.split('--- JSON 데이터 시작 ---\n\n')[1].split('\n\n--- JSON 데이터 끝 ---')[0]);
    assert.deepEqual(payload.entries.map(e=>e.original),big.entries.map(e=>e.en));assert.equal(payload.entries[0].notes,big.entries[0].notes);
    assert.equal(filename,'ai-request-.._bad_name.txt');assert.equal(dialog.querySelector('a'),null);
    await new Promise(resolve=>w.setTimeout(resolve,1100));assert.equal(revoked,'blob:test');
    w.HTMLAnchorElement.prototype.click=function(){throw Error('blocked');};await $('download').onclick();assert.match($('status').textContent,/파일을 받지 못/);
    assert.equal($('download').disabled,false);
    w.URL.createObjectURL=()=>{throw Error('blocked');};await $('download').onclick();assert.match($('status').textContent,/다시 시도/);
  }finally{w.close();}
});
test('preferences restore free languages and instruction with usable storage failures',async()=>{
  const dom=setup(),w=dom.window;
  try{
    w.localStorage.setItem('aiRequestPreferences',JSON.stringify({task:'replacement',instruction:'keep concise',targetLanguage:'Italian'}));
    let dialog=await w.TextPatchAIUI.open({table}),$=name=>control(dialog,name);
    assert.equal($('task').value,'replacement');assert.equal($('instruction').value,'keep concise');
    await $('copy').onclick();assert.equal(JSON.parse(w.localStorage.getItem('aiRequestPreferences')).instruction,'keep concise');
    dialog=await w.TextPatchAIUI.open({table,loadPreferences:async()=>{throw Error('blocked');},savePreferences:async()=>{throw Error('blocked');}});
    assert.equal(w.document.querySelectorAll('dialog').length,1);assert.match($('status').textContent,/불러오지/);
    assert.equal($('sourceLanguage').value,'auto');assert.ok([...$('targetLanguage').options].some(o=>o.value==='English'));
    setLanguage(dialog,'targetLanguage','Esperanto');await $('copy').onclick();assert.match($('status').textContent,/파일 받기.*기억에 실패/);
    assert.equal($('copy').disabled,false);
  }finally{w.close();}
});

test('late clipboard and preference results do not overwrite edited or reopened dialog state',async()=>{
  const dom=setup(),w=dom.window;let finishCopy,finishSave,saves=0;
  Object.defineProperty(w.navigator,'clipboard',{value:{writeText:()=>new Promise(resolve=>{finishCopy=resolve;})}});
  try{
    let dialog=await w.TextPatchAIUI.open({table,savePreferences:()=>{saves++;}}),$=name=>control(dialog,name);
    setLanguage(dialog,'targetLanguage','French');const copying=$('copy').onclick();
    setLanguage(dialog,'targetLanguage','German');$('targetLanguageCustom').dispatchEvent(new w.Event('input'));
    finishCopy();await copying;assert.equal(saves,0);assert.match($('status').textContent,/빈 대체문 405행 전체/);
    w.navigator.clipboard.writeText=async()=>{};
    dialog=await w.TextPatchAIUI.open({table,savePreferences:()=>new Promise((resolve,reject)=>{finishSave=reject;})});
    setLanguage(dialog,'targetLanguage','French');const saving=$('copy').onclick();
    while(!finishSave)await new Promise(resolve=>w.setTimeout(resolve,0));
    $('task').value='replacement';$('task').dispatchEvent(new w.Event('input'));
    finishSave(Error('blocked'));await saving;assert.doesNotMatch($('status').textContent,/기억에 실패/);
    w.navigator.clipboard.writeText=()=>new Promise(resolve=>{finishCopy=resolve;});
    $('instruction').value='shorten';const closing=$('copy').onclick();$('close').click();
    dialog=await w.TextPatchAIUI.open({table});const initial=$('status').textContent;
    finishCopy();await closing;assert.equal($('status').textContent,initial);
  }finally{w.close();}
});
