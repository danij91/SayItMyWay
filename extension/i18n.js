// App language only: table data and AI source/target choices are never translated.
(function(root){
  const KEY='appLocale',catalogs=root.TextPatchLocales||{},bindings=new Map(),listeners=new Set();
  const languages={ko:'한국어',en:'English',ja:'日本語','zh-Hans':'简体中文','zh-Hant':'繁體中文',es:'Español',fr:'Français',de:'Deutsch','pt-BR':'Português (Brasil)',ru:'Русский',id:'Bahasa Indonesia',vi:'Tiếng Việt',th:'ไทย',hi:'हिन्दी',ar:'العربية'};
  const supported=value=>Object.hasOwn(languages,value);
  function resolveLocale(value){
    const parts=String(value||'').replaceAll('_','-').toLowerCase().split('-'),base=parts[0];
    if(base==='zh')return parts.includes('hant')?'zh-Hant':parts.includes('hans')?'zh-Hans':parts.some(p=>['tw','hk','mo'].includes(p))?'zh-Hant':'zh-Hans';
    if(base==='pt')return 'pt-BR';
    return supported(base)?base:'en';
  }
  const browserLocale=()=>resolveLocale(root.chrome?.i18n?.getUILanguage?.()||root.navigator?.language||'en');
  let locale=browserLocale(),generation=0,pruneScheduled=false,writes=Promise.resolve(),pendingWrites=0,chosenLocale;
  function t(key,params={},language=locale){
    const get=catalog=>catalog&&Object.hasOwn(catalog,key)?catalog[key]:undefined;
    const value=get(catalogs[resolveLocale(language)])??get(catalogs.en)??key;
    return String(value).replace(/\{([a-zA-Z0-9_]+)\}/g,(token,name)=>Object.hasOwn(params,name)?String(params[name]):token);
  }
  function bind(node,property,resolve){
    let properties=bindings.get(node);if(!properties){properties=new Map();bindings.set(node,properties);}
    properties.set(property,resolve);
    if(!pruneScheduled){
      pruneScheduled=true;
      Promise.resolve().then(()=>{pruneScheduled=false;for(const node of bindings.keys())if(!node.isConnected)bindings.delete(node);});
    }
    if(property==='textContent'){node.removeAttribute?.('data-i18n');node.textContent=resolve();}
    else {node.removeAttribute?.('data-i18n-'+property);node.setAttribute(property,resolve());}
  }
  const text=(node,resolve)=>bind(node,'textContent',resolve);
  const attribute=(node,name,resolve)=>bind(node,name,resolve);
  function apply(document=root.document){
    if(!document)return;
    document.documentElement.lang=locale;
    document.documentElement.dir=locale==='ar'?'rtl':'ltr';
    for(const el of document.querySelectorAll('[data-i18n]'))el.textContent=(el.hasAttribute('data-brand-title')?t('text_table_patch')+' \u00b7 ':'')+t(el.dataset.i18n);
    for(const attr of ['title','aria-label','placeholder'])for(const el of document.querySelectorAll('[data-i18n-'+attr+']'))el.setAttribute(attr,t(el.getAttribute('data-i18n-'+attr)));
    for(const el of document.querySelectorAll('[data-locale-chooser] select'))el.value=locale;
    for(const [node,properties] of bindings){
      if(!node.isConnected){bindings.delete(node);continue;}
      for(const [property,resolve] of properties)if(property==='textContent')node.textContent=resolve();else node.setAttribute(property,resolve());
    }
  }
  function change(value){if(!supported(value)||value===locale)return;locale=value;apply();for(const listener of listeners)listener(locale);}
  const onChange=listener=>{listeners.add(listener);return ()=>listeners.delete(listener);};
  async function setLocale(value){
    if(!supported(value))return;
    generation++;chosenLocale=value;change(value);pendingWrites++;
    const write=()=>root.chrome?.storage?.local?root.chrome.storage.local.set({[KEY]:value}):root.localStorage?.setItem(KEY,value);
    const result=writes.catch(()=>{}).then(write);writes=result;
    try{await result;}finally{pendingWrites--;}
  }
  // Stable source aliases: validators and persisted reasons retain their original text.
  const legacyKoreanSources={
    "collection_deleted": "수집한 대응표가 삭제되었습니다.",
    "page_or_table_changed_select_it_again": "페이지 또는 대응표가 바뀌었습니다. 다시 선택하세요.",
    "could_not_read_the_default_table": "기본 대응표 읽기 실패",
    "invalid_table_format": "대응표 형식이 올바르지 않습니다.",
    "enter_a_table_name": "대응표 이름을 입력하세요.",
    "invalid_table_collection_format": "잘못된 대응표 모음 형식입니다.",
    "check_table_defaults": "표 기본값을 확인하세요.",
    "check_table_id_or_name": "대응표 ID 또는 이름을 확인하세요.",
    "no_table_is_available_to_link": "연결할 대응표가 없습니다.",
    "no_tables_to_migrate": "이전할 대응표가 없습니다.",
    "could_not_read_the_default_table_2": "기본 대응표 읽기 실패: ",
    "could_not_read_the_table_to_migrate": "이전할 대응표 파일 읽기 실패: ",
    "cannot_open_table_storage_close_other_extension_pages": "대응표 저장소를 열 수 없습니다. 다른 확장 화면을 닫고 재시도하세요.",
    "table_save_was_canceled": "대응표 저장이 취소되었습니다.",
    "table_storage_is_not_initialized": "대응표 저장소가 초기화되지 않았습니다.",
    "the_default_crimson_desert_table_cannot_be_deleted": "기본 붉은사막 대응표는 삭제할 수 없습니다.",
    "the_collected_table_was_deleted_2": "수집한 표가 삭제되었습니다.",
    "check_the_json_format_of_tables_rows_and": "대응표·행·기본값의 JSON 형식을 확인하세요.",
    "this_file_has_no_table_id_explicitly_select": "표 ID가 없는 파일입니다. 가져올 대상 표를 명시적으로 선택하세요.",
    "check_the_table_json_format": "대응표의 JSON 형식을 확인하세요.",
    "check_the_table_defaults_json_format": "표 기본값의 JSON 형식을 확인하세요.",
    "select_a_table_to_export": "내보낼 표를 선택하세요.",
    "unsupported_portable_table_version": "지원하지 않는 교환 표 버전입니다.",
    "check_the_table_format_to_import": "가져올 대응표 형식을 확인하세요.",
    "table_collection_exceeds_5mb": "대응표 모음이 5MB를 넘습니다.",
    "check_the_target_table_and_original_text_format": "수집 대상 표와 원문 형식을 확인하세요.",
    "table_not_found_specify_a_new_table_name": "없는 표입니다. 새 표 이름을 지정하세요.",
    "each_table_can_store_up_to_50_capture": "수집 출처는 표마다 50개까지 저장할 수 있습니다.",
    "dev_missing_storage": "대응표 저장 파일이 누락되었습니다. 백업을 복구하세요.",
    "dev_default_table": "기본 붉은사막 대응표는 삭제할 수 없습니다. 새 표를 추가하거나 복사하세요.",
    "dev_library_size": "대응표 모음이 5MB를 넘습니다. 원문 수를 줄이세요."
  };
  // Adapt known legacy validation messages and persisted collection reasons only.
  // Call this at error/status boundaries; never pass user table text through it.
  function message(value,depth=0){
    const input=String(value??'');if(depth>4)return input;
    for(const catalog of [legacyKoreanSources,...Object.values(catalogs)])for(const [key,source] of Object.entries(catalog)){
      if(input===source)return t(key);
      if(/^(?:잘못된 필드:|Invalid field:)/.test(source)&&source.includes('{')){
        const names=[],pattern=source.split(/(\{\w+\})/).map(part=>/^\{\w+\}$/.test(part)?(names.push(part.slice(1,-1)),'(.*?)'):part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('');
        const match=input.match(new RegExp('^'+pattern+'$','s'));
        if(match)return t(key,Object.fromEntries(names.map((name,index)=>[name,match[index+1]])));
      }
    }
    const prefixes=[legacyKoreanSources,...Object.values(catalogs)].flatMap(c=>Object.entries(c)).filter(([,source])=>source.length>10&&/(?:[:·] |\. )$/.test(source)).sort((a,b)=>b[1].length-a[1].length);
    for(const [key,source] of prefixes)if(input.startsWith(source))return t(key)+message(input.slice(source.length),depth+1);
    return input;
  }
  root.TextPatchI18n={t,text,attribute,message,apply,onChange,setLocale,browserLocale,resolveLocale,languages,get locale(){return locale;},key:KEY};
  const started=generation;
  root.TextPatchI18n.ready=(async()=>{
    try{
      const value=root.chrome?.storage?.local?(await root.chrome.storage.local.get([KEY]))?.[KEY]:root.localStorage?.getItem(KEY);
      if(started===generation&&supported(value))change(value);
    }catch{/* Storage failure still leaves the browser default usable. */}
    apply();
  })();
  root.chrome?.storage?.onChanged?.addListener((changes,area)=>{if(area==='local'&&changes[KEY]){generation++;const value=changes[KEY].newValue??browserLocale();if(!pendingWrites||value===chosenLocale)change(value);}});
  root.addEventListener?.('storage',event=>{if(event.key===KEY){generation++;change(event.newValue??browserLocale());}});
  if(root.document){
    const mount=()=>{
      for(const select of root.document.querySelectorAll('[data-locale-chooser] select')){
        select.replaceChildren(...Object.entries(languages).map(([value,name])=>{const option=root.document.createElement('option');option.value=value;option.textContent=name;option.dir='auto';return option;}));
      }
      apply();
      for(const select of root.document.querySelectorAll('[data-locale-chooser] select'))select.addEventListener('change',()=>setLocale(select.value).catch(()=>{select.title=t('could_not_save_language_choice');}));
    };
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  }
})(globalThis);
