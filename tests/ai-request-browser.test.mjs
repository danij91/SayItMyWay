import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createServer} from '../server.mjs';

// Opt in with an installed Chromium executable; never opens a user's browser profile.
test('Chromium permits extension editor iframe, denies HTTP ancestors, and runs shared dialog',{skip:!process.env.TEXT_PATCH_CHROME,timeout:30000},async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'ai-browser-'));let child,server,parent,ws;
  try{
    const dataPath=path.join(dir,'dictionary.json');await copyFile(new URL('../extension/data/dictionary.json',import.meta.url),dataPath);
    server=await createServer({dataPath});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
    const fixture=path.join(dir,'extension');await mkdir(fixture);
    const key=generateKeyPairSync('rsa',{modulusLength:1024}).publicKey.export({type:'spki',format:'der'});
    const id=[...createHash('sha256').update(key).digest().subarray(0,16)].map(b=>String.fromCharCode(97+(b>>4),97+(b&15))).join('');
    await writeFile(path.join(fixture,'manifest.json'),JSON.stringify({manifest_version:3,name:'AI frame test',version:'1.0',key:key.toString('base64'),host_permissions:['http://127.0.0.1/*']}));
    await writeFile(path.join(fixture,'index.html'),`<iframe src="${base}/?embedded=1"></iframe>`);
    child=spawn(process.env.TEXT_PATCH_CHROME,['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+path.join(dir,'profile'),'--disable-extensions-except='+fixture,'--load-extension='+fixture,'about:blank'],{windowsHide:true,stdio:'ignore'});
    let port;
    for(let i=0;i<100;i++){try{port=Number((await readFile(path.join(dir,'profile','DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await new Promise(r=>setTimeout(r,100));}}
    assert.ok(port,'Chromium debugger started');
    const version=await(await fetch('http://127.0.0.1:'+port+'/json/version')).json();ws=new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    let sequence=0;const pending=new Map(),contexts=[],logs=[];
    ws.onmessage=event=>{const data=JSON.parse(event.data),p=pending.get(data.id);if(data.method==='Runtime.executionContextCreated')contexts.push(data.params.context);if(data.method==='Log.entryAdded')logs.push(data.params.entry.text);if(p){pending.delete(data.id);data.error?p.reject(Error(data.error.message)):p.resolve(data.result);}};
    const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));});
    const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    let activeSession=sessionId;
    const command=(method,params)=>send(method,params,activeSession);
    await command('Page.enable');await command('Runtime.enable');
    await command('Page.navigate',{url:`chrome-extension://${id}/index.html`});
    let frame,iframeTarget;
    for(let i=0;i<100;i++){
      iframeTarget=(await send('Target.getTargets')).targetInfos.find(target=>target.type==='iframe' && target.parentId===targetId && target.url===base+'/?embedded=1');
      if(iframeTarget)break;await new Promise(r=>setTimeout(r,50));
    }
    assert.ok(iframeTarget,'extension iframe target loaded');
    activeSession=(await send('Target.attachToTarget',{targetId:iframeTarget.targetId,flatten:true})).sessionId;
    await command('Page.enable');await command('Runtime.enable');
    frame=(await command('Page.getFrameTree')).frameTree.frame;
    assert.equal(frame.url,base+'/?embedded=1','extension embeds editor under CSP');
    const {executionContextId}=await command('Page.createIsolatedWorld',{frameId:frame.id,worldName:'ai-test'});
    const result=await command('Runtime.evaluate',{contextId:executionContextId,awaitPromise:true,returnByValue:true,expression:`(async()=>{
      if(document.readyState==='loading')await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
      for(const file of ['ai-request.js','ai-request-ui.js']){const script=document.createElement('script');script.src='${base}/'+file;await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=reject;document.head.append(script);});}
      return document.querySelector('h1')?.textContent || document.title;
    })()`});
    assert.ok(result.result.value,'embedded editor DOM loads');assert.equal(result.exceptionDetails,undefined);
    // Use the frame main world for globals installed by its normal script tags.
    const main=contexts.findLast(context=>context.auxData?.frameId===frame.id && context.auxData.isDefault)?.id;
    assert.ok(main,'frame main world available');
    const dialog=await command('Runtime.evaluate',{contextId:main,awaitPromise:true,returnByValue:true,expression:`(async()=>{
      await TextPatchI18n.setLocale('ko');const dialog=await TextPatchAIUI.open({table:{schemaVersion:1,name:'<img src=x>',entries:[{id:'r',en:'Hello',ko:'',status:'untranslated'}]}});
      dialog.querySelector('[data-ai=targetLanguage]').value='Français';await dialog.querySelector('[data-ai=copy]').onclick();
      return {open:dialog.open,status:dialog.querySelector('[data-ai=status]').textContent,exposed:!!dialog.querySelector('[data-ai=output]'),injected:!!dialog.querySelector('img')};
    })()`});
    assert.equal(dialog.exceptionDetails,undefined);assert.equal(dialog.result.value.open,true);assert.equal(dialog.result.value.injected,false);assert.equal(dialog.result.value.exposed,false);assert.match(dialog.result.value.status,/복사|파일 받기/);
    parent=http.createServer((req,res)=>res.end(`<iframe src="${base}/?embedded=1"></iframe>`));await new Promise(r=>parent.listen(0,'127.0.0.1',r));
    activeSession=sessionId;
    await command('Log.enable');
    await command('Page.navigate',{url:'http://127.0.0.1:'+parent.address().port});
    let blocked=false;
    for(let i=0;i<100;i++){if(logs.some(text=>text.includes('frame-ancestors') && text.includes('chrome-extension:'))){blocked=true;break;}await new Promise(r=>setTimeout(r,50));}
    assert.equal(blocked,true,'HTTP ancestor cannot embed privileged editor route: '+JSON.stringify(logs));
  }finally{
    ws?.close();if(child && child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}
    if(server?.listening)await new Promise(r=>server.close(r));if(parent?.listening)await new Promise(r=>parent.close(r));
    await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});
