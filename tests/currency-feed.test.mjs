import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=f=>readFile(new URL('../extension/'+f,import.meta.url),'utf8');
const xml=await source('data/eurofxref-2026-10-23.xml');
async function fixture(){
 const c=vm.createContext({console,AbortController,TextDecoder,TextEncoder,setTimeout,clearTimeout});
 vm.runInContext(await source('currency-rates.js'),c);vm.runInContext(await source('currency-feed.js'),c);
 let time=Date.parse('2026-10-26T12:00:00Z'),fail=false,calls=0,body=xml;const data={};
 const storage={get:async()=>structuredClone(data),set:async patch=>{if(fail)throw Error('quota');Object.assign(data,structuredClone(patch));}};
 const options={storage,now:()=>time,fetch:async()=>{calls++;return new Response(body);}};
 const feed=c.TextPatchCurrencyFeed.create(options);await feed.ready;
 return {feed,options,create:()=>c.TextPatchCurrencyFeed.create(options),setTime:t=>time=Date.parse(t),setBody:v=>body=v,setFailure:v=>fail=v,get calls(){return calls;}};
}
test('latest validated ECB rates persist with a separate successful check time',async()=>{
 const f=await fixture();assert.equal(f.feed.metadata().status,'bundled');await f.feed.refresh();
 assert.equal(f.feed.metadata().status,'current');assert.equal(f.feed.metadata().date,'2026-10-23');assert.equal(f.feed.metadata().checkedAt,'2026-10-26T12:00:00.000Z');
 const restarted=f.create();await restarted.ready;assert.equal(restarted.snapshot().rates.USD,1.1193);assert.equal(restarted.metadata().status,'current');
});
test('malformed, incomplete, duplicate, future and regressing documents never replace fallback',async()=>{
 const bad=[xml.slice(0,-25),xml.replace("currency='USD'","currency='JPY'"),xml.replace(/\s*<Cube currency='USD'[^>]*\/>/,''),xml.replace('2026-10-23','2026-10-27'),xml.replace('2026-10-23','2026-10-22'),xml.replace("rate='1.1193'","rate='NaN'"),xml.replace("rate='1.1193'","rate='0'"),xml.replace('European Central Bank','Other Bank'),xml+'<extra/>',xml.replace('<Cube>', '<Cube base="USD">'),xml.replace('<?xml','<!DOCTYPE x [<!ENTITY y "boom">]><?xml'),xml.replace('</gesmes:Envelope>',' '.repeat(40000)+'</gesmes:Envelope>')];
 for(const body of bad){const f=await fixture();f.setBody(body);await f.feed.refresh();assert.equal(f.feed.metadata().status,'bundled');assert.equal(f.feed.metadata().checkedAt,null);assert.equal(f.feed.metadata().error,true);}
});
test('offline failures keep successful cache and restart retry throttling',async()=>{
 const f=await fixture();await f.feed.refresh();f.setTime('2026-10-26T18:00:00Z');f.setBody('offline');await f.feed.refresh();
 assert.equal(f.feed.metadata().status,'cached');assert.equal(f.feed.metadata().error,true);assert.equal(f.feed.snapshot().rates.USD,1.1193);
 const restarted=f.create();await restarted.ready;await restarted.refresh();assert.equal(f.calls,2);assert.equal(restarted.metadata().status,'cached');
});
test('failed durable attempt or cache commit preserves last good rates without claiming success',async()=>{
 const f=await fixture();f.setFailure(true);await f.feed.refresh();assert.equal(f.calls,0);assert.equal(f.feed.metadata().status,'bundled');
 f.setTime('2026-10-26T12:06:00Z');f.setFailure(false);await f.feed.refresh();
 f.setTime('2026-10-26T12:12:00Z');f.setBody(xml.replace("rate='1.1193'","rate='2'"));
 // Fail only the cache commit through the same storage interface used at runtime.
 const original=f.options.storage.set;f.options.storage.set=async patch=>{if(patch.currencyRateCache)throw Error('quota');return original(patch);};
 await f.feed.refresh();assert.equal(f.feed.snapshot().rates.USD,1.1193);assert.equal(f.feed.metadata().checkedAt,'2026-10-26T12:06:00.000Z');assert.equal(f.feed.metadata().status,'cached');
 const restarted=f.create();await restarted.ready;assert.equal(restarted.snapshot().rates.USD,1.1193);assert.equal(restarted.metadata().error,true);
});
test('concurrent refreshes share one attempt and retries remain bounded across restart',async()=>{
 const f=await fixture();let release;f.options.fetch=()=>new Promise(r=>release=r);
 // Options are dependencies captured when a feed is created.
 const feed=f.create();await feed.ready;const a=feed.refresh(),b=feed.refresh();assert.equal(a,b);await new Promise(r=>setTimeout(r,0));
 assert.equal(feed.metadata().refreshing,true);release(new Response(xml));await a;assert.equal(feed.metadata().refreshing,false);
 await feed.refresh();assert.equal(feed.metadata().checkedAt,'2026-10-26T12:00:00.000Z');
});
test('explicit manual retry bypasses automatic backoff after a short durable abuse cooldown',async()=>{
 const f=await fixture();f.setBody('offline');await f.feed.refresh();f.setBody(xml);f.setTime('2026-10-26T12:00:16Z');
 await f.feed.refreshIfDue();assert.equal(f.calls,1);await f.feed.refresh({manual:true});assert.equal(f.calls,2);assert.equal(f.feed.metadata().status,'current');
 const restarted=f.create();await restarted.ready;await restarted.refresh({manual:true});assert.equal(f.calls,2);
});
test('transport rejection, HTTP failure, oversized stream and timeout retain last good cache',async()=>{
 const cases=[
  async()=>{throw Error('network disconnected');},
  async()=>new Response('server failed',{status:500}),
  async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(20000));controller.enqueue(new Uint8Array(20000));controller.close();}})),
  async()=>new Response('small',{headers:{'content-length':'999999'}}),
  async()=>new Promise(()=>{})
 ];
 for(const fetch of cases){
  const f=await fixture();await f.feed.refresh();f.setTime('2026-10-26T18:00:00Z');
  const feed=f.create();await feed.ready;
  // A fresh worker uses the injected external transport and clock with persisted cache.
  f.options.fetch=fetch;f.options.timeoutMs=5;const failing=f.create();await failing.ready;await failing.refresh();
  assert.equal(failing.metadata().status,'cached');assert.equal(failing.metadata().error,true);assert.equal(failing.metadata().refreshing,false);assert.equal(failing.metadata().checkedAt,'2026-10-26T12:00:00.000Z');assert.equal(failing.snapshot().rates.USD,1.1193);
 }
});
test('request discloses no page data, cookies or referrer and rejects redirects',async()=>{
 const f=await fixture();let request;f.options.fetch=async(url,options)=>{request={url,options};return new Response(xml);};
 const feed=f.create();await feed.refresh();assert.equal(request.url,'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml');
 assert.equal(request.options.credentials,'omit');assert.equal(request.options.referrerPolicy,'no-referrer');assert.equal(request.options.redirect,'error');assert.equal(request.options.body,undefined);assert.equal(request.options.headers,undefined);
});
test('corrupted future attempt timestamps have a bounded restart cooldown',async()=>{
 const f=await fixture();await f.options.storage.set({currencyRateAttempt:{at:Date.parse('2099-01-01'),pending:true}});
 const restarted=f.create();await restarted.ready;await restarted.refresh();assert.equal(f.calls,0);
 f.setTime('2026-10-26T12:05:01Z');await restarted.refresh();assert.equal(f.calls,1);assert.equal(restarted.metadata().status,'current');
});
test('XML declarations and empty elements must be well formed even with otherwise valid data',async()=>{
 for(const body of [xml.replace('version="1.0"',`version='1.0"`),xml.replace("rate='1.1193'/>","rate='1.1193'/ >")]){
  const f=await fixture();f.setBody(body);await f.feed.refresh();assert.equal(f.feed.metadata().error,true);assert.equal(f.feed.metadata().status,'bundled');
 }
});
