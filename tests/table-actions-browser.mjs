// Isolated native extension flow. Popup document uses an active-tab adapter;
// popup-sizing-browser.mjs separately covers the real action host at 400px.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {copyNativeExtension} from './native-fixture.mjs';
const {chromium}=await import(pathToFileURL(process.env.STANDALONE_PLAYWRIGHT_MODULE||'C:/Users/danij/AppData/Local/Temp/crimson-manager-browser/node_modules/playwright/index.mjs'));
const dir=await mkdtemp(path.join(os.tmpdir(),'crimson-table-actions-'));
const extension=path.join(dir,'extension'),profile=path.join(dir,'profile');
await copyNativeExtension(extension);
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><p id="text">Delete source</p>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
manifest.host_permissions=['http://127.0.0.1/*'];await writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
let context;
const result={checks:[],fixture:dir,boundary:'Native extension and real file selection; fixture host permission pregranted, popup document active-tab adapter. Real action sizing tested separately.'};
async function launch(){
 context=await chromium.launchPersistentContext(profile,{executablePath:process.env.STANDALONE_BROWSER_EXE||'C:/Users/danij/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',headless:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 return {worker,id:new URL(worker.url()).host};
}
try{
 let {worker,id}=await launch();await worker.evaluate(()=>chrome.storage.local.set({appLocale:'en'}));
 const site=await context.newPage();await site.goto(origin+'/test');
 const popup=await context.newPage();
 await popup.addInitScript(url=>{const query=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=async options=>options.active?query({url:url+'/*'}):query(options);},origin);
 await popup.goto('chrome-extension://'+id+'/popup.html');
 await popup.locator('#import-open:not([disabled])').waitFor();
 const state=()=>popup.evaluate(()=>chrome.runtime.sendMessage({type:'state'}));
 const original=await state();
 const portable=JSON.stringify({format:'text-patch-table',version:1,name:'Native import',entries:[{en:'Delete source',ko:'Replacement',status:'verified',source:'Synthetic fixture',evidence:'Native test'}]});
 const portableV2=JSON.stringify({format:'text-patch-table',version:2,name:'Native import',entries:[{original:'Delete source',replacement:'Replacement',status:'verified',source:'Synthetic fixture',evidence:'Native test'}]});
 async function importFile(text=portable){
  await popup.locator('#import-open').click();
  await popup.locator('#import-file').setInputFiles({name:'native.json',mimeType:'application/json',buffer:Buffer.from(text)});
  await popup.locator('#import-status').filter({hasText:/Saved 1 new/}).waitFor();
  await popup.locator('#import-open:not([disabled])').waitFor();
 }
 await importFile();let imported=await state();const first=imported.library.tables.at(-1);
 assert.equal(imported.library.tables.length,original.library.tables.length+1);
 assert.deepEqual(imported.rules,original.rules);assert.equal(await popup.locator('#enabled').isChecked(),false);
 await popup.locator('#table').selectOption(first.id);await popup.locator('#enabled:not([disabled])').waitFor();
 await popup.locator('#enabled').check();
 await popup.waitForFunction(()=>!document.querySelector('#enabled').disabled);
 await site.locator('#text').filter({hasText:/^Replacement$/}).waitFor();
 await importFile(portableV2);imported=await state();const second=imported.library.tables.at(-1);
 assert.equal(second.name,'Native import (2)');assert.notEqual(second.id,first.id);assert.notEqual(second.entries[0].id,first.entries[0].id);
 assert.equal(await popup.locator('#table').inputValue(),first.id);assert.equal(await popup.locator('#enabled').isChecked(),true);
 assert.equal(await site.locator('#text').innerText(),'Replacement');
 await popup.locator('#table-search').fill('NO MATCH');assert.equal(await popup.locator('#table').inputValue(),first.id);assert.equal(await popup.locator('#table option').count(),2);
 await popup.locator('#table-search').fill('(2)');await popup.locator('#table-search').press('ArrowDown');assert.equal(await popup.locator('#table').evaluate(el=>el===document.activeElement),true);
 await popup.locator('#table-search').fill('');
 result.checks.push('Explicit popup import allocates unique tables and rows, preserves active table and DOM, supports search and keyboard focus');
 const editor=await context.newPage();await editor.goto('chrome-extension://'+id+'/editor/index.html?table='+first.id);
 await editor.locator('#save-state').filter({hasText:'Saved'}).waitFor();
 const cancelled=editor.waitForEvent('dialog');await editor.locator('#table-delete').click();
 const confirmation=await cancelled,question=confirmation.message();await confirmation.dismiss();
 assert.match(question,/Native import/);assert.match(question,/Linked sites: 1/);assert.equal((await state()).library.tables.length,imported.library.tables.length);
 editor.once('dialog',dialog=>dialog.accept());await editor.locator('#table-delete').click();
 await editor.locator('#save-state').filter({hasText:'Unsaved'}).waitFor();assert.equal((await state()).rules.find(r=>r.tableId===first.id).enabled,true);
 assert.equal(await site.locator('#text').innerText(),'Replacement');
 const concurrent=await context.newPage();await concurrent.goto('chrome-extension://'+id+'/editor/index.html?table='+second.id);
 await concurrent.locator('#save-state').filter({hasText:'Saved'}).waitFor();await concurrent.locator('#table-rename').click();await concurrent.locator('#table-name').fill('Concurrent preserved');await concurrent.locator('#table-form button[type=submit]').click();await concurrent.locator('#save-all').click();await concurrent.locator('#save-state').filter({hasText:'Saved'}).waitFor();
 await editor.locator('#save-all').click();await editor.locator('#message').filter({hasText:/Draft preserved/}).waitFor();
 assert.ok((await state()).rules.some(r=>r.tableId===first.id));assert.equal(await site.locator('#text').innerText(),'Replacement');
 result.checks.push('Delete confirmation names table and linked site count; cancellation and draft deletion preserve stored rules and DOM; stale top Save preserves draft');
 await editor.close();await concurrent.close();
 const fresh=await context.newPage();await fresh.goto('chrome-extension://'+id+'/editor/index.html?table='+first.id);await fresh.locator('#save-state').filter({hasText:'Saved'}).waitFor();
 fresh.on('dialog',dialog=>dialog.accept());await fresh.locator('#table-delete').click();await fresh.locator('#save-all:not([disabled])').waitFor();await fresh.locator('#save-all').click();await fresh.locator('#save-state').filter({hasText:'Saved'}).waitFor();
 await site.locator('#text').filter({hasText:/^Delete source$/}).waitFor();
 const after=await state();assert.ok(!after.rules.some(r=>r.tableId===first.id));assert.equal(after.library.tables.find(t=>t.id===second.id).name,'Concurrent preserved');
 while(await fresh.locator('#table-select option').count()){
  await fresh.locator('#table-delete').click();await fresh.locator('#save-all:not([disabled])').waitFor();await fresh.locator('#save-all').click();await fresh.locator('#save-state').filter({hasText:'Saved'}).waitFor();
 }
 assert.equal((await state()).library.tables.length,0);
 await context.close();({worker,id}=await launch());const check=await context.newPage();await check.goto('chrome-extension://'+id+'/editor/index.html');await check.locator('#save-state').filter({hasText:'Saved'}).waitFor();
 assert.equal(await check.locator('#table-select option').count(),0);
 result.checks.push('Accepted top Save restores original DOM, preserves unrelated edits, and last-table deletion remains empty after browser restart');
 await check.screenshot({path:path.join(dir,'empty-editor.png'),fullPage:true});
 await writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await context?.close();await new Promise(resolve=>server.close(resolve));}
