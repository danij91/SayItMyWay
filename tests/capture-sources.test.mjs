import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {appendCapture} from '../server-collection.mjs';
import {createServer} from '../server.mjs';
import '../extension/editor/import.js';
const seed=JSON.parse(await readFile(new URL('../extension/data/dictionary.json',import.meta.url),'utf8'));
const fixture=()=>TextPatch.migrate(structuredClone(seed));
const source={url:'https://name:password@example.com/path?private=yes#secret',title:' Page title ',language:' en ',capturedAt:'2026-10-20T01:02:03+09:00'};
const request={tableId:'crimson-desert',candidates:[]};

test('capture appends sanitized provenance without touching verified rows/settings, retries are idempotent',()=>{
  const original=fixture();original.tables[0].custom={keep:true};original.tables[0].entries[0].custom={keep:true};
  const before=JSON.stringify(original),first=appendCapture(original,{...request,source});
  const table=first.library.tables[0];assert.equal(first.added,0);assert.equal(first.changed,true);assert.equal(table.revision,original.tables[0].revision+1);
  assert.deepEqual(table.captureSources,[{url:'https://example.com/path',title:'Page title',language:'en',capturedAt:'2026-10-19T16:02:03.000Z'}]);
  assert.deepEqual(table.entries,original.tables[0].entries);assert.deepEqual(table.defaults,original.tables[0].defaults);assert.deepEqual(table.custom,{keep:true});assert.equal(JSON.stringify(original),before);
  const retry=appendCapture(first.library,{...request,source});assert.equal(retry.changed,false);assert.equal(retry.library,first.library);
  const second=appendCapture(first.library,{...request,source:{...source,url:'https://example.com/other'}});
  assert.equal(second.library.tables[0].captureSources.length,2);
  const legacy=appendCapture(second.library,request);assert.equal(legacy.changed,false);assert.deepEqual(legacy.library,second.library);
  const update=appendCapture(second.library,{...request,source:{...source,title:'Updated title'}});assert.equal(update.library.tables[0].captureSources.length,2);assert.equal(update.library.tables[0].captureSources[0].title,'Updated title');
});

test('capture provenance rejects unsafe input atomically and enforces source limits',()=>{
  const original=fixture(),before=JSON.stringify(original);
  for(const invalid of [null,[],{}, {...source,url:'file:///private'}, {...source,url:'javascript:alert(1)'},{...source,url:'https://example.com/\nsecret'},{...source,url:'x'.repeat(4097)},{...source,title:'x'.repeat(501)},{...source,language:42},{...source,capturedAt:'yesterday'},{...source,capturedAt:'2026-99-99T00:00:00Z'}]){
    assert.throws(()=>appendCapture(original,{...request,candidates:['must not append'],source:invalid}));assert.equal(JSON.stringify(original),before);
  }
  original.tables[0].captureSources=Array.from({length:50},(_,i)=>({...source,url:'https://example.com/'+i}));
  assert.throws(()=>appendCapture(original,{...request,source}),/50/);
  assert.equal(appendCapture(original,{...request,source:{...source,url:'https://example.com/0'}}).library.tables[0].captureSources.length,50);
});

test('captured origin metadata and empty title/language survive portable and library import/export without rewriting the source',()=>{
  const original=fixture(),captured=appendCapture(original,{...request,source:{url:'https://origin.example/path',title:'',language:'',capturedAt:'2026-10-20T00:00:00Z'}}).library;
  const before=JSON.stringify(captured),sources=captured.tables[0].captureSources;
  const portable=TableImport.exportPortable(captured,request.tableId);
  const imported=TableImport.createNew(original,portable).library.tables.at(-1);
  assert.deepEqual(imported.captureSources,sources);assert.equal(imported.entries[0].en,captured.tables[0].entries[0].en);
  const libraryExport=TableImport.exportJSON(captured);
  assert.deepEqual(TableImport.createNew(original,libraryExport).library.tables.at(-1).captureSources,sources);
  assert.equal(JSON.stringify(captured),before);assert.equal(original.tables[0].captureSources,undefined);
  const withoutSource=appendCapture(original,{...request,candidates:['New original']}).library;
  assert.equal(withoutSource.tables[0].captureSources,undefined);
});

test('HTTP capture persists source-only changes across restart, serves shared assets and narrowly enables extension frames',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'capture-sources-')),dataPath=path.join(dir,'dictionary.json');let server;
  await copyFile(new URL('../extension/data/dictionary.json',import.meta.url),dataPath);const original=await readFile(dataPath,'utf8');
  const start=async()=>{server=await createServer({dataPath});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+server.address().port;};
  const stop=()=>new Promise(resolve=>server.close(resolve));
  const headers={'Content-Type':'application/json','X-Text-Patch-Client':'extension'};
  try{
    let base=await start();const send=body=>fetch(base+'/api/capture',{method:'POST',headers,body:JSON.stringify(body)});
    const first=await send({...request,source});assert.equal(first.status,200);const result=await first.json();
    assert.equal((await send({...request,source:{...source,url:'data:text/plain,bad'}})).status,400);
    assert.equal((await fetch(base+'/api/capture',{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:JSON.stringify({...request,source})})).status,403);
    for(const [file,type] of [['ai-request.js','text/javascript'],['ai-request-ui.js','text/javascript'],['ai-request.css','text/css']]){const response=await fetch(base+'/'+file);assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),new RegExp(type));assert.ok((await response.text()).length>100);}
    const ordinary=await fetch(base),embedded=await fetch(base+'/?embedded=1'),fake=await fetch(base+'/?embedded=https://evil.example');
    assert.match(ordinary.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);assert.match(fake.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
    assert.match(embedded.headers.get('Content-Security-Policy'),/frame-ancestors chrome-extension:/);assert.doesNotMatch(embedded.headers.get('Content-Security-Policy'),/frame-ancestors https?:/);
    await stop();base=await start();assert.deepEqual(await(await fetch(base+'/api/library')).json(),result.library);assert.equal(await readFile(dataPath,'utf8'),original);
  }finally{if(server?.listening)await stop();await rm(dir,{recursive:true,force:true});}
});
