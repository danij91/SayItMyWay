const $ = s => document.querySelector(s);
let library, baseline, saveError='', selectedId=new URLSearchParams(location.search).get('table'), editingId, tableAction, busy=false;
const fields = ['en','ko','selector','notes'];
const current=()=>library?.tables.find(t=>t.id===selectedId);
const dialogBaselines=new Map();
const formSnapshot=form=>JSON.stringify([...form.querySelectorAll('input,select,textarea')].map(el=>[el.name||el.id,el.type==='checkbox'?el.checked:el.value]));
function dialogDirty(){return [...dialogBaselines].some(([id,value])=>$('#'+id).open&&formSnapshot($('#'+id+' form'))!==value);}
function watchDialog(id){dialogBaselines.set(id,formSnapshot($('#'+id+' form')));updateSaveState();}
function render() {
  const table=current();
  $('#table-select').replaceChildren(...library.tables.map(t=>Object.assign(new Option(t.name,t.id),{dir:'auto'})));
  $('#table-select').value=selectedId;
  for(const id of ['add','ai-request','table-copy','table-rename','table-delete','export-current'])$('#'+id).disabled=!table;
  $('#rows').replaceChildren();
  if(!table){TextPatchI18n.text($('#counts'),()=>TextPatchI18n.t('create_a_table'));return;}
  const entries = table.entries;
  TextPatchI18n.text($('#counts'),()=>TextPatchI18n.t('entry_counts',{total:entries.length}));
  const rows=CrimsonShared.filter(entries,$('#query').value);
  for(const e of rows){
    const tr=document.createElement('tr');
    for(const text of [e.en,e.ko||'—']){
      const td=document.createElement('td');td.dir='auto';td.textContent=text;tr.append(td);
    }
    const td=document.createElement('td'),editButton=document.createElement('button'),remove=document.createElement('button');
    TextPatchI18n.text(editButton,()=>'✎');TextPatchI18n.attribute(editButton,'title',()=>TextPatchI18n.t('edit_entry'));TextPatchI18n.attribute(editButton,'aria-label',()=>TextPatchI18n.t('edit_entry_2')+e.en);editButton.onclick=()=>edit(e);TextPatchI18n.text(remove,()=>'⌫');TextPatchI18n.attribute(remove,'title',()=>TextPatchI18n.t('delete_entry'));TextPatchI18n.attribute(remove,'aria-label',()=>TextPatchI18n.t('delete_entry_2')+e.en);remove.dataset.delete=e.id;
    remove.onclick=()=>{if(busy||!confirm(TextPatchI18n.t('delete_entry_p0',{p0:e.en})))return;const next=structuredClone(library);next.tables.find(t=>t.id===selectedId).entries=table.entries.filter(row=>row.id!==e.id);try{applyDraft(next);TextPatchI18n.text($('#message'),()=>TextPatchI18n.t('entry_removed_from_draft_save_changes_at_the'));}catch(error){TextPatchI18n.text($('#message'),()=>TextPatchI18n.message(error.message));}};
    td.append(editButton,remove);tr.append(td);$('#rows').append(tr);
  }
  if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=3;TextPatchI18n.text(td,()=>TextPatchI18n.t('no_search_results'));tr.append(td);$('#rows').append(tr);}
}
function dirty(){return !!library&&JSON.stringify(library)!==JSON.stringify(baseline);}
function updateSaveState(){
  $('#save-all').disabled=!dirty()||busy||importSaving||importChooser.pending;
  TextPatchI18n.text($('#save-state'),()=>busy?TextPatchI18n.t('saving'):saveError?TextPatchI18n.t('save_failed_2')+TextPatchI18n.message(saveError):dirty()||dialogDirty()?TextPatchI18n.t('unsaved_changes'):TextPatchI18n.t('saved_2'));
}
function applyDraft(next){
  if(busy)throw Error(TextPatchI18n.t('saving_please_try_again_shortly'));
  library=TextPatch.validateLibrary(next);loadToken++;saveError='';render();updateSaveState();
}
async function save(){
  if(busy||importSaving||importChooser.pending||!dirty())return;
  busy=true;loadToken++;saveError='';
  // Lock mutations until the submitted snapshot is acknowledged.
  const controls=[...document.querySelectorAll('input,select,textarea,button')].map(el=>[el,el.disabled]);
  for(const [el] of controls)el.disabled=true;
  updateSaveState();
  try{
    const result=await EditorStorage.save(library);
    library=TextPatch.validateLibrary(result);baseline=structuredClone(library);
    TextPatchI18n.text($('#message'),()=>TextPatchI18n.t('changes_saved'));
  }catch(error){saveError=TextPatchI18n.message(error.message);TextPatchI18n.text($('#message'),()=>TextPatchI18n.t('draft_preserved')+TextPatchI18n.message(error.message));}
  finally{busy=false;for(const [el,disabled] of controls)el.disabled=disabled;render();updateSaveState();}
}
$('#save-all').onclick=save;
window.addEventListener('beforeunload',event=>{if(dirty()||dialogDirty()){event.preventDefault();event.returnValue='';}});
for(const id of ['editor','table-editor']){
  $('#'+id).addEventListener('input',updateSaveState);
  $('#'+id).addEventListener('close',updateSaveState);
}
let loadToken=0;
function hasDraft(){return busy||dirty()||dialogDirty()||importSaving||importChooser.pending;}
async function load(){
  if(hasDraft())return;
  const token=++loadToken;
  try{
    const next=TextPatch.validateLibrary(await EditorStorage.load());
    // A storage notification can finish after the user starts editing.
    if(token!==loadToken||hasDraft())return;
    library=next;baseline=structuredClone(library);if(!current())selectedId=library.tables[0]?.id;render();updateSaveState();$('#load-retry').hidden=true;TextPatchI18n.text($('#message'),()=>'');
  }catch(error){if(token===loadToken&&!hasDraft()){$('#load-retry').hidden=false;TextPatchI18n.text($('#message'),()=>TextPatchI18n.message(error.message));}}
}
function edit(entry){
  if(busy)return;
  editingId=entry?.id;$('#form').reset();$('#entry-details').open=false;TextPatchI18n.text($('#form-error'),()=>'');TextPatchI18n.text($('#edit-title'),()=>entry?TextPatchI18n.t('edit_entry'):TextPatchI18n.t('add_entry'));
  if(entry)for(const field of fields)$('#form').elements[field].value=entry[field]??'';
  $('#editor').showModal();watchDialog('editor');
}
$('#form').addEventListener('submit',async event=>{
  event.preventDefault();$('#save').disabled=true;
  try{
    const next=structuredClone(library),table=next.tables.find(t=>t.id===selectedId),index=table.entries.findIndex(e=>e.id===editingId);
    const entry=index<0?{id:crypto.randomUUID()}:{...table.entries[index]};
    for(const field of fields)entry[field]=$('#form').elements[field].value;
    if(entry.selector)document.querySelector(entry.selector);
    if(index<0)table.entries.push(entry);else table.entries[index]=entry;
    applyDraft(next);$('#editor').close();updateSaveState();TextPatchI18n.text($('#message'),()=>TextPatchI18n.t('entry_applied_to_draft_save_changes_at_the'));
  }catch(error){$('#entry-details').open=true;TextPatchI18n.text($('#form-error'),()=>TextPatchI18n.message(error.message));}finally{$('#save').disabled=false;}
});
$('#form').addEventListener('invalid',()=>{$('#entry-details').open=true;},true);
for(const action of ['create','copy','rename'])$('#table-'+action).onclick=()=>{
  if(busy)return;
  tableAction=action;$('#table-name').value=action==='create'?'':current().name+(action==='copy'?TextPatchI18n.t('copy'):'');TextPatchI18n.text($('#table-error'),()=>'');$('#table-editor').showModal();
  watchDialog('table-editor');
};
$('#table-form').onsubmit=async event=>{
  event.preventDefault();const previous=selectedId;
  try{
    const name=$('#table-name').value.trim(),next=structuredClone(library);
    if(tableAction==='rename')next.tables.find(t=>t.id===selectedId).name=TextPatch.uniqueTableName(name,next.tables,selectedId);
    else{
      const table=tableAction==='copy'?structuredClone(current()):{schemaVersion:1,revision:1,description:'',entries:[],excludedTerms:[],excludedCategories:[],defaults:{matchMode:'exact',caseSensitive:false,translatePlaceholders:true}};
      table.id=crypto.randomUUID();table.name=TextPatch.uniqueTableName(name,next.tables);if(tableAction==='copy')for(const entry of table.entries)entry.id=crypto.randomUUID();table.revision=1;next.tables.push(table);selectedId=table.id;
    }
    applyDraft(next);$('#table-editor').close();updateSaveState();TextPatchI18n.text($('#message'),()=>TextPatchI18n.t('table_applied_to_draft_save_changes_at_the'));
  }catch(error){selectedId=previous;TextPatchI18n.text($('#table-error'),()=>TextPatchI18n.message(error.message));}
};
$('#table-select').onchange=()=>{selectedId=$('#table-select').value;const route=new URL(location.href);route.searchParams.set('table',selectedId);history.replaceState(null,'',route);$('#query').value='';render();};
$('#table-delete').onclick=async()=>{
  const table=current();if(busy || !table)return;
  try{
    // Count saved links without mutating settings. Confirmation itself, like
    // every other editor operation, changes only the local draft.
    let rules=[];
    if(globalThis.chrome?.runtime?.sendMessage){
      const state=await chrome.runtime.sendMessage({type:'state'});
      if(state.error)throw Error(state.error);
      rules=state.rules || [];
    }
    if(busy || current()!==table)return;
    const count=new Set(rules.filter(rule=>rule.tableId===table.id).map(rule=>rule.origin)).size;
    if(!confirm(TextPatchI18n.t('delete_table_confirm',{name:table.name,count})))return;
    const next=structuredClone(library);next.tables=next.tables.filter(t=>t.id!==table.id);
    selectedId=next.tables[0]?.id;
    applyDraft(next);
    TextPatchI18n.text($('#message'),()=>TextPatchI18n.t('table_deleted_draft'));
  }catch(error){TextPatchI18n.text($('#message'),()=>TextPatchI18n.message(error.message));}
};
$('#query').addEventListener('input',()=>library&&render());
$('#add').onclick=()=>current()&&edit();$('#cancel').onclick=()=>{$('#editor').close();updateSaveState();};$('#table-cancel').onclick=()=>{$('#table-editor').close();updateSaveState();};$('#load-retry').onclick=load;

let importSaving=false;
const importChooser=TextPatchImportUI.chooser({open:$('#import-open'),dialog:$('#import-editor'),fileInput:$('#import-file'),fileButton:$('#import-file-choice'),clipboardButton:$('#import-clipboard'),cancel:$('#import-cancel'),status:$('#import-error'),changed:updateSaveState,allowed:()=>!!library&&!busy&&!importSaving,consume:async(text,name)=>{
 importSaving=true;updateSaveState();
 try{
    if(TableImport.isAIResult(text)){
      if(dirty()||dialogDirty())throw Error(TextPatchI18n.t('ai_save_first'));
      const preview=await EditorStorage.ai('aiResultPreview',{text});
      if(!await TextPatchAIUI.confirmResult(preview))return false;
      if(dirty()||dialogDirty())throw Error(TextPatchI18n.t('ai_save_first'));
      const result=await EditorStorage.ai('aiResultApply',{text});
      library=TextPatch.validateLibrary(result.library);baseline=structuredClone(library);selectedId=result.tableIds[0];render();

      TextPatchI18n.text($('#message'),()=>TextPatchI18n.t('ai_result_preview',{filled:result.filled,preserved:result.preserved}));return;
    }
    // Merge against the latest draft after the asynchronous read.
    const result=TableImport.createNew(library,text,name.replace(/\.json$/i,''));
    const previous=selectedId;selectedId=result.tableIds[0];
    try{applyDraft(result.library);}catch(error){selectedId=previous;throw error;}

    TextPatchI18n.text($('#message'),()=>TextPatchI18n.t('imported_table_count',{count:result.tableIds.length}));
 }finally{importSaving=false;updateSaveState();}
}});
const importFiles=files=>importChooser.files(files);
$('#import-file').onchange=()=>importFiles([...$('#import-file').files]);
// Prevent navigation even when a file misses the visible drop target.
for(const type of ['dragover','drop'])document.addEventListener(type,event=>{event.preventDefault();});
$('#import-dropzone').addEventListener('dragover',event=>{event.preventDefault();event.dataTransfer.dropEffect=busy||importSaving?'none':'copy';});
$('#import-dropzone').addEventListener('drop',event=>{event.preventDefault();importFiles([...event.dataTransfer.files]);});
$('#export-current').onclick=()=>{
  try{
    const blob=new Blob([TableImport.exportPortable(library,selectedId)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=current().name+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);TextPatchI18n.text($('#message'),()=>TextPatchI18n.t('json_file_exported'));
  }catch(error){TextPatchI18n.text($('#message'),()=>TextPatchI18n.message(error.message));}
};
$('#ai-request').onclick=async()=>{
  try{
    if(!current())throw Error(TextPatchI18n.t('select_a_table_2'));
    if(!globalThis.TextPatchAIUI)throw Error(TextPatchI18n.t('could_not_load_the_ai_request_dialog_reload'));
    if(dirty()||dialogDirty())throw Error(TextPatchI18n.t('ai_save_first'));
    await TextPatchAIUI.open({table:current(),...(location.protocol==='chrome-extension:'?{recordRequest:async table=>(await EditorStorage.ai('aiRequestRecord',{table})).record}:{})});
  }catch(error){TextPatchI18n.text($('#message'),()=>TextPatchI18n.message(error.message));}
};

globalThis.chrome?.runtime?.onMessage?.addListener(message=>{if(message.type==='libraryChanged')load();});
globalThis.chrome?.storage?.onChanged?.addListener((changes,area)=>{if(area==='local'&&changes.libraryRevision)load();});
window.addEventListener('focus',load);
load();
// Language selection stays collapsed until the globe is activated.
const languageMenu=document.getElementById('editor-language');
languageMenu.querySelector('select').addEventListener('change',()=>{languageMenu.open=false;languageMenu.querySelector('summary').focus();});
document.addEventListener('click',event=>{if(!languageMenu.contains(event.target))languageMenu.open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape' && languageMenu.open){languageMenu.open=false;languageMenu.querySelector('summary').focus();event.preventDefault();}});
