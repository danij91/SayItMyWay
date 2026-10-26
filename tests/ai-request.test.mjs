import '../extension/locales/ko.js';
import '../extension/locales/en.js';
import '../extension/i18n.js';
await TextPatchI18n.setLocale('ko');
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import '../extension/shared.js';
import '../extension/library.js';
import '../extension/editor/import.js';
const seed=JSON.parse(await readFile(new URL('../extension/data/dictionary.json',import.meta.url),'utf8'));
const row=(i)=>({id:'row-'+i,en:'Original '+i,ko:'',kind:'general',category:'general',context:'global',selector:'',status:'untranslated',source:'',evidence:'',notes:'retain'});
const table=()=>({...TextPatch.migrate(seed).tables[0],id:'test',custom:{keep:true},entries:[row(0),{...row(1),ko:'verified text',status:'verified',source:'https://official.example',evidence:'checked'}]});
await import('../extension/ai-request.js');

test('AI builder requires explicit task intent and returns portable new table preserving source metadata',async()=>{
  await import('../extension/ai-request.js');
  const input=table(),before=JSON.stringify(input);
  assert.throws(()=>TextPatchAI.build({table:input,task:'translation'}),/언어/);
  assert.throws(()=>TextPatchAI.build({table:input,task:'replacement'}),/지시/);
  const result=TextPatchAI.build({table:input,task:'translation',targetLanguage:'French'});
  assert.equal(result.count,1);assert.equal(result.total,1);assert.equal(result.nextOffset,null);
  const partial=JSON.parse(result.text.split('--- JSON 데이터 시작 ---\n\n')[1].split('\n\n--- JSON 데이터 끝 ---')[0]);
  assert.deepEqual(partial,TextPatch.portableTable({...input,entries:[input.entries[0]]}));
  for(const field of ['id','revision','excludedTerms','excludedCategories','context','selector','custom'])assert.equal(result.text.includes('"'+field+'"'),false);
  assert.doesNotMatch(result.text,/ABYSS|CRIMSON DESERT|HERNAND|지명/);
  assert.match(result.text,/사용자에게.*질문/);
  partial.entries[0].replacement='Proposition';partial.entries[0].status='review';
  const library={schemaVersion:2,revision:1,tables:[input]},next=TableImport.createNew(library,JSON.stringify(partial)).library;
  assert.equal(next.tables[1].entries[0].ko,'Proposition');assert.deepEqual(next.tables[0],input);
  assert.equal(JSON.stringify(input),before);assert.match(result.text,/French/);assert.match(result.text,/auto/);
});

test('complete export covers every eligible row including huge originals and metadata',()=>{
  const input={...table(),name:'메타'.repeat(80000),entries:Array.from({length:405},(_,i)=>({...row(i),en:i===202?'한글😀'.repeat(80000):row(i).en}))};
  const before=JSON.stringify(input),result=TextPatchAI.build({table:input,task:'replacement',instruction:'Use short labels'});
  const partial=JSON.parse(result.text.split('--- JSON 데이터 시작 ---\n\n')[1].split('\n\n--- JSON 데이터 끝 ---')[0]);
  assert.equal(result.count,405);assert.equal(result.total,405);assert.equal(result.nextOffset,null);
  assert.deepEqual(partial.entries.map(e=>e.original),input.entries.map(e=>e.en));
  assert.equal(partial.name,input.name);assert.equal(JSON.stringify(input),before);
  assert.equal(result.bytes,Buffer.byteLength(result.text,'utf8'));assert.equal(result.copyable,false);
});

test('copy policy counts UTF-8 bytes with an inclusive internal budget',()=>{
  const base={...table(),entries:[row(0)]},opts={table:base,task:'replacement',instruction:'shorten'};
  const initial=TextPatchAI.build(opts),room=TextPatchAI.COPY_BYTE_BUDGET-initial.bytes;
  base.entries[0].en+='a'.repeat(room);assert.equal(TextPatchAI.build(opts).copyable,true);
  base.entries[0].en+='한';const over=TextPatchAI.build(opts);
  assert.equal(over.bytes,TextPatchAI.COPY_BYTE_BUDGET+3);assert.equal(over.copyable,false);
});

test('AI prompt includes research/access/provenance guards and restricts page context to sanitized fields',()=>{
  const result=TextPatchAI.build({table:table(),task:'translation',sourceLanguage:'German',targetLanguage:'Spanish',page:{url:'https://user:pass@example.com/a?q=secret#token',title:'<img src=x>',language:'de',cookies:'SECRET',html:'SECRET',input:'SECRET'}});
  assert.match(result.text,/German/);assert.match(result.text,/Spanish/);assert.match(result.text,/https:\/\/example.com\/a/);
  assert.doesNotMatch(result.text,/q=secret|token|user:pass|SECRET/);
  for(const text of ['공식 자료','한계','신뢰할 수 없는','verified로 승격하지','발명하지','읽기 전용','review'])assert.ok(result.text.includes(text));
});

test('AI website context distinguishes permissible absence from invalid HTTP(S) URLs without fabricating metadata',()=>{
  const options={table:table(),task:'translation',targetLanguage:'English'};
  const context=result=>JSON.parse(result.text.split(TextPatchI18n.t('current_page_context_separate_from_table_capture_sources'))[1].split('\n\n')[0]);
  for(const page of [undefined,null,{url:''},{url:'   ',title:'Unknown site',language:'Unknown'}])assert.equal(context(TextPatchAI.build({...options,page})),null);
  assert.deepEqual(context(TextPatchAI.build({...options,page:{url:'https://user:pass@example.com/a?token=secret#secret'}})),{url:'https://example.com/a',title:'',language:''});
  for(const url of ['ftp://example.com','javascript:alert(1)','example.com','https://example.com/\nsecret','https://','x'.repeat(4097),42])assert.throws(()=>TextPatchAI.build({...options,page:{url}}));
});
test('linked requests cover every blank regardless of status and every existing reference without truncation',()=>{
  const input=table();input.entries=[{...row(0),en:'Duplicate'},{...row(1),en:'Duplicate',status:'review'},...Array.from({length:25},(_,i)=>({...row(i+2),ko:'Reference '+i,status:'review'}))];
  const result=TextPatchAI.build({table:input,task:'replacement',instruction:'Shorten',requestId:'request-local'});
  const partial=JSON.parse(result.text.split('--- JSON 데이터 시작 ---\n\n')[1].split('\n\n--- JSON 데이터 끝 ---')[0]);
  assert.deepEqual(partial.aiRequest,{version:1,id:'request-local'});
  assert.deepEqual(partial.entries.map(row=>[row.original,row.requestRow]),[['Duplicate','0'],['Duplicate','1']]);
  assert.match(result.text,/Reference 24/);assert.equal(result.count,2);
});
