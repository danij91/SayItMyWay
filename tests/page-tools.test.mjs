import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function fixture(){
  const dom=new JSDOM('<body><button id="focus">Focus</button><a href="/away"><span>Source</span></a><input><div contenteditable>Draft</div></body>',{url:'https://example.com/page',runScripts:'outside-only'});
  const {window:w}=dom, peeks=[],messages=[];
  await tick();
  w.eval(await readFile(process.env.TEXT_PATCH_INTERACTION_SOURCE || new URL('../extension/interaction-settings.js',import.meta.url),'utf8'));
  w.eval(await readFile(new URL('../extension/page-tools.js',import.meta.url),'utf8'));
  const translator={inspectText:node=>node?.isConnected&&node.nodeType===3?{original:'Source',replacement:'Rendered'}:null};
  let respond=async message=>message.type==='inlineSave'?{saved:true}:{table:{id:'a',name:'<One>'},tableId:'a',entry:{id:'row',original:'Source',replacement:'Rendered'},token:'snapshot'};
  const tools=new w.TextPatchPageTools({document:w.document,translator,onPeekChange:value=>peeks.push(value),sendMessage:message=>{messages.push(message);return respond(message);}});
  tools.configure({enabled:true,table:{id:'a'}});
  const key=(type,code,options={})=>tools.handleEvent({type,code,isTrusted:true,target:w.document.body,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){},...options});
  return {dom,w,tools,key,peeks,messages,respond:fn=>respond=fn};
}

test('hold peek restores on key release and blur without persisting preferences',async()=>{
  const f=await fixture();try{
    f.key('keydown','ShiftLeft');assert.equal(f.tools.peeking,true);
    f.key('keyup','ShiftLeft',{target:f.w.document.querySelector('input')});assert.equal(f.tools.peeking,false);
    f.key('keydown','ShiftLeft');f.w.dispatchEvent(new f.w.Event('blur'));
    assert.equal(f.tools.peeking,false);assert.deepEqual(f.peeks,[true,false,true,false]);assert.deepEqual(f.messages,[]);
  }finally{f.dom.window.close();}
});

test('toggle peek ends on Escape/settings/navigation and ignores input, IME and synthetic shortcuts',async()=>{
  const f=await fixture();try{
    f.tools.configure({enabled:true,table:{id:'a'},interactionSettings:{peekMode:'toggle'}});
    f.key('keydown','ShiftLeft');f.key('keyup','ShiftLeft');assert.equal(f.tools.peeking,true);
    f.key('keydown','Escape');assert.equal(f.tools.peeking,false);
    for(const options of [{target:f.w.document.querySelector('input')},{target:f.w.document.querySelector('[contenteditable]')},{isComposing:true},{repeat:true},{isTrusted:false},{ctrlKey:true,altKey:true},{getModifierState:()=>true}]){
      f.key('keydown','ShiftLeft',options);assert.equal(f.tools.peeking,false);
    }
    f.key('keydown','ShiftLeft');f.tools.configure({enabled:true,table:{id:'a'},interactionSettings:{peekMode:'toggle',peekKey:'ControlLeft'}});assert.equal(f.tools.peeking,false);
    f.key('keydown','ControlLeft');f.w.dispatchEvent(new f.w.Event('popstate'));assert.equal(f.tools.peeking,false);
  }finally{f.dom.window.close();}
});

function point(f){
  const node=f.w.document.querySelector('a span').firstChild;
  f.w.document.caretRangeFromPoint=()=>({startContainer:node});
  f.w.Range.prototype.getClientRects=()=>[{left:10,top:10,right:100,bottom:30,width:90,height:20}];
  return (type,options={})=>{
    const event={type,isTrusted:true,button:0,target:node.parentElement,clientX:20,clientY:20,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},...options};
    f.tools.handleEvent(event);return event;
  };
}
test('editor only intercepts actual text, shows linked table at top and retains conflict draft',async()=>{
  const f=await fixture();try{
    const mouse=point(f);f.w.document.querySelector('#focus').focus();
    f.key('keydown','AltLeft');assert.equal(mouse('click',{clientX:500}).defaultPrevented,undefined);
    assert.equal(mouse('pointerdown').defaultPrevented,true);
    f.key('keyup','AltLeft');assert.equal(mouse('click').defaultPrevented,true);
    await tick();
    const shadow=f.w.document.querySelector('[data-crimson-ignore]').shadowRoot;
    const replacement=shadow.querySelector('[name="replacement"]'),table=shadow.querySelector('[data-table-name]');
    assert.equal(replacement.value,'Rendered');assert.equal(table.textContent,'<One>');
    assert.equal(table.dir,'auto');assert.equal(shadow.querySelector('select'),null);
    assert.ok(table.compareDocumentPosition(shadow.querySelector('h2')) & f.w.Node.DOCUMENT_POSITION_FOLLOWING);
    replacement.value='My unsaved draft';
    f.respond(async message=>message.type==='inlineSave'?{error:'conflict'}:{table:{id:'a',name:'<One>'},tableId:'a',entry:null,token:'new'});
    shadow.querySelector('form').dispatchEvent(new f.w.Event('submit',{cancelable:true}));await tick();
    assert.equal(replacement.value,'My unsaved draft');assert.match(shadow.querySelector('[role="status"]').textContent,/changed|conflict/i);
    assert.equal(f.messages.at(-1).original,'Source');assert.equal(f.messages.at(-1).token,'snapshot');
    shadow.querySelector('[name="reload"]').click();await tick();
    assert.equal(replacement.value,'My unsaved draft');
    shadow.querySelector('form').dispatchEvent(new f.w.Event('submit',{cancelable:true}));await tick();
    assert.equal(f.messages.at(-1).token,'new');
    f.key('keydown','Escape');assert.equal(f.w.document.querySelector('[data-crimson-ignore]'),null);
    assert.equal(f.w.document.activeElement.id,'focus');
  }finally{f.dom.window.close();}
});

test('editor retains draft across locale/settings sync and ignores late context after close',async()=>{
  const f=await fixture();try{
    const mouse=point(f);f.key('keydown','AltLeft');mouse('click');await tick();
    const host=f.w.document.querySelector('#textpatch-inline-editor'),shadow=host.shadowRoot;
    shadow.querySelector('[name="replacement"]').value='Keep <script>draft</script>';
    f.tools.configure({enabled:true,table:{id:'a'},interactionUI:{locale:'ar',dir:'rtl',strings:{inline_save:'حفظ'}}});
    assert.equal(shadow.querySelector('button[type="submit"]').textContent,'حفظ');
    assert.equal(shadow.querySelector('[role="dialog"]').dir,'rtl');
    assert.equal(shadow.querySelector('[name="replacement"]').value,'Keep <script>draft</script>');
    let resolve;f.respond(()=>new Promise(r=>resolve=r));shadow.querySelector('[name="reload"]').click();
    f.key('keydown','Escape');resolve({table:{id:'a',name:'One'},tableId:'a',entry:{replacement:'Late'},token:'late'});await tick();
    assert.equal(f.w.document.querySelector('#textpatch-inline-editor'),null);
  }finally{f.dom.window.close();}
});

test('missing permission, disabled keys, designMode and hidden document release transient modes',async()=>{
  const f=await fixture();try{
    f.tools.configure({enabled:true,table:{id:'a'},missingPermission:true});f.key('keydown','ShiftLeft');assert.equal(f.tools.peeking,false);
    f.tools.configure({enabled:true,table:{id:'a'},interactionSettings:{peekKey:'',editKey:''}});f.key('keydown','ShiftLeft');f.key('keydown','AltLeft');assert.equal(f.tools.peeking,false);assert.equal(f.tools.editHeld,false);
    f.tools.configure({enabled:true,table:{id:'a'}});f.w.document.designMode='on';f.key('keydown','ShiftLeft');assert.equal(f.tools.peeking,false);
    f.w.document.designMode='off';f.key('keydown','ShiftLeft');assert.equal(f.tools.peeking,true);
    f.w.document.dispatchEvent(new f.w.Event('visibilitychange'));assert.equal(f.tools.peeking,false);
    f.key('keydown','ShiftLeft');f.tools.handleEvent({type:'compositionstart'});assert.equal(f.tools.peeking,false);
    f.tools.destroy();f.key('keydown','ShiftLeft',{isTrusted:false});assert.equal(f.tools.peeking,false);
  }finally{f.dom.window.close();}
});

test('Escape used during IME composition does not close the editor or consume the key',async()=>{
  const f=await fixture();try{
    const mouse=point(f);f.key('keydown','AltLeft');mouse('click');await tick();
    f.tools.handleEvent({type:'compositionstart'});
    let prevented=false;f.key('keydown','Escape',{isComposing:true,preventDefault:()=>prevented=true});
    assert.ok(f.w.document.querySelector('#textpatch-inline-editor'));assert.equal(prevented,false);
    f.tools.handleEvent({type:'compositionend'});f.key('keydown','Escape');
    assert.equal(f.w.document.querySelector('#textpatch-inline-editor'),null);
  }finally{f.dom.window.close();}
});

const binding=(code,flags={})=>({code,ctrl:false,alt:false,shift:false,meta:false,...flags});
test('toggle edit selection survives keyup and cancels independently of toggle peek',async()=>{
  const f=await fixture();try{
    f.tools.configure({enabled:true,table:{id:'a'},interactionSettings:{peekMode:'toggle',editMode:'toggle'}});
    const mouse=point(f);
    f.key('keydown','ShiftLeft');f.key('keyup','ShiftLeft');
    f.key('keydown','AltLeft');f.key('keyup','AltLeft');mouse('pointermove');
    assert.equal(f.tools.editHeld,true);assert.ok(f.tools.highlight);assert.equal(f.tools.peeking,true);
    mouse('pointerdown');f.key('keydown','AltLeft');
    assert.equal(f.tools.editHeld,false);assert.equal(f.tools.highlight,null);assert.equal(f.tools.armed,null);
    assert.equal(f.tools.peeking,true);assert.equal(mouse('click').defaultPrevented,undefined);assert.equal(f.tools.editor,undefined);
    f.key('keydown','AltLeft');f.key('keydown','Escape');assert.equal(f.tools.editHeld,false);assert.equal(f.tools.peeking,false);
    f.key('keydown','AltLeft');f.w.dispatchEvent(new f.w.Event('blur'));assert.equal(f.tools.editHeld,false);
    f.key('keydown','AltLeft');f.key('keyup','AltLeft');mouse('click');
    assert.ok(f.tools.editor);assert.equal(f.tools.editHeld,false);assert.equal(f.tools.highlight,null);assert.equal(f.tools.armed,null);
    await tick();
  }finally{f.dom.window.close();}
});

test('legacy and explicit hold edit selection release on shortcut keyup',async()=>{
  const f=await fixture();try{
    for(const interactionSettings of [{},{editMode:'hold'}]){
      f.tools.configure({enabled:true,table:{id:'a'},interactionSettings});
      const mouse=point(f);f.key('keydown','AltLeft');mouse('pointermove');
      assert.equal(f.tools.editHeld,true);assert.ok(f.tools.highlight);
      f.key('keyup','AltLeft');assert.equal(f.tools.editHeld,false);assert.equal(f.tools.highlight,null);
      assert.equal(mouse('click').defaultPrevented,undefined);
    }
  }finally{f.dom.window.close();}
});

test('toggle edit preserves input and IME guards and releases on settings or protected focus',async()=>{
  const f=await fixture();try{
    const configure=editMode=>f.tools.configure({enabled:true,table:{id:'a'},interactionSettings:{editMode}});
    configure('toggle');
    for(const options of [{target:f.w.document.querySelector('input')},{target:f.w.document.querySelector('[contenteditable]')},{isComposing:true},{isTrusted:false},{ctrlKey:true,altKey:true},{getModifierState:()=>true}]){
      f.key('keydown','AltLeft',options);assert.equal(f.tools.editHeld,false);
    }
    f.key('keydown','AltLeft');f.tools.handleEvent({type:'compositionstart'});assert.equal(f.tools.editHeld,false);
    f.tools.handleEvent({type:'compositionend'});f.key('keydown','AltLeft');configure('hold');assert.equal(f.tools.editHeld,false);
    configure('toggle');f.key('keydown','AltLeft');f.w.document.querySelector('input').focus();assert.equal(f.tools.editHeld,false);
    f.key('keydown','AltLeft');assert.equal(f.tools.editHeld,true);
    f.tools.handleEvent({type:'visibilitychange'});assert.equal(f.tools.editHeld,false);
  }finally{f.dom.window.close();}
});

test('physical keys and exact chords support hold, toggle and required-modifier release',async()=>{
  const f=await fixture();try{
    const settings={peekMode:'hold',peekKey:binding('KeyQ',{ctrl:true}),editKey:binding('F2',{shift:true})};
    f.tools.configure({enabled:true,table:{id:'a'},interactionSettings:settings});
    f.key('keydown','KeyQ');assert.equal(f.tools.peeking,false);
    f.key('keydown','KeyQ',{ctrlKey:true,shiftKey:true});assert.equal(f.tools.peeking,false);
    f.key('keydown','KeyQ',{ctrlKey:true});assert.equal(f.tools.peeking,true);
    f.key('keyup','ControlLeft',{target:f.w.document.querySelector('input')});assert.equal(f.tools.peeking,false);
    f.key('keydown','F2',{shiftKey:true});assert.equal(f.tools.editHeld,true);
    f.key('keyup','ShiftRight');assert.equal(f.tools.editHeld,false);
    settings.peekMode='toggle';settings.peekKey=binding('KeyQ');
    f.tools.configure({enabled:true,table:{id:'a'},interactionSettings:settings});
    f.key('keydown','KeyQ');f.key('keyup','KeyQ');assert.equal(f.tools.peeking,true);
    f.key('keydown','KeyQ',{repeat:true});assert.equal(f.tools.peeking,true);
    f.key('keydown','KeyQ');assert.equal(f.tools.peeking,false);
    settings.peekKey=binding('Escape');f.tools.configure({enabled:true,table:{id:'a'},interactionSettings:settings});
    f.key('keydown','ShiftLeft');assert.equal(f.tools.peeking,false);
  }finally{f.dom.window.close();}
});

test('successful save closes immediately, restores focus and never reloads context',async()=>{
  const f=await fixture();try{
    f.w.document.querySelector('#focus').focus();f.key('keydown','AltLeft');point(f)('click');await tick();
    f.tools.editor.replacement.value='Saved draft';await f.tools.saveEditor();
    assert.equal(f.tools.editor,null);assert.equal(f.w.document.activeElement.id,'focus');
    assert.deepEqual(f.messages.map(m=>m.type),['inlineContext','inlineSave']);
    assert.equal(f.messages.at(-1).tableId,'a');
  }finally{f.dom.window.close();}
});

test('association changes and recovery cannot retarget an existing draft',async()=>{
  const f=await fixture();try{
    f.key('keydown','AltLeft');point(f)('click');await tick();
    const e=f.tools.editor;e.replacement.value='Keep this draft';
    f.tools.configure({enabled:true,table:{id:'b'}});
    assert.equal(e.save.disabled,true);assert.equal(e.replacement.value,'Keep this draft');
    f.respond(async()=>({table:{id:'b',name:'Other'},tableId:'b',entry:{replacement:'Wrong'},token:'wrong'}));
    await f.tools.loadContext();
    assert.equal(f.messages.at(-1).tableId,'a');assert.equal(e.loadedTable,'a');
    assert.equal(e.table.textContent,'<One>');assert.equal(e.replacement.value,'Keep this draft');
    assert.equal(e.save.disabled,true);assert.equal(e.token,null);assert.equal(e.refresh.hidden,false);
    f.respond(async()=>({table:{id:'a',name:'Old table'},tableId:'a',entry:null,token:'stale-association'}));
    await f.tools.loadContext();assert.equal(e.save.disabled,true);assert.equal(e.token,null);
    await f.tools.saveEditor();assert.equal(f.messages.some(m=>m.type==='inlineSave'),false);
  }finally{f.dom.window.close();}
});

test('unlinked page shows no-table guidance and never falls back to a table list',async()=>{
  const f=await fixture();try{
    f.respond(async()=>({table:null,tableId:null,entry:null,token:null}));
    f.key('keydown','AltLeft');point(f)('click');await tick();
    const e=f.tools.editor;assert.equal(e.save.disabled,true);assert.equal(e.loadedTable,undefined);
    assert.match(e.status.textContent,/popup/i);assert.equal(e.shadow.querySelector('select'),null);
  }finally{f.dom.window.close();}
});

test('existing-row deletion requires inline confirmation, cancel is inert and success closes',async()=>{
 const f=await fixture();try{
  f.respond(async m=>m.type==='inlineDelete'?{deleted:true}:{table:{id:'a',name:'One'},tableId:'a',entry:{id:'row',replacement:'Rendered'},token:'delete-token'});
  f.tools.openEditor({original:'Source'});await tick();const e=f.tools.editor;
  const del=e.shadow.querySelector('[name=delete]'),confirm=e.shadow.querySelector('[name=delete-confirm]');
  assert.equal(del.hidden,false);del.click();assert.equal(confirm.closest('[data-delete-confirmation]').hidden,false);
  e.shadow.querySelector('[name=delete-cancel]').click();assert.deepEqual(f.messages.map(m=>m.type),['inlineContext']);
  assert.equal(confirm.closest('[data-delete-confirmation]').hidden,true);
  del.click();confirm.click();await tick();assert.equal(f.tools.editor,null);
  assert.equal(f.messages.at(-1).type,'inlineDelete');assert.equal(f.messages.at(-1).token,'delete-token');assert.equal(f.messages.at(-1).tableId,'a');
 }finally{f.dom.window.close();}
});

test('activation flags release transient modes and disabled stored shortcuts stay inactive',async()=>{
 const f=await fixture();try{
  const settings={peekMode:'toggle',editMode:'toggle',peekKey:'ShiftLeft',editKey:'AltLeft'};
  f.tools.configure({enabled:true,table:{id:'a'},interactionSettings:settings});f.key('keydown','ShiftLeft');f.key('keydown','AltLeft');
  assert.equal(f.tools.peeking,true);assert.equal(f.tools.editHeld,true);
  f.tools.configure({enabled:true,table:{id:'a'},interactionSettings:{...settings,peekEnabled:false,editEnabled:false}});
  assert.equal(f.tools.peeking,false);assert.equal(f.tools.editHeld,false);
  f.key('keydown','ShiftLeft');f.key('keydown','AltLeft');assert.equal(f.tools.peeking,false);assert.equal(f.tools.editHeld,false);
  f.tools.configure({enabled:true,table:{id:'a'},interactionSettings:{...settings,peekEnabled:true,editEnabled:true}});f.key('keydown','ShiftLeft');f.key('keydown','AltLeft');assert.equal(f.tools.peeking,true);assert.equal(f.tools.editHeld,true);
 }finally{f.dom.window.close();}
});
test('new inline rows cannot delete and failed deletion retains draft with recoverable error',async()=>{
 const f=await fixture();try{
  f.respond(async()=>({table:{id:'a',name:'One'},tableId:'a',entry:null,token:'new'}));f.tools.openEditor({original:'Source'});await tick();let e=f.tools.editor;
  assert.equal(e.remove.hidden,true);await f.tools.saveEditor(true);assert.equal(f.messages.some(m=>m.type==='inlineDelete'),false);
  f.respond(async m=>m.type==='inlineDelete'?{error:'Stale row'}:{table:{id:'a',name:'One'},tableId:'a',entry:{id:'row',replacement:'Old'},token:'existing'});
  await f.tools.loadContext();e.replacement.value='Unsaved draft';e.remove.click();e.confirm.click();await tick();
  assert.equal(f.tools.editor,e);assert.equal(e.replacement.value,'Unsaved draft');assert.equal(e.token,null);assert.match(e.status.textContent,/Stale/);assert.equal(e.refresh.hidden,false);assert.equal(e.confirm.disabled,true);
  await f.tools.loadContext();assert.equal(e.replacement.value,'Unsaved draft');assert.equal(e.remove.disabled,false);assert.equal(e.confirm.disabled,false);
  f.tools.configure({enabled:true,table:{id:'other'}});assert.equal(e.remove.disabled,true);e.remove.click();await f.tools.saveEditor(true);assert.equal(f.messages.filter(m=>m.type==='inlineDelete').length,1);
 }finally{f.dom.window.close();}
});

test('confirmed inline deletion through content reload restores original page text',async()=>{
 const {seededHarness:harness}=await import('./background-harness.mjs');
 const h=await harness({rules:[]});const url='https://example.com/docs/a';h.grants.add('https://example.com/*');
 const initial=await h.send({type:'state'}),table=initial.library.tables[0];
 table.entries=[{...table.entries[0],id:'source',en:'Source',ko:'Rendered',selector:''}];
 await h.send({type:'librarySave',library:initial.library});await h.send({type:'selectTable',url,tableId:table.id});await h.send({type:'toggleSite',url,enabled:true});
 const dom=new JSDOM('<body><p>Source</p></body>',{url,runScripts:'outside-only'}),w=dom.window;
 try{
  const actor={id:'test',frameId:0,documentId:'content-delete',url,tab:{id:1,url}};
  w.chrome={runtime:{id:'test',getManifest:()=>({version:'fixture'}),sendMessage:m=>h.send(m,actor),onMessage:{addListener(){}}},storage:{onChanged:{addListener(){}}}};
  for(const file of ['shared.js','library.js','engine.js','interaction-settings.js','page-tools.js'])w.eval(await readFile(new URL('../extension/'+file,import.meta.url),'utf8'));
  let tools;const PageTools=w.TextPatchPageTools;w.TextPatchPageTools=class extends PageTools{constructor(options){super(options);tools=this;}};
  w.eval(await readFile(new URL('../extension/content.js',import.meta.url),'utf8'));
  for(let n=0;n<100 && w.document.querySelector('p').textContent!=='Rendered';n++)await tick();
  assert.equal(w.document.querySelector('p').textContent,'Rendered');tools.openEditor({original:'Source'});
  for(let n=0;n<100 && !tools.editor?.token;n++)await tick();
  tools.editor.remove.click();tools.editor.confirm.click();
  for(let n=0;n<100 && w.document.querySelector('p').textContent!=='Source';n++)await tick();
  assert.equal(tools.editor,null);assert.equal(w.document.querySelector('p').textContent,'Source');assert.equal((await h.send({type:'state'})).library.tables[0].entries.length,0);
 }finally{w.close();}
});
