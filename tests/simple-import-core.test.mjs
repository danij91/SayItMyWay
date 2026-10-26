import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../extension/shared.js';
import '../extension/library.js';
import '../extension/editor/import.js';
import {mkdtemp,copyFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from '../server.mjs';
const row={id:'old-row',en:'Hello',ko:'안녕',kind:'general',category:'일반',context:'global',selector:'',status:'review',source:'source',evidence:'evidence',notes:'note',custom:{keep:true}};
const table={schemaVersion:1,revision:7,id:'old-table',name:'Table',description:'description',defaults:{matchMode:'word',caseSensitive:true,translatePlaceholders:false},excludedTerms:['KEEP'],excludedCategories:[],entries:[row],custom:{keep:true}};
const fixture=()=>({schemaVersion:2,revision:9,custom:{keep:true},tables:[structuredClone(table)]});
test('importing existing IDs and repeated old library files always allocates new tables and rows',()=>{
  const base=fixture(),before=structuredClone(base);
  const first=TableImport.createNew(base,JSON.stringify(base));
  const second=TableImport.createNew(first.library,JSON.stringify(table));
  assert.deepEqual(base,before);assert.deepEqual(second.library.tables[0],before.tables[0]);
  assert.equal(second.library.revision,9);assert.equal(second.library.tables.length,3);
  assert.deepEqual(second.library.tables.map(t=>t.name),['Table','Table (2)','Table (3)']);
  assert.equal(new Set(second.library.tables.map(t=>t.id)).size,3);
  assert.equal(new Set(second.library.tables.map(t=>t.entries[0].id)).size,3);
  assert.deepEqual(first.tableIds,[first.library.tables[1].id]);
  assert.deepEqual(second.library.tables[1].entries[0].custom,{keep:true});
});

test('portable round trip omits internal fields, accepts minimal rows, and isolates legacy exclusions',()=>{
  const base=fixture(),before=structuredClone(base),json=TableImport.exportPortable(base,'old-table'),portable=JSON.parse(json);
  assert.deepEqual(Object.keys(portable).sort(),['defaults','entries','format','name','version']);
  assert.equal(portable.format,'text-patch-table');
  assert.equal(portable.version,2);
  assert.equal(portable.entries[0].original,'Hello');assert.equal(portable.entries[0].replacement,'안녕');
  assert.equal(portable.entries[0].en,undefined);assert.equal(portable.entries[0].ko,undefined);
  for(const field of ['id','revision','excludedTerms','excludedCategories','context','selector','custom'])assert.equal(json.includes('"'+field+'"'),false);
  const imported=TableImport.createNew(base,json).library.tables[1];
  assert.equal(imported.entries[0].status,'review');assert.equal(imported.entries[0].source,'source');assert.equal(imported.defaults.matchMode,'word');
  assert.deepEqual(TableImport.createNew(base,JSON.stringify(table)).library.tables[1].excludedTerms,[]);
  const minimal={format:'text-patch-table',version:1,entries:[{en:'New',ko:''},{en:'Translated',ko:'번역'}]};
  const result=TableImport.createNew(base,JSON.stringify(minimal),'File name').library.tables[1];
  assert.equal(result.name,'File name');assert.deepEqual(result.entries.map(e=>e.status),['untranslated','review']);
  const neutral={format:'text-patch-table',version:2,entries:[{original:'New',replacement:''},{original:'Replaced',replacement:'Any text'}]};
  const modern=TableImport.createNew(base,JSON.stringify(neutral),'Neutral').library.tables[1];
  assert.deepEqual(modern.entries.map(e=>[e.en,e.ko,e.status]),[['New','','untranslated'],['Replaced','Any text','review']]);
  assert.deepEqual(base,before);
});

test('invalid and oversized imports fail atomically and enforce whole library validation',()=>{
  const base=fixture(),before=structuredClone(base);
  for(const input of ['{',' '.repeat(5_000_001),JSON.stringify({...base,revision:0}),JSON.stringify({format:'text-patch-table',version:9,entries:[]}),JSON.stringify({format:'text-patch-table',version:1,entries:[{en:'x',ko:'',status:'verified'}]})])assert.throws(()=>TableImport.createNew(base,input));
  const full={...base,tables:Array.from({length:100},(_,i)=>({...structuredClone(table),id:'t'+i}))};
  assert.throws(()=>TableImport.createNew(full,JSON.stringify(table)));
  const large=fixture();large.custom='x'.repeat(5_000_000);assert.throws(()=>TableImport.createNew(large,JSON.stringify(table)),/5MB/);
  assert.deepEqual(base,before);
});

test('version 2 keeps original text separate from provenance and round trips legacy portable rows',()=>{
  const base=fixture(),before=structuredClone(base);
  const legacy={format:'text-patch-table',version:1,name:'Legacy',defaults:table.defaults,
    captureSources:[{url:'https://example.com/page',title:'Title',language:'ja',capturedAt:'2026-10-20T00:00:00Z'}],
    entries:[{en:'元の文',ko:'Texte',status:'verified',kind:'ui',category:'menu',source:'https://example.com/evidence',evidence:'Checked',notes:'Retain',matchMode:'word',caseSensitive:true},{en:'Pending',ko:''}]};
  const text=JSON.stringify(legacy),first=TableImport.createNew(base,text).library;
  const portable=JSON.parse(TableImport.exportPortable(first,first.tables[1].id));
  assert.equal(portable.version,2);
  assert.deepEqual(portable.entries[0],{original:'元の文',replacement:'Texte',status:'verified',kind:'ui',category:'menu',source:'https://example.com/evidence',evidence:'Checked',notes:'Retain',matchMode:'word',caseSensitive:true});
  const imported=TableImport.createNew(first,JSON.stringify(portable)).library.tables[2];
  assert.deepEqual(imported.captureSources,legacy.captureSources);assert.deepEqual(imported.defaults,legacy.defaults);
  assert.equal(imported.entries[0].en,'元の文');assert.equal(imported.entries[0].ko,'Texte');
  assert.equal(imported.entries[0].source,'https://example.com/evidence');assert.equal(imported.entries[0].status,'verified');
  assert.equal(imported.entries[1].status,'untranslated');
  assert.deepEqual(JSON.parse(TableImport.exportPortable({tables:[imported]},imported.id)),{...portable,name:'Legacy (2)'});
  assert.deepEqual(base,before);assert.equal(JSON.stringify(legacy),text);
  assert.notEqual(imported.entries[0].id,first.tables[1].entries[0].id);
});

test('mixed and mismatched naming is rejected atomically, even for equal aliases',()=>{
  const base=fixture(),before=structuredClone(base);
  const modern={original:'Original',replacement:'Replacement',source:'https://example.com'};
  const old={en:'Original',ko:'Replacement'};
  for(const entries of [[{...modern,en:'Conflict'}],[{...modern,ko:'Replacement'}],[modern,old],[{source:'Original',replacement:'Replacement'}]]){
    assert.throws(()=>TableImport.createNew(base,JSON.stringify({format:'text-patch-table',version:2,entries})));
  }
  for(const entries of [[{...old,original:'Original'}],[{...old,replacement:'Conflict'}],[old,modern]]){
    assert.throws(()=>TableImport.createNew(base,JSON.stringify({format:'text-patch-table',version:1,entries})));
    assert.throws(()=>TableImport.createNew(base,JSON.stringify({...table,entries:entries.map((e,i)=>({...row,...e,id:'row-'+i}))})));
  }
  assert.throws(()=>TextPatch.portableTable({...table,entries:[{...row,original:row.en}]}));
  assert.deepEqual(base,before);
});

test('legacy capture and bundles import fresh while verified provenance and portable sources survive',()=>{
  const base=fixture(),verified={...structuredClone(table),entries:[{...row,status:'verified',source:'https://example.com',evidence:'checked'}]};
  verified.captureSources=[{url:'https://example.com',title:'Title',language:'en',capturedAt:'2026-10-20T00:00:00.000Z',id:'private-id'}];
  const bundle={kind:'text-patch-bundle',schemaVersion:1,library:{schemaVersion:2,revision:30,tables:[verified]},settings:{private:true}};
  const imported=TableImport.createNew(base,JSON.stringify(bundle)).library;
  assert.equal(imported.settings,undefined);assert.equal(imported.tables[1].entries[0].status,'verified');
  assert.equal(imported.tables[1].entries[0].evidence,'checked');
  const exported=JSON.parse(TableImport.exportPortable(imported,imported.tables[1].id));
  assert.deepEqual(exported.captureSources,[{url:'https://example.com',title:'Title',language:'en',capturedAt:'2026-10-20T00:00:00.000Z'}]);
  const capture={schemaVersion:1,revision:1,entries:[row]};
  const result=TableImport.createNew(base,JSON.stringify(capture)).library.tables[1];
  assert.equal(result.name,'가져온 대응표');assert.notEqual(result.id,table.id);assert.notEqual(result.entries[0].id,row.id);
});

test('shared naming handles rename exclusion and suffixes within the name limit',()=>{
  assert.equal(TextPatch.uniqueTableName(' Table ',[{id:'a',name:'Table'},{id:'b',name:'Table (2)'}]),'Table (3)');
  assert.equal(TextPatch.uniqueTableName('Table',[{id:'a',name:'Table'}],'a'),'Table');
  const name='x'.repeat(200),next=TextPatch.uniqueTableName(name,[{id:'a',name}]);
  assert.equal(next.length,200);assert.ok(next.endsWith(' (2)'));
});

test('server allocates scan names from latest saved state, retries keep target, imports persist after restart',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'simple-core-')),dataPath=path.join(dir,'dictionary.json');
  await copyFile(new URL('../extension/data/dictionary.json',import.meta.url),dataPath);
  const original=await readFile(dataPath,'utf8');let server,base;
  const start=async()=>{server=await createServer({dataPath});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;};
  const stop=()=>new Promise(r=>server.close(r));
  const get=async()=>await(await fetch(base+'/api/library')).json();
  const capture=(id)=>fetch(base+'/api/capture',{method:'POST',headers:{'Content-Type':'application/json','X-Text-Patch-Client':'extension'},body:JSON.stringify({tableId:id,createName:'Scan',candidates:['Hello']})});
  try{
    await start();const initial=await get();
    const responses=await Promise.all([capture('scan-a'),capture('scan-b')]);
    for(let i=0;i<responses.length;i++){
      assert.ok([200,409].includes(responses[i].status));
      if(responses[i].status===409)assert.equal((await capture(i?'scan-b':'scan-a')).status,200);
    }
    const latest=await get();assert.deepEqual(latest.tables.slice(1).map(t=>t.name).sort(),['Scan','Scan (2)']);
    assert.deepEqual(latest.tables[0],initial.tables[0]);
    const retry=await(await capture('scan-a')).json();assert.deepEqual(retry.library,latest);
    const imported=TableImport.createNew(latest,JSON.stringify(latest.tables[0])).library;
    const saved=await fetch(base+'/api/library',{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(imported)});
    assert.equal(saved.status,200);const final=await saved.json();assert.deepEqual(final.tables[0],initial.tables[0]);
    const stale=await fetch(base+'/api/library',{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(imported)});
    assert.equal(stale.status,409);assert.deepEqual(await get(),final);
    await stop();await start();assert.deepEqual(await get(),final);assert.equal(await readFile(dataPath,'utf8'),original);
  }finally{if(server?.listening)await stop();await rm(dir,{recursive:true,force:true});}
});
