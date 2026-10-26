import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const source=f=>readFile(new URL('../extension/'+f,import.meta.url),'utf8');
async function fixture(html='<p>Price 1200원</p>'){
 const d=new JSDOM('<body>'+html+'</body>',{runScripts:'outside-only'});
 for(const f of ['shared.js','currency-rates.js','currency.js','engine.js'])d.window.eval(await source(f));
 return d;
}
test('fixed currency interface converts all four KRW forms and preserves unsupported amounts',async()=>{
 const d=await fixture();try{
 const fx=d.window.TextPatchCurrency;
 const convert=s=>fx.spans(s,{enabled:true,source:'all',target:'USD'}).reduceRight((s,m)=>s.slice(0,m.start)+m.replacement+s.slice(m.end),s);
 assert.equal(convert('1200원 / 1,200원 / 1,200 원 / 1200 원'),'$0.91 / $0.91 / $0.91 / $0.91');
 assert.equal(convert('USD 10 / $10 / ¥100 / 123 / KRW 1,20,0'),'USD 10 / $10 / ¥100 / 123 / KRW 1,20,0');
 }finally{d.window.close();}
});
test('currency modes resolve only compatible symbols and unique explicit metadata',async()=>{
 const d=await fixture('<meta property="product:price:currency" content="CAD">');try{
 const fx=d.window.TextPatchCurrency,convert=(s,source,target='USD',metadata=null)=>fx.spans(s,{enabled:true,source,target},metadata).reduceRight((s,m)=>s.slice(0,m.start)+m.replacement+s.slice(m.end),s);
 assert.equal(convert('$10 / ¥100 / 1200원','all'),'$10 / ¥100 / $0.91');
 assert.equal(convert('$10 / US$10 / C$10','CAD'),'$7.15 / US$10 / $7.15');
 assert.equal(convert('$10','auto','USD',fx.pageCurrency(d.window.document)),'$7.15');
 d.window.document.body.insertAdjacentHTML('beforeend','<meta itemprop="priceCurrency" content="USD">');
 assert.equal(fx.pageCurrency(d.window.document),null);assert.equal(convert('$10','auto'),'$10');
 assert.equal(convert('EUR 1,234.56 / EUR 1.234,56 / -1200원','all'),'$1,381.84 / $1,381.84 / -$0.91');
 assert.match(convert('EUR 1','all','JPY'),/^JPY\s176$/);assert.match(convert('EUR 1','all','KRW'),/^KRW\s1,482$/);
 for(const s of ['KRW 1,200,','KRW 1..200','KRW 1.200','12,34,567원','xUSD 10','USD 10abc'])assert.equal(convert(s,'all'),s);
 }finally{d.window.close();}
});
test('shared DOM ownership renders independent toggles from originals and restores external changes',async()=>{
 const d=await fixture('<p>Price 1200원</p><p id="overlap">1200원</p><input value="1200원"><div contenteditable="true">1200원</div><pre>1200원</pre>');try{
 const doc=d.window.document,t=new d.window.CrimsonTranslator(doc),base={schemaVersion:1,revision:1,entries:[{id:'p',en:'Price',ko:'Cost USD 10',matchMode:'word'},{id:'o',en:'1200원',ko:'TABLE'}]};
 base.entries=base.entries.map(e=>({kind:"general",category:"test",context:"global",selector:"",status:"verified",source:"fixture",evidence:"fixture",notes:"",...e}));
 t.setData(base);t.setEnabled(false);t.setCurrency({enabled:true,source:'all',target:'USD'});
 assert.equal(doc.querySelector('p').textContent,'Price $0.91');assert.equal(doc.querySelector('#overlap').textContent,'$0.91');
 t.setEnabled(true);assert.equal(doc.querySelector('p').textContent,'Cost USD 10 $0.91');
 assert.ok(t.collectCandidates().includes('Price 1200원'));assert.equal(t.inspectText(doc.querySelector('p').firstChild).original,'Price 1200원');
 t.setCurrency({enabled:false});assert.equal(doc.querySelector('p').textContent,'Cost USD 10 1200원');assert.equal(doc.querySelector('#overlap').textContent,'TABLE');
 t.setCurrency({enabled:true,source:'all',target:'USD'});t.setEnabled(false);assert.equal(doc.querySelector('p').textContent,'Price $0.91');
 const added=doc.createElement('p');added.textContent='New 1200원';doc.body.append(added);await new Promise(r=>setTimeout(r,30));assert.equal(added.textContent,'New $0.91');
 added.firstChild.data='New 2400원';t.setCurrency({enabled:false});assert.equal(added.textContent,'New 2400원');
 assert.equal(doc.querySelector('input').value,'1200원');assert.equal(doc.querySelector('[contenteditable]').textContent,'1200원');assert.equal(doc.querySelector('pre').textContent,'1200원');
 t.setCurrency({enabled:true,source:'all',target:'USD'});doc.querySelector('p').contentEditable='true';doc.querySelector('p').setAttribute('contenteditable','true');await new Promise(r=>setTimeout(r,30));assert.equal(doc.querySelector('p').textContent,'Price 1200원');
 t.setCurrency({enabled:false});assert.equal(doc.querySelector('#overlap').textContent,'1200원');
 }finally{d.window.close();}
});
test('dual labels, spaced grouping and punctuation never produce partial prices',async()=>{
 const d=await fixture();try{
 const fx=d.window.TextPatchCurrency,convert=s=>fx.spans(s,{enabled:true,source:'all',target:'USD'}).reduceRight((s,m)=>s.slice(0,m.start)+m.replacement+s.slice(m.end),s);
 for(const s of ['₩1,200원','USD 10 EUR','$10 USD','1 200원','KRW 1 200'])assert.equal(convert(s),s);
 assert.equal(convert('1200원, next'),'$0.91, next');
 assert.equal(convert('1200원 2개'),'$0.91 2개');
 }finally{d.window.close();}
});
test('auto updates unique head metadata, conflicting metadata and removed metadata with the same observer',async()=>{
 const d=await fixture('<p>$10</p>');try{
 const doc=d.window.document,t=new d.window.CrimsonTranslator(doc);t.setEnabled(false);t.setCurrency({enabled:true,source:'auto',target:'USD'});
 assert.equal(doc.querySelector('p').textContent,'$10');
 const meta=doc.createElement('meta');meta.setAttribute('property','product:price:currency');meta.content='CAD';doc.head.append(meta);await new Promise(r=>setTimeout(r,25));assert.equal(doc.querySelector('p').textContent,'$7.15');
 const conflict=doc.createElement('meta');conflict.setAttribute('itemprop','priceCurrency');conflict.content='AUD';doc.head.append(conflict);await new Promise(r=>setTimeout(r,25));assert.equal(doc.querySelector('p').textContent,'$10');
 conflict.remove();await new Promise(r=>setTimeout(r,25));assert.equal(doc.querySelector('p').textContent,'$7.15');
 meta.remove();await new Promise(r=>setTimeout(r,25));assert.equal(doc.querySelector('p').textContent,'$10');
 }finally{d.window.close();}
});
test('content state applies currency with no table, restores during peek, and navigation loads independent preferences',async()=>{
 const d=await fixture('<p>Price 1200원</p>');let listener,state={enabled:false,table:null,currency:{enabled:true,source:'all',target:'USD'}},peek;
 d.reconfigure({url:'https://example.com/a'});
 for(const f of ['interaction-settings.js','page-tools.js'])d.window.eval(await source(f));
 const PageTools=d.window.TextPatchPageTools;d.window.TextPatchPageTools=class extends PageTools{constructor(options){super(options);peek=this;}};
 d.window.chrome={runtime:{id:'test',getManifest:()=>({version:'test'}),sendMessage:async()=>state,onMessage:{addListener:fn=>listener=fn}},storage:{onChanged:{addListener(){}}}};
 try{
 d.window.eval(await source('content.js'));await new Promise(r=>setTimeout(r,20));const doc=d.window.document;
 assert.equal(doc.querySelector('p').textContent,'Price $0.91');
 peek.setPeek(true);assert.equal(doc.querySelector('p').textContent,'Price 1200원');
 peek.setPeek(false);assert.equal(doc.querySelector('p').textContent,'Price $0.91');
 state={...state,currency:{enabled:false}};await new Promise(r=>listener({type:'applyState',state},{id:'test'},r));assert.equal(doc.querySelector('p').textContent,'Price 1200원');
 state={...state,currency:{enabled:true,source:'all',target:'USD'}};await new Promise(r=>listener({type:'applyState',state},{id:'test'},r));
 state={enabled:false,table:null,currency:{enabled:false}};d.window.history.pushState({},'','/b');await new Promise(r=>setTimeout(r,350));assert.equal(doc.querySelector('p').textContent,'Price 1200원');
 }finally{d.window.close();}
});
test('same target currency stays original even when a table would replace its price',async()=>{
 const d=await fixture('<p>1200원</p>');try{
 const t=new d.window.CrimsonTranslator(d.window.document),seed=JSON.parse(await source('data/dictionary.json'));
 t.setData({...seed,entries:[{...seed.entries[0],id:'price',en:'1200원',ko:'Replaced price'}]});
 t.setCurrency({enabled:true,source:'all',target:'KRW'});assert.equal(d.window.document.querySelector('p').textContent,'1200원');
 t.setCurrency({enabled:false});assert.equal(d.window.document.querySelector('p').textContent,'Replaced price');
 }finally{d.window.close();}
});
test('snapshot changes recompute original prices while retaining independent text settings',async()=>{
 const d=await fixture('<p>Price 1200원</p>');try{
 const doc=d.window.document,t=new d.window.CrimsonTranslator(doc),seed=JSON.parse(await source('data/dictionary.json'));
 t.setData({...seed,entries:[{...seed.entries[0],id:'word',en:'Price',ko:'Cost',matchMode:'word'}]});
 const prefs={enabled:true,source:'all',target:'USD'};
 t.setCurrency(prefs);assert.equal(doc.querySelector('p').textContent,'Cost $0.91');
 t.setCurrency(prefs,{...d.window.TextPatchCurrencyRates,rates:{...d.window.TextPatchCurrencyRates.rates,KRW:1200,USD:2}});
 assert.equal(doc.querySelector('p').textContent,'Cost $2.00');assert.equal(t.inspectText(doc.querySelector('p').firstChild).original,'Price 1200원');
 t.setCurrency({enabled:false});assert.equal(doc.querySelector('p').textContent,'Cost 1200원');
 t.setEnabled(false);assert.equal(doc.querySelector('p').textContent,'Price 1200원');
 }finally{d.window.close();}
});
test('unrepresentable cross rates preserve the original amount',async()=>{
 const d=await fixture();try{
 const fx=d.window.TextPatchCurrency,snapshot={...fx.snapshot,rates:{...fx.snapshot.rates,KRW:1e-300,USD:1e300}};
 assert.equal(fx.spans('1200원',{enabled:true,source:'all',target:'USD'},null,snapshot).length,0);
 }finally{d.window.close();}
});
test('content receives new snapshots and metadata-only checks leave DOM untouched',async()=>{
 const d=await fixture('<p>1200원</p>');d.reconfigure({url:'https://example.com/a'});let listener;
 for(const f of ['interaction-settings.js','page-tools.js'])d.window.eval(await source(f));
 let state={enabled:false,table:null,currency:{enabled:true,source:'all',target:'USD'},currencySnapshot:d.window.TextPatchCurrencyRates};
 d.window.chrome={runtime:{id:'test',getManifest:()=>({version:'test'}),sendMessage:async()=>state,onMessage:{addListener:fn=>listener=fn}},storage:{onChanged:{addListener(){}}}};
 try{
 d.window.eval(await source('content.js'));await new Promise(r=>setTimeout(r,20));const p=d.window.document.querySelector('p');assert.equal(p.textContent,'$0.91');
 state={...state,currencySnapshot:{...state.currencySnapshot,rates:{...state.currencySnapshot.rates,KRW:1200,USD:2}}};
 await new Promise(r=>listener({type:'applyState',state},{id:'test'},r));assert.equal(p.textContent,'$2.00');
 let mutations=0;const observer=new d.window.MutationObserver(records=>mutations+=records.length);observer.observe(p,{subtree:true,characterData:true,childList:true});
 state={...state,currencySnapshot:{...state.currencySnapshot,checkedAt:'2026-10-26T12:00:00Z'}};
 await new Promise(r=>listener({type:'applyState',state},{id:'test'},r));await new Promise(r=>setTimeout(r,0));assert.equal(mutations,0);observer.disconnect();
 state={...state,currency:{enabled:false}};await new Promise(r=>listener({type:'applyState',state},{id:'test'},r));assert.equal(p.textContent,'1200원');
 }finally{d.window.close();}
});
