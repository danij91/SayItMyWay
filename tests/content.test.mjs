import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const seed=JSON.parse(await readFile(new URL('../extension/data/dictionary.json',import.meta.url),'utf8'));
test('legacy fitting metadata never calls layout API or causes content reapplication',async()=>{
 const d=new JSDOM('<body>Source</body>',{url:'https://example.com',runScripts:'outside-only'});
 let listener,calls=0,enabled=false;
 d.window.CrimsonTranslator=class{
  setEnabled(value){enabled=value;}
  setData(){calls++;}
  setLayoutOptions(){throw Error('Content must never call fitting');}
  diagnostics(){return {enabled};}
 };
 d.window.chrome={runtime:{id:'test',getManifest:()=>({version:'fixture'}),sendMessage:async()=>({enabled:false}),onMessage:{addListener:fn=>listener=fn}},storage:{onChanged:{addListener(){}}}};
 try{
  d.window.eval(await readFile(new URL('../extension/content.js',import.meta.url),'utf8'));
  await new Promise(r=>setTimeout(r,0));
  const send=state=>new Promise(resolve=>listener({type:'applyState',state},{id:'test'},resolve));
  const state={enabled:true,table:{id:'a',entries:[]},rule:{fitText:{enabled:true,fontScale:1.2}}};
  assert.equal((await send(state)).error,'');assert.equal(calls,1);
  assert.equal((await send({...state,rule:{fitText:{enabled:false,fontScale:.7}}})).error,'');
  assert.equal(calls,1);assert.equal(enabled,true);
 }finally{d.window.close();}
});
test('singleton content applies exclusions, applies populated rows, restores on unlink and SPA navigation',async()=>{
 const d=new JSDOM('<body><button>Show All</button><span>CRIMSON DESERT</span></body>',{url:'https://example.com/docs/a',runScripts:'outside-only'});
 const listeners=[];let state,finishInitial,requests=0;
 d.window.chrome={runtime:{id:'test',getManifest:()=>({version:'0.4.0'}),sendMessage:()=>{requests++;return requests===1?new Promise(r=>finishInitial=r):Promise.resolve(state);},onMessage:{addListener:fn=>listeners.push(fn)}},storage:{onChanged:{addListener:()=>{}}}};
 try {
  for(const f of ['shared.js','library.js','engine.js'])d.window.eval(await readFile(new URL('../extension/'+f,import.meta.url),'utf8'));
  state={enabled:true,includeReview:false,rule:{id:'r'},table:d.window.TextPatch.migrate(seed).tables[0]};
  const source=await readFile(new URL('../extension/content.js',import.meta.url),'utf8');
  d.window.eval(source);d.window.eval(source);assert.equal(listeners.length,1);
  const send=m=>new Promise(r=>listeners[0](m,{id:'test'},r));
  let report=await send({type:'applyState',state});
  assert.equal(report.translated,1);assert.equal(report.error,'');assert.equal(report.tableId,'crimson-desert');
  assert.equal(d.window.document.querySelector('span').textContent,'CRIMSON DESERT');
  finishInitial({enabled:false});await new Promise(r=>setTimeout(r,0));
  assert.equal(d.window.document.querySelector('button').textContent,'모두 표시');
  report=await send({type:'applyState',state:{enabled:false,table:null}});
  assert.equal(report.translated,0);assert.equal(d.window.document.querySelector('button').textContent,'Show All');
  await send({type:'applyState',state});
  state={enabled:false,table:null};d.window.history.pushState({},'','/other');
  await new Promise(r=>setTimeout(r,350));
  assert.equal(d.window.document.querySelector('button').textContent,'Show All');
  assert.equal((await send({type:'diagnostics'})).enabled,false);
 }finally{d.window.close();}
});

test('table switch and obsolete review settings use originals; restore message immediately restores DOM',async()=>{
 const d=new JSDOM('<body><span>Alpha</span><button>Draft</button></body>',{url:'https://example.com',runScripts:'outside-only'});
 let listener;
 d.window.chrome={runtime:{id:'test',getManifest:()=>({version:'0.4.0'}),sendMessage:async()=>({enabled:false}),onMessage:{addListener:fn=>listener=fn}},storage:{onChanged:{addListener:()=>{}}}};
 try{
  for(const f of ['shared.js','library.js','engine.js','content.js'])d.window.eval(await readFile(new URL('../extension/'+f,import.meta.url),'utf8'));
  await new Promise(r=>setTimeout(r,0));
  const base=d.window.TextPatch.migrate(seed).tables[0];
  const row={...base.entries[0],id:'alpha',en:'Alpha',ko:'First',status:'verified',context:'global',selector:''};
  const first={...base,id:'first',entries:[row,{...row,id:'draft',en:'Draft',ko:'Preview',status:'review'}],excludedTerms:[],excludedCategories:[]};
  const send=m=>new Promise(r=>listener(m,{id:'test'},r));
  const apply=(table,includeReview=false)=>send({type:'applyState',state:{enabled:true,table,includeReview}});
  await apply(first);assert.equal(d.window.document.body.textContent,'FirstPreview');
  await apply(first,true);assert.equal(d.window.document.body.textContent,'FirstPreview');
  await apply({...first,id:'second',entries:[{...row,ko:'Second'}]});
  assert.equal(d.window.document.body.textContent,'SecondDraft');
  const report=await send({type:'restoreOriginal'});
  assert.equal(report.enabled,false);assert.equal(d.window.document.body.textContent,'AlphaDraft');
 }finally{d.window.close();}
});

test('all statuses with replacements apply despite legacy false, including dynamic DOM, and toggle off restores originals',async()=>{
 const d=new JSDOM('<body><p>Verified</p><p>Review</p><p>Untranslated</p><p>Empty</p><p>Whitespace</p><input value="Review"><div contenteditable="true">Review</div></body>',{url:'https://example.com',runScripts:'outside-only'});
 let listener;
 d.window.chrome={runtime:{id:'test',getManifest:()=>({version:'0.4.0'}),sendMessage:async()=>({enabled:false}),onMessage:{addListener:fn=>listener=fn}},storage:{onChanged:{addListener(){}}}};
 try{
  for(const f of ['shared.js','library.js','engine.js','content.js'])d.window.eval(await readFile(new URL('../extension/'+f,import.meta.url),'utf8'));
  await new Promise(r=>setTimeout(r,0));
  const base=d.window.TextPatch.migrate(seed).tables[0],row=base.entries[0];
  const table={...base,excludedTerms:[],excludedCategories:[],entries:[
   ...['verified','review','untranslated'].map((status,i)=>({...row,id:status,en:['Verified','Review','Untranslated'][i],ko:status+' replacement',status,kind:'ui',source:'Fixture source',evidence:'Fixture evidence',notes:'Keep provenance',selector:'',context:'global'})),
   {...row,id:'empty',en:'Empty',ko:'',status:'review'},
   {...row,id:'whitespace',en:'Whitespace',ko:'   ',status:'untranslated'}
  ]};
  const before=JSON.stringify(table),send=m=>new Promise(r=>listener(m,{id:'test'},r));
  await send({type:'applyState',state:{enabled:true,includeReview:false,table}});
  assert.deepEqual([...d.window.document.querySelectorAll('p')].map(p=>p.textContent),['verified replacement','review replacement','untranslated replacement','Empty','Whitespace']);
  assert.equal(d.window.document.querySelector('input').value,'Review');assert.equal(d.window.document.querySelector('[contenteditable]').textContent,'Review');
  const added=d.window.document.createElement('section');added.innerHTML='<p>Review</p><p>Untranslated</p>';d.window.document.body.append(added);
  await new Promise(r=>setTimeout(r,20));assert.equal(added.textContent,'review replacementuntranslated replacement');
  await send({type:'applyState',state:{enabled:false,includeReview:false,table}});
  assert.deepEqual([...d.window.document.querySelectorAll('p')].map(p=>p.textContent),['Verified','Review','Untranslated','Empty','Whitespace','Review','Untranslated']);
  assert.equal(JSON.stringify(table),before);
 }finally{d.window.close();}
});

test('DB revision invalidation reloads canonical page state and reapplies from original text',async()=>{
 const d=new JSDOM('<body><button>Show All</button></body>',{url:'https://example.com',runScripts:'outside-only'});
 let changed,state;
 d.window.chrome={runtime:{id:'test',getManifest:()=>({version:'0.4.0'}),sendMessage:async()=>structuredClone(state),onMessage:{addListener(){}}},storage:{onChanged:{addListener:fn=>changed=fn}}};
 try{
  for(const f of ['shared.js','library.js','engine.js'])d.window.eval(await readFile(new URL('../extension/'+f,import.meta.url),'utf8'));
  state={enabled:true,includeReview:true,table:d.window.TextPatch.migrate(seed).tables[0]};
  d.window.eval(await readFile(new URL('../extension/content.js',import.meta.url),'utf8'));await new Promise(r=>setTimeout(r,0));
  assert.equal(d.window.document.querySelector('button').textContent,'모두 표시');
  state.table=structuredClone(state.table);state.table.revision++;state.table.entries.find(e=>e.en.toLowerCase()==='show all').ko='Updated DB translation';
  changed({libraryRevision:{newValue:2}},'local');await new Promise(r=>setTimeout(r,0));
  assert.equal(d.window.document.querySelector('button').textContent,'Updated DB translation');
 }finally{d.window.close();}
});
