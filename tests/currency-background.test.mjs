import {harness} from './background-harness.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
test('currency persists without a table, requests on gesture and survives popup disposal',async()=>{
 const h=await harness({rules:[]});let resolveRequest;
 h.setRequest(()=>new Promise(r=>resolveRequest=r));
 const request=h.send({type:'activateCurrency',url:'https://example.com/docs/a',currency:{source:'KRW',target:'USD'}});
 for(let n=0;n<20 && !h.store.currencyPreferences;n++)await new Promise(r=>setTimeout(r,5));
 assert.equal(h.store.currencyPreferences['https://example.com'].enabled,true);
 assert.equal((await h.send({type:'state',url:'https://example.com/docs/a'})).page.currency.enabled,false);
 h.grants.add('https://example.com/*');h.listeners.added({origins:['https://example.com/*']});
 const state=await h.send({type:'state',url:'https://example.com/docs/a'});
 assert.equal(state.page.currency.enabled,true);assert.equal(state.page.enabled,false);assert.equal(state.page.table,null);
 assert.ok(h.registrations.some(r=>r.matches.includes('https://example.com/*')));
 resolveRequest(true);await request;
 const restarted=await harness(h.store);restarted.grants.add('https://example.com/*');
 assert.equal((await restarted.send({type:'state',url:'https://example.com/other'})).page.currency.source,'KRW');
 await restarted.send({type:'saveCurrency',url:'https://example.com',currency:{enabled:false,source:'all',target:'JPY'}});
 assert.equal((await restarted.send({type:'state',url:'https://example.com'})).page.currency.enabled,false);
 assert.equal(restarted.store.rules.length,0);
});
test('denied currency activation and stale permission replies cannot enable a later disabled preference',async()=>{
 const h=await harness({rules:[]});h.setRequest(()=>Promise.resolve(false));
 await h.send({type:'activateCurrency',url:'https://example.com',currency:{source:'all',target:'USD'}});
 assert.equal(h.store.currencyPreferences['https://example.com'].enabled,false);
 assert.ok((await h.send({type:'saveCurrency',url:'https://example.com',currency:{enabled:true,source:'BAD',target:'USD'}})).error);
});
test('a late denied permission reply cannot overwrite a newer currency preference',async()=>{
 const h=await harness({rules:[]});let finish;
 h.setRequest(()=>new Promise(r=>finish=r));
 const pending=h.send({type:'activateCurrency',url:'https://example.com',currency:{source:'all',target:'USD'}});
 for(let n=0;n<20 && !h.store.currencyPreferences;n++)await new Promise(r=>setTimeout(r,5));
 await h.send({type:'saveCurrency',url:'https://example.com',currency:{enabled:false,source:'KRW',target:'JPY'}});
 finish(false);await pending;
 assert.equal(h.store.currencyPreferences['https://example.com'].enabled,false);
 assert.equal(h.store.currencyPreferences['https://example.com'].source,'KRW');assert.equal(h.store.currencyPreferences['https://example.com'].target,'JPY');
});
