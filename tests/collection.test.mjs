import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {IDBFactory} from 'fake-indexeddb';
import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
const source=f=>readFile(new URL('../extension/'+f,import.meta.url),'utf8');
async function harness(store={},transport=null){
 let listener,updated,removed,mode='ok',candidates=['Fresh source'],doc='doc',url='https://example.com/page',requests=[],writes=0,contentRead=null,badgeFailure=false,closed=false,lastError,lookupError;
 const badges=new Map(),titles=new Map(),icons=new Map(),active=new Map(),sessionIds=new Map(),contentMessages=[];
 const actionCalls=[],unchecked=[];
 const action=(method,map,field)=>(details,callback)=>{
  actionCalls.push({method,tabId:details.tabId});
  queueMicrotask(()=>{
   let read=false;const message=closed?'No tab with id: '+details.tabId:actionUnavailable(method)?method+' unavailable':null;
   lastError=message?{message}:undefined;
   Object.defineProperty(context.chrome.runtime,'lastError',{configurable:true,get(){read=true;return lastError;}});
   if(!message)map.set(details.tabId,structuredClone(details[field]));
   try{callback?.();}finally{if(message&&!read)unchecked.push(message);lastError=undefined;}
  });
  // Deliberately callback-only: awaiting this undefined return cannot catch errors.
 };
 const actionUnavailable=method=>badgeFailure===true || badgeFailure===method;
 const seed=JSON.parse(await source('data/dictionary.json'));
 const indexedDB=new IDBFactory();
 const open=indexedDB.open.bind(indexedDB);
 indexedDB.open=(...args)=>{const req=open(...args);req.addEventListener('success',()=>{
  const db=req.result,transaction=db.transaction.bind(db);
  db.transaction=(...args)=>{const tx=transaction(...args),objectStore=tx.objectStore.bind(tx);
   tx.objectStore=name=>{const store=objectStore(name),put=store.put.bind(store);
    store.put=(...values)=>{if(mode==='offline')throw Error('QuotaExceededError');return put(...values);};return store;};
   return tx;};
 });return req;};
 const context=vm.createContext({navigator:{language:'ko'},URL,AbortSignal,AbortController,TextDecoder,TextEncoder,setTimeout,clearTimeout,structuredClone,indexedDB,console,crypto:globalThis.crypto,chrome:{
  runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:fn=>listener=fn},onInstalled:{addListener(){}},onStartup:{addListener(){}}},
  alarms:{get:async()=>null,create:async()=>{},clear:async()=>{},onAlarm:{addListener(){}}},
  storage:{local:{get:async()=>structuredClone(store),set:async value=>{writes++;Object.assign(store,structuredClone(value));}}},
  permissions:{contains:async()=>false,onAdded:{addListener(){}},onRemoved:{addListener(){}}},
  action:{setIcon:action('setIcon',icons,'path'),setBadgeText:action('setBadgeText',badges,'text'),setTitle:action('setTitle',titles,'title')},
  scripting:{executeScript:async()=>[{frameId:0,documentId:'browser-'+doc}],getRegisteredContentScripts:async()=>[],unregisterContentScripts:async()=>{},registerContentScripts:async()=>{}},
  tabs:{get:async id=>{if(lookupError)throw Error(lookupError);if(closed)throw Error('No tab with id: '+id);return {id,url};},query:async()=>[],sendMessage:async(id,m)=>{
   contentMessages.push(m);
   if(contentRead)return contentRead(m);
   if(m.type==='captureStart'){active.set(id,true);sessionIds.set(id,m.sessionId);}
   if(m.type==='captureStop')active.set(id,false);
  return {documentId:doc,url,title:'Source title',language:'en',candidates,sessionId:sessionIds.get(id),active:active.get(id)===true};
  },onUpdated:{addListener:fn=>updated=fn},onRemoved:{addListener:fn=>removed=fn}}
 },fetch:async endpoint=>{
  if(endpoint.endsWith('data/library.json'))return {ok:false,status:404};
  assert.ok(endpoint.startsWith('chrome-extension:'),'normal runtime never calls a repository');
  return {ok:true,json:async()=>structuredClone(seed)};
 }});
 for(const f of ['locales/ko.js','locales/en.js','i18n.js','interaction-settings.js','currency-rates.js','currency.js','currency-feed.js','shared.js','library.js','collection.js','repository.js'])vm.runInContext(await source(f),context);
 // Observe the public repository capture boundary while executing the real IndexedDB implementation.
 const create=context.LibraryRepository.create;
 context.LibraryRepository.create=(...args)=>{const repo=create(...args),capture=repo.capture;
  repo.capture=async request=>{requests.push(structuredClone(request));return capture(request);};return repo;};
 context.importScripts=()=>{};const code=await source('background.js');
 // Fresh lexical scope for service-worker restart while preserving storage and repository.
 const boot=()=>{const next=vm.createContext({...context});vm.runInContext(code,next);};boot();
 const send=(m,sender={id:'test',url:'chrome-extension://test/popup.html'})=>new Promise(resolve=>listener(m,sender,resolve));
 await send({type:'state'});
 return {store,requests,send,library:async()=>structuredClone((await send({type:'libraryGet'})).library),badges,titles,icons,contentMessages,actionCalls,unchecked,restart:boot,connect:fn=>contentRead=fn,get writes(){return writes;},lookupFailure:v=>lookupError=v,badgeFailure:v=>badgeFailure=v,replaceDocument:()=>{doc='new-doc';active.clear();sessionIds.clear();},mode:m=>mode=m,candidates:v=>candidates=v,navigate:()=>{doc='new-doc';url='https://example.com/next';updated(1,{url},{id:1,url});},close:()=>{closed=true;badges.delete(1);titles.delete(1);icons.delete(1);removed(1);},sender:()=>({id:'test',tab:{id:1,url},url,frameId:0,documentId:'browser-'+doc})};
}
const begin=h=>h.send({type:'collectionBegin',tabId:1,tableId:'crimson-desert'});
const update=(h,s,candidates,extra={})=>h.send({type:'collectionUpdate',sessionId:s.id,documentId:s.documentId,url:s.url,candidates,...extra},h.sender());

test('append captures missing originals into the selected table and pins retries after selection changes',async()=>{
 const rule={id:'selected',origin:'https://example.com',scope:'site',path:'/',enabled:false,tableId:'crimson-desert'};
 const h=await harness({rules:[rule]});
 const library=await h.library(),table=library.tables[0],existing=structuredClone(table.entries);
 h.candidates([existing[0].en,'Append fresh original']);
 const result=await h.send({type:'collectionBegin',tabId:1,mode:'append',tableId:table.id});
 assert.equal(result.error,undefined);const s=result.collection;
 assert.equal(s.tableId,table.id);assert.equal(s.needsCreate,false);assert.equal(s.firstSaved,1);
 let saved=await h.library();assert.equal(saved.tables.length,1);assert.deepEqual(saved.tables[0].entries.slice(0,existing.length),existing);
 assert.equal(saved.tables[0].entries.at(-1).ko,'');assert.equal(saved.tables[0].entries.at(-1).status,'untranslated');
 h.mode('offline');await update(h,s,['Durable append original']);
 await h.send({type:'collectionStop',tabId:1});
 const other=structuredClone(saved.tables[0]);other.id='other';other.name='Other';other.entries=[];saved.tables.push(other);
 h.mode('ok');assert.equal((await h.send({type:'librarySave',library:saved})).error,undefined);
 await h.send({type:'selectTable',url:'https://example.com/page',tableId:'other'});
 h.restart();const retried=await h.send({type:'collectionRetry',tabId:1});
 assert.equal(retried.collection.tableId,table.id);assert.equal(retried.collection.pending.length,0);
 saved=await h.library();assert.equal(saved.tables.find(t=>t.id==='other').entries.length,0);
 assert.equal(saved.tables[0].entries.at(-1).en,'Durable append original');
 assert.deepEqual(saved.tables[0].entries.slice(0,existing.length),existing);
 assert.equal(h.store.rules[0].tableId,'other');
});

test('append requires a current explicit selection and never creates a fallback table',async()=>{
 const h=await harness({rules:[]}),before=await h.library();
 assert.ok((await h.send({type:'collectionBegin',tabId:1,mode:'append',tableId:'crimson-desert'})).error);
 assert.deepEqual(await h.library(),before);assert.equal(h.requests.length,0);
 assert.equal(h.contentMessages.some(m=>m.type==='captureRead'),false);
});

test('append rejects a stale selection; deletion during offline capture keeps originals without recreating the table',async()=>{
 const h=await harness({rules:[{id:'selection',origin:'https://example.com',scope:'site',path:'/',enabled:false,tableId:'crimson-desert'}]});
 assert.ok((await h.send({type:'collectionBegin',tabId:1,mode:'append',tableId:'deleted'})).error);
 assert.equal(h.contentMessages.some(m=>m.type==='captureRead'),false);
 const {collection:s}=await h.send({type:'collectionBegin',tabId:1,mode:'append',tableId:'crimson-desert'});
 h.mode('offline');await update(h,s,['Retain after append deletion']);
 await h.send({type:'collectionStop',tabId:1});h.mode('ok');
 const library=await h.library();library.tables=[];
 assert.equal((await h.send({type:'librarySave',library})).error,undefined);
 h.restart();const result=await h.send({type:'collectionRetry',tabId:1});
 assert.equal(result.collection.tableId,'crimson-desert');assert.ok(result.collection.error);
 assert.deepEqual(Array.from(result.collection.pending),['Retain after append deletion']);
 assert.equal(h.requests.at(-1).createName,undefined);assert.equal((await h.library()).tables.length,0);
 assert.ok((await h.send({type:'collectionBegin',tabId:1,mode:'append',tableId:'crimson-desert'})).error);
});

test('collection icons and tooltip are per tab, change on explicit or content stop and keep badges empty',async()=>{
 const h=await harness();const {collection:s}=await begin(h);
 assert.equal(h.badges.get(1),'');assert.equal(h.icons.get(1)[16],'icons/active-16.png');assert.equal(s.active,true);
 await h.send({type:'collectionBegin',tabId:2,tableId:'crimson-desert'});
 await h.send({type:'collectionWatch',tabId:1});await h.send({type:'collectionWatch',tabId:2});
 assert.equal(h.icons.get(1)[16],'icons/active-16.png');assert.equal(h.icons.get(2)[16],'icons/active-16.png');assert.match(h.titles.get(1),/수집 중/);
 await update(h,s,['Menu'],{active:false,reason:'DOM 스캔 20회 제한'});
 assert.equal(h.icons.get(1)[16],'icons/normal-16.png');assert.doesNotMatch(h.titles.get(1),/수집 중/);assert.equal(h.icons.get(2)[16],'icons/active-16.png');
 await h.send({type:'collectionStop',tabId:2});assert.equal(h.badges.get(2),'');assert.equal(h.icons.get(2)[16],'icons/normal-16.png');
 assert.equal((await h.send({type:'collectionState',tabId:1})).collection.saved,2);
});

test('worker boot restores icons only for the same live document and session without capture scans or new DB',async()=>{
 const h=await harness();await begin(h);await h.send({type:'collectionWatch',tabId:1});
 h.badges.clear();h.titles.clear();h.icons.clear();const requests=h.requests.length,from=h.contentMessages.length;
 h.restart();let r=await h.send({type:'collectionState',tabId:1});
 assert.equal(r.collection.active,true);assert.equal(h.badges.get(1),'');assert.equal(h.icons.get(1)[16],'icons/active-16.png');
 assert.deepEqual(h.contentMessages.slice(from).map(m=>m.type),['captureStatus']);assert.equal(h.requests.length,requests);
 h.replaceDocument();h.restart();r=await h.send({type:'collectionState',tabId:1});
 assert.equal(r.collection.active,false);assert.equal(h.badges.get(1),'');assert.equal(h.icons.get(1)[16],'icons/normal-16.png');assert.equal(r.collection.saved,1);
 assert.equal(h.requests.length,requests);
});

test('restart retires a missing receiver or mismatched session while retaining pending originals',async t=>{
 for(const mode of ['closed','other session','stopped'])await t.test(mode,async()=>{
  const h=await harness();const {collection:s}=await begin(h);await h.send({type:'collectionWatch',tabId:1});
  h.mode('offline');await update(h,s,['Pending']);
  h.connect(async m=>{assert.equal(m.type,'captureStatus');if(mode==='closed')throw Error('No tab');return {documentId:s.documentId,url:s.url,sessionId:mode==='other session'?'other':s.id,active:mode!=='stopped'};});
  h.restart();const r=await h.send({type:'collectionState',tabId:1});
  assert.equal(r.collection.active,false);assert.equal(h.badges.get(1),'');assert.deepEqual(Array.from(r.collection.pending),['Pending']);
 });
});

test('active offline collection has a warning icon; navigation and close restore normal and action rejection cannot lose data',async()=>{
 const h=await harness();let {collection:s}=await begin(h);await h.send({type:'collectionWatch',tabId:1});

 h.mode('offline');await update(h,s,['Pending menu']);assert.equal(h.badges.get(1),'');assert.equal(h.icons.get(1)[16],'icons/warning-16.png');assert.match(h.titles.get(1),/저장 실패.*미저장/);
 assert.equal((await h.send({type:'collectionState',tabId:1})).collection.active,true);
 h.badgeFailure(true);h.mode('ok');let r=await h.send({type:'collectionRetry',tabId:1});
 assert.equal(r.error,undefined);assert.equal(r.collection.saved,2);assert.equal(r.collection.pending.length,0);
 h.badgeFailure(false);h.navigate();r=await h.send({type:'collectionState',tabId:1});assert.equal(r.collection.active,false);assert.equal(h.badges.get(1),'');assert.equal(h.icons.get(1)[16],'icons/normal-16.png');
 s=(await begin(h)).collection;await h.send({type:'collectionWatch',tabId:1});assert.equal(h.badges.get(1),'');assert.equal(h.icons.get(1)[16],'icons/active-16.png');
 h.close();r=await h.send({type:'collectionState',tabId:1});assert.equal(r.collection.active,false);assert.equal(r.collection.closed,true);assert.equal(h.icons.has(1),false);
 assert.equal(r.collection.tableId,s.tableId);
});

test('modeled worker restarts never retarget a closed session; callback-only failures are consumed and originals retry',async()=>{
 const h=await harness();const {collection:s}=await begin(h);
 h.mode('offline');await update(h,s,['Keep pending']);
 h.badgeFailure('setIcon');await h.send({type:'collectionStop',tabId:1});
 assert.deepEqual(h.unchecked,[],'lastError was read within callback lifetime');
 const originals=structuredClone(h.store.collections[1].originals);
 h.close();await h.send({type:'collectionState',tabId:1});
 const actions=h.actionCalls.filter(call=>call.tabId===1).length,messages=h.contentMessages.length,requests=h.requests.length;
 for(let i=0;i<3;i++){h.restart();const {collection}=await h.send({type:'collectionState',tabId:1});assert.equal(collection.closed,true);assert.deepEqual(Array.from(collection.pending),['Keep pending']);}
 assert.equal(h.actionCalls.filter(call=>call.tabId===1).length,actions);assert.equal(h.contentMessages.length,messages);assert.equal(h.requests.length,requests);
 assert.match((await h.send({type:'collectionWatch',tabId:1})).error,/닫혔/);
 await h.send({type:'collectionStop',tabId:1});assert.equal(h.contentMessages.length,messages);
 h.mode('ok');const {collection}=await h.send({type:'collectionRetry',tabId:1});
 assert.equal(collection.pending.length,0);assert.equal(collection.closed,true);assert.deepEqual(Array.from(collection.originals),originals);
 assert.equal(h.actionCalls.filter(call=>call.tabId===1).length,actions);assert.deepEqual(h.unchecked,[]);
});

test('unexpected presentation lookup failure preserves collection save success and remains retryable',async()=>{
 const h=await harness();h.lookupFailure('Transient browser failure');
 const {collection,error}=await begin(h);assert.equal(error,undefined);assert.equal(collection.saved,1);assert.equal(collection.closed,undefined);
 h.mode('offline');await update(h,collection,['Retain this']);assert.deepEqual(h.store.collections[1].pending,['Retain this']);
 h.restart();const {collection:recovered}=await h.send({type:'collectionState',tabId:1});assert.equal(recovered.closed,undefined);assert.deepEqual(Array.from(recovered.pending),['Retain this']);
 h.lookupFailure(null);h.mode('ok');const result=await h.send({type:'collectionRetry',tabId:1});assert.equal(result.error,undefined);assert.equal(result.collection.saved,2);assert.deepEqual(h.unchecked,[]);
});

test('watch respects an immediate content limit and restores normal after a failed start',async()=>{
 const h=await harness();const {collection:s}=await begin(h);
 h.connect(async m=>{if(m.type==='captureStart')return {documentId:s.documentId,url:s.url,active:false,reason:'원문 용량 제한',candidates:['Last limit snapshot']};return {documentId:s.documentId,url:s.url};});
 let r=await h.send({type:'collectionWatch',tabId:1});assert.equal(r.collection.active,false);assert.match(r.collection.reason,/용량 제한/);assert.equal(h.badges.get(1),'');assert.equal(r.collection.saved,2);
 h.connect(async m=>{if(m.type==='captureStart')throw Error('connection closed');return {documentId:s.documentId,url:s.url};});
 r=await h.send({type:'collectionWatch',tabId:1});assert.match(r.error,/connection closed/);assert.equal(h.badges.get(1),'');
});

test('fresh collection creates a separate table and preserves every original existing row',async()=>{
 const h=await harness(),before=(await h.send({type:'state'})).library.tables[0].entries;
 const {collection:s,error}=await begin(h);assert.equal(error,undefined);
 assert.equal(s.firstSaved,1);assert.equal(s.saved,1);assert.equal(s.total,1);
 assert.deepEqual((await h.library()).tables[0].entries,structuredClone(before));
 assert.notEqual(s.tableId,'crimson-desert');
 assert.equal((await h.library()).tables[1].entries[0].ko,'');assert.equal((await h.library()).tables[1].entries[0].status,'untranslated');
 assert.equal(h.requests.length,1);
});

test('incremental collection survives popup closure/reopening and worker restart; no-op updates do no DB or storage writes',async()=>{
 const h=await harness();let {collection:s}=await begin(h);
 await h.send({type:'collectionWatch',tabId:1});h.restart();
 let r=await update(h,s,['Fresh source','Menu source','menu source']);
 assert.equal(r.collection.firstSaved,1);assert.equal(r.collection.additionalSaved,1);assert.equal(r.collection.saved,2);assert.equal(r.collection.total,2);
 h.restart();r=await h.send({type:'collectionState',tabId:1});assert.equal(r.collection.saved,2);assert.equal(r.collection.active,true);
 const count=h.requests.length,writes=h.writes;await update(h,s,['Menu source']);assert.equal(h.requests.length,count);assert.equal(h.writes,writes);
});

test('offline originals persist and retry reuses generated table ID, without reporting unsaved rows as saved',async()=>{
 const h=await harness();h.mode('offline');
 let r=await h.send({type:'collectionBegin',tabId:1,createName:'New table'});const id=r.collection.tableId;
 assert.equal(r.collection.saved,0);assert.equal(r.collection.pending.length,1);assert.match(r.collection.error,/저장 실패/);
 h.restart();r=await h.send({type:'collectionState',tabId:1});assert.equal(r.collection.tableId,id);
 assert.equal(r.collection.createName,'New table');assert.equal(r.collection.needsCreate,true);
 h.mode('ok');r=await h.send({type:'collectionRetry',tabId:1});assert.equal(r.collection.saved,1);assert.equal(r.collection.pending.length,0);
 assert.equal(h.requests[1].tableId,id);assert.equal((await h.library()).tables.length,2);
 assert.equal(h.requests[1].createName,'New table');assert.equal(r.collection.createName,undefined);
});

test('confirmed creation loses create authority and deletion cannot trigger a re-creation request',async()=>{
 const h=await harness();let {collection:s}=await h.send({type:'collectionBegin',tabId:1,createName:'Temporary table'});
 const id=s.tableId;
 assert.equal(s.createName,undefined);
 await h.send({type:'collectionWatch',tabId:1});h.mode('offline');
 await update(h,s,['Pending after creation']);await h.send({type:'collectionStop',tabId:1});
 h.mode('ok');const edited=await h.library();edited.tables=edited.tables.filter(t=>t.id!==id);assert.equal((await h.send({type:'librarySave',library:edited})).error,undefined);
 // Also cover sessions persisted by the old worker before it cleared authority.
 h.store.collections['1'].createName='Temporary table';h.restart();
 s=(await h.send({type:'collectionState',tabId:1})).collection;
 assert.equal(s.createName,undefined);
 const requests=h.requests.length;h.mode('ok');
 const result=await h.send({type:'collectionRetry',tabId:1});
 assert.equal(h.requests.length,requests+1);
 assert.equal(h.requests.at(-1).createName,undefined);
 assert.deepEqual(Array.from(result.collection.pending),['Pending after creation']);
 assert.match(result.collection.error,/삭제|없어/);
 assert.equal((await h.library()).tables.some(t=>t.id===id),false);
});

test('reject unsolicited, wrong tab/frame/document/session and stopped or navigated updates',async()=>{
 const h=await harness();assert.ok((await update(h,{id:'fake',url:'https://example.com/page',documentId:'doc'},['Unsafe'])).error);
 const {collection:s}=await begin(h);await h.send({type:'collectionWatch',tabId:1});
 for(const overrides of [{frameId:1},{documentId:'other'},{tab:{id:2}},{url:'https://example.com/other'}]){
  const sender={...h.sender(),...overrides};assert.ok((await h.send({type:'collectionUpdate',sessionId:s.id,documentId:s.documentId,url:s.url,candidates:['Unsafe']},sender)).error);
 }
 assert.ok((await update(h,{...s,id:'old'},['Unsafe'])).error);
 assert.ok((await update(h,{...s,documentId:'old'},['Unsafe'])).error);
 await h.send({type:'collectionStop',tabId:1});assert.ok((await update(h,s,['Unsafe'])).error);
 await h.send({type:'collectionWatch',tabId:1});h.navigate();await h.send({type:'collectionState',tabId:1});assert.ok((await update(h,s,['Unsafe'])).error);
 assert.ok((await h.send({type:'collectionWatch',tabId:1})).error);assert.equal(h.requests.length,1);
});

test('closed tab stops collection and keeps pending originals for retry',async()=>{
 const h=await harness();const {collection:s}=await begin(h);await h.send({type:'collectionWatch',tabId:1});h.mode('offline');await update(h,s,['Pending menu']);h.close();
 const {collection:r}=await h.send({type:'collectionState',tabId:1});assert.equal(r.active,false);assert.equal(r.pending[0],'Pending menu');assert.match(r.reason,/닫혔/);
 h.mode('ok');assert.equal((await h.send({type:'collectionRetry',tabId:1})).collection.saved,2);
});

test('authorized stop flushes the final dirty content snapshot before saving',async()=>{
 const h=await harness();const {collection:s}=await begin(h);await h.send({type:'collectionWatch',tabId:1});
 h.candidates(['Fresh source','Last dirty menu']);
 const r=await h.send({type:'collectionStop',tabId:1});assert.equal(r.collection.saved,2);assert.equal(r.collection.active,false);
 assert.ok((await update(h,s,['After stop'])).error);
});

test('offline dynamic updates persist without repeated DB until explicit retry',async()=>{
 const h=await harness();const {collection:s}=await begin(h);await h.send({type:'collectionWatch',tabId:1});h.mode('offline');
 await update(h,s,['First pending']);const calls=h.requests.length;
 for(let n=0;n<10;n++)await update(h,s,['Pending '+n]);
 assert.equal(h.requests.length,calls);
 let r=await h.send({type:'collectionState',tabId:1});assert.equal(r.collection.pending.length,11);assert.equal(r.collection.saved,1);
 await h.send({type:'collectionStop',tabId:1});assert.equal(h.requests.length,calls);assert.equal(h.badges.get(1),'');assert.doesNotMatch(h.titles.get(1),/수집 중/);
 h.mode('ok');r=await h.send({type:'collectionRetry',tabId:1});assert.equal(r.collection.saved,12);assert.equal(r.collection.pending.length,0);
});

test('content publishes incremental menus with popup absent and a new explicit collection takes a fresh same-document snapshot',async()=>{
 const h=await harness(),d=new JSDOM('<body><p>Initial</p><p id="menu" hidden>Menu opened</p></body>',{url:'https://example.com/page',runScripts:'outside-only'});
 let listener;
 d.window.chrome={runtime:{id:'test',getManifest:()=>({version:'test'}),onMessage:{addListener:fn=>listener=fn},sendMessage:m=>h.send(m,h.sender())},storage:{onChanged:{addListener(){}}}};
 const send=m=>new Promise(resolve=>listener(m,{id:'test',url:'chrome-extension://test/popup.html'},resolve));
 try{
  for(const f of ['shared.js','library.js','engine.js','content.js'])d.window.eval(await source(f));
  await new Promise(r=>setTimeout(r,0));h.connect(send);
  let {collection:s}=await begin(h);assert.deepEqual(Array.from(s.originals),['Initial']);
  assert.equal(s.active,true);h.restart();
  d.window.document.querySelector('#menu').hidden=false;await new Promise(r=>setTimeout(r,1150));
  s=(await h.send({type:'collectionState',tabId:1})).collection;assert.equal(s.saved,2);assert.equal(s.additionalSaved,1);
  const requests=h.requests.length;d.window.document.querySelector('#menu').className='no-new-text';await new Promise(r=>setTimeout(r,1150));assert.equal(h.requests.length,requests);
  await h.send({type:'collectionStop',tabId:1});d.window.document.body.innerHTML='<p>Fresh explicit click</p>';
  s=(await begin(h)).collection;assert.deepEqual(Array.from(s.originals),['Fresh explicit click']);assert.equal(s.firstSaved,1);
 }finally{d.window.close();}
});

export {harness};

test('warning survives a live worker restart; successful retry restores active; stopped pending remains readable and normal',async()=>{
 const h=await harness();const {collection:s}=await begin(h);
 h.mode('offline');await update(h,s,['Offline original']);
 const calls=h.requests.length,from=h.contentMessages.length;
 h.icons.clear();h.restart();await h.send({type:'collectionState',tabId:1});
 assert.equal(h.icons.get(1)[16],'icons/warning-16.png');assert.equal(h.requests.length,calls);
 assert.deepEqual(h.contentMessages.slice(from).map(m=>m.type),['captureStatus']);
 h.mode('ok');await h.send({type:'collectionRetry',tabId:1});
 assert.equal(h.icons.get(1)[16],'icons/active-16.png');assert.doesNotMatch(h.titles.get(1),/저장 실패/);
 h.mode('offline');await update(h,s,['Another original']);
 await h.send({type:'collectionStop',tabId:1});
 assert.equal(h.icons.get(1)[16],'icons/normal-16.png');assert.match(h.titles.get(1),/미저장 원문 보관.*재시도/);
 assert.doesNotMatch(h.titles.get(1),/수집 중/);
 h.restart();const r=await h.send({type:'collectionState',tabId:1});
 assert.equal(h.icons.get(1)[16],'icons/normal-16.png');assert.deepEqual(Array.from(r.collection.pending),['Another original']);
 h.mode('ok');await h.send({type:'collectionRetry',tabId:1});
 assert.equal(h.icons.get(1)[16],'icons/normal-16.png');assert.doesNotMatch(h.titles.get(1),/미저장|저장 실패/);
 assert.ok([...h.badges.values()].every(value=>value===''));
});

test('each action API can reject independently without suppressing the other presentation or collection saves',async t=>{
 for(const method of ['setIcon','setBadgeText','setTitle'])await t.test(method,async()=>{
  const h=await harness();h.badgeFailure(method);
  const {collection:s,error}=await begin(h);assert.equal(error,undefined);assert.equal(s.saved,1);assert.equal(s.active,true);
  if(method!=='setIcon')assert.equal(h.icons.get(1)[16],'icons/active-16.png');
  if(method!=='setBadgeText')assert.equal(h.badges.get(1),'');
  if(method!=='setTitle')assert.match(h.titles.get(1),/수집 중/);
  h.mode('offline');const failed=await update(h,s,['Pending despite action rejection']);
  assert.deepEqual(Array.from(failed.collection.pending),['Pending despite action rejection']);
  h.mode('ok');const retried=await h.send({type:'collectionRetry',tabId:1});assert.equal(retried.collection.saved,2);
  assert.equal(retried.collection.pending.length,0);
  assert.deepEqual(h.unchecked,[],'each action callback consumes its lastError');
 });
});

test('historical session destination and pending originals survive restart and cannot be overwritten by fresh capture',async()=>{
 const h=await harness();await begin(h);
 Object.assign(h.store.collections['1'],{tableId:'crimson-desert',tableName:'Historical table',pending:['Legacy pending'],error:'offline',active:false});
 const historical=structuredClone(h.store.collections['1']);
 h.restart();
 assert.deepEqual(structuredClone((await h.send({type:'collectionState',tabId:1})).collection),historical);
 assert.ok((await h.send({type:'collectionBegin',tabId:1})).error);
 assert.deepEqual(h.store.collections['1'],historical);
 const retried=await h.send({type:'collectionRetry',tabId:1});
 assert.equal(retried.collection.tableId,'crimson-desert');assert.equal(retried.collection.pending.length,0);
 assert.equal(h.requests.at(-1).tableId,'crimson-desert');assert.deepEqual(h.requests.at(-1).candidates,['Legacy pending']);
});

test('applied A remains unchanged while each new capture creates distinct B and later watch appends only B',async()=>{
 const rule={id:'a-rule',origin:'https://example.com',scope:'site',path:'/',enabled:true,tableId:'crimson-desert',matchMode:'exact',caseSensitive:false,fitText:{enabled:false,fontScale:1,lineHeight:0}};
 const h=await harness({rules:[rule]});
 const before=structuredClone((await h.send({type:'state'})).library.tables[0]);
 let {collection:b}=await h.send({type:'collectionBegin',tabId:1});
 assert.notEqual(b.tableId,rule.tableId);assert.match(b.tableName,/^example.com \d{4}-\d{2}-\d{2}$/);
 await h.send({type:'collectionWatch',tabId:1});await update(h,b,['Extra in B']);await h.send({type:'collectionStop',tabId:1});
 assert.deepEqual(h.store.rules,[rule]);assert.deepEqual((await h.library()).tables[0],before);
 assert.equal((await h.library()).tables.find(t=>t.id===b.tableId).entries.length,2);
 const {collection:c}=await h.send({type:'collectionBegin',tabId:1,tableId:b.tableId});
 assert.notEqual(c.tableId,b.tableId);assert.notEqual(c.tableId,rule.tableId);
 assert.equal((await h.library()).tables.find(t=>t.id===b.tableId).entries.length,2);
 assert.deepEqual(h.store.rules,[rule]);assert.deepEqual((await h.library()).tables[0],before);
});

test('editor messages preserve edits during later collection and reject a stale draft',async()=>{
 const h=await harness();const before=await h.library();
 const {collection:s}=await begin(h);const stale=await h.library();
 const edited=structuredClone(stale),entry=edited.tables.find(t=>t.id===s.tableId).entries[0];
 entry.ko='Manager edit';entry.status='review';entry.notes='Retained manager note';
 assert.equal((await h.send({type:'librarySave',library:edited})).error,undefined);
 await update(h,s,['Additional DB source']);
 assert.match((await h.send({type:'librarySave',library:stale})).error,/충돌/);
 h.restart();const library=await h.library();
 assert.deepEqual(library.tables[0],before.tables[0]);
 const table=library.tables.find(t=>t.id===s.tableId);assert.equal(table.entries.length,2);
 assert.equal(table.entries[0].ko,'Manager edit');assert.equal(table.entries[0].notes,'Retained manager note');
});

test('worker loss after DB commit recovers original batch receipt before saving newly observed originals',async()=>{
 const h=await harness(),{collection:s}=await begin(h),batch=structuredClone(h.requests[0]);
 // The worker disappeared after its DB commit, before its local session ack.
 Object.assign(h.store.collections['1'],{saved:0,firstSaved:null,total:0,additionalSaved:0,needsCreate:true,createName:s.tableName,pending:['Fresh source'],pendingBatch:batch});
 h.restart();
 const result=await update(h,s,['Fresh source','After worker loss']);
 assert.equal(result.error,undefined);assert.equal(result.collection.firstSaved,1);assert.equal(result.collection.saved,2);
 assert.equal(result.collection.additionalSaved,1);assert.equal(result.collection.pending.length,0);
 assert.equal((await h.library()).tables.find(t=>t.id===s.tableId).entries.length,2);
});

test('new scan immediately watches; offline retries preserve bounded first-read source and completion never rescans saved rows',async()=>{
 const h=await harness();let active=false;
 const url='https://example.com/docs?private=1#fragment';
 h.connect(async m=>{
  if(m.type==='captureStart')active=true;
  if(m.type==='captureStop')active=false;
  return {documentId:'doc',url,title:m.fresh?'T'.repeat(600):'Changed title',language:'en',candidates:['Initial'],active};
 });
 h.mode('offline');const {collection:s}=await begin(h);
 assert.equal(s.active,true);assert.equal(s.saved,0);assert.equal(s.source.url,'https://example.com/docs');
 assert.equal(s.source.title.length,500);assert.equal(s.source.language,'en');assert.ok(Number.isFinite(Date.parse(s.source.capturedAt)));
 h.restart();h.mode('ok');const retried=await h.send({type:'collectionRetry',tabId:1});
 assert.equal(retried.collection.saved,1);assert.deepEqual(h.requests[1].source,h.requests[0].source);
 const requests=h.requests.length;await h.send({type:'collectionStop',tabId:1});
 assert.equal(h.requests.length,requests);assert.equal(h.badges.get(1),'');
 assert.deepEqual(h.contentMessages.slice(-1).map(m=>m.type),['captureStop']);
});
