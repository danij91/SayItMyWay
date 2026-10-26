// Coordinator integration check: real keyboard and mouse, installed extension,
// isolated profile. Local fixture permission is pregranted, not a permission-UI test.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {copyNativeExtension} from './native-fixture.mjs';
const {chromium}=await import(pathToFileURL(process.env.STANDALONE_PLAYWRIGHT_MODULE||'C:/Users/danij/AppData/Local/Temp/crimson-manager-browser/node_modules/playwright/index.mjs'));
const dir=await mkdtemp(path.join(os.tmpdir(),'crimson-page-interaction-'));
const extension=path.join(dir,'extension'),profile=path.join(dir,'profile');
await copyNativeExtension(extension);
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><style>
body{font-family:Arial,sans-serif;padding:30px}p,a{display:block;margin:24px 0;width:360px;font-size:22px}
#tight{width:140px;height:30px;line-height:22px;overflow:hidden;white-space:nowrap;font-size:34px}
</style><p id="text">Original text</p><a id="link" href="/navigated">Edit this link</a>
<p id="new">New original</p><p id="tight">2 days ago</p><input id="input" value="Original text"><div contenteditable id="editable">Original text</div></html>`;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
manifest.host_permissions=['http://127.0.0.1/*'];await writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
let context;
const result={fixture:dir,checks:[],boundary:'Native Chromium installed extension; fixture host pregranted; popup document active-tab adapter. No live MapGenie or permission prompt claim.'};
async function launch(){
 context=await chromium.launchPersistentContext(profile,{executablePath:process.env.STANDALONE_BROWSER_EXE||'C:/Users/danij/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',headless:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 return {worker,id:new URL(worker.url()).host};
}
try{
 const {worker,id}=await launch();await worker.evaluate(()=>chrome.storage.local.set({appLocale:'en'}));
 const site=await context.newPage();await site.goto(origin+'/test');
 const popup=await context.newPage();
 await popup.addInitScript(url=>{const query=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=async options=>options.active?query({url:url+'/*'}):query(options);},origin);
 await popup.goto('chrome-extension://'+id+'/popup.html');
 await popup.locator('#import-open:not([disabled])').waitFor();
 const send=message=>popup.evaluate(message=>chrome.runtime.sendMessage(message),message);
 const imported=await send({type:'importTables',fileName:'interaction.json',text:JSON.stringify({format:'text-patch-table',version:2,name:'Interaction fixture',entries:[
  {original:'Original text',replacement:'Replaced text'},
  {original:'Edit this link',replacement:'Edited link'},
  {original:'2 days ago',replacement:'2일 전'}]})});
 assert.equal(imported.error,undefined);const table=imported.library.tables.at(-1);
 await send({type:'selectTable',url:origin+'/test',tableId:table.id});
 await send({type:'toggleSite',url:origin+'/test',enabled:true});
 await site.locator('#text').filter({hasText:/^Replaced text$/}).waitFor();
 await worker.evaluate(async()=>{const {rules}=await chrome.storage.local.get('rules');await chrome.storage.local.set({rules:rules.map(r=>({...r,fitText:{enabled:true,fontScale:0.8,lineHeight:1.5}}))});});
 await site.reload();await site.locator('#text').filter({hasText:/^Replaced text$/}).waitFor();
 assert.equal(await site.locator('#tight').getAttribute('style'),null,'legacy fitting settings cannot cause any style writes');
 await site.bringToFront();await site.keyboard.down('ShiftLeft');
 await site.locator('#text').filter({hasText:/^Original text$/}).waitFor();
 assert.equal(await site.locator('#tight').getAttribute('style'),null);
 assert.equal((await send({type:'state',url:origin+'/test'})).page.enabled,true);
 await site.keyboard.up('ShiftLeft');await site.locator('#text').filter({hasText:/^Replaced text$/}).waitFor();
 await site.locator('#input').focus();await site.keyboard.down('ShiftLeft');
 assert.equal(await site.locator('#text').innerText(),'Replaced text');await site.keyboard.up('ShiftLeft');
 assert.equal(await site.locator('#input').inputValue(),'Original text');
 assert.equal(await site.locator('#editable').innerText(),'Original text');
 result.checks.push('Trusted hold/release restores originals temporarily without disabling stored site; input and editable values protected');
 await send({type:'saveInteractionSettings',interactionSettings:{peekMode:'hold',peekKey:{code:'KeyQ',ctrl:true,alt:false,shift:false,meta:false},editKey:'AltLeft'}});
 await site.locator('#text').click();await site.keyboard.press('q');assert.equal(await site.locator('#text').innerText(),'Replaced text');
 await site.keyboard.down('ControlLeft');await site.keyboard.down('q');await site.locator('#text').filter({hasText:/^Original text$/}).waitFor();
 await site.keyboard.up('ControlLeft');await site.locator('#text').filter({hasText:/^Replaced text$/}).waitFor();await site.keyboard.up('q');
 result.checks.push('Ctrl+Q activates only exact chord and releasing required modifier ends hold');
 await send({type:'saveInteractionSettings',interactionSettings:{peekMode:'toggle',peekKey:'ShiftLeft',editKey:'AltLeft'}});
 await site.locator('#text').click();await site.keyboard.press('ShiftLeft');
 await site.locator('#text').filter({hasText:/^Original text$/}).waitFor();
 await site.keyboard.press('Escape');await site.locator('#text').filter({hasText:/^Replaced text$/}).waitFor();
 await site.keyboard.press('ShiftLeft');await site.locator('#text').filter({hasText:/^Original text$/}).waitFor();
 await site.keyboard.press('ShiftLeft');await site.locator('#text').filter({hasText:/^Replaced text$/}).waitFor();
 result.checks.push('Toggle shortcut and Escape restore replacement without changing stored enable state');
 await site.keyboard.down('AltLeft');await site.locator('#link').click({position:{x:20,y:12}});await site.keyboard.up('AltLeft');
 const replacement=site.locator('[name=replacement]');await replacement.waitFor();
 assert.equal(site.url(),origin+'/test','edit selection must suppress the link navigation');
 assert.equal(await site.locator('[name=original]').inputValue(),'Edit this link');
 assert.equal(await replacement.inputValue(),'Edited link');
 assert.equal(await site.locator('#textpatch-inline-editor select').count(),0,'inline table is not selectable');
 assert.ok(await site.locator('#textpatch-inline-editor').evaluate(el=>el.shadowRoot.textContent.includes('Interaction fixture')));
 await replacement.fill('Inline saved replacement');await site.locator('button[type=submit]').click();
 await site.locator('#link').filter({hasText:/^Inline saved replacement$/}).waitFor();
 await replacement.waitFor({state:'detached'});
 await site.keyboard.down('AltLeft');await site.locator('#new').click({position:{x:20,y:12}});await site.keyboard.up('AltLeft');
 await replacement.waitFor();await replacement.fill('Added inline');await site.locator('button[type=submit]').click();
 await site.locator('#new').filter({hasText:/^Added inline$/}).waitFor();await replacement.waitFor({state:'detached'});
 const stored=await send({type:'libraryGet'}),updated=stored.library.tables.find(t=>t.id===table.id);
 assert.equal(updated.entries.find(e=>e.en==='New original').ko,'Added inline');
 assert.equal(updated.entries.find(e=>e.en==='Edit this link').ko,'Inline saved replacement');
 result.checks.push('Trusted modifier-click edits and adds on-page; link remains on page and canonical table is saved');
 await site.reload();await site.locator('#new').filter({hasText:/^Added inline$/}).waitFor();
 await send({type:'toggleSite',url:origin+'/test',enabled:false});
 await site.locator('#new').filter({hasText:/^New original$/}).waitFor();
 await site.locator('#link').filter({hasText:/^Edit this link$/}).waitFor();
 result.checks.push('Saved inline entries survive page reload, and disabling restores originals');
 assert.equal(await site.locator('#tight').getAttribute('style'),null);
 await context.close();const restarted=await launch();
 const restoredSite=await context.newPage();await restoredSite.goto(origin+'/test');
 const editor=await context.newPage();await editor.goto('chrome-extension://'+restarted.id+'/editor/index.html');
 const persisted=await editor.evaluate(url=>chrome.runtime.sendMessage({type:'state',url}),origin+'/test');
 assert.equal(persisted.page.enabled,false);assert.equal(persisted.interactionSettings.peekMode,'toggle');
 assert.equal(persisted.library.tables.find(t=>t.id===table.id).entries.find(e=>e.en==='New original').ko,'Added inline');
 await editor.evaluate(url=>chrome.runtime.sendMessage({type:'toggleSite',url,enabled:true}),origin+'/test');
 await restoredSite.locator('#new').filter({hasText:/^Added inline$/}).waitFor();
 assert.equal(await restoredSite.locator('#tight').getAttribute('style'),null);
 result.checks.push('Inline editor shows only current table and closes on save; legacy fitting is inert; table/settings survive browser restart and reapply');
 await restoredSite.bringToFront();await restoredSite.keyboard.down('AltLeft');await restoredSite.locator('#new').click({position:{x:20,y:12}});await restoredSite.keyboard.up('AltLeft');
 await restoredSite.locator('[name=delete]').click();
 await restoredSite.locator('[name=delete-cancel]').click();
 assert.equal(await restoredSite.locator('[name=replacement]').inputValue(),'Added inline','cancel deletion retains draft');
 await restoredSite.locator('[name=delete]').click();
 await restoredSite.screenshot({path:path.join(dir,'inline-delete-confirmation.png')});
 await restoredSite.locator('[name=delete-confirm]').click();
 await restoredSite.locator('#textpatch-inline-editor').waitFor({state:'detached'});
 await restoredSite.locator('#new').filter({hasText:/^New original$/}).waitFor();
 const afterDelete=await editor.evaluate(()=>chrome.runtime.sendMessage({type:'libraryGet'}));
 assert.equal(afterDelete.library.tables.find(t=>t.id===table.id).entries.some(e=>e.en==='New original'),false);
 assert.equal(afterDelete.library.tables.find(t=>t.id===table.id).entries.find(e=>e.en==='Edit this link').ko,'Inline saved replacement');
 await restoredSite.reload();await restoredSite.locator('#new').filter({hasText:/^New original$/}).waitFor();
 result.checks.push('Inline deletion cancels without mutation or confirms to delete only the current row, close and restore original across reload');
 await editor.evaluate(id=>chrome.runtime.sendMessage({type:'deleteRule',id}),persisted.page.rule.id);
 await restoredSite.locator('#new').filter({hasText:/^New original$/}).waitFor();
 const beforeUnlinked=await editor.evaluate(()=>chrome.runtime.sendMessage({type:'libraryGet'}));
 await restoredSite.bringToFront();await restoredSite.keyboard.down('AltLeft');await restoredSite.locator('#new').click({position:{x:20,y:12}});await restoredSite.keyboard.up('AltLeft');
 await restoredSite.locator('#textpatch-inline-editor [role=status]').filter({hasText:/popup/i}).waitFor();
 assert.equal(await restoredSite.locator('#textpatch-inline-editor button[type=submit]').isDisabled(),true);
 assert.equal((await editor.evaluate(()=>chrome.runtime.sendMessage({type:'libraryGet'}))).library.revision,beforeUnlinked.library.revision);
 result.checks.push('Unlinked site instructs choosing a table in popup and cannot save into an arbitrary first table');
 await writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await context?.close();await new Promise(resolve=>server.close(resolve));}
