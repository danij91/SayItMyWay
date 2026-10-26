import {toggleDraftName,hasDraftName} from './editor-draft-helpers.mjs';
import {loadKorean} from './i18n-harness.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,copyFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from '../server.mjs';
import {JSDOM} from 'jsdom';
const read=file=>readFile(new URL('../'+file,import.meta.url),'utf8');
const tick=()=>new Promise(r=>setTimeout(r,0));

async function manager(t,search=''){
  const dom=new JSDOM(await read('extension/manager.html'),{url:'https://extension.test/manager.html'+search,runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  const calls=[];
  dom.window.fetch=async url=>{calls.push(String(url));return {ok:true};};
  loadKorean(dom.window);dom.window.eval(await read('extension/manager.js'));await tick();
  return {window:dom.window,doc:dom.window.document,calls};
}
test('manager routes fixed editor table links and ignores obsolete site view without network',async t=>{
  for(const search of ['?table=sample&url=https://evil.test','?view=sites']){
    const {doc,calls}=await manager(t,search);
    const editor=doc.querySelector('#table-frame');
    assert.equal(editor.src,'https://extension.test/editor/index.html?embedded=1'+(search.includes('sample')?'&table=sample':''));
    assert.equal(editor.hidden,false);assert.equal(doc.querySelector('#sites-tab,#sites-frame,[role=tablist]'),null);
    assert.equal(doc.title,'SayItMyWay \u00b7 '+doc.defaultView.TextPatchI18n.t('manage_tables'));assert.equal(editor.title,doc.defaultView.TextPatchI18n.t('edit_table_2'));
    assert.deepEqual(calls,[]);
  }
});

async function editor(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'manager-admin-'));
  const dataPath=path.join(dir,'dictionary.json');await copyFile(new URL('../extension/data/dictionary.json',import.meta.url),dataPath);
  const server=await createServer({dataPath});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  const initial=await(await fetch(base+'/api/library')).json();
  initial.tables[0].captureSources=[{url:'https://example.test/source',title:'Source',language:'en',capturedAt:'2026-10-20T00:00:00Z'}];
  initial.custom={keep:true};initial.tables[0].custom={table:true};initial.tables[0].entries[0].custom={row:true};initial.tables[0].defaults.custom='keep';initial.tables[0].entries[0].matchMode='word';initial.tables[0].entries[0].caseSensitive=true;
  await fetch(base+'/api/library',{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(initial)});
  const d=new JSDOM(await(await fetch(base)).text(),{url:base,runScripts:'outside-only'}),w=d.window;
  t.after(async()=>{w.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const puts=[];
  w.structuredClone=structuredClone;w.TextEncoder=TextEncoder;w.fetch=(url,options={})=>{if(options.method==='PUT')puts.push(options.body);return fetch(new URL(url,base),{...options,headers:{...options.headers,...(options.method?{Origin:base}:{})}});};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const ai=[];w.TextPatchAIUI={open:args=>ai.push(args)};
  loadKorean(w);for(const file of ['extension/shared.js','extension/library.js','extension/editor/import.js','extension/editor/transport.js','extension/import-ui.js','extension/editor/app.js'])w.eval(await read(file));
  const $=s=>w.document.querySelector(s);
  const until=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('UI timeout');};
  await until(()=>$('#rows').children.length>0);
  return {w,$,ai,until,initial,puts,get:async()=>await(await fetch(base+'/api/library')).json()};
}
test('table editor shows three columns, opens shared AI and preserves protected metadata with matching controls removed',async t=>{
  const {$,w,ai,until,initial,get}=await editor(t);
  assert.deepEqual([...w.document.querySelectorAll('thead th')].map(el=>el.textContent),['원문','바꿀 텍스트','편집']);
  assert.equal($('#excluded-terms'),null);assert.equal($('#excluded-categories'),null);
  $('#ai-request').click();await tick();assert.equal(ai[0].table.id,'crimson-desert');
  assert.equal($('#table-description'),null);assert.equal($('#defaults-save'),null);
  assert.equal($('#defaults-placeholder'),null);
  assert.equal($('#defaults-match'),null);assert.equal($('#defaults-case'),null);
  $('#table-rename').click();$('#table-name').value='Renamed';$('#table-form').dispatchEvent(new w.Event('submit',{cancelable:true}));
  assert.equal((await get()).tables[0].defaults.matchMode,'exact');
  await $('#save-all').onclick();
  const saved=(await get()).tables[0];
  assert.equal(saved.description,initial.tables[0].description);
  assert.deepEqual(saved.excludedTerms,initial.tables[0].excludedTerms);
  assert.deepEqual(saved.excludedCategories,initial.tables[0].excludedCategories);
  assert.deepEqual(saved.captureSources,initial.tables[0].captureSources);
  assert.deepEqual(saved.entries,initial.tables[0].entries);
});
test('row edit, rename and copy preserve legacy exclusions, sources and verification evidence',async t=>{
  const {$,w,until,initial,get}=await editor(t);
  $('#rows button').click();const form=$('#form');
  form.elements.ko.value='편집한 대체문';form.dispatchEvent(new w.Event('submit',{cancelable:true}));
  await until(()=>!$('#editor').open);
  $('#table-rename').click();$('#table-name').value='이름 수정';$('#table-form').dispatchEvent(new w.Event('submit',{cancelable:true}));
  await until(()=>!$('#table-editor').open);
  $('#table-copy').click();$('#table-name').value='복사 표';$('#table-form').dispatchEvent(new w.Event('submit',{cancelable:true}));
  await until(()=>$('#table-select').options.length===2);
  await $('#save-all').onclick();
  for(const table of (await get()).tables){
    assert.deepEqual(table.excludedTerms,initial.tables[0].excludedTerms);
    assert.deepEqual(table.excludedCategories,initial.tables[0].excludedCategories);
    assert.deepEqual(table.captureSources,initial.tables[0].captureSources);
    assert.equal(table.entries[0].matchMode,'word');assert.equal(table.entries[0].caseSensitive,true);
    assert.equal(table.entries[0].source,initial.tables[0].entries[0].source);
    assert.equal(table.entries[0].evidence,initial.tables[0].entries[0].evidence);
    assert.equal(table.entries[0].status,initial.tables[0].entries[0].status);
  }
});

test('file selection drafts new tables with unique names; explicit save persists and invalid input leaves data intact',async t=>{
  const {$,w,until,get}=await editor(t),initial=await get();
  assert.equal($('#reload'),null);assert.equal($('#export-all'),null);assert.equal($('#import-target'),null);assert.equal($('#import-apply'),null);
  assert.ok($('#table-copy svg'));
  const selectFile=async text=>{
    $('#import-open').click();
    Object.defineProperty($('#import-file'),'files',{configurable:true,value:[new w.File([text],'example.json',{type:'application/json'})]});
    await $('#import-file').onchange();
  };
  const text=JSON.stringify({format:'text-patch-table',version:1,name:'Imported',entries:[{en:'<img src=x>',ko:'제안',status:'review'}]});
  await selectFile(text);assert.equal($('#import-editor').open,false,$('#import-error').textContent);
  await selectFile(text);assert.equal($('#table-select').options.length,3);
  assert.deepEqual(await get(),initial);
  await $('#save-all').onclick();
  const saved=await get();assert.deepEqual(saved.tables[0],initial.tables[0]);
  assert.deepEqual(saved.tables.slice(1).map(t=>t.name),['Imported','Imported (2)']);
  assert.notEqual(saved.tables[1].id,saved.tables[2].id);assert.notEqual(saved.tables[1].entries[0].id,saved.tables[2].entries[0].id);
  assert.equal($('#rows img'),null);for(const field of ['status','kind','context','category','source','evidence'])assert.equal(Object.hasOwn(saved.tables[1].entries[0],field),false);
  await selectFile('{');assert.ok($('#import-error').textContent);assert.equal($('#import-editor').open,true);
  assert.deepEqual(await get(),saved);$('#import-cancel').click();
  $('#table-create').click();$('#table-name').value='Imported';$('#table-form').dispatchEvent(new w.Event('submit',{cancelable:true}));
  await until(()=>!$('#table-editor').open);assert.equal($('#table-select').selectedOptions[0].textContent,'Imported (3)');
  $('#table-copy').click();$('#table-name').value='Imported';$('#table-form').dispatchEvent(new w.Event('submit',{cancelable:true}));
  await until(()=>!$('#table-editor').open);assert.equal($('#table-select').selectedOptions[0].textContent,'Imported (4)');
});

test('settings revert cleanly and edited dialogs warn on unload without writing',async t=>{
  const {$,w,puts}=await editor(t);
  const warns=()=>{const e=new w.Event('beforeunload',{cancelable:true});w.dispatchEvent(e);return e.defaultPrevented;};
  assert.equal($('#save-all').disabled,true);assert.equal(warns(),false);
  toggleDraftName(w);assert.equal($('#save-all').disabled,false);assert.equal(warns(),true);
  toggleDraftName(w);assert.equal($('#save-all').disabled,true);assert.equal(warns(),false);
  for(const [open,form,input,cancel] of [['#add','#form','[name=en]','#cancel'],['#table-rename','#table-form','#table-name','#table-cancel']]){
    $(open).click();assert.equal(warns(),false);
    $(form).querySelector(input).value='Unconfirmed text';$(form).dispatchEvent(new w.Event('input',{bubbles:true}));
    assert.equal(warns(),true);assert.match($('#save-state').textContent,/저장되지 않음/);
    $(cancel).click();assert.equal(warns(),false);
  }
  assert.equal(puts.length,0);
});

test('initial load failure exposes retry and retry loads without writing',async t=>{
  const dom=new JSDOM(await read('extension/editor/index.html'),{url:'http://localhost/',runScripts:'outside-only'}),w=dom.window;
  t.after(()=>w.close());w.structuredClone=structuredClone;w.fetch=async()=>{throw Error('offline');};
  loadKorean(w);for(const file of ['extension/shared.js','extension/library.js','extension/editor/transport.js','extension/import-ui.js','extension/editor/app.js'])w.eval(await read(file));
  await tick();assert.equal(w.document.querySelector('#load-retry').hidden,false);
  const data=w.TextPatch.migrate(JSON.parse(await read('extension/data/dictionary.json')));
  w.fetch=async()=>({ok:true,json:async()=>data});await w.document.querySelector('#load-retry').onclick();
  assert.equal(w.document.querySelector('#load-retry').hidden,true);assert.equal(w.document.querySelector('#save-all').disabled,true);
  assert.equal(w.document.querySelectorAll('#rows tr').length,147);
});

test('all editor mutations stay in drafts across navigation and persist only on top save',async t=>{
  const {$,w,puts,get,initial}=await editor(t),before=await get();
  $('#rows button').click();$('#form').elements.ko.value='Draft replacement';
  $('#form').dispatchEvent(new w.Event('submit',{cancelable:true}));
  toggleDraftName(w);
  $('#table-copy').click();$('#table-name').value='Draft copy';$('#table-form').dispatchEvent(new w.Event('submit',{cancelable:true}));
  const copyId=$('#table-select').value;
  $('#table-rename').click();$('#table-name').value='Renamed copy';$('#table-form').dispatchEvent(new w.Event('submit',{cancelable:true}));
  w.confirm=()=>true;$('#rows button[data-delete]').click();
  $('#table-create').click();$('#table-name').value='Draft new';$('#table-form').dispatchEvent(new w.Event('submit',{cancelable:true}));
  $('#add').click();$('#form').elements.en.value='Draft added';$('#form').dispatchEvent(new w.Event('submit',{cancelable:true}));
  $('#table-select').value=initial.tables[0].id;$('#table-select').onchange();assert.match($('#rows').textContent,/Draft replacement/);
  $('#query').value='Draft replacement';$('#query').dispatchEvent(new w.Event('input'));assert.equal($('#rows tr').parentElement.children.length,1);
  $('#table-select').value=copyId;$('#table-select').onchange();assert.equal($('#rows tr').parentElement.children.length,146);
  assert.equal(puts.length,0);assert.deepEqual(await get(),before);
  await $('#save-all').onclick();assert.equal(puts.length,1);assert.equal($('#save-all').disabled,true);
  const saved=await get();assert.equal(saved.tables.length,3);assert.equal(saved.tables[0].entries[0].ko,'Draft replacement');assert.equal(saved.tables[1].name,'Renamed copy');assert.equal(saved.tables[2].entries[0].en,'Draft added');
  assert.deepEqual(saved.custom,initial.custom);assert.deepEqual(saved.tables[0].custom,initial.tables[0].custom);assert.deepEqual(saved.tables[0].entries[0].custom,initial.tables[0].entries[0].custom);assert.equal(saved.tables[0].defaults.custom,'keep');assert.equal(saved.tables[0].description,initial.tables[0].description);
});

test('network failure retains draft; saving locks mutation controls and explicit retry persists it',async t=>{
  const {$,w,puts,get}=await editor(t),before=await get(),realFetch=w.fetch;
  toggleDraftName(w);w.fetch=async()=>{throw Error('Network failure');};
  await $('#save-all').onclick();assert.match($('#save-state').textContent,/저장 실패/);assert.equal(hasDraftName(w),true);assert.deepEqual(await get(),before);
  let release;const gate=new Promise(r=>release=r);w.fetch=async(...args)=>{await gate;return realFetch(...args);};
  const saving=$('#save-all').onclick();assert.match($('#save-state').textContent,/저장 중/);
  for(const id of ['#add','#table-create','#table-select','#table-rename','#import-open','#save-all'])assert.equal($(id).disabled,true,id);
  toggleDraftName(w);$('#add').click();assert.equal(hasDraftName(w),true);assert.equal($('#editor').open,false);
  release();await saving;assert.equal(puts.length,1);assert.equal((await get()).tables[0].name.endsWith(' draft'),true);assert.equal($('#save-all').disabled,true);
});

test('drop validation rejects multiple, non JSON, oversized, invalid and failed reads; valid drop preserves prior draft',async t=>{
  const {$,w,puts,get,until}=await editor(t),before=await get();
  toggleDraftName(w);$('#import-open').click();
  const drop=files=>{const e=new w.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(e,'dataTransfer',{value:{files}});$('#import-dropzone').dispatchEvent(e);assert.equal(e.defaultPrevented,true);};
  const file=(text,name='test.json')=>new w.File([text],name,{type:'application/json'});
  const valid=file(JSON.stringify({format:'text-patch-table',version:1,name:'Dropped',entries:[{en:'Dropped text',ko:'',status:'untranslated'}]}));
  for(const files of [[valid,valid],[file('{}','bad.txt')],[{name:'large.json',size:5_000_001}],[file('{')]]){
    drop(files);await until(()=>!$('#import-file').disabled);assert.ok($('#import-error').textContent);assert.equal(hasDraftName(w),true);assert.equal($('#table-select').options.length,1);
  }
  const Reader=w.FileReader;w.FileReader=class{readAsText(){queueMicrotask(()=>this.onerror());}};
  drop([valid]);await until(()=>!$('#import-file').disabled);assert.match($('#import-error').textContent,/읽지/);w.FileReader=Reader;
  drop([valid]);await until(()=>!$('#import-editor').open);assert.equal($('#table-select').options.length,2);assert.equal(puts.length,0);assert.deepEqual(await get(),before);
  await $('#save-all').onclick();const saved=await get();assert.equal(saved.tables[0].name.endsWith(' draft'),true);assert.equal(saved.tables[1].entries[0].en,'Dropped text');assert.equal(puts.length,1);
});

test('in-flight import blocks top save and retains draft edits made while file is read',async t=>{
  const {$,w,puts,until,get}=await editor(t),Reader=w.FileReader;
  let finish;w.FileReader=class{readAsText(){finish=()=>{this.result=JSON.stringify({format:'text-patch-table',version:1,name:'Delayed',entries:[]});this.onload();};}};
  $('#import-open').click();Object.defineProperty($('#import-file'),'files',{value:[new w.File(['x'],'delayed.json')]});
  const reading=$('#import-file').onchange();toggleDraftName(w);
  assert.equal($('#save-all').disabled,true);await $('#save-all').onclick();assert.equal(puts.length,0);
  finish();await reading;w.FileReader=Reader;assert.equal($('#save-all').disabled,false);
  await $('#save-all').onclick();assert.equal((await get()).tables[0].name.endsWith(' draft'),true);
});

async function sites(t){
  const dom=new JSDOM(await read('extension/options.html'),{url:'https://extension.test/options.html?embedded=1',runScripts:'outside-only'}),w=dom.window;
  t.after(()=>w.close());w.structuredClone=structuredClone;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  loadKorean(w);for(const file of ['extension/shared.js','extension/library.js'])w.eval(await read(file));
  let state={enabled:true,originEnabled:{'https://example.test':false},library:{tables:[{id:'one',name:'First'},{id:'two',name:'Second'}]},rules:[
    {id:'site',origin:'https://example.test',scope:'site',path:'/',tableId:'one',enabled:true},
    {id:'prefix',origin:'https://example.test',scope:'prefix',path:'/docs',tableId:'two',enabled:false},
    {id:'page',origin:'https://example.test',scope:'page',path:'/docs',tableId:'one',enabled:true}
  ]};
  const calls=[];let listener;
  w.chrome={storage:{onChanged:{addListener:fn=>listener=fn}},runtime:{sendMessage:async message=>{
    calls.push(message);
    if(message.type==='pageState'){
      const rule=w.TextPatch.selectRule(state.rules,message.url);
      return {rule,enabled:!!rule&&(state.originEnabled[rule.origin]??state.enabled)&&rule.enabled,missingPermission:false};
    }
    if(message.type==='toggleSite'){
      state.originEnabled[new URL(message.url).origin]=message.enabled;
      if(message.enabled)w.TextPatch.selectRule(state.rules,message.url).enabled=true;
    }
    if(message.type==='saveRule'){
      state.rules[state.rules.findIndex(r=>r.id===message.rule.id)]=message.rule;
      if(message.activateSite)state.originEnabled[message.rule.origin]=true;
    }
    if(message.type==='refresh'){state.library.tables.push({id:'fresh',name:'Fresh'});return {notice:'최신 대응표를 불러왔습니다.'};}
    return structuredClone(state);
  }}};
  w.eval(await read('extension/site-list.js'));w.eval(await read('extension/options.js'));await tick();await tick();
  return {w,doc:w.document,calls,state,changed:()=>listener({libraryRevision:{newValue:2}},'local')};
}
test('site effective checkbox matches origin and rule state; scoped toggle targets its own matching URL',async t=>{
  const {doc,calls,state}=await sites(t);
  const rows=[...doc.querySelectorAll('#rules tr')];
  assert.equal(rows.length,3);
  assert.equal(rows[0].querySelector('input[type=checkbox]').checked,false);
  rows[1].querySelector('input[type=checkbox]').click();await tick();await tick();
  const toggle=calls.find(m=>m.type==='toggleSite');
  assert.equal(toggle.enabled,true);assert.notEqual(toggle.url,'https://example.test/docs');
  assert.equal(state.rules[1].enabled,true);
  assert.equal(doc.querySelector('#rules tr input[type=checkbox]').checked,true);
});
test('site dropdown autosaves while preserving paused origin, disabled rule and exact scope',async t=>{
  const {doc,w,calls,changed,state}=await sites(t);
  const select=doc.querySelectorAll('#rules select')[1];
  assert.ok(select);select.value='one';select.dispatchEvent(new w.Event('change'));await tick();await tick();
  const save=calls.find(m=>m.type==='saveRule');assert.notEqual(save.activateSite,true);
  assert.deepEqual({...save.rule},{id:'prefix',origin:'https://example.test',scope:'prefix',path:'/docs',tableId:'one',enabled:false});
  assert.equal(state.originEnabled['https://example.test'],false);
  assert.equal(doc.querySelector('#refresh'),null);assert.equal(doc.querySelector('#bundle'),null);
  assert.ok(doc.querySelector('#rules .site-settings-button svg'));
  assert.equal(doc.querySelectorAll('#rules tr')[1].querySelector('a').href,'https://example.test/docs');
  state.library.tables.push({id:'external',name:'External'});changed();await tick();await tick();
  assert.ok([...doc.querySelector('#rules select').options].some(o=>o.value==='external'));
});

test('completely shadowed site rule explains its inactive checkbox and never toggles a different rule',async t=>{
  const {doc,calls,state,changed}=await sites(t);
  state.rules[1].path='/';state.originEnabled['https://example.test']=true;changed();await tick();await tick();
  const row=doc.querySelector('#rules tr'),check=row.querySelector('input[type=checkbox]');
  assert.equal(check.checked,false);assert.equal(check.disabled,true);assert.match(check.title,/다른 규칙/);
  check.click();await tick();assert.equal(calls.some(m=>m.type==='toggleSite'),false);
});
