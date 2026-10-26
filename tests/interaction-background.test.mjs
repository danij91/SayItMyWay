import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seededHarness as harness} from './background-harness.mjs';
const url='https://example.com/docs/a';
const sender={id:'test',frameId:0,documentId:'document-1',url,tab:{id:1,url}};
const context=(h,original='New original',extra={})=>h.send({type:'inlineContext',url,original,...extra},sender);
const save=(h,c,original='New original',replacement='Replacement',extra={})=>h.send({type:'inlineSave',url,original,replacement,tableId:c.tableId,token:c.token,...extra},sender);
async function setup(){const h=await harness({rules:[]});h.grants.add('https://example.com/*');const state=await h.send({type:'state'});await h.send({type:'selectTable',url,tableId:state.library.tables[0].id});return h;}

test('inline add uses narrow linked context, preserves association and unrelated edits, persists restart',async()=>{
 const h=await setup(),c=await context(h);
 assert.deepEqual(Object.keys(c).sort(),['entry','table','tableId','token']);assert.equal(c.entry,null);
 assert.deepEqual(Object.keys(c.table).sort(),['id','name']);
 let state=await h.send({type:'state'});state.library.tables[0].description='Concurrent unrelated metadata';
 await h.send({type:'librarySave',library:state.library});
 assert.equal((await save(h,c)).saved,true);
 state=await h.send({type:'state'});assert.equal(state.rules[0].tableId,c.tableId);
 assert.equal(state.library.tables[0].description,'Concurrent unrelated metadata');
 const entry=state.library.tables[0].entries.find(e=>e.en==='New original');
 assert.equal(entry.status,'review');assert.equal(entry.kind,'general');assert.equal(entry.source,'');assert.equal(entry.evidence,'');assert.ok(entry.id);
 assert.ok(h.sent.some(m=>m.type==='applyState'));
 const restarted=await harness(h.store,h.indexedDB);assert.ok((await restarted.send({type:'state'})).library.tables[0].entries.some(e=>e.id===entry.id));
 assert.ok((await save(h,c)).error,'token is single use');
});

test('two inline drafts cannot overwrite each other, including absent-row creation',async()=>{
 const h=await setup(),a=await context(h),b=await context(h);
 const [first,second]=await Promise.all([save(h,a),save(h,b,'New original','Lost update')]);
 assert.equal(first.saved,true);assert.ok(second.error);
 const x=await context(h),y=await context(h);assert.equal((await save(h,x,'New original','Second')).saved,true);
 assert.ok((await save(h,y,'New original','Stale')).error);
});

test('unique normalized original edits retain original spelling and provenance and demote verification',async()=>{
 const h=await setup(),state=await h.send({type:'state'}),entry=state.library.tables[0].entries[0];
 entry.en='Unique   Original';entry.ko='Verified';entry.status='verified';entry.source='https://example.org/source';entry.evidence='Observed';entry.context='Descriptive context';entry.selector='';
 await h.send({type:'librarySave',library:state.library});
 const c=await context(h,'Unique Original');assert.equal(c.entry.id,entry.id);
 assert.equal((await save(h,c,'Unique Original','Changed')).saved,true);
 const next=(await h.send({type:'state'})).library.tables[0].entries.find(e=>e.id===entry.id);
 assert.equal(next.en,'Unique   Original');assert.equal(next.status,'review');assert.equal(next.source,entry.source);assert.equal(next.evidence,entry.evidence);assert.equal(next.context,entry.context);
 const empty=await context(h,'Unique Original');assert.equal((await save(h,empty,'Unique Original','')).saved,true);
 assert.equal((await h.send({type:'state'})).library.tables[0].entries.find(e=>e.id===entry.id).status,'untranslated');
});

test('ambiguous contextual rows and selector-dependent rows never receive overwrite tokens',async()=>{
 const h=await setup(),state=await h.send({type:'state'}),table=state.library.tables[0],base=table.entries[0];
 table.entries=[{...base,id:'a',en:'Ambiguous',context:'one',selector:''},{...base,id:'b',en:'Ambiguous',context:'two',selector:''},{...base,id:'c',en:'Scoped',selector:'.only'}];
 await h.send({type:'librarySave',library:state.library});
 assert.ok((await context(h,'Ambiguous')).error);assert.ok((await context(h,'Scoped')).error);
});

test('case-insensitive linked text edits the actual stored row; site case settings override table defaults',async()=>{
 const h=await setup(),state=await h.send({type:'state'}),table=state.library.tables[0];
 table.entries=[{...table.entries[0],id:'chest',en:'Chest',ko:'Box',context:'Item label',selector:''}];table.defaults.caseSensitive=true;
 await h.send({type:'librarySave',library:state.library});await h.send({type:'selectTable',url,tableId:table.id});
 const c=await context(h,'CHEST');assert.equal(c.entry.id,'chest');assert.equal((await save(h,c,'CHEST','Updated')).saved,true);
 const entries=(await h.send({type:'state'})).library.tables[0].entries;assert.equal(entries.length,1);assert.equal(entries[0].en,'Chest');assert.equal(entries[0].ko,'Updated');
 await h.send({type:'saveRuleOptions',id:h.store.rules[0].id,caseSensitive:true,matchMode:'exact'});
 assert.equal((await context(h,'CHEST')).entry,null,'case-sensitive site permits a distinct uppercase original');
});

test('inline trust checks reject missing/foreign sender, iframe, tab origin mismatch and absent browser authority',async()=>{
 const h=await setup();
 for(const bad of [{id:'test',url:'chrome-extension://test/popup.html'},{...sender,frameId:1},{...sender,url:'https://evil.test/'},{...sender,tab:{id:1,url:'https://evil.test/'}}])assert.ok((await h.send({type:'inlineContext',url,original:'Hello'},bad)).error);
 assert.equal(await h.send({type:'inlineContext',url,original:'Hello'},{...sender,id:'foreign'}),undefined);
 assert.ok((await h.send({type:'libraryGet'},sender)).error);assert.ok((await h.send({type:'librarySave',library:{}},sender)).error);
 assert.ok((await context(h,'Hello',{url:'https://evil.test/'})).error);
 assert.ok((await context(h,'Hello',{url:'https://example.com/other-path'})).error,'caller cannot choose another association by forging a same-origin URL');
 h.grants.clear();h.setExecutionFailure(true);assert.ok((await context(h)).error);
 h.setExecutionFailure(false);h.setExecutionResult([{result:'https://evil.test'}]);assert.ok((await context(h)).error);
 h.setExecutionResult([{frameId:0,result:'https://example.com'}]);assert.ok((await context(h)).token,'browser-authorized activeTab accepted');
});

test('tokens bind document, original, table and site association; restart conflicts safely',async()=>{
 const h=await setup(),c=await context(h);
 assert.ok((await save(h,c,'Different original')).error);
 assert.ok((await save(h,c,'New original','x',{tableId:'missing'})).error);
 assert.ok((await h.send({type:'inlineSave',url,original:'New original',replacement:'x',tableId:c.tableId,token:c.token},{...sender,documentId:'document-2'})).error);
 await h.send({type:'deleteRule',id:h.store.rules[0].id});assert.ok((await save(h,c)).error);await h.send({type:'selectTable',url,tableId:c.tableId});
 const fresh=await context(h),restart=await harness(h.store,h.indexedDB);restart.grants.add('https://example.com/*');assert.ok((await save(restart,fresh)).error);
});

test('deleted entries and tables, oversized values and stale saves preserve current library',async()=>{
 const h=await setup();assert.ok((await context(h,'a'.repeat(20001))).error);assert.ok((await context(h,' ')).error);
 const c=await context(h);assert.ok((await save(h,c,'New original','x'.repeat(20001))).error);
 assert.equal((await save(h,c)).saved,true);
 const existing=await context(h),state=await h.send({type:'state'});state.library.tables[0].entries=state.library.tables[0].entries.filter(e=>e.en!=='New original');
 await h.send({type:'librarySave',library:state.library});assert.ok((await save(h,existing)).error);
 const deleted=await context(h);state.library=(await h.send({type:'state'})).library;state.library.tables=[];await h.send({type:'librarySave',library:state.library});assert.ok((await save(h,deleted)).error);
});

test('global shortcut validation saves explicitly, propagates, roundtrips and rejects duplicate keys atomically',async()=>{
 const h=await setup(),before=await h.send({type:'state'});assert.equal(before.interactionSettings.peekMode,'hold');assert.equal(before.interactionSettings.editMode,'hold');
 const prefs={peekEnabled:true,editEnabled:false,peekMode:'toggle',editMode:'toggle',peekKey:{code:'ControlRight',ctrl:false,alt:false,shift:false,meta:false},editKey:null};
 assert.equal((await h.send({type:'saveInteractionSettings',interactionSettings:prefs})).interactionSettings.peekMode,'toggle');
 assert.deepEqual(structuredClone(h.sent.at(-1).state.interactionSettings),prefs);
 for(const value of [{...prefs,editEnabled:true,editKey:prefs.peekKey},{...prefs,peekKey:{...prefs.peekKey,code:'Escape'}},{...prefs,peekMode:'other'},...[null,'',false,'other'].map(editMode=>({...prefs,editMode}))]){
  assert.ok((await h.send({type:'saveInteractionSettings',interactionSettings:value})).error);
  assert.deepEqual(structuredClone((await h.send({type:'state'})).interactionSettings),prefs,'invalid mode leaves stored settings unchanged');
 }
 assert.deepEqual(structuredClone((await h.send({type:'exportSettings'})).interactionSettings),prefs);
 const restart=await harness(h.store,h.indexedDB);assert.deepEqual(structuredClone((await restart.send({type:'state'})).interactionSettings),prefs);
 const page=await h.send({type:'pageState',url});assert.equal(page.interactionUI.locale,'ko');assert.equal(page.interactionUI.dir,'ltr');assert.equal(page.interactionUI.strings.inline_reload,'최신 내용 불러오기');
});

test('legacy interaction settings default edit to hold across loading and settings import',async()=>{
 const legacy={peekMode:'toggle',peekKey:'ShiftLeft',editKey:'AltLeft'};
 const h=await harness({rules:[],interactionSettings:legacy});
 const state=await h.send({type:'state'});assert.equal(state.interactionSettings.editMode,'hold');
 const exported=await h.send({type:'exportSettings'});delete exported.interactionSettings.editMode;
 assert.equal((await h.send({type:'importSettings',data:exported})).error,undefined);
 assert.equal((await h.send({type:'state'})).interactionSettings.editMode,'hold');
 const toggled={...exported,interactionSettings:{...exported.interactionSettings,editMode:'toggle'}};
 assert.equal((await h.send({type:'importSettings',data:toggled})).error,undefined);
 assert.equal((await h.send({type:'state'})).interactionSettings.editMode,'toggle');
 const invalid={...toggled,interactionSettings:{...toggled.interactionSettings,editMode:'invalid'}};
 assert.ok((await h.send({type:'importSettings',data:invalid})).error);
 assert.equal((await h.send({type:'state'})).interactionSettings.editMode,'toggle');
});

test('unlinked inline requests cannot fall back to first or caller-selected table',async()=>{
 const h=await setup(),tableId=h.store.rules[0].tableId;
 await h.send({type:'deleteRule',id:h.store.rules[0].id});
 for(const extra of [{},{tableId}]){
  const c=await context(h,'New original',extra);
  assert.ok(c.error);assert.equal(c.table,null);assert.equal(c.tableId,null);assert.equal(c.token,null);assert.equal(c.entry,null);assert.equal('tables' in c,false);
 }
 const state=await h.send({type:'state'});assert.equal(state.library.tables[0].entries.some(e=>e.en==='New original'),false);
});

test('legacy fitting metadata cannot block storage or import and fitting-only API is removed',async()=>{
 const h=await setup(),id=h.store.rules[0].id;
 for(const fitText of [null,'old unsupported value',{enabled:true,fontScale:100,lineHeight:-2}]){
  h.store.rules[0].fitText=fitText;
  const state=await h.send({type:'state'});assert.equal(state.error,undefined);
  const exported=await h.send({type:'exportSettings'});assert.deepEqual(exported.rules[0].fitText,fitText);
  assert.equal((await h.send({type:'importSettings',data:exported})).error,undefined);
  assert.ok((await h.send({type:'saveRuleOptions',id,fitText:{enabled:true,fontScale:1,lineHeight:0}})).error);
  assert.equal((await h.send({type:'saveRuleOptions',id,matchMode:'word',caseSensitive:true,fitText:'ignored'})).error,undefined);
  assert.deepEqual(h.store.rules[0].fitText,fitText);assert.equal(h.store.rules[0].matchMode,'word');
 }
 delete h.store.rules[0].fitText;
 assert.equal((await h.send({type:'state'})).rules[0].fitText,undefined,'no fitting defaults introduced');
});

test('inline caller cannot select or mutate a different table than the current association',async()=>{
 const h=await setup(),state=await h.send({type:'state'}),linked=state.library.tables[0];
 state.library.tables.push({...structuredClone(linked),id:'alternate',name:'Alternate'});
 await h.send({type:'librarySave',library:state.library});
 assert.ok((await context(h,'New original',{tableId:'alternate'})).error);
 const c=await context(h);assert.equal(c.table.id,linked.id);assert.equal('tables' in c,false);
 assert.ok((await save(h,c,'New original','Bad',{tableId:'alternate'})).error);
 await h.send({type:'selectTable',url,tableId:'alternate'});assert.ok((await save(h,c)).error);
 const after=await h.send({type:'state'});assert.ok(after.library.tables.every(t=>!t.entries.some(e=>e.en==='New original')));
});

const remove=(h,c,original='New original',extra={},actor=sender)=>h.send({type:'inlineDelete',url,original,tableId:c.tableId,token:c.token,...extra},actor);
test('inline deletion persists only the linked existing row, broadcasts and rejects replay',async()=>{
 const h=await setup();await save(h,await context(h));const c=await context(h);
 const before=await h.send({type:'state'}),table=before.library.tables[0];h.sent.length=0;
 assert.equal((await remove(h,c)).deleted,true);
 const after=await h.send({type:'state'});assert.equal(after.library.tables[0].entries.some(e=>e.id===c.entry.id),false);
 assert.equal(after.library.tables[0].entries.length,table.entries.length-1);assert.equal(after.library.tables[0].revision,table.revision+1);
 assert.ok(h.sent.some(m=>m.type==='applyState'));assert.ok((await remove(h,c)).error);
 const restart=await harness(h.store,h.indexedDB);assert.equal((await restart.send({type:'state'})).library.tables[0].entries.some(e=>e.id===c.entry.id),false);
});

test('inline deletion rejects absent, stale, foreign, changed association and ambiguous rows without mutation',async()=>{
 const h=await setup();assert.ok((await remove(h,await context(h))).error);await save(h,await context(h));
 let c=await context(h);const unchanged=JSON.stringify((await h.send({type:'state'})).library);
 for(const [extra,actor] of [[{original:'Other'},sender],[{tableId:'other'},sender],[{}, {...sender,documentId:'other'}],[{}, {...sender,frameId:1}],[{}, {...sender,url:'https://evil.test/'}],[{url:'https://example.com/other'},sender]]){
  assert.ok((await remove(h,c,'New original',extra,actor)).error);assert.equal(JSON.stringify((await h.send({type:'state'})).library),unchanged);
 }
 assert.equal(await remove(h,c,'New original',{}, {...sender,id:'foreign'}),undefined);
 await save(h,await context(h),'New original','Changed');assert.ok((await remove(h,c)).error);
 c=await context(h);await h.send({type:'deleteRule',id:h.store.rules[0].id});assert.ok((await remove(h,c)).error);
 await h.send({type:'selectTable',url,tableId:c.tableId});c=await context(h);
 const [a,b]=await Promise.all([remove(h,c),remove(h,c)]);assert.equal(a.deleted,true);assert.ok(b.error);
 const state=await h.send({type:'state'}),table=state.library.tables[0],base=table.entries[0];
 table.entries.push({...base,id:'ambiguous1',en:'New original',context:'one',selector:''},{...base,id:'ambiguous2',en:'New original',context:'two',selector:''});
 await h.send({type:'librarySave',library:state.library});assert.ok((await remove(h,c)).error);assert.ok((await context(h)).error);
 table.entries=table.entries.filter(e=>e.id!=='ambiguous2');table.entries.find(e=>e.id==='ambiguous1').selector='.scoped';
 state.library.revision=(await h.send({type:'state'})).library.revision;await h.send({type:'librarySave',library:state.library});assert.ok((await context(h)).error);assert.ok((await remove(h,c)).error);
});

test('failed inline deletion transaction preserves row and revision and permits safe retry',async()=>{
 const h=await setup();await save(h,await context(h));const c=await context(h),before=JSON.stringify((await h.send({type:'state'})).library);
 const {IDBObjectStore}=await import('fake-indexeddb'),put=IDBObjectStore.prototype.put;
 try{IDBObjectStore.prototype.put=function(){throw Error('quota');};assert.match((await remove(h,c)).error,/quota/);}
 finally{IDBObjectStore.prototype.put=put;}
 assert.equal(JSON.stringify((await h.send({type:'state'})).library),before);assert.equal((await remove(h,c)).deleted,true);
});
