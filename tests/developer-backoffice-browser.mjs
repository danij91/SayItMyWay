// Run explicitly with an existing Playwright installation; no extension/profile install.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {startDeveloperServer} from '../scripts/developer-server.mjs';
const {chromium}=await import(pathToFileURL(process.env.TEXT_PATCH_PLAYWRIGHT||'C:/Users/danij/AppData/Local/Temp/crimson-manager-browser/node_modules/playwright/index.mjs'));
const server=await startDeveloperServer({port:0}),base=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
  browser=await chromium.launch({channel:'chromium',headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:1000},acceptDownloads:true});
  // Fail if UI tries to touch runtime/user storage. Only clipboard is allowed.
  await context.addInitScript(()=>{
    for(const key of ['indexedDB','localStorage','sessionStorage'])Object.defineProperty(window,key,{get(){throw Error('Forbidden storage '+key);}});
    Object.defineProperty(window,'chrome',{value:undefined});
  });
  const page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',request=>requests.push(request.url()));
  await page.goto(base);await page.waitForFunction(()=>!document.getElementById('generate').disabled);
  assert.equal(await page.locator('#locale option').count(),15);
  for(const locale of await page.locator('#locale option').evaluateAll(nodes=>nodes.map(n=>n.value))){
    await page.selectOption('#locale',locale);
    for(const task of ['translation','replacement']){
      await page.selectOption('#task',task);await page.click('#generate');
      await page.waitForFunction(()=>!!document.getElementById('output').value);
      const output=await page.locator('#output').inputValue();
      const expected=await (await fetch(base+'/api/prompt?'+new URLSearchParams({locale,task,instruction:'자연스럽고 간결한 표현으로 바꾸세요.',target:'한국어',source:'auto',sample:'synthetic',site:''}))).json();
      assert.equal(output,expected.text);
    }
  }
  await page.selectOption('#sample','bundled');assert.equal(await page.locator('#output').inputValue(),'');assert.equal(await page.locator('#copy').isDisabled(),true);
  await page.click('#generate');await page.waitForFunction(()=>!!document.getElementById('output').value);
  const output=await page.locator('#output').inputValue();
  const downloadWait=page.waitForEvent('download');await page.click('#download');const download=await downloadWait;
  assert.equal(await readFile(await download.path(),'utf8'),output);
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});await page.click('#copy');
  assert.equal((await page.evaluate(()=>navigator.clipboard.readText())).replaceAll('\r\n','\n'),output);
  if(process.env.TEXT_PATCH_DEVTOOLS_EVIDENCE){await mkdir(process.env.TEXT_PATCH_DEVTOOLS_EVIDENCE,{recursive:true});await page.screenshot({path:path.join(process.env.TEXT_PATCH_DEVTOOLS_EVIDENCE,'prompt.png'),fullPage:true});}
  await page.click('[data-panel=locales]');await page.selectOption('#catalog-locale','ko');await page.fill('#locale-search','json_data_start');
  assert.equal(await page.locator('#locale-rows tbody tr').count(),1);assert.match(await page.locator('#locale-rows').textContent(),/json_data_start/);
  await page.click('[data-panel=dictionary]');assert.match(await page.locator('#dictionary-meta').textContent(),/147행/);
  await page.fill('#dictionary-search','official-0');assert.equal(await page.locator('#dictionary-rows tbody tr').count(),1);
  assert.match(await page.locator('#dictionary-rows').textContent(),/pearlabyss/);
  await page.fill('#dictionary-search','<img src=x>');assert.equal(await page.locator('#dictionary-rows tbody tr').count(),0);assert.equal(await page.locator('img').count(),0);
  await page.fill('#dictionary-search','');
  if(process.env.TEXT_PATCH_DEVTOOLS_EVIDENCE)await page.screenshot({path:path.join(process.env.TEXT_PATCH_DEVTOOLS_EVIDENCE,'dictionary.png'),fullPage:false});
  assert.deepEqual(errors,[]);assert.ok(requests.every(url=>url.startsWith(base+'/')),requests.join('\n'));
  console.log('PASS localhost browser: 15 locales x 2 tasks, exact shared builder, stale output invalidation, UTF-8 download/clipboard, locale/dictionary search, no storage or extension APIs, loopback requests only.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
