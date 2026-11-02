import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

const read=file=>readFile(new URL('../extension/'+file,import.meta.url),'utf8');
const files=(await readdir(new URL('../extension/locales/',import.meta.url))).filter(file=>file.endsWith('.js'));
const scripts=await Promise.all([...files.map(file=>'locales/'+file),'i18n.js','shared.js','library.js','ai-request.js','ai-request-ui.js'].map(read));
const table={schemaVersion:1,id:'fixture',name:'User table {p0}',entries:[{id:'r',en:'Original <script> 日本語',ko:'',status:'untranslated',notes:'Keep {p0}'},{id:'reference',en:'Keep me',ko:'User translation',status:'in_review'}]};
const control=(dialog,name)=>dialog.querySelector('[data-ai="'+name+'"]');
const tokens=value=>[...value.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function storage(saved){
 const values=saved?{appLocale:saved}:{},listeners=[];
 return {values,chrome:{storage:{local:{get:async()=>({...values}),set:async patch=>{Object.assign(values,patch);for(const listener of listeners)listener({appLocale:{newValue:patch.appLocale}},'local');}},onChanged:{addListener:listener=>listeners.push(listener)}}}};
}
async function mount(t,{language='en',chrome}={}){
 const dom=new JSDOM('<body><label data-locale-chooser><select id="locale"></select></label><p data-i18n="save_changes"></p></body>',{url:'https://extension.test',runScripts:'outside-only'}),w=dom.window;
 t.after(()=>w.close());Object.defineProperty(w.navigator,'language',{value:language});w.structuredClone=structuredClone;if(chrome)w.chrome=chrome;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};for(const source of scripts)w.eval(source);
 await w.TextPatchI18n.ready;await tick();return w;
}

test('Portugal catalog independently covers all 422 English keys and tokens with Portugal vocabulary and unchanged protocol',async t=>{
 const w=await mount(t),source=await read('locales/pt-PT.js'),isolated=vm.createContext({});vm.runInContext(source,isolated);
 assert.deepEqual(Object.keys(isolated.TextPatchLocales),['pt-PT']);
 const en=w.TextPatchLocales.en,pt=isolated.TextPatchLocales['pt-PT'],br=w.TextPatchLocales['pt-BR'];
 assert.equal(Object.keys(en).length,422);assert.deepEqual(Object.keys(pt).sort(),Object.keys(en).sort());
 assert.equal([...source.matchAll(/^  "[^"]+":/gm)].length,422);
 for(const [key,value] of Object.entries(pt)){
  assert.ok(value.trim(),key);assert.deepEqual(tokens(value),tokens(en[key]),key);
  assert.equal(value.startsWith(' '),en[key].startsWith(' '),key+' prefix');assert.equal(value.endsWith(' '),en[key].endsWith(' '),key+' suffix');
  assert.doesNotMatch(value,/\uFFFD|\?{2,}|[\u0000-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u,key);
  const params=Object.fromEntries(tokens(value).map(token=>[token,'<script> 日本語 {untouched}']));
  assert.equal(w.TextPatchI18n.t(key,params,'pt-PT'),value.replace(/\{(\w+)\}/g,(_,token)=>params[token]),key);
 }
 assert.equal(pt.save_changes,'Guardar');assert.equal(pt.download_file,'Descarregar ficheiro');assert.equal(pt.interaction_settings,'Definições');assert.equal(pt.select_a_tab,'Selecione um separador.');
 assert.match(pt.text_replacement_task_user_instruction_p0,/utilizador/);assert.match(pt.translation_task_source_language_p0_auto_means_automatic,/deteção/);
 assert.ok(Object.keys(pt).filter(key=>pt[key]!==br[key]).length>200,'independent regional wording');
 assert.doesNotMatch(Object.values(pt).join('\n'),/\b(?:Salvar|salvar|salvando|Salvando|arquivo|arquivos|usuário|usuários|aplicativo|configurações|Configurações|coleta|Coleta|coletar|Coletar|detecção|registro|vínculo|gerenciar|Gerenciar|Baixar)\b/u);
 for(const literal of ['format:"text-patch-table"','version:2','name','defaults','captureSources','original','selector','notes','aiRequest','requestRow'])assert.ok(pt.return_a_portable_table_json_object_with_formattextpatchtable.includes(literal),literal);
 for(const key of ['verified_game_terms_need_an_official_source_url','game_terms_need_an_official_https_source_or'])assert.ok(pt[key].includes('사용자 확인:'),key);
 const metadata=JSON.parse(await read('_locales/pt_PT/messages.json'));assert.equal(metadata.appName.message,'SayItMyWay');assert.ok(metadata.appDescription.message.length<=132);
});

for(const [language,expected] of [['pt','pt-PT'],['pt-PT','pt-PT'],['PT_pt','pt-PT'],['pt-Latn-PT','pt-PT'],['pt-BR','pt-BR'],['PT_br','pt-BR']])test('Portuguese browser '+language+' defaults app and AI to '+expected,async t=>{
 const w=await mount(t,{language}),i=w.TextPatchI18n;
 assert.equal(i.resolveLocale(language),expected);assert.equal(i.locale,expected);assert.equal(w.document.documentElement.lang,expected);assert.equal(w.document.documentElement.dir,'ltr');
 const dialog=await w.TextPatchAIUI.open({table,loadPreferences:async()=>({targetLanguage:'English'})});
 assert.equal(control(dialog,'sourceLanguage').value,'auto');assert.equal(control(dialog,'targetLanguage').value,i.languages[expected]);
 assert.equal(control(dialog,'copy').textContent,i.t('copy_request'));
});

test('country and regional searches separate variants while generic Portuguese finds both and unsupported countries imply neither',async t=>{
 const w=await mount(t),i=w.TextPatchI18n;
 for(const query of ['Portugal','pt-PT','PT_pt','European Portuguese','Português europeu'])assert.deepEqual([...i.searchLanguages(query)],['pt-PT'],query);
 for(const query of ['Brazil','Brasil','pt-BR','PT_br','Brazilian Portuguese','Português brasileiro'])assert.deepEqual([...i.searchLanguages(query)],['pt-BR'],query);
 for(const query of ['Portuguese','Português','Portugues','pt'])assert.deepEqual([...i.searchLanguages(query)],['pt-BR','pt-PT'],query);
 for(const query of ['Angola','Mozambique','Moçambique','Cape Verde'])assert.deepEqual([...i.searchLanguages(query)],[],query);
 const select=w.document.getElementById('locale'),input=select.languagePicker.input;
 for(const [query,code] of [['Portugal','pt-PT'],['Brazil','pt-BR']]){
  input.focus();input.value=query;input.dispatchEvent(new w.Event('input',{bubbles:true}));
  const options=[...input.parentElement.querySelectorAll('[role=option]')];assert.deepEqual(options.map(node=>node.dataset.value),[code]);
  options[0].click();await tick();assert.equal(i.locale,code);
 }
});

test('saved Brazilian choice survives Portuguese browser default and both explicit choices persist, synchronize and reopen',async t=>{
 const bus=storage('pt-BR'),a=await mount(t,{language:'pt-PT',chrome:bus.chrome}),b=await mount(t,{language:'pt',chrome:bus.chrome});
 assert.equal(a.TextPatchI18n.locale,'pt-BR');assert.equal(a.document.querySelector('p').textContent,'Salvar');assert.equal(bus.values.appLocale,'pt-BR');
 assert.equal(a.TextPatchI18n.languages['pt-BR'],'Português (Brasil)');assert.equal(a.TextPatchI18n.languages['pt-PT'],'Português (Portugal)');
 for(const code of ['pt-PT','pt-BR']){
  await a.TextPatchI18n.setLocale(code);assert.equal(bus.values.appLocale,code);assert.equal(b.TextPatchI18n.locale,code);
  const reopened=await mount(t,{language:code==='pt-PT'?'pt-BR':'pt-PT',chrome:bus.chrome});assert.equal(reopened.TextPatchI18n.locale,code);
 }
});

test('AI defaults, both picker variants, custom drafts and Portuguese prompts preserve input data and the portable JSON contract',async t=>{
 const w=await mount(t,{language:'pt'}),before=JSON.stringify(table),i=w.TextPatchI18n;
 const dialog=await w.TextPatchAIUI.open({table,loadPreferences:async()=>({sourceLanguage:'Português (Brasil)',instruction:'Keep user text'})});
 assert.equal(control(dialog,'sourceLanguage').value,'Português (Brasil)');assert.equal(control(dialog,'targetLanguage').value,'Português (Portugal)');
 for(const field of ['sourceLanguage','targetLanguage'])for(const label of ['Português (Brasil)','Português (Portugal)'])assert.ok([...control(dialog,field).options].some(option=>option.value===label));
 control(dialog,'targetLanguage').value='__custom__';control(dialog,'targetLanguage').dispatchEvent(new w.Event('change'));control(dialog,'targetLanguageCustom').value='User custom target';
 await i.setLocale('pt-BR');assert.equal(control(dialog,'sourceLanguage').value,'Português (Brasil)');assert.equal(control(dialog,'targetLanguageCustom').value,'User custom target');assert.equal(control(dialog,'instruction').value,'Keep user text');
 for(const [locale,target] of [['pt-PT','Português (Portugal)'],['pt-BR','Português (Brasil)']])for(const task of ['translation','replacement']){
  const result=w.TextPatchAI.build({table,task,locale,targetLanguage:target,instruction:'Keep <script> 日本語 {p0}',requestId:'variant-fixture'}),pt=w.TextPatchLocales[locale];
  assert.ok(result.text.includes(i.t('ai_response_language',{p0:target},locale)));
  if(locale==='pt-PT')assert.match(result.text,/utilizador/);
  assert.ok(result.text.includes(i.t(task==='translation'?'translation_task_source_language_p0_auto_means_automatic':'text_replacement_task_user_instruction_p0',task==='translation'?{p0:'auto',p1:target}:{p0:'Keep <script> 日本語 {p0}'},locale)));
  const start=pt.json_data_start+'\n\n',end='\n\n'+pt.json_data_end,data=JSON.parse(result.text.slice(result.text.indexOf(start)+start.length,result.text.lastIndexOf(end)));
  assert.equal(data.format,'text-patch-table');assert.equal(data.version,2);assert.equal(data.aiRequest.id,'variant-fixture');assert.equal(data.entries.length,1);
  assert.equal(data.entries[0].original,table.entries[0].en);assert.equal(data.entries[0].replacement,'');assert.equal(data.entries[0].requestRow,'0');assert.equal(data.entries[0].notes,'Keep {p0}');
  assert.ok(result.text.includes('User translation'));assert.equal(result.count,1);
 }
 assert.equal(JSON.stringify(table),before);
});

test('Portugal catalog is loaded once before the registry in every extension entry point',async()=>{
 for(const file of ['popup.html','options.html','manager.html','editor/index.html','background.js']){
  const source=await read(file);assert.equal(source.split('locales/pt-PT.js').length-1,1,file);assert.ok(source.indexOf('locales/pt-PT.js')<source.indexOf('i18n.js'),file);
 }
});
