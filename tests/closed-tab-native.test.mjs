import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {copyNativeExtension} from './native-fixture.mjs';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,createHash} from 'node:crypto';

// Real extension APIs in a disposable profile. No production server or user profile.
test('native Chromium consumes closed-tab action errors and retires stale presentation', {skip:!process.env.TEXT_PATCH_CHROME,timeout:30000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'closed-tab-'));let child,ws;
 try{
  const ext=path.join(dir,'extension');await copyNativeExtension(ext);
  const key=generateKeyPairSync('rsa',{modulusLength:1024}).publicKey.export({type:'spki',format:'der'});
  const id=[...createHash('sha256').update(key).digest().subarray(0,16)].map(b=>String.fromCharCode(97+(b>>4),97+(b&15))).join('');
  const manifest=JSON.parse(await readFile(path.join(ext,'manifest.json'),'utf8'));
  manifest.key=key.toString('base64');delete manifest.background;manifest.permissions.push('tabs');
  await writeFile(path.join(ext,'manifest.json'),JSON.stringify(manifest));
  await writeFile(path.join(ext,'probe.html'),'<meta charset="utf-8"><script src="locales/ko.js"></script><script src="locales/en.js"></script><script src="i18n.js"></script><script src="shared.js"></script><script src="library.js"></script><script src="collection.js"></script><script src="repository.js"></script><script src="probe.js"></script><script src="background.js"></script>');
  await writeFile(path.join(ext,'probe.js'),'globalThis.importScripts=()=>{};');
  child=spawn(process.env.TEXT_PATCH_CHROME,['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+path.join(dir,'profile'),'--disable-extensions-except='+ext,'--load-extension='+ext,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let port;for(let i=0;i<100;i++){try{port=Number((await readFile(path.join(dir,'profile','DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await new Promise(r=>setTimeout(r,50));}}
  assert.ok(port,'isolated debugger starts');
  const version=await(await fetch('http://127.0.0.1:'+port+'/json/version')).json();console.log('native browser:',version.Browser);
  ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let seq=0;const pending=new Map(),logs=[];
  ws.onmessage=e=>{const d=JSON.parse(e.data);if(d.method==='Log.entryAdded')logs.push(d.params.entry.text);if(d.method==='Runtime.consoleAPICalled')logs.push(d.params.args.map(a=>a.value||a.description).join(' '));const p=pending.get(d.id);if(p){pending.delete(d.id);d.error?p.reject(Error(d.error.message)):p.resolve(d.result);}};
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  const command=(m,p)=>send(m,p,sessionId);
  await command('Runtime.enable');await command('Log.enable');await command('Page.enable');await command('Page.navigate',{url:`chrome-extension://${id}/probe.html`});
  const evaluate=async expression=>{const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert.equal(r.exceptionDetails,undefined,JSON.stringify(r.exceptionDetails));return r.result.value;};
  for(let i=0;i<100;i++){if(await evaluate('typeof collectionAppearance === "function"'))break;await new Promise(r=>setTimeout(r,50));}
  await evaluate('queue');
  // Native positive control: awaiting an undefined callback-only result cannot catch lastError.
  const control=logs.length;
  const returns=await evaluate(`(async()=>{const result=chrome.action.setIcon({tabId:628993559,path:'icons/normal-16.png'});await result;await new Promise(r=>setTimeout(r,100));return typeof result;})()`);
  console.log('native setIcon return:',returns,'control:',logs.slice(control));
  assert.ok(logs.slice(control).some(s=>/Unchecked runtime.lastError: No tab with id: 628993559/.test(s)),'native control observes exact user symptom');
  const start=logs.length;
  const callbackError=await evaluate(`actionCall('setIcon',{tabId:628993559,path:'icons/normal-16.png'}).then(()=>null,e=>e.message)`);
  assert.match(callbackError,/No tab with id: 628993559/,'callback adapter receives native error');
  // Real tab closes after a successful native get, before the action call.
  const race=await evaluate(`(async()=>{const tab=await chrome.tabs.create({url:'about:blank',active:false});const get=chrome.tabs.get;chrome.tabs.get=async id=>{const found=await get(id);await chrome.tabs.remove(id);return found;};const session={tabId:tab.id,active:true,pending:['Race original'],originals:['Race original']};try{await collectionAppearance(session);}finally{chrome.tabs.get=get;}return session;})()`);
  assert.equal(race.closed,true);assert.equal(race.active,false);assert.deepEqual(race.pending,['Race original']);
  await evaluate(`(async()=>{globalThis.fixture={tabId:628993559,id:'stale',tableId:'pending-table',active:true,documentId:'old',url:'https://example.com/',pending:['Keep original'],originals:['Keep original'],needsCreate:true,createName:'Unsaved',error:'offline'};await chrome.storage.local.set({collections:{628993559:fixture}});await reconcileCollections();await reconcileCollections();await new Promise(r=>setTimeout(r,100));})()`);
  const errors=logs.slice(start).filter(s=>/Unchecked runtime.lastError/.test(s));console.log('production closed-tab logs:',errors);
  assert.deepEqual(errors,[],'production must consume native callback errors');
  const stored=await evaluate('(async()=> (await chrome.storage.local.get("collections")).collections[628993559])()');
  assert.equal(stored.active,false);assert.deepEqual(stored.pending,['Keep original']);assert.equal(stored.needsCreate,true);
  const repeated=await evaluate(`(async()=>{let calls=0;const get=chrome.tabs.get;chrome.tabs.get=async(...args)=>{calls++;return get(...args);};try{await reconcileCollections();await reconcileCollections();}finally{chrome.tabs.get=get;}return calls;})()`);
  assert.equal(repeated,0,'retired closed sessions are never retargeted');
  const storage=await evaluate(`(async()=>{
    await repository.initialize(async()=>TextPatch.migrate(await(await fetch(chrome.runtime.getURL('data/dictionary.json'))).json()));
    const draft=await repository.get(),stale=structuredClone(draft);draft.tables[0].entries[0].notes='Native DB note';
    const saved=await repository.save(draft);let conflict='';try{await repository.save(stale);}catch(e){conflict=e.message;}
    const put=IDBObjectStore.prototype.put;let writes=0,failure='';
    IDBObjectStore.prototype.put=function(...args){if(++writes===2)throw Error('Native quota fault');return put.apply(this,args);};
    try{await repository.capture({operationId:'native-atomic',tableId:'native-collected',createName:'Native',candidates:['Native original']});}catch(e){failure=e.message;}finally{IDBObjectStore.prototype.put=put;}
    const rolledBack=await repository.get();
    const committed=await repository.capture({operationId:'native-atomic',tableId:'native-collected',createName:'Native',candidates:['Native original']});
    const restarted=LibraryRepository.create(),receipt=await restarted.capture({operationId:'native-atomic',tableId:'native-collected',createName:'Native',candidates:['Native original']});
    return {revision:saved.revision,note:(await restarted.get()).tables[0].entries[0].notes,conflict,failure,rolledBack:rolledBack.tables.length,added:committed.added,recovered:receipt.added,total:receipt.total};
  })()`);
  assert.equal(storage.revision,2);assert.equal(storage.note,'Native DB note');assert.match(storage.conflict,/충돌/);assert.match(storage.failure,/quota/);
  assert.equal(storage.rolledBack,1);assert.equal(storage.added,1);assert.equal(storage.recovered,1);assert.equal(storage.total,1);
  console.log('native IndexedDB: conflict rejected; failed row+receipt transaction rolled back; restart receipt recovered exactly once');
 }finally{ws?.close();if(child && child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('native service worker cold boots retire stale collections once and preserve originals', {skip:!process.env.TEXT_PATCH_CHROME,timeout:30000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'closed-worker-'));let child,ws;
 try{
  const ext=path.join(dir,'extension');await copyNativeExtension(ext);
  const key=generateKeyPairSync('rsa',{modulusLength:1024}).publicKey.export({type:'spki',format:'der'});
  const id=[...createHash('sha256').update(key).digest().subarray(0,16)].map(b=>String.fromCharCode(97+(b>>4),97+(b&15))).join('');
  const manifest=JSON.parse(await readFile(path.join(ext,'manifest.json'),'utf8'));manifest.key=key.toString('base64');manifest.background.service_worker='native-worker.js';
  await writeFile(path.join(ext,'manifest.json'),JSON.stringify(manifest));
  await writeFile(path.join(ext,'native-worker.js'),`globalThis.nativeCalls=[];for(const [api,methods] of [[chrome.tabs,['get','sendMessage']],[chrome.action,['setIcon','setTitle','setBadgeText']]])for(const method of methods){const original=api[method];api[method]=function(...args){if(method!=='setTitle'||args[0]?.tabId!==undefined)nativeCalls.push(method);return original.apply(this,args);};}importScripts('background.js');`);
  await writeFile(path.join(ext,'popup.html'),'<!doctype html><title>Native worker lifecycle probe</title>');
  child=spawn(process.env.TEXT_PATCH_CHROME,['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+path.join(dir,'profile'),'--disable-extensions-except='+ext,'--load-extension='+ext,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let port;for(let i=0;i<100;i++){try{port=Number((await readFile(path.join(dir,'profile','DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await new Promise(r=>setTimeout(r,50));}}assert.ok(port);
  const version=await(await fetch('http://127.0.0.1:'+port+'/json/version')).json();ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let seq=0;const pending=new Map(),versions=new Map();
  ws.onmessage=e=>{const d=JSON.parse(e.data);if(d.method==='ServiceWorker.workerVersionUpdated')for(const v of d.params.versions)versions.set(v.versionId,v);const p=pending.get(d.id);if(p){pending.delete(d.id);d.error?p.reject(Error(d.error.message)):p.resolve(d.result);}};
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));});
  const {targetId}=await send('Target.createTarget',{url:`chrome-extension://${id}/popup.html`}),page=(await send('Target.attachToTarget',{targetId,flatten:true})).sessionId;
  await send('Runtime.enable',{},page);await send('ServiceWorker.enable',{},page);
  const evaluate=async(expression,session=page)=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},session);assert.equal(r.exceptionDetails,undefined,JSON.stringify(r.exceptionDetails));return r.result.value;};
  for(let i=0;i<100;i++){if(await evaluate('typeof chrome.storage !== "undefined"'))break;await new Promise(r=>setTimeout(r,50));}
  const worker=async()=>{for(let i=0;i<100;i++){const target=(await send('Target.getTargets')).targetInfos.find(t=>t.type==='service_worker'&&t.url===`chrome-extension://${id}/native-worker.js`);if(target)return target;await new Promise(r=>setTimeout(r,50));}assert.fail('native worker target missing');};
  const stop=async()=>{
   let v;for(let i=0;i<100;i++){v=[...versions.values()].find(v=>v.scriptURL===`chrome-extension://${id}/native-worker.js`&&v.runningStatus==='running');if(v)break;await new Promise(r=>setTimeout(r,50));}assert.ok(v,'native service worker version observed');
   await send('ServiceWorker.stopWorker',{versionId:v.versionId},page);
   for(let i=0;i<100;i++){if(!(await send('Target.getTargets')).targetInfos.some(t=>t.type==='service_worker'&&t.url===`chrome-extension://${id}/native-worker.js`))return;await new Promise(r=>setTimeout(r,50));}assert.fail('worker did not stop');
  };
  await worker();await stop();
  await evaluate(`chrome.storage.local.set({collections:{628993559:{tabId:628993559,id:'stale',tableId:'pending-table',active:true,documentId:'old',url:'https://example.com/',pending:['Native original'],originals:['Native original'],needsCreate:true,createName:'Unsaved',error:'offline'}}})`);
  let lastTarget;
  for(let boot=0;boot<2;boot++){
   await evaluate(`chrome.runtime.sendMessage({type:'collectionState',tabId:628993559})`);
   const target=await worker();assert.notEqual(target.targetId,lastTarget,'fresh native worker target');lastTarget=target.targetId;
   const session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
   const result=await evaluate(`(async()=>{await queue;return {calls:nativeCalls,session:(await chrome.storage.local.get('collections')).collections[628993559]};})()`,session);
   assert.equal(result.session.closed,true);assert.equal(result.session.active,false);assert.deepEqual(result.session.pending,['Native original']);assert.equal(result.session.createName,'Unsaved');
   assert.deepEqual(result.calls,boot===0?['get']:[],'only first native boot probes stale tab, no action or messages');
   await send('Target.detachFromTarget',{sessionId:session});if(boot===0)await stop();
  }
  console.log('native worker stop/wake: two fresh worker targets; stale originals retained; repeated API calls zero');
 }finally{ws?.close();if(child&&child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
