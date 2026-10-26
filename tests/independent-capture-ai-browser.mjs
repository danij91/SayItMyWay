// Real extension and DOM; isolated profile. Host permission pregranted for fixture.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {copyNativeExtension} from './native-fixture.mjs';
const {chromium}=await import(pathToFileURL(process.env.STANDALONE_PLAYWRIGHT_MODULE||'C:/Users/danij/AppData/Local/Temp/crimson-manager-browser/node_modules/playwright/index.mjs'));
const dir=await mkdtemp(path.join(os.tmpdir(),'crimson-independent-capture-')),extension=path.join(dir,'extension');
await copyNativeExtension(extension,process.env.STANDALONE_EXTENSION_SOURCE);
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><title>Capture fixture</title><body><p id="known">Known original</p><p>New original</p><input value="Private input"><div id="dynamic"></div></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port+'/fixture';
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));manifest.host_permissions=['http://127.0.0.1/*'];await writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
let context,popup;
const report={dir,checks:[],boundary:'Synthetic fixture, pregranted host, real Chromium extension and DOM. Popup document in 400px tab; no live-site/native permission dialog test.'};
try{
  context=await chromium.launchPersistentContext(path.join(dir,'profile'),{executablePath:process.env.STANDALONE_BROWSER_EXE||'C:/Users/danij/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',headless:true,viewport:{width:400,height:850},args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
  await worker.evaluate(()=>chrome.storage.local.set({appLocale:'ko'}));
  const site=await context.newPage();await site.goto(url);
  async function openPopup(){
    const page=await context.newPage();
    await page.addInitScript(url=>{const native=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=async query=>query.active&&query.currentWindow?(await native({})).filter(t=>t.url===url):native(query);},url);
    await page.goto('chrome-extension://'+id+'/popup.html');await page.locator('#table-search:not(:disabled)').waitFor();return page;
  }
  popup=await openPopup();
  const msg=async(type,extra={})=>{const result=await popup.evaluate(({type,extra})=>chrome.runtime.sendMessage({type,...extra}),{type,extra});assert.equal(result.error,undefined,JSON.stringify(result));return result;};
  const library=async()=>(await msg('libraryGet')).library;
  assert.equal(await popup.locator('#capture').isVisible(),true);assert.equal(await popup.locator('#capture-append').isVisible(),false);
  assert.ok(!await popup.locator('#table-ai').isVisible()||await popup.locator('#table-ai').isDisabled());
  const seed=await library(),template=seed.tables[0],row=template.entries[0];
  const target={...structuredClone(template),id:'append-target',name:'추가할 테이블',excludedTerms:[],excludedCategories:[],entries:[{...row,id:'known',kind:'general',en:'Known original',ko:'Known replacement',status:'review',source:'Preserved source',evidence:'Preserved evidence',notes:'Preserved notes'},{...row,id:'blank',kind:'general',en:'Blank request target',ko:'',status:'untranslated'}]};
  const other={...structuredClone(target),id:'other-target',name:'다른 테이블'};
  seed.tables.push(target,other);await msg('librarySave',{library:seed});
  async function choose(table){await popup.locator('#table-search').click();await popup.locator('#table-search').fill(table.name);await popup.locator('[data-table-id="'+table.id+'"]').click();await popup.waitForFunction(id=>document.querySelector('#table').value===id&&!document.querySelector('#table-search').disabled,table.id);}
  await choose(target);await popup.locator('#capture-append').waitFor();
  await popup.locator('#table-ai').click();assert.equal(await popup.locator('.ai-request-summary').textContent(),target.name);await popup.keyboard.press('Escape');
  report.checks.push('No selection: new capture only; selected table: AI request before any capture and separate new/append buttons');
  await popup.locator('#enabled').check();await site.locator('#known').filter({hasText:'Known replacement'}).waitFor();
  await popup.locator('#capture-append').click();await popup.locator('#collection-watch:not(:disabled)').waitFor();
  assert.equal(await popup.locator('#capture').isVisible(),false);assert.equal(await popup.locator('#capture-append').isVisible(),false);
  assert.match(await popup.locator('#collection-status').textContent(),new RegExp(target.name));
  const initial=await library();assert.equal(initial.tables.length,seed.tables.length);assert.deepEqual(initial.tables.find(t=>t.id===target.id).entries.slice(0,2),target.entries);
  assert.ok(initial.tables.find(t=>t.id===target.id).entries.some(e=>e.en==='New original'));
  assert.ok(!initial.tables.find(t=>t.id===target.id).entries.some(e=>['Known replacement','Private input'].includes(e.en)));
  await choose(other);await popup.locator('#table-ai').click();assert.equal(await popup.locator('.ai-request-summary').textContent(),other.name);await popup.keyboard.press('Escape');
  await popup.close();await site.locator('#dynamic').evaluate(el=>{el.textContent='Later menu original';});
  popup=await openPopup();await popup.locator('#collection-watch:not(:disabled)').waitFor();await popup.locator('#collection-watch').click();await popup.locator('#capture:not(:disabled)').waitFor();await popup.locator('#capture-append').waitFor();
  const saved=await library(),savedTarget=saved.tables.find(t=>t.id===target.id);
  assert.equal(savedTarget.entries.filter(e=>e.en==='Later menu original').length,1);assert.deepEqual(saved.tables.find(t=>t.id===other.id).entries,other.entries);
  assert.equal(await popup.locator('#table').inputValue(),other.id);assert.equal(await popup.locator('#collection-ai,#collection-again').count(),0);
  report.checks.push('Append preserves replacements/provenance, excludes translated output and inputs, pins destination across selection change and popup close, saves dynamic menu, finish restores both buttons');
  await choose(target);const size=savedTarget.entries.length;await popup.locator('#capture-append').click();await popup.locator('#collection-watch:not(:disabled)').waitFor();await popup.locator('#collection-watch').click();await popup.locator('#capture:not(:disabled)').waitFor();assert.equal((await library()).tables.find(t=>t.id===target.id).entries.length,size);
  const before=await library();await popup.locator('#capture').click();await popup.locator('#collection-watch:not(:disabled)').waitFor();await popup.locator('#collection-watch').click();await popup.locator('#capture:not(:disabled)').waitFor();
  const after=await library();assert.equal(after.tables.length,before.tables.length+1);assert.equal(await popup.locator('#table').inputValue(),target.id);assert.deepEqual(after.tables.find(t=>t.id===target.id).entries,before.tables.find(t=>t.id===target.id).entries);
  await popup.locator('#table-ai').click();assert.equal(await popup.locator('.ai-request-summary').textContent(),target.name);await popup.keyboard.press('Escape');
  await popup.screenshot({path:path.join(dir,'ko-finished.png'),fullPage:true});
  await popup.evaluate(()=>chrome.storage.local.set({appLocale:'ar'}));await popup.waitForFunction(()=>document.documentElement.dir==='rtl');
  assert.ok(await popup.locator('#table-ai').isVisible());assert.ok(await popup.locator('#capture-append').isVisible());assert.equal(await popup.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await popup.screenshot({path:path.join(dir,'ar-finished.png'),fullPage:true});
  report.checks.push('Repeated append deduplicates; new capture adds fresh table without switching application; AI still targets selected table after new capture; Korean/Arabic 400px layout');
}finally{await context?.close();await new Promise(r=>server.close(r));await writeFile(path.join(dir,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
