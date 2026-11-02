// App language only: table data and AI source/target choices are never translated.
(function(root){
  const KEY='appLocale',catalogs=root.TextPatchLocales||{},bindings=new Map(),listeners=new Set();
  const languages={ko:'한국어',en:'English',ja:'日本語','zh-Hans':'简体中文','zh-Hant':'繁體中文',es:'Español',fr:'Français',de:'Deutsch','pt-BR':'Português (Brasil)',ru:'Русский',id:'Bahasa Indonesia',vi:'Tiếng Việt',th:'ไทย',hi:'हिन्दी',ar:'العربية',ro:'Română',hu:'Magyar',bg:'Български',uk:'Українська',la:'Latina'};
  // Discovery aliases only: countries may match several languages. They never
  // infer a user's language or change the selected locale automatically.
  const languageAliases={
    ko:['Korean','Korea','South Korea','Republic of Korea','대한민국','한국','한글','조선','Hangul','ko-KR'],
    en:['English','United States','United States of America','USA','US','United Kingdom','UK','Great Britain','Britain','England','Canada','Australia','New Zealand','Ireland','en-US','en-GB'],
    ja:['Japanese','Japan','日本','日本国','にほん','にっぽん','ja-JP'],
    'zh-Hans':['Chinese','Simplified Chinese','Mandarin','China','People’s Republic of China',"People's Republic of China",'PRC','Mainland China','Singapore','中国','中國','中华人民共和国','中華人民共和國','新加坡','中文','汉语','汉字','zh','zh-CN','zh-SG'],
    'zh-Hant':['Chinese','Traditional Chinese','Mandarin','China','Taiwan','Republic of China','ROC','Hong Kong','Macao','Macau','中国','中國','臺灣','台灣','中華民國','香港','澳門','澳门','中文','漢語','漢字','zh','zh-TW','zh-HK','zh-MO'],
    es:['Spanish','Castilian','Spain','España','Castellano','Mexico','México','Argentina','Colombia','Chile','Peru','Perú','Latin America','América Latina','es-ES','es-MX','es-419'],
    fr:['French','France','Belgium','Belgique','Switzerland','Suisse','Canada','Québec','Quebec','Luxembourg','fr-FR','fr-CA'],
    de:['German','Germany','Deutschland','Austria','Österreich','Switzerland','Schweiz','Liechtenstein','Luxembourg','Luxemburg','de-DE','de-AT','de-CH'],
    'pt-BR':['Portuguese','Brazilian Portuguese','Brazil','Brasil','Portugal','Angola','Mozambique','Moçambique','pt','pt-BR','pt-PT'],
    ru:['Russian','Russia','Russian Federation','Россия','Российская Федерация','Беларусь','Belarus','Kazakhstan','Казахстан','ru-RU'],
    id:['Indonesian','Indonesia','Republic of Indonesia','Republik Indonesia','Bahasa','id-ID'],
    vi:['Vietnamese','Vietnam','Viet Nam','Việt Nam','Cộng hòa xã hội chủ nghĩa Việt Nam','Tiếng Việt','vi-VN'],
    th:['Thai','Thailand','ประเทศไทย','ราชอาณาจักรไทย','สยาม','Siam','th-TH'],
    hi:['Hindi','India','Republic of India','भारत','भारत गणराज्य','हिंदुस्तान','हिन्दुस्तान','हिंदी','hi-IN'],
    ar:['Arabic','Saudi Arabia','Kingdom of Saudi Arabia','السعودية','المملكة العربية السعودية','Egypt','مصر','United Arab Emirates','UAE','الإمارات','Iraq','العراق','Syria','سوريا','Jordan','الأردن','Lebanon','لبنان','Morocco','المغرب','Algeria','الجزائر','Tunisia','تونس','ar-SA','ar-EG','ar-AE'],
    ro:['Romanian','Romania','România','Moldova','Republic of Moldova','Republica Moldova','Moldovan','Moldovenească','ro-RO','ro-MD'],
    hu:['Hungarian','Hungary','Magyarország','Magyarorszag','hu-HU'],
    bg:['Bulgarian','Bulgaria','Republic of Bulgaria','България','Република България','bg-BG'],
    uk:['Ukrainian','Ukraine','Україна','Украина','uk-UA'],
    la:['Latin','Vatican','Vatican City','Holy See','Vatican City State','Civitas Vaticana','Status Civitatis Vaticanae','Sancta Sedes','Latinitas','Lingua Latina','la-VA']
  };
  const normalizeLanguage=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replaceAll('ß','ss').replaceAll('_','-').trim();
  const languageTerms=Object.fromEntries(Object.entries(languages).map(([code,name])=>[code,[code,name,...languageAliases[code]].map(normalizeLanguage)]));
  const searchLanguages=query=>Object.keys(languages).filter(code=>languageTerms[code].some(term=>term.includes(normalizeLanguage(query))));
  const pickers=new Set();let pickerId=0;

  // The select remains the value/event contract. Its single visible replacement
  // is an editable combobox; search text is never a committed language value.
  function languagePicker(select,{label=()=>select.getAttribute('aria-label')||t('app_language'),onSearch=()=>{}}={}){
    if(select.languagePicker)return select.languagePicker;
    const doc=select.ownerDocument,host=doc.createElement('span'),input=doc.createElement('input'),list=doc.createElement('span');
    const id='language-choice-'+(++pickerId);
    host.className='language-combobox';input.id=id;input.type='text';input.autocomplete='off';input.spellcheck=false;input.dir='auto';input.className='language-search';
    input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-haspopup','listbox');input.setAttribute('aria-controls',id+'-list');input.setAttribute('aria-expanded','false');
    list.id=id+'-list';list.className='language-results';list.setAttribute('role','listbox');list.hidden=true;
    for(const owner of select.labels||[])if(owner.htmlFor===select.id)owner.htmlFor=input.id;
    select.hidden=true;select.tabIndex=-1;select.classList.add('language-native');select.after(host);host.append(input,list);
    let open=false,query='',dirty=false,composing=false,active=-1,matches=[],selectedValue;
    function options(){
      const codes=new Set(searchLanguages(query)),needle=normalizeLanguage(query);
      return [...select.options].filter(option=>{
        if(option.disabled)return false;
        const code=Object.hasOwn(languages,option.value)?option.value:Object.keys(languages).find(code=>languages[code]===option.value);
        return code?codes.has(code):[option.textContent,option.value,...(option.value==='auto'?['Auto detect','Automatic detection']:option.value==='__custom__'?['Custom language']:[])].some(term=>normalizeLanguage(term).includes(needle));
      });
    }
    function activate(index){
      active=index;
      for(const [i,node] of [...list.querySelectorAll('[role=option]')].entries())node.classList.toggle('active',i===active);
      if(active<0)input.removeAttribute('aria-activedescendant');
      else {input.setAttribute('aria-activedescendant',id+'-option-'+active);list.children[active]?.scrollIntoView?.({block:'nearest'});}
    }
    function render(){
      matches=options();list.replaceChildren();
      for(const [index,option] of matches.entries()){
        const node=doc.createElement('span');node.id=id+'-option-'+index;node.setAttribute('role','option');node.setAttribute('aria-selected',String(option.value===select.value));node.dir='auto';node.textContent=option.textContent;node.dataset.value=option.value;
        node.addEventListener('pointerdown',event=>event.preventDefault());
        node.addEventListener('click',event=>{event.preventDefault();choose(index);});list.append(node);
      }
      if(!matches.length){const empty=doc.createElement('span');empty.className='language-empty';empty.setAttribute('role','status');empty.textContent=t('no_search_results');list.append(empty);}
      activate(-1);
    }
    function show(){if(select.disabled)return;open=true;list.hidden=false;input.setAttribute('aria-expanded','true');render();}
    function close(){open=false;query='';dirty=false;list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');input.value=select.selectedOptions[0]?.textContent||'';}
    function choose(index){
      const option=matches[index];if(!option)return;
      select.value=option.value;close();selectedValue=select.value;
      select.dispatchEvent(new root.Event('input',{bubbles:true}));select.dispatchEvent(new root.Event('change',{bubbles:true}));
    }
    function refresh(){
      const text=label();input.setAttribute('aria-label',text);input.title=select.title||text;list.setAttribute('aria-label',text);input.disabled=select.disabled;input.setAttribute('aria-required',String(select.required));
      if(selectedValue!==select.value || !dirty){input.value=select.selectedOptions[0]?.textContent||'';selectedValue=select.value;}
      if(open)render();
    }
    input.addEventListener('focus',()=>{query='';dirty=false;show();input.select();});
    input.addEventListener('click',()=>{if(!open){query='';show();input.select();}});
    input.addEventListener('input',()=>{dirty=true;query=input.value;onSearch();if(!composing)show();});
    input.addEventListener('compositionstart',()=>{composing=true;});
    input.addEventListener('compositionend',()=>{composing=false;dirty=true;query=input.value;onSearch();show();});
    input.addEventListener('keydown',event=>{
      if(composing || event.isComposing || event.keyCode===229)return;
      if(['ArrowDown','ArrowUp'].includes(event.key)){
        event.preventDefault();if(!open)show();
        activate(matches.length?(event.key==='ArrowDown'?Math.min(active+1,matches.length-1):(active<0?matches.length-1:Math.max(active-1,0))):-1);
      }else if(event.key==='Enter' && open){event.preventDefault();choose(active);}
      else if(event.key==='Escape' && (open||dirty)){event.preventDefault();close();}
      else if(event.key==='Tab')close();
    });
    host.addEventListener('focusout',()=>{Promise.resolve().then(()=>{if(!host.contains(doc.activeElement))close();});});
    select.addEventListener('change',()=>{close();refresh();});
    const api={input,host,close,refresh};select.languagePicker=api;pickers.add({select,...api});refresh();return api;
  }
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
    for(const el of document.querySelectorAll('[data-locale-chooser] select')){
      el.value=locale;
      const label=t('app_language');el.title=label;el.setAttribute('aria-label',label);
    }
    for(const [node,properties] of bindings){
      if(!node.isConnected){bindings.delete(node);continue;}
      for(const [property,resolve] of properties)if(property==='textContent')node.textContent=resolve();else node.setAttribute(property,resolve());
    }
    for(const picker of pickers){if(!picker.select.isConnected)pickers.delete(picker);else picker.refresh();}
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
  root.TextPatchI18n={t,text,attribute,message,apply,onChange,setLocale,browserLocale,resolveLocale,languages,languageAliases,searchLanguages,languagePicker,get locale(){return locale;},key:KEY};
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
      for(const select of root.document.querySelectorAll('[data-locale-chooser] select')){
        select.addEventListener('change',()=>setLocale(select.value).catch(()=>{select.title=t('could_not_save_language_choice');select.languagePicker?.refresh();}));
        languagePicker(select);
      }
    };
    root.document.addEventListener('pointerdown',event=>{for(const picker of pickers){if(!picker.select.isConnected)pickers.delete(picker);else if(!picker.host.contains(event.target))picker.close();}});
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  }
})(globalThis);
