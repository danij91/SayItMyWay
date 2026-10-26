// Real installed extension and DOM, isolated profile/server/data. Native host
// permission prompt approval/denial is NOT simulated as a native-UI test.
// FIRST_APPLY_PLAYWRIGHT_MODULE / FIRST_APPLY_BROWSER_EXE override local tools.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {copyNativeExtension} from './native-fixture.mjs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import http from 'node:http';
const {chromium}=await import(pathToFileURL(process.env.FIRST_APPLY_PLAYWRIGHT_MODULE || path.join(os.tmpdir(),'crimson-manager-browser/node_modules/playwright/index.mjs')));
const dir=await mkdtemp(path.join(os.tmpdir(),'crimson-first-apply-'));
const extension=path.join(dir,'extension');await copyNativeExtension(extension);
const results={fixture:dir,checks:[],screenshots:[],popupSurface:'extension page in tab; active-target query adapter selects fixture because headless action popup target is not exposed by Playwright',nativePermissionUI:'not tested; approval/denial with popup disposal use explicitly simulated permission lifecycle',browser:process.env.FIRST_APPLY_BROWSER_EXE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'};
const fixture=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<html lang="en"><title>First apply fixture</title><body><p id="text">Original fixture text</p><input value="Original fixture text"><p id="other">Unmatched</p></body></html>');});
await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+fixture.address().port+'/docs/a';
// Serve a read-only library at a separate random port. Never contact live 4317.
const seed=JSON.parse(await readFile(new URL('../extension/data/dictionary.json',import.meta.url),'utf8'));
const table=(id,ko)=>({...structuredClone(seed),id,name:'Fixture '+id,description:'',excludedTerms:[],excludedCategories:[],defaults:{matchMode:'exact',caseSensitive:false,translatePlaceholders:true},entries:[{...seed.entries[0],id:'fixture',en:'Original fixture text',ko,status:'verified',kind:'general',category:'fixture',context:'fixture',selector:'',source:'사용자 확인: fixture',evidence:'Synthetic test fixture'}]});
const library={schemaVersion:2,revision:1,tables:[table('a','First replacement'),table('b','Second replacement')]};
const api=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(library));});
await new Promise(r=>api.listen(0,'127.0.0.1',r));
await writeFile(path.join(extension,'background.js'),(await readFile(path.join(extension,'background.js'),'utf8')).replaceAll('127.0.0.1:4317','127.0.0.1:'+api.address().port));
let context;
try{
 context=await chromium.launchPersistentContext(path.join(dir,'profile'),{executablePath:results.browser,headless:process.env.FIRST_APPLY_HEADED!=='1',viewport:{width:400,height:850},args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
 const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker',{timeout:15000});
 results.version=await worker.evaluate(()=>navigator.userAgent);
 const id=new URL(worker.url()).host,page=await context.newPage();await page.goto(url);
 await worker.evaluate(async library=>chrome.storage.local.set({library,rules:[],enabled:true,originEnabled:{}}),library);
 let popup;
 async function open(){
  popup=await context.newPage();
  await popup.addInitScript(url=>{
   const native=chrome.tabs.query.bind(chrome.tabs);
   chrome.tabs.query=async query=>query.active && query.currentWindow?(await native({})).filter(tab=>tab.url===url):native(query);
  },url);
  popup.on('pageerror',error=>console.error('Popup:',error.message));
  await popup.goto('chrome-extension://'+id+'/popup.html');
  await popup.locator('#table:not(:disabled)').waitFor();
  await popup.waitForFunction(()=>document.querySelector('#table').options.length===3);
 }
 async function shot(name){const file=path.join(dir,name+'.png');await popup.locator('body').screenshot({path:file});results.screenshots.push(file);}
 async function settled(){await popup.locator('#table:not(:disabled)').waitFor();}
 await open();assert.equal(await popup.locator('#table').inputValue(),'');assert.equal(await popup.locator('#enabled').isChecked(),false);
 await shot('popup-initial-off');
 await popup.locator('#table').selectOption('a');await settled();
 assert.equal(await popup.locator('#enabled').isChecked(),false);assert.equal(await page.locator('#text').textContent(),'Original fixture text');
 await popup.close();await open();assert.equal(await popup.locator('#table').inputValue(),'a');
 results.checks.push('always-visible dropdown, explicit empty initial value, permission-free selection persists OFF on reopen');
 // Real trusted user click -> runtime message -> native permissions.request.
 // 127.0.0.1 is already declared: this proves gesture forwarding and native
 // completion, but does not show an optional-host permission approval dialog.
 await popup.locator('#enabled').check();await settled();
 await page.locator('#text').filter({hasText:'First replacement'}).waitFor();
 assert.equal(await popup.locator('#enabled').isChecked(),true);assert.equal(await page.locator('input').inputValue(),'Original fixture text');
 assert.equal(await popup.locator('#status').isVisible(),false);
 await shot('popup-applied');
 results.checks.push('real click forwards gesture to background native permissions.request for pregranted host; actual first DOM apply and protected input');
 await popup.locator('#table').selectOption('b');await settled();await page.locator('#text').filter({hasText:'Second replacement'}).waitFor();
 await shot('popup-changed-on');
 await popup.locator('#enabled').uncheck();await settled();await page.locator('#text').filter({hasText:'Original fixture text'}).waitFor();
 await popup.locator('#table').selectOption('a');await settled();assert.equal(await popup.locator('#enabled').isChecked(),false);
 assert.equal(await page.locator('#text').textContent(),'Original fixture text');
 results.checks.push('table change while ON immediately reapplies, OFF restores, table change while OFF stays OFF');
 const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,url);
 // Deliberately replace only the permission boundary; all popup/background and
 // content DOM code remains real. The popup is physically destroyed pending it.
 await worker.evaluate(()=>{globalThis.nativeRequest=chrome.permissions.request;chrome.permissions.request=()=>new Promise(resolve=>globalThis.finishPermission=resolve);});
 await popup.locator('#enabled').check();
 assert.equal(await worker.evaluate(()=>typeof globalThis.finishPermission),'function');
 await popup.close();
 await worker.evaluate(()=>globalThis.finishPermission(true));
 await page.locator('#text').filter({hasText:'First replacement'}).waitFor();
 await open();assert.equal(await popup.locator('#table').inputValue(),'a');assert.equal(await popup.locator('#enabled').isChecked(),true);
 await shot('popup-reopened-after-disposal');
 results.checks.push('SIMULATED delayed approval + destroyed popup; background completion and actual DOM survive reopen');
 await popup.locator('#enabled').uncheck();await settled();await page.locator('#text').filter({hasText:'Original fixture text'}).waitFor();
 await popup.locator('#enabled').check();await popup.close();await worker.evaluate(()=>globalThis.finishPermission(false));
 await open();assert.equal(await popup.locator('#enabled').isChecked(),false);assert.equal(await popup.locator('#table').inputValue(),'a');
 assert.equal(await page.locator('#text').textContent(),'Original fixture text');await shot('popup-denied-selection-retained');
 results.checks.push('SIMULATED delayed denial + destroyed popup retains selection OFF and original DOM');
 await worker.evaluate(()=>chrome.permissions.request=globalThis.nativeRequest);
 const saved=await worker.evaluate(()=>chrome.storage.local.get(['library','collections','activationIntents']));
 assert.equal(saved.library.tables.length,2);assert.equal(saved.library.tables[0].entries[0].ko,'First replacement');
 assert.equal(Object.keys(saved.activationIntents).length,0);
 results.checks.push('isolated fixture tables intact and no unresolved activation intents; no live server/profile/data touched');
 results.outcome='passed';console.log(JSON.stringify(results,null,2));
}catch(error){results.outcome='failed';results.error=error.stack;throw error;}
finally{if(context)await context.close();await Promise.all([new Promise(r=>fixture.close(r)),new Promise(r=>api.close(r))]);await writeFile(path.join(dir,'result.json'),JSON.stringify(results,null,2));}
