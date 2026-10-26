import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('native Chromium protects editing transitions, actual typing and IME updates', {skip:!process.env.TEXT_PATCH_CHROME,timeout:30000},async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'crimson-input-'));let child,ws;
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
    await evaluate(`document.body.innerHTML='<p id="normal" title="Chest">Chest</p><div id="editor"><span>Chest</span></div><input id="input" value="Chest" placeholder="Chest"><textarea placeholder="Chest">Chest</textarea><select><option>Chest</option></select><div role="searchbox">Chest</div>'`);
    for(const file of ['shared.js','engine.js'])await evaluate(await readFile(new URL('../extension/'+file,import.meta.url),'utf8'));
    await evaluate(`globalThis.data={schemaVersion:1,revision:1,defaults:{translatePlaceholders:true},entries:[{id:'chest',en:'Chest',ko:'Box',kind:'general',category:'test',context:'global',selector:'',status:'verified',source:'test',evidence:'fixture',notes:''}]};globalThis.translator=new CrimsonTranslator(document);translator.setData(data)`);
    assert.deepEqual(await evaluate(`[normal.textContent,normal.title,input.value,input.placeholder,document.querySelector('textarea').value,document.querySelector('select').textContent,document.querySelector('[role]').textContent]`),['Box','Box','Chest','Chest','Chest','Chest','Chest']);
    // Native focusin restores newly editable content before a selection or typing.
    await evaluate(`editor.contentEditable='true';editor.focus();globalThis.events=[];for(const type of ['beforeinput','input','compositionstart','compositionupdate','compositionend'])editor.addEventListener(type,e=>events.push({type:e.type,trusted:e.isTrusted}));var range=document.createRange();range.selectNodeContents(editor);getSelection().removeAllRanges();getSelection().addRange(range)`);
    assert.equal(await evaluate('editor.textContent'),'Chest');
    await command('Input.insertText',{text:'My typed draft'});
    await evaluate('translator.setEnabled(false);translator.setEnabled(true);translator.setData({...data,revision:2})');
    assert.equal(await evaluate('editor.textContent'),'My typed draft');
    assert.ok((await evaluate('events')).some(e=>e.type==='input'&&e.trusted),'actual browser input occurred');
    await evaluate(`editor.focus();var range=document.createRange();range.selectNodeContents(editor);getSelection().removeAllRanges();getSelection().addRange(range)`);
    await command('Input.imeSetComposition',{text:'\ud55c',selectionStart:1,selectionEnd:1});
    await command('Input.insertText',{text:'\ud55c\uae00'});
    await evaluate('translator.setEnabled(false)');
    assert.equal(await evaluate('editor.textContent'),'\ud55c\uae00');
    assert.ok((await evaluate('events')).some(e=>e.type==='compositionstart'&&e.trusted),'native IME composition started');
    // designMode is a document property, so it has no attribute mutation event.
    // Exercise its synchronous editing-event guard as well as real browser typing.
    await evaluate(`editor.removeAttribute('contenteditable');editor.textContent='Chest';translator.setEnabled(true)`);
    await evaluate(`document.designMode='on';document.body.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,inputType:'insertText',data:'Draft'}))`);
    assert.equal(await evaluate('normal.textContent'),'Chest');
    assert.deepEqual(await evaluate('translator.collectCandidates()'),[]);
    await evaluate(`var range=document.createRange();range.selectNodeContents(editor);getSelection().removeAllRanges();getSelection().addRange(range)`);
    await command('Input.insertText',{text:'Design draft'});
    await evaluate('translator.setEnabled(false)');
    assert.equal(await evaluate('editor.textContent'),'Design draft');
    assert.equal(await evaluate('normal.textContent'),'Chest');
    console.log('verified native controls/placeholders, role exclusion, focus transition, trusted typing, trusted IME, designMode input and outside restore');
  }finally{
    ws?.close();
    if(child&&child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}
    // dir is created above under the OS temp directory, never a workspace/user profile.
    await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});

