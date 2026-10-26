import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const read=file=>readFile(new URL('../extension/'+file,import.meta.url),'utf8');
const localeFiles=(await readdir(new URL('../extension/locales/',import.meta.url))).filter(file=>file.endsWith('.js'));
const scripts=await Promise.all([...localeFiles.map(file=>'locales/'+file),'i18n.js','shared.js','library.js','ai-request.js','ai-request-ui.js'].map(read));
const promptKeys=[
  'ai_response_language','ai_replacement_field',
  'capture_sources_and_current_page_context_are_separate',
  'the_page_table_original_text_and_reference_translations',
  'return_a_portable_table_json_object_with_formattextpatchtable',
  'only_propose_text_for_empty_ko_fields_in',
  'current_page_context_separate_from_table_capture_sources',
  'readonly_existing_translation_references_exclude_from_response_entries',
  'json_data_start','json_data_end'
];
const taskKeys={translation:'translation_task_source_language_p0_auto_means_automatic',replacement:'text_replacement_task_user_instruction_p0'};
const row=(en,extra={})=>({en,ko:'',status:'untranslated',kind:'general',category:'general',source:'User source 原文',evidence:'User evidence العربية',selector:'.article',notes:'Keep {p0} <b>notes</b>',...extra});
const table={schemaVersion:1,id:'private-id',name:'User table العربية 日本語',defaults:{matchMode:'word',caseSensitive:true,translatePlaceholders:false},captureSources:[{url:'https://source.example/ja',title:'Original title 日本語',language:'ja',capturedAt:'2026-10-20T00:00:00Z'}],entries:[row('Source {p0} <b>😀</b>'),row('Second original'),row('Reference',{ko:'既存 ترجمة',status:'verified'})]};
const options={table,requestId:'request-locale',sourceLanguage:'Historical Latin',targetLanguage:'Esperanto',instruction:'User instruction {p0} العربية <script>data</script>',page:{url:'https://context.example/ja',title:'Page title 日本語',language:'ja'}};
const plain=value=>JSON.parse(JSON.stringify(value));

async function setup(){
  const dom=new JSDOM('<body></body>',{url:'http://localhost',runScripts:'outside-only'}),w=dom.window;
  w.structuredClone=structuredClone;
  for(const source of scripts)w.eval(source);
  await w.TextPatchI18n.ready;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  return dom;
}
function payload(w,text){
  const start=w.TextPatchI18n.t('json_data_start')+'\n\n',end='\n\n'+w.TextPatchI18n.t('json_data_end');
  return JSON.parse(text.slice(text.indexOf(start)+start.length,text.lastIndexOf(end)));
}
const control=(dialog,name)=>dialog.querySelector('[data-ai="'+name+'"]');

test('all 15 app locales generate both tasks with localized prose and unchanged portable JSON',async()=>{
  const dom=await setup(),w=dom.window,before=JSON.stringify(options);
  try{
    const locales=Object.keys(w.TextPatchI18n.languages);assert.equal(locales.length,15);
    for(const locale of locales){
      await w.TextPatchI18n.setLocale(locale);
      for(const task of ['translation','replacement']){
        const {text,bytes,count}=w.TextPatchAI.build({...options,task}),catalog=w.TextPatchLocales[locale];
        for(const key of [...promptKeys,taskKeys[task]]){
          assert.ok(Object.hasOwn(catalog,key),locale+': owns '+key);
          assert.doesNotMatch(catalog[key],/\uFFFD|\?{2,}/u,locale+': intact UTF-8 '+key);
          if(locale!=='en')assert.notEqual(catalog[key],w.TextPatchLocales.en[key],locale+': translated '+key);
          assert.ok(text.includes(w.TextPatchI18n.t(key,{p0:key===taskKeys.translation?options.sourceLanguage:key===taskKeys.replacement?options.instruction:w.TextPatchI18n.languages[locale],p1:options.targetLanguage})),locale+': renders '+key);
        }
        assert.equal(count,2);assert.equal(bytes,Buffer.byteLength(text,'utf8'));
        assert.deepEqual(payload(w,text),{...plain(w.TextPatch.portableTable({...table,entries:table.entries.slice(0,2)})),aiRequest:{version:1,id:'request-locale'},entries:plain(w.TextPatch.portableTable({...table,entries:table.entries.slice(0,2)})).entries.map((row,i)=>({...row,requestRow:String(i)}))},locale+': metadata and schema unchanged');
        const data=payload(w,text);assert.equal(data.entries[0].selector,'.article');assert.equal(data.entries[0].notes,table.entries[0].notes);assert.deepEqual(data.captureSources,table.captureSources);
        assert.equal(data.version,2);assert.equal(data.entries[0].original,table.entries[0].en);
        assert.equal(data.entries[0].replacement,'');for(const field of ['status','kind','context','category','source','evidence'])assert.equal(Object.hasOwn(data.entries[0],field),false,locale+': no '+field);
        assert.equal(data.entries[0].en,undefined);assert.equal(data.entries[0].ko,undefined);
        const schema=catalog.return_a_portable_table_json_object_with_formattextpatchtable;
        assert.ok(schema.includes('version:2'));assert.ok(schema.includes('original'));
        for(const key of ['ai_replacement_field','return_a_portable_table_json_object_with_formattextpatchtable','only_propose_text_for_empty_ko_fields_in'])assert.doesNotMatch(catalog[key],/\b(?:en|ko)\b(?=\/status|[,.])/);
        const reference=JSON.parse(text.split(catalog.readonly_existing_translation_references_exclude_from_response_entries)[1].split('\n\n')[0]);
        assert.deepEqual(reference,plain(w.TextPatch.portableTable({entries:[table.entries[2]]}).entries));
        const page=JSON.parse(text.split(catalog.current_page_context_separate_from_table_capture_sources)[1].split('\n\n')[0]);
        assert.deepEqual(page,options.page,locale+': website language remains source data');
        for(const literal of ['original','replacement','JSON'])assert.ok(catalog.ai_replacement_field.includes(literal));
        for(const literal of ['entries','replacement','JSON'])assert.ok(catalog.only_propose_text_for_empty_ko_fields_in.includes(literal));
        for(const key of ['ai_replacement_field','return_a_portable_table_json_object_with_formattextpatchtable','only_propose_text_for_empty_ko_fields_in'])assert.doesNotMatch(catalog[key],/\b(?:status|kind|context|category|source|evidence|review|untranslated|verified)\b/,locale+': clean '+key);
      }
    }
    assert.equal(JSON.stringify(options),before,'builder never mutates source, instructions or metadata');
  }finally{w.close();}
});

test('open dialog delivers current locale for both tasks in all 15 locales with identical builder/copy/download text',async()=>{
  const dom=await setup(),w=dom.window,before=JSON.stringify(table);let copied,blob,saved;
  Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text=>{copied=text;}}});
  w.URL.createObjectURL=value=>{blob=value;return 'blob:test';};w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=function(){};
  try{
    await w.TextPatchI18n.setLocale('en');
    const dialog=await w.TextPatchAIUI.open({table,page:options.page,loadPreferences:()=>options,savePreferences:value=>{saved=plain(value);}});
    control(dialog,'targetLanguage').value='__custom__';control(dialog,'targetLanguageCustom').value=options.targetLanguage;control(dialog,'targetLanguage').dispatchEvent(new w.Event('change'));
    for(const locale of Object.keys(w.TextPatchI18n.languages)){
      // Switch after opening; neither target Esperanto nor website ja determines prompt language.
      await w.TextPatchI18n.setLocale(locale);
      for(const task of ['translation','replacement']){
        control(dialog,'task').value=task;control(dialog,'task').dispatchEvent(new w.Event('change'));
        const {requestId,...dialogOptions}=options;const expected=w.TextPatchAI.build({...dialogOptions,task}).text;
        await control(dialog,'copy').onclick();assert.equal(copied,expected,locale+': '+task+' copy');
        await control(dialog,'download').onclick();
        const downloaded=await new Promise((resolve,reject)=>{const reader=new w.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsText(blob,'UTF-8');});
        assert.equal(downloaded,expected,locale+': '+task+' UTF-8 file');
        assert.deepEqual(payload(w,downloaded),payload(w,copied));
        assert.deepEqual(saved,{task,sourceLanguage:options.sourceLanguage,targetLanguage:options.targetLanguage,instruction:options.instruction});
      }
    }
    assert.equal(JSON.stringify(table),before);
  }finally{w.close();}
});
