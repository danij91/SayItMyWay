import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seededHarness as harness} from './background-harness.mjs';
import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
const plain=value=>JSON.parse(JSON.stringify(value));
const tableId='crimson-desert';
const original={id:'r',origin:'https://old.test',scope:'page',path:'/old',tableId,enabled:true,matchMode:'word',caseSensitive:true};
const edit=(url,scope='page')=>({type:'saveSiteSettings',id:'r',url,scope,matchMode:'word',caseSensitive:true});

test('MapGenie new selection defaults to exact page with full navigation URL and persists',async()=>{
 const h=await harness(),url='https://mapgenie.io/crimson-desert/maps/pywel?x=1#marker';
 const state=await h.send({type:'selectTable',url,tableId});assert.equal(state.error,undefined);
 assert.equal(state.page.rule.scope,'page');assert.equal(state.page.rule.path,'/crimson-desert/maps/pywel');assert.equal(state.page.rule.url,url);
 assert.equal((await h.send({type:'pageState',url:'https://mapgenie.io/other/maps/world'})).rule,null);
 assert.equal((await h.send({type:'pageState',url:url.replace('?x=1#marker','?other=2#new')})).rule.id,state.page.rule.id);
 const restart=await harness(h.store,h.indexedDB);assert.deepEqual(plain((await restart.send({type:'state'})).rules),plain(state.rules));
});

test('existing broad selection saves current navigation URL without narrowing the rule',async()=>{
 for(const scope of ['site','prefix']){
  const rule={...original,scope,path:scope==='site'?'/':'/old'};
  const h=await harness({rules:[rule]});
  const state=await h.send({type:'selectTable',url:'https://old.test/old/deep?q=1#x',tableId});
  assert.deepEqual(plain(state.rules[0]),{...rule,url:'https://old.test/old/deep?q=1#x'});
  const saved=await h.send(edit('https://old.test/old/deep?q=2#new',scope));
  assert.equal(saved.error,undefined);assert.equal(saved.rules[0].path,rule.path);
  assert.equal(saved.rules[0].url,'https://old.test/old/deep?q=2#new');
 }
});

test('page, prefix and site edits preserve stable identity, order, table/options and persist',async()=>{
 const other={...original,id:'other',path:'/untouched'};
 const h=await harness({rules:[other,original]});
 for(const scope of ['prefix','site','page']){
  const url='https://old.test/new/deep?q=1#x',state=await h.send(edit(url,scope));assert.equal(state.error,undefined);
  assert.deepEqual(Array.from(state.rules,r=>r.id),['other','r']);assert.deepEqual(plain(state.rules[0]),other);
  assert.deepEqual(plain(state.rules[1]),{...original,scope,path:scope==='site'?'/':'/new/deep',url});
  const child=await h.send({type:'pageState',url:'https://old.test/new/deep/child'});assert.equal(child.rule?.id,scope==='page'?undefined:'r');
 }
 const restart=await harness(h.store,h.indexedDB);assert.deepEqual(plain((await restart.send({type:'state'})).rules),h.store.rules);
});

test('cross-origin edits request synchronously, denied/throw/reject leave row untouched; grant survives popup loss',async()=>{
 const h=await harness({rules:[original]}),message={...edit('https://new.test/deep?q=1#x'),requestPermission:true};
 await h.send({type:'state'});const before=structuredClone(h.store);
 for(const request of [()=>false,()=>{throw Error('denied');},()=>Promise.reject(Error('denied'))]){
  h.setRequest(request);assert.ok((await h.send(message)).error);assert.deepEqual(h.store,before);
 }
 let resolve,requested=false;h.setRequest(({origins})=>{requested=true;assert.deepEqual(plain(origins),['https://new.test/*']);return new Promise(r=>resolve=r);});
 const pending=h.send(message);assert.equal(requested,true);assert.deepEqual(h.store,before);
 // The sender is no longer involved after forwarding its gesture.
 h.grants.add('https://new.test/*');resolve(true);const result=await pending;assert.equal(result.error,undefined);assert.equal(h.store.rules[0].url,message.url);
});

test('backend checks changed-host permission independently on both mutation routes and rejects unsafe/mismatched URLs atomically',async()=>{
 const h=await harness({rules:[original]});await h.send({type:'state'});const before=structuredClone(h.store);
 for(const m of [edit('https://new.test/new'),{type:'saveRule',rule:{...original,origin:'https://new.test'}},
  ...['javascript:alert(1)','file:///tmp/a','https://user:pass@old.test/a','not a url'].map(url=>edit(url)),
  {type:'saveRule',rule:{...original,url:'https://other.test/old'}},{type:'saveRule',rule:{...original,url:'https://old.test/elsewhere'}}]){
  assert.ok((await h.send(m)).error);assert.deepEqual(h.store,before);
 }
 h.setRequest(()=>true);assert.ok((await h.send({...edit('https://new.test/new'),requestPermission:true})).error);assert.deepEqual(h.store,before);
});

test('duplicate targets never merge or delete rows and storage failure keeps complete snapshot',async()=>{
 const other={...original,id:'other',path:'/other'},h=await harness({rules:[original,other]});await h.send({type:'state'});const before=structuredClone(h.store);
 for(const m of [edit('https://old.test/other'),{type:'saveRule',rule:{...original,path:'/other'}}]){assert.ok((await h.send(m)).error);assert.deepEqual(h.store,before);}
 h.setStorageFailure(true);assert.ok((await h.send(edit('https://old.test/new'))).error);h.setStorageFailure(false);assert.deepEqual(h.store,before);
});

test('move synchronizes old and new tabs while preserving unrelated rules, currency and origin state',async()=>{
 const other={...original,id:'other',path:'/other'},currencyPreferences={'https://old.test':{enabled:true,source:'USD',target:'KRW'}};
 const h=await harness({rules:[original,other],originEnabled:{'https://old.test':false},currencyPreferences});
 h.grants.add('https://old.test/*');h.grants.add('https://new.test/*');h.tabs.push({id:2,url:'https://old.test/old'},{id:3,url:'https://new.test/new'});
 const result=await h.send(edit('https://new.test/new'));assert.equal(result.error,undefined);
 assert.deepEqual(plain(result.rules[1]),other);assert.deepEqual(h.store.currencyPreferences,currencyPreferences);
 assert.equal(h.store.originEnabled['https://old.test'],false);assert.equal(h.store.originEnabled['https://new.test'],false);
 assert.ok(h.sent.some(m=>m.type==='applyState' && m.state.rule===null));assert.ok(h.sent.some(m=>m.state.rule?.origin==='https://new.test' && !m.state.enabled));
 const restart=await harness(h.store,h.indexedDB);assert.deepEqual(plain((await restart.send({type:'state'})).rules),h.store.rules);
});

test('legacy navigation fallback and new settings UI submit synchronously and retain denied draft',async t=>{
 const source=f=>readFile(new URL('../extension/'+f,import.meta.url),'utf8');
 const d=new JSDOM('<body><table><tbody id="rows"></tbody></table><p id="status"></p></body>',{runScripts:'outside-only'});t.after(()=>d.window.close());const w=d.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 for(const f of ['locales/en.js','i18n.js','shared.js','library.js'])w.eval(await source(f));await w.TextPatchI18n.ready;
 const state={library:{tables:[{id:tableId,name:'Table'}]},rules:[{...original,scope:'prefix'},{...original,id:'site',origin:'https://site.test',scope:'site',path:'/'}]};
 let submitted;w.chrome={runtime:{sendMessage:m=>{if(m.type==='saveSiteSettings'){submitted=m;return Promise.resolve({error:'Denied'});}return Promise.resolve(m.type==='pageState'?{enabled:true}:structuredClone(state));}}};
 w.eval(await source('site-list.js'));const list=w.TextPatchSites.mount({rows:w.document.querySelector('#rows'),status:w.document.querySelector('#status')});await list.load();
 assert.deepEqual(Array.from(w.document.querySelectorAll('a'),a=>a.href),['https://old.test/old','https://site.test/']);
 w.document.querySelector('button.site-settings-button').click();const form=w.document.querySelector('form');assert.equal(form.elements.url.value,'https://old.test/old');
 form.elements.url.value='https://new.test/deep?x=1#y';form.elements.scope.value='page';const pending=form.onsubmit({preventDefault(){}});
 assert.equal(submitted.requestPermission,true);assert.equal(submitted.url,'https://new.test/deep?x=1#y');await pending;
 assert.equal(w.document.querySelector('dialog').open,true);assert.equal(form.elements.url.value,submitted.url);assert.match(w.document.querySelector('.settings-error').textContent,/Denied/);
});
