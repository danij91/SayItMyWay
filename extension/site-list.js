globalThis.TextPatchSites={mount({rows,status,onChange=async()=>{}}){
const $=id=>id==='rules'?rows:status;
let loadGeneration=0;
const dialog=document.createElement('dialog');dialog.className='site-settings';
dialog.innerHTML='<form><h2 id="site-settings-title"></h2><p class="settings-origin" dir="ltr"></p><label><input name="caseSensitive" type="checkbox"><span class="case-label"></span></label><label><input name="wordReplacement" type="checkbox"><span class="word-label"></span></label><p class="settings-error" role="status"></p><div class="settings-actions"><button type="button" class="settings-cancel"></button><button type="submit" class="settings-save"></button></div></form>';
dialog.setAttribute('aria-labelledby','site-settings-title');document.body.append(dialog);
const form=dialog.querySelector('form'),save=dialog.querySelector('.settings-save'),cancel=dialog.querySelector('.settings-cancel'),error=dialog.querySelector('.settings-error');
for(const [selector,key] of [['h2','site_matching_settings'],['.case-label','case_sensitive'],['.word-label','site_word_replacement'],['.settings-cancel','cancel'],['.settings-save','save_changes']])TextPatchI18n.text(dialog.querySelector(selector),()=>TextPatchI18n.t(key));
let editingRule=null,opener=null,saving=false;
function closeSettings(){if(saving)return;dialog.close();opener?.focus();editingRule=null;}
cancel.onclick=closeSettings;
dialog.addEventListener('cancel',event=>{event.preventDefault();closeSettings();});
function openSettings(rule,button){
  editingRule={...rule};opener=button;form.elements.caseSensitive.checked=rule.caseSensitive===true;form.elements.wordReplacement.checked=rule.matchMode==='word';
  dialog.querySelector('.settings-origin').textContent=rule.origin+(rule.scope==='site'?'':rule.path);TextPatchI18n.text(error,()=>'');dialog.showModal();
}
form.onsubmit=async event=>{
  event.preventDefault();if(saving || !editingRule)return;
  const rule={...editingRule,matchMode:form.elements.wordReplacement.checked?'word':'exact',caseSensitive:form.elements.caseSensitive.checked};
  saving=true;for(const el of form.elements)el.disabled=true;
  try{
    await send({type:'saveRuleOptions',id:rule.id,matchMode:rule.matchMode,caseSensitive:rule.caseSensitive});saving=false;closeSettings();
    TextPatchI18n.text($('status'),()=>TextPatchI18n.t('site_settings_saved'));await load();await onChange();
  }catch(e){TextPatchI18n.text(error,()=>TextPatchI18n.message(e.message));}
  finally{saving=false;for(const el of form.elements)el.disabled=false;}
};
async function send(message){
  const result=await chrome.runtime.sendMessage(message);
  if(result.error)throw Error(result.error);
  return result;
}
// Toggle a representative URL so a more specific rule cannot receive this row's toggle.
function representative(rule,rules){
  const base=rule.scope==='site'?'/':rule.path,candidates=[rule.origin+base];
  if(rule.scope!=='page')for(let i=0;i<=rules.length;i++)candidates.push(rule.origin+base.replace(/\/$/,'')+'/__text_patch_scope_'+i);
  return candidates.find(url=>TextPatch.selectRule(rules,url)?.id===rule.id);
}
async function load(snapshot){
  const generation=++loadGeneration,next=snapshot || await send({type:'state'});
  const rows=await Promise.all((next.rules || []).map(async rule=>{
    const url=representative(rule,next.rules),page=url?await send({type:'pageState',url}):null;
    const row=document.createElement('tr');
    const cell=()=>{const td=document.createElement('td');row.append(td);return td;};
    const site=cell(''),name=document.createElement('span'),scope=document.createElement('small');
    name.className='site-origin';name.dir='ltr';TextPatchI18n.text(name,()=>rule.origin);TextPatchI18n.attribute(name,'title',()=>rule.origin);
    const scopeLabel=document.createElement('span'),path=document.createElement('bdi');path.dir='ltr';path.textContent=rule.path;TextPatchI18n.text(scopeLabel,()=>rule.scope==='site'?TextPatchI18n.t('entire_site'):(rule.scope==='prefix'?TextPatchI18n.t('path_prefix'):TextPatchI18n.t('page')));scope.append(scopeLabel);if(rule.scope!=='site')scope.append(path);TextPatchI18n.attribute(scope,'title',()=>scope.textContent);site.append(name,scope);
    const table=next.library.tables.find(t=>t.id===rule.tableId),tableCell=cell(''),select=document.createElement('select');
    TextPatchI18n.attribute(select,'aria-label',()=>rule.origin+' '+scope.textContent+TextPatchI18n.t('table'));
    select.dir='auto';select.replaceChildren(...next.library.tables.map(t=>Object.assign(new Option(t.name,t.id),{dir:'auto'})));
    if(!table){const missing=new Option('',rule.tableId);TextPatchI18n.text(missing,()=>TextPatchI18n.t('deleted_table'));select.add(missing);}
    select.value=rule.tableId;TextPatchI18n.attribute(select,'title',()=>table?.name || TextPatchI18n.t('deleted_table'));tableCell.append(select);
    select.onchange=()=>{select.disabled=true;run(async()=>{
      try{
        // Let the background retain the latest options if another view saved them.
        const {matchMode,caseSensitive,fitText,...association}=rule;
        await send({type:'saveRule',rule:{...association,tableId:select.value}});TextPatchI18n.text($('status'),()=>TextPatchI18n.t('table_association_saved'));
      }
      finally{await load();await onChange();}
    });};
    const actual=cell(''),enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=page?.enabled===true;
    TextPatchI18n.attribute(enabled,'aria-label',()=>rule.origin+' '+scope.textContent+TextPatchI18n.t('enabled'));
    enabled.disabled=!url||!table||page?.missingPermission===true;
    TextPatchI18n.attribute(enabled,'title',()=>!url?TextPatchI18n.t('another_rule_takes_priority_over_this_entire_scope'):!table?TextPatchI18n.t('choose_a_different_table'):page?.missingPermission?TextPatchI18n.t('allow_access_in_the_site_popup'):TextPatchI18n.t('changes_the_enabled_state_for_this_entire_site'));
    actual.append(enabled);
    enabled.onchange=()=>{enabled.disabled=true;run(async()=>{try{await send({type:'toggleSite',url,enabled:enabled.checked});}finally{await load();await onChange();}});};
    const link=document.createElement('a');link.href=rule.origin+(rule.scope==='site'?'/':rule.path);link.target='_blank';link.rel='noopener noreferrer';
    TextPatchI18n.attribute(link,'title',()=>link.href);TextPatchI18n.attribute(link,'aria-label',()=>TextPatchI18n.t('open_site')+link.href);
    link.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M14 3h7v7M21 3 10 14M10 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6"/></svg>';
    const settings=document.createElement('button');settings.type='button';settings.className='site-settings-button';
    TextPatchI18n.attribute(settings,'aria-label',()=>TextPatchI18n.t('site_matching_settings')+' '+rule.origin+' '+scope.textContent);
    TextPatchI18n.attribute(settings,'title',()=>TextPatchI18n.t('site_matching_settings'));
    settings.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m10 3-.6 2.3-2 .9-2.1-.7-2 3.5L5 10.6v2.8l-1.7 1.6 2 3.5 2.1-.7 2 .9L10 21h4l.6-2.3 2-.9 2.1.7 2-3.5-1.7-1.6v-2.8l1.7-1.6-2-3.5-2.1.7-2-.9L14 3Z"/><circle cx="12" cy="12" r="3"/></svg>';
    settings.onclick=()=>openSettings(rule,settings);cell('').append(settings);cell('').append(link);return row;
  }));
  if(generation!==loadGeneration)return;
  $('rules').replaceChildren(...rows);
  if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;TextPatchI18n.text(td,()=>TextPatchI18n.t('no_linked_sites_add_one_in_the_site'));tr.append(td);$('rules').append(tr);}
}
async function run(work){try{await work();}catch(error){TextPatchI18n.text($('status'),()=>TextPatchI18n.message(error.message));}}
return {load:snapshot=>run(()=>load(snapshot))};
}};
