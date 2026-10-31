(function(root) {
  const S=root.CrimsonShared;
  function uniqueTableName(name,tables,excludeId){
    if(typeof name!=='string' || !name.trim())throw Error('대응표 이름을 입력하세요.');
    const base=name.trim().slice(0,200),used=new Set(tables.filter(t=>excludeId===undefined || t.id!==excludeId).map(t=>t.name));
    if(!used.has(base))return base;
    for(let n=2;;n++){
      const suffix=` (${n})`,candidate=base.slice(0,200-suffix.length)+suffix;
      if(!used.has(candidate))return candidate;
    }
  }
  // An allowlist keeps storage IDs, exclusions and extension metadata out of exchange files.
  function portableTable(table){
    const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,structuredClone(value[key])]));
    return {format:'text-patch-table',version:2,name:table.name,
      ...(table.defaults?{defaults:pick(table.defaults,['matchMode','caseSensitive','translatePlaceholders'])}:{}),
      ...(table.captureSources?{captureSources:table.captureSources.map(s=>pick(s,['url','title','language','capturedAt']))}:{}),
      entries:table.entries.map(e=>{
        if(Object.hasOwn(e,'original') || Object.hasOwn(e,'replacement'))throw Error('원문·대체문 필드 형식이 혼합되어 있습니다.');
        return {original:e.en,replacement:e.ko,...pick(e,['selector','notes','matchMode','caseSensitive'])};
      })};
  }
  function migrate(dictionary) {
    S.validate(dictionary);
    return validateLibrary({schemaVersion:2,revision:1,tables:[{...dictionary,id:'crimson-desert',name:'붉은사막',description:'기존 붉은사막 지도 대응표.',excludedTerms:dictionary.excludedTerms || []}]});
  }
  function validateLibrary(library) {
    if(library?.schemaVersion!==2 || !Number.isSafeInteger(library.revision) || library.revision<1 || !Array.isArray(library.tables) || library.tables.length>100)throw Error('잘못된 대응표 모음 형식입니다.');
    const ids=new Set();
    for(const table of library.tables){
      S.validate(table);
      table.defaults ??= {matchMode:'exact',caseSensitive:false,translatePlaceholders:true};
      if(!['exact','word'].includes(table.defaults.matchMode) || typeof table.defaults.caseSensitive!=='boolean' || typeof table.defaults.translatePlaceholders!=='boolean')throw Error('표 기본값을 확인하세요.');
      if(typeof table.id!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(table.id) || ids.has(table.id) || typeof table.name!=='string' || !table.name.trim() || table.name.length>200 || typeof table.description!=='string')throw Error('대응표 ID 또는 이름을 확인하세요.');
      ids.add(table.id);
      for(const field of ['excludedTerms'])if(table[field]!==undefined && (!Array.isArray(table[field]) || table[field].some(s=>typeof s!=='string' || s.length>2000)))throw Error('원문 유지 설정이 올바르지 않습니다.');
    }
    return library;
  }
  function webURL(value){
    const u=new URL(value);
    if(!['http:','https:'].includes(u.protocol) || u.username || u.password)throw Error('HTTP/HTTPS 사이트만 등록할 수 있습니다.');
    return u;
  }
  function ruleTarget(value,scope){
    let u;
    try{u=webURL(value);}catch{throw Error(root.TextPatchI18n?.t('site_url_invalid') ?? 'site_url_invalid');}
    if(!['page','prefix','site'].includes(scope))throw Error(root.TextPatchI18n?.t('invalid_application_rule') ?? 'invalid_application_rule');
    return {origin:u.origin,scope,path:scope==='site'?'/':u.pathname,url:u.href};
  }
  function navigationURL(rule){
    const value=rule.url===undefined?rule.origin+(rule.scope==='site'?'/':rule.path):rule.url;
    let u;try{u=webURL(value);}catch{throw Error(root.TextPatchI18n?.t('site_url_invalid') ?? 'site_url_invalid');}
    if(!matches(rule,u.href))throw Error(root.TextPatchI18n?.t('site_url_mismatch') ?? 'site_url_mismatch');
    return u.href;
  }
  function seedRuleOptions(rules,library) {
    for(const rule of rules){
      const defaults=library?.tables.find(t=>t.id===rule.tableId)?.defaults;
      if(rule.matchMode===undefined)rule.matchMode=defaults?.matchMode ?? 'exact';
      if(rule.caseSensitive===undefined)rule.caseSensitive=defaults?.caseSensitive ?? false;
    }
    return rules;
  }
  function validateRules(rules, library) {
    if(!Array.isArray(rules) || rules.length>500)throw Error('적용 규칙 형식이 올바르지 않습니다.');
    const ids=new Set(), targets=new Set();
    for(const r of rules){
      if(typeof r.id!=='string' || !r.id || ids.has(r.id) || typeof r.enabled!=='boolean' || !['site','prefix','page'].includes(r.scope))throw Error('잘못된 적용 규칙입니다.');
      if((r.matchMode!==undefined && !['exact','word'].includes(r.matchMode)) || (r.caseSensitive!==undefined && typeof r.caseSensitive!=='boolean'))throw Error('잘못된 적용 규칙입니다.');
      const u=webURL(r.origin);
      if(u.origin!==r.origin || typeof r.path!=='string' || !r.path.startsWith('/') || r.path.includes('#') || r.path.includes('?') || r.path.includes('*') || typeof r.tableId!=='string')throw Error('사이트 주소 또는 경로를 확인하세요. 쿼리·해시는 적용 범위에서 제외됩니다.');
      if(r.url!==undefined)navigationURL(r);
      if(library && !library.tables.some(t=>t.id===r.tableId))throw Error('연결할 대응표가 없습니다.');
      const key=JSON.stringify([r.origin,r.scope,r.scope==='site'?'/':r.path]);
      if(targets.has(key))throw Error('같은 사이트·범위의 규칙이 중복되었습니다.');
      ids.add(r.id);targets.add(key);
    }
    return rules;
  }
  function matches(rule,url){
    try {
      const u=webURL(url);
      if(u.origin!==rule.origin)return false;
      if(rule.scope==='site')return true;
      if(rule.scope==='page')return u.pathname===rule.path;
      const p=rule.path.replace(/\/$/,'');
      return !p || u.pathname===p || u.pathname.startsWith(p+'/');
    }catch{return false;}
  }
  function selectRule(rules,url){
    // Select the saved scope first: a paused specific rule blocks broader rules.
    return rules.filter(r=>matches(r,url)).sort((a,b)=>({site:0,prefix:1,page:2}[b.scope]-{site:0,prefix:1,page:2}[a.scope]) || b.path.length-a.path.length || a.id.localeCompare(b.id))[0]||null;
  }
  function hostPattern(origin){return webURL(origin).protocol+'//'+webURL(origin).hostname+'/*';}
  const defaultRules=()=>[{id:'crimson-default',origin:'https://mapgenie.io',scope:'prefix',path:'/crimson-desert/maps/pywel',tableId:'crimson-desert',enabled:true}];
  root.TextPatch={seedRuleOptions,migrate,validateLibrary,validateRules,webURL,matches,selectRule,hostPattern,defaultRules,uniqueTableName,portableTable,ruleTarget,navigationURL};
})(globalThis);
