import {loadKorean} from './i18n-harness.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,readFile,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {JSDOM} from 'jsdom';
import {createServer} from '../server.mjs';
import http from 'node:http';

test('capture HTTP appends latest state, survives restart and deduplicates without writes',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'capture-api-')),dataPath=path.join(dir,'dictionary.json');
  await copyFile(new URL('../extension/data/dictionary.json',import.meta.url),dataPath);
  const original=await readFile(dataPath,'utf8');let server,base;
  const start=async()=>{server=await createServer({dataPath});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;};
  const stop=()=>new Promise(r=>server.close(r));
  const get=async()=>await(await fetch(base+'/api/library')).json();
  const capture=(body,extra={})=>fetch(base+'/api/capture',{method:'POST',headers:{'Content-Type':'application/json','X-Text-Patch-Client':'extension',...extra},body:JSON.stringify(body)});
  try{
    await start();const initial=await get();assert.equal(initial.tables[0].entries.length,147);
    const body={tableId:'captured',createName:'수집 표',candidates:[' New   row ','new row','','Second']};
    let response=await capture(body);assert.equal(response.status,200);let result=await response.json();
    assert.equal(result.added,2);assert.equal(result.total,2);assert.deepEqual(result.library.tables[0],initial.tables[0]);
    const rows=result.library.tables[1].entries;assert.equal(rows[0].en,'New row');
    for(const row of rows){assert.equal(row.ko,'');assert.equal(row.status,'untranslated');assert.equal(row.evidence,'');}
    const manifest=await readFile(path.join(dir,'library.json'),'utf8'),files=await readdir(path.join(dir,'tables'));
    result=await(await capture({...body,createName:'덮어쓰기 금지'})).json();assert.equal(result.added,0);assert.equal(result.library.tables[1].name,'수집 표');
    assert.equal(await readFile(path.join(dir,'library.json'),'utf8'),manifest);assert.deepEqual(await readdir(path.join(dir,'tables')),files);
    const edited=await get();edited.tables[1].entries[0].ko='편집';edited.tables[1].entries[0].status='review';edited.tables[1].entries[0].notes='보존';edited.tables[1].entries[0].custom={keep:true};
    edited.tables[1].defaults.caseSensitive=true;edited.tables[1].entries[1].caseSensitive=false;
    assert.equal((await fetch(base+'/api/library',{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(edited)})).status,200);
    const latest=await get();result=await(await capture({tableId:'captured',candidates:['New row','SECOND','new row','Third']})).json();
    assert.equal(result.added,2);assert.deepEqual(result.library.tables[1].entries.slice(0,2),latest.tables[1].entries);
    assert.equal((await fetch(base+'/api/library',{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(latest)})).status,409);
    const final=result.library;await stop();await start();assert.deepEqual(await get(),final);
    result=await(await capture({tableId:'captured',candidates:['Third']})).json();assert.equal(result.added,0);assert.deepEqual(result.library,final);
    assert.equal(await readFile(dataPath,'utf8'),original);
  }finally{if(server?.listening)await stop();await rm(dir,{recursive:true,force:true});}
});

test('capture admits only deliberate extension JSON requests, rejects web Origins/preflight/invalid input',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'capture-auth-')),dataPath=path.join(dir,'dictionary.json');
  await copyFile(new URL('../extension/data/dictionary.json',import.meta.url),dataPath);
  const server=await createServer({dataPath});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const body=JSON.stringify({tableId:'crimson-desert',candidates:[]});
  const headers={'Content-Type':'application/json','X-Text-Patch-Client':'extension'};
  try{
    const initial=await(await fetch(base+'/api/library')).json();
    for(const extra of [{Origin:'https://evil.example'},{Origin:base},{Origin:'null'},{Origin:'chrome-extension://invalid'},{'X-Text-Patch-Client':''},{'Content-Type':'text/plain'}]){
      const res=await fetch(base+'/api/capture',{method:'POST',headers:{...headers,...extra},body});assert.equal(res.status,403);assert.equal(res.headers.get('Access-Control-Allow-Origin'),null);
    }
    const hostStatus=await new Promise((resolve,reject)=>{const req=http.request(base+'/api/capture',{method:'POST',headers:{...headers,Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end(body);});assert.equal(hostStatus,403);
    const preflight=await fetch(base+'/api/capture',{method:'OPTIONS',headers:{Origin:'https://evil.example','Access-Control-Request-Headers':'x-text-patch-client'}});assert.equal(preflight.status,404);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),null);
    for(const Origin of [undefined,'chrome-extension://'+'a'.repeat(32)]){const h={...headers};if(Origin)h.Origin=Origin;assert.equal((await fetch(base+'/api/capture',{method:'POST',headers:h,body})).status,200);}
    for(const input of ['{',JSON.stringify({tableId:'missing',candidates:[]}),JSON.stringify({tableId:'bad/id',createName:'name',candidates:[]}),JSON.stringify({tableId:'crimson-desert',candidates:[42]}),JSON.stringify({tableId:'crimson-desert',candidates:['x'.repeat(20001)]})])assert.equal((await fetch(base+'/api/capture',{method:'POST',headers,body:input})).status,400);
    assert.equal((await fetch(base+'/api/capture',{method:'POST',headers,body:' '.repeat(5_000_001)})).status,413);
    assert.equal((await fetch(base+'/api/library',{method:'PUT',headers,body:JSON.stringify(initial)})).status,403);
    assert.deepEqual(await(await fetch(base+'/api/library')).json(),initial);
  }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});

test('unified editor opens captured table by URL, edits blank rows and copies safe AI requests',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'capture-editor-')),dataPath=path.join(dir,'dictionary.json');
  await copyFile(new URL('../extension/data/dictionary.json',import.meta.url),dataPath);
  const server=await createServer({dataPath});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;let dom;
  try{
    await fetch(base+'/api/capture',{method:'POST',headers:{'Content-Type':'application/json','X-Text-Patch-Client':'extension'},body:JSON.stringify({tableId:'capture-ui',createName:'수집 편집',candidates:['<img src=x onerror=alert(1)>','Next row']})});
    dom=new JSDOM(await(await fetch(base+'/?table=capture-ui')).text(),{url:base+'/?table=capture-ui',runScripts:'outside-only'});
    const w=dom.window,$=s=>w.document.querySelector(s);loadKorean(w);w.structuredClone=structuredClone;
    w.fetch=(url,options={})=>fetch(new URL(url,base),{...options,headers:{...options.headers,...(options.method?{Origin:base}:{})}});
    w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
    let clipboard='';Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async value=>{clipboard=value;}}});
    for(const file of ['/shared.js','/library.js','/import.js','/ai-request.js','/ai-request-ui.js','/transport.js','/app.js']){const res=await fetch(base+file);assert.equal(res.status,200);w.eval(await res.text());}
    const until=async predicate=>{for(let i=0;i<150;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('UI timeout');};
    await until(()=>$('#table-select').value==='capture-ui');assert.equal($('#rows').querySelector('img'),null);assert.match($('#counts').textContent,/미작성: 2/);
    $('#rows button').click();$('#form').elements.ko.value='편집된 대체문';$('#form').elements.status.value='review';$('#form').dispatchEvent(new w.Event('submit',{cancelable:true}));await until(()=>!$('#editor').open);
    assert.equal((await(await fetch(base+'/api/library')).json()).tables.find(t=>t.id==='capture-ui').entries[0].ko,'');
    await $('#save-all').onclick();
    const saved=await(await fetch(base+'/api/library')).json(),table=saved.tables.find(t=>t.id==='capture-ui');assert.equal(table.entries[0].ko,'편집된 대체문');
    for(const task of ['translation','replacement']){
      await $('#ai-request').onclick();
      const dialog=$('[data-ai-dialog]'),control=name=>dialog.querySelector('[data-ai="'+name+'"]');
      control('task').value=task;control('task').dispatchEvent(new w.Event('input'));
      control('targetLanguage').value='English';control('instruction').value='간결하게';
      await control('copy').onclick();
      assert.ok(clipboard.includes(task==='replacement'?'간결하게':'English'));
      assert.match(clipboard,/verified/);assert.match(clipboard,/신뢰할 수 없는/);
      const payload=JSON.parse(clipboard.split('--- JSON 데이터 시작 ---\n\n')[1].split('\n\n--- JSON 데이터 끝 ---')[0]);
      assert.deepEqual(payload.entries.map(e=>e.original),[table.entries[1].en]);
      assert.equal(payload.entries[0].replacement,'');
      assert.equal(payload.entries[0].en,undefined);assert.equal(payload.entries[0].ko,undefined);
      assert.equal(payload.format,'text-patch-table');assert.equal(payload.version,2);
      assert.equal(payload.entries[0].id,undefined);assert.equal(payload.id,undefined);
      assert.equal(payload.excludedTerms,undefined);assert.equal(payload.excludedCategories,undefined);
      control('close').click();
    }
    assert.ok($('#import-open'));assert.ok($('#export-current'));
  }finally{dom?.window.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
