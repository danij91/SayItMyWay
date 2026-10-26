// Native Chromium, production editor/background/content, isolated profile/data.
// Only a fixture website is served. The copied manifest pregrants that site's
// host permission; this does not test Chrome's permission approval/denial UI.
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,access} from 'node:fs/promises';
import {copyNativeExtension} from './native-fixture.mjs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import '../extension/shared.js';
import '../extension/library.js';
const {chromium}=await import(pathToFileURL(process.env.STANDALONE_PLAYWRIGHT_MODULE||'C:/Users/danij/AppData/Local/Temp/crimson-manager-browser/node_modules/playwright/index.mjs'));
const dir=await mkdtemp(path.join(os.tmpdir(),'crimson-standalone-'));
const extension=path.join(dir,'extension'),profile=path.join(dir,'profile');
if(process.env.STANDALONE_EXTENSION_SOURCE)await cp(process.env.STANDALONE_EXTENSION_SOURCE,extension,{recursive:true});
else await copyNativeExtension(extension);
const freshInstall=!process.env.STANDALONE_EXTENSION_SOURCE;
if(freshInstall)await assert.rejects(access(path.join(extension,'data/library.json')),{code:'ENOENT'});
const fixture=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="en"><title>Standalone fixture</title><body><p id="text">Standalone original</p><p>Collected native source</p><input value="Standalone original"></body></html>');});
await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+fixture.address().port,url=origin+'/test';
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
assert.deepEqual(manifest.host_permissions,['https://www.ecb.europa.eu/*']);assert.ok(!JSON.stringify(manifest).includes('4317'));
const longOrigin='https://'+'long-domain-'.repeat(5)+'xyz.example.test';
manifest.host_permissions=[TextPatch.hostPattern(origin),TextPatch.hostPattern(longOrigin)];
await writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
let context;
const result={fixture:dir,checks:[],screenshots:[],network:[],errors:[],permissionBoundary:'Fixture-only manifest host pregrant; real permissions.request and DOM apply, no native permission prompt approval/denial coverage.',popupBoundary:'Real popup document opened in tab; chrome.tabs.query active-target adapter selects fixture website.',libraryServer:false};
async function launch(){
  context=await chromium.launchPersistentContext(profile,{executablePath:process.env.STANDALONE_BROWSER_EXE||'C:/Users/danij/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',headless:true,viewport:{width:1280,height:900},args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
  context.on('request',request=>{if(/^https?:/.test(request.url()))result.network.push({url:request.url(),method:request.method()});});
  context.on('page',page=>page.on('pageerror',error=>result.errors.push(error.message)));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});
  const id=new URL(worker.url()).host;return {worker,id};
}
try{
  let {worker,id}=await launch();
  if(freshInstall)assert.equal(await worker.evaluate(async()=>{await TextPatchI18n.ready;return TextPatchI18n.locale;}),await worker.evaluate(()=>/^ko(?:-|$)/i.test(chrome.i18n.getUILanguage())?'ko':'en'));
  await worker.evaluate(()=>chrome.storage.local.set({appLocale:'ko'}));
  const page=await context.newPage();await page.goto('chrome-extension://'+id+'/manager.html');
  const editor=page.frameLocator('#table-frame');
  await editor.locator('#save-state').filter({hasText:'저장됨'}).waitFor();
  assert.equal(await page.locator('#server-notice,#retry').count(),0);
  assert.match(await page.locator('#table-frame').getAttribute('src'),/\/editor\/index.html/);
  const library=()=>page.evaluate(()=>chrome.runtime.sendMessage({type:'state'})).then(s=>s.library);
  const initial=await library();
  if(freshInstall){
    await assert.rejects(access(path.join(extension,'data/dictionary.json')),{code:'ENOENT'});
    assert.deepEqual(initial,{schemaVersion:2,revision:1,tables:[]});
    assert.deepEqual(await page.evaluate(()=>chrome.runtime.sendMessage({type:'state'})).then(s=>s.rules),[]);
    const optional=await worker.evaluate(async()=>{try{const response=await fetch(chrome.runtime.getURL('data/library.json'));return {status:response.status};}catch(error){return {name:error.name,message:error.message};}});
    assert.equal(optional.name,'TypeError');assert.match(optional.message,/Failed to fetch/);
    result.checks.push('Fresh install without optional library manifest handles native Failed to fetch and persists an empty library with no default site rules');
  }
  if(process.env.STANDALONE_EXPECT_TABLES)assert.equal(initial.tables.length,Number(process.env.STANDALONE_EXPECT_TABLES));
  // Create a new table and row entirely through the bundled editor.
  await editor.locator('#table-create').click();await editor.locator('#table-name').fill('Native standalone');
  await editor.locator('#table-form button[type=submit]').click();
  await editor.locator('#add').click();await editor.locator('[name=en]').fill('Standalone original');await editor.locator('[name=ko]').fill('Native replacement');
  // A real popup changes the app language while the entry dialog is unsaved.
  const draftTableId=await editor.locator('#table-select').inputValue();
  const localePopup=await context.newPage();await localePopup.goto('chrome-extension://'+id+'/popup.html');
  await localePopup.locator('#app-locale').selectOption('en');
  await editor.locator('#save').filter({hasText:'Apply to draft'}).waitFor();
  assert.equal(await editor.locator('#editor').evaluate(el=>el.open),true);
  assert.equal(await editor.locator('[name=en]').inputValue(),'Standalone original');
  assert.equal(await editor.locator('[name=ko]').inputValue(),'Native replacement');
  assert.equal(await editor.locator('#table-select').inputValue(),draftTableId);
  assert.deepEqual(await library(),initial);
  await localePopup.locator('#app-locale').selectOption('ko');await editor.locator('#save').filter({hasText:'초안에 반영'}).waitFor();await localePopup.close();
  result.checks.push('Real popup language chooser synchronizes the editor while an entry dialog and table draft are unsaved; controls and stored data stay intact');
  await editor.locator('[name=status]').selectOption('verified');await editor.locator('#entry-details').evaluate(el=>el.open=true);
  await editor.locator('[name=source]').fill('Synthetic browser fixture');await editor.locator('[name=evidence]').fill('Test-only expected replacement');
  await editor.locator('#save').click();await editor.locator('#editor').waitFor({state:'hidden'});
  const tableId=await editor.locator('#table-select').inputValue();
  assert.deepEqual(await library(),initial);
  assert.equal(await page.locator('#sites-tab,#sites-frame').count(),0);
  await page.bringToFront();
  assert.match(await editor.locator('#rows').innerText(),/Native replacement/);
  await editor.locator('#save-all').click();await editor.locator('#save-state').filter({hasText:'저장됨'}).waitFor();
  const saved=await library();assert.equal(saved.tables.find(t=>t.id===tableId).entries[0].ko,'Native replacement');
  assert.deepEqual(saved.tables.slice(0,initial.tables.length),initial.tables);
  result.checks.push('Bundled editor creates table/row drafts, preserves them while managing tables, persists only on explicit top save');
  const portable=JSON.stringify({format:'text-patch-table',version:1,name:'Imported native',entries:[{en:'Portable source',ko:'',status:'untranslated'}]});
  await editor.locator('#import-open').click();await editor.locator('#import-file').setInputFiles({name:'native.json',mimeType:'application/json',buffer:Buffer.from(portable)});
  await editor.locator('#import-editor').waitFor({state:'hidden'});assert.deepEqual(await library(),saved);
  await editor.locator('#import-open').click();
  await editor.locator('#import-dropzone').evaluate((zone,text)=>{const data=new DataTransfer();data.items.add(new File([text],'native-drop.json',{type:'application/json'}));zone.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));},portable);
  await editor.locator('#import-editor').waitFor({state:'hidden'});assert.deepEqual(await library(),saved);
  const exportEvent=page.waitForEvent('download');await editor.locator('#export-current').click();
  const exported=JSON.parse(await readFile(await(await exportEvent).path(),'utf8'));
  assert.equal(exported.format,'text-patch-table');assert.equal(exported.id,undefined);assert.equal(exported.entries[0].id,undefined);
  await editor.locator('#ai-request').click();await editor.locator('[data-ai=targetLanguage]').selectOption('English');
  await editor.locator('#app-locale').selectOption('en');
  assert.equal(await editor.locator('[data-ai=targetLanguage]').inputValue(),'English');
  await editor.locator('[data-ai=download]').filter({hasText:'Download file'}).waitFor();
  const aiEvent=page.waitForEvent('download');await editor.locator('[data-ai=download]').click();
  const ai=await readFile(await(await aiEvent).path(),'utf8');assert.match(ai,/target language English/);assert.match(ai,/Portable source/);
  assert.equal(await editor.locator('[data-ai=output]').count(),0);await editor.locator('[data-ai=close]').click();await editor.locator('#app-locale').selectOption('ko');
  await editor.locator('#save-all').click();await editor.locator('#save-state').filter({hasText:'저장됨'}).waitFor();
  result.checks.push('Native file selection and DataTransfer drop create drafts; portable JSON export and complete AI UTF-8 download work');
  // A second editor writes while the first holds an older draft: no overwrite.
  await editor.locator('#table-rename').click();await editor.locator('#table-name').fill('Local draft');await editor.locator('#table-form button[type=submit]').click();
  const second=await context.newPage();await second.goto('chrome-extension://'+id+'/editor/index.html?table='+tableId);
  await second.locator('#save-state').filter({hasText:'저장됨'}).waitFor();await second.locator('#table-rename').click();await second.locator('#table-name').fill('Concurrent native');await second.locator('#table-form button[type=submit]').click();
  await second.locator('#save-all').click();await second.locator('#save-state').filter({hasText:'저장됨'}).waitFor();
  await editor.locator('#save-all').click();await editor.locator('#save-state').filter({hasText:/저장 실패/}).waitFor();
  assert.equal(await editor.locator('#table-select option:checked').textContent(),'Local draft');assert.equal(await editor.locator('#save-all').isEnabled(),true);
  page.once('dialog',dialog=>dialog.accept());await page.reload();await editor.locator('#save-state').filter({hasText:'저장됨'}).waitFor();
  result.checks.push('Native concurrent editor revision conflict preserves unsaved draft and does not overwrite newer library');
  const site=await context.newPage();await site.goto(url);
  async function openPopup(){
    const popup=await context.newPage();
    await popup.addInitScript(url=>{const native=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=async query=>query.active&&query.currentWindow?(await native({})).filter(t=>t.url===url):native(query);},url);
    await popup.goto('chrome-extension://'+id+'/popup.html');await popup.locator('#table:not(:disabled)').waitFor();return popup;
  }
  let popup=await openPopup();await popup.locator('#table').selectOption(tableId);await popup.locator('#table:not(:disabled)').waitFor();
  assert.equal(await popup.locator('#enabled').isChecked(),false);assert.equal(await site.locator('#text').textContent(),'Standalone original');
  await popup.locator('#enabled').check();
  try{await site.locator('#text').filter({hasText:'Native replacement'}).waitFor({timeout:7000});}
  catch(error){
    result.activationDiagnostic={popup:await popup.locator('body').innerText(),permission:await worker.evaluate(origin=>chrome.permissions.contains({origins:[TextPatch.hostPattern(origin)]}),origin)};
    throw error;
  }
  assert.equal(await site.locator('input').inputValue(),'Standalone original');
  assert.equal(await popup.locator('#include-review,[data-i18n=include_drafts_in_review]').count(),0);
  await popup.evaluate(async tableId=>{
    await chrome.storage.local.set({includeReview:false});
    const {library}=await chrome.runtime.sendMessage({type:'libraryGet'});
    const table=library.tables.find(t=>t.id===tableId),template=table.entries[0];
    for(const status of ['verified','review','untranslated'])table.entries.push({...template,id:'status-'+status,en:'Status '+status,ko:'Replacement '+status,status});
    table.entries.push({...template,id:'status-empty',en:'Status empty',ko:'',status:'review'});
    const saved=await chrome.runtime.sendMessage({type:'librarySave',library});if(saved.error)throw Error(saved.error);
  },tableId);
  const statusRows=(await library()).tables.find(t=>t.id===tableId).entries;
  await site.evaluate(()=>{const section=document.createElement('section');section.id='status-fixture';section.innerHTML=['verified','review','untranslated','empty'].map(status=>'<p>Status '+status+'</p>').join('')+'<div contenteditable="true">Status review</div>';document.body.append(section);});
  await site.waitForFunction(()=>document.querySelector('#status-fixture').textContent==='Replacement verifiedReplacement reviewReplacement untranslatedStatus emptyStatus review');
  await popup.locator('#enabled').uncheck();await site.locator('#text').filter({hasText:'Standalone original'}).waitFor();
  assert.equal(await site.locator('#status-fixture').textContent(),'Status verifiedStatus reviewStatus untranslatedStatus emptyStatus review');
  assert.deepEqual((await library()).tables.find(t=>t.id===tableId).entries,statusRows);
  result.checks.push('Legacy chrome.local includeReview=false cannot suppress populated verified/review/untranslated rows in dynamically added real DOM; empty replacement and editable text stay original, toggle OFF restores originals, saved row metadata is unchanged, popup has no review option');
  // The actual popup document stays 400px wide; only its site list scrolls.
  await popup.setViewportSize({width:400,height:850});
  assert.equal(await popup.locator('#sites-list').evaluate(el=>el.open),false);
  const collapsed=path.join(dir,'popup-collapsed.png');await popup.screenshot({path:collapsed});result.screenshots.push(collapsed);
  const longName='긴 대응표 이름 '.repeat(18);
  await popup.evaluate(async({tableId,longName,origin,longOrigin})=>{
    const state=await chrome.runtime.sendMessage({type:'state'});
    state.library.tables.find(t=>t.id===tableId).name=longName;
    const saved=await chrome.runtime.sendMessage({type:'librarySave',library:state.library});if(saved.error)throw Error(saved.error);
    for(let i=0;i<12;i++){
      const r=await chrome.runtime.sendMessage({type:'saveRule',rule:{origin,scope:'page',path:'/very-long-path-'+i+'-'+('longpath'.repeat(20)),tableId,enabled:false}});
      if(r.error)throw Error(r.error);
    }
    const r=await chrome.runtime.sendMessage({type:'saveRule',rule:{origin:longOrigin,scope:'site',path:'/',tableId,enabled:false}});if(r.error)throw Error(r.error);
  },{tableId,longName,origin,longOrigin});
  await popup.locator('#sites-list summary').click();
  await popup.locator('#rules tr').filter({hasText:'very-long-path-11'}).waitFor({state:'attached'});
  const order=await popup.locator('#rules a').evaluateAll(links=>links.map(a=>a.href));
  const currentRow=popup.locator('#rules tr').filter({has:popup.locator('a[href="'+origin+'/"]')});
  await currentRow.locator('select').selectOption('crimson-desert');
  await popup.waitForFunction(()=>document.querySelector('#table').value==='crimson-desert');
  assert.deepEqual(await popup.locator('#rules a').evaluateAll(links=>links.map(a=>a.href)),order);
  assert.equal(await popup.locator('#sites-list').evaluate(el=>el.open),true);
  await currentRow.locator('select').selectOption(tableId);
  await popup.waitForFunction(id=>document.querySelector('#table').value===id,tableId);
  await currentRow.locator('input').check();await site.locator('#text').filter({hasText:'Native replacement'}).waitFor();
  await popup.waitForFunction(()=>document.querySelector('#enabled').checked);
  await currentRow.locator('input:checked:not(:disabled)').waitFor();
  await currentRow.locator('input').uncheck();await site.locator('#text').filter({hasText:'Standalone original'}).waitFor();
  await popup.waitForFunction(()=>!document.querySelector('#enabled').checked);
  await currentRow.locator('.site-settings-button').click();
  await popup.locator('.site-settings [name=caseSensitive]').check();await popup.locator('.site-settings [name=wordReplacement]').check();
  await popup.locator('.settings-cancel').click();
  await currentRow.locator('.site-settings-button').click();assert.equal(await popup.locator('.site-settings [name=wordReplacement]').isChecked(),false);
  await popup.locator('.site-settings [name=caseSensitive]').check();await popup.locator('.site-settings [name=wordReplacement]').check();
  await popup.locator('.settings-save').click();await popup.locator('.site-settings').waitFor({state:'hidden'});
  const optionsBeforeRestart=await popup.evaluate(async origin=>(await chrome.runtime.sendMessage({type:'state'})).rules.find(r=>r.origin===origin&&r.scope==='site'),origin);
  assert.equal(optionsBeforeRestart.matchMode,'word');assert.equal(optionsBeforeRestart.caseSensitive,true);
  result.checks.push('Native row SVG gear opens explicit Save/Cancel settings; cancel discards draft and save persists both site options');
  const layout=await popup.evaluate(()=>{
    const list=document.querySelector('.sites-scroll');return {width:document.body.getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>innerWidth,listOverflow:list.scrollWidth>list.clientWidth,scrolls:list.scrollHeight>list.clientHeight,height:list.clientHeight};
  });
  assert.equal(layout.width,400);assert.equal(layout.overflow,false);assert.equal(layout.listOverflow,false);assert.equal(layout.scrolls,true);assert.ok(layout.height<=240);
  const expanded=path.join(dir,'popup-expanded-longnames.png');await popup.screenshot({path:expanded,fullPage:true});result.screenshots.push(expanded);
  const opened=context.waitForEvent('page');await currentRow.locator('a').click();const linked=await opened;await linked.waitForLoadState();assert.equal(linked.url(),origin+'/');await linked.close();
  await popup.locator('#sites-list summary').click();
  await popup.evaluate(()=>chrome.storage.local.set({includeReview:false}));
  assert.equal(await popup.locator('#include-review').count(),0);
  assert.equal(await popup.locator('#sites-list').evaluate(el=>el.open),false);
  const legacy=await context.newPage();await legacy.goto('chrome-extension://'+id+'/options.html');
  await legacy.locator('#rules tr').filter({hasText:'very-long-path-11'}).waitFor();
  assert.deepEqual(await legacy.locator('#rules a').evaluateAll(links=>links.map(a=>a.href)),order);await legacy.close();
  await popup.locator('#sites-list summary').click();
  await popup.locator('#rules tr').filter({hasText:longOrigin}).scrollIntoViewIfNeeded();
  const longDomain=path.join(dir,'popup-long-domain.png');await popup.screenshot({path:longDomain,fullPage:true});result.screenshots.push(longDomain);
  assert.equal(await popup.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await popup.locator('#sites-list summary').click();
  result.checks.push('400px popup defaults collapsed, expanded long table/domain/path names and 15 rows stay within width with 240px list scroll; table edits keep order/open state and sync top controls; list toggles apply/restore real DOM; links open correct URLs; collapsed state survives storage refresh; legacy options URL uses same rows');
  const beforeCapture=(await library()).tables.length;
  await popup.locator('#capture').click();await popup.locator('#collection-watch:not(:disabled)').waitFor();
  await popup.locator('#collection-watch').click();await popup.locator('#collection-result-edit').waitFor();
  const collected=await library();assert.equal(collected.tables.length,beforeCapture+1);
  const capture=collected.tables.at(-1);assert.ok(capture.entries.some(e=>e.en==='Collected native source'));
  assert.equal(await popup.locator('#table').inputValue(),tableId);
  result.checks.push('Native popup selection stays OFF, checkbox applies/restores actual DOM, collection saves a separate new table without changing selection');
  // English UI also fits the 400px popup and localizes stored capture reasons.
  const collectionBeforeLocale=await worker.evaluate(async()=> (await chrome.storage.local.get('collections')).collections);
  await popup.locator('#app-locale').selectOption('en');
  await popup.locator('#capture').filter({hasText:'New collection'}).waitFor();
  await popup.locator('#capture-append').filter({hasText:'Add to table'}).waitFor();
  await popup.locator('#table-ai:not(:disabled)').waitFor();
  assert.match(await popup.locator('#collection-status').innerText(),/Collection complete/);
  assert.equal(await popup.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(await editor.locator('#save-all').innerText(),'Save changes');
  await popup.waitForFunction(async url=>{const tab=(await chrome.tabs.query({})).find(tab=>tab.url===url);return (await chrome.action.getTitle({tabId:tab.id}))==='Text Table Patch';},url);
  assert.equal(await worker.evaluate(()=>chrome.action.getTitle({})),'Text Table Patch');
  assert.deepEqual(await worker.evaluate(async()=> (await chrome.storage.local.get('collections')).collections),collectionBeforeLocale);
  const englishPopup=path.join(dir,'popup-english.png');await popup.screenshot({path:englishPopup,fullPage:true});result.screenshots.push(englishPopup);
  result.checks.push('English popup collection status, editor actions and AI controls localize without changing target language; 400px layout remains within viewport');
  const expected=await library();
  const screenshot=path.join(dir,'standalone.png');await page.screenshot({path:screenshot,fullPage:true});result.screenshots.push(screenshot);
  await context.close();context=null;
  ({worker,id}=await launch());
  const restarted=await context.newPage();await restarted.goto('chrome-extension://'+id+'/manager.html?table='+tableId);
  await restarted.frameLocator('#table-frame').locator('#save-state').filter({hasText:'Saved'}).waitFor();
  assert.equal(await restarted.frameLocator('#table-frame').locator('#app-locale').inputValue(),'en');
  const persisted=await restarted.evaluate(()=>chrome.runtime.sendMessage({type:'state'}));
  const optionsAfterRestart=persisted.rules.find(r=>r.id===optionsBeforeRestart.id);assert.equal(optionsAfterRestart.matchMode,'word');assert.equal(optionsAfterRestart.caseSensitive,true);
  assert.deepEqual(persisted.library,expected);assert.ok(persisted.rules.some(r=>r.origin===origin&&r.tableId===tableId));
  assert.ok(persisted.library.tables.find(t=>t.id===capture.id).entries.some(e=>e.en==='Collected native source'));
  result.checks.push('Full Chromium profile restart preserves English app locale, edited/imported/collected tables and site selection');
  assert.ok(result.network.every(r=>new URL(r.url).origin===origin&&r.method==='GET'&&!r.url.includes('/api/')),JSON.stringify(result.network));
  assert.deepEqual(result.errors,[]);result.checks.push('No localhost library requests or library server; only fixture website HTTP requests');
  result.outcome='passed';
}catch(error){result.outcome='failed';result.error=error.stack;throw error;}
finally{
  await context?.close();await new Promise(resolve=>fixture.close(resolve));
  await writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
