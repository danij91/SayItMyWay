import {loadKorean} from './i18n-harness.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const source=f=>readFile(new URL('../extension/'+f,import.meta.url),'utf8');
const settle=()=>new Promise(resolve=>setTimeout(resolve,20));
async function popup({stored={},rates,refresh,read,currencyEnabled=false}={}){
 const d=new JSDOM(await source('popup.html'),{runScripts:'outside-only'}),calls=[],listeners=[],messages=[],writes=[];
 loadKorean(d.window);for(const f of ['shared.js','library.js'])d.window.eval(await source(f));
 const state={library:{tables:[]},rules:[],page:{table:null,enabled:false,currency:{enabled:currencyEnabled,source:'auto',target:'USD'}},currencyRates:rates};
 d.window.chrome={runtime:{onMessage:{addListener:fn=>messages.push(fn)},getURL:p=>p,sendMessage:async m=>{calls.push(m);if(m.type==='collectionState')return {collection:null};if(m.type==='refreshCurrencyRates')return refresh();return structuredClone(state);}},tabs:{query:async()=>[{id:1,url:'https://example.com'}]},storage:{local:{get:read || (async()=>structuredClone(stored)),set:async value=>{writes.push(value);Object.assign(stored,value);}},onChanged:{addListener:fn=>listeners.push(fn)}}};
 for(const f of ['site-list.js','import-ui.js','popup.js'])d.window.eval(await source(f));await settle();
 return {d,calls,writes,$:id=>d.window.document.getElementById(id),notify:changes=>listeners.forEach(fn=>fn(changes,'local')),message:m=>messages.forEach(fn=>fn(m)),state};
}
test('popup bottom currency controls stay available without table and send independent preference changes',async()=>{
 const d=new JSDOM(await source('popup.html'),{runScripts:'outside-only'}),calls=[];
 try{
 loadKorean(d.window);for(const f of ['shared.js','library.js'])d.window.eval(await source(f));
 const state={library:{tables:[]},rules:[],page:{table:null,enabled:false,currency:{enabled:false,source:'auto',target:'USD'}}};
 d.window.chrome={runtime:{getURL:p=>p,sendMessage:async m=>{calls.push(m);if(m.type==='collectionState')return {collection:null};if(m.type==='activateCurrency')state.page.currency={...m.currency,enabled:true};if(m.type==='saveCurrency')state.page.currency=m.currency;return structuredClone(state);}},tabs:{query:async()=>[{id:1,url:'https://example.com'}]},storage:{onChanged:{addListener(){}}}};
 for(const f of ['site-list.js','import-ui.js','popup.js'])d.window.eval(await source(f));await new Promise(r=>setTimeout(r,30));
 const $=id=>d.window.document.getElementById(id);
 assert.equal($('enabled').disabled,true);assert.equal($('currency-enabled').disabled,false);assert.equal($('currency-enabled').getAttribute('role'),'switch');
 assert.equal($('main-view').lastElementChild.id,'currency-section');
 assert.equal($('currency-body').hidden,true);
 assert.equal($('currency-expand').getAttribute('aria-expanded'),'false');
 $('currency-expand').click();
 assert.equal($('currency-body').hidden,false);
 assert.equal(calls.some(m=>m.type==='refreshCurrencyRates'),false);
 $('currency-source').value='KRW';$('currency-source').dispatchEvent(new d.window.Event('change'));await new Promise(r=>setTimeout(r,10));
 assert.equal(calls.findLast(m=>m.type==='saveCurrency').currency.source,'KRW');
 $('currency-enabled').click();await new Promise(r=>setTimeout(r,10));
 assert.equal(calls.findLast(m=>m.type==='activateCurrency').currency.target,'USD');assert.equal($('currency-enabled').checked,true);
 $('currency-enabled').click();await new Promise(r=>setTimeout(r,10));assert.equal(calls.at(-1).type,'saveCurrency');assert.equal(calls.at(-1).currency.enabled,false);
 assert.equal($('currency-body').hidden,false);
 }finally{d.window.close();}
});
test('expansion survives popup reopen without changing currency preferences or fetching rates',async()=>{
 const stored={};let p=await popup({stored});
 try{p.$('currency-expand').click();await settle();assert.equal(stored.currencyPanelExpanded,true);assert.equal(p.calls.some(m=>['refreshCurrencyRates','saveCurrency','activateCurrency'].includes(m.type)),false);}finally{p.d.window.close();}
 p=await popup({stored});try{assert.equal(p.$('currency-body').hidden,false);assert.equal(p.$('currency-enabled').checked,false);p.$('currency-expand').click();await settle();assert.equal(stored.currencyPanelExpanded,false);}finally{p.d.window.close();}
});
test('both disclosures default closed and independently retain open and closed states across reopen',async()=>{
 const stored={};let p=await popup({stored});
 try{
  assert.equal(p.$('sites-list').open,false);assert.equal(p.$('currency-body').hidden,true);
  p.$('sites-list').querySelector('summary').click();await settle();
  assert.equal(p.$('sites-list').open,true);assert.equal(p.$('currency-body').hidden,true);
 }finally{p.d.window.close();}
 p=await popup({stored});
 try{
  assert.equal(p.$('sites-list').open,true);assert.equal(p.$('currency-body').hidden,true);
  p.$('currency-expand').click();await settle();
  assert.equal(p.$('sites-list').open,true);assert.equal(p.$('currency-enabled').checked,false);
 }finally{p.d.window.close();}
 p=await popup({stored});
 try{
  assert.equal(p.$('sites-list').open,true);assert.equal(p.$('currency-body').hidden,false);
  p.$('sites-list').querySelector('summary').click();await settle();
  assert.equal(p.$('currency-body').hidden,false);
 }finally{p.d.window.close();}
 p=await popup({stored});
 try{
  assert.equal(p.$('sites-list').open,false);assert.equal(p.$('currency-body').hidden,false);
  p.$('currency-expand').click();await settle();
 }finally{p.d.window.close();}
 p=await popup({stored});
 try{
  assert.equal(p.$('sites-list').open,false);assert.equal(p.$('currency-body').hidden,true);
  assert.equal(p.calls.some(m=>['refreshCurrencyRates','saveCurrency','activateCurrency'].includes(m.type)),false);
 }finally{p.d.window.close();}
});
for(const expanded of [false,true])test('restoring '+(expanded?'open':'closed')+' disclosures does not write preferences or change enabled currency',async()=>{
 const stored={sitesPanelExpanded:expanded,currencyPanelExpanded:expanded};
 const p=await popup({stored,currencyEnabled:true});
 try{
  assert.equal(p.$('sites-list').open,expanded);assert.equal(p.$('currency-body').hidden,!expanded);
  assert.equal(p.$('currency-enabled').checked,true);assert.equal(p.writes.length,0);
  p.notify({sitesPanelExpanded:{newValue:!expanded}});await settle();
  assert.equal(p.$('sites-list').open,!expanded);assert.equal(p.$('currency-body').hidden,!expanded);
  p.notify({currencyPanelExpanded:{newValue:!expanded}});await settle();
  assert.equal(p.$('sites-list').open,!expanded);assert.equal(p.$('currency-body').hidden,expanded);
  assert.equal(p.$('currency-enabled').checked,true);assert.equal(p.writes.length,0);
  assert.equal(p.calls.some(m=>['refreshCurrencyRates','saveCurrency','activateCurrency'].includes(m.type)),false);
 }finally{p.d.window.close();}
});
for(const clicks of [1,2])test('delayed storage read cannot overwrite '+clicks+' disclosure click(s)',async()=>{
 let complete;const pending=new Promise(resolve=>complete=resolve),stored={};
 const p=await popup({stored,read:()=>pending});
 try{
  assert.equal(p.$('sites-list').open,false);assert.equal(p.$('currency-body').hidden,true);assert.equal(p.writes.length,0);
  for(let i=0;i<clicks;i++){p.$('sites-list').querySelector('summary').click();p.$('currency-expand').click();}
  // Resolve before the queued details toggle event to exercise the gesture race.
  complete({sitesPanelExpanded:clicks===2,currencyPanelExpanded:clicks===2});await settle();
  assert.equal(p.$('sites-list').open,clicks===1);assert.equal(p.$('currency-body').hidden,clicks===2);
  assert.equal(stored.sitesPanelExpanded,clicks===1);assert.equal(stored.currencyPanelExpanded,clicks===1);
  const reopened=await popup({stored});
  try{assert.equal(reopened.$('sites-list').open,clicks===1);assert.equal(reopened.$('currency-body').hidden,clicks===2);assert.equal(reopened.writes.length,0);}finally{reopened.d.window.close();}
 }finally{p.d.window.close();}
});
test('storage notifications supersede a pending initial disclosure read without writing back',async()=>{
 let complete;const pending=new Promise(resolve=>complete=resolve);
 const p=await popup({read:()=>pending});
 try{
  p.notify({sitesPanelExpanded:{newValue:true},currencyPanelExpanded:{newValue:true}});
  complete({sitesPanelExpanded:false,currencyPanelExpanded:false});await settle();
  assert.equal(p.$('sites-list').open,true);assert.equal(p.$('currency-body').hidden,false);assert.equal(p.writes.length,0);
 }finally{p.d.window.close();}
});
test('manual refresh exposes pending state and retains cached failure metadata and dynamic date',async()=>{
 let complete;const pending=new Promise(resolve=>complete=resolve);
 const rates={date:'2026-10-22',checkedAt:null,status:'bundled',refreshing:false,error:false};
 const p=await popup({rates,refresh:()=>pending});
 try{
  p.$('currency-expand').click();assert.match(p.$('currency-note').textContent,/2026-10-22/);assert.match(p.$('currency-rate-status').textContent,/기본 제공/);
  p.$('currency-refresh').click();assert.equal(p.$('currency-refresh').disabled,true);assert.equal(p.$('currency-refresh').getAttribute('aria-busy'),'true');assert.ok(p.$('currency-refresh').getAttribute('aria-label'));
  p.$('currency-refresh').click();assert.equal(p.calls.filter(m=>m.type==='refreshCurrencyRates').length,1);
  complete({...p.state,currencyRates:{...rates,date:'2026-10-23',status:'cached',error:true}});await settle();
  assert.match(p.$('currency-note').textContent,/2026-10-23/);assert.match(p.$('currency-rate-status').textContent,/저장된 환율.*실패/);assert.equal(p.$('currency-refresh').disabled,false);assert.equal(p.$('currency-body').hidden,false);
 }finally{p.d.window.close();}
});
test('background rate storage notifications update an open popup',async()=>{
 const p=await popup({rates:{date:'2026-10-22',status:'bundled'}});
 try{p.state.currencyRates={date:'2026-10-23',status:'current',refreshing:false,error:false};p.notify({currencyRateCache:{newValue:{}}});await settle();assert.match(p.$('currency-note').textContent,/2026-10-23/);assert.equal(p.$('currency-rate-status').hidden,true);}finally{p.d.window.close();}
});
test('runtime rate notifications show refresh progress even without a storage write',async()=>{
 const p=await popup({rates:{date:'2026-10-23',status:'cached',refreshing:false,error:false}});
 try{p.state.currencyRates.refreshing=true;p.message({type:'currencyRatesChanged'});await settle();assert.equal(p.$('currency-refresh').disabled,true);p.state.currencyRates.refreshing=false;p.state.currencyRates.error=true;p.message({type:'currencyRatesChanged'});await settle();assert.equal(p.$('currency-refresh').disabled,false);assert.match(p.$('currency-rate-status').textContent,/실패/);}finally{p.d.window.close();}
});
test('a later successful background refresh clears a previous popup transport failure',async()=>{
 const p=await popup({rates:{date:'2026-10-23',status:'cached',error:false},refresh:async()=>{throw Error('disconnected');}});
 try{
  p.$('currency-expand').click();p.$('currency-refresh').click();await settle();assert.match(p.$('currency-rate-status').textContent,/실패/);
  p.state.currencyRates={date:'2026-10-23',status:'current',checkedAt:'2026-10-26T12:00:00Z',error:false,refreshing:false};p.message({type:'currencyRatesChanged'});await settle();assert.equal(p.$('currency-rate-status').hidden,true);
 }finally{p.d.window.close();}
});
