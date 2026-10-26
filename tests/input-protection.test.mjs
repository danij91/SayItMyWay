import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const data={schemaVersion:1,revision:1,defaults:{translatePlaceholders:true},entries:[{id:'chest',en:'Chest',ko:'Box',kind:'general',category:'test',context:'global',selector:'',status:'verified',source:'test',evidence:'fixture',notes:''}]};
async function setup(html){
  const dom=new JSDOM(html,{runScripts:'outside-only'});
  for(const file of ['shared.js','engine.js'])dom.window.eval(await readFile(new URL('../extension/'+file,import.meta.url),'utf8'));
  const doc=dom.window.document,t=new dom.window.CrimsonTranslator(doc);
  return {dom,doc,t};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,30));

test('editing surfaces exclude text, metadata and candidates even with legacy placeholder opt-in',async()=>{
  const surfaces=['<input value="Chest" placeholder="Chest" title="Chest">','<textarea placeholder="Chest">Chest</textarea>','<select><option title="Chest">Chest</option></select>','<option>Chest</option>','<div contenteditable><span title="Chest">Chest</span><i contenteditable="false">Chest</i></div>','<div contenteditable="plaintext-only">Chest</div>','<div role="textbox"><span title="Chest">Chest</span></div>','<div role="searchbox">Chest</div>','<div role="unknown TEXTBOX">Chest</div>'];
  const {dom,doc,t}=await setup('<p title="Chest" placeholder="Chest">Chest</p>'+surfaces.map(s=>'<section>'+s+'</section>').join(''));
  try{
    const before=[...doc.querySelectorAll('section')].map(e=>e.innerHTML);
    t.setData(data);
    assert.deepEqual([...doc.querySelectorAll('section')].map(e=>e.innerHTML),before);
    assert.equal(doc.querySelector('p').textContent,'Box');assert.equal(doc.querySelector('p').title,'Box');
    assert.equal(doc.querySelector('p').getAttribute('placeholder'),'Chest');
    assert.deepEqual(Array.from(t.collectCandidates()),['Chest']);
    doc.querySelector('p').remove();assert.deepEqual(Array.from(t.collectCandidates()),[]);
    t.setEnabled(false);assert.deepEqual([...doc.querySelectorAll('section')].map(e=>e.innerHTML),before);
  }finally{dom.window.close();}
});

test('dynamic editing transitions restore untouched translations before input, paste and composition',async tcase=>{
  for(const mode of ['contenteditable','role','designMode'])for(const type of ['beforeinput','paste','compositionstart'])await tcase.test(mode+' '+type,async()=>{
    const {dom,doc,t}=await setup('<div><span title="Chest">Chest</span></div><p>Chest</p>');
    try{
      t.setData(data);const host=doc.querySelector('div'),span=host.firstChild;
      if(mode==='designMode')doc.designMode='on';
      else host.setAttribute(mode,mode==='role'?'textbox':'true');
      span.dispatchEvent(new dom.window.Event(type,{bubbles:true}));
      assert.equal(span.textContent,'Chest','restores synchronously before browser edit');
      span.firstChild.data='My draft';
      span.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
      await settle();t.setData({...data,revision:2});t.setEnabled(false);
      assert.equal(span.textContent,'My draft');
      assert.equal(span.title,'Chest');
    }finally{dom.window.close();}
  });
});

test('input fallback and observed edits never restore over user text equal to the old translation',async tcase=>{
  for(const event of [true,false])await tcase.test(event?'input event':'mutation only',async()=>{
    const {dom,doc,t}=await setup('<div><span>Chest</span></div><p>Chest</p>');
    try{
      t.setData(data);const host=doc.querySelector('div'),text=host.firstChild.firstChild;
      host.setAttribute('contenteditable','true');
      text.data='Box'; // A real write, even though it matches the prior translated value.
      if(event)host.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
      t.setEnabled(false);await settle();
      assert.equal(text.data,'Box','user-written value is not mistaken for an untouched translation');
      assert.equal(doc.querySelector('p').textContent,'Chest','normal restoration still works');
    }finally{dom.window.close();}
  });
});

test('observer restores untouched role transitions and handles inherited editing moves',async()=>{
  const {dom,doc,t}=await setup('<div><span>Chest</span></div><aside contenteditable="plaintext-only"></aside><p>Chest</p>');
  try{
    t.setData(data);const host=doc.querySelector('div');host.setAttribute('role','searchbox');
    await settle();assert.equal(host.textContent,'Chest');
    host.removeAttribute('role');await settle();assert.equal(host.textContent,'Box');
    doc.querySelector('aside').append(host);await settle();assert.equal(host.textContent,'Chest');
    doc.body.append(host);await settle();assert.equal(host.textContent,'Box');
    t.setEnabled(false);assert.equal(host.textContent,'Chest');
  }finally{dom.window.close();}
});

test('designMode alone restores translated text and metadata and blocks fresh scans',async()=>{
  const {dom,doc,t}=await setup('<p title="Chest">Chest</p>');
  try{
    t.setData(data);doc.designMode='on';
    await new Promise(resolve=>setTimeout(resolve,180));
    assert.equal(doc.querySelector('p').textContent,'Chest');assert.equal(doc.querySelector('p').title,'Chest');
    t.setData({...data,revision:2});assert.equal(doc.querySelector('p').textContent,'Chest');
    assert.deepEqual(Array.from(t.collectCandidates()),[]);
    doc.designMode='off';await new Promise(resolve=>setTimeout(resolve,180));
    assert.equal(doc.querySelector('p').textContent,'Box');
    t.setEnabled(false);assert.equal(doc.querySelector('p').textContent,'Chest');
  }finally{dom.window.close();}
});
