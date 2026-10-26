import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {seededHarness as harness} from './background-harness.mjs';
import {loadKorean} from './i18n-harness.mjs';
import {toggleDraftName,hasDraftName} from './editor-draft-helpers.mjs';
const read=file=>readFile(new URL('../extension/'+file,import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
async function prepared(){
 const h=await harness(),library=(await h.send({type:'libraryGet'})).library;
 library.tables[0].entries=library.tables[0].entries.slice(0,2).map(row=>({...row,ko:'',status:'review'}));
 await h.send({type:'librarySave',library});
 const saved=(await h.send({type:'libraryGet'})).library,table=saved.tables[0];
 const {record}=await h.send({type:'aiRequestRecord',table});
 const text=JSON.stringify({format:'text-patch-table',version:2,aiRequest:{version:1,id:record.id},entries:[{requestRow:'0',original:table.entries[0].en,replacement:'Safe fill'}]});
 return {h,table,text};
}
test('background linked workflow restricts authority, survives restart, and ordinary import cannot bypass preview path',async()=>{
 const {h,table,text}=await prepared();
 assert.ok((await h.send({type:'aiResultApply',text},{id:'test',tab:{id:1,url:'https://evil.example'}})).error);
 assert.ok((await h.send({type:'importTables',text,fileName:'result.json'})).error);
 const restarted=await harness(h.store,h.indexedDB),preview=await restarted.send({type:'aiResultPreview',text});assert.equal(preview.filled,1);assert.equal(preview.tableName,table.name);
 const result=await restarted.send({type:'aiResultApply',text});assert.equal(result.library.tables[0].entries[0].ko,'Safe fill');assert.equal(result.library.tables.length,1);
});
test('editor linked import preserves unsaved drafts and persists only after explicit Apply and save',async t=>{
 const {h,table,text}=await prepared();
 const dom=new JSDOM(await read('editor/index.html'),{url:'https://editor.test/',runScripts:'outside-only'}),w=dom.window;t.after(()=>w.close());
 loadKorean(w);w.structuredClone=structuredClone;w.TextEncoder=TextEncoder;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 for(const file of ['shared.js','library.js','editor/import.js','ai-request-ui.js'])w.eval(await read(file));
 w.EditorStorage={load:async()=>(await h.send({type:'libraryGet'})).library,ai:async(type,payload)=>{const result=await h.send({type,...payload});if(result.error)throw Error(result.error);return result;}};
 w.eval(await read('editor/app.js'));await tick();await tick();
 const $=id=>w.document.getElementById(id);
 Object.defineProperty($('import-file'),'files',{value:[new w.File([text],'result.json')]});
 toggleDraftName(w);await $('import-file').onchange();assert.equal(hasDraftName(w),true);assert.match($('import-error').textContent,/먼저 저장/);assert.equal((await h.send({type:'libraryGet'})).library.tables[0].entries[0].ko,'');
 toggleDraftName(w);assert.equal(hasDraftName(w),false);$('import-open').click();
 const importing=$('import-file').onchange();for(let i=0;i<30&&!w.document.querySelector('[data-ai-result]');i++)await tick();
 const dialog=w.document.querySelector('[data-ai-result]');assert.ok(dialog);assert.match(dialog.textContent,new RegExp(table.name));
 dialog.querySelector('[data-ai-result-apply]').click();await importing;
 assert.equal((await h.send({type:'libraryGet'})).library.tables[0].entries[0].ko,'Safe fill');assert.equal($('save-all').disabled,true);assert.match($('message').textContent,/채우기 1/);
});
