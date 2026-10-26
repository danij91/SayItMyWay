// Optional real Chromium-extension API check. Uses only temporary profiles/data.
// ICON_PLAYWRIGHT_MODULE points to an external playwright/index.mjs if needed.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import http from 'node:http';
import {copyNativeExtension} from './native-fixture.mjs';
const {chromium}=await import(pathToFileURL(process.env.ICON_PLAYWRIGHT_MODULE || path.join(os.tmpdir(),'crimson-manager-browser/node_modules/playwright/index.mjs')));
const dir=await mkdtemp(path.join(os.tmpdir(),'crimson-icons-browser-'));
const extension=path.join(dir,'extension');
await copyNativeExtension(extension);
let context;
const fixture=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<html lang="en"><title>Icon fixture</title><body><p>Original browser text</p></body></html>');});
await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+fixture.address().port+'/';
// Grant only the disposable fixture site; no native permission dialog coverage.
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
manifest.host_permissions=[new URL(url).origin+'/*'];
await writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
const results={browser:process.env.ICON_BROWSER_EXE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',fixture:dir,checks:[]};
const launch=()=>chromium.launchPersistentContext(path.join(dir,'profile'),{executablePath:results.browser,headless:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
try{
 context=await launch();
 let worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker',{timeout:15000});
 await worker.evaluate(()=>chrome.storage.local.set({appLocale:'ko'}));
 const id=new URL(worker.url()).host,control=await context.newPage(),page=await context.newPage();
 await control.goto('chrome-extension://'+id+'/popup.html');await page.goto(url);
 const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,url);
 const send=(type)=>control.evaluate(({type,tabId})=>chrome.runtime.sendMessage({type,tabId}),{type,tabId});
 const appearance=()=>worker.evaluate(async tabId=>({title:await chrome.action.getTitle({tabId}),badge:await chrome.action.getBadgeText({tabId})}),tabId);
 const icon=()=>worker.evaluate(()=>iconCalls.at(-1)?.path[16]);
 // Observe and forward native calls: every recorded success passed Chrome's real
 // tab/path validation and PNG decoder. Chrome provides no getIcon API.
 await worker.evaluate(()=>{
  globalThis.iconCalls=[];const native=chrome.action.setIcon.bind(chrome.action);
  chrome.action.setIcon=(details,callback)=>{
   if(callback)return native(details,()=>{
    const error=chrome.runtime.lastError;
    if(!error)iconCalls.push(details);
    // Forward on the native callback stack so lastError is still in scope.
    callback();
   });
   return new Promise((resolve,reject)=>native(details,()=>{
    const error=chrome.runtime.lastError;
    if(error)reject(Error(error.message));
    else{iconCalls.push(details);resolve();}
   }));
  };
 });
 await worker.evaluate(async tabId=>{
  for(const variant of ['normal','active','warning'])for(const size of [16,32,48,128])await chrome.action.setIcon({tabId,path:{[size]:`icons/${variant}-${size}.png`}});
 },tabId);
 results.checks.push('all 12 PNG paths accepted by native action.setIcon');
 let r=await send('collectionBegin');assert.equal(r.error,undefined);assert.equal(r.collection.active,true);
 assert.equal(await icon(),'icons/active-16.png');
 assert.match((await appearance()).title,/수집 중/);assert.equal((await appearance()).badge,'');
 await worker.evaluate(()=>{globalThis.nativePut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw Error('Native quota fixture');};});
 await page.evaluate(()=>{const p=document.createElement('p');p.textContent='Offline pending browser text';document.body.append(p);});
 const deadline=Date.now()+12000;
 while(!(await appearance()).title.includes('저장 실패') && Date.now()<deadline)await new Promise(r=>setTimeout(r,150));
 assert.match((await appearance()).title,/저장 실패.*미저장/);
 assert.equal(await icon(),'icons/warning-16.png');
 r=await send('collectionState');assert.deepEqual(r.collection.pending,['Offline pending browser text']);
 await worker.evaluate(()=>{IDBObjectStore.prototype.put=globalThis.nativePut;delete globalThis.nativePut;});
 r=await send('collectionRetry');assert.equal(r.collection.pending.length,0);assert.equal(r.collection.active,true);
 assert.equal(await icon(),'icons/active-16.png');assert.equal((await appearance()).badge,'');
 await send('collectionStop');assert.doesNotMatch((await appearance()).title,/수집 중|저장 실패/);
 const variants=await worker.evaluate(()=>iconCalls.map(c=>c.path[16]).filter(Boolean));
 assert.ok(variants.includes('icons/warning-16.png'));assert.equal(variants.at(-1),'icons/normal-16.png');
 results.checks.push('actual collection begin, native IndexedDB write failure, retry and stop update toolbar with blank badge; no library server');
 r=await send('collectionBegin');await page.goto(url+'next');
 r=await send('collectionState');assert.equal(r.collection.active,false);assert.equal((await appearance()).badge,'');
 assert.equal(await icon(),'icons/normal-16.png');
 results.checks.push('navigation stops collection and clears active presentation');
 await send('collectionBegin');await page.close();
 r=await send('collectionState');assert.equal(r.collection.active,false);assert.match(r.collection.reason,/닫혔|떠남/);
 results.checks.push('closed tab API failures do not prevent persisted collection shutdown');
 await context.close();context=await launch();
 worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker',{timeout:15000});
 const saved=await worker.evaluate(async()=>await chrome.storage.local.get('collections'));
 assert.equal(saved.collections[String(tabId)].active,false);
 results.checks.push('isolated profile restart retains completed session');
 results.version=context.browser()?.version() || await worker.evaluate(()=>navigator.userAgent);
 results.outcome='passed';
 console.log(JSON.stringify(results,null,2));
}catch(error){
 results.outcome='failed';results.error=error.stack || String(error);throw error;
}finally{
 if(context)await context.close();
 await new Promise(r=>fixture.close(r));
 await writeFile(path.join(dir,'result.json'),JSON.stringify(results,null,2));
}
