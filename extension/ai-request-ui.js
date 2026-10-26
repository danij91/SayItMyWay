(function(root){
  const KEY='aiRequestPreferences';
  function validPage(page){
    try{const url=root.TextPatchAI.websiteURL(page?.url);return url?{url,title:page.title||'',language:page.language||''}:null;}catch{return null;}
  }
  function capturedPage(table){
    return (Array.isArray(table?.captureSources)?table.captureSources:[])
      .map((source,index)=>({page:validPage(source),time:Date.parse(source?.capturedAt)||0,index}))
      .filter(source=>source.page).sort((a,b)=>b.time-a.time || b.index-a.index)[0]?.page||null;
  }
  async function linkedPage(table){
    const chrome=root.chrome;
    if(!chrome?.runtime?.id || typeof chrome.runtime.sendMessage!=='function')return null;
    const [stateResult,tabsResult]=await Promise.allSettled([
      chrome.runtime.sendMessage({type:'state'}),chrome.tabs?.query?chrome.tabs.query({}):Promise.resolve([])
    ]);
    const state=stateResult.status==='fulfilled'?stateResult.value:null;
    if(!Array.isArray(state?.rules) || !table?.id)return null;
    const enabled=url=>{
      const rule=root.TextPatch.selectRule(state.rules,url);
      return rule?.tableId===table.id && rule.enabled===true && (state.originEnabled?.[rule.origin]??state.enabled)===true;
    };
    // Scope selection precedes enabled checks, just as it does when applying a table.
    const tabs=tabsResult.status==='fulfilled' && Array.isArray(tabsResult.value)?tabsResult.value:[];
    for(const tab of [...tabs.filter(t=>t.active),...tabs.filter(t=>!t.active)]){
      const page=validPage(tab);if(page && enabled(page.url))return page;
    }
    for(const rule of state.rules){
      const page=validPage({url:rule.origin+(rule.scope==='site'?'/':rule.path)});
      if(page && enabled(page.url))return page;
    }
    return null;
  }
  async function open({table,page,loadPreferences,savePreferences,recordRequest}={}){
    await TextPatchI18n.ready;
    table=structuredClone(table);
    const doc=root.document;
    doc.querySelector('[data-ai-dialog]')?.remove();
    const dialog=doc.createElement('dialog');dialog.className='ai-request-dialog';dialog.dataset.aiDialog='';
    const element=(tag,text)=>{const el=doc.createElement(tag);if(text!==undefined){const owner=tag==='label'?el.appendChild(doc.createElement('span')):el;TextPatchI18n.text(owner,typeof text==='function'?text:()=>text);}return el;};
    const title=element('h2',()=>TextPatchI18n.t('ai_task_request'));title.id='ai-request-title';dialog.setAttribute('aria-labelledby',title.id);dialog.append(title);
    const summary=element('p',()=>table?.name||TextPatchI18n.t('table_2'));summary.className='ai-request-summary';summary.dir='auto';dialog.append(summary);
    const help=element('p',()=>TextPatchI18n.t('send_the_copied_request_or_downloaded_file_directly'));help.className='ai-request-help';dialog.append(help);
    function field(name,label,tag='input'){
      const wrapper=element('label',label),control=element(tag);control.dataset.ai=name;control.id='ai-request-'+name;wrapper.htmlFor=control.id;
      if(tag!=='select')control.dir='auto';
      if(tag==='input'){control.type='text';control.maxLength=4000;}
      wrapper.append(control);dialog.append(wrapper);return control;
    }
    const task=field('task',()=>TextPatchI18n.t('task'),'select');
    for(const [value,text] of [['translation',()=>TextPatchI18n.t('translation')],['replacement',()=>TextPatchI18n.t('text_replacement')]]){const option=element('option',text);option.value=value;task.append(option);}
    const website=field('websiteURL',()=>TextPatchI18n.t('ai_website_url'));website.maxLength=4096;website.dir='ltr';website.inputMode='url';
    TextPatchI18n.attribute(website,'placeholder',()=>TextPatchI18n.t('ai_website_url_hint'));
    let inferredPage=validPage(page)||capturedPage(table),websiteEdited=false;
    website.value=inferredPage?.url||'';
    const CUSTOM='__custom__',languages=Object.values(TextPatchI18n.languages);
    function languageField(name,label,customLabel,isSource){
      const select=field(name,()=>TextPatchI18n.t(label),'select');
      function option(value,text){const el=element('option',text);el.value=value;el.dir='auto';select.append(el);}
      option(isSource?'auto':'',()=>TextPatchI18n.t(isSource?'ai_language_auto':'ai_language_choose'));
      for(const language of languages)option(language,language);
      option(CUSTOM,()=>TextPatchI18n.t('ai_language_custom'));
      const custom=field(name+'Custom',()=>TextPatchI18n.t(customLabel));
      return {select,custom};
    }
    const {select:source,custom:sourceCustom}=languageField('sourceLanguage','source_language','ai_source_language_custom',true);
    const {select:target,custom:targetCustom}=languageField('targetLanguage','target_language','ai_target_language_custom',false);
    // Opening-time default only; later app locale changes leave this draft intact.
    target.value=TextPatchI18n.languages[TextPatchI18n.locale];
    const instruction=field('instruction',()=>TextPatchI18n.t('replacement_instruction'),'textarea');instruction.maxLength=4000;instruction.rows=3;TextPatchI18n.attribute(instruction,'placeholder',()=>TextPatchI18n.t('example_shorten_menu_names_using_simple_words'));
    const actions=element('div');actions.className='ai-request-actions';dialog.append(actions);
    function button(name,text){const b=element('button',text);b.type='button';b.dataset.ai=name;actions.append(b);return b;}
    const copy=button('copy',()=>TextPatchI18n.t('copy_request')),download=button('download',()=>TextPatchI18n.t('download_file')),close=button('close',()=>TextPatchI18n.t('close'));
    copy.className='ai-request-primary';
    const status=element('p');status.dataset.ai='status';status.setAttribute('role','status');dialog.append(status);
    status.id='ai-request-status';status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');
    dialog.setAttribute('aria-describedby',status.id);
    doc.body.append(dialog);
    let edited=false,busy=false,revision=0;
    const total=table?.entries?.filter(e=>typeof e.ko==='string' && !e.ko.trim()).length||0;
    const ready=()=>TextPatchI18n.t('all_p0_untranslated_rows_import_the_ai_response',{p0:total});
    const invalidate=()=>{revision++;TextPatchI18n.text(status,()=>ready());};
    const visibility=()=>{
      const translation=task.value==='translation';
      source.parentElement.hidden=target.parentElement.hidden=!translation;
      sourceCustom.parentElement.hidden=!translation || source.value!==CUSTOM;
      targetCustom.parentElement.hidden=!translation || target.value!==CUSTOM;
      instruction.parentElement.hidden=translation;
      target.required=translation;targetCustom.required=translation && target.value===CUSTOM;
      instruction.required=!translation;
    };
    for(const control of [task,source,sourceCustom,target,targetCustom,instruction]){
      const change=()=>{edited=true;invalidate();visibility();};
      control.addEventListener('input',change);control.addEventListener('change',change);
    }
    website.addEventListener('input',()=>{websiteEdited=true;invalidate();});
    const load=loadPreferences||(()=>JSON.parse(root.localStorage.getItem(KEY)||'{}'));
    const save=savePreferences||(value=>root.localStorage.setItem(KEY,JSON.stringify(value)));
    const languageValue=(select,custom)=>select.value===CUSTOM?custom.value.trim():select.value;
    function preferences(){return {task:task.value,sourceLanguage:languageValue(source,sourceCustom)||'auto',targetLanguage:languageValue(target,targetCustom),instruction:instruction.value.trim()};}
    async function deliver(mode){
      if(busy)return;
      busy=true;edited=true;websiteEdited=true;copy.disabled=download.disabled=true;dialog.setAttribute('aria-busy','true');
      const started=revision,current=()=>dialog.isConnected && revision===started;
      let prefs,focusDownload=false;
      try{
        const url=root.TextPatchAI.websiteURL(website.value);
        const requestPage=url?{url,...(url===inferredPage?.url?{title:inferredPage.title,language:inferredPage.language}:{})}:null;
        prefs=preferences();
        // Validate intent before persisting; no request leaves the extension until
        // its authoritative baseline has committed successfully.
        root.TextPatchAI.build({table,page:requestPage,...prefs});
        const record=recordRequest?await recordRequest(table):null;
        const result=root.TextPatchAI.build({table,page:requestPage,...prefs,requestId:record?.id});
        if(mode==='copy'){
          if(!result.copyable){TextPatchI18n.text(status,()=>TextPatchI18n.t('all_p0_rows_make_a_long_request_download',{p0:result.total}));focusDownload=true;}
          else{
            // The trusted baseline is durable before clipboard delivery. Browsers
            // that deny clipboard access are offered the complete file instead.
            try{await root.navigator.clipboard.writeText(result.text);if(current())TextPatchI18n.text(status,()=>TextPatchI18n.t('copied_the_request_for_all_p0_rows',{p0:result.total}));}
            catch{if(current()){TextPatchI18n.text(status,()=>TextPatchI18n.t('could_not_copy_download_the_file_to_send'));focusDownload=true;}}
          }
        }else{
          let url,anchor;
          try{
            const blob=new root.Blob([result.text],{type:'text/plain;charset=utf-8'});
            url=root.URL.createObjectURL(blob);anchor=element('a');anchor.href=url;
            const name=(table.name||'table').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g,'_').replace(/[. ]+$/g,'').slice(0,80)||'table';
            anchor.download='ai-request-'+name+'.txt';anchor.hidden=true;dialog.append(anchor);anchor.click();
            TextPatchI18n.text(status,()=>TextPatchI18n.t('prepared_the_request_file_for_all_p0_rows',{p0:result.total}));
          }catch{TextPatchI18n.text(status,()=>TextPatchI18n.t('could_not_download_the_file_try_again'));}
          finally{anchor?.remove();if(url)root.setTimeout(()=>root.URL.revokeObjectURL(url),1000);}
        }
        if(current())try{await save(prefs);}catch{if(current())status.textContent+=TextPatchI18n.t('could_not_remember_your_choices');}
      }catch(error){TextPatchI18n.text(status,()=>TextPatchI18n.message(error.message));let control=task.value==='translation'?(target.value===CUSTOM?targetCustom:target):instruction;try{root.TextPatchAI.websiteURL(website.value);}catch{control=website;}if(control===website || !control.value.trim())control.focus();}
      finally{busy=false;copy.disabled=download.disabled=false;dialog.removeAttribute('aria-busy');if(focusDownload && current())download.focus();}
    }
    copy.onclick=()=>deliver('copy');download.onclick=()=>deliver('download');
    close.onclick=()=>{if(typeof dialog.close==='function')dialog.close();dialog.remove();};
    dialog.addEventListener('close',()=>dialog.remove());
    invalidate();visibility();
    if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
    const contextReady=(async()=>{
      if(inferredPage)return;
      try{const linked=await linkedPage(table);if(dialog.isConnected && !websiteEdited){inferredPage=linked;website.value=linked?.url||'';}}catch{/* No linked website is also a valid context. */}
    })();
    try{
      const prefs=await load();
      if(dialog.isConnected && !edited && prefs && typeof prefs==='object'){
        if(['translation','replacement'].includes(prefs.task))task.value=prefs.task;
        if(typeof prefs.sourceLanguage==='string'){
          const value=prefs.sourceLanguage.slice(0,4000).trim();
          if(languages.includes(value) || value==='auto')source.value=value;
          else if(!value)source.value='auto';
          else {source.value=CUSTOM;sourceCustom.value=value;}
        }
        if(typeof prefs.instruction==='string')instruction.value=prefs.instruction.slice(0,4000);
      }
    }catch{if(dialog.isConnected && !edited)TextPatchI18n.text(status,()=>TextPatchI18n.t('could_not_load_previous_choices_enter_them_manually'));}
    await contextReady;visibility();return dialog;
  }
  function confirmResult(result){
    return new Promise(resolve=>{
      const doc=root.document,dialog=doc.createElement('dialog');dialog.className='ai-request-dialog';dialog.dataset.aiResult='';
      const title=doc.createElement('h2');title.id='ai-result-title';TextPatchI18n.text(title,()=>TextPatchI18n.t('ai_result_title'));dialog.setAttribute('aria-labelledby',title.id);
      const destination=doc.createElement('p');destination.dir='auto';destination.textContent=result.tableName;
      const summary=doc.createElement('p');summary.setAttribute('role','status');TextPatchI18n.text(summary,()=>TextPatchI18n.t('ai_result_preview',{filled:result.filled,preserved:result.preserved})+(result.created?' '+TextPatchI18n.t('ai_result_created'):''));
      const actions=doc.createElement('div');actions.className='ai-request-actions';
      const cancel=doc.createElement('button'),apply=doc.createElement('button');cancel.type=apply.type='button';apply.dataset.aiResultApply='';
      TextPatchI18n.text(cancel,()=>TextPatchI18n.t('cancel'));TextPatchI18n.text(apply,()=>TextPatchI18n.t('ai_result_apply'));apply.className='ai-request-primary';
      const finish=value=>{dialog.remove();resolve(value);};cancel.onclick=()=>finish(false);apply.onclick=()=>finish(true);
      dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});
      actions.append(cancel,apply);dialog.append(title,destination,summary,actions);doc.body.append(dialog);
      if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
    });
  }
  root.TextPatchAIUI={open,confirmResult};
})(globalThis);
