import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('native Chromium preserves page styles with legacy fitting enabled and inspects owned originals', {skip:!process.env.TEXT_PATCH_CHROME,timeout:30000},async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'crimson-layout-'));let child,ws;
  try{
    child=spawn(process.env.TEXT_PATCH_CHROME,['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+dir,'about:blank'],{windowsHide:true,stdio:'ignore'});
    let port;
    for(let i=0;i<100;i++){
      try{port=Number((await readFile(path.join(dir,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}
      catch{await new Promise(r=>setTimeout(r,50));}
    }
    assert.ok(port,'isolated Chromium starts');
    const version=await(await fetch('http://127.0.0.1:'+port+'/json/version')).json();
    console.log('native browser:',version.Browser);
    ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
    let seq=0;const pending=new Map();
    ws.onmessage=event=>{const message=JSON.parse(event.data),p=pending.get(message.id);if(p){pending.delete(message.id);message.error?p.reject(Error(message.error.message)):p.resolve(message.result);}};
    const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));});
    const {targetId}=await send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    const command=(method,params)=>send(method,params,sessionId);
    const evaluate=async expression=>{
      const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
      assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));return result.result.value;
    };
    await evaluate(`document.body.innerHTML='<style>.fit{display:inline-block;overflow:hidden;white-space:nowrap;font:28px Arial;margin:12px}.horizontal{width:180px;height:40px}.vertical{width:200px;height:24px;line-height:18px}</style><div id="horizontal" class="fit horizontal">Chest</div><div id="vertical" class="fit vertical">Long English label</div><div id="editor" class="fit horizontal">Chest</div><div id="mixed" class="fit horizontal">Chest<svg width="10" height="10"></svg></div><div id="icon" class="fit horizontal" style="font-family:Material Icons">Chest</div><div id="pseudo" class="fit horizontal">Chest</div><style>#pseudo::before{content:"★"}</style>';`);
    for(const file of ['shared.js','engine.js'])await evaluate(await readFile(new URL('../extension/'+file,import.meta.url),'utf8'));
    await evaluate(`globalThis.data={schemaVersion:1,revision:1,entries:[['Chest','A much longer label'],['Long English label','함']].map(([en,ko],i)=>({id:String(i),en,ko,kind:'general',category:'test',context:'global',selector:'',status:'review',source:'fixture',evidence:'',notes:''}))};globalThis.translator=new CrimsonTranslator(document);translator.setData(data);globalThis.measure=id=>{const e=document.getElementById(id),r=document.createRange();r.selectNodeContents(e.firstChild);const t=r.getBoundingClientRect(),b=e.getBoundingClientRect();return {font:getComputedStyle(e).fontSize,line:getComputedStyle(e).lineHeight,width:t.width,height:t.height,left:t.left-b.left,top:t.top-b.top,right:t.right-b.left,bottom:t.bottom-b.top,boxWidth:e.clientWidth,boxHeight:e.clientHeight,style:e.getAttribute('style')}}`);

    await evaluate(`translator.setData({...data,defaults:{fitText:{enabled:true,fontScale:0.7,lineHeight:2}}},{siteOptions:{fitText:{enabled:true,fontScale:1.3,lineHeight:2}}});new Promise(r=>setTimeout(r,100))`);
    assert.equal(await evaluate('typeof translator.setLayoutOptions'),'undefined');
    assert.deepEqual(await evaluate('translator.inspectText(horizontal.firstChild)'),{original:'Chest',replacement:'A much longer label'});
    assert.equal(await evaluate('horizontal.textContent'),'A much longer label');
    assert.equal((await evaluate("measure('horizontal')")).font,'28px');
    assert.equal(await evaluate('horizontal.getAttribute("style")'),null);
    assert.equal(await evaluate('vertical.getAttribute("style")'),null);
    await evaluate(`globalThis.styleWrites=0;globalThis.styleObserver=new MutationObserver(ms=>styleWrites+=ms.filter(m=>m.attributeName==='style').length);styleObserver.observe(document.body,{subtree:true,attributes:true});horizontal.textContent='Chest';new Promise(r=>setTimeout(r,100))`);
    assert.equal(await evaluate('horizontal.textContent'),'A much longer label');
    assert.equal(await evaluate('styleWrites'),0);
    await evaluate(`editor.contentEditable='true';editor.focus()`);
    assert.equal(await evaluate('editor.textContent'),'Chest');
    assert.equal(await evaluate('translator.inspectText(editor.firstChild)'),null);
    await evaluate('translator.setEnabled(false)');
    assert.equal(await evaluate('horizontal.textContent'),'Chest');
    assert.equal(await evaluate('horizontal.getAttribute("style")'),null);
  }finally{
    ws?.close();
    if(child&&child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}
    // dir is created above under the OS temp directory, never a workspace/user profile.
    await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});






