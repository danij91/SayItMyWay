(function(root){
  const clone=value=>structuredClone(value);
  const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
  // Build fresh own properties, including JSON keys such as __proto__.
  function merge(old,incoming){
    if(!object(old) || !object(incoming))return clone(incoming);
    return Object.fromEntries([...new Set([...Object.keys(old),...Object.keys(incoming)])].map(key=>[key,Object.hasOwn(incoming,key)?(Object.hasOwn(old,key)?merge(old[key],incoming[key]):clone(incoming[key])):clone(old[key])]));
  }
  const omit=(value,keys)=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));
  const canonical=value=>Array.isArray(value)?value.map(canonical):object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
  function assign(target,value){for(const [key,item] of Object.entries(value))Object.defineProperty(target,key,{value:clone(item),writable:true,enumerable:true,configurable:true});}
  function validate(library){
    try{root.TextPatch.validateLibrary(library);}catch(error){if(error instanceof TypeError)throw Error('대응표·행·기본값의 JSON 형식을 확인하세요.');throw error;}
    for(const table of library.tables)for(const entry of table.entries)if(!/^[a-zA-Z0-9_-]{1,100}$/.test(entry.id))throw Error('행 ID는 영문·숫자·밑줄·하이픈 1~100자여야 합니다.');
    return library;
  }
  function preview(base,text,targetTableId){
    if(typeof text!=='string' || new TextEncoder().encode(text).length>5_000_000)throw Error('JSON 파일은 5MB 이하여야 합니다.');
    let input;
    try{input=JSON.parse(text);}catch{throw Error('올바른 JSON 파일이 아닙니다.');}
    const bundle=input?.kind==='text-patch-bundle';
    if(bundle){if(input.schemaVersion!==1)throw Error('지원하지 않는 묶음 버전입니다.');input=input.library;}
    if(input?.schemaVersion===1 && !Object.hasOwn(input,'id')){
      const target=base.tables.find(t=>t.id===targetTableId);
      if(!target)throw Error('표 ID가 없는 파일입니다. 가져올 대상 표를 명시적으로 선택하세요.');
      input={...clone(omit(target,['entries'])),...input};
    }
    const candidate=input?.schemaVersion===1?{schemaVersion:2,revision:1,tables:[input]}:input;
    if(Array.isArray(candidate?.tables))for(const table of candidate.tables){
      if(!object(table))throw Error('대응표의 JSON 형식을 확인하세요.');
      if(Object.hasOwn(table,'defaults') && !object(table.defaults))throw Error('표 기본값의 JSON 형식을 확인하세요.');
      const existing=base.tables.find(t=>t.id===table.id);
      if(!Object.hasOwn(table,'defaults') && existing)table.defaults=clone(existing.defaults);
    }
    const incoming=validate(candidate);
    const snapshot=clone(base),changes=[];
    function add(scope,tableId,entryId,before,after){
      changes.push({key:String(changes.length),scope,tableId,entryId,before:clone(before??null),after:clone(after),status:before===undefined?'added':equal(before,after)?'unchanged':'changed'});
    }
    const metadata=omit(incoming,['tables','revision','updatedAt','schemaVersion']);
    if(Object.keys(metadata).length){const old=omit(snapshot,['tables','revision','updatedAt','schemaVersion']);add('library',null,null,old,merge(old,metadata));}
    for(const table of incoming.tables){
      const old=snapshot.tables.find(t=>t.id===table.id),meta=omit(table,['entries','revision']);
      add('table',table.id,null,old?omit(old,['entries','revision']):undefined,old?merge(omit(old,['entries','revision']),meta):meta);
      for(const entry of table.entries){const previous=old?.entries.find(e=>e.id===entry.id);add('entry',table.id,entry.id,previous,previous?merge(previous,entry):entry);}
    }
    return {base:snapshot,incoming:clone(incoming),bundle,changes};
  }
  function apply(plan,keys){
    const selected=new Set(keys),next=clone(plan.base);
    if([...selected].some(key=>!plan.changes.some(c=>c.key===key)))throw Error('알 수 없는 변경 선택입니다.');
    for(const change of plan.changes){
      if(!selected.has(change.key) || change.status==='unchanged')continue;
      if(change.scope==='library'){assign(next,merge(next,change.after));continue;}
      let table=next.tables.find(t=>t.id===change.tableId);
      if(!table){const source=plan.incoming.tables.find(t=>t.id===change.tableId);table={...clone(omit(source,['entries'])),revision:1,entries:[]};next.tables.push(table);}
      if(change.scope==='table')assign(table,change.after);
      else{const index=table.entries.findIndex(e=>e.id===change.entryId);if(index<0)table.entries.push(clone(change.after));else table.entries[index]=clone(change.after);}
    }
    return validate(next);
  }
  function exportJSON(library,tableId){
    const value=tableId===undefined?library:library.tables.find(t=>t.id===tableId);
    if(!value)throw Error('내보낼 표를 선택하세요.');
    return JSON.stringify(value,null,2)+'\n';
  }
  function createNew(library,text,fallbackName){
    if(typeof text!=='string' || new TextEncoder().encode(text).length>5_000_000)throw Error('JSON 파일은 5MB 이하여야 합니다.');
    let input;
    try{input=JSON.parse(text);}catch{throw Error('올바른 JSON 파일이 아닙니다.');}
    if(Object.hasOwn(input||{},'aiRequest'))throw Error(root.TextPatchI18n.t('ai_result_invalid'));
    if(input?.kind==='text-patch-bundle'){
      if(input.schemaVersion!==1)throw Error('지원하지 않는 묶음 버전입니다.');
      input=input.library;
    }
    const portable=input?.format==='text-patch-table';
    if(portable && ![1,2].includes(input.version))throw Error('지원하지 않는 교환 표 버전입니다.');
    if(input?.schemaVersion===2)validate(clone(input));
    const tables=portable || input?.schemaVersion===1?[input]:input?.schemaVersion===2?input.tables:null;
    if(!Array.isArray(tables) || !tables.length)throw Error('가져올 대응표 형식을 확인하세요.');
    const next=clone(library),tableIds=[],ids=new Set(next.tables.flatMap(t=>[t.id,...t.entries.map(e=>e.id)]));
    // Reserve incoming IDs too: even an otherwise unused imported ID is never reused.
    for(const table of tables)if(object(table)){ids.add(table.id);if(Array.isArray(table.entries))for(const e of table.entries)ids.add(e?.id);}
    function fresh(){let id;do{id='import-'+(root.crypto?.randomUUID?.() || Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));}while(ids.has(id));ids.add(id);return id;}
    for(const table of tables){
      if(!object(table) || !Array.isArray(table.entries))throw Error('대응표의 JSON 형식을 확인하세요.');
      const isPortable=portable;
      const imported={...(isPortable?{}:clone(table)),schemaVersion:1,revision:1,id:fresh(),
        name:root.TextPatch.uniqueTableName(table.name??fallbackName??'가져온 대응표',next.tables),
        description:isPortable?'':table.description??'',
        defaults:clone(table.defaults??{matchMode:'exact',caseSensitive:false,translatePlaceholders:true}),
        excludedTerms:[],excludedCategories:[],
        entries:table.entries.map(entry=>{
          if(!object(entry))throw Error('행의 JSON 형식을 확인하세요.');
          const neutral=isPortable && input.version===2;
          const forbidden=neutral?['en','ko']:['original','replacement'];
          if(forbidden.some(key=>Object.hasOwn(entry,key)))throw Error('원문·대체문 필드 형식이 혼합되어 있습니다.');
          const internal=neutral?{...omit(entry,['original','replacement']),en:entry.original,ko:entry.replacement}:clone(entry);
          const value=isPortable?Object.fromEntries(['en','ko','status','kind','category','source','evidence','notes','matchMode','caseSensitive'].filter(key=>Object.hasOwn(internal,key)).map(key=>[key,internal[key]])):internal;
          return {kind:'general',category:'일반',context:'global',selector:'',status:typeof internal.ko==='string' && internal.ko.trim()?'review':'untranslated',source:'',evidence:'',notes:'',...value,id:fresh()};
        })};
      if(isPortable && table.captureSources!==undefined)imported.captureSources=clone(table.captureSources);
      next.tables.push(imported);tableIds.push(imported.id);
    }
    validate(next);
    if(new TextEncoder().encode(JSON.stringify(next)).length>5_000_000)throw Error('대응표 모음이 5MB를 넘습니다.');
    return {library:next,tableIds};
  }
  function exportPortable(library,tableId){
    const table=library.tables.find(t=>t.id===tableId);
    if(!table)throw Error('내보낼 표를 선택하세요.');
    return JSON.stringify(root.TextPatch.portableTable(table),null,2)+'\n';
  }
  function isAIResult(text){
    if(typeof text!=='string' || new TextEncoder().encode(text).length>5_000_000)throw Error('JSON 파일은 5MB 이하여야 합니다.');
    let input;try{input=JSON.parse(text);}catch{throw Error('올바른 JSON 파일이 아닙니다.');}
    return Object.hasOwn(input||{},'aiRequest');
  }
  // Returned linkage locates a trusted local record; it never supplies a baseline.
  function aiResult(library,input,record,protectedRows=[]){
    const invalid=()=>{throw Error(root.TextPatchI18n.t('ai_result_invalid'));};
    if(!record || input?.format!=='text-patch-table' || input.version!==2 || input.aiRequest?.version!==1 || input.aiRequest.id!==record.id || !Array.isArray(input.entries))invalid();
    const snapshot=record.table,next=clone(library);
    let table=next.tables.find(t=>t.id===(record.destinationId||snapshot.id)),created=false;
    if(!table){
      table=clone(snapshot);table.id=root.crypto.randomUUID();table.revision=1;
      table.name=root.TextPatch.uniqueTableName(snapshot.name,next.tables);
      next.tables.push(table);created=true;
    }
    const seen=new Set(),currentRows=new Map(table.entries.map(row=>[row.id,row]));let filled=0;
    for(const row of input.entries){
      if(!object(row) || typeof row.requestRow!=='string' || !/^(0|[1-9][0-9]*)$/.test(row.requestRow) || seen.has(row.requestRow))invalid();
      seen.add(row.requestRow);
      const before=snapshot.entries[Number(row.requestRow)];
      if(!before || row.original!==before.en || typeof row.replacement!=='string' || Object.hasOwn(row,'en') || Object.hasOwn(row,'ko'))invalid();
      // References can be echoed unchanged but cannot be rewritten.
      if(before.ko.trim()){if(row.replacement!==before.ko)invalid();continue;}
      const current=currentRows.get(before.id);
      if(!row.replacement.trim() || !current || current.ko.trim() || (!created && protectedRows[Number(row.requestRow)]) || !equal(current,before))continue;
      current.ko=row.replacement;current.status='review';filled++;
      // Only replacement/status are proposed. Existing provenance stays intact.
    }
    validate(next);
    if(new TextEncoder().encode(JSON.stringify(next)).length>5_000_000)throw Error('대응표 모음이 5MB를 넘습니다.');
    return {library:next,tableIds:[table.id],tableName:table.name,filled,preserved:snapshot.entries.length-filled,created,changed:created||filled>0};
  }
  root.TableImport={preview,apply,exportJSON,createNew,exportPortable,isAIResult,aiResult};
})(globalThis);
