(function(root) {
  function validate(value) {
    const library=structuredClone(value);
    if(Array.isArray(library?.tables))for(const table of library.tables){
      if(table && (table.defaults==null || (typeof table.defaults==='object' && !Array.isArray(table.defaults))))
        table.defaults={matchMode:'exact',caseSensitive:false,translatePlaceholders:true,...table.defaults};
    }
    TextPatch.validateLibrary(library);
    return library;
  }
  function mergeMigration(cache,bundle) {
    const sources=[['cache',cache],['bundle',bundle]].filter(([,v])=>v!=null).map(([name,v])=>[name,validate(v)]);
    if(!sources.length)throw Error('이전할 대응표가 없습니다.');
    sources.sort((a,b)=>b[1].revision-a[1].revision);
    const [primaryName,primary]=sources[0],next=structuredClone(primary);
    for(const [name,library] of sources.slice(1)){
      for(const table of library.tables){
        const previous=next.tables.find(t=>t.id===table.id);
        if(!previous){next.tables.push(structuredClone(table));continue;}
        if(JSON.stringify(previous)===JSON.stringify(table))continue;
        const copy=structuredClone(table),base=table.id.slice(0,75)+'-migration-'+name;
        let id=base,n=2;while(next.tables.some(t=>t.id===id))id=base+'-'+n++;
        copy.id=id;copy.name=TextPatch.uniqueTableName(table.name+' (이전 보존)',next.tables);
        copy.migrationConflict={originalId:table.id,source:name,preferredSource:primaryName};next.tables.push(copy);
      }
      // Retain even library-level metadata from the non-preferred snapshot.
      const {tables,...metadata}=library;
      next.migrationSources=[...(next.migrationSources||[]),{source:name,metadata}];
    }
    return validate(next);
  }
  async function bundled(fetcher,getURL) {
    let response;
    try{response=await fetcher(getURL('data/library.json'));}
    catch(error){
      // Chromium reports an absent optional packaged file as Failed to fetch,
      // rather than HTTP 404. Only this root file is optional; referenced table
      // failures and parse/validation errors must abort initialization.
      if(error.name==='TypeError' && /Failed to fetch/.test(error.message))return null;
      throw error;
    }
    if(response.status===404)return null;
    if(!response.ok)throw Error('기본 대응표 읽기 실패: '+response.status);
    const stored=await response.json();
    if(stored.storageVersion!==1)return validate(stored);
    const {storageVersion,tableFiles,...metadata}=stored;
    if(!Array.isArray(tableFiles) || tableFiles.some(file=>typeof file!=='string' || !/^tables\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.json$/.test(file)))throw Error('잘못된 저장 파일 경로입니다.');
    const tables=[];
    for(const file of tableFiles){
      const table=await fetcher(getURL('data/'+file));
      if(!table.ok)throw Error('이전할 대응표 파일 읽기 실패: '+file);
      tables.push(await table.json());
    }
    return validate({...metadata,tables});
  }
  function create({indexedDB=root.indexedDB,name='text-patch-library'}={}) {
    let opening;
    function open(){
      if(!opening)opening=new Promise((resolve,reject)=>{
        const request=indexedDB.open(name,1);
        request.onupgradeneeded=()=>request.result.createObjectStore('state');
        request.onerror=()=>{opening=null;reject(request.error);};
        request.onblocked=()=>{opening=null;reject(Error('대응표 저장소를 열 수 없습니다. 다른 확장 화면을 닫고 재시도하세요.'));};
        request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();opening=null;};resolve(db);};
      });
      return opening;
    }
    async function transaction(mode,work){
      const db=await open();
      return new Promise((resolve,reject)=>{
        const tx=db.transaction('state',mode),store=tx.objectStore('state');let result,error;
        tx.oncomplete=()=>resolve(result);
        tx.onabort=()=>reject(error || tx.error || Error('대응표 저장이 취소되었습니다.'));
        tx.onerror=()=>{};
        const request=store.get('library');
        request.onsuccess=()=>{
          const history=store.get('ai-row-history');
          history.onsuccess=()=>{try{
            result=work(request.result,store,history.result||{});
            if(result?.then)result.catch(e=>{error=e;tx.abort();});
          }catch(e){error=e;tx.abort();}};
        };
      });
    }
    const get=()=>transaction('readonly',current=>{if(!current)throw Error('대응표 저장소가 초기화되지 않았습니다.');return validate(current);});
    async function initialize(load){
      const current=await transaction('readonly',v=>v);
      if(current)return validate(current);
      const seed=validate(await load());
      return transaction('readwrite',(existing,store)=>{if(existing)return validate(existing);store.put(seed,'library');return seed;});
    }
    const save=async value=>{
      const next=validate(value);
      return transaction('readwrite',(current,store,history)=>{
        if(!current || current.revision!==next.revision)throw Error('저장 충돌: 다른 창이나 수집에서 변경되었습니다. 초안을 보존하고 다시 불러오세요.');
        next.revision=current.revision+1;next.updatedAt=new Date().toISOString();
        for(const table of next.tables){const old=current.tables.find(t=>t.id===table.id);table.revision=old?old.revision+(JSON.stringify({...table,revision:old.revision})!==JSON.stringify(old)?1:0):1;}
        validate(next);trackRows(current,next,store,history);store.put(next,'library');return next;
      });
    };
    const capture=request=>transaction('readwrite',(current,store,history)=>new Promise((resolve,reject)=>{
      if(!current)throw Error('대응표 저장소가 초기화되지 않았습니다.');
      const append=receipt=>{
        try{
          if(!request.createName && !current.tables.some(t=>t.id===request.tableId))throw Error('수집한 표가 삭제되었습니다.');
          if(receipt){
            const table=current.tables.find(t=>t.id===request.tableId);
            if(!table)throw Error('수집한 표가 삭제되었습니다.');
            resolve({...receipt,library:validate(current),total:table.entries.length,changed:false});return;
          }
          const result=LibraryCollection.appendCapture(validate(current),request);
          if(result.changed){trackRows(current,result.library,store,history);store.put(result.library,'library');}
          if(request.operationId)store.put({tableId:result.tableId,added:result.added},'capture:'+request.operationId);
          resolve(result);
        }catch(error){reject(error);}
      };
      if(request.operationId){const receipt=store.get('capture:'+request.operationId);receipt.onsuccess=()=>append(receipt.result);receipt.onerror=()=>reject(receipt.error);}
      else append();
    }));
    const rowKey=(tableId,rowId)=>JSON.stringify([tableId,rowId]);
    function trackRows(current,next,store,history){
      const rows=new Map(next.tables.map(table=>[table.id,new Map(table.entries.map(row=>[row.id,row]))]));
      for(const table of current.tables)for(const row of table.entries){
        const after=rows.get(table.id)?.get(row.id);
        if(JSON.stringify(CrimsonShared.activeRow(row))!==JSON.stringify(CrimsonShared.activeRow(after))){
          const key=rowKey(table.id,row.id);history[key]=(history[key]||0)+1;
        }
      }
      store.put(history,'ai-row-history');
    }
    const recordAIRequest=table=>transaction('readwrite',(current,store,history)=>{
      const trusted=current?.tables.find(t=>t.id===table?.id);
      if(!trusted || JSON.stringify(trusted)!==JSON.stringify(table))throw Error(TextPatchI18n.t('ai_save_first'));
      const id=root.crypto.randomUUID(),record={id,table:structuredClone(trusted),rowVersions:trusted.entries.map(row=>history[rowKey(trusted.id,row.id)]||0)};
      store.put(record,'ai-request:'+id);return record;
    });
    const aiResult=(text,apply=false)=>{
      TableImport.isAIResult(text);
      const input=JSON.parse(text),id=input?.aiRequest?.id;
      if(typeof id!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw Error(TextPatchI18n.t('ai_result_invalid'));
      return transaction(apply?'readwrite':'readonly',(current,store,history)=>new Promise((resolve,reject)=>{
        const read=store.get('ai-request:'+id);
        read.onerror=()=>reject(read.error);
        read.onsuccess=()=>{try{
          const record=read.result;
          const protectedRows=record?.table.entries.map((row,i)=>(history[rowKey(record.destinationId||record.table.id,row.id)]||0)!==record.rowVersions[i]);
          const result=TableImport.aiResult(validate(current),input,record,protectedRows);
          if(apply && result.changed){
            const next=result.library;next.revision=current.revision+1;next.updatedAt=new Date().toISOString();
            const table=next.tables.find(t=>t.id===result.tableIds[0]),old=current.tables.find(t=>t.id===table.id);
            table.revision=old?old.revision+1:1;
            validate(next);trackRows(current,next,store,history);store.put(next,'library');
            store.put({...record,destinationId:table.id,...(result.created?{rowVersions:record.table.entries.map(row=>history[rowKey(table.id,row.id)]||0)}:{})},'ai-request:'+id);
          }
          resolve(result);
        }catch(error){reject(error);}};
      }));
    };
    return {get,initialize,save,capture,recordAIRequest,aiResult};
  }
  root.LibraryRepository={create,validate,mergeMigration,bundled};
})(globalThis);
