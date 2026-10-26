import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,copyFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {JSDOM} from 'jsdom';
import {createServer} from '../server.mjs';
const seed=JSON.parse(await readFile(new URL('../extension/data/dictionary.json',import.meta.url),'utf8'));
const entry=(en,ko,extra={})=>({id:en,en,ko,kind:'ui',category:'메뉴',context:'global',selector:'',status:'verified',source:'test',evidence:'fixture only',notes:'',...extra});
const dictionary=entries=>({schemaVersion:1,revision:1,entries});
const crimsonExclusions={excludedTerms:['ABYSS','Crimson Desert','DELESYIA','DEMENISS','HERNAND','PAILUNE','Pywel'],excludedCategories:['지명']};
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
async function dom(html) {
  const d=new JSDOM(html,{runScripts:'outside-only'});
  for(const file of ['shared.js','engine.js'])d.window.eval(await readFile(new URL('../extension/'+file,import.meta.url),'utf8'));
  return d;
}
test('whole text, status metadata, dynamic nodes, events and restoration',async()=>{
  const d=await dom('<body><button>Search</button><p>Searchlight</p><span>Secret</span><input value="Search"><div contenteditable="true">Search</div></body>');
  const doc=d.window.document,t=new d.window.CrimsonTranslator(doc);let clicks=0;doc.querySelector('button').onclick=()=>clicks++;
  t.setData(dictionary([entry('Search','검색'),entry('Secret','비밀',{status:'review'})]));
  assert.equal(doc.querySelector('button').textContent,'검색');assert.equal(doc.querySelector('p').textContent,'Searchlight');assert.equal(doc.querySelector('span').textContent,'비밀');
  assert.equal(doc.querySelector('input').value,'Search');assert.equal(doc.querySelector('[contenteditable]').textContent,'Search');doc.querySelector('button').click();assert.equal(clicks,1);
  const popup=doc.createElement('section');popup.textContent='Search';doc.body.append(popup);await tick();assert.equal(popup.textContent,'검색');
  t.setEnabled(false);assert.equal(popup.textContent,'Search');assert.equal(doc.querySelector('button').textContent,'Search');
  t.setEnabled(true);t.setData(dictionary([entry('Search','찾기')]));assert.equal(popup.textContent,'찾기');
  popup.firstChild.data='Updated by site';await tick();t.setEnabled(false);assert.equal(popup.textContent,'Updated by site');
  d.window.close();
});
test('context conflicts, scoped matches and attributes',async()=>{
  const d=await dom('<body><p class="a">Bank</p><p class="b">Bank</p><p>Bank</p><button title="Search">X</button></body>');
  const doc=d.window.document,t=new d.window.CrimsonTranslator(doc);
  t.setData(dictionary([entry('Bank','은행',{id:'a',context:'a',selector:'.a'}),entry('Bank','강둑',{id:'b',context:'b',selector:'.b'}),entry('Search','검색')]));
  assert.deepEqual([...doc.querySelectorAll('p')].map(x=>x.textContent),['은행','강둑','Bank']);assert.equal(doc.querySelector('button').title,'검색');
  doc.querySelector('.a').className='b';await tick();assert.equal(doc.querySelector('p').textContent,'강둑');
  t.setEnabled(false);assert.equal(doc.querySelector('button').title,'Search');
  t.setData(dictionary([entry('Bank','은행',{id:'a',context:'a'}),entry('Bank','강둑',{id:'b',context:'b'})]));t.setEnabled(true);assert.equal(doc.querySelector('p').textContent,'Bank');
  d.window.close();
});
test('dictionary validation and Korean/English search and filters',()=>{
  assert.throws(()=>CrimsonShared.validate(dictionary([entry('X','',{status:'verified'})])));
  assert.throws(()=>CrimsonShared.validate(dictionary([entry('X','가'),entry('X','나')])));
  assert.equal(CrimsonShared.filter(seed.entries,'파이웰','game','verified','지명').length,1);
  assert.equal(CrimsonShared.filter(seed.entries,'PYWEL').length,1);
  assert.equal(CrimsonShared.filter(seed.entries,'Pywel','ui').length,0);
});
test('populated replacements ignore status and legacy false, keep exclusions, and restore on toggle off',async()=>{
  const d=await dom('<body><p>Draft</p><span>Unknown</span><b>Blank</b><i>HERNAND</i></body>');
  const doc=d.window.document,t=new d.window.CrimsonTranslator(doc);
  const data=dictionary([entry('Draft','초안',{status:'review'}),entry('Unknown','미번역',{status:'untranslated'}),entry('Blank','',{status:'review'}),entry('HERNAND','에르난드',{status:'review'})]);
  const originalData=JSON.stringify(data);
  t.setData(data,{includeReview:false,...crimsonExclusions});assert.equal(doc.querySelector('p').textContent,'초안');
  assert.equal(doc.querySelector('span').textContent,data.entries[1].ko);assert.equal(doc.querySelector('b').textContent,'Blank');assert.equal(doc.querySelector('i').textContent,'HERNAND');
  const added=doc.createElement('section');added.textContent='Draft';doc.body.append(added);await tick();assert.equal(added.textContent,'초안');
  t.setEnabled(false);assert.equal(added.textContent,'Draft');assert.equal(doc.querySelector('p').textContent,'Draft');
  assert.equal(doc.querySelector('span').textContent,'Unknown');assert.equal(JSON.stringify(data),originalData);
  d.window.close();
});
test('region names remain original even with verified cached translations',async()=>{
  const names=['ABYSS','Crimson Desert','DELESYIA','DEMENISS','HERNAND','PAILUNE','Pywel'];
  const d=await dom('<body>'+names.map(n=>`<p>${n}</p>`).join('')+'<p>Other place</p><span>Kliff</span></body>');
  const t=new d.window.CrimsonTranslator(d.window.document);
  t.setData(dictionary([...names.map(n=>entry(n,'번역 금지')),entry('Other place','다른 지명',{category:'지명'}),entry('Kliff','클리프')]),crimsonExclusions);
  assert.deepEqual([...d.window.document.querySelectorAll('p')].map(p=>p.textContent),[...names,'Other place']);
  assert.equal(d.window.document.querySelector('span').textContent,'클리프');
  d.window.close();
});
test('screenshot uppercase labels, counts, placeholders and official game terms',async()=>{
  const d=await dom('<body><button>SHOW ALL</button><button>Hide All</button><input placeholder="Search..."><h2>RESOURCES</h2><label><span>ABYSS NEXUS</span><b>266</b></label><p>BISMUTH ORE</p><p>ABYSS ARTIFACT</p><p>AZURITE</p><p>HERNAND</p></body>');
  const doc=d.window.document,t=new d.window.CrimsonTranslator(doc);
  t.setData(seed,crimsonExclusions);
  assert.equal(doc.querySelector('button').textContent,'모두 표시');
  assert.equal(doc.querySelectorAll('button')[1].textContent,'모두 숨기기');
  assert.equal(doc.querySelector('input').placeholder,'Search...');
  assert.equal(doc.querySelector('h2').textContent,'자원');
  assert.equal(doc.querySelector('span').textContent,'어비스 흔적');
  assert.equal(doc.querySelector('b').textContent,'266');
  assert.deepEqual([...doc.querySelectorAll('p')].map(p=>p.textContent),['비스무트 광석','어비스 아티팩트',seed.entries.find(e=>e.en==='AZURITE').ko,'HERNAND']);
  t.setEnabled(false);assert.equal(doc.querySelector('span').textContent,'ABYSS NEXUS');assert.equal(doc.querySelector('button').textContent,'SHOW ALL');
  d.window.close();
});
test('save, backup, restart persistence, conflict and cross-origin rejection',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'crimson-test-'));const dataPath=path.join(dir,'dictionary.json');await copyFile(new URL('../extension/data/dictionary.json',import.meta.url),dataPath);
  let server;
  const start=async()=>{server=await createServer({dataPath});await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port;};
  const close=()=>new Promise(r=>server.close(r));
  try {
    let base=await start();const initial=await(await fetch(base+'/api/library')).json();const changed=structuredClone(initial);changed.tables[0].entries.push(entry('Save test','저장 테스트'));
    const put=(body,origin=base)=>fetch(base+'/api/library',{method:'PUT',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
    assert.equal((await put(changed,'https://example.com')).status,403);
    assert.equal((await put(changed)).status,200);assert.equal((await put(changed)).status,409);
    const backup=JSON.parse(await readFile(path.join(dir,'library.json.bak'),'utf8'));
    assert.equal(backup.revision,initial.revision);
    assert.deepEqual(JSON.parse(await readFile(path.join(dir,backup.tableFiles[0]),'utf8')),initial.tables[0]);
    assert.deepEqual(JSON.parse(await readFile(dataPath,'utf8')),seed);
    await close();base=await start();const persisted=await(await fetch(base+'/api/library')).json();assert.equal(persisted.tables[0].entries.at(-1).ko,'저장 테스트');assert.equal(persisted.revision,initial.revision+1);
    assert.equal((await fetch(base+'/')).status,200);
  }finally{if(server?.listening)await close();await rm(dir,{recursive:true,force:true});}
});
