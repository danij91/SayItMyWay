(() => {
  if (globalThis.__textPatchContent) return;
  globalThis.__textPatchContent = true;
  const translator = new CrimsonTranslator(document);
  translator.setEnabled(false);
  let error='', generation=0, state={}, lastURL=location.href;
  let applying=false;
  const syncEnabled=()=>{
    if(!applying){
      translator.setEnabled(!error && state.enabled===true && !!state.table);
      translator.setSuspended?.(!!error || !!pageTools?.peeking);
    }
  };
  const pageTools=globalThis.TextPatchPageTools ? new TextPatchPageTools({document,translator,
    sendMessage:message=>chrome.runtime.sendMessage(message),onPeekChange:syncEnabled,onSaved:()=>reload()}) : null;
  // Content observes only while opted in; background owns durable saves.
  const capture={documentId:Date.now()+'-'+Math.random(),url:location.href,active:false,
    reason:'아직 시작하지 않음',candidates:new Set(),size:0,scans:0,limit:20,dirty:false,timer:null,navigated:false,sessionId:null,sent:new Set()};
  const captureObserver=new MutationObserver(()=>{
    capture.dirty=true;
    if(capture.timer===null)capture.timer=setTimeout(()=>{capture.timer=null;collectCapture();},1000);
  });
  function stopCapture(reason){
    captureObserver.disconnect();clearTimeout(capture.timer);capture.timer=null;
    capture.active=false;capture.reason=reason;
  }
  function publishCapture(){
    if(!capture.sessionId)return;
    const candidates=[...capture.candidates].filter(text=>!capture.sent.has(text));
    if(!candidates.length && capture.active)return;
    const sessionId=capture.sessionId;
    chrome.runtime.sendMessage({type:'collectionUpdate',sessionId,documentId:capture.documentId,
      url:capture.url,candidates,active:capture.active,reason:capture.reason}).then(result=>{
      if(capture.sessionId!==sessionId)return;
      if(result?.error){stopCapture(result.error);capture.sessionId=null;return;}
      for(const text of candidates)capture.sent.add(text);
    }).catch(()=>{/* Keep originals for the next dirty scan or explicit retry. */});
  }
  function collectCapture(){
    if(location.href!==capture.url)captureNavigation();
    if(capture.navigated)return;
    capture.dirty=false;capture.scans++;
    for(const text of translator.collectCandidates()){
      if(capture.candidates.has(text) || text.length>20000)continue;
      if(capture.candidates.size>=5000){stopCapture('후보 5,000개 제한에 도달했습니다.');break;}
      const size=JSON.stringify(text).length;
      if(capture.size+size>500000){stopCapture('원문 용량 제한으로 수집을 중지했습니다.');break;}
      capture.size+=size;capture.candidates.add(text);
    }
    if(capture.scans>=capture.limit)stopCapture('DOM 스캔 20회 제한: 검토 후 다시 시작할 수 있습니다.');
    publishCapture();
  }
  function captureReport(){
    if(location.href!==capture.url)captureNavigation();
    return {documentId:capture.documentId,url:capture.url,active:capture.active,reason:capture.reason,
      currentURL:location.href,newPage:capture.navigated,title:document.title,language:document.documentElement.lang || '',
      candidates:[...capture.candidates],log:translator.getReplacementLog(),scans:capture.scans,limit:capture.limit};
  }
  function captureNavigation(){
    capture.navigated=true;stopCapture('페이지 이동: 팝업에서 새 수집을 여세요.');publishCapture();capture.sessionId=null;
  }
  function report() {
    return {version:chrome.runtime.getManifest().version,...translator.diagnostics(),error,
      rule:state.rule || null,tableId:state.table?.id || null,tableName:state.table?.name || null,
      peeking:pageTools?.peeking===true,
      missingPermission:state.missingPermission===true,offline:state.offline===true,url:location.href};
  }
  function apply(next) {
    try {
      if(next?.error)throw Error(next.error);
      // A cache append of rows with empty replacements cannot change DOM translation.
      const effective=value=>({enabled:value?.enabled,matchMode:value?.rule?.matchMode,caseSensitive:value?.rule?.caseSensitive,
        currency:value?.currency,currencySnapshot:value?.currencySnapshot?.rates,interactionSettings:value?.interactionSettings,interactionUI:value?.interactionUI,
        missingPermission:value?.missingPermission,
        table:value?.table?{...value.table,revision:undefined,entries:value.table.entries.filter(e=>e.ko)}:null});
      if(!error && translator.diagnostics().enabled===(next?.enabled===true && !!next?.table && !pageTools?.peeking) &&
        JSON.stringify(effective(next))===JSON.stringify(effective(state))){state=next || {};return report();}
      applying=true;
      translator.setSuspended?.(true);
      // Disable first so replacing a table never briefly reapplies the previous table.
      translator.setEnabled(false);
      state=next || {};
      translator.setCurrency?.(state.currency || {enabled:false},state.currencySnapshot);
      pageTools?.release();
      if(state.table) translator.setData(state.table,{
        siteOptions:state.rule,
        excludedTerms:state.table.excludedTerms || [],
        excludedCategories:state.table.excludedCategories || []
      });
      pageTools?.configure(state);
      translator.setEnabled(state.enabled===true && !!state.table);
      translator.setSuspended?.(!!pageTools?.peeking);
      error='';
    } catch(e) {translator.setSuspended?.(true);translator.setEnabled(false);error=e.message;pageTools?.release();}
    finally{applying=false;}
    return report();
  }
  function reload() {
    const current=++generation;
    chrome.runtime.sendMessage({type:'pageState',url:location.href}).then(next=>{
      if(current===generation)apply(next);
    }).catch(e=>{if(current===generation){error=e.message;pageTools?.release();translator.setSuspended?.(true);translator.setEnabled(false);}});
  }
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(sender.id!==chrome.runtime.id)return;
    if(message.type==='applyState'){generation++;reply(apply(message.state));}
    if(message.type==='diagnostics')reply(report());
    if(message.type==='restoreOriginal'){generation++;state={...state,enabled:false,currency:{...state.currency,enabled:false}};translator.setCurrency?.({enabled:false});pageTools?.release();pageTools?.configure(state);translator.setEnabled(false);reply(report());}
    if(message.type==='captureStatus')reply({documentId:capture.documentId,sessionId:capture.sessionId,
      url:capture.url,newPage:capture.navigated || location.href!==capture.url,
      active:capture.active && !capture.navigated && location.href===capture.url});
    if(message.type==='captureRead'){
      if(message.fresh || (message.resetForPage && (capture.navigated || location.href!==capture.url))){
        stopCapture('새 페이지 수집');capture.url=location.href;capture.navigated=false;
        capture.sessionId=null;capture.sent.clear();capture.candidates.clear();capture.size=0;capture.scans=0;
        if(message.resetForPage)capture.documentId=Date.now()+'-'+Math.random();
      }
      if(!capture.scans){
        capture.reason='첫 수집 완료';collectCapture();
      }
      reply(captureReport());
    }
    if(message.type==='captureStart'){
      if(location.href===capture.url && !capture.navigated){
        if(!capture.active){
          capture.sessionId=message.sessionId || null;capture.sent=new Set(capture.candidates);
          capture.scans=0;capture.active=true;capture.reason='동적 수집 중';collectCapture();
          if(capture.active)captureObserver.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true});
        }
      }
      reply(captureReport());
    }
    if(message.type==='captureStop'){
      if(message.sessionId && capture.sessionId!==message.sessionId){reply(captureReport());return;}
      if(capture.active && capture.dirty)collectCapture();
      stopCapture(capture.navigated ? '페이지 이동: 팝업에서 새 수집을 여세요.' : '사용자가 중지함');reply(captureReport());
    }
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='local' && ['libraryRevision','rules','enabled','originEnabled','currencyPreferences','currencyRateCache','interactionSettings','locale','uiLocale'].some(k=>k in changes))reload();
  });
  // Isolated-world history wrappers cannot reliably observe page-world pushState.
  // A lightweight URL check also handles routers that emit no navigation events.
  const navigationTimer=setInterval(()=>{
    if(location.href!==lastURL){
      if(location.href!==capture.url)captureNavigation();
      lastURL=location.href;pageTools?.release();pageTools?.closeEditor();translator.setSuspended?.(true);translator.setEnabled(false);reload();
    }
  },250);
  addEventListener('popstate',()=>{
    if(location.href!==capture.url)captureNavigation();
    lastURL=location.href;pageTools?.release();pageTools?.closeEditor();translator.setSuspended?.(true);translator.setEnabled(false);reload();
  });
  addEventListener('pagehide',()=>{stopCapture('페이지를 떠남');publishCapture();capture.sessionId=null;});
  addEventListener('pagehide',event=>{pageTools?.release();if(!event.persisted){clearInterval(navigationTimer);pageTools?.destroy();}});
  addEventListener('pageshow',event=>{if(event.persisted)reload();});
  reload();
})();
