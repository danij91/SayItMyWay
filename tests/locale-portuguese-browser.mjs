// Explicit headless native Chromium check. Uses the production build, a copied
// extension, an isolated temporary profile and synthetic data only.
import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chooseLanguage} from './language-picker-browser-helpers.mjs';

const {chromium}=await import(pathToFileURL(process.env.TEXT_PATCH_PLAYWRIGHT||'C:/Users/danij/AppData/Local/Temp/crimson-manager-browser/node_modules/playwright/index.mjs'));
const dir=await mkdtemp(path.join(os.tmpdir(),'text-patch-portuguese-native-')),extension=path.join(dir,'extension');
await cp(fileURLToPath(new URL('../dist/extension/',import.meta.url)),extension,{recursive:true});
assert.equal(JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8')).version,'1.0.1');
assert.equal(JSON.parse(await readFile(path.join(extension,'_locales/pt_PT/messages.json'),'utf8')).appName.message,'SayItMyWay');
const context=await chromium.launchPersistentContext(path.join(dir,'profile'),{
 executablePath:process.env.TEXT_PATCH_CHROME||'C:/Users/danij/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',
 headless:true,locale:'pt-PT',viewport:{width:1100,height:900},args:['--disable-extensions-except='+extension,'--load-extension='+extension]
});
context.setDefaultTimeout(10000);
const report={dir,checks:[],screenshots:[],errors:[],boundary:'Headless Chromium production extension in an isolated temporary profile; synthetic table only; no visible window, OS focus or native-speaker verification.'};
const table={schemaVersion:1,id:'fixture',name:'User fixture 日本語',entries:[{id:'r',en:'Original <script> 日本語',ko:'',status:'untranslated',notes:'Keep {p0}'}]};
try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),url=new URL(worker.url()),base=url.protocol+'//'+url.host;
 await worker.evaluate(()=>chrome.storage.local.set({appLocale:'pt-BR'}));
 const pages={};
 for(const file of ['popup.html','editor/index.html','manager.html','options.html']){
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(file+': '+error.message));
  await page.goto(base+'/'+file);await page.waitForFunction(()=>document.documentElement.lang==='pt-BR');pages[file]=page;
  assert.equal(await page.evaluate(()=>TextPatchI18n.languages['pt-BR']),'Português (Brasil)');
 }
 report.checks.push('Saved pt-BR restored across all four native surfaces with a pt-PT browser context');
 const popup=pages['popup.html'],editor=pages['editor/index.html'];await popup.setViewportSize({width:400,height:850});
 for(const [code,name,query] of [['pt-PT','Português (Portugal)','Portugal'],['pt-BR','Português (Brasil)','Brazil']]){
  await chooseLanguage(popup,'#app-locale',code,query);
  for(const page of Object.values(pages))await page.waitForFunction(code=>document.documentElement.lang===code,code);
  assert.equal(await worker.evaluate(async()=> (await chrome.storage.local.get('appLocale')).appLocale),code);
  assert.equal(await worker.evaluate(code=>TextPatchI18n.resolveLocale(code),code),code);
  await editor.evaluate(table=>TextPatchAIUI.open({table,loadPreferences:async()=>({targetLanguage:'English'})}).then(()=>{}),table);
  assert.equal(await editor.locator('[data-ai=targetLanguage]').inputValue(),name);
  assert.equal(await editor.locator('[data-ai=copy]').innerText(),code==='pt-PT'?'Copiar pedido':'Copiar solicitação');
  for(const field of ['sourceLanguage','targetLanguage']){
   const select=editor.locator('[data-ai='+field+']'),inputId=await select.evaluate(el=>el.languagePicker.input.id),input=editor.locator('#'+inputId);
   for(const [query,expected] of [['Portugal',['Português (Portugal)']],['pt-PT',['Português (Portugal)']],['Brazil',['Português (Brasil)']],['pt-BR',['Português (Brasil)']],['Portuguese',['Português (Brasil)','Português (Portugal)']],['Portugues',['Português (Brasil)','Português (Portugal)']],['pt',['Português (Brasil)','Português (Portugal)']]]){
    await input.fill(query);const list=editor.locator('#'+await input.getAttribute('aria-controls'));
    assert.deepEqual(await list.locator('[role=option]').evaluateAll(nodes=>nodes.map(node=>node.dataset.value)),expected,field+' '+query);
   }
   await chooseLanguage(editor,'[data-ai='+field+']',name,query);
  }
  const prompt=await editor.evaluate(({table,name})=>TextPatchAI.build({table,task:'translation',targetLanguage:name,requestId:'native-portuguese'}).text,{table,name});
  assert.ok(prompt.includes(name));assert.ok(prompt.includes('"original": "Original <script> 日本語"'));assert.ok(prompt.includes('"replacement": ""'));assert.ok(prompt.includes('"requestRow": "0"'));
  if(code==='pt-PT'){
   assert.match(prompt,/utilizador/);assert.match(prompt,/deteção/);
   for(const width of [400,320]){
    await editor.setViewportSize({width,height:900});
    assert.equal(await editor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'AI width '+width);
    const file=path.join(dir,'pt-PT-ai-'+width+'.png');await editor.screenshot({path:file});report.screenshots.push(file);
   }
   const file=path.join(dir,'pt-PT-popup.png');await popup.screenshot({path:file});report.screenshots.push(file);
  }
  await editor.locator('[data-ai=close]').click();
  const reopened=await context.newPage();await reopened.goto(base+'/popup.html');await reopened.waitForFunction(code=>document.documentElement.lang===code,code);await reopened.close();
  report.checks.push(code+': real picker selection, persistence/reopening, live surface sync, worker registry, AI defaults, both search pickers and localized prompt/schema');
 }
 assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.status='failed';report.failure=error.stack;throw error;}
finally{await writeFile(path.join(dir,'report.json'),JSON.stringify(report,null,2));console.log('Native Portuguese report:',path.join(dir,'report.json'));await context.close();}
