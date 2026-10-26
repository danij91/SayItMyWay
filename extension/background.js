importScripts('locales/ko.js','locales/en.js','locales/ja.js','locales/zh-Hans.js','locales/zh-Hant.js','locales/es.js','locales/fr.js','locales/de.js','locales/pt-BR.js','locales/ru.js','locales/id.js','locales/vi.js','locales/th.js','locales/hi.js','locales/ar.js','i18n.js','interaction-settings.js','currency-rates.js','currency.js','currency-feed.js','shared.js', 'library.js', 'collection.js', 'repository.js', 'editor/import.js');
const repository = LibraryRepository.create();
const scripts = ['shared.js', 'library.js', 'currency-rates.js', 'currency.js', 'engine.js', 'interaction-settings.js', 'page-tools.js', 'content.js'];
let queue = Promise.resolve();
const serialized = work => (queue = queue.catch(() => {}).then(work));
const currencyFeed=TextPatchCurrencyFeed.create({storage:chrome.storage.local,fetch,onChange:()=>{
  chrome.runtime.sendMessage?.({type:'currencyRatesChanged'}).catch(()=>{});
  serialized(async()=>sync(await initial())).catch(console.warn);
}});
let currencyActive=false;
const currencyAlarm='text-patch-currency-rates';
async function scheduleCurrency(state){
  const enabled=Object.values(state.currencyPreferences).some(value=>value.enabled===true);
  if(enabled){
    if(!await chrome.alarms.get(currencyAlarm))await chrome.alarms.create(currencyAlarm,{periodInMinutes:360});
  }else await chrome.alarms.clear(currencyAlarm);
  const activate=enabled && !currencyActive;currencyActive=enabled;
  if(activate)void currencyFeed.refreshIfDue();
}


function libraryData(value) {
  // Optional defaults may be omitted individually by older local servers/backups.
  if (Array.isArray(value?.tables)) for (const table of value.tables) {
    if (table && (table.defaults == null || (typeof table.defaults === 'object' && !Array.isArray(table.defaults)))) {
      table.defaults = {matchMode:'exact',caseSensitive:false,translatePlaceholders:true,...table.defaults};
    }
  }
  return TextPatch.validateLibrary(value);
}
async function initial() {
  await TextPatchI18n.ready;
  await currencyFeed.ready;
  const state = await chrome.storage.local.get(['library','dictionary','enable','enabled','originEnabled','loadedAt','rules','offline','activationIntents','interactionSettings','currencyPreferences']);
  const patch = {};
  state.library=await repository.initialize(async()=>{
    const bundle=await LibraryRepository.bundled(fetch,chrome.runtime.getURL);
    const cache=state.library ?? (state.dictionary ? TextPatch.migrate(state.dictionary) : null);
    if(cache || bundle)return LibraryRepository.mergeMigration(cache,bundle);
    return {schemaVersion:2,revision:1,tables:[]};
  });
  state.interactionSettings=TextPatchInteraction.validate(state.interactionSettings);
  state.offline=false;
  if (!Array.isArray(state.rules)) patch.rules = state.rules = [];
  const previousRules=JSON.stringify(state.rules);
  TextPatch.seedRuleOptions(state.rules,state.library);TextPatch.validateRules(state.rules);
  if(previousRules!==JSON.stringify(state.rules))patch.rules=state.rules;
  if (state.enabled === undefined) patch.enabled = state.enabled = state.enable !== false;
  state.enabled = state.enabled !== false;
  state.originEnabled ??= {};
  state.currencyPreferences ??= {};
  state.activationIntents ??= {};
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  return state;
}
async function granted(origin) {
  return chrome.permissions.contains({origins:[TextPatch.hostPattern(origin)]});
}
async function pageState(state, url) {
  const rule = TextPatch.selectRule(state.rules, url);
  const table = state.library.tables.find(t => t.id === rule?.tableId) || null;
  let origin=null;try{origin=TextPatch.webURL(url).origin;}catch{}
  const permitted = origin ? await granted(origin) : false;
  const currency=TextPatchCurrency.preferences(state.currencyPreferences[origin]);
  currency.enabled=currency.enabled && permitted;
  const siteEnabled=rule ? (state.originEnabled[rule.origin] ?? state.enabled) : false;
  const locale=TextPatchI18n.locale;
  const keys=['inline_delete','inline_delete_confirm','inline_delete_cancel','inline_delete_help','inline_reload','inline_title','inline_original','inline_replacement','inline_table','inline_save','inline_cancel','inline_saved','inline_loading','inline_no_table','inline_conflict','inline_error','inline_ambiguous','inline_edit_hint','peek_active'];
  const interactionUI={locale,dir:locale==='ar'?'rtl':'ltr',strings:Object.fromEntries(keys.map(key=>[key,TextPatchI18n.t(key)]))};
  return {currency,currencySnapshot:currencyFeed.snapshot(),interactionSettings:state.interactionSettings,interactionUI,enabled:siteEnabled && rule?.enabled===true && !!table && permitted, siteEnabled,
    rule, table, missingPermission:!!rule && !permitted, offline:state.offline === true, loadedAt:state.loadedAt};
}
async function sync(state) {
  await scheduleCurrency(state);
  const matches = [];
  for (const rule of state.rules) {
    if ((state.originEnabled[rule.origin] ?? state.enabled) && rule.enabled && state.library.tables.some(t=>t.id===rule.tableId) && await granted(rule.origin)) matches.push(TextPatch.hostPattern(rule.origin));
  }
  for(const [origin,prefs] of Object.entries(state.currencyPreferences)){
    if(prefs.enabled && await granted(origin))matches.push(TextPatch.hostPattern(origin));
  }
  const current = await chrome.scripting.getRegisteredContentScripts();
  const owned = current.filter(s=>s.id.startsWith('text-patch-'));
  const desired=[...new Set(matches)].sort();
  const unchanged=owned.length===1 && owned[0].id==='text-patch-sites' &&
    JSON.stringify([...owned[0].matches].sort())===JSON.stringify(desired) && JSON.stringify(owned[0].js)===JSON.stringify(scripts);
  if(!unchanged){
    if (owned.length) await chrome.scripting.unregisterContentScripts({ids:owned.map(s=>s.id)});
    if (desired.length) await chrome.scripting.registerContentScripts([{id:'text-patch-sites',matches:desired,js:scripts,runAt:'document_idle',persistAcrossSessions:true}]);
  }
  // Message all reachable existing instances, including those whose permission was revoked.
  for (const tab of await chrome.tabs.query({})) {
    await syncTab(state,tab);
  }
}
async function libraryChanged(library){
  try{
    const loadedAt=new Date().toISOString();
    await chrome.storage.local.set({loadedAt,offline:false,libraryRevision:library.revision});
    const state=await initial();await sync(state);
  }catch(error){console.warn('Library notification failed:',error.message);}
  // Existing popup/options listeners use storage.onChanged; libraryRevision is
  // an invalidation signal, never another copy of the canonical library.
  try{await chrome.runtime.sendMessage({type:'libraryChanged',revision:library.revision});}catch{/* No extension view is open. */}
}
async function syncTab(state,tab){
  if(!tab.id)return;
  const page=await pageState(state,tab.url || '');
  try { await chrome.tabs.sendMessage(tab.id,{type:'applyState',state:page}); }
  catch {
    if(!page.enabled && !page.currency.enabled)return;
    try {
      await chrome.scripting.executeScript({target:{tabId:tab.id},files:scripts});
      await chrome.tabs.sendMessage(tab.id,{type:'applyState',state:page});
    } catch { /* restricted or closing tab */ }
  }
}
function settings(state) {
  return {schemaVersion:1,enabled:state.enabled,originEnabled:state.originEnabled ?? {},rules:state.rules,interactionSettings:state.interactionSettings};
}
function validateSettings(value, library) {
  if (value?.schemaVersion!==1 || typeof value.enabled!=='boolean') throw Error(TextPatchI18n.t('invalid_settings_format'));
  TextPatch.validateRules(value.rules,library);
  TextPatch.seedRuleOptions(value.rules,library);
  const originEnabled=value.originEnabled===undefined ? {} : value.originEnabled;
  if(!originEnabled || typeof originEnabled!=='object' || Array.isArray(originEnabled) || Object.keys(originEnabled).length>500)throw Error(TextPatchI18n.t('invalid_site_enabled_settings'));
  for(const [origin,enabled] of Object.entries(originEnabled)){
    if(TextPatch.webURL(origin).origin!==origin || typeof enabled!=='boolean')throw Error(TextPatchI18n.t('invalid_site_enabled_settings'));
  }
  return {schemaVersion:1,enabled:value.enabled,originEnabled,rules:value.rules,interactionSettings:TextPatchInteraction.validate(value.interactionSettings)};
}
function importData(data,state) {
  if (data?.kind === 'text-patch-bundle') {
    if(data.schemaVersion!==1)throw Error(TextPatchI18n.t('unsupported_bundle_version'));
    const library=libraryData(data.library);
    return {library,...validateSettings(data.settings,library)};
  }
  return validateSettings(data,state.library);
}
// Persist before DB writes so a closed popup or restarted worker retains pending originals.
async function collectionState(tabId) {
  const {collections={}}=await chrome.storage.local.get(['collections']);
  const session=collections[String(tabId)] || null;
  // Retire creation authority from sessions saved by earlier workers as well.
  if(session?.createName && !session.needsCreate){delete session.createName;await persistCollection(session);}
  return session;
}
async function persistCollection(session, appearance=true) {
  const {collections={}}=await chrome.storage.local.get(['collections']);
  collections[String(session.tabId)]=session;
  await chrome.storage.local.set({collections});
  if(appearance)await collectionAppearance(session);
}
const missingTab=error=>/No tab with id:|Invalid tab ID:/i.test(error?.message || '');
async function retireClosedCollection(session){
  session.closed=true;session.active=false;
  session.reason=TextPatchI18n.t('tab_closed_you_can_retry_saving_the_retained');
  await persistCollection(session,false);
}
function actionCall(method,details){
  return new Promise((resolve,reject)=>{
    // lastError exists only during this callback. Awaiting the API return does
    // not consume callback-only errors (notably setIcon image loading).
    chrome.action[method](details,()=>{
      const error=chrome.runtime.lastError;
      error?reject(Error(error.message)):resolve();
    });
  });
}
async function collectionAppearance(session) {
  if(session.closed)return;
  try{await chrome.tabs.get(session.tabId);}catch(error){
    if(missingTab(error)){await retireClosedCollection(session);return;}
    console.warn('Collection toolbar tab lookup failed:',error.message);return;
  }
  const active=session.active;
  const variant=active?(session.error?'warning':'active'):'normal';
  const path=Object.fromEntries([16,32,48,128].map(size=>[size,`icons/${variant}-${size}.png`]));
  const title=(active?TextPatchI18n.t('collecting_original_text')+(session.tableName || session.tableId)+TextPatchI18n.t('finish_collection_in_the_popup'):TextPatchI18n.t('text_table_patch'))+
    (session.error?TextPatchI18n.t('save_failed_unsaved_text_retained_retry_in_the'):!active && (session.pending.length || session.needsCreate)?TextPatchI18n.t('unsaved_text_retained'):'');
  // Presentation is best effort: closed tabs or action failures must never fail a save.
  for(const [method,details] of [
    ['setBadgeText',{text:''}],
    ['setTitle',{title}],
    ['setIcon',{path}]
  ])try{
    if(chrome.action?.[method])await actionCall(method,{tabId:session.tabId,...details});
  }catch(error){
    if(missingTab(error)){await retireClosedCollection(session);return;}
    console.warn('Collection toolbar '+method+' failed:',error.message);
  }
}
async function saveCollection(session,force=false) {
  if(!session.pending.length && !session.needsCreate)return session;
  // After a failure keep accepting originals; only the user's retry writes again.
  if(session.error && !force)return session;
  try {
    if(!session.pendingBatch){
      session.pendingBatch={operationId:crypto.randomUUID(),tableId:session.tableId,...(session.needsCreate && session.createName?{createName:session.createName}:{}),candidates:[...session.pending],...(session.source?{source:session.source}:{})};
      await persistCollection(session,false);
    }
    const batch=session.pendingBatch;
    const result=await repository.capture(batch);
    const library=result.library;
    if(result.tableId!==session.tableId || !Number.isInteger(result.added) || result.added<0 || result.added>session.pending.length ||
      !Number.isInteger(result.total) || result.total<result.added || !library.tables.some(t=>t.id===session.tableId && t.entries.length===result.total))throw Error(TextPatchI18n.t('invalid_save_response'));
    if(session.firstSaved===null)session.firstSaved=result.added;
    else session.additionalSaved+=result.added;
    const confirmed=new Set(batch.candidates);
    session.saved+=result.added;session.total=result.total;session.pending=session.pending.filter(text=>!confirmed.has(text));session.needsCreate=false;session.error='';
    delete session.createName;delete session.pendingBatch;
    if(result.changed)await libraryChanged(library);
  } catch(error){session.error=TextPatchI18n.t('save_failed_3')+error.message+TextPatchI18n.t('unsaved_original_text_retained_please_retry');}
  await persistCollection(session);
  if(!session.error && session.pending.length)return saveCollection(session,force);
  return session;
}
function mergeCandidates(session,candidates) {
  if(!Array.isArray(candidates) || candidates.length>5000 || candidates.some(t=>typeof t!=='string' || t.length>20000))throw Error(TextPatchI18n.t('invalid_collection_data'));
  const seen=new Set(session.originals);
  for(const value of candidates){
    const text=CrimsonShared.normalize(value);
    if(!text || seen.has(text) || seen.size>=5000)continue;
    seen.add(text);session.originals.push(text);session.pending.push(text);
  }
}
async function startCollectionWatch(session) {
    if(session.closed)throw Error(TextPatchI18n.t('tab_closed_you_can_retry_saving_the_retained'));
    const report=await chrome.tabs.sendMessage(session.tabId,{type:'captureRead'},session.browserDocumentId?{documentId:session.browserDocumentId}:undefined);
    if(report?.documentId!==session.documentId || report.url!==session.url || report.newPage){
      session.active=false;session.reason=TextPatchI18n.t('page_changed_start_a_new_collection');await persistCollection(session);throw Error(session.reason);
    }
    session.active=true;session.reason=TextPatchI18n.t('collecting_more_2');await persistCollection(session);
    try{
      const started=await chrome.tabs.sendMessage(session.tabId,{type:'captureStart',sessionId:session.id},session.browserDocumentId?{documentId:session.browserDocumentId}:undefined);
      if(started?.documentId!==session.documentId || started.url!==session.url || started.newPage)throw Error(TextPatchI18n.t('collection_document_changed_start_a_new_collection'));
      session.active=started.active===true;
      if(!session.active)session.reason=started.reason || TextPatchI18n.t('collection_stopped');
      // A full first watch scan may immediately hit a limit. Preserve that final
      // snapshot even though its queued content update will now be retired.
      if(Array.isArray(started.candidates))mergeCandidates(session,started.candidates);
      await persistCollection(session);
    }
    catch(error){session.active=false;session.reason=TextPatchI18n.t('page_connection_failed');await persistCollection(session);throw error;}
}
async function collectionRequest(message,sender,state) {
  if(message.type==='collectionUpdate'){
    const session=await collectionState(sender.tab?.id);
    if(!session || !session.active || sender.frameId!==0 || session.id!==message.sessionId ||
      session.documentId!==message.documentId || (session.browserDocumentId && sender.documentId!==session.browserDocumentId) ||
      sender.url!==session.url || message.url!==session.url)throw Error(TextPatchI18n.t('collection_document_expired_or_is_not_permitted'));
    const before=session.pending.length;
    mergeCandidates(session,message.candidates);
    if(message.active===false){session.active=false;session.reason=message.reason || TextPatchI18n.t('collection_stopped');}
    if(before===session.pending.length && message.active!==false)return {collection:session};
    await persistCollection(session);return {collection:await saveCollection(session)};
  }
  if(!trustedExtensionPage(sender))throw Error(TextPatchI18n.t('collection_can_only_be_controlled_from_extension_pages'));
  if(!Number.isInteger(message.tabId))throw Error(TextPatchI18n.t('select_a_tab'));
  let session=await collectionState(message.tabId);
  if(message.type==='collectionBegin'){
    if(session?.active || session?.pending.length || session?.needsCreate)throw Error(TextPatchI18n.t('stop_the_current_collection_and_retry_unsaved_text'));
    if(message.mode!==undefined && !['new','append'].includes(message.mode))throw Error(TextPatchI18n.t('invalid_collection_data'));
    let destination=null;
    if(message.mode==='append'){
      const tab=await chrome.tabs.get(message.tabId),rule=TextPatch.selectRule(state.rules,tab.url);
      destination=state.library.tables.find(t=>t.id===rule?.tableId && t.id===message.tableId);
      if(!destination)throw Error(TextPatchI18n.t('page_or_table_changed_select_it_again'));
    }
    const capturedAt=new Date().toISOString();
    const injected=await chrome.scripting.executeScript({target:{tabId:message.tabId},files:scripts});
    const browserDocumentId=injected?.find(r=>r.frameId===0)?.documentId;
    const report=await chrome.tabs.sendMessage(message.tabId,{type:'captureRead',fresh:true},browserDocumentId?{documentId:browserDocumentId}:undefined);
    if(!report?.documentId || !report.url || !/^https?:/.test(report.url))throw Error(TextPatchI18n.t('cannot_connect_to_the_current_page'));
    if(destination && TextPatch.selectRule(state.rules,report.url)?.tableId!==destination.id)throw Error(TextPatchI18n.t('page_or_table_changed_select_it_again'));
    const sourceURL=TextPatch.webURL(report.url);
    sourceURL.search='';sourceURL.hash='';sourceURL.username='';sourceURL.password='';
    const createName=(typeof message.createName==='string' && message.createName.trim()) || sourceURL.hostname+' '+new Date().toISOString().slice(0,10);
    session={id:crypto.randomUUID(),tabId:message.tabId,tableId:destination?.id || 'collection-'+crypto.randomUUID(),
      tableName:destination?.name || createName,...(!destination?{createName}:{}),needsCreate:!destination,documentId:report.documentId,browserDocumentId,
      source:sourceURL.href.length<=4096?{url:sourceURL.href,title:typeof report.title==='string'?report.title.slice(0,500):'',language:typeof report.language==='string'?report.language.slice(0,100):'',capturedAt}:undefined,
      url:report.url,active:false,reason:report.reason || TextPatchI18n.t('initial_collection_complete'),originals:[],pending:[],firstSaved:null,additionalSaved:0,saved:0,total:destination?.entries.length || 0,error:''};
    mergeCandidates(session,report.candidates);await persistCollection(session);
    // Observe menus before waiting for storage, including a failed first save.
    try{await startCollectionWatch(session);}catch{/* Preserve the first snapshot even if the document closes. */}
    await saveCollection(session);
    if(session.firstSaved===null && !session.error){session.firstSaved=0;await persistCollection(session);}
    return {collection:session};
  }
  if(message.type==='collectionState')return {collection:session};
  if(!session)throw Error(TextPatchI18n.t('collect_original_text_from_the_current_page_first'));
  if(message.type==='collectionRetry')return {collection:await saveCollection(session,true)};
  if(message.type==='collectionStop'){
    session.active=false;session.reason=TextPatchI18n.t('collection_complete_2');await persistCollection(session);
    if(session.closed)return {collection:session};
    try{
      const report=await chrome.tabs.sendMessage(session.tabId,{type:'captureStop',sessionId:session.id},session.browserDocumentId?{documentId:session.browserDocumentId}:undefined);
      if(report.documentId===session.documentId && report.url===session.url && !report.newPage){
        mergeCandidates(session,report.candidates);await persistCollection(session);await saveCollection(session);
      }
    }catch{/* Document may already have closed; durable pending originals remain. */}
  }else if(message.type==='collectionWatch'){
    await startCollectionWatch(session);await saveCollection(session);
  }else throw Error(TextPatchI18n.t('unknown_collection_request'));
  return {collection:session};
}
async function endCollection(tabId,reason) {
  const session=await collectionState(tabId);
  if(session?.active){session.active=false;session.reason=reason;await persistCollection(session);}
}
async function reconcileCollections() {
  const {collections={}}=await chrome.storage.local.get(['collections']);
  for(const session of Object.values(collections)){
    if(session.closed)continue;
    try{await chrome.tabs.get(session.tabId);}catch(error){
      if(missingTab(error)){await retireClosedCollection(session);continue;}
      console.warn('Collection reconciliation tab lookup failed:',error.message);continue;
    }
    if(session.active){
      let report;
      try{report=await chrome.tabs.sendMessage(session.tabId,{type:'captureStatus'},session.browserDocumentId?{documentId:session.browserDocumentId}:undefined);}catch{/* Missing tab/document/receiver. */}
      if(!report?.active || report.documentId!==session.documentId || report.sessionId!==session.id || report.url!==session.url || report.newPage){
        session.active=false;session.reason=TextPatchI18n.t('collection_disconnected_check_the_document_and_restart');
        await persistCollection(session);continue;
      }
    }
    await collectionAppearance(session);
  }
}
function trustedExtensionPage(sender){
  if(sender.id!==chrome.runtime.id)return false;
  try{
    const url=new URL(sender.url);url.search='';url.hash='';
    return ['popup.html','options.html','manager.html','editor/index.html'].some(file=>url.href===chrome.runtime.getURL(file));
  }catch{return false;}
}
// Pending activation belongs to one document, rule and attempt. Permission APIs
// can outlive the popup; neither their promise nor completion is popup-owned.
async function cancelActivation(state,origin){
  for(const [id,intent] of Object.entries(state.activationIntents)){
    if(!origin || intent.origin===origin)delete state.activationIntents[id];
  }
  await chrome.storage.local.set({activationIntents:state.activationIntents});
}
async function finishActivation(id,allowed){
  const state=await initial(),intent=state.activationIntents[id];
  if(!intent)return;
  delete state.activationIntents[id];
  const tab=(await chrome.tabs.query({})).find(t=>t.id===intent.tabId);
  const rule=TextPatch.selectRule(state.rules,intent.url);
  if(allowed && Date.now()-intent.createdAt<120000 && tab?.url===intent.url &&
    rule?.id===intent.ruleId && rule.tableId===intent.tableId && await granted(intent.origin)){
    rule.enabled=true;
    state.originEnabled={...state.originEnabled,[intent.origin]:true};
  }
  await chrome.storage.local.set({activationIntents:state.activationIntents,rules:state.rules,originEnabled:state.originEnabled});
  await sync(state);
}
const inlineTokens=new Map();
async function inlineSender(message,sender){
  if(typeof message.url!=='string' || message.url.length>8192 || (message.tableId!==undefined && (typeof message.tableId!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(message.tableId))))throw Error(TextPatchI18n.t('inline_error'));
  if(sender.id!==chrome.runtime.id || !sender.tab || sender.frameId!==0 || trustedExtensionPage(sender))throw Error(TextPatchI18n.t('inline_error'));
  const actual=await chrome.tabs.get(sender.tab.id),origin=TextPatch.webURL(actual.url).origin;
  if(actual.url!==message.url || TextPatch.webURL(sender.url).origin!==origin || TextPatch.webURL(sender.tab.url).origin!==origin || TextPatch.webURL(message.url).origin!==origin)throw Error(TextPatchI18n.t('inline_error'));
  // Browser enforces host permission or activeTab; never trust a message claim.
  if(!await granted(origin)){
  const result=await chrome.scripting.executeScript({target:{tabId:actual.id,frameIds:[0]},func:()=>location.origin});
  if(result?.[0]?.result!==origin)throw Error(TextPatchI18n.t('inline_error'));
  }
  return {tabId:actual.id,documentId:sender.documentId || sender.url,url:message.url};
}
function inlineEntry(table,original,rule){
  const sensitive=rule?.tableId===table.id?rule.caseSensitive===true:table.defaults.caseSensitive;
  const key=value=>{const normalized=CrimsonShared.normalize(value);return sensitive?normalized:normalized.toLowerCase();};
  const entries=table.entries.filter(e=>key(e.en)===key(original));
  if(entries.length>1 || entries.some(e=>e.selector))throw Error(TextPatchI18n.t('inline_ambiguous'));
  return entries[0] || null;
}
async function inlineRequest(message,sender,state){
  const identity=await inlineSender(message,sender);
  if(typeof message.original!=='string' || !message.original.trim() || message.original.length>20000)throw Error(TextPatchI18n.t('inline_error'));
  const rule=TextPatch.selectRule(state.rules,message.url);
  const association=JSON.stringify(rule);
  const linkedTable=state.library.tables.find(t=>t.id===rule?.tableId);
  for(const [key,value] of inlineTokens)if(value.expires<Date.now())inlineTokens.delete(key);
  if(message.type==='inlineContext'){
  if(!linkedTable)return {table:null,tableId:null,entry:null,token:null,error:TextPatchI18n.t('inline_no_table') || TextPatchI18n.t('select_a_table_to_use_first')};
  const table=linkedTable,tableId=table.id;
  if(message.tableId!==undefined && message.tableId!==tableId)throw Error(TextPatchI18n.t('inline_conflict'));
  const entry=inlineEntry(table,message.original,rule),token=crypto.randomUUID();
  if(inlineTokens.size>=200)inlineTokens.delete(inlineTokens.keys().next().value);
  inlineTokens.set(token,{...identity,association,tableId,original:message.original,entry:JSON.stringify(entry),expires:Date.now()+30*60*1000});
  return {table:{id:table.id,name:table.name},tableId,entry:entry?{id:entry.id,original:entry.en,replacement:entry.ko}:null,token};
  }
  const expected=inlineTokens.get(message.token);
  if(!linkedTable || linkedTable.id!==message.tableId || !expected || expected.tabId!==identity.tabId || expected.documentId!==identity.documentId || expected.url!==identity.url || expected.tableId!==message.tableId || expected.original!==message.original || expected.association!==association)throw Error(TextPatchI18n.t('inline_conflict'));
  if(message.type==='inlineSave' && (typeof message.replacement!=='string' || message.replacement.length>20000))throw Error(TextPatchI18n.t('inline_error'));
  const table=linkedTable;
  const entry=inlineEntry(table,message.original,rule);
  if(JSON.stringify(entry)!==expected.entry)throw Error(TextPatchI18n.t('inline_conflict'));
  if(message.type==='inlineDelete'){
   if(!entry)throw Error(TextPatchI18n.t('inline_conflict'));
   table.entries=table.entries.filter(row=>row.id!==entry.id);
  }else if(entry){if(entry.ko!==message.replacement){entry.ko=message.replacement;}}
  else table.entries.push({id:crypto.randomUUID(),en:message.original,ko:message.replacement});
  table.revision++;
  state.library=await repository.save(state.library);inlineTokens.delete(message.token);
  await libraryChanged(state.library);return message.type==='inlineDelete'?{deleted:true}:{saved:true};
}
async function handle(message,sender) {
  let state=await initial(), notice='';
  if(['inlineContext','inlineSave','inlineDelete'].includes(message.type))return inlineRequest(message,sender,state);
  if(message.type?.startsWith('collection'))return collectionRequest(message,sender,state);
  // Extension documents embedded in manager have sender.tab too. Trust their
  // browser-supplied document URL, never a message field or mere lack of a tab.
  const privileged = trustedExtensionPage(sender);
  if (message.type==='pageState') {
    if(!privileged&&!sender.tab)throw Error(TextPatchI18n.t('page_state_is_only_available_to_site_or'));
    let url=privileged?message.url:sender.tab.url;
    if(!privileged && message.url && TextPatch.webURL(message.url).origin===TextPatch.webURL(sender.tab.url).origin)url=message.url;
    return pageState(state,url);
  }
  if (!privileged) throw Error(TextPatchI18n.t('settings_can_only_be_changed_from_extension_pages'));
  switch(message.type) {
    case 'beginCurrency':
    case 'saveCurrency': {
      const origin=TextPatch.webURL(message.url).origin;
      const currency=TextPatchCurrency.preferences(message.currency);
      if(message.type==='saveCurrency' && currency.enabled && !await granted(origin))throw Error(TextPatchI18n.t('site_access_is_required_turn_on_the_replacement'));
      state.currencyPreferences={...state.currencyPreferences,[origin]:{...currency,requestId:message.requestId || crypto.randomUUID()}};
      await chrome.storage.local.set({currencyPreferences:state.currencyPreferences});break;
    }
    case 'saveInteractionSettings':
      state.interactionSettings=TextPatchInteraction.validate(message.interactionSettings);await chrome.storage.local.set({interactionSettings:state.interactionSettings});break;
    case 'libraryGet': return {library:state.library};
    case 'aiRequestRecord': return {record:await repository.recordAIRequest(message.table)};
    case 'aiResultPreview': {
      const {library,...preview}=await repository.aiResult(message.text,false);return preview;
    }
    case 'aiResultApply': {
      const result=await repository.aiResult(message.text,true);
      if(result.changed)await libraryChanged(result.library);
      return result;
    }
    case 'importTables': {
      if(typeof message.fileName!=='string' || !/\.json$/i.test(message.fileName))throw Error(TextPatchI18n.t('select_a_json_file'));
      // The worker owns the latest snapshot; the repository checks its revision
      // inside the write transaction, preserving concurrent editor/capture work.
      const imported=TableImport.createNew(state.library,message.text,message.fileName.replace(/\.json$/i,''));
      state.library=await repository.save(imported.library);
      await libraryChanged(state.library);
      notice=TextPatchI18n.t('popup_import_saved',{count:imported.tableIds.length});
      break;
    }
    case 'librarySave': {
      const library=await repository.save(message.library);
      // Only the accepted revision may retire site links. A stale editor keeps
      // its entire draft and cannot alter rules or pending activation intents.
      const removed=new Set(state.library.tables.filter(t=>!library.tables.some(next=>next.id===t.id)).map(t=>t.id));
      if(removed.size){
        for(const [token,snapshot] of inlineTokens)if(removed.has(snapshot.tableId))inlineTokens.delete(token);
        state.rules=state.rules.filter(rule=>!removed.has(rule.tableId));
        for(const [id,intent] of Object.entries(state.activationIntents))if(removed.has(intent.tableId))delete state.activationIntents[id];
        await chrome.storage.local.set({rules:state.rules,activationIntents:state.activationIntents});
      }
      await libraryChanged(library);return {library};
    }
    case 'selectTable': {
      const origin=TextPatch.webURL(message.url).origin;
      if(!state.library.tables.some(t=>t.id===message.tableId))throw Error(TextPatchI18n.t('select_a_table_2'));
      const previous=TextPatch.selectRule(state.rules,message.url);
      const rule={...(previous || {id:crypto.randomUUID(),origin,scope:'site',path:'/',enabled:false,matchMode:'exact',caseSensitive:false}),tableId:message.tableId};
      const rules=previous?state.rules.map(r=>r.id===rule.id?rule:r):[...state.rules,rule];
      TextPatch.validateRules(rules,state.library);
      await cancelActivation(state,origin);
      state.rules=rules;
      await chrome.storage.local.set({rules});break;
    }
    case 'beginActivation': {
      const origin=TextPatch.webURL(message.url).origin;
      const tab=(await chrome.tabs.query({})).find(t=>t.id===message.tabId);
      const rule=TextPatch.selectRule(state.rules,message.url);
      if(tab?.url!==message.url || !rule || rule.tableId!==message.tableId)throw Error(TextPatchI18n.t('page_or_table_changed_select_it_again'));
      await cancelActivation(state,origin);
      state.originEnabled={...state.originEnabled,[origin]:false};
      state.activationIntents[message.attemptId]={origin,url:message.url,tabId:message.tabId,tableId:rule.tableId,ruleId:rule.id,createdAt:Date.now()};
      await chrome.storage.local.set({originEnabled:state.originEnabled,activationIntents:state.activationIntents});break;
    }
    case 'refresh': state.library=await repository.get();notice=TextPatchI18n.t('latest_tables_loaded');break;
    case 'toggle': await cancelActivation(state);state.enabled=message.enabled===true;await chrome.storage.local.set({enabled:state.enabled});break;
    case 'toggleSite': {
      const origin=TextPatch.webURL(message.url).origin;
      await cancelActivation(state,origin);
      const rule=TextPatch.selectRule(state.rules,message.url);
      if(!rule || !state.library.tables.some(t=>t.id===rule.tableId))throw Error(TextPatchI18n.t('select_a_table_to_use_first'));
      if(message.enabled && !await granted(origin))throw Error(TextPatchI18n.t('site_access_is_required_turn_on_the_replacement'));
      state.originEnabled={...state.originEnabled,[origin]:message.enabled===true};
      if(message.enabled)rule.enabled=true;
      await chrome.storage.local.set({originEnabled:state.originEnabled,rules:state.rules});break;
    }
    case 'saveRuleOptions': {
      if((message.matchMode===undefined || message.caseSensitive===undefined) || !state.rules.some(r=>r.id===message.id) || (message.matchMode!==undefined && !['exact','word'].includes(message.matchMode)) || (message.caseSensitive!==undefined && typeof message.caseSensitive!=='boolean'))throw Error(TextPatchI18n.t('invalid_settings_format'));
      const rules=state.rules.map(rule=>rule.id===message.id?{...rule,...(message.matchMode===undefined?{}:{matchMode:message.matchMode}),...(message.caseSensitive===undefined?{}:{caseSensitive:message.caseSensitive})}:rule);
      TextPatch.validateRules(rules);
      await chrome.storage.local.set({rules});state.rules=rules;break;
    }
    case 'saveRule': {
      await cancelActivation(state,message.rule?.origin);
      const rule={...message.rule};
      const editedId=rule.id;
      if (!state.rules.some(r=>r.id===rule.id) && !await granted(rule.origin)) throw Error(TextPatchI18n.t('site_access_is_not_allowed_allow_it_in'));
      const same=r=>r.origin===rule.origin && r.scope===rule.scope && (r.scope==='site' || r.path===rule.path);
      const previous=state.rules.find(same);
      rule.id=previous?.id || rule.id || crypto.randomUUID();
      const existing=state.rules.find(r=>r.id===editedId) || previous;
      if(rule.matchMode===undefined)rule.matchMode=existing?.matchMode ?? 'exact';
      if(rule.caseSensitive===undefined)rule.caseSensitive=existing?.caseSensitive ?? false;
      const anchor=previous || state.rules.find(r=>r.id===editedId);
      const rules=anchor?state.rules.flatMap(r=>r.id===anchor.id?[rule]:r.id===editedId || same(r)?[]:[r]):[...state.rules,rule];
      TextPatch.validateRules(rules,state.library);
      state.rules=rules;
      const patch={rules};
      if(message.activateSite===true){state.originEnabled={...state.originEnabled,[rule.origin]:true};patch.originEnabled=state.originEnabled;}
      await chrome.storage.local.set(patch);break;
    }
    case 'deleteRule':
      await cancelActivation(state);
      state.rules=state.rules.filter(r=>r.id!==message.id);await chrome.storage.local.set({rules:state.rules});break;
    case 'previewImport': {
      const incoming=importData(message.data,state);
      const compare=(before,after)=>({added:after.filter(a=>!before.some(b=>b.id===a.id)).map(a=>a.id),
        replaced:after.filter(a=>before.some(b=>b.id===a.id && JSON.stringify(a)!==JSON.stringify(b))).map(a=>a.id),
        removed:before.filter(b=>!after.some(a=>a.id===b.id)).map(b=>b.id)});
      return {settings:settings(incoming),changes:compare(state.rules,incoming.rules),
        tables:incoming.library?.tables.map(t=>({id:t.id,name:t.name})),
        tableChanges:incoming.library?compare(state.library.tables,incoming.library.tables):undefined,
        notice:TextPatchI18n.t('all_current_settings_will_be_replaced_permissions_are')};
    }
    case 'importSettings': {
      await cancelActivation(state);
      const incoming=importData(message.data,state);
      const patch={enabled:incoming.enabled,originEnabled:incoming.originEnabled,rules:incoming.rules,interactionSettings:incoming.interactionSettings};
      if(incoming.library){
        if(message.baseRevision!==undefined && message.baseRevision!==state.library.revision)throw Error(TextPatchI18n.t('save_conflict_preview_again'));
        incoming.library.revision=state.library.revision;
        state.library=await repository.save(incoming.library);
        await libraryChanged(state.library);
      }
      await chrome.storage.local.set(patch);Object.assign(state,patch);break;
    }
    case 'exportSettings': return settings(state);
    case 'exportBundle': return {kind:'text-patch-bundle',schemaVersion:1,library:state.library,settings:settings(state)};
    case 'state': break;
    default: throw Error(TextPatchI18n.t('unknown_request'));
  }
  if(message.type!=='state')await sync(state);
  return {...state,currencyRates:currencyFeed.metadata(),notice,page:message.url ? await pageState(state,message.url) : null};
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id)return;
  if(message.type==='refreshCurrencyRates'){
    if(!trustedExtensionPage(sender))return;
    // Offline fetch must not stall the general settings mutation queue.
    currencyFeed.refresh({manual:true}).then(()=>serialized(()=>handle({type:'state',url:message.url},sender))).then(reply,error=>reply({error:error.message}));
    return true;
  }
  if(message.type==='activateCurrency'){
    if(!trustedExtensionPage(sender))return;
    try{
      const origin=TextPatch.webURL(message.url).origin;
      const currency=TextPatchCurrency.preferences({...message.currency,enabled:true}),requestId=crypto.randomUUID();
      const prepared=serialized(()=>handle({...message,type:'beginCurrency',currency,requestId},sender));
      let permission;try{permission=chrome.permissions.request({origins:[TextPatch.hostPattern(origin)]});}catch(error){permission=Promise.reject(error);}
      Promise.all([prepared,Promise.resolve(permission).then(allowed=>({allowed}),error=>({allowed:false,error}))]).then(async([,result])=>{
        return serialized(async()=>{
          const state=await initial();
          if(!result.allowed && state.currencyPreferences[origin]?.requestId===requestId){
            state.currencyPreferences[origin].enabled=false;
            await chrome.storage.local.set({currencyPreferences:state.currencyPreferences});
          }
          await sync(state);
          if(result.error)throw result.error;
          const response=await handle({type:'state',url:message.url},sender);
          if(!result.allowed)response.notice=TextPatchI18n.t('currency_permission_denied');
          return response;
        });
      }).then(reply,error=>reply({error:error.message}));
    }catch(error){reply({error:error.message});}
    return true;
  }
  if(message.type==='activateSite'){
    // Call before any await, on the user-gesture message stack. Chrome forwards
    // the click gesture to runtime messages; test this with a real browser click.
    if(!trustedExtensionPage(sender))return;
    try{
      const origin=TextPatch.webURL(message.url).origin;
      if(!Number.isInteger(message.tabId) || typeof message.attemptId!=='string' || !message.attemptId || message.attemptId.length>100)throw Error(TextPatchI18n.t('invalid_activation_request'));
      const prepared=serialized(()=>handle({...message,type:'beginActivation'},sender));
      let permission;
      try{permission=chrome.permissions.request({origins:[TextPatch.hostPattern(origin)]});}
      catch(error){permission=Promise.reject(error);}
      // Attach both rejection handlers immediately: preparation and request may
      // fail independently, including a synchronous API throw after enqueueing.
      Promise.all([prepared.then(()=>null,error=>error),Promise.resolve(permission).then(allowed=>({allowed}),error=>({allowed:false,error}))])
        .then(async([preparationError,result])=>{
          await serialized(()=>finishActivation(message.attemptId,!preparationError && result.allowed));
          if(preparationError || result.error)throw preparationError || result.error;
          const state=await serialized(()=>handle({type:'state',url:message.url},sender));
          if(!result.allowed)state.notice=TextPatchI18n.t('site_access_was_not_allowed_the_selected_table');
          return state;
        })
        .then(reply,error=>reply({error:error.message}));
    }catch(error){reply({error:error.message});}
    return true;
  }
  serialized(()=>handle(message,sender)).then(reply,error=>reply({error:error.message}));
  return true;
});
const reconcile=()=>serialized(async()=>{
  const state=await initial();
  for(const [id,intent] of Object.entries(state.activationIntents))await finishActivation(id,await granted(intent.origin));
  await sync(await initial());
}).catch(console.warn);
chrome.runtime.onInstalled.addListener(reconcile);
chrome.runtime.onStartup.addListener(reconcile);
chrome.permissions.onAdded.addListener(()=>serialized(async()=>{
  const state=await initial();
  for(const [id,intent] of Object.entries(state.activationIntents))if(await granted(intent.origin))await finishActivation(id,true);
  await sync(await initial());
}).catch(console.warn));
chrome.permissions.onRemoved.addListener(()=>serialized(async()=>{
  const state=await initial();await cancelActivation(state);await sync(state);
}).catch(console.warn));
chrome.tabs.onUpdated.addListener((id,change,tab)=>{
  if(change.url || change.status==='loading')serialized(async()=>{
    const state=await initial();
    for(const [key,intent] of Object.entries(state.activationIntents))if(intent.tabId===id)delete state.activationIntents[key];
    await chrome.storage.local.set({activationIntents:state.activationIntents});
  }).catch(console.warn);
  if(change.url || change.status==='loading')serialized(()=>endCollection(id,TextPatchI18n.t('page_changed_start_a_new_collection'))).catch(console.warn);
  if(change.url || change.status==='complete')serialized(async()=>syncTab(await initial(),{...tab,id,url:change.url || tab?.url})).catch(console.warn);
});
chrome.tabs.onRemoved?.addListener(id=>serialized(async()=>{
  const state=await initial();
  for(const [key,intent] of Object.entries(state.activationIntents))if(intent.tabId===id)delete state.activationIntents[key];
  await chrome.storage.local.set({activationIntents:state.activationIntents});
  const session=await collectionState(id);
  if(session)await retireClosedCollection(session);
}).catch(console.warn));
// Runs for every worker instance, including suspension wakeups; serialize before
// incoming controls so a late startup check cannot overwrite a new session.
serialized(reconcileCollections).catch(console.warn);

const localizeAction=()=>serialized(async()=>{
  if(chrome.action?.setTitle)try{await actionCall('setTitle',{title:TextPatchI18n.t('text_table_patch')});}catch(error){console.warn('Toolbar title update failed:',error.message);}
  const {collections={}}=await chrome.storage.local.get(['collections']);
  for(const session of Object.values(collections))await collectionAppearance(session);
}).catch(console.warn);
TextPatchI18n.onChange(()=>{localizeAction();serialized(async()=>sync(await initial())).catch(console.warn);});
TextPatchI18n.ready.then(localizeAction);

chrome.alarms.onAlarm.addListener(alarm=>{
  if(alarm.name!==currencyAlarm)return;
  serialized(async()=>{
    const state=await initial();await scheduleCurrency(state);
    if(currencyActive)void currencyFeed.refreshIfDue();
  }).catch(console.warn);
});
// Recover scheduling on every worker instance, including suspension wakeups.
serialized(async()=>scheduleCurrency(await initial())).catch(console.warn);
