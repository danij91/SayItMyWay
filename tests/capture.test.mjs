import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const source=f=>readFile(new URL('../extension/'+f,import.meta.url),'utf8');
const tick=ms=>new Promise(r=>setTimeout(r,ms));
async function content(html){
 const d=new JSDOM(html,{url:'https://new.example/page',runScripts:'outside-only'});
 let listener;
 d.window.chrome={runtime:{id:'test',getManifest:()=>({version:'0.4.0'}),sendMessage:async()=>({enabled:false}),onMessage:{addListener:fn=>listener=fn}},storage:{onChanged:{addListener:()=>{}}}};
 for(const f of ['shared.js','library.js','engine.js','content.js'])d.window.eval(await source(f));
 await tick(0);
 return {d,send:m=>new Promise(resolve=>{const result=listener(m,{id:'test'},resolve);if(result!==true)resolve(undefined);})};
}

test('capture status is read-only before a scan and identifies the current watching session',async()=>{
 const {d,send}=await content('<body><p>Before status</p></body>');
 try{
  const idle=await send({type:'captureStatus'});assert.equal(idle.active,false);assert.equal(idle.sessionId,null);
  d.window.document.body.innerHTML='<p>After status</p>';
  const first=await send({type:'captureRead'});assert.deepEqual(Array.from(first.candidates),['After status']);assert.equal(first.scans,1);
  await send({type:'captureStart',sessionId:'watch-session'});
  let status=await send({type:'captureStatus'});assert.equal(status.active,true);assert.equal(status.sessionId,'watch-session');assert.equal(status.documentId,first.documentId);
  const report=await send({type:'captureRead'});assert.equal(report.scans,1);
  d.window.history.pushState({},'','/next');status=await send({type:'captureStatus'});assert.equal(status.active,false);assert.equal(status.newPage,true);
 }finally{d.window.close();}
});
test('capture returns deduplicated visible originals and replacement log through Chrome messages',async()=>{
 const {d,send}=await content('<body><b>Alpha</b><b> Alpha </b><span>123</span><input value="Secret"><textarea>Secret</textarea><p contenteditable>Secret</p><p hidden>Secret</p><p style="display:none">Secret</p><p data-private>Secret</p><p>New source</p></body>');
 try{
  const entry={id:'a',en:'Alpha',ko:'대체문',kind:'general',category:'일반',context:'global',selector:'',status:'verified',source:'사용자 확인: 테스트',evidence:'테스트',notes:''};
  await send({type:'applyState',state:{enabled:true,table:{schemaVersion:1,revision:1,entries:[entry]}}});
  const r=await send({type:'captureRead'});
  assert.deepEqual(Array.from(r.candidates),['Alpha','New source']);
  assert.equal(r.log[0].original,'Alpha');assert.equal(r.log[0].replacement,'대체문');
  assert.equal(r.active,false);assert.equal(r.scans,1);
 }finally{d.window.close();}
});

test('capture read includes page title and declared language without input content',async()=>{
 const {d,send}=await content('<html lang="fr"><head><title>Page title</title></head><body><p>Visible</p><input value="private"></body></html>');
 try{
  const report=await send({type:'captureRead',fresh:true});
  assert.equal(report.title,'Page title');assert.equal(report.language,'fr');
  assert.deepEqual(Array.from(report.candidates),['Visible']);
 }finally{d.window.close();}
});

test('dynamic capture unions new menus, stops collecting, and flags SPA navigation',async()=>{
 const {d,send}=await content('<body><p>First</p><p id="menu" hidden>Menu</p></body>');
 try{
  let r=await send({type:'captureStart'});assert.equal(r.active,true);
  d.window.document.querySelector('#menu').hidden=false;
  await tick(1100);
  r=await send({type:'captureRead'});assert.deepEqual(Array.from(r.candidates),['First','Menu']);
  const scans=r.scans;await send({type:'captureRead'});assert.equal((await send({type:'captureRead'})).scans,scans);
  await send({type:'captureStop'});
  d.window.document.body.insertAdjacentHTML('beforeend','<p>Stopped</p>');await tick(1100);
  r=await send({type:'captureRead'});assert.equal(r.active,false);assert.ok(!r.candidates.includes('Stopped'));
  await send({type:'captureStart'});
  d.window.history.pushState({},'','/other');await tick(300);
  r=await send({type:'captureRead'});assert.equal(r.active,false);assert.match(r.reason,/페이지 이동/);
  const oldId=r.documentId;
  d.window.document.body.innerHTML='<p>Other page</p>';
  r=await send({type:'captureRead',resetForPage:true});
  assert.notEqual(r.documentId,oldId);assert.equal(r.url,'https://new.example/other');
  assert.deepEqual(Array.from(r.candidates),['Other page']);
  d.window.history.pushState({},'','/third');
  await send({type:'captureRead',resetForPage:true});await tick(300);
  assert.equal((await send({type:'captureRead'})).newPage,false);
 }finally{d.window.close();}
});

test('dynamic collection coalesces bursts and automatically stops at its full-scan budget',async()=>{
 const {d,send}=await content('<body><p>First</p></body>');
 const timers=[];
 const originalTimeout=d.window.setTimeout.bind(d.window);
 d.window.setTimeout=(fn,delay,...args)=>delay===1000 ? (timers.push(fn),10000+timers.length) : originalTimeout(fn,delay,...args);
 try{
  await send({type:'captureStart'});
  for(let n=0;n<19;n++){
   for(let burst=0;burst<3;burst++)d.window.document.body.insertAdjacentHTML('beforeend',`<p>Menu ${n}</p>`);
   await tick(0);
   assert.equal(timers.length,1);
   timers.shift()();
  }
  const r=await send({type:'captureRead'});
  assert.equal(r.scans,20);assert.equal(r.active,false);assert.match(r.reason,/20회 제한/);
  assert.equal(r.candidates.length,20);
  d.window.document.body.insertAdjacentHTML('beforeend','<p>After budget</p>');await tick(0);
  assert.equal(timers.length,0);assert.equal((await send({type:'captureRead'})).scans,20);
 }finally{d.window.close();}
});

test('initial capture limits exported candidates to 5,000 without hiding the limit',async()=>{
 const {d,send}=await content('<body>'+Array.from({length:5002},(_,n)=>`<p>Source ${n}</p>`).join('')+'</body>');
 try{
  const r=await send({type:'captureStart'});
  assert.equal(r.candidates.length,5000);assert.equal(r.active,false);assert.match(r.reason,/5,000개 제한/);
 }finally{d.window.close();}
});

test('large originals stop within the persisted session and HTTP payload budget without truncating text',async()=>{
 const texts=Array.from({length:40},(_,n)=>'Original '+n+' '+ 'x'.repeat(19000));
 const {d,send}=await content('<body>'+texts.map(t=>'<p>'+t+'</p>').join('')+'</body>');
 try{
  const r=await send({type:'captureStart'});assert.equal(r.active,false);assert.match(r.reason,/용량 제한/);
  assert.ok(r.candidates.length>0 && r.candidates.length<40);assert.equal(r.candidates[0],texts[0]);assert.ok(JSON.stringify(r.candidates).length<501000);
 }finally{d.window.close();}
});

