(function(root){
  // Internal copy policy, not an operating-system clipboard limit. Files have no such cap.
  const COPY_BYTE_BUDGET=128*1024;
  function utf8Bytes(text){
    let bytes=0;
    for(const char of text){const code=char.codePointAt(0);bytes+=code<=0x7f?1:code<=0x7ff?2:code<=0xffff?3:4;}
    return bytes;
  }
  function websiteURL(value){
    if(typeof value!=='string' || value.length>4096 || /[\u0000-\u001f\u007f]/.test(value))throw Error(TextPatchI18n.t('ai_invalid_website_url'));
    if(!value.trim())return '';
    try{
      const url=new URL(value.trim());
      if(!['http:','https:'].includes(url.protocol))throw Error();
      url.username='';url.password='';url.search='';url.hash='';
      if(url.href.length>4096)throw Error();
      return url.href;
    }catch{throw Error(TextPatchI18n.t('ai_invalid_website_url'));}
  }
  // Page context is deliberately narrower than the collected table and is never fetched here.
  function pageContext(page){
    if(!page || typeof page!=='object')return null;
    const url=websiteURL(page.url??'');
    if(!url)return null;
    return {url,title:typeof page.title==='string'?page.title.slice(0,500):'',language:typeof page.language==='string'?page.language.slice(0,100):''};
  }
  function build({table,task,sourceLanguage='auto',targetLanguage='',instruction='',page,requestId,locale=TextPatchI18n.locale}={}){
    locale=TextPatchI18n.resolveLocale(locale);
    const i18n={t:(key,params)=>TextPatchI18n.t(key,params,locale)};
    if(!table || table.schemaVersion!==1 || !Array.isArray(table.entries))throw Error(i18n.t('select_a_table_2'));
    if(!['translation','replacement'].includes(task))throw Error(i18n.t('choose_translation_or_text_replacement'));
    for(const value of [sourceLanguage,targetLanguage,instruction])if(typeof value!=='string' || value.length>4000)throw Error(i18n.t('languages_and_instructions_must_be_at_most_4000'));
    if(task==='translation' && !targetLanguage.trim())throw Error(i18n.t('specify_a_target_language'));
    if(task==='replacement' && !instruction.trim())throw Error(i18n.t('enter_a_text_replacement_instruction'));
    const indices=[];
    const eligible=table.entries.filter((e,index)=>{if(typeof e.ko==='string' && !e.ko.trim()){indices.push(index);return true;}return false;});
    const total=eligible.length;
    if(!total)throw Error(i18n.t('no_untranslated_rows_with_empty_replacement_text'));
    // Convert internal en/ko rows only at the external version 2 JSON boundary.
    const partial=root.TextPatch.portableTable({...table,entries:eligible});
    if(requestId){
      partial.aiRequest={version:1,id:requestId};
      partial.entries.forEach((row,i)=>{row.requestRow=String(indices[i]);});
    }
    const context=pageContext(page),references=[];
    function render(){return [
      task==='translation'?i18n.t('translation_task_source_language_p0_auto_means_automatic',{p0:sourceLanguage.trim()||'auto',p1:targetLanguage.trim()}):i18n.t('text_replacement_task_user_instruction_p0',{p0:instruction.trim()}),
      i18n.t('ai_response_language',{p0:TextPatchI18n.languages[locale]}),
      i18n.t('ai_replacement_field'),
      i18n.t('capture_sources_and_current_page_context_are_separate'),
      i18n.t('the_page_table_original_text_and_reference_translations'),
      i18n.t('return_a_portable_table_json_object_with_formattextpatchtable'),
      i18n.t('only_propose_text_for_empty_ko_fields_in'),
      i18n.t('current_page_context_separate_from_table_capture_sources')+JSON.stringify(context),
      i18n.t('readonly_existing_translation_references_exclude_from_response_entries')+JSON.stringify(references),
      i18n.t('json_data_start'),JSON.stringify(partial,null,2),i18n.t('json_data_end')
    ].join('\n\n');}
    // Existing translations are read-only context; every eligible work row is always included.
    for(const entry of table.entries){
      if(!entry.ko?.trim())continue;
      references.push(root.TextPatch.portableTable({entries:[entry]}).entries[0]);
    }
    const text=render(),bytes=utf8Bytes(text);
    return {text,bytes,copyable:bytes<=COPY_BYTE_BUDGET,count:total,total,nextOffset:null};
  }
  root.TextPatchAI={build,websiteURL,COPY_BYTE_BUDGET};
})(globalThis);
