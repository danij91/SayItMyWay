import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const source=async file=>(await readFile(new URL('../extension/'+file,import.meta.url),'utf8')).replace(/^\uFEFF/,'');

// Real Chromium layout/input with deterministic storage/extension API fixtures.
// Never uses an installed extension, user profile or user table storage.
test('native Arabic mixed text, open dialogs, URL isolation and 400px popup',{skip:!process.env.TEXT_PATCH_CHROME,timeout:40000},async()=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'text-patch-rtl-'));let child,ws;
  try{
    child=spawn(process.env.TEXT_PATCH_CHROME,['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+temp,'about:blank'],{windowsHide:true,stdio:'ignore'});
    let port;
    for(let i=0;i<100;i++){try{port=Number((await readFile(path.join(temp,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await new Promise(r=>setTimeout(r,50));}}
    assert.ok(port,'isolated Chromium starts');
    const version=await(await fetch('http://127.0.0.1:'+port+'/json/version')).json();console.log('RTL native browser:',version.Browser);
    ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
    let seq=0;const pending=new Map();
    ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
    const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));});
    const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    let activeSession=sessionId;
    const cmd=(method,params)=>send(method,params,activeSession);
    const freshPage=async()=>{const {targetId}=await send('Target.createTarget',{url:'about:blank'});activeSession=(await send('Target.attachToTarget',{targetId,flatten:true})).sessionId;};
    const run=async expression=>{const r=await cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert.equal(r.exceptionDetails,undefined,JSON.stringify(r.exceptionDetails));return r.result.value;};
    const mount=async(file,styles,width)=>{
      await cmd('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
      const html=(await source(file)).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link\b[^>]*>/g,'');
      await run(`document.open();document.write(${JSON.stringify(html)});document.close();`);
      await run(`document.head.append(Object.assign(document.createElement('style'),{textContent:${JSON.stringify((await Promise.all(styles.map(source))).join('\n'))}}))`);
      await run(`globalThis.chrome={storage:{local:{get:async()=>({}),set:async()=>{}},onChanged:{addListener:()=>{}}}}`);
      for(const f of ['locales/en.js','locales/ko.js','locales/ar.js','i18n.js','shared.js','library.js','ai-request.js','ai-request-ui.js'])await run(await source(f));
      await run('TextPatchI18n.ready');
    };
    const screenshot=async name=>{
      if(!process.env.TEXT_PATCH_RTL_EVIDENCE)return;
      await mkdir(process.env.TEXT_PATCH_RTL_EVIDENCE,{recursive:true});
      const shot=await cmd('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      await writeFile(path.join(process.env.TEXT_PATCH_RTL_EVIDENCE,name+'.png'),Buffer.from(shot.data,'base64'));
    };
    await mount('editor/index.html',['editor/style.css','ai-request.css'],1100);
    const seed=JSON.parse(await source('data/dictionary.json'));
    await run(`globalThis.libraryFixture=TextPatch.migrate(${JSON.stringify(seed)});globalThis.testTable=libraryFixture.tables[0];testTable.name='جدول Korean 한국어 / ABC 123 (42)';Object.assign(testTable.entries[0],{en:'English 한국어 123 (س)',ko:'العربية ABC 42 (한)',status:'review'});globalThis.savedFixture=JSON.stringify(libraryFixture);globalThis.saveCalls=0;globalThis.EditorStorage={load:async()=>structuredClone(libraryFixture),save:async()=>{saveCalls++}};`);
    await run(await source('editor/import.js'));await run(await source('editor/app.js'));
    await run(`new Promise(r=>setTimeout(r,20))`);await run(`TextPatchI18n.setLocale('ar')`);
    assert.deepEqual(await run(`[document.documentElement.dir,getComputedStyle(document.querySelector('#rows td')).direction,getComputedStyle(document.querySelector('#rows td:nth-child(2)')).direction]`),['rtl','ltr','rtl']);
    await screenshot('editor-ar-mixed');
    await run(`document.querySelector('#rows button').click();document.querySelector('[name=en]').focus();document.querySelector('[name=en]').select()`);
    await cmd('Input.insertText',{text:'مسودة 한국어 ABC 123 (42)'});
    await run(`TextPatchI18n.setLocale('en');TextPatchI18n.setLocale('ko');TextPatchI18n.setLocale('ar')`);
    assert.equal(await run(`document.querySelector('[name=en]').value`),'مسودة 한국어 ABC 123 (42)');
    assert.equal(await run(`document.getElementById('editor').open`),true);await screenshot('editor-ar-open-draft');
    await run(`document.getElementById('editor').close();TextPatchAIUI.open({table:testTable,loadPreferences:async()=>({sourceLanguage:'한국어',targetLanguage:'العربية',instruction:'ABC 한국어 123 (س)'})})`);
    await run(`document.querySelector('[data-ai=targetLanguage]').value='العربية';document.querySelector('[data-ai=targetLanguage]').dispatchEvent(new Event('change'))`);
    await run(`TextPatchI18n.setLocale('en');TextPatchI18n.setLocale('ar')`);
    assert.deepEqual(await run(`['sourceLanguage','targetLanguage','instruction'].map(n=>document.querySelector('[data-ai='+n+']').value)`),['한국어','العربية','ABC 한국어 123 (س)']);
    assert.deepEqual(await run(`[saveCalls,JSON.stringify(libraryFixture)===savedFixture]`),[0,true]);await screenshot('editor-ar-ai');
    // A fresh page avoids sharing classic-script lexical declarations between surfaces.
    await freshPage();
    await mount('popup.html',['popup.css','ai-request.css','site-settings.css'],400);
    await run(`globalThis.popupTable=TextPatch.migrate(${JSON.stringify(seed)}).tables[0];popupTable.name='جدول 한국어 ABC 123 (42)';globalThis.rule={id:'r',origin:'https://example.com',scope:'prefix',path:'/docs/123',tableId:popupTable.id,enabled:true};globalThis.snapshot={enabled:true,includeReview:false,library:{tables:[popupTable]},rules:[rule],page:{enabled:true,table:popupTable,rule}};globalThis.chrome={runtime:{getURL:p=>'https://example.test/'+p,sendMessage:async m=>m.type==='collectionState'?{collection:null}:m.type==='pageState'?snapshot.page:snapshot},tabs:{query:async()=>[{id:1,url:'https://example.com/docs/123'}],sendMessage:async()=>({enabled:true,tableId:popupTable.id,translated:12})},storage:{local:{get:async()=>({}),set:async()=>{}},onChanged:{addListener:()=>{}}}};`);
    await run(await source('site-list.js'));await run(await source('popup.js'));
    await run(`new Promise(r=>setTimeout(r,20))`);await run(`TextPatchI18n.setLocale('ar');document.getElementById('sites-list').open=true`);await run(`new Promise(r=>setTimeout(r,20))`);
    assert.deepEqual(await run(`[innerWidth,document.body.getBoundingClientRect().width,document.documentElement.scrollWidth,document.documentElement.dir]`),[400,400,400,'rtl']);
    assert.equal(await run(`getComputedStyle(document.querySelector('.site-origin')).direction`),'ltr');
    assert.equal(await run(`document.querySelector('#rules bdi').textContent`),'/docs/123');
    assert.equal(await run(`getComputedStyle(document.querySelector('#rules bdi')).direction`),'ltr');await screenshot('popup-ar-400');
    await run("document.querySelector('.site-settings-button').click()");
    assert.equal(await run("document.querySelector('.site-settings').open"),true);
    assert.equal(await run("document.querySelectorAll('.site-settings input[type=checkbox]').length"),2);
    for(const width of [400,320]){
      await cmd('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
      // The action popup requests a fixed 400px body; a forced 320px tab is
      // only a dialog constraint probe, not the native host's popup sizing.
      if(width>=400)assert.equal(await run("document.documentElement.scrollWidth<=innerWidth"),true);
      assert.equal(await run("(()=>{const r=document.querySelector('.site-settings').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth})()"),true);
      await screenshot('site-settings-ar-'+width);
    }
    await run("document.querySelector('.settings-cancel').click()");
    await cmd('Emulation.setDeviceMetricsOverride',{width:400,height:1000,deviceScaleFactor:1,mobile:false});
    await run(`globalThis.siteControls=[...document.querySelectorAll('#rules select,#rules input,#rules a')];`);
    for(const locale of ['ko','en','ar']){
      await run(`TextPatchI18n.setLocale('${locale}')`);
      assert.equal(await run(`siteControls.every((el,i)=>el===document.querySelectorAll('#rules select,#rules input,#rules a')[i])`),true);
    }
    await run(`TextPatchAIUI.open({table:popupTable,loadPreferences:async()=>({sourceLanguage:'한국어',targetLanguage:'العربية'})})`);
    assert.equal(await run(`document.querySelector('[data-ai-dialog]').getBoundingClientRect().width<=400`),true);await screenshot('popup-ar-ai-400');
    // The replacement engine is independently scoped: no application direction leaks to a website.
    await freshPage();
    await run(`document.documentElement.dir='ltr';document.body.innerHTML='<p>Original 123</p><input value="Original 123">'`);
    for(const f of ['shared.js','engine.js'])await run(await source(f));
    await run(`globalThis.translator=new CrimsonTranslator(document);translator.setData({schemaVersion:1,revision:1,defaults:{},entries:[{id:'x',en:'Original 123',ko:'العربية 123',status:'verified',kind:'general',category:'test',context:'global',selector:'',source:'fixture',evidence:'fixture',notes:''}]});`);
    assert.deepEqual(await run(`[document.documentElement.dir,document.querySelector('p').textContent,document.querySelector('input').value]`),['ltr','العربية 123','Original 123']);
    await run('translator.setEnabled(false)');assert.equal(await run(`document.querySelector('p').textContent`),'Original 123');
  }finally{
    ws?.close();if(child&&child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}
    // temp is an explicitly created OS temporary directory, never a user profile.
    assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith('text-patch-rtl-'));
    await rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});
