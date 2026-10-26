import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const entry=(en,ko,extra={})=>({id:en,en,ko,kind:'general',category:'test',context:'global',selector:'',status:'verified',source:'test',evidence:'fixture',notes:'',...extra});
const dictionary=(entries,defaults={})=>({schemaVersion:1,revision:1,entries,defaults});
async function until(predicate) {
  for(let i=0;i<100;i++) {if(predicate())return;await new Promise(r=>setTimeout(r,10));}
  assert.ok(predicate(),'DOM work completed');
}
async function setup(html) {
  const dom=new JSDOM(html,{runScripts:'outside-only'});
  for(const file of ['shared.js','engine.js'])dom.window.eval(await readFile(new URL('../extension/'+file,import.meta.url),'utf8'));
  return {dom,doc:dom.window.document,t:new dom.window.CrimsonTranslator(dom.window.document)};
}
test('exact defaults and per-entry case overrides preserve surrounding whitespace',async()=>{
  const {dom,doc,t}=await setup('<p>  CHEST  </p><p>Open Chest</p><p>KEY</p><p>key</p>');
  try {
    t.setData(dictionary([entry('Chest','Box'),entry('Key','Token',{caseSensitive:true})]));
    assert.deepEqual([...doc.querySelectorAll('p')].map(p=>p.textContent),['  Box  ','Open Chest','KEY','key']);
  } finally {dom.window.close();}
});
test('defaults and overrides, literal matching, ambiguity and scopes are deterministic',async()=>{
  const {dom,doc,t}=await setup('<p>chest Chest KEY Key A+B</p><p class="bank">Bank teller</p><p>Bank teller</p><p>Two  words</p><p>Town</p>');
  try {
    const entries=[entry('Chest','Box'),entry('Key','Token',{caseSensitive:false}),entry('A+B','Sum'),entry('Bank','Money',{id:'bank1',context:'one'}),entry('Bank','River',{id:'bank2',context:'two'}),entry('Bank','Scoped',{id:'bank3',selector:'.bank'}),entry('Two words','Joined',{matchMode:'exact'}),entry('Town','City')];
    t.setData(dictionary(entries,{matchMode:'word',caseSensitive:true}));
    assert.deepEqual([...doc.querySelectorAll('p')].map(p=>p.textContent),['chest Box Token Token Sum','Scoped teller','Bank teller','Two  words','City']);
    t.setData({...dictionary(entries,{matchMode:'word',caseSensitive:true}),excludedCategories:['test']});
    assert.equal(doc.querySelector('p').textContent,'chest Chest KEY Key A+B');
  } finally {dom.window.close();}
});
test('candidate and replacement snapshots expose originals without changing DOM or collecting private text',async()=>{
  const {dom,doc,t}=await setup('<p>Chest</p><p>Chest</p><p>  New label </p><p>1,234</p><div hidden>Hidden</div><div style="display:none">Secret</div><div style="opacity:0">Invisible</div><div aria-hidden="true">Hidden aria</div><div data-private>Private</div><div contenteditable><span>Draft</span></div><input value="Password"><textarea>Personal</textarea><script>Code</script>');
  try {
    t.setData(dictionary([entry('Chest','Box')]));
    const before=doc.body.innerHTML;
    assert.deepEqual(Array.from(t.collectCandidates()),['Chest','New label']);
    assert.deepEqual(JSON.parse(JSON.stringify(t.getReplacementLog())),[{original:'Chest',replacement:'Box',attribute:'#text'},{original:'Chest',replacement:'Box',attribute:'#text'}]);
    assert.equal(doc.body.innerHTML,before);
    doc.querySelector('p').firstChild.data='Site';
    assert.deepEqual(Array.from(t.collectCandidates()),['Site','Chest','New label']);
    assert.equal(t.getReplacementLog().length,1);
  } finally {dom.window.close();}
});
test('large scans yield, dynamic changes use fresh originals, and newly editable nodes restore',async()=>{
  const {dom,doc,t}=await setup('<main>'+ '<p>Chest</p>'.repeat(1600)+'</main>');
  try {
    t.setData(dictionary([entry('Chest','Box'),entry('New','Fresh')]));
    assert.equal(doc.querySelector('p:last-child').textContent,'Chest','large initial scan yields');
    await until(()=>doc.querySelector('p:last-child').textContent==='Box');
    const first=doc.querySelector('p');
    first.firstChild.data='New';
    await until(()=>first.textContent==='Fresh');
    first.setAttribute('contenteditable','true');
    await until(()=>first.textContent==='New');
    const added=doc.createElement('p');added.textContent='Chest';doc.body.append(added);
    await until(()=>added.textContent==='Box');
    added.firstChild.data='Site update';
    t.setEnabled(false);
    assert.equal(added.textContent,'Site update');
    assert.equal(doc.querySelector('p:last-child').textContent,'Chest');
  } finally {dom.window.close();}
});
test('table metadata, editable inheritance and legacy placeholder settings protect user surfaces',async()=>{
  const {dom,doc,t}=await setup('<p>Chest</p><b>Town</b><input title="Chest" placeholder="Chest" value="Chest"><textarea placeholder="Chest">Chest</textarea><select><option>Chest</option></select><div contenteditable><span>Chest</span><i contenteditable="false">Chest</i></div>');
  try {
    const data={...dictionary([entry('Chest','Box'),entry('Town','City')],{translatePlaceholders:false}),excludedTerms:['Town']};
    t.setData(data);
    assert.equal(doc.querySelector('p').textContent,'Box');
    assert.equal(doc.querySelector('b').textContent,'Town');
    assert.equal(doc.querySelector('input').placeholder,'Chest');
    assert.equal(doc.querySelector('input').title,'Chest');
    assert.equal(doc.querySelector('textarea').value,'Chest');
    assert.equal(doc.querySelector('select').textContent,'Chest');
    assert.equal(doc.querySelector('[contenteditable]').textContent,'ChestChest');
    t.setData({...data,defaults:{translatePlaceholders:true}});
    assert.equal(doc.querySelector('input').placeholder,'Chest');
    assert.equal(doc.querySelector('textarea').placeholder,'Chest');
    t.setEnabled(false);
    assert.equal(doc.querySelector('input').placeholder,'Chest');
  } finally {dom.window.close();}
});
test('word replacements use Unicode boundaries and original spans with longest overlap and no cycles',async()=>{
  const {dom,doc,t}=await setup('<p>Open Chest, Chestnut, éChest, Chest한, Chest_key; A B.</p>');
  try {
    t.setData(dictionary([entry('Chest','Box'),entry('Open Chest','Loot'),entry('A','B'),entry('B','A')],{matchMode:'word'}));
    assert.equal(doc.querySelector('p').textContent,'Loot, Chestnut, éChest, Chest한, Chest_key; B A.');
    let writes=0;
    const observer=new dom.window.MutationObserver(records=>{writes+=records.length;});
    observer.observe(doc.body,{subtree:true,characterData:true});
    doc.querySelector('p').className='site-refresh';
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(doc.querySelector('p').textContent,'Loot, Chestnut, éChest, Chest한, Chest_key; B A.');
    assert.equal(writes,0,'rescan does not chain or write unchanged translations');
    observer.disconnect();
    t.setEnabled(false);
    assert.equal(doc.querySelector('p').textContent,'Open Chest, Chestnut, éChest, Chest한, Chest_key; A B.');
  } finally {dom.window.close();}
});
test('pending scans cancel on disable and removed nodes regain original text',async()=>{
  const {dom,doc,t}=await setup('<main>'+'<p>Chest</p>'.repeat(600)+'</main>');
  try {
    t.setData(dictionary([entry('Chest','Box')]));
    t.setEnabled(false);
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.ok([...doc.querySelectorAll('p')].every(p=>p.textContent==='Chest'));
    t.setEnabled(true);
    await until(()=>doc.querySelector('p:last-child').textContent==='Box');
    const removed=doc.querySelector('main');removed.remove();
    await until(()=>removed.querySelector('p:last-child').textContent==='Chest');
    assert.equal(t.getReplacementLog().length,0);
    doc.body.append(removed);
    await until(()=>removed.querySelector('p:last-child').textContent==='Box');
  } finally {dom.window.close();}
});
