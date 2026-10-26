import {test} from 'node:test';
import assert from 'node:assert/strict';
import {harness,seed} from './background-harness.mjs';

test('editor library API saves canonical revisions, rejects stale or untrusted writes and notifies existing tabs',async()=>{
 const h=await harness({rules:[{id:'site',origin:'https://example.com',scope:'site',path:'/',tableId:'crimson-desert',enabled:true}]}),sender={id:'test',url:'chrome-extension://test/editor/index.html?table=crimson-desert',tab:{id:8}};
 h.grants.add('https://example.com/*');
 const {library}=await h.send({type:'libraryGet'},sender),stale=structuredClone(library);
 library.tables[0].entries[0].notes='Editor saved';
 const saved=await h.send({type:'librarySave',library},sender);assert.equal(saved.library.revision,2);
 assert.equal(h.sent.at(-1).state.table.entries[0].notes,'Editor saved');assert.equal(h.store.libraryRevision,2);
 assert.equal(h.store.library,undefined,'canonical library is never copied back into chrome.local');
 assert.match((await h.send({type:'librarySave',library:stale},sender)).error,/충돌/);
 const webpage={id:'test',url:'https://example.com/editor/index.html',tab:{id:1,url:'https://example.com/'}};
 for(const type of ['libraryGet','librarySave'])assert.match((await h.send({type,library:stale},webpage)).error,/확장/);
 const restarted=await harness({...h.store,library:stale},h.indexedDB);
 assert.equal((await restarted.send({type:'libraryGet'},sender)).library.tables[0].entries[0].notes,'Editor saved');
 const bundle=await restarted.send({type:'exportBundle'});bundle.library.tables[0].entries[0].notes='Explicit restore';
 await restarted.send({type:'importSettings',data:bundle});
 assert.equal((await restarted.send({type:'libraryGet'},sender)).library.tables[0].entries[0].notes,'Explicit restore');
});

test('invalid nonempty legacy data surfaces an error without replacing the cache or dictionary',async()=>{
 for(const initial of [{dictionary:{broken:true}},{library:{broken:true}}]){
  const before=structuredClone(initial),h=await harness(initial);
  assert.ok((await h.send({type:'state'})).error);assert.deepEqual(h.store,before);
 }
});

test('legacy dictionary edits survive initial merge with a newer bundled library and retain site links',async()=>{
 const make=await harness(),bundle=(await make.send({type:'libraryGet'})).library;
 bundle.revision=20;const dictionary=structuredClone(seed);dictionary.entries[0].notes='Legacy user note';
 const rules=[{id:'saved',origin:'https://example.com',scope:'site',path:'/',tableId:'crimson-desert',enabled:false}];
 const h=await harness({dictionary,rules,includeReview:true},undefined,bundle),state=await h.send({type:'state'});
 assert.equal(state.library.revision,20);assert.equal(state.rules[0].tableId,'crimson-desert');assert.equal(state.includeReview,undefined);
 assert.ok(state.library.tables.some(t=>t.migrationConflict?.originalId==='crimson-desert' && t.entries[0].notes==='Legacy user note'));
 assert.equal(h.store.dictionary.entries[0].notes,'Legacy user note');
});

test('tab removal retires only its activation intent before permission completion and restart',async()=>{
 const h=await harness({rules:[]}),url='https://example.com/docs/a';
 await h.send({type:'selectTable',url,tableId:'crimson-desert'});
 let resolve;h.setRequest(()=>new Promise(r=>resolve=r));
 const activation=h.send({type:'activateSite',url,tabId:1,tableId:'crimson-desert',attemptId:'closed'});
 await h.send({type:'state'});
 h.store.activationIntents.other={tabId:2,origin:'https://other.example',createdAt:Date.now()};
 h.tabs.length=0;h.listeners.tabRemoved(1);await h.send({type:'state'});
 assert.deepEqual(Object.keys(h.store.activationIntents),['other']);
 h.grants.add('https://example.com/*');resolve(true);await activation;
 assert.equal((await h.send({type:'pageState',url})).enabled,false);
 delete h.store.activationIntents.other;
 const restarted=await harness(h.store,h.indexedDB);restarted.tabs.length=0;restarted.grants.add('https://example.com/*');restarted.listeners.startup();
 assert.equal((await restarted.send({type:'state',url})).page.enabled,false);
});

test('trusted extension documents can manage sites with or without sender.tab; content URLs stay unprivileged',async()=>{
 const h=await harness({rules:[{id:'site',origin:'https://example.com',scope:'site',path:'/',tableId:'crimson-desert',enabled:true}]});h.grants.add('https://example.com/*');
 for(const name of ['popup.html','options.html','manager.html'])for(const tab of [undefined,{id:9,url:'chrome-extension://test/manager.html'}]){
  const sender={id:'test',url:'chrome-extension://test/'+name+'?embedded=1',...(tab?{tab}:{})};
  assert.ok((await h.send({type:'state'},sender)).rules);
  const page=await h.send({type:'pageState',url:'https://example.com/docs'},sender);assert.equal(page.enabled,true);
 }
 for(const sender of [
  {id:'test',url:'https://example.com/options.html',tab:{id:1,url:'https://example.com/docs'}},
  {id:'test',url:'https://example.com/options.html'},
  {id:'test',url:'chrome-extension://other/options.html'},
  {id:'test',url:'chrome-extension://test/not-options.html'},
  {id:'test'},
 ])assert.match((await h.send({type:'toggle',enabled:false},sender)).error,/확장/);
 assert.equal(await h.send({type:'toggle',enabled:false},{id:'other',url:'chrome-extension://test/options.html'}),undefined);
 const content={id:'test',url:'https://example.com/docs',tab:{id:1,url:'https://example.com/docs'}};
 const page=await h.send({type:'pageState',url:'https://other.example/'},content);
 assert.equal(page.rule.origin,'https://example.com');assert.equal(page.enabled,true);
});
test('migrates legacy cache and refresh reads canonical DB without server calls',async()=>{
 const h=await harness({dictionary:seed,enabled:false,includeReview:true});
 let s=await h.send({type:'state'});
 assert.equal(s.library.tables[0].entries.length,147);assert.equal(s.enabled,false);assert.equal(s.includeReview,undefined);
 assert.equal(h.store.dictionary.revision,seed.revision);
 for(const mode of ['offline','invalid']){h.setMode(mode);s=await h.send({type:'refresh'});assert.equal(s.library.revision,1);assert.equal(s.offline,false);}
});

test('cached table with partial optional defaults keeps its data and legacy enable flag',async()=>{
 const table={...structuredClone(seed),id:'custom',name:'Custom',description:'Retained',excludedTerms:[],excludedCategories:[],defaults:{matchMode:'word'}};
 const h=await harness({library:{schemaVersion:2,revision:8,tables:[table]},enable:false,includeReview:true,rules:[]});
 const s=await h.send({type:'state'});
 assert.equal(s.library.revision,8);assert.equal(s.library.tables[0].id,'custom');
 assert.equal(s.library.tables[0].defaults.matchMode,'word');
 assert.equal(s.library.tables[0].defaults.caseSensitive,false);
 assert.equal(s.enabled,false);assert.equal(s.includeReview,undefined);
 assert.equal(h.store.enable,false);
});


test('dropdown selection is permission-free, initially OFF, and preserves matched scope plus ON/OFF',async()=>{
 const h=await harness({rules:[]});
 const url='https://example.com/docs/a';
 let s=await h.send({type:'selectTable',url,tableId:'crimson-desert'});
 assert.equal(s.error,undefined);assert.equal(s.page.table.id,'crimson-desert');assert.equal(s.page.enabled,false);assert.equal(s.page.rule.enabled,false);
 h.grants.add('https://example.com/*');
 s=await h.send({type:'state'});s.library.tables.push({...s.library.tables[0],id:'second',name:'Second'});await h.send({type:'librarySave',library:s.library});
 await h.send({type:'toggleSite',url,enabled:true});
 s=await h.send({type:'selectTable',url,tableId:'second'});
 assert.equal(s.page.enabled,true);assert.equal(h.sent.at(-1).state.table.id,'second');
 await h.send({type:'toggleSite',url,enabled:false});
 s=await h.send({type:'selectTable',url,tableId:'crimson-desert'});
 assert.equal(s.page.enabled,false);assert.equal(h.sent.at(-1).state.enabled,false);
 assert.equal((await h.send({type:'pageState',url:'https://other.example'})).enabled,false);
 s=await h.send({type:'saveRule',rule:{origin:'https://example.com',scope:'prefix',path:'/docs',tableId:'crimson-desert',enabled:false}});
 s=await h.send({type:'selectTable',url,tableId:'second'});
 assert.equal(s.page.rule.scope,'prefix');assert.equal(s.page.rule.path,'/docs');assert.equal(s.page.rule.enabled,false);
});

test('background-owned permission request survives popup loss; denied result retires intent and preserves OFF selection',async()=>{
 const h=await harness({rules:[]}),url='https://example.com/docs/a';
 await h.send({type:'selectTable',url,tableId:'crimson-desert'});
 let resolve;h.setRequest(()=>new Promise(r=>resolve=r));
 const activation=h.send({type:'activateSite',url,tabId:1,tableId:'crimson-desert',attemptId:'denied'});
 assert.equal(typeof resolve,'function','request is synchronous in gesture message handler');
 await h.send({type:'state'});resolve(false);
 assert.equal((await activation).page.enabled,false);
 assert.equal(Object.keys(h.store.activationIntents).length,0);
 h.grants.add('https://example.com/*');h.listeners.added();
 const s=await h.send({type:'state',url});assert.equal(s.page.enabled,false);assert.equal(s.page.table.id,'crimson-desert');
});

for(const cancel of ['off','table','navigation','expiry','removed','import'])test('pending permission approval cannot revive cancelled activation: '+cancel,async()=>{
 const h=await harness({rules:[]}),url='https://example.com/docs/a';
 await h.send({type:'selectTable',url,tableId:'crimson-desert'});
 let resolve;h.setRequest(()=>new Promise(r=>resolve=r));
 const activation=h.send({type:'activateSite',url,tabId:1,tableId:'crimson-desert',attemptId:'pending'});
 await h.send({type:'state'});
 if(cancel==='off')await h.send({type:'toggleSite',url,enabled:false});
 if(cancel==='table')await h.send({type:'selectTable',url,tableId:'crimson-desert'});
 if(cancel==='navigation'){h.tabs[0].url=url+'?new';h.listeners.updated(1,{url:h.tabs[0].url},h.tabs[0]);}
 if(cancel==='expiry')h.store.activationIntents.pending.createdAt=Date.now()-120001;
 if(cancel==='removed')h.listeners.removed();
 if(cancel==='import')await h.send({type:'importSettings',data:await h.send({type:'exportSettings'})});
 h.grants.add('https://example.com/*');h.listeners.added();resolve(true);
 await activation;
 assert.equal((await h.send({type:'pageState',url})).enabled,false);
 assert.equal((await h.send({type:'pageState',url:'https://other.example'})).enabled,false);
 assert.equal(Object.keys(h.store.activationIntents).length,0);
});

test('new attempt owns activation after rapid OFF/ON and worker restart recovers granted intent',async()=>{
 let h=await harness({rules:[]});const url='https://example.com/docs/a';
 await h.send({type:'selectTable',url,tableId:'crimson-desert'});
 const resolvers=[];h.setRequest(()=>new Promise(r=>resolvers.push(r)));
 const a=h.send({type:'activateSite',url,tabId:1,tableId:'crimson-desert',attemptId:'old'});
 await h.send({type:'toggleSite',url,enabled:false});
 const b=h.send({type:'activateSite',url,tabId:1,tableId:'crimson-desert',attemptId:'new'});
 await h.send({type:'state'});
 resolvers[0](false);await a;
 assert.deepEqual(Object.keys(h.store.activationIntents),['new']);
 const restarted=await harness(h.store,h.indexedDB);restarted.grants.add('https://example.com/*');restarted.listeners.startup();
 assert.equal((await restarted.send({type:'state',url})).page.enabled,true);
 h.grants.add('https://example.com/*');resolvers[1](true);assert.equal((await b).page.enabled,true);
});

test('content pages cannot manufacture activation intents or request host permission',async()=>{
 const h=await harness();let requests=0;h.setRequest(()=>{requests++;return Promise.resolve(true);});
 for(const type of ['activateSite','beginActivation','selectTable']){
  const sender={id:'test',url:'https://example.com',tab:{id:1,url:'https://example.com'}};
  if(type==='activateSite')assert.equal(await h.send({type},sender),undefined);
  else assert.ok((await h.send({type},sender)).error);
 }
 assert.equal(requests,0);assert.equal(h.store.activationIntents,undefined);
});

for(const failure of ['throw','reject','preparation'])test('permission '+failure+' failure retires pending intent without unhandled rejection',async()=>{
 const h=await harness({rules:[]}),url='https://example.com/docs/a';
 await h.send({type:'selectTable',url,tableId:'crimson-desert'});
 h.setRequest(()=>{if(failure==='throw')throw Error('request threw');return failure==='reject'?Promise.reject(Error('request rejected')):Promise.resolve(true);});
 const result=await h.send({type:'activateSite',url,tabId:failure==='preparation'?999:1,tableId:'crimson-desert',attemptId:failure});
 assert.ok(result.error);
 h.grants.add('https://example.com/*');h.listeners.added();
 const state=await h.send({type:'state',url});assert.equal(state.page.enabled,false);assert.equal(state.page.table.id,'crimson-desert');
 assert.equal(Object.keys(h.store.activationIntents).length,0);
});

for(const enabled of [true,false])test('site toggle isolates origins with legacy global '+enabled+' across restart and settings/bundle roundtrip',async()=>{
 const rules=['https://example.com','https://other.example'].map((origin,i)=>({id:'site-'+i,origin,scope:'site',path:'/',enabled:true,tableId:'crimson-desert'}));
 let h=await harness({enable:enabled,rules});
 for(const origin of rules.map(r=>r.origin))h.grants.add(origin+'/*');
 const page=url=>h.send({type:'pageState',url});
 await h.send({type:'toggleSite',url:'https://example.com/docs/a',enabled:false});
 assert.equal((await page('https://example.com')).enabled,false);
 assert.equal((await page('https://other.example')).enabled,enabled);
 await h.send({type:'toggleSite',url:'https://example.com/docs/a',enabled:true});
 assert.equal((await page('https://example.com')).enabled,true);
 assert.equal((await page('https://other.example')).enabled,enabled);
 assert.equal(h.store.enabled,enabled);
 h=await harness(h.store,h.indexedDB);for(const r of rules)h.grants.add(r.origin+'/*');
 assert.equal((await page('https://example.com')).enabled,true);
 for(const type of ['exportSettings','exportBundle']){
  const data=await h.send({type});
  const exported=type==='exportSettings'?data:data.settings;
  assert.equal(exported.originEnabled['https://example.com'],true);
  await h.send({type:'toggleSite',url:'https://example.com',enabled:false});
  assert.equal((await h.send({type:'importSettings',data})).error,undefined);
  assert.equal((await page('https://example.com')).enabled,true);
  assert.equal((await page('https://other.example')).enabled,enabled);
 }
 const legacy=await h.send({type:'exportSettings'});delete legacy.originEnabled;
 await h.send({type:'importSettings',data:legacy});
 assert.equal((await page('https://example.com')).enabled,enabled);
});

test('disabled specific rule blocks broader fallback and explicit popup replacement preserves scope',async()=>{
 const h=await harness();h.grants.add('https://example.com/*');
 const base={origin:'https://example.com',tableId:'crimson-desert',enabled:true};
 await h.send({type:'saveRule',rule:{...base,scope:'site',path:'/'}});
 const s=await h.send({type:'saveRule',rule:{...base,scope:'prefix',path:'/docs',enabled:false}});
 let page=await h.send({type:'pageState',url:'https://example.com/docs/a'});
 assert.equal(page.rule.scope,'prefix');assert.equal(page.enabled,false);
 assert.equal((await h.send({type:'pageState',url:'https://example.com/outside'})).enabled,true);
 await h.send({type:'saveRule',rule:{...page.rule,enabled:true},activateSite:true});
 page=await h.send({type:'pageState',url:'https://example.com/docs/a'});
 assert.equal(page.enabled,true);assert.equal(page.rule.scope,'prefix');assert.equal(page.rule.path,'/docs');
 assert.equal((await h.send({type:'state'})).rules.length,s.rules.length);
});

test('invalid origin overrides fail atomic settings and bundle validation; old settings remain valid',async()=>{
 const h=await harness(),before=await h.send({type:'exportBundle'});
 for(const originEnabled of [null,[],false,{'https://example.com/path':true},{'https://example.com':'true'},{'file://example.com':false}]){
  for(const data of [{...before.settings,originEnabled},{...before,settings:{...before.settings,originEnabled}}]){
   assert.ok((await h.send({type:'previewImport',data})).error);
   assert.ok((await h.send({type:'importSettings',data})).error);
   assert.equal(JSON.stringify(await h.send({type:'exportBundle'})),JSON.stringify(before));
  }
 }
});
test('same-target upsert, specificity, permission registration and revoke restore',async()=>{
 const h=await harness();
 let s=await h.send({type:'saveRule',rule:{origin:'https://example.com',scope:'site',path:'/',tableId:'crimson-desert',enabled:true}});
 assert.match(s.error,/권한/);
 h.grants.add('https://example.com/*');
 const rule={origin:'https://example.com',scope:'site',path:'/',tableId:'crimson-desert',enabled:true};
 await h.send({type:'saveRule',rule});
 s=await h.send({type:'saveRule',rule:{...rule,scope:'prefix',path:'/docs'}});
 s=await h.send({type:'saveRule',rule:{...rule,scope:'page',path:'/docs/a'}});
 s=await h.send({type:'saveRule',rule:{...rule,scope:'page',path:'/docs/a'}});
 assert.equal(s.rules.length,4);
 s=await h.send({type:'pageState',url:'https://example.com/docs/a?x=1#y'});
 assert.equal(s.rule.scope,'page');assert.equal(s.enabled,true);
 assert.deepEqual(Array.from(h.registrations[0].matches),['https://example.com/*']);
 h.grants.clear();h.listeners.removed();
 s=await h.send({type:'state',url:'https://example.com/docs/a'});
 assert.equal(s.page.missingPermission,true);assert.equal(h.registrations.length,0);
 assert.equal(h.sent.at(-1).state.enabled,false);
});

test('newly linked permitted tab receives scripts in dependency order and disable restores it',async()=>{
 const h=await harness();h.disconnect();
 h.grants.add('https://example.com/*');
 await h.send({type:'saveRule',rule:{origin:'https://example.com',scope:'site',path:'/',tableId:'crimson-desert',enabled:true}});
 assert.deepEqual(Array.from(h.executed[0].files),['shared.js','library.js','currency-rates.js','currency.js','engine.js','interaction-settings.js','page-tools.js','content.js']);
 assert.equal(h.sent.at(-1).state.enabled,true);
 await h.send({type:'toggle',enabled:false});
 assert.equal(h.registrations.length,0);assert.equal(h.sent.at(-1).state.enabled,false);
 await h.send({type:'toggle',enabled:true});
 assert.equal(h.registrations.length,1);assert.equal(h.sent.at(-1).state.enabled,true);
 const settings=await h.send({type:'exportSettings'});
 await h.send({type:'deleteRule',id:settings.rules.find(r=>r.origin==='https://example.com').id});
 assert.equal(h.sent.at(-1).state.enabled,false);assert.equal(h.registrations.length,0);
});
test('settings preview validates atomically; imports never grant permissions; bundles preserve library',async()=>{
 const h=await harness();
 const before=await h.send({type:'exportSettings'});
 const bad={...before,rules:[{id:'bad'}]};
 assert.ok((await h.send({type:'previewImport',data:bad})).error);
 assert.equal(JSON.stringify(await h.send({type:'exportSettings'})),JSON.stringify(before));
 const incoming={schemaVersion:1,enabled:true,includeReview:true,rules:[{id:'new',origin:'https://example.com',scope:'site',path:'/',enabled:true,tableId:'crimson-desert'}]};
 const preview=await h.send({type:'previewImport',data:incoming});
 assert.equal(preview.settings.rules.length,1);
 assert.equal(JSON.stringify(await h.send({type:'exportSettings'})),JSON.stringify(before));
 let s=await h.send({type:'importSettings',data:incoming,url:'https://example.com'});
 assert.equal(s.page.missingPermission,true);assert.equal(h.registrations.length,0);
 const bundle=await h.send({type:'exportBundle'});
 assert.equal(bundle.library.tables[0].entries.length,147);
 assert.ok(!(await h.send({type:'importSettings',data:bundle})).error);
});


test('legacy and new settings roundtrip ignores includeReview without changing stored rows or other local data',async()=>{
 const h=await harness({includeReview:false,unrelated:{preserve:true}});
 const before=await h.send({type:'exportBundle'});
 assert.equal(Object.hasOwn(before.settings,'includeReview'),false);
 for(const legacy of [undefined,false,true]){
  const settings=structuredClone(before.settings);
  if(legacy!==undefined)settings.includeReview=legacy;
  const preview=await h.send({type:'previewImport',data:settings});assert.equal(preview.error,undefined);
  assert.equal(Object.hasOwn(preview.settings,'includeReview'),false);
  assert.equal((await h.send({type:'importSettings',data:settings})).error,undefined);
  assert.equal(JSON.stringify(await h.send({type:'exportSettings'})),JSON.stringify(before.settings));
  const bundle={...before,settings};
  assert.equal((await h.send({type:'importSettings',data:bundle})).error,undefined);
  const exported=await h.send({type:'exportBundle'});
  assert.equal(JSON.stringify(exported.library.tables),JSON.stringify(before.library.tables));
  assert.equal(JSON.stringify(exported.settings),JSON.stringify(before.settings));
  assert.ok(exported.library.revision>before.library.revision);
 }
 assert.equal(Object.hasOwn(await h.send({type:'state'}),'includeReview'),false);
 assert.equal(Object.hasOwn(await h.send({type:'pageState',url:'https://example.com'}),'includeReview'),false);
 assert.equal(h.store.includeReview,false);assert.deepEqual(h.store.unrelated,{preserve:true});
 assert.ok((await h.send({type:'setReview',includeReview:true})).error);
 assert.equal(h.store.includeReview,false);
});

test('table edits preserve rule positions and same-target collision retains target position',async()=>{
 const h=await harness();h.grants.add('https://example.com/*');
 const base={origin:'https://example.com',scope:'page',tableId:'crimson-desert',enabled:false};
 for(const path of ['/first','/docs/a','/third','/last'])await h.send({type:'saveRule',rule:{...base,path}});
 const before=(await h.send({type:'state'})).rules;
 const own=before.filter(r=>r.origin===base.origin);
 let s=await h.send({type:'selectTable',url:'https://example.com/docs/a',tableId:'crimson-desert'});
 assert.deepEqual(JSON.parse(JSON.stringify(s.rules)),JSON.parse(JSON.stringify(before)));
 s=await h.send({type:'saveRule',rule:{...own[1],enabled:true}});
 assert.deepEqual(Array.from(s.rules,r=>r.id),Array.from(before,r=>r.id));
 assert.equal(s.rules.find(r=>r.id===own[1].id).enabled,true);
 s=await h.send({type:'saveRule',rule:{...own[0],path:'/third'}});
 assert.deepEqual(Array.from(s.rules.filter(r=>r.origin===base.origin),r=>r.path),['/docs/a','/third','/last']);
 assert.equal(s.rules.find(r=>r.path==='/third').id,own[2].id);
});

test('read-only state does not reinject tabs; same-origin SPA path selects page rule; edit collision upserts',async()=>{
 const h=await harness();
 h.grants.add('https://example.com/*');
 const rule={origin:'https://example.com',scope:'page',path:'/docs/a',tableId:'crimson-desert',enabled:true};
 let s=await h.send({type:'saveRule',rule});const a=s.rules.find(r=>r.path==='/docs/a');
 s=await h.send({type:'saveRule',rule:{...rule,path:'/other'}});const b=s.rules.find(r=>r.path==='/other');
 const n=h.sent.length;await h.send({type:'state'});assert.equal(h.sent.length,n);
 const page=await new Promise(r=>h.listeners.message({type:'pageState',url:'https://example.com/other'},{id:'test',tab:{url:'https://example.com/docs/a'}},r));
 assert.equal(page.rule.id,b.id);
 s=await h.send({type:'saveRule',rule:{...a,path:'/other'}});
 assert.equal(s.rules.filter(r=>r.origin==='https://example.com').length,1);
 assert.equal(s.rules.find(r=>r.origin==='https://example.com').id,b.id);
 h.grants.clear();
 s=await h.send({type:'saveRule',rule:{...b,enabled:false}});
 assert.equal(s.rules.find(r=>r.id===b.id).enabled,false);
});
