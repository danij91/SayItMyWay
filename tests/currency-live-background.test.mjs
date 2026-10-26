import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {harness} from './background-harness.mjs';
const xml=await readFile(new URL('../extension/data/eurofxref-2026-10-23.xml',import.meta.url),'utf8');
const url='https://example.com/docs/a',origin='https://example.com';
const tick=()=>new Promise(r=>setTimeout(r,0));
async function settle(h){for(let n=0;n<30;n++){const s=await h.send({type:'state',url});if(!s.currencyRates.refreshing)return s;await tick();}throw Error('refresh did not settle');}
test('unused currency stays offline; first activation refreshes and owns only a six hour alarm',async()=>{
 let calls=0;const h=await harness({rules:[]},undefined,null,{fetch:async()=>{calls++;return new Response(xml);}});
 let state=await h.send({type:'state',url});assert.equal(calls,0);assert.equal(state.currencyRates.status,'bundled');assert.equal(h.alarms.size,0);
 h.grants.add(origin+'/*');await h.send({type:'saveCurrency',url,currency:{enabled:true,source:'all',target:'USD'}});state=await settle(h);
 assert.equal(calls,1);assert.equal(state.currencyRates.status,'current');assert.equal(state.page.currencySnapshot.base,'EUR');assert.equal(state.page.currencySnapshot.date,'2026-10-23');assert.equal([...h.alarms.values()][0].periodInMinutes,360);
 await h.send({type:'saveCurrency',url,currency:{enabled:false}});assert.equal(h.alarms.size,0);
});
test('manual refresh is single flight, permits off, and never blocks local changes or state',async()=>{
 let finish,calls=0;const h=await harness({rules:[]},undefined,null,{fetch:async()=>{calls++;return new Promise(r=>finish=r);}});
 const a=h.send({type:'refreshCurrencyRates',url}),b=h.send({type:'refreshCurrencyRates',url});
 for(let n=0;n<20 && !finish;n++)await tick();assert.equal(calls,1);
 const local=await h.send({type:'saveCurrency',url,currency:{enabled:false,source:'KRW',target:'JPY'}});assert.equal(local.page.currency.target,'JPY');assert.equal(local.currencyRates.refreshing,true);
 finish(new Response(xml));const [first,second]=await Promise.all([a,b]);assert.equal(first.currencyRates.status,'current');assert.equal(second.currencyRates.status,'current');assert.equal(h.alarms.size,0);
});
test('content cannot force a refresh or provide a network URL',async()=>{
 let calls=0;const h=await harness({rules:[]},undefined,null,{fetch:async()=>{calls++;return new Response(xml);}});
 const sender={id:'test',tab:{id:1,url},url};assert.equal(await h.send({type:'refreshCurrencyRates',url:'https://attacker.invalid'},sender),undefined);
 await h.send({type:'pageState',url},sender);assert.equal(calls,0);
 await h.send({type:'refreshCurrencyRates',url:'https://attacker.invalid'});assert.equal(calls,1);
});
test('offline manual refresh resolves normal bundled state, then persistent cache survives worker restart',async()=>{
 const h=await harness({rules:[]},undefined,null,{fetch:async()=>{throw Error('offline');}});
 const failed=await h.send({type:'refreshCurrencyRates',url});assert.equal(failed.currencyRates.status,'bundled');assert.equal(failed.currencyRates.error,true);assert.equal(failed.page.currencySnapshot.rates.USD,1.1193);
 const good=await harness({rules:[]},undefined,null,{fetch:async()=>new Response(xml)});await good.send({type:'refreshCurrencyRates',url});
 let calls=0;const restarted=await harness(good.store,undefined,null,{fetch:async()=>{calls++;throw Error('offline');}});
 const state=await restarted.send({type:'state',url});assert.equal(state.currencyRates.status,'current');assert.equal(state.currencyRates.checkedAt,(await good.send({type:'state',url})).currencyRates.checkedAt);assert.equal(calls,0);
});
test('startup recovers enabled scheduling and expired checks while off alarms cannot fetch',async()=>{
 let time=Date.parse('2026-10-26T12:00:00Z'),calls=0;class Clock extends Date{static now(){return time;}}
 const h=await harness({rules:[],currencyPreferences:{[origin]:{enabled:true,source:'all',target:'USD'}}},undefined,null,{Date:Clock,fetch:async()=>{calls++;return new Response(xml);}});
 await settle(h);assert.equal(calls,1);h.alarms.clear();await h.listeners.startup();await settle(h);assert.equal(h.alarms.size,1);assert.equal(calls,1);
 time+=6*60*60*1000;h.listeners.alarm({name:'text-patch-currency-rates'});await tick();await settle(h);assert.equal(calls,2);
 await h.send({type:'saveCurrency',url,currency:{enabled:false}});time+=6*60*60*1000;h.listeners.alarm({name:'text-patch-currency-rates'});await tick();await settle(h);assert.equal(calls,2);assert.equal(h.alarms.size,0);
});
