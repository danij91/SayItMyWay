(function(root) {
function normalizeSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source) || typeof source.url !== 'string' || source.url.length > 4096 ||
      /[\u0000-\u001f\u007f]/.test(source.url)) throw Error('수집 출처 주소를 확인하세요.');
  let url;
  try {url=new URL(source.url);} catch {throw Error('수집 출처 주소를 확인하세요.');}
  if (!['http:','https:'].includes(url.protocol)) throw Error('수집 출처는 HTTP/HTTPS만 허용합니다.');
  url.username='';url.password='';url.search='';url.hash='';
  if(url.href.length>4096)throw Error('수집 출처 주소가 너무 깁니다.');
  const normalized={url:url.href};
  for (const [key,max] of [['title',500],['language',100]]) {
    if(source[key]!==undefined && (typeof source[key]!=='string' || source[key].length>max))throw Error('수집 출처 제목·언어 길이를 확인하세요.');
    normalized[key]=(source[key]||'').trim();
  }
  if(source.capturedAt!==undefined && (typeof source.capturedAt!=='string' || source.capturedAt.length>40 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(source.capturedAt) || !Number.isFinite(Date.parse(source.capturedAt))))throw Error('수집 출처 시각을 확인하세요.');
  normalized.capturedAt=source.capturedAt ? new Date(source.capturedAt).toISOString() : '';
  return normalized;
}

// Append against the authoritative snapshot; capture never edits existing rows.
function appendCapture(library, request) {
  if (!request || typeof request.tableId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(request.tableId) ||
      !Array.isArray(request.candidates) || request.candidates.length > 50000 ||
      request.candidates.some(s => typeof s !== 'string' || s.length > 20000) ||
      (request.createName !== undefined && (typeof request.createName !== 'string' || !request.createName.trim() || request.createName.length > 200))) {
    throw Error('수집 대상 표와 원문 형식을 확인하세요.');
  }
  const source=request.source===undefined ? null : normalizeSource(request.source);
  const next = structuredClone(library);
  let table = next.tables.find(t => t.id === request.tableId);
  const created = !table;
  if (!table) {
    if (!request.createName) throw Error('없는 표입니다. 새 표 이름을 지정하세요.');
    table = {schemaVersion:1,revision:1,id:request.tableId,name:TextPatch.uniqueTableName(request.createName,next.tables),description:'',
      defaults:{matchMode:'exact',caseSensitive:false,translatePlaceholders:true},excludedTerms:[],excludedCategories:[],entries:[]};
    next.tables.push(table);
  }
  let sourceChanged=false;
  if(source){
    if(table.captureSources!==undefined && !Array.isArray(table.captureSources))throw Error('저장된 수집 출처 형식을 확인하세요.');
    const sources=table.captureSources||[],index=sources.findIndex(s=>s.url===source.url);
    if(index<0){
      if(sources.length>=50)throw Error('수집 출처는 표마다 50개까지 저장할 수 있습니다.');
      sources.push(source);sourceChanged=true;
    }else{
      const merged={...sources[index]};
      for(const [key,value] of Object.entries(source))if(value)merged[key]=value;
      sourceChanged=JSON.stringify(merged)!==JSON.stringify(sources[index]);sources[index]=merged;
    }
    table.captureSources=sources;
  }
  const sensitive = new Set(), folded = new Set(), ids = new Set(table.entries.map(e => e.id));
  for (const entry of table.entries) {
    const text = CrimsonShared.normalize(entry.en), exactCase = entry.caseSensitive ?? table.defaults.caseSensitive;
    (exactCase ? sensitive : folded).add(exactCase ? text : text.toLowerCase());
  }
  let added = 0;
  for (const candidate of request.candidates) {
    const text = CrimsonShared.normalize(candidate), key = table.defaults.caseSensitive ? text : text.toLowerCase();
    if (!text || sensitive.has(text) || folded.has(text.toLowerCase())) continue;
    let a=2166136261,b=5381;
    for (const char of table.id+'\0'+key) {a=Math.imul(a^char.codePointAt(0),16777619);b=Math.imul(b,33)^char.codePointAt(0);}
    const prefix='capture-'+(a>>>0).toString(16)+'-'+(b>>>0).toString(16);
    let id=prefix,suffix=0;while(ids.has(id))id=prefix+'-'+(++suffix);
    ids.add(id);
    table.entries.push({id,en:text,ko:'',kind:'general',category:'일반',context:'global',selector:'',status:'untranslated',source:'',evidence:'',notes:''});
    (table.defaults.caseSensitive ? sensitive : folded).add(key);
    added++;
  }
  if ((added || sourceChanged) && !created) table.revision++;
  const changed=created || added>0 || sourceChanged;
  if (changed) {next.revision++;next.updatedAt=new Date().toISOString();}
  TextPatch.validateLibrary(next);
  return {library:changed ? next : library,tableId:table.id,added,total:table.entries.length,changed};
}

root.LibraryCollection={appendCapture};
})(globalThis);
