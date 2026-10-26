import {loadKorean} from './i18n-harness.mjs';
﻿import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const source=f=>readFile(new URL('../extension/'+f,import.meta.url),'utf8');
const tick=()=>new Promise(r=>setTimeout(r,0));
const session=(extra={})=>({tableId:'b',tableName:'Collected',url:'https://example.com/docs/a',active:false,firstSaved:163,additionalSaved:8,saved:171,total:171,pending:[],originals:['<img src=x>'],error:'',...extra});
async function popup(t,{page={},collection=null,report={},failure=false,offlineRefresh=false}={}){
 const d=new JSDOM(await source('popup.html'),{runScripts:'outside-only'});t.after(()=>d.window.close());
 d.window.TextEncoder=TextEncoder;
 const calls=[];let changed,allow=true,requested=0;
 loadKorean(d.window);d.window.eval(await source('shared.js'));d.window.eval(await source('library.js'));d.window.eval(await source('editor/import.js'));
 const template=d.window.TextPatch.migrate(JSON.parse(await source('data/dictionary.json'))).tables[0];
 const tables=[{...template,id:'a',name:'Applied A'},{...template,id:'b',name:'Collected'}];
 const state={enabled:true,includeReview:false,library:{schemaVersion:2,revision:1,tables},page:{enabled:true,table:tables[0],rule:{id:'rule',origin:'https://example.com',scope:'prefix',path:'/docs',tableId:'a',enabled:true},...page}};
 const h={state,calls,collection,report, failure};
 state.rules=[state.page.rule].filter(Boolean);
 d.window.chrome={runtime:{getURL:p=>'chrome-extension://test/'+p,sendMessage:async m=>{
  calls.push(m);
  if(m.type==='pageState')return state.page;
  if(m.type==='refresh' && offlineRefresh)return {...state,offline:true,notice:'새로고침 실패: offline. 마지막 정상 대응표를 유지합니다.'};
  if(m.type==='collectionState')return {collection:h.collection};
  if(m.type==='collectionBegin'){h.collection=session({active:true,firstSaved:163,additionalSaved:0,saved:163});return {collection:h.collection};}
  if(m.type==='collectionWatch')h.collection={...h.collection,active:true};
  if(m.type==='collectionStop')h.collection={...h.collection,active:false};
  if(m.type==='collectionRetry')h.collection=session();
  if(m.type.startsWith('collection'))return {collection:h.collection};
  if(m.type==='activateSite'){requested++;state.page.enabled=allow;}
  if(m.type==='toggleSite')state.page.enabled=m.enabled;
  if(m.type==='selectTable')state.page={...state.page,table:tables.find(t=>t.id===m.tableId),rule:{...(state.page.rule || {origin:'https://example.com',scope:'site',path:'/',enabled:false}),tableId:m.tableId}};
  if(m.type==='saveRule'){state.page={enabled:true,rule:m.rule,table:tables.find(t=>t.id===m.rule.tableId)};}
  return state;
 }},permissions:{request:({origins})=>{requested++;assert.equal(origins[0],'https://example.com/*');return Promise.resolve(allow);}},
 tabs:{query:async()=>[{id:7,url:'https://example.com/docs/a'}],sendMessage:async()=>{
  if(h.failure)throw Error('No receiver');
  return {enabled:state.page.enabled,tableId:state.page.table?.id,translated:12,...h.report};
 }},storage:{local:{get:async()=>({aiRequestPreferences:{task:'replacement'}}),set:async value=>h.preferences=value},onChanged:{addListener:fn=>changed=fn}}};
 d.window.eval(await source('library.js'));d.window.eval(await source('site-list.js'));d.window.eval(await source('popup.js'));await tick();await tick();
 return Object.assign(h,{$:id=>d.window.document.getElementById(id),doc:d.window.document,d,requested:()=>requested,allow:v=>allow=v,changed});
}
test('idle popup exposes site application, selected table AI, capture and discreet settings',async t=>{
 const h=await popup(t),{$,doc}=h;
 assert.equal($('sites-list').open,false);assert.equal(doc.querySelector('#sites-list summary').textContent,'적용 사이트');
 assert.equal($('enabled').checked,true);assert.match($('page-status').textContent,/12곳 교체됨/);
 assert.equal($('table').value,'a');assert.equal($('table-edit').href,'chrome-extension://test/manager.html?table=a');
 for(const id of ['collection-status','collection-result-edit','collection-watch','collection-retry'])assert.equal($(id).hidden,true,id);
 for(const id of ['change','apply','chooser'])assert.equal($(id),null,id);
 assert.equal($('capture').textContent,h.d.window.TextPatchI18n.t('capture_new'));
 for(const id of ['scope','path','unlink','inspection','inspection-log','collection-name','collection-new','collection-edit','refresh'])assert.equal($(id),null,id);
 assert.doesNotMatch(doc.body.textContent,/작업할 대응표|공통 적용|불러온 시간|JSON|기존 표/);
 assert.equal($('options').href,'chrome-extension://test/manager.html');
 assert.equal($('include-review'),null);assert.equal(doc.querySelector('[data-i18n=include_drafts_in_review]'),null);
 assert.equal(h.calls.some(m=>m.type==='setReview'),false);
 $('enabled').click();await tick();assert.equal(h.calls.findLast(m=>m.type==='toggleSite').url,'https://example.com/docs/a');
});

test('closed popup list does not query saved sites; opening loads rows and refresh preserves expansion',async t=>{
 const h=await popup(t),{$}=h;
 assert.equal(h.calls.some(m=>m.type==='pageState'),false);
 $('sites-list').open=true;await tick();await tick();
 assert.equal(h.calls.some(m=>m.type==='pageState'),true);
 assert.equal($('rules').querySelectorAll('select').length,1);
 h.changed({rules:{newValue:h.state.rules}},'local');await tick();await tick();
 assert.equal($('sites-list').open,true);
 $('sites-list').open=false;await tick();const count=h.calls.filter(m=>m.type==='pageState').length;
 h.changed({libraryRevision:{newValue:2}},'local');await tick();await tick();
 assert.equal(h.calls.filter(m=>m.type==='pageState').length,count);assert.equal($('sites-list').open,false);
});
test('visible table selection saves immediately without permission, keeps scope and OFF state',async t=>{
 const h=await popup(t,{page:{enabled:false}}),{$}=h;
 $('table').value='b';$('table').dispatchEvent(new h.d.window.Event('change'));await tick();
 assert.equal(h.requested(),0);assert.equal(h.calls.find(m=>m.type==='selectTable').tableId,'b');
 assert.equal(h.state.page.rule.scope,'prefix');assert.equal(h.state.page.rule.path,'/docs');assert.equal(h.state.page.rule.id,'rule');
 assert.equal($('enabled').checked,false);assert.equal($('table').value,'b');
});
test('no-table state stays unchecked and offers table selection without false activity',async t=>{
 const h=await popup(t,{page:{enabled:false,table:null,rule:null}}),{$}=h;
 assert.equal($('enabled').checked,false);assert.equal($('enabled').disabled,true);
 assert.equal($('table').value,'');assert.equal($('table-edit').hidden,true);
 $('table').value='b';$('table').dispatchEvent(new h.d.window.Event('change'));await tick();
 assert.equal(h.state.page.rule.scope,'site');assert.equal($('enabled').checked,false);
});
for(const config of [{page:{missingPermission:true}},{failure:true},{report:{error:'engine failed'}},{report:{enabled:false}},{report:{tableId:'stale'}},{page:{enabled:false}}]){
 test('saved checkbox reflects effective stored state while diagnostics failures never claim applying '+JSON.stringify(config),async t=>{
  const {$}=await popup(t,config);assert.equal($('enabled').checked,config.page?.enabled!==false && !config.page?.missingPermission);assert.doesNotMatch($('page-status').textContent,/적용 중/);
 });
}
test('one-click capture uses a new destination independent of applied table and reports first/extra counts',async t=>{
 const h=await popup(t),{$}=h;
 $('capture').click();await tick();await tick();
 const begin=h.calls.find(m=>m.type==='collectionBegin');
 assert.deepEqual(Object.keys(begin).sort(),['tabId','type']);assert.equal(begin.tabId,7);
 assert.equal($('table').value,'a');assert.match($('collection-status').textContent,/163개 수집 · 0개 추가/);
 assert.equal($('collection-result-edit').href,'chrome-extension://test/manager.html?table=b');assert.equal($('collection-retry').hidden,true);
 assert.equal($('collection-result-edit').hidden,true);assert.match($('collection-watch').textContent,/수집 완료/);assert.equal($('capture').hidden,true);
 assert.equal(h.calls.filter(m=>m.type==='saveRule').length,0);
 h.changed({collections:{newValue:{7:session({active:true})}}},'local');
 assert.match($('collection-status').textContent,/171개 수집 · 8개 추가/);
 assert.equal(h.doc.querySelector('img'),null);assert.doesNotMatch(h.doc.body.textContent,/<img/);
 // Stop remains usable even if the saved table disappeared.
 h.state.library={schemaVersion:2,revision:2,tables:[]};h.state.page.table=null;h.state.page.enabled=false;h.changed({libraryRevision:{newValue:2}},'local');await tick();
 assert.equal($('collection-result-edit').hidden,true);
 assert.equal($('enabled').checked,false);assert.equal($('table').value,'');
 assert.equal($('collection-watch').disabled,false);$('collection-watch').click();await tick();assert.equal(h.calls.some(m=>m.type==='collectionStop'),true);
 assert.equal($('collection-watch').hidden,true);
});

test('turning this site on requests permission inside gesture, denial stays truthful',async t=>{
 const h=await popup(t,{page:{enabled:false}}),{$}=h;
 h.allow(false);$('enabled').click();assert.equal(h.requested(),1);await tick();
 assert.equal($('enabled').checked,false);assert.equal(h.calls.some(m=>m.type==='toggleSite'),false);
 h.allow(true);$('enabled').click();assert.equal(h.requested(),2);await tick();
 assert.equal($('enabled').checked,true);assert.equal(h.calls.find(m=>m.type==='activateSite').tableId,'a');
 assert.equal($('status').hidden,true);assert.doesNotMatch($('status').textContent,/확인 중/);
});

test('initial capture shows immediate progress before deferred background save',async t=>{
 const h=await popup(t),{$}=h;
 const send=h.d.window.chrome.runtime.sendMessage;let finish;
 h.d.window.chrome.runtime.sendMessage=m=>m.type==='collectionBegin'?new Promise(resolve=>finish=resolve):send(m);
 $('capture').click();
 assert.equal($('capture').disabled,true);assert.match($('capture').textContent,/저장 중/);assert.equal($('collection-status').hidden,false);assert.match($('collection-status').textContent,/저장 중/);
 finish({collection:session()});await tick();assert.match($('collection-status').textContent,/171개 수집/);
});
test('pending failure alone reveals retry, keeps stop available, and success hides retry',async t=>{
 const h=await popup(t,{collection:session({active:true,error:'offline',pending:['Pending']})}),{$}=h;
 assert.equal($('collection-retry').hidden,false);assert.equal($('capture').hidden,true);assert.equal($('collection-watch').disabled,false);
 assert.match($('collection-status').textContent,/보존한 미저장 원문: 1/);
 $('collection-retry').click();await tick();assert.equal($('collection-retry').hidden,true);assert.match($('collection-status').textContent,/171개 수집/);
});
test('reopening restores collected or pending-create session without a naming or table selection gate',async t=>{
 for(const c of [session(),session({firstSaved:null,saved:0,needsCreate:true,createName:'Pending table',error:'offline',pending:['Pending']})]){
  const h=await popup(t,{collection:c}),{$}=h;
  assert.equal($('table').value,'a');
  assert.equal($('collection-retry').hidden,!c.error);
  assert.equal($('collection-result-edit').hidden,!!c.needsCreate);
  if(c.needsCreate){assert.equal($('capture').disabled,true);assert.equal($('collection-watch').hidden,true);}
 }
});

test('opening refreshes DB and revision events rebuild options from the saved association',async t=>{
 const h=await popup(t),{$}=h;
 assert.equal(h.calls.some(m=>m.type==='refresh'),true);
 const library={...h.state.library,revision:2,tables:[{...h.state.library.tables[0],name:'Renamed A'},h.state.library.tables[1],{...h.state.library.tables[0],id:'c',name:'Server C'}]};
 h.state.library=library;h.state.page.table=library.tables[0];h.changed({libraryRevision:{newValue:2}},'local');await tick();
 assert.deepEqual(Array.from($('table').options,o=>o.textContent),[h.d.window.TextPatchI18n.t('select_a_table'),'Renamed A','Collected','Server C']);
 assert.equal($('table').value,'a');
 h.changed({library:{newValue:{broken:true}}},'local');
 assert.equal($('table').options.length,4);assert.equal($('table').value,'a');
});

test('offline table refresh keeps the usable cached selection and explains the failure',async t=>{
 const h=await popup(t,{offlineRefresh:true}),{$}=h;
 assert.match($('status').textContent,/마지막 정상/);
 $('table').value='b';$('table').dispatchEvent(new h.d.window.Event('change'));await tick();
 assert.equal($('table').value,'b');assert.equal($('table').disabled,false);
});

test('selected table AI is independent before, during and after capture; completion restores new and append',async t=>{
 const h=await popup(t),{$}=h;
 let args;h.d.window.TextPatchAIUI={open:async value=>args=value};
 assert.equal($('table-ai').hidden,false);assert.equal($('table-ai').disabled,false);
 $('table-ai').click();await tick();assert.equal(args.table.id,'a');
 assert.equal($('capture-append').hidden,false);
 $('capture-append').click();await tick();await tick();
 const begin=h.calls.find(m=>m.type==='collectionBegin');assert.equal(begin.mode,'append');assert.equal(begin.tableId,'a');
 assert.equal($('capture').hidden,true);assert.equal($('capture-append').hidden,true);
 assert.equal($('table-ai').disabled,false);assert.match($('collection-status').textContent,/Collected/);
 $('table-ai').click();await tick();assert.equal(args.table.id,'a');
 $('table').value='b';$('table').dispatchEvent(new h.d.window.Event('change'));await tick();
 $('table-ai').click();await tick();assert.equal(args.table.id,'b');
 assert.equal((await args.loadPreferences()).task,'replacement');
 await args.savePreferences({task:'translation',targetLanguage:'ja'});assert.equal(h.preferences.aiRequestPreferences.targetLanguage,'ja');
 $('collection-watch').click();await tick();
 for(const id of ['collection-result-edit','table-ai','capture','capture-append'])assert.equal($(id).hidden,false,id);
 assert.equal($('collection-watch').hidden,true);
 assert.equal($('collection-ai'),null);assert.equal($('collection-again'),null);
 $('capture').click();await tick();assert.equal(h.calls.filter(m=>m.type==='collectionBegin').length,2);
});

test('without selection only new capture is available while AI clearly requires a table',async t=>{
 const h=await popup(t,{page:{enabled:false,table:null,rule:null}}),{$}=h;
 assert.equal($('capture').hidden,false);assert.equal($('capture').disabled,false);
 assert.equal($('capture-append').hidden,true);assert.equal($('table-ai').hidden,false);assert.equal($('table-ai').disabled,true);
 assert.equal($('table-ai').title,h.d.window.TextPatchI18n.t('select_a_table'));
});

test('AI stays available for the selected table while another capture has unsaved pending originals',async t=>{
 const h=await popup(t,{collection:session({active:true,error:'offline',pending:['Pending original']})});
 let args;h.d.window.TextPatchAIUI={open:async value=>args=value};
 assert.equal(h.$('table-ai').disabled,false);h.$('table-ai').click();await tick();
 assert.equal(args.table.id,'a');assert.equal(h.$('collection-retry').hidden,false);
 h.$('collection-watch').click();await tick();
 assert.equal(h.$('capture').hidden,false);assert.equal(h.$('capture').disabled,true);
 assert.equal(h.$('capture-append').hidden,false);assert.equal(h.$('capture-append').disabled,true);
 assert.equal(h.$('table-ai').disabled,false);
});

test('all fifteen popup locales translate independent controls and fixed destination without changing selection',async t=>{
 const h=await popup(t,{collection:session({active:true})}),w=h.d.window;
 for(const locale of Object.keys(w.TextPatchI18n.languages))if(!['ko','en'].includes(locale))w.eval(await source('locales/'+locale+'.js'));
 const original=JSON.stringify(h.collection);
 for(const locale of Object.keys(w.TextPatchI18n.languages)){
  await w.TextPatchI18n.setLocale(locale);
  const catalog=w.TextPatchLocales[locale];
  for(const key of ['capture_new','capture_append','capture_new_hint','capture_append_hint','capture_destination','ai_selected_table'])assert.ok(catalog[key],locale+':'+key);
  assert.equal(h.$('capture').textContent,catalog.capture_new);
  assert.equal(h.$('capture-append').textContent,catalog.capture_append);
  assert.equal(h.$('capture').title,catalog.capture_new_hint);
  assert.equal(h.$('capture-append').title,catalog.capture_append_hint);
  assert.equal(h.$('table-ai').textContent,catalog.ai_task_request_2);
  assert.equal(h.$('table-ai').title,catalog.ai_selected_table.replace('{name}','Applied A'));
  assert.ok(h.$('collection-status').textContent.includes(catalog.capture_destination.replace('{name}','Collected')));
  assert.equal(h.$('table-ai').disabled,false);assert.equal(h.$('table').value,'a');
  assert.equal(JSON.stringify(h.collection),original);
 }
});

test('zero replacements is distinct from applying and saved activation remains checked on runtime failure',async t=>{
 const h=await popup(t,{report:{translated:0}});
 assert.equal(h.$('enabled').checked,true);assert.match(h.$('page-status').textContent,/일치하는 텍스트 없음/);assert.doesNotMatch(h.$('page-status').textContent,/적용 중/);
});


test('expanded site controls and collected table name survive ko/ar/en switching and remain actionable',async t=>{
 const h=await popup(t,{collection:session()}),w=h.d.window;
 w.eval(await source('locales/ar.js'));
 h.$('sites-list').open=true;h.$('sites-list').dispatchEvent(new w.Event('toggle'));await tick();await tick();
 for(const locale of ['ar','en','ko']){
  const select=h.doc.querySelector('#rules select'),toggle=h.doc.querySelector('#rules input'),link=h.doc.querySelector('#rules a');
  assert.ok(select&&toggle&&link);await w.TextPatchI18n.setLocale(locale);
  assert.equal(h.doc.querySelector('#rules select'),select);assert.equal(h.doc.querySelector('#rules input'),toggle);assert.equal(h.doc.querySelector('#rules a'),link);
  assert.equal(link.href,'https://example.com/docs');assert.equal(h.$('sites-list').open,true);
  assert.equal(h.$('collection-result-edit').querySelector('bdi').textContent,'Collected');
 }
 const select=h.doc.querySelector('#rules select');select.value='b';select.dispatchEvent(new w.Event('change'));await tick();await tick();
 assert.ok(h.calls.some(m=>m.type==='saveRule'&&m.rule.tableId==='b'));
 const toggle=h.doc.querySelector('#rules input');toggle.click();await tick();await tick();
 assert.ok(h.calls.some(m=>m.type==='toggleSite'));
});

test('searchable combobox filters independently, navigates and commits only an explicit choice',async t=>{
 const h=await popup(t),{$}=h,w=h.d.window,search=$('table-search');
 assert.equal(search.getAttribute('role'),'combobox');assert.equal(search.value,'Applied A');assert.equal($('table').hidden,true);
 search.focus();assert.equal(search.getAttribute('aria-expanded'),'true');assert.equal(search.value,'');
 assert.equal($('table-list').querySelector('[aria-selected=true]').dataset.tableId,'a');
 search.value='colLECT';search.dispatchEvent(new w.Event('input'));
 assert.equal($('table').value,'a');assert.equal($('table-list').querySelectorAll('[role=option]').length,1);
 assert.equal(h.calls.some(m=>m.type==='selectTable'),false);
 search.value='absent';search.dispatchEvent(new w.Event('input'));
 assert.equal($('table-list').querySelectorAll('[role=option]').length,0);assert.ok($('table-list').querySelector('[role=status]'));
 search.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal($('table').value,'a');
 search.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
 assert.equal(search.value,'Applied A');assert.equal(search.getAttribute('aria-expanded'),'false');
 search.click();search.value='Collected';search.dispatchEvent(new w.Event('input'));
 search.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
 assert.equal(h.doc.activeElement,search);assert.equal(search.getAttribute('aria-activedescendant'),'table-option-0');
 search.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await tick();
 assert.equal($('table').value,'b');assert.equal(search.value,'Collected');assert.equal(h.calls.findLast(m=>m.type==='selectTable').tableId,'b');
 search.focus();search.click();search.dispatchEvent(new w.KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));assert.equal(search.getAttribute('aria-activedescendant'),'table-option-1');
 search.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));assert.equal(search.getAttribute('aria-activedescendant'),'table-option-0');
 search.blur();assert.equal(search.getAttribute('aria-expanded'),'false');assert.equal($('table').value,'b');
});

test('header has three icons and language chooser opens only on click, closes on Escape and outside click',async t=>{
 const h=await popup(t),{$}=h,w=h.d.window;
 assert.deepEqual([...h.doc.querySelectorAll('.header-actions > *')].map(n=>n.id),['options','settings-open','language-open']);
 assert.equal($('language-menu').hidden,true);$('language-open').dispatchEvent(new w.Event('mouseover'));assert.equal($('language-menu').hidden,true);
 $('language-open').click();assert.equal($('language-menu').hidden,false);assert.equal($('language-open').getAttribute('aria-expanded'),'true');
 $('app-locale').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal($('language-menu').hidden,true);assert.equal(h.doc.activeElement,$('language-open'));
 $('language-open').click();$('main-view').click();assert.equal($('language-menu').hidden,true);
});

test('explicit popup file import announces save and errors without changing site selection or enabling it',async t=>{
 const h=await popup(t,{page:{enabled:false}}),{$}=h,w=h.d.window;
 const original=w.chrome.runtime.sendMessage;let imported;
 w.chrome.runtime.sendMessage=async message=>{
  if(message.type==='importTables'){
   imported=message;h.state.library.tables.push({...h.state.library.tables[0],id:'new-import',name:'New import'});
   return {...h.state,notice:'Saved 1 new table'};
  }
  return original(message);
 };
 let files=[];Object.defineProperty($('import-file'),'files',{get:()=>files});
 await $('import-file').onchange();assert.equal(imported,undefined);
 files=[new w.File(['{"format":"text-patch-table"}'],'terms.json',{type:'application/json'})];
 await $('import-file').onchange();assert.equal(imported.fileName,'terms.json');assert.equal(JSON.parse(imported.text).format,'text-patch-table');
 assert.equal($('import-status').hidden,false);assert.match($('import-status').textContent,/Saved 1/);
 assert.equal($('table').value,'a');assert.equal($('enabled').checked,false);assert.equal($('table').options.length,4);
 assert.equal(h.calls.some(m=>['selectTable','activateSite','toggleSite'].includes(m.type)),false);
 w.chrome.runtime.sendMessage=async message=>message.type==='importTables'?{error:'File invalid'}:original(message);
 await $('import-file').onchange();assert.equal($('import-status').textContent,'File invalid');assert.equal($('import-open').disabled,false);
 files=[new w.File(['{}'],'bad.txt')];await $('import-file').onchange();assert.match($('import-status').textContent,/JSON/);
 assert.equal($('import-file').value,'');
});
test('linked popup import previews destination and counts, cancels safely, then explicitly applies and saves',async t=>{
 const h=await popup(t),{$}=h,w=h.d.window;w.eval(await source('ai-request-ui.js'));
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 const original=w.chrome.runtime.sendMessage;let writes=0;
 w.chrome.runtime.sendMessage=async message=>{
  if(message.type==='aiResultPreview')return {tableName:'<img src=x> destination',filled:2,preserved:3};
  if(message.type==='aiResultApply'){writes++;return {filled:1,preserved:4};}
  return original(message);
 };
 Object.defineProperty($('import-file'),'files',{value:[new w.File(['{"aiRequest":{"id":"local","version":1}}'],'result.json')]});
 let importing=$('import-file').onchange();
 for(let i=0;i<30&&!w.document.querySelector('[data-ai-result]');i++)await tick();
 let dialog=w.document.querySelector('[data-ai-result]');assert.ok(dialog);assert.match(dialog.textContent,/채우기 2.*유지 3/);assert.match(dialog.textContent,/destination/);assert.equal(dialog.querySelector('img'),null);assert.equal(writes,0);
 dialog.querySelector('button').click();await importing;assert.equal(writes,0);
 importing=$('import-file').onchange();for(let i=0;i<30&&!w.document.querySelector('[data-ai-result]');i++)await tick();
 dialog=w.document.querySelector('[data-ai-result]');assert.match(dialog.querySelector('[data-ai-result-apply]').textContent,/적용 및 저장/);dialog.querySelector('[data-ai-result-apply]').click();await importing;
 assert.equal(writes,1);assert.match($('import-status').textContent,/채우기 1.*유지 4/);assert.equal($('table').value,'a');
});
