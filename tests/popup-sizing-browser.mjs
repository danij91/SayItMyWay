// Real action popup: never set a viewport or open popup.html in a sized tab.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {copyNativeExtension} from './native-fixture.mjs';
const {chromium}=await import(pathToFileURL(process.env.STANDALONE_PLAYWRIGHT_MODULE||'C:/Users/danij/AppData/Local/Temp/crimson-manager-browser/node_modules/playwright/index.mjs'));
const dir=await mkdtemp(path.join(os.tmpdir(),'crimson-popup-sizing-'));
const extension=path.join(dir,'extension');
await copyNativeExtension(extension);
const context=await chromium.launchPersistentContext(path.join(dir,'profile'),{
  executablePath:process.env.STANDALONE_BROWSER_EXE||'C:/Users/danij/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',
  headless:true,viewport:null,args:['--disable-extensions-except='+extension,'--load-extension='+extension]
});
const result={fixture:dir,checks:[],boundary:'Actual chrome.action.openPopup, native auto sizing, CDP target attachment; headless Chromium, no manual toolbar click.'};
try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const cdp=await context.browser().newBrowserCDPSession();
  let sequence=0;
  async function attach(targetId){
    const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:false});
    return async(method,params={})=>{
      const id=++sequence;
      return new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>{cdp.off('Target.receivedMessageFromTarget',receive);reject(Error('CDP timeout: '+method));},10000);
        function receive(event){
          if(event.sessionId!==sessionId)return;
          const message=JSON.parse(event.message);if(message.id!==id)return;
          clearTimeout(timeout);cdp.off('Target.receivedMessageFromTarget',receive);
          if(message.error)reject(Error(message.error.message));else resolve(message.result);
        }
        cdp.on('Target.receivedMessageFromTarget',receive);
        cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(reject);
      });
    };
  }
  for(const locale of ['ko','ar']){
    await worker.evaluate(locale=>chrome.storage.local.set({appLocale:locale}),locale);
    await worker.evaluate(()=>chrome.action.openPopup());
    let target;
    for(let i=0;i<100&&!target;i++){
      target=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.url.endsWith('/popup.html'));
      if(!target)await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.ok(target,'action popup must create a real extension target');
    const send=await attach(target.targetId);
    async function evaluate(expression){
      const response=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
      assert.equal(response.exceptionDetails,undefined,JSON.stringify(response.exceptionDetails));
      return response.result.value;
    }
    for(let i=0;i<100;i++){
      if(await evaluate(`document.readyState==='complete'&&document.documentElement.lang==='${locale}'`))break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    // Let the action host complete its asynchronous preferred-size updates.
    await new Promise(resolve=>setTimeout(resolve,300));
    assert.equal(await evaluate(`document.querySelector('#include-review,[data-i18n=include_drafts_in_review]')===null`),true);
    const layout=await evaluate(`({viewport:innerWidth,body:document.body.getBoundingClientRect().width,scroll:document.documentElement.scrollWidth,dir:document.documentElement.dir})`);
    console.log(locale,JSON.stringify(layout));result.checks.push({locale,layout});
    const shot=await send('Page.captureScreenshot');
    await writeFile(path.join(dir,locale+'-popup.png'),Buffer.from(shot.data,'base64'));
    assert.equal(layout.body,400,locale+' action popup must retain its intended 400px width without a caller preset');
    // Chromium's native host may retain a small preferred-size gutter.
    assert.ok(layout.viewport>=400&&layout.viewport<=450,locale+' native popup viewport must fit the normal content width');
    assert.ok(layout.scroll<=layout.viewport,locale+' popup must not overflow horizontally');
    if(locale==='ar')assert.equal(layout.dir,'rtl');
    await evaluate(`document.querySelector('#sites-list summary').click()`);
    for(let i=0;i<100;i++){
      if(await evaluate(`!!document.querySelector('.site-settings-button')`))break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    async function click(selector){
      const point=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
    }
    const headerButtons=await evaluate(`['options','settings-open','language-open'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {width:r.width,height:r.height,top:r.top};})`);
    assert.ok(headerButtons.every(r=>r.width===headerButtons[0].width&&r.height===headerButtons[0].height&&Math.abs(r.top-headerButtons[0].top)<1),'header icon buttons align and share size');
    assert.equal(await evaluate(`document.querySelector('#language-menu').hidden`),true);
    await click('#language-open');
    assert.equal(await evaluate(`document.querySelector('#language-menu').hidden`),false);
    const languageShot=await send('Page.captureScreenshot');
    await writeFile(path.join(dir,locale+'-language-menu.png'),Buffer.from(languageShot.data,'base64'));
    await send('Input.dispatchKeyEvent',{type:'keyDown',code:'Escape',key:'Escape'});
    await send('Input.dispatchKeyEvent',{type:'keyUp',code:'Escape',key:'Escape'});
    assert.equal(await evaluate(`document.querySelector('#language-menu').hidden`),true);
    await click('.site-settings-button');
    const settings=await evaluate(`(()=>{const d=document.querySelector('.site-settings'),r=d.getBoundingClientRect();return {open:d.open,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:d.scrollWidth>d.clientWidth};})()`);
    assert.equal(settings.open,true,locale+' gear must open settings through native mouse input');
    assert.ok(settings.left>=0&&settings.right<=settings.width&&settings.top>=0&&settings.bottom<=settings.height,locale+' settings must fit inside the actual popup');
    assert.equal(settings.overflow,false,locale+' settings must not overflow horizontally');
    const original=await evaluate(`document.querySelector('.site-settings [name=caseSensitive]').checked`);
    await click('.site-settings [name=caseSensitive]');
    assert.equal(await evaluate(`document.querySelector('.site-settings [name=caseSensitive]').checked`),!original);
    const settingsShot=await send('Page.captureScreenshot');
    await writeFile(path.join(dir,locale+'-settings.png'),Buffer.from(settingsShot.data,'base64'));
    await click('.settings-cancel');
    assert.equal(await evaluate(`document.querySelector('.site-settings').open`),false);
    await click('.site-settings-button');
    assert.equal(await evaluate(`document.querySelector('.site-settings [name=caseSensitive]').checked`),original,locale+' cancel must discard the draft');
    await click('.settings-save');
    for(let i=0;i<100;i++){
      if(await evaluate(`!document.querySelector('.site-settings').open`))break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.equal(await evaluate(`document.querySelector('.site-settings').open`),false,locale+' save must complete');
    result.checks.push({locale,settings,cancelAndSave:true});
    await click('#settings-open');
    assert.equal(await evaluate(`document.querySelector('#main-view').hidden&&!document.querySelector('#interaction-view').hidden`),true,'gear opens settings inside same popup');
    assert.equal(await evaluate(`document.querySelector('#options').href.includes('manager.html')`),true,'table management remains a separate link');
    const interaction=await evaluate(`({width:document.body.getBoundingClientRect().width,scroll:document.documentElement.scrollWidth,viewport:innerWidth,dir:document.documentElement.dir,gear:!!document.querySelector('#settings-open svg'),table:!!document.querySelector('#options svg')})`);
    assert.equal(interaction.width,400);assert.ok(interaction.scroll<=interaction.viewport);assert.ok(interaction.gear&&interaction.table);
    assert.equal(await evaluate(`document.querySelector('#shortcuts-save,#settings-state,#settings-leave')===null`),true,'instant settings have no save/state/leave controls');
    async function storedUntil(predicate){
      for(let i=0;i<100;i++){
        const value=await worker.evaluate(async()=> (await chrome.storage.local.get('interactionSettings')).interactionSettings);
        if(predicate(value))return value;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      throw Error('Automatic settings persistence timed out');
    }
    assert.equal(await evaluate(`document.querySelector('#fitting-form,#fit-enabled')===null`),true,'fitting UI is removed');
    async function key(type,code,value,modifiers=0){await send('Input.dispatchKeyEvent',{type,code,key:value,modifiers});}
    const oldLabel=await evaluate(`document.querySelector('#peek-key').textContent`);
    await click('#peek-key');await key('keyDown','Escape','Escape');await key('keyUp','Escape','Escape');
    assert.equal(await evaluate(`document.querySelector('#peek-key').textContent`),oldLabel,'Escape cancels recorder');
    await click('#peek-key');await key('keyDown','KeyQ','q');await key('keyUp','KeyQ','q');
    assert.match(await evaluate(`document.querySelector('#peek-key').textContent`),/Q/);
    await click('#peek-key');await key('keyDown','ControlLeft','Control',2);await key('keyDown','KeyQ','q',2);await key('keyUp','KeyQ','q',2);await key('keyUp','ControlLeft','Control');
    assert.match(await evaluate(`document.querySelector('#peek-key').textContent`),/Ctrl.*Q/);
    await click('#edit-key');await key('keyDown','F2','F2');await key('keyUp','F2','F2');
    assert.match(await evaluate(`document.querySelector('#edit-key').textContent`),/F2/);
    const previousMode=await worker.evaluate(async()=> (await chrome.storage.local.get('interactionSettings')).interactionSettings?.peekMode || 'hold');
    const desiredMode=previousMode==='hold'?'toggle':'hold';
    await click(`#peek-mode [data-mode=${desiredMode}]`);
    const desiredEditMode=desiredMode==='hold'?'toggle':'hold';
    await click(`#edit-mode [data-mode=${desiredEditMode}]`);
    const saved=await storedUntil(value=>value?.peekMode===desiredMode&&value?.editMode===desiredEditMode&&value?.peekKey?.code==='KeyQ'&&value?.peekKey?.ctrl&&value?.editKey?.code==='F2');
    assert.equal(saved.peekMode,desiredMode);assert.equal(saved.peekKey.code,'KeyQ');assert.equal(saved.peekKey.ctrl,true);assert.equal(saved.editKey.code,'F2');
    assert.equal(saved.editMode,desiredEditMode,'editing mode persists independently from peek mode');
    await evaluate(`document.querySelector('#interaction-back').scrollIntoView()`);
    const interactionShot=await send('Page.captureScreenshot');await writeFile(path.join(dir,locale+'-interaction-settings.png'),Buffer.from(interactionShot.data,'base64'));
    await click('#interaction-back');assert.equal(await evaluate(`document.querySelector('#interaction-view').hidden&&!document.querySelector('#main-view').hidden`),true);
    await click('#settings-open');await click('#peek-enabled');
    assert.equal(await evaluate(`document.querySelector('#peek-key').disabled`),true,'disabled feature cannot record shortcuts');
    assert.match(await evaluate(`document.querySelector('#peek-key').textContent`),/Ctrl.*Q/,'disabled feature retains displayed key');
    const disabledShot=await send('Page.captureScreenshot');await writeFile(path.join(dir,locale+'-disabled-shortcut.png'),Buffer.from(disabledShot.data,'base64'));
    await click('#interaction-back');
    assert.equal(await evaluate(`document.querySelector('#interaction-view').hidden`),true,'Back exits directly while auto save completes');
    const disabled=await storedUntil(value=>value?.peekEnabled===false);
    assert.equal(disabled.peekEnabled,false);assert.equal(disabled.peekKey.code,'KeyQ');
    await click('#settings-open');
    await click('#peek-enabled');assert.equal(await evaluate(`document.querySelector('#peek-key').disabled`),false);
    assert.equal((await storedUntil(value=>value?.peekEnabled===true)).peekEnabled,true);
    result.checks.push({locale,interaction,automaticPersistence:true});
    await cdp.send('Target.closeTarget',{targetId:target.targetId});
    await context.pages()[0].bringToFront();
    await new Promise(resolve=>setTimeout(resolve,300));
  }
}catch(error){result.error=error.stack;throw error;}
finally{await writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log('Evidence:',dir);await context.close();}
