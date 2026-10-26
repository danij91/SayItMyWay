// Real extension storage and UI with synthetic AI output, isolated browser profile.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {copyNativeExtension} from './native-fixture.mjs';
const {chromium}=await import(pathToFileURL(process.env.STANDALONE_PLAYWRIGHT_MODULE||'C:/Users/danij/AppData/Local/Temp/crimson-manager-browser/node_modules/playwright/index.mjs'));
const dir=await mkdtemp(path.join(os.tmpdir(),'crimson-ai-merge-'));
const extension=path.join(dir,'extension'),profile=path.join(dir,'profile');
await copyNativeExtension(extension,process.env.STANDALONE_EXTENSION_SOURCE);
let context,page;
const report={dir,checks:[],boundary:'Isolated Chromium extension; synthetic AI JSON, no external AI or live site. Popup document opened in tab.'};
async function launch(){
  context=await chromium.launchPersistentContext(profile,{executablePath:process.env.STANDALONE_BROWSER_EXE||'C:/Users/danij/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',headless:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(()=>chrome.storage.local.set({appLocale:'ko'}));
  page=await context.newPage();await page.goto('chrome-extension://'+new URL(worker.url()).host+'/editor/index.html');
  await page.locator('#save-state').filter({hasText:'저장됨'}).waitFor();
  return new URL(worker.url()).host;
}
const message=async(type,params={})=>{
  const result=await page.evaluate(({type,params})=>chrome.runtime.sendMessage({type,...params}),{type,params});
  assert.equal(result.error,undefined,JSON.stringify(result));return result;
};
try{
  let id=await launch();
  const initial=(await message('libraryGet')).library;
  const table=structuredClone(initial.tables[0]);table.id='native-ai-merge';table.name='AI 보존 테스트';
  const base=table.entries[0];
  table.entries=Array.from({length:5},(_,i)=>({...base,id:'ai-row-'+i,kind:'general',en:i===2?'Blank 1':'Blank '+i,context:i===2?'popup':'global',ko:i===4?'기존 값':'',status:i===4?'verified':'untranslated',notes:'original notes '+i,source:i===4?'test fixture':'',evidence:i===4?'test fixture':''}));
  initial.tables.push(table);await message('librarySave',{library:initial});
  await page.reload();await page.locator('#table-select').selectOption(table.id);
  await page.locator('#ai-request').click();
  await page.locator('[data-ai=copy]').click();
  await page.locator('[data-ai=status]').filter({hasText:'요청을 복사했습니다'}).waitFor();
  const downloading=page.waitForEvent('download');await page.locator('[data-ai=download]').click();
  const download=await downloading,text=await readFile(await download.path(),'utf8');
  const payload=JSON.parse(text.split('--- JSON 데이터 시작 ---\n\n')[1].split('\n\n--- JSON 데이터 끝 ---')[0]);
  assert.ok(payload.aiRequest.id);assert.equal(payload.entries.length,4);
  assert.ok(payload.entries.every(row=>typeof row.requestRow==='string'));
  assert.match(text,/기존 값/);
  const response={...payload,entries:payload.entries.map((row,i)=>({...row,replacement:'AI value '+i,status:'verified'}))};
  // Modify one blank row after generation, then restart the whole browser.
  const changed=(await message('libraryGet')).library;
  changed.tables.find(t=>t.id===table.id).entries[1].notes='Edited after request';
  await message('librarySave',{library:changed});
  await context.close();id=await launch();
  await page.locator('#import-open').click();
  await page.locator('#import-file').setInputFiles({name:'ai-result.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(response))});
  const preview=page.locator('[data-ai-result]');await preview.waitFor();
  await page.screenshot({path:path.join(dir,'ko-preview.png')});
  assert.match(await preview.textContent(),/3/);
  // Change another blank after preview. Apply must recheck current authoritative state.
  const newer=(await message('libraryGet')).library;
  newer.tables.find(t=>t.id===table.id).entries[2].ko='Concurrent user value';
  await message('librarySave',{library:newer});
  await preview.locator('[data-ai-result-apply]').click();await preview.waitFor({state:'detached'});
  await page.locator('#import-editor').waitFor({state:'hidden'});
  const after=(await message('libraryGet')).library,actual=after.tables.find(t=>t.id===table.id);
  assert.deepEqual(actual.entries.map(row=>row.ko),['AI value 0','','Concurrent user value','AI value 3','기존 값']);
  assert.equal(actual.entries[0].status,'review');assert.equal(actual.entries[4].status,'verified');
  assert.equal(after.tables.length,initial.tables.length);
  report.checks.push('UI request download records baseline; browser restart; editor import preview; post-request and post-preview edits protected; forced review; no extra table');
  // Same result in popup is idempotent, Arabic layout remains bounded.
  await page.goto('chrome-extension://'+id+'/popup.html');
  await page.setViewportSize({width:400,height:700});
  await page.evaluate(()=>chrome.storage.local.set({appLocale:'ar'}));
  await page.reload();await page.waitForFunction(()=>document.documentElement.dir==='rtl');
  await page.locator('#import-file').setInputFiles({name:'ai-result.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(response))});
  await page.locator('[data-ai-result]').waitFor();
  const bounds=await page.locator('[data-ai-result]').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=400);
  await page.screenshot({path:path.join(dir,'ar-popup-preview.png')});
  await page.locator('[data-ai-result-apply]').click();await page.locator('[data-ai-result]').waitFor({state:'detached'});
  await page.waitForFunction(()=>!document.querySelector('#import-open').disabled);
  assert.equal((await message('libraryGet')).library.revision,after.revision);
  report.checks.push('popup AI file detection, Arabic confirmation, repeated import does not rewrite data');
  // Unlinked portable files still create a new table.
  const portable={...payload,entries:payload.entries.slice(0,1)};delete portable.aiRequest;
  await page.locator('#import-file').setInputFiles({name:'ordinary.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(portable))});
  await page.waitForFunction(()=>!document.querySelector('#import-open').disabled);
  for(let i=0;i<100;i++){if((await message('libraryGet')).library.tables.length===after.tables.length+1)break;await new Promise(r=>setTimeout(r,50));}
  assert.equal((await message('libraryGet')).library.tables.length,after.tables.length+1);
  report.checks.push('ordinary JSON import still creates a separate table');
}finally{
  await context?.close();await writeFile(path.join(dir,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
