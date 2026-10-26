(function(root){
  const defaults={peekMode:'hold',editMode:'hold',peekKey:'ShiftLeft',editKey:'AltLeft'};
  const editing='input,textarea,select,option,[data-crimson-ignore]';
  const strings={inline_title:'Edit page text',inline_original:'Original',inline_replacement:'Replacement',inline_table:'Table',
    inline_delete:'Delete entry',inline_delete_confirm:'Delete',inline_delete_cancel:'Keep entry',inline_delete_help:'Delete this entry from the table? The page will show its original text.',inline_save:'Save',inline_cancel:'Cancel',inline_saved:'Saved',inline_loading:'Loading…',inline_no_table:'Choose a linked table in the popup first.',
    inline_conflict:'The linked table changed. Your draft is retained; reopen the editor to use the new table.',inline_error:'Unable to save or load this text.',
    inline_ambiguous:'Multiple matching entries: edit this text in the table editor.',inline_edit_hint:'Select text to edit',peek_active:'Showing original text',inline_reload:'Reload table'};
  class PageTools {
    constructor({document,translator,sendMessage,onPeekChange=()=>{},onSaved=()=>{}}){
      this.document=document;this.window=document.defaultView;this.translator=translator;
      this.sendMessage=sendMessage;this.onPeekChange=onPeekChange;this.onSaved=onSaved;
      this.shortcuts=root.TextPatchInteraction;this.settings=this.shortcuts.validate(defaults);this.peeking=false;this.editHeld=false;this.composing=false;
      this.listeners=[];
      for(const type of ['keydown','keyup','compositionstart','compositionend','focusin','pointermove','pointerdown','pointercancel','click'])this.listen(document,type);
      for(const type of ['blur','pagehide','popstate','hashchange'])this.listen(this.window,type);
      this.listen(document,'visibilitychange');
    }
    listen(target,type){target.addEventListener(type,this,true);this.listeners.push([target,type]);}
    protected(event){
      if(this.document.designMode?.toLowerCase()==='on')return true;
      const path=event.composedPath?.() || [event.target];
      for(let element of path){
        if(element?.nodeType===3)element=element.parentElement;
        if(!element?.closest)continue;
        if(element.closest(editing))return true;
        for(let e=element;e;e=e.parentElement){
          const value=e.getAttribute('contenteditable');
          if(value!==null && ['', 'true','plaintext-only'].includes(value.toLowerCase()))return true;
          if((e.getAttribute('role')||'').toLowerCase().split(/\s+/).some(r=>r==='textbox'||r==='searchbox'))return true;
          if(e.isContentEditable)return true;
        }
      }
      return false;
    }
    configure(state={}){
      let settings;
      try{settings=this.shortcuts.validate({...defaults,...state.interactionSettings});}
      catch{settings={peekMode:'hold',editMode:'hold',peekKey:null,editKey:null,peekEnabled:false,editEnabled:false};}
      if(JSON.stringify(settings)!==JSON.stringify(this.settings))this.release();
      this.settings=settings;this.ui=state.interactionUI||{};
      this.linkedTableId=state.table?.id||null;
      if(this.editor){
        this.localizeEditor();
        if(this.editor.loadedTable && this.editor.loadedTable!==state.table?.id){
          this.editor.token=null;this.editor.save.disabled=true;this.editor.remove.disabled=true;this.editor.confirmation.hidden=true;this.status('inline_conflict');
        }
      }
      this.available=/^https?:$/.test(this.window.location.protocol) && !state.missingPermission;
      this.canPeek=this.available && ((state.enabled===true && !!state.table) || state.currency?.enabled===true);
      if(!this.canPeek)this.setPeek(false);
      if(!this.available){this.release();this.closeEditor();}
    }
    setPeek(value){if(this.peeking===value)return;this.peeking=value;this.onPeekChange(value);}
    releaseEdit(){this.editHeld=false;this.armed=null;this.clearHighlight();}
    release(){this.setPeek(false);this.releaseEdit();this.composing=false;}
    clearHighlight(){this.highlight?.remove();this.highlight=null;}
    handleEvent(event){
      const {type}=event;
      if(['blur','pagehide','popstate','hashchange'].includes(type)){
        this.release();if(type!=='blur')this.closeEditor();return;
      }
      if(type==='visibilitychange'){if(this.document.hidden)this.release();return;}
      if(type==='compositionstart'){this.release();this.composing=true;return;}
      if(type==='compositionend'){this.composing=false;return;}
      if(type==='focusin'){if(this.protected(event))this.release();return;}
      if(type==='keyup'){
        if(event.isTrusted===false)return;
        if(this.shortcuts.releases(event,this.settings.peekKey) && this.settings.peekMode==='hold')this.setPeek(false);
        if(this.shortcuts.releases(event,this.settings.editKey) && this.settings.editMode==='hold'){if(this.editHeld)event.preventDefault();this.editHeld=false;this.clearHighlight();}
        return;
      }
      if(type==='keydown'){
        if(event.isTrusted===false)return;
        if(event.isComposing||this.composing||event.keyCode===229)return;
        if(event.code==='Escape'){
          const active=this.peeking||this.editHeld||!!this.editor;
          this.release();this.closeEditor();if(active)event.preventDefault();return;
        }
        if(event.getModifierState?.('AltGraph')||(event.ctrlKey&&event.altKey)){this.release();return;}
        if(!this.available||this.editor||event.repeat||this.protected(event))return;
        try{this.shortcuts.fromEvent(event);}catch{this.release();return;}
        if(this.settings.peekEnabled && this.shortcuts.matches(event,this.settings.peekKey) && this.canPeek){
          this.setPeek(this.settings.peekMode==='toggle'?!this.peeking:true);event.preventDefault();
        }else if(this.settings.editEnabled && this.shortcuts.matches(event,this.settings.editKey)){
          if(this.settings.editMode==='toggle' && this.editHeld)this.releaseEdit();
          else this.editHeld=true;
          event.preventDefault();
        }
        return;
      }
      if(type==='pointercancel'){this.armed=null;return;}
      if(!this.available||this.editor||event.isTrusted===false)return;
      if(type==='pointermove' && this.editHeld){this.showHighlight(this.hit(event));return;}
      if(type==='pointerdown'){
        this.armed=null;
        if(this.editHeld && event.button===0){const hit=this.hit(event);if(hit){this.armed=hit;this.consume(event);}}
        return;
      }
      if(type==='click' && event.button===0 && (this.editHeld||this.armed)){
        const hit=this.hit(event),armed=this.armed;this.armed=null;
        if(hit && (!armed || hit.node===armed.node)){
          this.consume(event);this.editHeld=false;this.clearHighlight();this.openEditor(hit);
        }
      }
    }
    consume(event){event.preventDefault();event.stopImmediatePropagation();}
    hit(event){
      if(this.protected(event))return null;
      try{
        const position=this.document.caretPositionFromPoint?.(event.clientX,event.clientY);
        const node=position?.offsetNode || this.document.caretRangeFromPoint?.(event.clientX,event.clientY)?.startContainer;
        if(node?.nodeType!==3 || !node.isConnected || !event.target?.contains?.(node))return null;
        const text=this.translator.inspectText?.(node);if(!text)return null;
        const range=this.document.createRange();range.selectNodeContents(node);
        const rects=Array.from(range.getClientRects());
        if(!rects.some(r=>r.width>0&&r.height>0&&event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom))return null;
        return {node,...text,rects};
      }catch{return null;}
    }
    showHighlight(hit){
      this.clearHighlight();if(!hit)return;
      const host=this.document.createElement('div');host.setAttribute('data-crimson-ignore','');
      host.style.cssText='all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;';
      const shadow=host.attachShadow({mode:'open'});
      for(const r of hit.rects){
        const box=this.document.createElement('div');
        box.style.cssText=`position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;background:#f59e0b33;outline:2px solid #b45309;pointer-events:none;`;
        shadow.append(box);
      }
      this.document.documentElement.append(host);this.highlight=host;
    }
    t(key){return this.ui?.strings?.[key] || strings[key] || strings.inline_error;}
    localizeEditor(){
      const e=this.editor;if(!e)return;
      e.panel.dir=this.ui.dir==='rtl'?'rtl':'ltr';e.panel.lang=this.ui.locale||'en';
      for(const element of e.shadow.querySelectorAll('[data-i18n]'))element.textContent=this.t(element.dataset.i18n);
      if(e.statusKey)e.status.textContent=this.t(e.statusKey);
    }
    status(key){const e=this.editor;if(e){e.statusKey=key;e.status.textContent=this.t(key);e.refresh.hidden=!['inline_error','inline_no_table','inline_conflict','inline_ambiguous'].includes(key);}}
    apiError(error){const e=this.editor;if(e){e.statusKey=null;e.refresh.hidden=false;e.status.textContent=typeof error==='string'&&error.trim()?error.slice(0,2000):this.t('inline_error');}}
    openEditor(hit){
      this.closeEditor();this.setPeek(false);this.releaseEdit();
      const doc=this.document,host=doc.createElement('div');
      host.id='textpatch-inline-editor';host.setAttribute('data-crimson-ignore','');
      host.style.cssText='all:initial!important;position:fixed!important;inset:0!important;display:block!important;z-index:2147483647!important;pointer-events:auto!important;';
      const shadow=host.attachShadow({mode:'open'}),style=doc.createElement('style');
      style.textContent=':host{color-scheme:light}*{box-sizing:border-box}.backdrop{position:fixed;inset:0;background:#0005;display:flex;align-items:center;justify-content:center;padding:16px;font:14px/1.5 system-ui,sans-serif;color:#172033}.panel{width:440px;max-width:100%;max-height:90vh;overflow:auto;background:#fff;border:1px solid #ccd2dc;border-radius:12px;padding:20px;box-shadow:0 12px 40px #0005}h2{margin:0 0 16px;font-size:19px}label{display:block;margin:10px 0}label span{display:block;margin-bottom:4px}textarea,button{font:inherit}textarea{width:100%;border:1px solid #8794a8;border-radius:5px;padding:8px;background:#fff;color:#172033}textarea{resize:vertical;min-height:76px}button{padding:7px 14px;border-radius:5px;border:1px solid #8794a8;cursor:pointer;background:#f3f5f8;color:#172033}button[type=submit]{background:#9d2424;color:white}button:disabled{opacity:.55;cursor:default}.delete-confirmation{margin-top:12px;padding:10px;border:1px solid #b45309;border-radius:5px}.delete-confirmation p{margin:0 0 8px}.actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:12px}[role=status]{min-height:1.5em;overflow-wrap:anywhere}';
      shadow.append(style);
      const make=(tag,parent,key)=>{const el=doc.createElement(tag);if(key){el.dataset.i18n=key;el.textContent=this.t(key);}parent.append(el);return el;};
      const backdrop=make('div',shadow);backdrop.className='backdrop';
      const panel=make('section',backdrop);panel.className='panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','inline-title');
      const tableLine=make('div',panel);make('span',tableLine,'inline_table');
      const table=make('strong',tableLine);table.dataset.tableName='';table.dir='auto';
      tableLine.style.cssText='display:flex;gap:8px;flex-wrap:wrap;overflow-wrap:anywhere;margin-bottom:8px';
      make('h2',panel,'inline_title').id='inline-title';const form=make('form',panel);
      const field=(tag,key,name)=>{const label=make('label',form);make('span',label,key);const el=make(tag,label);el.name=name;return el;};
      const original=field('textarea','inline_original','original');original.readOnly=true;original.value=hit.original;original.dir='auto';
      const replacement=field('textarea','inline_replacement','replacement');replacement.dir='auto';replacement.maxLength=20000;
      const status=make('div',form);status.setAttribute('role','status');status.setAttribute('aria-live','polite');
      const actions=make('div',form);actions.className='actions';
      const remove=make('button',actions,'inline_delete');remove.type='button';remove.name='delete';remove.hidden=true;
      const cancel=make('button',actions,'inline_cancel');cancel.type='button';
      const refresh=make('button',actions,'inline_reload');refresh.type='button';refresh.name='reload';refresh.hidden=true;
      const save=make('button',actions,'inline_save');save.type='submit';
      const confirmation=make('div',form);confirmation.className='delete-confirmation';confirmation.dataset.deleteConfirmation='';confirmation.hidden=true;
      make('p',confirmation,'inline_delete_help');
      const confirm=make('button',confirmation,'inline_delete_confirm');confirm.type='button';confirm.name='delete-confirm';
      const keep=make('button',confirmation,'inline_delete_cancel');keep.type='button';keep.name='delete-cancel';
      this.editor={remove,confirmation,confirm,keep,host,shadow,panel,form,original:hit.original,table,replacement,status,save,refresh,request:0,url:this.window.location.href,focus:doc.activeElement};
      remove.addEventListener('click',()=>{const e=this.editor;if(e && !e.saving && e.token && e.existingEntry){confirmation.hidden=false;save.disabled=true;}});
      keep.addEventListener('click',()=>{const e=this.editor;if(e && !e.saving){confirmation.hidden=true;save.disabled=!e.token;}});
      confirm.addEventListener('click',()=>this.saveEditor(true));
      cancel.addEventListener('click',()=>this.closeEditor());
      refresh.addEventListener('click',()=>this.loadContext());
      form.addEventListener('submit',event=>{event.preventDefault();this.saveEditor();});
      panel.addEventListener('keydown',event=>{
        if(event.key!=='Tab')return;
        const focusable=Array.from(panel.querySelectorAll('textarea,button')).filter(el=>!el.disabled&&!el.closest('[hidden]'));
        const first=focusable[0],last=focusable.at(-1),active=shadow.activeElement;
        if(event.shiftKey && active===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey && active===last){event.preventDefault();first.focus();}
      });
      panel.tabIndex=-1;
      doc.documentElement.append(host);this.localizeEditor();panel.focus();this.loadContext();
    }
    async loadContext(){
      const e=this.editor;if(!e || e.saving)return;
      const draft=e.loadedTable?e.replacement.value:null;
      const request=++e.request;e.remove.disabled=true;e.confirmation.hidden=true;e.save.disabled=true;e.replacement.disabled=true;e.token=null;this.status('inline_loading');
      try{
        const result=await this.sendMessage({type:'inlineContext',url:e.url,original:e.original,...(e.loadedTable?{tableId:e.loadedTable}:{})});
        if(this.editor!==e || request!==e.request)return;
        if(e.loadedTable && result?.table?.id!==e.loadedTable){this.status('inline_conflict');return;}
        if(result?.table && !e.loadedTable){
          e.loadedTable=result.table.id;e.table.textContent=result.table.name;
        }
        if(result?.error){this.apiError(result.error);return;}
        if(!result?.table || result.tableId!==result.table.id){this.status('inline_no_table');return;}
        if(result.tableId!==this.linkedTableId){this.status('inline_conflict');return;}
        if(!result.token){this.status('inline_error');return;}
        e.table.textContent=result.table.name;e.token=result.token;
        e.confirm.disabled=false;e.keep.disabled=false;e.existingEntry=!!result.entry?.id;e.remove.hidden=!e.existingEntry;e.remove.disabled=!e.existingEntry;
        e.replacement.value=draft!==null?draft:(result.entry?.replacement||'');
        e.replacement.disabled=false;e.save.disabled=false;e.refresh.hidden=true;e.status.textContent='';e.statusKey=null;
      }catch{if(this.editor===e && request===e.request)this.status('inline_error');}
      finally{if(this.editor===e && request===e.request && e.loadedTable)e.replacement.disabled=false;}
    }
    async saveEditor(deleting=false){
      const e=this.editor;if(!e || e.saving || !e.token || (deleting?(!e.existingEntry || e.confirmation.hidden || e.remove.disabled):e.save.disabled))return;
      e.saving=true;e.save.disabled=true;e.remove.disabled=true;e.confirm.disabled=true;e.keep.disabled=true;e.replacement.disabled=true;
      try{
        const result=await this.sendMessage({type:deleting?'inlineDelete':'inlineSave',url:e.url,tableId:e.loadedTable,original:e.original,...(!deleting?{replacement:e.replacement.value}:{}),token:e.token});
        if(this.editor!==e)return;
        if(deleting?result?.deleted:result?.saved){
          this.closeEditor();this.onSaved();
          return;
        }
        e.token=null;this.apiError(result?.error);
      }catch{if(this.editor===e){e.token=null;this.status('inline_error');}}
      finally{if(this.editor===e){e.saving=false;e.replacement.disabled=false;e.save.disabled=!e.token || !e.confirmation.hidden;e.remove.disabled=!e.token;e.confirm.disabled=!e.token;e.keep.disabled=false;}}
    }
    closeEditor(){
      const e=this.editor;if(!e)return;
      this.editor=null;e.host.remove();if(e.focus?.isConnected)e.focus.focus({preventScroll:true});
    }
    destroy(){this.release();this.closeEditor();for(const [target,type] of this.listeners)target.removeEventListener(type,this,true);this.listeners=[];}
  }
  root.TextPatchPageTools=PageTools;
})(globalThis);
