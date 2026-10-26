import {loadKorean} from './i18n-harness.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,copyFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {JSDOM} from 'jsdom';
import {createServer} from '../server.mjs';
import '../extension/shared.js';
import '../extension/library.js';
await import('../extension/editor/import.js');
const seed=JSON.parse(await readFile(new URL('../extension/data/dictionary.json',import.meta.url),'utf8'));
const fixture=()=>TextPatch.migrate(structuredClone(seed));

test('JSON review merges selected IDs, preserves omitted rows and unknown metadata without mutating input',()=>{
  const base=fixture();base.custom={retained:true};base.tables[0].defaults.extra='keep';base.tables[0].entries[0].custom={old:true};
  const incoming=structuredClone(base.tables[0]);incoming.entries=incoming.entries.slice(0,2);incoming.entries[0].ko='변경';incoming.entries[0].custom={new:true};incoming.entries.push({...incoming.entries[1],id:'new-row',en:'New row',status:'review',source:'',evidence:''});
  incoming.description='가져온 설명';incoming.defaults.extra='incoming';
  const before=JSON.stringify(base),plan=TableImport.preview(base,JSON.stringify(incoming));
  assert.deepEqual(plan.changes.map(c=>c.status),['changed','changed','unchanged','added']);
  const row=plan.changes.find(c=>c.entryId===incoming.entries[0].id);
  const next=TableImport.apply(plan,[row.key]);
  assert.equal(next.tables[0].entries[0].ko,'변경');
  assert.deepEqual(next.tables[0].entries[0].custom,{old:true,new:true});
  assert.equal(next.tables[0].entries.length,seed.entries.length);
  assert.equal(next.tables[0].description,base.tables[0].description);
  assert.deepEqual(next.custom,{retained:true});
  assert.equal(JSON.stringify(base),before);
  assert.deepEqual(TableImport.apply(plan,[]),base);
});

test('JSON UI imports a draft, saves explicitly, preserves conflict draft and persisted data across restart',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'table-import-')),dataPath=path.join(dir,'dictionary.json');
  await copyFile(new URL('../extension/data/dictionary.json',import.meta.url),dataPath);
  const original=await readFile(dataPath,'utf8');let server,base,dom;
  const start=async()=>{server=await createServer({dataPath});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;};
  const stop=()=>new Promise(r=>server.close(r));
  try{
    await start();const initial=await(await fetch(base+'/api/library')).json();
    dom=new JSDOM(await(await fetch(base)).text(),{url:base,runScripts:'outside-only'});
    const w=dom.window,$=s=>w.document.querySelector(s);w.structuredClone=structuredClone;w.TextEncoder=TextEncoder;
    w.fetch=(url,options={})=>fetch(new URL(url,base),{...options,headers:{...options.headers,...(options.method?{Origin:base}:{})}});
    w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
    loadKorean(w);for(const src of [...w.document.scripts].map(s=>s.getAttribute('src')))w.eval(await(await fetch(new URL(src,base))).text());
    const until=async predicate=>{for(let i=0;i<150;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('UI timeout');};
    await until(()=>$('#rows').children.length===seed.entries.length);
    const incoming=structuredClone(initial.tables[0]);incoming.entries=incoming.entries.slice(0,2);incoming.entries[0].ko='<img src=x onerror="window.injected=true">';
    const upload=async text=>{
      $('#import-open').click();Object.defineProperty($('#import-file'),'files',{configurable:true,value:[new w.File([text],'import.json',{type:'application/json'})]});
      await $('#import-file').onchange();
    };
    await upload(JSON.stringify(incoming));assert.equal($('#import-editor').open,false,$('#import-error').textContent);
    assert.deepEqual(await(await fetch(base+'/api/library')).json(),initial);
    await $('#save-all').onclick();
    const saved=await(await fetch(base+'/api/library')).json();assert.deepEqual(saved.tables[0],initial.tables[0]);
    assert.notEqual(saved.tables[1].id,incoming.id);assert.notEqual(saved.tables[1].entries[0].id,incoming.entries[0].id);
    assert.equal(saved.tables[1].entries[0].ko,incoming.entries[0].ko);assert.equal($('#rows img'),null);assert.equal(w.injected,undefined);
    const external=structuredClone(saved);external.tables[0].name='External change';
    assert.equal((await fetch(base+'/api/library',{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(external)})).status,200);
    const latest=await(await fetch(base+'/api/library')).json();
    await upload(JSON.stringify(incoming));assert.equal($('#import-editor').open,false);
    await $('#save-all').onclick();assert.match($('#save-state').textContent,/저장 실패/);assert.equal($('#table-select').options.length,3);assert.equal($('#save-all').disabled,false);
    assert.deepEqual(await(await fetch(base+'/api/library')).json(),latest);
    $('#import-cancel').click();await stop();await start();
    assert.deepEqual(await(await fetch(base+'/api/library')).json(),latest);assert.equal(await readFile(dataPath,'utf8'),original);
  }finally{dom?.window.close();if(server?.listening)await stop();await rm(dir,{recursive:true,force:true});}
});

test('table/library/bundle round trips preserve statuses and metadata, invalid IDs and duplicates fail closed',()=>{
  const base=fixture(),copy=structuredClone(base.tables[0]);copy.id='new-table';copy.name='새 표';copy.entries=copy.entries.slice(0,2);copy.entries[0].status='review';copy.entries[0].source='';copy.entries[0].evidence='';
  for(const value of [copy,{schemaVersion:2,revision:99,custom:{backup:true},tables:[copy]},{kind:'text-patch-bundle',schemaVersion:1,library:{schemaVersion:2,revision:9,tables:[copy]},settings:{ignored:true}}]){
    const plan=TableImport.preview(base,JSON.stringify(value));
    const next=TableImport.apply(plan,plan.changes.filter(c=>c.scope!=='entry' || c.entryId===copy.entries[0].id).map(c=>c.key));
    assert.equal(next.revision,1);assert.equal(next.tables[1].entries.length,1);assert.equal(next.tables[1].entries[0].status,'review');assert.equal(next.settings,undefined);
    assert.deepEqual(JSON.parse(TableImport.exportJSON(next,'new-table')),next.tables[1]);
    assert.deepEqual(JSON.parse(TableImport.exportJSON(next)),next);
  }
  for(const mutate of [x=>x.id='../bad',x=>x.entries[0].id=' ',x=>x.entries.push(x.entries[0]),x=>x.entries[0].ko=null]){const invalid=structuredClone(copy);mutate(invalid);assert.throws(()=>TableImport.preview(base,JSON.stringify(invalid)));}
  assert.throws(()=>TableImport.preview(base,'{'),/JSON/);
  assert.throws(()=>TableImport.preview(base,JSON.stringify({schemaVersion:2,revision:1,tables:[copy,copy]})),/ID/);
  const collision=structuredClone(copy);collision.id=base.tables[0].id;collision.entries=[{...base.tables[0].entries[0],id:'different-id'}];
  const plan=TableImport.preview(base,JSON.stringify(collision));
  const ambiguous=TableImport.apply(plan,plan.changes.map(c=>c.key));
  assert.equal(ambiguous.tables[0].entries.length,base.tables[0].entries.length+1);
});

test('capture rows require an explicit target table and preserve empty replacement, status and source',()=>{
  const base=fixture(),capture={schemaVersion:1,revision:1,entries:[{id:'capture-1',en:'Captured text',ko:'',kind:'general',category:'일반',context:'global',selector:'',status:'untranslated',source:'',evidence:'',notes:''}]};
  assert.throws(()=>TableImport.preview(base,JSON.stringify(capture)),/대상 표/);
  const plan=TableImport.preview(base,JSON.stringify(capture),'crimson-desert');
  const next=TableImport.apply(plan,plan.changes.map(c=>c.key));
  assert.deepEqual(next.tables[0].entries.at(-1),capture.entries[0]);assert.deepEqual(next.tables[0].excludedTerms,base.tables[0].excludedTerms);
  assert.throws(()=>TableImport.preview(base,JSON.stringify({...capture,id:'../bad'}),'crimson-desert'),/ID/);
});

test('unknown JSON keys remain own metadata and cannot change object prototypes',()=>{
  const base=fixture(),input=JSON.parse(TableImport.exportJSON(base));
  input.tables[0].entries=input.tables[0].entries.slice(0,1);
  const payload=JSON.stringify(input).replace('"tables":','"__proto__":{"injected":true},"tables":');
  const plan=TableImport.preview(base,payload),next=TableImport.apply(plan,plan.changes.map(c=>c.key));
  assert.equal(Object.getPrototypeOf(next),Object.prototype);assert.equal(Object.hasOwn(next,'__proto__'),true);assert.equal(next.injected,undefined);
});

test('legacy table without defaults cannot silently reset the existing matching policy',()=>{
  const base=fixture();base.tables[0].defaults={matchMode:'word',caseSensitive:true,translatePlaceholders:false,custom:'retain'};
  const input=structuredClone(base.tables[0]);delete input.defaults;input.entries=[];
  const plan=TableImport.preview(base,JSON.stringify(input)),next=TableImport.apply(plan,plan.changes.map(c=>c.key));
  assert.deepEqual(next.tables[0].defaults,{matchMode:'word',caseSensitive:true,translatePlaceholders:false,custom:'retain'});
});
