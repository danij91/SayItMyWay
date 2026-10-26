// Isolated installed extension, native action popup and local fixture only.
// Host is explicitly pregranted in the copied manifest: OS permission prompt UI
// is outside this test; asynchronous approval/disposal is tested at background seam.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {copyNativeExtension} from './native-fixture.mjs';
const {chromium}=await import(pathToFileURL(process.env.STANDALONE_PLAYWRIGHT_MODULE || path.join(os.tmpdir(),'crimson-manager-browser/node_modules/playwright/index.mjs')));
const live=process.env.CURRENCY_LIVE==='1';
const dir=await mkdtemp(path.join(os.tmpdir(),'crimson-currency-')),extension=path.join(dir,'extension');await copyNativeExtension(extension);
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));manifest.host_permissions=[...(manifest.host_permissions||[]),'http://127.0.0.1/*'];await writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<html><title>Currency fixture</title><body><p id="price">Price 1200원</p><p id="ambiguous">$10</p><input value="1200원"><div contenteditable="true">1200원</div><p id="split"><span>1200</span><b>원</b></p></body></html>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port+'/fixture',result={fixture:dir,screenshots:[],checks:[],network:live?'Actual ECB HTTP in installed service worker':'ECB DNS deliberately unavailable: real installed runtime failure/fallback, not live HTTP verification',permission:'Real runtime gesture and permissions.request on pregranted local host; native approval dialog not tested'};let context;
try{
 context=await chromium.launchPersistentContext(path.join(dir,'profile'),{executablePath:process.env.STANDALONE_BROWSER_EXE || 'C:/Users/danij/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',headless:true,viewport:null,args:['--disable-extensions-except='+extension,'--load-extension='+extension,...(live?[]:['--no-proxy-server','--host-resolver-rules=MAP www.ecb.europa.eu ~NOTFOUND'])]});
 const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');const page=await context.newPage();await page.goto(url);await page.bringToFront();
 const cdp=await context.browser().newBrowserCDPSession();let seq=0;
 async function open(){
  await page.bringToFront();await new Promise(r=>setTimeout(r,200));
  await worker.evaluate(()=>chrome.action.openPopup());let target;
  for(let n=0;n<100&&!target;n++){target=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.url.endsWith('/popup.html'));if(!target)await new Promise(r=>setTimeout(r,30));}assert.ok(target);
  const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{cdp.off('Target.receivedMessageFromTarget',receive);reject(Error(method+' timeout'));},10000);function receive(event){if(event.sessionId!==sessionId)return;const m=JSON.parse(event.message);if(m.id!==id)return;clearTimeout(timer);cdp.off('Target.receivedMessageFromTarget',receive);m.error?reject(Error(m.error.message)):resolve(m.result);}cdp.on('Target.receivedMessageFromTarget',receive);cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(reject);});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert.equal(r.exceptionDetails,undefined,JSON.stringify(r.exceptionDetails));return r.result.value;};
  for(let n=0;n<100;n++){if(await evaluate(`document.readyState==='complete'&&!document.querySelector('#currency-enabled').disabled`))break;await new Promise(r=>setTimeout(r,30));}
  const click=async selector=>{const point=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...point});};
  const key=async(selector,key,code,virtual)=>{await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});e.focus();})()`);await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:virtual,text:code==='Enter'?'\r':key});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtual});};
  return {send,evaluate,click,key,close:async()=>{await cdp.send('Target.closeTarget',{targetId:target.targetId});await new Promise(r=>setTimeout(r,200));}};
 }
 async function until(popup,expression){for(let n=0;n<200;n++){if(await popup.evaluate(expression))return;await new Promise(r=>setTimeout(r,30));}assert.fail('Popup condition: '+expression);}
 async function capture(popup,name){await popup.evaluate(`document.querySelector('#currency-section').scrollIntoView({block:'end'})`);const shot=await popup.send('Page.captureScreenshot'),file=path.join(dir,name+'.png');await writeFile(file,Buffer.from(shot.data,'base64'));result.screenshots.push(file);}
 let popup=await open();assert.equal(await popup.evaluate(`document.querySelector('#enabled').disabled`),true);
 assert.equal(await popup.evaluate(`document.querySelector('#currency-body').hidden`),true);
 await popup.key('#currency-expand','Enter','Enter',13);assert.equal(await popup.evaluate(`document.querySelector('#currency-body').hidden`),false);
 await popup.click('#currency-refresh');await until(popup,`!document.querySelector('#currency-refresh').disabled`);
 const fallback=await popup.evaluate(`(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return (await chrome.runtime.sendMessage({type:'state',url:tab.url})).currencyRates;})()`);
 assert.equal(fallback.status,live?'current':'bundled');assert.equal(fallback.error,!live);assert.equal(await popup.evaluate(`document.querySelector('#currency-enabled').checked`),false);result.checks.push({manualRefreshWhileOff:fallback});
 const rates=await popup.evaluate(`(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return (await chrome.runtime.sendMessage({type:'state',url:tab.url})).page.currencySnapshot.rates;})()`);
 const usd=amount=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(amount*rates.USD/rates.KRW);
 if(!live)assert.equal(usd(1200),'$0.91');
 await popup.click('#currency-expand');
 await popup.click('#currency-enabled');await page.waitForFunction(expected=>document.querySelector('#price').textContent===expected,'Price '+usd(1200));
 assert.equal(await popup.evaluate(`document.querySelector('#currency-body').hidden`),true);
 assert.equal(await page.locator('input').inputValue(),'1200원');assert.equal(await page.locator('[contenteditable]').textContent(),'1200원');assert.equal(await page.locator('#split').textContent(),'1200원');
 await page.evaluate(()=>{const p=document.createElement('p');p.id='dynamic';p.textContent='New 2400원';document.body.append(p);});await page.waitForFunction(expected=>document.querySelector('#dynamic').textContent===expected,'New '+usd(2400));
 const enabledShot=path.join(dir,'fixture-enabled.png');await page.screenshot({path:enabledShot});result.screenshots.push(enabledShot);
 // Public capture interface returns originals in the installed content script.
 const originals=await popup.evaluate(`(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return (await chrome.tabs.sendMessage(tab.id,{type:'captureRead'})).candidates;})()`);assert.ok(originals.includes('Price 1200원'));assert.ok(!originals.includes('Price '+usd(1200)));
 await popup.close();
 for(const locale of ['ko','ar']){
  await worker.evaluate(()=>chrome.storage.local.set({currencyPanelExpanded:false}));
  await worker.evaluate(locale=>chrome.storage.local.set({appLocale:locale}),locale);popup=await open();
  for(let n=0;n<100;n++){if(await popup.evaluate(`document.documentElement.lang==='${locale}'`))break;await new Promise(r=>setTimeout(r,20));}
  await new Promise(r=>setTimeout(r,250));const layout=await popup.evaluate(`({width:document.body.getBoundingClientRect().width,scroll:document.documentElement.scrollWidth,viewport:innerWidth,dir:document.documentElement.dir,label:document.querySelector('#currency-title').textContent,note:document.querySelector('#currency-note').textContent})`);
  assert.equal(layout.width,400);assert.ok(layout.scroll<=layout.viewport);assert.ok(!layout.label.includes('?'));assert.ok(layout.note.includes(fallback.date));if(locale==='ar')assert.equal(layout.dir,'rtl');
  assert.equal(await popup.evaluate(`document.querySelector('#currency-body').hidden`),true);await capture(popup,locale+'-collapsed');
  await popup.key('#currency-expand','Enter','Enter',13);assert.equal(await popup.evaluate(`document.querySelector('#currency-expand').getAttribute('aria-expanded')`),'true');
  await popup.key('#currency-enabled',' ','Space',32);await until(popup,`!document.querySelector('#currency-enabled').disabled`);assert.equal(await popup.evaluate(`document.querySelector('#currency-body').hidden`),false);
  await popup.key('#currency-enabled',' ','Space',32);await until(popup,`!document.querySelector('#currency-enabled').disabled`);assert.equal(await popup.evaluate(`document.querySelector('#currency-body').hidden`),false);
  await popup.click('#currency-refresh');await until(popup,`!document.querySelector('#currency-refresh').disabled`);await capture(popup,locale+'-expanded');
  await popup.close();popup=await open();assert.equal(await popup.evaluate(`document.querySelector('#currency-body').hidden`),false);
  result.checks.push({locale,layout,keyboard:true,expandedAfterSwitch:true,reopenExpanded:true});await popup.close();
 }
 popup=await open();assert.equal(await popup.evaluate(`document.querySelector('#currency-enabled').checked`),true);
 await page.evaluate(()=>document.querySelector('#dynamic').firstChild.data='External 3600원');await page.waitForFunction(expected=>document.querySelector('#dynamic').textContent===expected,'External '+usd(3600));
 await popup.click('#currency-enabled');await page.waitForFunction(()=>document.querySelector('#price').textContent==='Price 1200원');assert.equal(await page.locator('#dynamic').textContent(),'External 3600원');
 const disabledShot=path.join(dir,'fixture-disabled.png');await page.screenshot({path:disabledShot});result.screenshots.push(disabledShot);result.checks.push('Native action popup click enables currency without a table; dynamic DOM, protected input, originals collection, reopen persistence and restore preserve external updates');
 await writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await context?.close();server.close();}
