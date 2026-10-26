import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import '../extension/shared.js';
import '../extension/library.js';
import '../extension/editor/import.js';

const seed=JSON.parse(await readFile(new URL('../extension/data/dictionary.json',import.meta.url),'utf8'));
const file=new URL('../examples/crimson-desert-ar-test.json',import.meta.url);
const bidi=/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
async function until(predicate){
  for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.ok(predicate(),'DOM scan completed');
}

test('Arabic test exchange preserves all 147 exact originals with honest unverified provenance',async()=>{
  const bytes=await readFile(file),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),table=JSON.parse(text);
  assert.notEqual(bytes[0],0xef,'UTF-8 without BOM');
  assert.equal(table.format,'text-patch-table');assert.equal(table.version,1);
  assert.match(table.name,/테스트/);assert.match(table.name,/اختبار/);
  assert.deepEqual(table.defaults,{matchMode:'exact',caseSensitive:false,translatePlaceholders:false});
  assert.equal(table.entries.length,147);
  assert.deepEqual(table.entries.map(e=>e.en),seed.entries.map(e=>e.en));
  assert.equal(new Set(table.entries.map(e=>e.en)).size,147);
  for(const [i,row] of table.entries.entries()){
    assert.equal(row.kind,seed.entries[i].kind);assert.equal(row.category,seed.entries[i].category);
    assert.match(row.source,/AI/);assert.match(row.evidence,/공식 미검증/);assert.match(row.notes,/테스트/);
    assert.doesNotMatch(row.source+row.evidence,/https?:\/\//,'Korean official sources are not Arabic evidence');
    assert.equal(row.status,row.en==='SPECIAL COOKING TO...'?'untranslated':'review');
    if(row.status==='review')assert.match(row.ko,/\p{Script=Arabic}/u);
    else {assert.equal(row.ko,'');assert.match(row.notes,/잘린/);}
  }
  for(const field of ['id','revision','schemaVersion','context','selector','excludedTerms','excludedCategories'])assert.equal(text.includes('"'+field+'"'),false);
  assert.equal(bidi.test(text),false);
  assert.deepEqual(JSON.parse(JSON.stringify(table)),table);
});

test('production importer creates independent valid tables and portable JSON round trips losslessly',async()=>{
  const text=await readFile(file,'utf8'),portable=JSON.parse(text);
  const base=TextPatch.migrate(structuredClone(seed)),before=structuredClone(base);
  const first=TableImport.createNew(base,text);
  assert.deepEqual(base,before);
  assert.equal(first.library.tables.length,2);
  assert.deepEqual(first.library.tables[0],before.tables[0]);
  assert.doesNotThrow(()=>TextPatch.validateLibrary(first.library));
  const table=first.library.tables[1];
  assert.deepEqual(first.tableIds,[table.id]);
  assert.equal(table.name,portable.name);
  assert.deepEqual(table.excludedTerms,[]);assert.deepEqual(table.excludedCategories,[]);
  assert.deepEqual(table.defaults,portable.defaults);
  assert.equal(new Set([table.id,...table.entries.map(e=>e.id)]).size,148);
  const existingIds=new Set(before.tables.flatMap(t=>[t.id,...t.entries.map(e=>e.id)]));
  for(const id of [table.id,...table.entries.map(e=>e.id)])assert.equal(existingIds.has(id),false);
  const exported=TableImport.exportPortable(first.library,table.id);
  const expected={...portable,version:2,entries:portable.entries.map(({en,ko,...metadata})=>({original:en,replacement:ko,...metadata}))};
  assert.deepEqual(JSON.parse(exported),expected);
  assert.equal(bidi.test(exported),false);
  const second=TableImport.createNew(first.library,exported),copy=second.library.tables[2];
  assert.equal(copy.name,portable.name+' (2)');assert.notEqual(copy.id,table.id);
  for(const [i,row] of copy.entries.entries())assert.notEqual(row.id,table.entries[i].id);
  const roundtrip=JSON.parse(TableImport.exportPortable(second.library,copy.id));
  assert.deepEqual({...roundtrip,name:portable.name},expected);
  assert.deepEqual(second.library.tables.slice(0,2),first.library.tables);
});

test('all Arabic drafts apply without status gating, exact matching protects input, and originals restore',async()=>{
  const {library}=TableImport.createNew({schemaVersion:2,revision:1,tables:[]},await readFile(file,'utf8'));
  const table=library.tables[0],dom=new JSDOM('<!doctype html><html dir="ltr"><body></body></html>',{runScripts:'outside-only'});
  try{
    const w=dom.window,doc=w.document;
    for(const src of ['shared.js','engine.js'])w.eval(await readFile(new URL('../extension/'+src,import.meta.url),'utf8'));
    const paragraphs=table.entries.map(row=>{const p=doc.createElement('p');p.textContent=row.en;doc.body.append(p);return p;});
    const extra=doc.createElement('p');extra.textContent='Open CHEST now';doc.body.append(extra);
    const lower=doc.createElement('p');lower.textContent='chest';doc.body.append(lower);
    const input=doc.createElement('input');input.value='CHEST';input.placeholder='CHEST';doc.body.append(input);
    const original=paragraphs.map(p=>p.textContent),translator=new w.CrimsonTranslator(doc);
    translator.setData(table);
    await until(()=>lower.textContent==='صندوق');
    await until(()=>paragraphs.at(-1).textContent===table.entries.at(-1).ko);
    assert.deepEqual(paragraphs.map(p=>p.textContent),table.entries.map(row=>row.ko||row.en));
    assert.equal(paragraphs[75].textContent,'SPECIAL COOKING TO...');
    assert.equal(paragraphs[143].textContent,'أداة طهي خاصة');
    assert.equal(lower.textContent,'صندوق');assert.equal(extra.textContent,'Open CHEST now');
    assert.equal(translator.getReplacementLog().length,147,'146 translated source rows plus lowercase CHEST');
    assert.equal(input.value,'CHEST');assert.equal(input.placeholder,'CHEST');
    assert.equal(doc.documentElement.dir,'ltr','host direction is preserved');
    assert.equal(bidi.test(doc.body.textContent),false);
    translator.setData(table,{includeReview:false});
    await until(()=>paragraphs.at(-1).textContent===table.entries.at(-1).ko);
    assert.deepEqual(paragraphs.map(p=>p.textContent),table.entries.map(row=>row.ko||row.en));
    await until(()=>lower.textContent==='صندوق');
    translator.setEnabled(false);
    assert.deepEqual(paragraphs.map(p=>p.textContent),original);assert.equal(lower.textContent,'chest');
    assert.equal(translator.getReplacementLog().length,0);
    translator.setEnabled(true);await until(()=>lower.textContent==='صندوق');
    assert.equal(paragraphs[0].textContent,'الصحراء القرمزية');
    translator.setEnabled(false);assert.deepEqual(paragraphs.map(p=>p.textContent),original);
  }finally{dom.window.close();}
});
