// Isolated real Chromium delivery/layout checks. No live data or profile is used.
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {createServer} from '../server.mjs';
const {chromium}=await import(pathToFileURL(process.env.ADMIN_PLAYWRIGHT_MODULE||path.join(os.tmpdir(),'crimson-manager-browser/node_modules/playwright/index.mjs')));
const dir=await mkdtemp(path.join(os.tmpdir(),'crimson-ai-delivery-'));
const dataPath=path.join(dir,'dictionary.json');await copyFile(new URL('../extension/data/dictionary.json',import.meta.url),dataPath);
const original=await readFile(dataPath,'utf8'),server=await createServer({dataPath});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
let browser;const report={dir,checks:[],screenshots:[],errors:[]};
const row=i=>({id:'row-'+i,en:'Original '+i,ko:'',status:'untranslated',source:'https://example.com/source',notes:'keep '+i});
const table={schemaVersion:1,name:'../Large:table',captureSources:[{url:'https://example.com',title:'Source',language:'en'}],entries:Array.from({length:605},(_,i)=>row(i))};
try{
  browser=await chromium.launch({executablePath:process.env.ADMIN_BROWSER_EXE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const context=await browser.newContext({locale:'ko-KR',viewport:{width:1280,height:900},permissions:['clipboard-read','clipboard-write']});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(base);
  await page.locator('#rows tr').first().waitFor();
  const open=async table=>{
    await page.evaluate(table=>TextPatchAIUI.open({table,loadPreferences:()=>({targetLanguage:'Esperanto'}),savePreferences:()=>{}}).then(()=>{}),table);
    await page.locator('[data-ai=targetLanguage]').selectOption('__custom__');await page.locator('[data-ai=targetLanguageCustom]').fill('Esperanto');
  };
  const screenshot=async name=>{const file=path.join(dir,name+'.png');await page.screenshot({path:file});report.screenshots.push(file);};
  const payload=text=>JSON.parse(text.replaceAll('\r\n','\n').split('--- JSON 데이터 시작 ---\n\n')[1].split('\n\n--- JSON 데이터 끝 ---')[0]);
  const contextPrefix=await page.evaluate(()=>TextPatchI18n.t('current_page_context_separate_from_table_capture_sources'));
  const pageContext=text=>JSON.parse(text.replaceAll('\r\n','\n').split(contextPrefix)[1].split('\n\n')[0]);
  // Native select keyboard interaction, all endonyms visible from auto, custom drafts and persisted migration.
  await page.evaluate(table=>TextPatchAIUI.open({table,loadPreferences:()=>({})}).then(()=>{}),table);
  assert.equal(await page.locator('[data-ai=sourceLanguage]').inputValue(),'auto');
  assert.equal(await page.locator('[data-ai=targetLanguage]').inputValue(),'한국어');
  for(const name of ['sourceLanguage','targetLanguage']){
    assert.equal(await page.locator(`[data-ai=${name}]`).evaluate(el=>el.tagName),'SELECT');
    assert.equal(await page.locator(`[data-ai=${name}] option`).count(),17);
    assert.deepEqual(await page.locator(`[data-ai=${name}] option`).allTextContents().then(values=>values.slice(1,-1)),await page.evaluate(()=>Object.values(TextPatchI18n.languages)));
  }
  await page.locator('[data-ai=sourceLanguage]').focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-ai=sourceLanguage]').inputValue(),'한국어');
  await page.locator('[data-ai=sourceLanguage]').selectOption('__custom__');await page.locator('[data-ai=sourceLanguageCustom]').fill('Historical Latin');
  await page.locator('[data-ai=targetLanguage]').selectOption('__custom__');await page.locator('[data-ai=targetLanguageCustom]').fill('Esperanto');
  await page.locator('[data-ai=targetLanguage]').selectOption('العربية');assert.equal(await page.locator('[data-ai=targetLanguageCustom]').isVisible(),false);
  await page.locator('[data-ai=targetLanguage]').selectOption('__custom__');assert.equal(await page.locator('[data-ai=targetLanguageCustom]').inputValue(),'Esperanto');
  assert.equal(await page.locator('[data-ai=websiteURL]').inputValue(),'https://example.com/');
  await page.locator('[data-ai=websiteURL]').fill('https://name:password@manual.example/path?secret=yes#secret');
  await page.locator('[data-ai=copy]').click();await page.locator('[data-ai=status]').filter({hasText:'복사했습니다'}).waitFor();
  let nativeCopy=await page.evaluate(()=>navigator.clipboard.readText());
  assert.deepEqual(pageContext(nativeCopy),{url:'https://manual.example/path',title:'',language:''});
  assert.doesNotMatch(nativeCopy,/password|secret=yes|#secret/);
  await page.locator('[data-ai=websiteURL]').fill('ftp://invalid.example');await page.locator('[data-ai=copy]').click();
  assert.equal(await page.locator('[data-ai=websiteURL]').evaluate(el=>el===document.activeElement),true);
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),nativeCopy);
  await page.locator('[data-ai=websiteURL]').fill('');await page.locator('[data-ai=copy]').click();await page.locator('[data-ai=status]').filter({hasText:'복사했습니다'}).waitFor();
  nativeCopy=await page.evaluate(()=>navigator.clipboard.readText());assert.equal(pageContext(nativeCopy),null);
  assert.deepEqual(payload(nativeCopy).captureSources,table.captureSources);
  const preferences=await page.evaluate(()=>JSON.parse(localStorage.getItem('aiRequestPreferences')));
  assert.equal(preferences.targetLanguage,'Esperanto');assert.equal(preferences.sourceLanguage,'Historical Latin');assert.equal('websiteURL' in preferences,false);
  await page.keyboard.press('Escape');
  await page.evaluate(table=>TextPatchAIUI.open({table}).then(()=>{}),table);
  assert.equal(await page.locator('[data-ai=targetLanguage]').inputValue(),'한국어');assert.equal(await page.locator('[data-ai=targetLanguageCustom]').inputValue(),'');
  assert.equal(await page.locator('[data-ai=websiteURL]').inputValue(),'https://example.com/');
  await screenshot('native-language-and-site');await page.keyboard.press('Escape');
  report.checks.push('native 15-language selects and keyboard choice, custom drafts/preferences, edited sanitized website, optional blank and invalid URL focus');
  await open(table);await page.locator('[data-ai=copy]').click();
  await page.locator('[data-ai=status]').filter({hasText:'605행 요청을 복사'}).waitFor();
  const copied=await page.evaluate(()=>navigator.clipboard.readText());
  assert.deepEqual(payload(copied).entries.map(e=>e.original),table.entries.map(e=>e.en));
  assert.match(copied,/Esperanto/);assert.equal(await page.locator('[data-ai=output],[data-ai=generate]').count(),0);
  await screenshot('wide-copy');report.checks.push('real clipboard copy includes all 605 eligible rows in order');
  await page.keyboard.press('Escape');await page.locator('[data-ai-dialog]').waitFor({state:'detached'});
  await page.setViewportSize({width:400,height:850});await open(table);
  const bounds=await page.locator('[data-ai-dialog]').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=400);
  await page.locator('[data-ai=task]').selectOption('replacement');await page.locator('[data-ai=instruction]').fill('Use short labels');
  await page.locator('[data-ai=copy]').click();await page.locator('[data-ai=status]').filter({hasText:'복사했습니다'}).waitFor();
  await screenshot('narrow-replacement');
  // Native modal Tab navigation never enters background controls; Escape removes it.
  for(let i=0;i<9;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement===document.body || !!document.activeElement.closest('[data-ai-dialog]')),true);}
  await page.keyboard.press('Escape');await page.locator('[data-ai-dialog]').waitFor({state:'detached'});
  report.checks.push('400px layout, free instruction, modal Tab containment and Escape');
  const huge={...table,name:'메타'.repeat(80000),entries:[{...row(-1),en:'한😀'.repeat(150000),notes:'keep'.repeat(80000)},...table.entries,{...row(999),ko:'Known',status:'verified'}]};
  await open(huge);await page.locator('[data-ai=copy]').click();await page.locator('[data-ai=status]').filter({hasText:'긴 요청'}).waitFor();
  assert.equal(await page.locator('[data-ai=download]').evaluate(el=>el===document.activeElement),true);
  await screenshot('narrow-large-file');
  const downloadEvent=page.waitForEvent('download');await page.locator('[data-ai=download]').click();const download=await downloadEvent;
  assert.ok(download.suggestedFilename().endsWith('.txt'));
  const text=await readFile(await download.path(),'utf8'),data=payload(text);
  assert.equal(data.name,huge.name);assert.deepEqual(data.captureSources,huge.captureSources);
  assert.deepEqual(data.entries.map(e=>e.original),huge.entries.slice(0,-1).map(e=>e.en));assert.equal(data.entries[0].notes,huge.entries[0].notes);
  report.checks.push('native UTF-8 txt download includes every 606 eligible rows, giant single row, metadata and provenance without truncation');
  await page.keyboard.press('Escape');
  const small={...table,entries:[row(0)]};await open(small);
  for(const locale of await page.evaluate(()=>Object.keys(TextPatchI18n.languages))){
    await page.evaluate(locale=>TextPatchI18n.setLocale(locale),locale);
    for(const task of ['translation','replacement']){
      await page.locator('[data-ai=task]').selectOption(task);
      if(task==='replacement')await page.locator('[data-ai=instruction]').fill('Use short labels');
      const expected=await page.evaluate(({table,task})=>TextPatchAI.build({table,task,sourceLanguage:'auto',targetLanguage:'Esperanto',instruction:'Use short labels',page:{url:'https://example.com/',title:'Source',language:'en'}}).text,{table:small,task});
      await page.locator('[data-ai=copy]').click();
      const copied=await page.evaluate(()=>navigator.clipboard.readText());
      assert.equal(copied.replaceAll('\r\n','\n'),expected,locale+': '+task+' real clipboard');
      const downloading=page.waitForEvent('download');await page.locator('[data-ai=download]').click();
      const downloaded=await downloading;
      assert.equal(await readFile(await downloaded.path(),'utf8'),expected,locale+': '+task+' real UTF-8 file');
      await downloaded.saveAs(path.join(dir,'prompt-'+locale+'-'+task+'.txt'));
    }
  }
  report.checks.push('all 15 app locales switched while one dialog stays open: translation and replacement builder/real clipboard/UTF-8 download equality (30 requests)');
  await page.evaluate(()=>TextPatchI18n.setLocale('ko'));
  await page.keyboard.press('Escape');await open(small);
  // Deterministic rejection injection only; successful copy/download above use browser APIs.
  await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw Error('test denial');};});
  await page.locator('[data-ai=copy]').click();await page.locator('[data-ai=status]').filter({hasText:'복사하지 못했습니다'}).waitFor();
  assert.equal(await page.locator('[data-ai=output]').count(),0);await screenshot('narrow-rejected-copy');
  report.checks.push('injected clipboard denial offers file delivery without exposing prompt');
  assert.equal(await readFile(dataPath,'utf8'),original);assert.deepEqual(report.errors,[]);
}finally{
  await browser?.close();await new Promise(r=>server.close(r));await writeFile(path.join(dir,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}


