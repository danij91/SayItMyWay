// Headless Chromium, copied extension and empty isolated profile only.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {copyNativeExtension} from './native-fixture.mjs';
import {chooseLanguage} from './language-picker-browser-helpers.mjs';
const {chromium}=await import(pathToFileURL(process.env.TEXT_PATCH_PLAYWRIGHT||'C:/Users/danij/AppData/Local/Temp/crimson-manager-browser/node_modules/playwright/index.mjs'));
const dir=await mkdtemp(path.join(os.tmpdir(),'text-patch-language-search-')),extension=path.join(dir,'extension');await copyNativeExtension(extension);
const context=await chromium.launchPersistentContext(path.join(dir,'profile'),{
  executablePath:process.env.TEXT_PATCH_CHROME||'C:/Users/danij/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',headless:true,
  viewport:{width:400,height:850},args:['--disable-extensions-except='+extension,'--load-extension='+extension]
});
context.setDefaultTimeout(10000);
const report={dir,checks:[],screenshots:[],errors:[],boundary:'Actual headless Chromium input and action popup host; IME composition guards use DOM event simulation, no OS IME or screen-reader verification.'};
const countries={ko:'Republic of Korea',en:'United Kingdom',ja:'Japan','zh-Hans':'China','zh-Hant':'China',es:'Spain',fr:'France',de:'Germany','pt-BR':'Brazil',ru:'Russia',id:'Indonesia',vi:'Vietnam',th:'Thailand',hi:'India',ar:'Saudi Arabia',ro:'ROMANIA',hu:'Hungary',bg:'Bulgaria',uk:'Ukraine',la:'Vatican City'};
const table={schemaVersion:1,id:'fixture',name:'User fixture العربية',entries:[{id:'r',en:'Original 日本語',ko:'',status:'untranslated'}]};
try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),url=new URL(worker.url()),base=url.protocol+'//'+url.host;
  const popup=await context.newPage(),editor=await context.newPage();
  for(const [page,file] of [[popup,'popup.html'],[editor,'editor/index.html']]){page.on('pageerror',e=>report.errors.push(e.message));await page.goto(base+'/'+file);await page.waitForFunction(()=>!!globalThis.TextPatchI18n);await page.evaluate(()=>TextPatchI18n.ready);}
  const appInput=popup.locator('#app-locale').locator('..').locator('[role=combobox]');
  for(const [locale,query] of Object.entries(countries)){
    const before=await popup.locator('#app-locale').inputValue();
    await popup.click('#language-open');await appInput.fill(query);
    assert.equal(await popup.locator('#app-locale').inputValue(),before);
    if(query==='China')assert.equal(await popup.locator('.language-results:visible [role=option]').count(),2);
    await popup.locator('.language-results:visible [data-value='+JSON.stringify(locale)+']').click();
    await editor.waitForFunction(locale=>document.documentElement.lang===locale,locale);
    assert.equal(await worker.evaluate(async()=> (await chrome.storage.local.get('appLocale')).appLocale),locale);
    assert.equal(await popup.locator('#app-locale').isVisible(),false);
  }
  report.checks.push('All 20 app languages selected through English country aliases using real input/click; shared countries remain multiple results; persistence and second-editor sync');
  await popup.click('#language-open');await appInput.fill('no-such-language');assert.equal(await popup.locator('.language-results:visible [role=option]').count(),0);
  assert.ok(await popup.locator('.language-results:visible [role=status]').textContent());await appInput.press('Escape');
  assert.equal(await popup.locator('#app-locale').inputValue(),'la');assert.equal(await popup.locator('#language-menu').isVisible(),false);
  await popup.click('#language-open');await appInput.fill('한글');await appInput.press('ArrowDown');await appInput.press('Enter');assert.equal(await popup.locator('#app-locale').inputValue(),'ko');
  await chooseLanguage(popup,'#app-locale','ro','România');await chooseLanguage(popup,'#app-locale','la','Latina');
  await popup.click('#language-open');await appInput.fill('Korea');await popup.click('h1');assert.equal(await appInput.inputValue(),'Latina');assert.equal(await popup.locator('#app-locale').inputValue(),'la');
  report.checks.push('Korean 한글 keyboard selection, Romanian diacritic matching, Latina, unsupported query/Escape and outside cancellation');
  await editor.evaluate(table=>TextPatchAIUI.open({table,loadPreferences:()=>({})}).then(()=>{}),table);
  assert.equal(await editor.locator('[data-ai=targetLanguage]').inputValue(),'Latina');
  for(const [locale,query] of Object.entries(countries)){
    const name=await editor.evaluate(locale=>TextPatchI18n.languages[locale],locale);
    await chooseLanguage(editor,'[data-ai=sourceLanguage]',name,query);
    await chooseLanguage(editor,'[data-ai=targetLanguage]',name,query);
    assert.equal(await editor.locator('[data-ai=sourceLanguage]').inputValue(),name);assert.equal(await editor.locator('[data-ai=targetLanguage]').inputValue(),name);
  }
  await chooseLanguage(editor,'[data-ai=sourceLanguage]','auto');await chooseLanguage(editor,'[data-ai=targetLanguage]','__custom__');await editor.locator('[data-ai=targetLanguageCustom]').fill('Esperanto');
  await chooseLanguage(popup,'#app-locale','ar','Arabic');await editor.waitForFunction(()=>document.documentElement.dir==='rtl');
  assert.equal(await editor.locator('[data-ai=targetLanguageCustom]').inputValue(),'Esperanto');assert.equal(await editor.locator('[data-ai=sourceLanguage]').inputValue(),'auto');
  for(const width of [400,320]){
    await editor.setViewportSize({width,height:850});
    const input=editor.locator('[data-ai=sourceLanguage]').locator('..').locator('[role=combobox]');await input.fill('China');
    const bounds=await editor.locator('.language-results:visible').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);
    assert.equal(await editor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const file=path.join(dir,'rtl-ai-'+width+'.png');await editor.screenshot({path:file});report.screenshots.push(file);await input.press('Escape');
  }
  report.checks.push('All 20 aliases in both AI pickers via real input/click; auto/custom drafts survive app locale sync; RTL AI list fits 400px and 320px');
  // Native action host, without forcing the popup into a caller-sized tab.
  const cdp=await context.browser().newBrowserCDPSession();let sequence=0;
  for(const locale of ['ko','ar','la']){
    const existingTargets=new Set((await cdp.send('Target.getTargets')).targetInfos.map(target=>target.targetId));
    await worker.evaluate(locale=>chrome.storage.local.set({appLocale:locale}),locale);await worker.evaluate(()=>chrome.action.openPopup());
    let target;for(let i=0;i<100&&!target;i++){target=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.url.endsWith('/popup.html')&&!existingTargets.has(t.targetId));if(!target)await new Promise(r=>setTimeout(r,50));}
    assert.ok(target,'native action popup target');const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});
    const send=(method,params={})=>new Promise((resolve,reject)=>{
      const id=++sequence,timeout=setTimeout(()=>{cdp.off('Target.receivedMessageFromTarget',receive);reject(Error('CDP '+method+' timeout'));},10000);
      function receive(event){if(event.sessionId!==sessionId)return;const message=JSON.parse(event.message);if(message.id!==id)return;clearTimeout(timeout);cdp.off('Target.receivedMessageFromTarget',receive);message.error?reject(Error(message.error.message)):resolve(message.result);}
      cdp.on('Target.receivedMessageFromTarget',receive);cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(reject);
    });
    const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(result.exceptionDetails,undefined);return result.result.value;};
    for(let i=0;i<100;i++){if(await evaluate(`document.readyState==='complete'&&document.documentElement.lang==='${locale}'&&!!document.getElementById('app-locale').languagePicker`))break;await new Promise(r=>setTimeout(r,50));}
    await evaluate(`document.getElementById('language-open').click()`);await send('Input.insertText',{text:'China'});await new Promise(r=>setTimeout(r,200));
    const layout=await evaluate(`(()=>{const r=document.querySelector('.language-results').getBoundingClientRect();return {width:innerWidth,body:document.body.getBoundingClientRect().width,scroll:document.documentElement.scrollWidth,left:r.left,right:r.right,dir:document.documentElement.dir,matches:document.querySelectorAll('.language-results [role=option]').length};})()`);
    assert.equal(layout.body,400);assert.ok(layout.width>=400&&layout.width<=450);assert.ok(layout.scroll<=layout.width);assert.ok(layout.left>=0&&layout.right<=layout.width);assert.equal(layout.matches,2);assert.equal(layout.dir,locale==='ar'?'rtl':'ltr');
    const file=path.join(dir,'action-language-'+locale+'.png'),shot=await send('Page.captureScreenshot');await writeFile(file,Buffer.from(shot.data,'base64'));report.screenshots.push(file);report.checks.push({locale,actionPopup:layout});
    await cdp.send('Target.closeTarget',{targetId:target.targetId});
    // Restore an active tab in this headless window before another action popup.
    await popup.bringToFront();await new Promise(r=>setTimeout(r,300));
  }
  assert.deepEqual(report.errors,[]);
}catch(error){report.error=error.stack;throw error;}
finally{await context.close();await writeFile(path.join(dir,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
