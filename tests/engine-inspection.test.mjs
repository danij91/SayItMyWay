import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const data={schemaVersion:1,revision:1,entries:[{id:'x',en:'Chest',ko:'상자',kind:'general',category:'test',context:'global',selector:'',status:'review',source:'fixture',evidence:'',notes:''}]};
async function setup(html){
  const dom=new JSDOM(html,{runScripts:'outside-only'});
  for(const file of ['shared.js','engine.js'])dom.window.eval(await readFile(new URL('../extension/'+file,import.meta.url),'utf8'));
  return {dom,doc:dom.window.document,t:new dom.window.CrimsonTranslator(dom.window.document)};
}
test('inspectText reports owned originals and fresh site text, excluding private and editing surfaces',async()=>{
  const {dom,doc,t}=await setup('<p>Chest</p><div data-private>Secret</div><div hidden>Hidden</div><div contenteditable>Draft</div><input value="Secret"><span data-crimson-ignore>Tools</span>');
  try{
    t.setData(data);const node=doc.querySelector('p').firstChild;
    assert.deepEqual(JSON.parse(JSON.stringify(t.inspectText(node))),{original:'Chest',replacement:'상자'});
    node.data='Site update';
    assert.deepEqual(JSON.parse(JSON.stringify(t.inspectText(node))),{original:'Site update',replacement:'Site update'});
    for(const selector of ['[data-private]','[hidden]','[contenteditable]','[data-crimson-ignore]'])assert.equal(t.inspectText(doc.querySelector(selector).firstChild),null);
    assert.equal(t.inspectText(doc.querySelector('p')),null);
    node.remove();assert.equal(t.inspectText(node),null);
  }finally{dom.window.close();}
});
test('inspectText uses exact node boundaries, whitespace and matching rules without concatenating containers',async()=>{
  const {dom,doc,t}=await setup('<p>  Chest  </p><p><b>Che</b><i>st</i></p><div style="visibility:hidden"><span>Chest</span></div><div aria-hidden="true">Chest</div><div data-crimson-private>Chest</div>');
  try{
    t.setData(data);
    assert.deepEqual(JSON.parse(JSON.stringify(t.inspectText(doc.querySelector('p').firstChild))),{original:'  Chest  ',replacement:'  상자  '});
    assert.equal(t.inspectText(doc.querySelector('b').firstChild).replacement,'Che');
    for(const node of doc.querySelectorAll('div'))assert.equal(t.inspectText(node.firstChild),null);
    doc.designMode='on';assert.equal(t.inspectText(doc.querySelector('p').firstChild),null);
    assert.equal(t.inspectText(null),null);
    assert.equal(t.inspectText(undefined),null);
  }finally{dom.window.close();}
});

test('legacy enabled fitting metadata never changes page styles or activates obsolete runtime',async()=>{
 const {dom,doc,t}=await setup('<p style="font-size:20px!important;line-height:1.4;color:blue">Chest</p><input value="Chest">');
 try{
  const p=doc.querySelector('p'),style=p.getAttribute('style');let constructed=0;
  dom.window.TextPatchLayoutFit=class{constructor(){constructed++;}track(){throw Error('obsolete runtime');}};
  const translator=new dom.window.CrimsonTranslator(doc);t.setEnabled(false);
  translator.setData({...data,defaults:{fitText:{enabled:true,fontScale:0.7,lineHeight:2}}},{siteOptions:{fitText:{enabled:true,fontScale:1.3,lineHeight:2}}});
  await new Promise(r=>setTimeout(r,40));
  assert.equal(constructed,0);assert.equal(translator.setLayoutOptions,undefined);assert.equal(p.textContent,data.entries[0].ko);assert.equal(p.getAttribute('style'),style);
  translator.setEnabled(false);assert.equal(p.textContent,'Chest');assert.equal(p.getAttribute('style'),style);
  assert.equal(doc.querySelector('input').value,'Chest');
 }finally{dom.window.close();}
});
