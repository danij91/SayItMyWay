import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('native trusted peek and inline link editing retain drafts and never navigate', {skip:!process.env.TEXT_PATCH_CHROME,timeout:40000},async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'crimson-page-tools-'));
  const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><body><a id="link" href="/away">Source</a><p id="normal">Source</p><input id="input" value="Private"><div contenteditable id="editable">Draft</div></body>');});
  let child,ws;
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const url='http://127.0.0.1:'+server.address().port+'/page';
    child=spawn(process.env.TEXT_PATCH_CHROME,['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+directory,'about:blank'],{windowsHide:true,stdio:'ignore'});
    let port;
    for(let n=0;n<100;n++){try{port=Number((await readFile(path.join(directory,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await new Promise(r=>setTimeout(r,50));}}
    assert.ok(port,'isolated Chromium starts');
    const version=await(await fetch('http://127.0.0.1:'+port+'/json/version')).json();
    console.log('native page-tools browser:',version.Browser);
    ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    let seq=0;const pending=new Map();
    ws.onmessage=event=>{const result=JSON.parse(event.data),p=pending.get(result.id);if(p){pending.delete(result.id);result.error?p.reject(Error(result.error.message)):p.resolve(result.result);}};
    const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));});
    const {targetId}=await send('Target.createTarget',{url});const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    const command=(method,params)=>send(method,params,sessionId);
    const evaluate=async expression=>{const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));return result.result.value;};
    for(let n=0;n<100;n++){if(await evaluate('document.readyState==="complete" && !!document.querySelector("#link")'))break;await new Promise(r=>setTimeout(r,20));}
    await evaluate(await readFile(process.env.TEXT_PATCH_INTERACTION_SOURCE || new URL('../extension/interaction-settings.js',import.meta.url),'utf8'));
    for(const file of ['shared.js','engine.js','page-tools.js'])await evaluate(await readFile(new URL('../extension/'+file,import.meta.url),'utf8'));
    await evaluate(`globalThis.state={enabled:true,rule:{fitText:{enabled:false,fontScale:1,lineHeight:0}},table:{id:'a',schemaVersion:1,revision:1,entries:[{id:'source',en:'Source',ko:'Rendered',kind:'general',category:'test',context:'global',selector:'',status:'review',source:'fixture',evidence:'',notes:''}]}};
      globalThis.messages=[];globalThis.conflict=true;globalThis.listener=null;globalThis.changed=null;
      // Until ticket C lands, the native B fixture supplies only its documented inspection boundary.
      if(!CrimsonTranslator.prototype.inspectText)CrimsonTranslator.prototype.inspectText=function(node){return node?.isConnected&&node.nodeType===3&&['Source','Rendered','Saved draft'].includes(node.data)&&!node.parentElement.closest('input,textarea,[contenteditable],[data-crimson-ignore]')?{original:'Source',replacement:node.data}:null;};
      globalThis.chrome={runtime:{id:'fixture',getManifest:()=>({version:'fixture'}),onMessage:{addListener:fn=>listener=fn},sendMessage:async message=>{
        messages.push(message);
        if(message.type==='pageState')return structuredClone(state);
        if(message.type==='inlineContext')return {table:{id:'a',name:'Fixture table'},tableId:'a',entry:{id:'source',original:'Source',replacement:state.table.entries[0].ko},token:state.table.revision};
        if(message.type==='inlineSave'){if(conflict)return {error:'다른 창에서 변경되었습니다'};state.table.entries[0].ko=message.replacement;state.table.revision++;return {saved:true};}
      }},storage:{onChanged:{addListener:fn=>changed=fn}}};`);
    await evaluate(await readFile(new URL('../extension/content.js',import.meta.url),'utf8'));
    assert.equal(await evaluate('normal.textContent'),'Rendered');
    const key=(type,code,key,modifiers=0)=>command('Input.dispatchKeyEvent',{type,code,key,modifiers,windowsVirtualKeyCode:({Shift:16,Alt:18,Escape:27,Control:17,q:81,F2:113})[key]||0});
    await key('keyDown','ShiftLeft','Shift',8);assert.equal(await evaluate('normal.textContent'),'Source');
    await evaluate(`var dynamic=document.createElement('p');dynamic.id='dynamic';dynamic.textContent='Source';document.body.append(dynamic)`);
    await key('keyUp','ShiftLeft','Shift');assert.deepEqual(await evaluate('[normal.textContent,dynamic.textContent,state.enabled]'),['Rendered','Rendered',true]);
    await evaluate('input.focus()');await key('keyDown','ShiftLeft','Shift',8);assert.equal(await evaluate('normal.textContent'),'Rendered');await key('keyUp','ShiftLeft','Shift');
    await evaluate(`input.blur();state.interactionSettings={peekMode:'hold',peekKey:{code:'KeyQ',ctrl:true,alt:false,shift:false,meta:false},editKey:{code:'F2',ctrl:false,alt:false,shift:false,meta:false}};listener({type:'applyState',state:structuredClone(state)},{id:'fixture'},()=>{})`);
    await key('keyDown','ControlLeft','Control',2);await key('keyDown','KeyQ','q',2);
    assert.equal(await evaluate('normal.textContent'),'Source');
    await key('keyUp','ControlLeft','Control');assert.equal(await evaluate('normal.textContent'),'Rendered');
    await key('keyUp','KeyQ','q');
    await evaluate(`state.interactionSettings={peekMode:'toggle',peekKey:{code:'KeyQ',ctrl:false,alt:false,shift:false,meta:false},editKey:{code:'F2',ctrl:false,alt:false,shift:false,meta:false}};listener({type:'applyState',state:structuredClone(state)},{id:'fixture'},()=>{})`);
    await key('keyDown','KeyQ','q');await key('keyUp','KeyQ','q');assert.equal(await evaluate('normal.textContent'),'Source');await key('keyDown','Escape','Escape');assert.equal(await evaluate('normal.textContent'),'Rendered');
    const click=async expression=>{
      const p=await evaluate(`(()=>{const r=(${expression}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await command('Input.dispatchMouseEvent',{type:'mouseMoved',...p});
      await command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});
      await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});
    };
    await key('keyDown','F2','F2');await click('link');await key('keyUp','F2','F2');
    assert.equal(await evaluate('location.href'),url);
    assert.equal(await evaluate('!!document.querySelector("#textpatch-inline-editor")'),true);
    assert.deepEqual(await evaluate(`(()=>{const s=document.querySelector('#textpatch-inline-editor').shadowRoot;return [s.querySelector('[data-table-name]').textContent,!!s.querySelector('select')]})()`),['Fixture table',false]);
    const shadow='document.querySelector("#textpatch-inline-editor").shadowRoot';
    assert.equal(await evaluate(`${shadow}.querySelector('[name="reload"]').hidden`),true);
    await evaluate(`${shadow}.querySelector('[name="replacement"]').select()`);await command('Input.insertText',{text:'Saved draft'});
    await click(`${shadow}.querySelector('button[type="submit"]')`);
    assert.deepEqual(await evaluate(`[${shadow}.querySelector('[name="replacement"]').value,${shadow}.querySelector('[role="status"]').textContent]`),['Saved draft','다른 창에서 변경되었습니다']);
    assert.equal(await evaluate(`${shadow}.querySelector('[name="reload"]').hidden`),false);
    await evaluate(`state.interactionUI={locale:'ar',dir:'rtl',strings:{inline_save:'حفظ'}};listener({type:'applyState',state:structuredClone(state)}, {id:'fixture'},()=>{})`);
    assert.equal(await evaluate(`${shadow}.querySelector('button[type="submit"]').textContent`),'\u062d\u0641\u0638');
    assert.equal(await evaluate(`${shadow}.querySelector('[name="replacement"]').value`),'Saved draft');
    await evaluate('conflict=false');await click(`${shadow}.querySelector('[name="reload"]')`);await click(`${shadow}.querySelector('button[type="submit"]')`);
    assert.deepEqual(await evaluate('[normal.textContent,link.textContent,dynamic.textContent,state.enabled]'),['Saved draft','Saved draft','Saved draft',true],JSON.stringify(await evaluate('messages')));
    assert.equal(await evaluate('!!document.querySelector("#textpatch-inline-editor")'),false);
    await key('keyDown','Escape','Escape');assert.equal(await evaluate('!!document.querySelector("#textpatch-inline-editor")'),false);
    assert.equal(await evaluate('location.href'),url);
    assert.equal(await evaluate('messages.some(m=>!["pageState","inlineContext","inlineSave"].includes(m.type))'),false);
    console.log('verified trusted hold/toggle/Escape, dynamic text, input guard, real caret link hit, no navigation, trusted draft typing, localized conflict, reload/save, locale sync');
  }finally{
    ws?.close();if(child&&child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}
    await new Promise(resolve=>server.close(resolve));
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));
    await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});

