const $=id=>document.getElementById(id);
let tab=null, state=null, origin=null, busy=false, importing=false, collecting=false, collection=null, reportGeneration=0;
const sites=TextPatchSites.mount({rows:$('rules'),status:$('sites-status'),onChange:()=>act({type:'state'})});
let sitesPanelRevision=0,sitesPanelExpanded=false;
function expandSites(expanded){sitesPanelExpanded=expanded;$('sites-list').open=expanded;}
function saveSitesExpansion(expanded){
  sitesPanelRevision++;
  expandSites(expanded);
  chrome.storage?.local?.set({sitesPanelExpanded:expanded}).catch(()=>{});
}
// Record the gesture synchronously: the native toggle event is queued and may
// arrive after the initial storage read, or after the popup has been closed.
$('sites-list').querySelector('summary').addEventListener('click',event=>{
  event.preventDefault();saveSitesExpansion(!$('sites-list').open);
});
$('sites-list').addEventListener('toggle',()=>{
  // Restoration also queues toggle; only a new state should be persisted.
  if($('sites-list').open!==sitesPanelExpanded)saveSitesExpansion($('sites-list').open);
  if($('sites-list').open)sites.load();
});
(async()=>{
  const revision=sitesPanelRevision;
  try{const stored=await chrome.storage?.local?.get(['sitesPanelExpanded']);if(revision===sitesPanelRevision && !$('sites-list').open)expandSites(stored?.sitesPanelExpanded===true);}catch{/* Default collapsed remains usable. */}
})();
const manager=id=>chrome.runtime.getURL('manager.html')+(id?'?table='+encodeURIComponent(id):'');
function notice(text=''){TextPatchI18n.text($('status'),()=>TextPatchI18n.message(text));$('status').hidden=!text;}
function available(){
  $('import-open').disabled=busy || importing || !state;
  $('table-search').disabled=busy || importing || !origin;
  for(const id of ['currency-enabled','currency-source','currency-target'])$(id).disabled=busy || !origin || !state;
  $('enabled').disabled=busy || !origin || !state?.page?.table;
  $('table').disabled=busy || !origin;
  const pending=!!collection?.pending?.length || !!collection?.needsCreate;
  const selected=state?.library.tables.find(t=>t.id===state.page?.table?.id);
  $('capture').hidden=!!collection?.active;
  $('capture').disabled=collecting || busy || !origin || !tab?.id || pending;
  $('capture-append').hidden=!!collection?.active || !selected;
  $('capture-append').disabled=$('capture').disabled;
  $('table-ai').disabled=busy || !selected;
  TextPatchI18n.attribute($('table-ai'),'title',()=>selected?TextPatchI18n.t('ai_selected_table',{name:selected.name}):TextPatchI18n.t('select_a_table'));
  $('collection-watch').hidden=!collection?.active;
  TextPatchI18n.text($('collection-watch'),()=>TextPatchI18n.t('collection_complete'));
  // A running watcher must remain stoppable during unrelated actions.
  $('collection-watch').disabled=collecting || (!collection?.active && busy);
  $('collection-retry').hidden=!collection?.error || !pending;
  $('collection-retry').disabled=collecting;
}
function renderCollection(){
  const snapshot=collection;
  $('collection-status').hidden=!collection;
  const exists=state?.library.tables.some(t=>t.id===snapshot?.tableId);
  $('collection-result-edit').hidden=!collection || snapshot.needsCreate===true || !exists || snapshot.active;
  if(collection){
    const counts=()=>TextPatchI18n.t('collection_counts',{first:snapshot.firstSaved??0,additional:snapshot.additionalSaved,total:snapshot.saved});
    TextPatchI18n.text($('collection-status'),()=>TextPatchI18n.t('capture_destination',{name:state?.library.tables.find(t=>t.id===snapshot.tableId)?.name || snapshot.tableName || TextPatchI18n.t('collected_table')})+' · '+(snapshot.active?TextPatchI18n.t('collection_activity')+' · ':TextPatchI18n.message(snapshot.reason || TextPatchI18n.t('collection_complete_2'))+' · ')+counts()+(!exists && !snapshot.needsCreate?' · '+TextPatchI18n.t('collection_deleted'):'')+(snapshot.error?' · '+TextPatchI18n.t('collection_pending',{count:snapshot.pending.length}):''));
    $('collection-result-edit').href=manager(snapshot.tableId);
    const resultLink=$('collection-result-edit'),label=document.createElement('span'),name=document.createElement('bdi');resultLink.removeAttribute('data-i18n');TextPatchI18n.text(label,()=>TextPatchI18n.t('edit_table'));TextPatchI18n.text(name,()=>state?.library.tables.find(t=>t.id===snapshot.tableId)?.name || snapshot.tableName || TextPatchI18n.t('collected_table'));resultLink.replaceChildren(label,name);
  }
  available();
}
async function pageReport(){
  const generation=++reportGeneration;
  const page=state?.page;
  $('enabled').checked=page?.enabled===true && !!page.table && !page.missingPermission;
  if(!origin){TextPatchI18n.text($('page-status'),()=>TextPatchI18n.t('use_this_on_a_regular_web_page'));return;}
  if(!page?.table){TextPatchI18n.text($('page-status'),()=>TextPatchI18n.t('no_table_is_available'));return;}
  if(page.missingPermission){TextPatchI18n.text($('page-status'),()=>TextPatchI18n.t('replacement_off_turn_on_the_checkbox_to_allow'));return;}
  if(!page.enabled){TextPatchI18n.text($('page-status'),()=>TextPatchI18n.t('replacement_off_showing_original_text'));return;}
  try{
    const report=await chrome.tabs.sendMessage(tab.id,{type:'diagnostics'});
    if(generation!==reportGeneration)return;
    if(report.error || report.tableId!==page.table.id)throw Error(report.error || TextPatchI18n.t('table_not_applied'));
    TextPatchI18n.text($('page-status'),()=>report.enabled?(report.translated>0?TextPatchI18n.t('active_replacement_count',{count:report.translated}):TextPatchI18n.t('0_replacements_no_matching_original_text')):TextPatchI18n.t('not_applied_yet_reload_the_page'));
  }catch{if(generation===reportGeneration)TextPatchI18n.text($('page-status'),()=>TextPatchI18n.t('apply_failed_reload_the_page'));}
}
let tableOpen=false,tableActive=-1,tableMatches=[];
function closeTables(){
 tableOpen=false;$('table-list').hidden=true;$('table-search').setAttribute('aria-expanded','false');$('table-search').removeAttribute('aria-activedescendant');
 $('table-search').value=state?.library.tables.find(t=>t.id===state.page?.table?.id)?.name || '';
}
function renderTableList(){
 const query=$('table-search').value.trim().toLocaleLowerCase();
 tableMatches=state.library.tables.filter(t=>t.name.toLocaleLowerCase().includes(query));
 if(tableActive>=tableMatches.length)tableActive=-1;
 const options=tableMatches.map((table,index)=>{
  const option=document.createElement('div');option.id='table-option-'+index;option.role='option';option.dir='auto';option.dataset.tableId=table.id;
  option.setAttribute('aria-selected',String(table.id===state.page?.table?.id));option.classList.toggle('active',index===tableActive);
  TextPatchI18n.text(option,()=>table.name);
  option.onmousedown=event=>event.preventDefault();
  option.onclick=()=>chooseTable(table.id);
  return option;
 });
 if(!options.length){const empty=document.createElement('p');empty.role='status';TextPatchI18n.text(empty,()=>TextPatchI18n.t('no_search_results'));options.push(empty);}
 $('table-list').replaceChildren(...options);$('table-list').hidden=!tableOpen;
 $('table-search').setAttribute('aria-expanded',String(tableOpen));
 if(tableActive>=0){const id='table-option-'+tableActive;$('table-search').setAttribute('aria-activedescendant',id);$(id)?.scrollIntoView?.({block:'nearest'});}
 else $('table-search').removeAttribute('aria-activedescendant');
}
function openTables(){
 if($('table-search').disabled || !state)return;
 if(!tableOpen){tableOpen=true;tableActive=-1;$('table-search').value='';}
 renderTableList();
}
function chooseTable(id){
 if(!origin || busy || importing)return;
 $('table').value=id;closeTables();notice();act({type:'selectTable',tableId:id});
}
function renderTables(){
    const selected=state.page?.table?.id || '';
    const empty=document.createElement('option');empty.value='';TextPatchI18n.text(empty,()=>TextPatchI18n.t('select_a_table'));empty.disabled=true;
    $('table').replaceChildren(empty,...state.library.tables.map(t=>{const o=document.createElement('option');o.value=t.id;o.dir='auto';TextPatchI18n.text(o,()=>t.name);return o;}));
    $('table').value=selected;
    if(tableOpen)renderTableList();else closeTables();
}
let currencyPanelRevision=0, currencyRefreshing=false, currencyRefreshFailed=false;
function expandCurrency(expanded){
  $('currency-body').hidden=!expanded;
  $('currency-expand').setAttribute('aria-expanded',String(expanded));
}
$('currency-expand').onclick=()=>{
  currencyPanelRevision++;
  const expanded=$('currency-body').hidden;
  expandCurrency(expanded);
  chrome.storage?.local?.set({currencyPanelExpanded:expanded}).catch(()=>{});
};
(async()=>{
  const revision=currencyPanelRevision;
  try{const stored=await chrome.storage?.local?.get(['currencyPanelExpanded']);if(revision===currencyPanelRevision)expandCurrency(stored?.currencyPanelExpanded===true);}catch{/* Default collapsed remains usable. */}
})();
function renderCurrencyRates(){
  const rates=state?.currencyRates;
  TextPatchI18n.text($('currency-note'),()=>rates?.date?TextPatchI18n.t('currency_note',{date:'⁨'+rates.date+'⁩'}):'ECB');
  const refreshing=currencyRefreshing || rates?.refreshing===true;
  $('currency-refresh').disabled=refreshing || !state;
  $('currency-refresh').setAttribute('aria-busy',String(refreshing));
  const labels=[];
  if(rates?.status==='cached' || rates?.status==='bundled')labels.push('currency_'+rates.status);
  if(rates?.error || currencyRefreshFailed)labels.push('currency_refresh_failed');
  $('currency-rate-status').hidden=!labels.length;
  TextPatchI18n.text($('currency-rate-status'),()=>labels.map(key=>TextPatchI18n.t(key)).join(' · '));
}
$('currency-refresh').onclick=async()=>{
  if(currencyRefreshing || state?.currencyRates?.refreshing || !state)return;
  currencyRefreshing=true;currencyRefreshFailed=false;renderCurrencyRates();
  try{
    const result=await chrome.runtime.sendMessage({type:'refreshCurrencyRates',url:tab?.url});
    if(!result || typeof result.error==='string')throw Error('refresh');
    // A refresh only changes rate metadata; concurrent site/table actions own their state.
    state.currencyRates=result.currencyRates;
  }catch{currencyRefreshFailed=true;}
  finally{currencyRefreshing=false;renderCurrencyRates();}
};
function renderState(){
    renderCurrencyRates();
    const names=new Intl.DisplayNames([TextPatchI18n.locale || 'en'],{type:'currency'});
    for(const id of ['currency-source','currency-target'])for(const option of $(id).options){
      if(/^[A-Z]{3}$/.test(option.value))TextPatchI18n.text(option,()=>option.value+' · '+names.of(option.value));
    }
    const currency=state.page?.currency || {enabled:false,source:'auto',target:'USD'};
    $('currency-enabled').checked=currency.enabled;
    $('currency-source').value=currency.source;
    $('currency-target').value=currency.target;
    renderTables();
    $('table-edit').hidden=!state.page?.table;
    if(state.page?.table)$('table-edit').href=manager(state.page.table.id);
}
$('table-search').addEventListener('focus',openTables);
$('table-search').addEventListener('click',openTables);
$('table-search').addEventListener('input',()=>{if(state){tableOpen=true;tableActive=-1;renderTableList();}});
$('table-search').addEventListener('blur',closeTables);
$('table-search').addEventListener('keydown',event=>{
  if(event.isComposing)return;
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
   if(!tableOpen && ['Home','End'].includes(event.key))return;
   event.preventDefault();openTables();
   if(event.key==='Home')tableActive=0;
   else if(event.key==='End')tableActive=tableMatches.length-1;
   else tableActive=event.key==='ArrowDown'?Math.min(tableActive+1,tableMatches.length-1):(tableActive<0?tableMatches.length-1:Math.max(0,tableActive-1));
   renderTableList();
  }
  if(event.key==='Enter' && tableOpen){event.preventDefault();if(tableMatches[tableActive])chooseTable(tableMatches[tableActive].id);}
  if(event.key==='Escape' && tableOpen){event.preventDefault();closeTables();}
});
function closeLanguages(){const open=!$('language-menu').hidden;$('language-menu').hidden=true;$('language-open').setAttribute('aria-expanded','false');return open;}
$('language-open').onclick=()=>{const opening=$('language-menu').hidden;closeTables();closeLanguages();if(opening){$('language-menu').hidden=false;$('language-open').setAttribute('aria-expanded','true');$('app-locale').focus();}};
$('app-locale').addEventListener('change',()=>{closeLanguages();$('language-open').focus();});
document.addEventListener('click',event=>{if(!event.target.closest('#language-menu,#language-open'))closeLanguages();});
document.addEventListener('keydown',event=>{if(event.key==='Escape' && closeLanguages()){$('language-open').focus();event.preventDefault();}});
$('import-open').onclick=()=>{if(!busy && !importing)$('import-file').click();};
$('import-file').onchange=async()=>{
  const files=[...$('import-file').files];
  if(!files.length || importing || busy)return;
  importing=true;available();$('import-status').hidden=false;
  TextPatchI18n.text($('import-status'),()=>TextPatchI18n.t('popup_import_saving'));
  try{
    if(files.length!==1)throw Error(TextPatchI18n.t('import_one_json_file_at_a_time'));
    const file=files[0];
    if(!/\.json$/i.test(file.name))throw Error(TextPatchI18n.t('select_a_json_file'));
    if(file.size>5_000_000)throw Error(TextPatchI18n.t('json_files_must_be_5mb_or_smaller'));
    const text=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error(TextPatchI18n.t('could_not_read_the_file')));reader.readAsText(file);});
    let result;
    if(TableImport.isAIResult(text)){
      const preview=await chrome.runtime.sendMessage({type:'aiResultPreview',text});
      if(preview.error)throw Error(preview.error);
      if(!await TextPatchAIUI.confirmResult(preview))return;
      result=await chrome.runtime.sendMessage({type:'aiResultApply',text});
      result.notice=TextPatchI18n.t('ai_result_preview',{filled:result.filled,preserved:result.preserved});
    }else result=await chrome.runtime.sendMessage({type:'importTables',text,fileName:file.name,url:tab?.url});
    if(result.error)throw Error(result.error);
    // Reload through the same path as repository notifications; no selection
    // message is sent, so importing cannot enable or replace the applied table.
    await act({type:'state'});
    TextPatchI18n.text($('import-status'),()=>TextPatchI18n.message(result.notice));
  }catch(error){TextPatchI18n.text($('import-status'),()=>TextPatchI18n.message(error.message));}
  finally{importing=false;$('import-file').value='';available();}
};
async function act(message){
  busy=true;available();
  try{
    const result=await chrome.runtime.sendMessage({...message,url:tab?.url});
    if(result.error)throw Error(result.error);
    state=result;
    if(state.currencyRates?.status==='current' && !state.currencyRates.error && !state.currencyRates.refreshing)currencyRefreshFailed=false;
    renderState();
    if($('sites-list').open)sites.load(state);
    if(message.type==='activateSite' || result.notice)notice(result.notice || '');
    await pageReport();renderCollection();
    return true;
  }catch(e){notice(TextPatchI18n.message(e.message));await pageReport();return false;}
  finally{busy=false;available();}
}
$('table').addEventListener('change',()=>{
  if(!origin || busy)return;
  notice();act({type:'selectTable',tableId:$('table').value});
});
$('enabled').addEventListener('change',()=>{
  const enabled=$('enabled').checked;
  if(!enabled){act({type:'toggleSite',enabled:false});return;}
  notice(TextPatchI18n.t('checking_site_access'));
  // Send before any await: the background requests permission on this gesture
  // stack and owns the entire continuation even if this popup is disposed.
  act({type:'activateSite',tabId:tab.id,tableId:state.page.table.id,attemptId:crypto.randomUUID()});
});
function saveCurrency(activate=false){
  if(!origin || busy)return;
  const currency={enabled:$('currency-enabled').checked,source:$('currency-source').value,target:$('currency-target').value};
  act({type:activate && currency.enabled?'activateCurrency':'saveCurrency',currency});
}
$('currency-enabled').addEventListener('change',()=>saveCurrency(true));
$('currency-source').addEventListener('change',()=>saveCurrency());
$('currency-target').addEventListener('change',()=>saveCurrency());
$('options').href=manager();
async function collectionAction(type,mode){
  if(collecting)return;
  collecting=true;available();if(type!=='collectionState')notice();
  if(type==='collectionBegin'){
    TextPatchI18n.text($('capture'),()=>TextPatchI18n.t('collecting_and_saving'));
    $('collection-status').hidden=false;TextPatchI18n.text($('collection-status'),()=>TextPatchI18n.t('collecting_and_saving_original_text'));
  }
  try{
    const result=await chrome.runtime.sendMessage({type,tabId:tab.id,...(mode==='append'?{mode,tableId:state.page?.table?.id}:{})});
    if(result.error)throw Error(result.error);
    collection=result.collection;
    await act({type:'state'});renderCollection();
  }catch(e){notice(TextPatchI18n.message(e.message));}
  finally{collecting=false;TextPatchI18n.text($('capture'),()=>TextPatchI18n.t('capture_new'));renderCollection();}
}
$('capture').addEventListener('click',()=>collectionAction('collectionBegin'));
$('collection-watch').addEventListener('click',()=>collectionAction('collectionStop'));
$('capture-append').addEventListener('click',()=>collectionAction('collectionBegin','append'));
$('table-ai').addEventListener('click',async()=>{
  const table=state?.library.tables.find(t=>t.id===state.page?.table?.id);
  if(!table || busy)return;
  try{
    await TextPatchAIUI.open({table,page:{url:tab.url,title:tab.title || ''},
      recordRequest:async table=>{const result=await chrome.runtime.sendMessage({type:'aiRequestRecord',table});if(result.error)throw Error(result.error);return result.record;},
      loadPreferences:async()=>(await chrome.storage.local.get(['aiRequestPreferences'])).aiRequestPreferences,
      savePreferences:async preferences=>chrome.storage.local.set({aiRequestPreferences:preferences})});
  }catch(e){notice(TextPatchI18n.message(e.message));}
});
$('collection-retry').addEventListener('click',()=>collectionAction('collectionRetry'));
chrome.runtime.onMessage?.addListener(message=>{
  if(message.type==='currencyRatesChanged' && state)act({type:'state'});
});
chrome.storage?.onChanged.addListener((changes,area)=>{
  if(area!=='local')return;
  if(changes.currencyPanelExpanded){currencyPanelRevision++;expandCurrency(changes.currencyPanelExpanded.newValue===true);}
  if(changes.sitesPanelExpanded){sitesPanelRevision++;expandSites(changes.sitesPanelExpanded.newValue===true);}
  if(changes.libraryRevision && state)act({type:'state'});
  if(changes.collections && tab)collection=changes.collections.newValue?.[String(tab.id)] || null;
  renderCollection();
  if(state && ['currencyRateCache','currencyRateAttempt','currencyPreferences','originEnabled','enabled','rules','interactionSettings'].some(key=>key in changes))act({type:'state'});
});
(async()=>{
  try{[tab]=await chrome.tabs.query({active:true,currentWindow:true});const url=TextPatch.webURL(tab?.url);origin=url.origin;TextPatchI18n.text($('site'),()=>url.host);}
  catch{TextPatchI18n.text($('site'),()=>TextPatchI18n.t('regular_web_page'));}
  await act({type:'state'});
  await act({type:'refresh'});
  if(origin && tab?.id)await collectionAction('collectionState');
})();


let settingsDraft=null,settingsSaved=null,settingsRevision=0,settingsConfirmedRevision=0,settingsPending=0,settingsOpenGeneration=0,recording=null,modifierCandidate=null;
function settingStatus(key=''){TextPatchI18n.text($('shortcuts-status'),()=>key?TextPatchI18n.t(key):'');}
function renderSettings(){
 if(!settingsDraft)return;
 for(const feature of ['peek','edit']){
  const key=feature+'Key',button=$(feature+'-key');
  TextPatchI18n.text(button,()=>recording===key?TextPatchI18n.t('interaction_recording'):TextPatchInteraction.label(settingsDraft[key]));
  TextPatchI18n.attribute(button,'aria-label',()=>TextPatchI18n.t(feature==='peek'?'interaction_peek_key':'interaction_edit_key')+': '+TextPatchInteraction.label(settingsDraft[key]));
  button.setAttribute('aria-pressed',String(recording===key));
  button.disabled=!settingsDraft[feature+'Enabled'];
  $(feature+'-enabled').checked=settingsDraft[feature+'Enabled'];
  $(feature+'-enabled').disabled=false;
 }
 for(const feature of ['peek','edit']){
  const mode=settingsDraft[feature+'Mode'] || 'hold';
  for(const button of $(feature+'-mode').querySelectorAll('button')){button.setAttribute('aria-pressed',String(button.dataset.mode===mode));button.disabled=!settingsDraft[feature+'Enabled'];}
  TextPatchI18n.text($(feature+'-mode-help'),()=>TextPatchI18n.t('interaction_'+feature+'_'+mode+'_hint'));
 }
}
function stopRecording(){recording=null;modifierCandidate=null;renderSettings();}
function changeSetting(key,value){submitSettings({...settingsDraft,[key]:value});}
function submitSettings(candidate){
 settingsDraft=TextPatchInteraction.validate(candidate);
 const revision=++settingsRevision,interactionSettings=structuredClone(settingsDraft);
 settingStatus();renderSettings();saveSettings(interactionSettings,revision);
}
function confirmSettings(value,revision){
 if(revision<settingsConfirmedRevision)return;
 settingsConfirmedRevision=revision;settingsSaved=structuredClone(value);
 if(state)state.interactionSettings=structuredClone(settingsSaved);
}
async function saveSettings(interactionSettings,revision){
 settingsPending++;
 // Dispatch every complete intent immediately so closing the popup cannot drop
 // unsent edits. The background message queue serializes the storage writes.
 try{
  const result=await chrome.runtime.sendMessage({type:'saveInteractionSettings',interactionSettings,url:tab?.url});
  if(result.error)throw Error(result.error);
  // Do not replace unrelated page/library state with an older response.
  confirmSettings(interactionSettings,revision);
 }catch(error){
  if(revision!==settingsRevision)return;
  let saved=settingsSaved;
  // A lost response can follow a successful write. Read storage itself rather
  // than assuming either success or failure from the transport error.
  try{
   const stored=await chrome.storage.local.get(['interactionSettings']);
   saved=TextPatchInteraction.validate(stored.interactionSettings || TextPatchInteraction.defaults);
  }catch{/* Retain the last confirmed settings if reconciliation also fails. */}
  if(revision!==settingsRevision)return;
  confirmSettings(saved,revision);settingsDraft=structuredClone(saved);stopRecording();
  const message=()=>TextPatchI18n.t('save_failed_3')+TextPatchI18n.message(error.message);
  TextPatchI18n.text($('shortcuts-status'),message);
  if($('interaction-view').hidden)notice(message());
 }finally{settingsPending--;}
}
function closeSettings(){settingsOpenGeneration++;document.body.classList.remove('settings-open');stopRecording();$('interaction-view').hidden=true;$('main-view').hidden=false;$('settings-open').hidden=false;$('settings-open').focus();}
$('settings-open').onclick=async()=>{
 if(!state)return;
 closeTables();closeLanguages();
 const generation=++settingsOpenGeneration,revision=settingsRevision;
 if(!settingsDraft || !settingsPending){settingsSaved=TextPatchInteraction.validate(state.interactionSettings || TextPatchInteraction.defaults);settingsDraft=structuredClone(settingsSaved);}
 recording=null;modifierCandidate=null;renderSettings();
 document.body.classList.add('settings-open');$('main-view').hidden=true;$('interaction-view').hidden=false;$('settings-open').hidden=true;$('interaction-back').focus();
 if(settingsPending)return;
 try{
  const stored=await chrome.storage.local.get(['interactionSettings']);
  if(generation!==settingsOpenGeneration || revision!==settingsRevision || settingsPending)return;
  confirmSettings(TextPatchInteraction.validate(stored.interactionSettings || TextPatchInteraction.defaults),revision);
  settingsDraft=structuredClone(settingsSaved);renderSettings();
 }catch{/* Keep the current snapshot usable when storage cannot be read. */}
};
$('interaction-back').onclick=closeSettings;
for(const feature of ['peek','edit'])for(const button of $(feature+'-mode').querySelectorAll('button'))button.onclick=()=>{const mode=button.dataset.mode;stopRecording();changeSetting(feature+'Mode',mode);};
for(const feature of ['peek','edit']){
 $(feature+'-key').onclick=()=>{
  if(!settingsDraft[feature+'Enabled'])return;
  recording=feature+'Key';modifierCandidate=null;settingStatus();renderSettings();
 };
 $(feature+'-enabled').onchange=()=>{
  const enabled=$(feature+'-enabled').checked;
  stopRecording();
  const candidate={...settingsDraft,[feature+'Enabled']:enabled};
  if(enabled && !candidate[feature+'Key']){
   const fallback=TextPatchInteraction.defaults[feature+'Key'];
   for(const binding of [fallback,{...fallback,code:'F2'},{...fallback,code:'F3'}]){
    candidate[feature+'Key']=structuredClone(binding);
    try{TextPatchInteraction.validate(candidate);break;}catch{/* Try an unused default. */}
   }
  }
  try{submitSettings(candidate);}
  catch{settingStatus('interaction_invalid');}
  renderSettings();
 };
}
function recordBinding(binding){
 const key=recording;
 try{TextPatchInteraction.validate({...settingsDraft,[key]:binding});}
 catch{modifierCandidate=null;settingStatus('interaction_invalid');return;}
 stopRecording();changeSetting(key,binding);$(key==='peekKey'?'peek-key':'edit-key').focus();
}
document.addEventListener('keydown',event=>{
 if(!recording)return;
 event.preventDefault();event.stopPropagation();
 if(event.key==='Escape' || event.code==='Escape'){stopRecording();settingStatus();return;}
 if(event.repeat || event.isComposing || event.keyCode===229)return;
 try{
  const binding=TextPatchInteraction.fromEvent(event);
  if(TextPatchInteraction.isModifier(event.code))modifierCandidate=binding;
  else recordBinding(binding);
 }catch{modifierCandidate=null;settingStatus('interaction_invalid');}
},true);
document.addEventListener('keyup',event=>{
 if(!recording)return;
 event.preventDefault();event.stopPropagation();
 if(modifierCandidate && event.code===modifierCandidate.code)recordBinding(modifierCandidate);
},true);
window.addEventListener('blur',()=>{if(recording){stopRecording();settingStatus();}});
// Enter must not submit or navigate this automatically persisted settings view.
$('shortcuts-form').onsubmit=event=>event.preventDefault();

TextPatchI18n.onChange(()=>{if(state)renderState();});
