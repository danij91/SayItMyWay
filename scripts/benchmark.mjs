import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
const count=5000;
const dom=new JSDOM('<body>'+Array.from({length:count},(_,i)=>`<span>Label ${i}</span>`).join('')+'</body>',{runScripts:'outside-only'});
for(const file of ['shared.js','engine.js'])dom.window.eval(await readFile(new URL('../extension/'+file,import.meta.url),'utf8'));
const table={schemaVersion:1,revision:1,entries:Array.from({length:10000},(_,i)=>({id:'row-'+i,en:'Label '+i,ko:'항목 '+i,kind:'general',category:'성능 검사',context:'global',selector:'',status:'verified',source:'benchmark fixture',evidence:'synthetic',notes:''}))};
const translator=new dom.window.CrimsonTranslator(dom.window.document);
const start=performance.now();
translator.setData(table);
const initialCallMs=performance.now()-start;
while(dom.window.document.body.lastChild.textContent!=='항목 4999'){
  if(performance.now()-start>30000)throw Error('Benchmark timeout');
  await new Promise(r=>setTimeout(r,10));
}
const elapsedMs=performance.now()-start;
translator.setEnabled(false);
if(dom.window.document.body.lastChild.textContent!=='Label 4999')throw Error('Restoration failed');
console.log(JSON.stringify({environment:'Node/jsdom synthetic, not browser FPS',dictionaryEntries:table.entries.length,textNodes:count,initialCallMs:+initialCallMs.toFixed(1),elapsedMs:+elapsedMs.toFixed(1),restored:true},null,2));
dom.window.close();
