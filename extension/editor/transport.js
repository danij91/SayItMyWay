// One editor; only the development server uses HTTP transport.
globalThis.EditorStorage={
  async ai(type,payload){
    if(location.protocol!=='chrome-extension:')throw Error(TextPatchI18n.t('ai_result_extension'));
    const result=await chrome.runtime.sendMessage({type,...payload});
    if(result.error)throw Error(result.error);return result;
  },
  async request(type,library){
    if(location.protocol==='chrome-extension:'){
      const result=await chrome.runtime.sendMessage({type,...(library?{library}:{})});
      if(result.error)throw Error(result.error);
      return result.library;
    }
    const response=await fetch('/api/library',library?{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(library)}:{cache:'no-store'});
    const result=await response.json();if(!response.ok)throw Error(result.error||TextPatchI18n.t('load_failed'));return result;
  },
  load(){return this.request('libraryGet');},
  save(library){return this.request('librarySave',library);}
};
