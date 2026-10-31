import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seededHarness as harness} from './background-harness.mjs';
test('legacy rule options seed once from table defaults and table selection retains them',async()=>{
 const h=await harness();h.grants.add('https://example.com/*');
 let state=await h.send({type:'state'});const table=state.library.tables[0];table.defaults.matchMode='word';table.defaults.caseSensitive=true;
 await h.send({type:'librarySave',library:state.library});
 h.store.rules=[{id:'legacy',origin:'https://example.com',scope:'prefix',path:'/docs',tableId:table.id,enabled:true}];
 state=await h.send({type:'state'});assert.equal(state.rules[0].matchMode,'word');assert.equal(state.rules[0].caseSensitive,true);
 await h.send({type:'saveRule',rule:{...state.rules[0],matchMode:'exact',caseSensitive:false}});
 const restart=await harness(h.store,h.indexedDB);state=await restart.send({type:'state'});assert.equal(state.rules[0].matchMode,'exact');assert.equal(state.rules[0].caseSensitive,false);
 const invalid=await restart.send({type:'saveRule',rule:{...state.rules[0],caseSensitive:'false'}});assert.ok(invalid.error);
 assert.equal((await restart.send({type:'state'})).rules[0].caseSensitive,false);
});
import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
const source=f=>readFile(new URL('../extension/'+f,import.meta.url),'utf8');
const tick=()=>new Promise(r=>setTimeout(r,0));
test('two real sites sharing one table independently apply options, revert, restore and survive restarts',async t=>{
 const h=await harness();let state=await h.send({type:'state'});const table=state.library.tables[0];
 table.excludedTerms=[];table.excludedCategories=[];table.defaults={matchMode:'word',caseSensitive:true,translatePlaceholders:true};
 table.entries=[{...table.entries[0],id:'alpha',en:'Alpha',ko:'Result',context:'global',selector:'',status:'verified',matchMode:'exact',caseSensitive:true}];
 await h.send({type:'librarySave',library:state.library});
 for(const [id,origin,matchMode,caseSensitive] of [['a','https://example.com','word',false],['b','https://other.test','exact',true]]){
  h.grants.add(origin+'/*');await h.send({type:'saveRule',rule:{id,origin,scope:'site',path:'/',tableId:table.id,enabled:true,matchMode,caseSensitive}});
 }
 const pages=[];
 for(const origin of ['https://example.com','https://other.test']){
  const d=new JSDOM('<body><span>alpha</span><b>Use Alpha now</b></body>',{url:origin,runScripts:'outside-only'});t.after(()=>d.window.close());let listener;
  d.window.chrome={runtime:{id:'test',getManifest:()=>({version:'test'}),sendMessage:()=>h.send({type:'pageState',url:origin}),onMessage:{addListener:fn=>listener=fn}},storage:{onChanged:{addListener(){}}}};
  for(const f of ['shared.js','library.js','engine.js','content.js'])d.window.eval(await source(f));await tick();
  pages.push({d,apply:state=>new Promise(r=>listener({type:'applyState',state},{id:'test'},r))});
 }
 assert.equal(pages[0].d.window.document.body.textContent,'ResultUse Result now');assert.equal(pages[1].d.window.document.body.textContent,'alphaUse Alpha now');
 state=await h.send({type:'state'});const a=state.rules.find(r=>r.id==='a');await h.send({type:'saveRule',rule:{...a,matchMode:'exact',caseSensitive:true}});
 await pages[0].apply(await h.send({type:'pageState',url:a.origin}));assert.equal(pages[0].d.window.document.body.textContent,'alphaUse Alpha now');
 await h.send({type:'saveRule',rule:a});await pages[0].apply(await h.send({type:'pageState',url:a.origin}));assert.equal(pages[0].d.window.document.body.textContent,'ResultUse Result now');
 await h.send({type:'toggleSite',url:a.origin,enabled:false});await pages[0].apply(await h.send({type:'pageState',url:a.origin}));assert.equal(pages[0].d.window.document.body.textContent,'alphaUse Alpha now');
 const restart=await harness(h.store,h.indexedDB);restart.grants.add(a.origin+'/*');const restored=await restart.send({type:'state'});assert.equal(restored.rules.find(r=>r.id==='a').matchMode,'word');assert.equal(restored.rules.find(r=>r.id==='b').caseSensitive,true);assert.deepEqual(restored.library.tables[0].entries,table.entries);
 await restart.send({type:'selectTable',url:a.origin,tableId:table.id});const after=await restart.send({type:'state'});assert.equal(after.rules.find(r=>r.id==='a').matchMode,'word');
 restart.grants.add('https://new.test/*');await restart.send({type:'selectTable',url:'https://new.test',tableId:table.id});const fresh=(await restart.send({type:'state'})).rules.find(r=>r.origin==='https://new.test');assert.equal(fresh.matchMode,'exact');assert.equal(fresh.caseSensitive,false);
});
test('site settings dialog cancels drafts, retries save errors and preserves rule identity/order/scope',async t=>{
 const d=new JSDOM(await source('options.html'),{runScripts:'outside-only'});t.after(()=>d.window.close());const w=d.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 for(const f of ['locales/en.js','locales/ko.js','i18n.js','shared.js','library.js'])w.eval(await source(f));await w.TextPatchI18n.ready;
 let state={library:{tables:[{id:'t',name:'Table'},{id:'other',name:'Other'}]},rules:[{id:'r',origin:'https://example.test',scope:'prefix',path:'/docs',tableId:'t',enabled:true,matchMode:'exact',caseSensitive:false},{id:'s',origin:'https://other.test',scope:'site',path:'/',tableId:'t',enabled:true,matchMode:'word',caseSensitive:true}]},failure=false;
 w.chrome={runtime:{sendMessage:async m=>{
  if(m.type==='pageState')return {enabled:true};
  if(m.type==='saveSiteSettings'){if(failure)return {error:'save failed'};state.rules=state.rules.map(r=>r.id===m.id?{...r,...w.TextPatch.ruleTarget(m.url,m.scope),matchMode:m.matchMode,caseSensitive:m.caseSensitive}:r);}
  if(m.type==='saveRule'){if(failure)return {error:'save failed'};state.rules=state.rules.map(r=>r.id===m.rule.id?{...r,...structuredClone(m.rule)}:r);}
  return structuredClone(state);
 }}};
 w.eval(await source('site-list.js'));const list=w.TextPatchSites.mount({rows:w.document.querySelector('#rules'),status:w.document.querySelector('#status')});await list.load();
 const dialog=w.document.querySelector('dialog'),form=dialog.querySelector('form'),open=()=>w.document.querySelector('.site-settings-button').click();
 open();form.elements.caseSensitive.checked=true;dialog.querySelector('.settings-cancel').click();assert.equal(state.rules[0].caseSensitive,false);assert.equal(dialog.open,false);
 open();assert.equal(form.elements.caseSensitive.checked,false);form.elements.wordReplacement.checked=true;failure=true;await form.onsubmit({preventDefault(){}});assert.equal(dialog.open,true);assert.equal(state.rules[0].matchMode,'exact');assert.match(dialog.textContent,/save failed/);assert.equal(form.elements.wordReplacement.checked,true);
 state.rules[0]={...state.rules[0],tableId:'other',enabled:false};
 failure=false;await form.onsubmit({preventDefault(){}});assert.equal(dialog.open,false);assert.equal(state.rules[0].matchMode,'word');assert.equal(state.rules[0].tableId,'other');assert.equal(state.rules[0].enabled,false);assert.equal(state.rules[0].id,'r');assert.equal(state.rules[0].scope,'prefix');assert.equal(state.rules[0].path,'/docs');assert.equal(state.rules[1].id,'s');
 const select=w.document.querySelector('#rules select');select.value='other';select.dispatchEvent(new w.Event('change'));await tick();await tick();assert.equal(state.rules[0].tableId,'other');assert.equal(state.rules[0].matchMode,'word');assert.equal(state.rules[0].caseSensitive,false);
});
test('narrow options saves preserve latest links and fail atomically on malformed options or storage failure',async()=>{
 const h=await harness();h.grants.add('https://example.com/*');const initial=await h.send({type:'state'}),tableId=initial.library.tables[0].id;
 await h.send({type:'saveRule',rule:{id:'r',origin:'https://example.com',scope:'prefix',path:'/docs',tableId,enabled:false}});
 await h.send({type:'saveRuleOptions',id:'r',matchMode:'word',caseSensitive:true});
 let state=await h.send({type:'state'}),rule=state.rules.find(r=>r.id==='r');assert.equal(rule.matchMode,'word');assert.equal(rule.enabled,false);assert.equal(rule.path,'/docs');
 for(const options of [{matchMode:'partial',caseSensitive:true},{matchMode:'exact',caseSensitive:'false'},{matchMode:'word'}])assert.ok((await h.send({type:'saveRuleOptions',id:'r',...options})).error);
 assert.ok((await h.send({type:'saveRuleOptions',id:'missing',matchMode:'word',caseSensitive:true})).error);
 h.setStorageFailure(true);assert.ok((await h.send({type:'saveRuleOptions',id:'r',matchMode:'exact',caseSensitive:false})).error);h.setStorageFailure(false);
 assert.deepEqual((await h.send({type:'state'})).rules,state.rules);
});
