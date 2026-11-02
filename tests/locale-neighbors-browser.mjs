import {chooseLanguage} from './language-picker-browser-helpers.mjs';
// Explicit headless Chromium integration; copied extension, isolated profile,
// synthetic table only. Never opens or focuses a visible OS window.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {copyNativeExtension} from './native-fixture.mjs';

const {chromium}=await import(pathToFileURL(process.env.TEXT_PATCH_PLAYWRIGHT||'C:/Users/danij/AppData/Local/Temp/crimson-manager-browser/node_modules/playwright/index.mjs'));
const dir=await mkdtemp(path.join(os.tmpdir(),'text-patch-neighbor-native-')),extension=path.join(dir,'extension');
await copyNativeExtension(extension);
const context=await chromium.launchPersistentContext(path.join(dir,'profile'),{
  executablePath:process.env.TEXT_PATCH_CHROME||'C:/Users/danij/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',
  headless:true,viewport:{width:1100,height:900},args:['--disable-extensions-except='+extension,'--load-extension='+extension]
});
const report={dir,checks:[],errors:[],screenshots:[],boundary:'Headless isolated unpacked extension and synthetic table; no native-speaker verification.'};
context.setDefaultTimeout(10000);
try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),workerURL=new URL(worker.url()),base=workerURL.protocol+'//'+workerURL.host;
  const pages={};
  for(const file of ['popup.html','editor/index.html','manager.html','options.html']){
    console.log('Loading isolated extension surface:',file);
    const page=await context.newPage();page.on('pageerror',error=>report.errors.push(file+': '+error.message));
    await page.goto(base+'/'+file);await page.waitForFunction(()=>!!globalThis.TextPatchI18n);await page.evaluate(()=>TextPatchI18n.ready);pages[file]=page;
  }
  const popup=pages['popup.html'];await popup.setViewportSize({width:400,height:850});
  const table={schemaVersion:1,id:'fixture',name:'User fixture العربية',entries:[{id:'r',en:'Original 日本語',ko:'',status:'untranslated',notes:'Keep {p0}'}]};
  for(const [locale,name] of Object.entries({ro:'Română',hu:'Magyar',bg:'Български',uk:'Українська',la:'Latina'})){
    console.log('Checking native locale:',locale);
    await popup.click('#language-open');await chooseLanguage(popup,'#app-locale',locale);
    for(const [file,page] of Object.entries(pages)){
      await page.waitForFunction(locale=>document.documentElement.lang===locale,locale);
      assert.equal(await page.evaluate(()=>document.documentElement.dir),'ltr',file+' '+locale);
      assert.equal(await page.evaluate(()=>Object.keys(TextPatchI18n.languages).length),21);
    }
    assert.equal(await worker.evaluate(async()=> (await chrome.storage.local.get('appLocale')).appLocale),locale);
    assert.equal(await worker.evaluate(()=>Object.keys(TextPatchI18n.languages).length),21);
    const editor=pages['editor/index.html'];
    await editor.evaluate(table=>TextPatchAIUI.open({table,loadPreferences:async()=>({targetLanguage:'English'})}).then(()=>{}),table);
    assert.equal(await editor.locator('[data-ai=sourceLanguage]').inputValue(),'auto');
    assert.equal(await editor.locator('[data-ai=targetLanguage]').inputValue(),name);
    for(const field of ['sourceLanguage','targetLanguage'])assert.equal(await editor.locator('[data-ai='+field+'] option').count(),23);
    const prompt=await editor.evaluate(({table,name})=>TextPatchAI.build({table,task:'translation',targetLanguage:name,requestId:'native-fixture'}).text,{table,name});
    assert.ok(prompt.includes(await editor.evaluate(name=>TextPatchI18n.t('ai_response_language',{p0:name}),name)));
    assert.ok(prompt.includes('"original": "Original 日本語"'));assert.ok(prompt.includes('"requestRow": "0"'));
    if(locale==='la'){
      assert.match(await popup.locator('#app-locale').getAttribute('title'),/Latina experimentalis/);
      await popup.click('#language-open');
      assert.equal(await popup.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      for(const [label,page] of [['latin-popup-language',popup],['latin-editor-ai',editor]]){
        const file=path.join(dir,label+'.png');await page.screenshot({path:file});report.screenshots.push(file);
      }
    }
    await editor.locator('[data-ai=close]').click();
    const reopened=await context.newPage();await reopened.goto(base+'/popup.html');
    await reopened.waitForFunction(locale=>document.documentElement.lang===locale,locale);await reopened.close();
    report.checks.push(locale+': native picker, four live surfaces, persisted reopening, worker registry, AI defaults and JSON linkage');
  }
  await chooseLanguage(popup,'#app-locale','ar');
  await pages['editor/index.html'].waitForFunction(()=>document.documentElement.dir==='rtl');
  await popup.click('#language-open');
  await chooseLanguage(popup,'#app-locale','la');
  await pages['editor/index.html'].waitForFunction(()=>document.documentElement.dir==='ltr');
  report.checks.push('Arabic RTL to Latin LTR synchronization');
  assert.deepEqual(report.errors,[]);
}finally{
  await context.close();await writeFile(path.join(dir,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
