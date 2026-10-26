(function (root) {
  const {validate, normalize} = root.CrimsonShared;
  const excluded = 'script,style,noscript,code,pre,[data-crimson-ignore]';
  const controls = 'input,textarea,select,option';
  function editable(element) {
    if (element.ownerDocument.designMode?.toLowerCase() === 'on') return true;
    for (let e=element; e; e=e.parentElement) {
      const value=e.getAttribute('contenteditable');
      if (value !== null && ['', 'true', 'plaintext-only'].includes(value.toLowerCase())) return true;
      if ((e.getAttribute('role') || '').toLowerCase().split(/\s+/).some(role=>role==='textbox' || role==='searchbox')) return true;
    }
    return element.isContentEditable === true;
  }
  function inputSurface(element) {
    return element && (element.closest(controls) || editable(element));
  }
  class Translator {
    constructor(document) {
      this.document = document;
      this.records = new Map();
      this.index = new Map();
      this.words = [];
      this.revision = null;
      this.enabled = true;
      this.currency = {enabled:false};
      this.suspended = false;
      this.pending = new Set();
      this.jobs = [];
      this.timer = null;
      this.pauseDepth = 0;
      this.observer = new document.defaultView.MutationObserver(mutations => this.enqueueMutations(mutations));
      this.observe();
      // Restore before the browser changes an editing surface. Once input has
      // happened, discard ownership instead: even an identical value is user text.
      for (const type of ['beforeinput','compositionstart','paste','focusin']) {
        document.addEventListener(type, event=>this.protectInput(event, true), true);
      }
      document.addEventListener('input', event=>this.protectInput(event, false), true);
      // designMode is a property with no mutation notification. Check only its
      // state here; traverse the DOM only when that state changes. Editing events
      // above cover the interval before this check and run before native edits.
      let designMode=document.designMode?.toLowerCase()==='on';
      document.defaultView.setInterval(()=>{
        const next=document.designMode?.toLowerCase()==='on';
        if (next===designMode) return;
        designMode=next;
        if (this.active()) this.pause(()=>this.scan(document.body));
      },100);
    }
    protectInput(event, restore) {
      let surface=event.target?.nodeType===3 ? event.target.parentElement : event.target;
      if (surface===this.document && this.document.designMode?.toLowerCase()==='on') surface=this.document.body;
      if (!surface?.closest || !inputSurface(surface)) return;
      while (surface.parentElement && inputSurface(surface.parentElement)) surface=surface.parentElement;
      this.pause(()=>{
        for (const [node] of this.records) {
          if (node!==surface && !surface.contains(node)) continue;
          if (restore) this.restoreNode(node);
          this.records.delete(node);
        }
      });
    }
    observe() { this.observer.observe(this.document.documentElement, {subtree:true, childList:true, characterData:true, attributes:true}); }
    enqueueMutations(mutations) {
      for (const m of mutations) {
        if (this.currency.enabled && this.currency.source==='auto') {
          const selector='meta[property="product:price:currency"],meta[property="og:price:currency"],[itemprop="priceCurrency"],script[type="application/ld+json"]';
          const target=m.target.nodeType===3?m.target.parentElement:m.target;
          const related=target?.closest?.(selector) || [...m.addedNodes || [],...m.removedNodes || []].some(n=>n.nodeType===1 && (n.matches(selector) || n.querySelector(selector))) ||
            (m.type==='attributes' && ['property','itemprop','type'].includes(m.attributeName));
          if(related)this.pending.add(this.document.body);
        }
        // Head is observed for metadata only; ordinary title/style/script churn
        // must not translate head content or trigger a whole body scan.
        if(!this.document.body.contains(m.target) && m.target!==this.document.body)continue;
        const element=m.target.nodeType===3 ? m.target.parentElement : m.target;
        if (element?.closest && inputSurface(element)) {
          // The observer is disconnected for our own writes. A changed value in
          // an editor belongs to the page/user, regardless of string equality.
          if (m.type==='characterData') this.records.delete(m.target);
          if (m.type==='attributes') this.records.get(m.target)?.delete(m.attributeName);
        }
        if (m.type === 'childList') {
          for (const n of [...m.addedNodes,...m.removedNodes]) this.pending.add(n);
        } else this.pending.add(m.target);
      }
      if (this.pending.size) this.schedule();
    }
    schedule() {
      if (this.timer !== null) return;
      this.timer = this.document.defaultView.setTimeout(()=>{this.timer=null;this.pause(()=>this.drain());},0);
    }
    pause(fn) {
      if (this.pauseDepth++ === 0) {
        this.enqueueMutations(this.observer.takeRecords());
        this.observer.disconnect();
      }
      try { return fn(); } finally { if (--this.pauseDepth === 0) this.observe(); }
    }
    cancelWork() {
      this.document.defaultView.clearTimeout(this.timer);
      this.timer=null;this.pending.clear();this.jobs=[];
    }
    setData(data, {excludedTerms = [], excludedCategories = [], siteOptions} = {}) {
      validate(data);
      const preservedTerms = new Set([...data.excludedTerms || [],...excludedTerms].map(s=>normalize(s).toLowerCase()));
      const preservedCategories = new Set([...data.excludedCategories || [],...excludedCategories]);
      this.revision = data.revision;
      this.defaults = {matchMode:'exact',caseSensitive:false,translatePlaceholders:true,...data.defaults};
      this.pause(() => {
        this.cancelWork(); this.restore(); this.index.clear(); this.words = [];
        for (const e of data.entries) {
          if (!e.ko.trim() || preservedCategories.has(e.category) || preservedTerms.has(normalize(e.en).toLowerCase())) continue;
          if (e.selector) { try { this.document.querySelector(e.selector); } catch { continue; } }
          const key = e.en.trim().toLowerCase();
          const compiled = {...e,caseSensitive:siteOptions?.caseSensitive ?? e.caseSensitive ?? this.defaults.caseSensitive};
          if ((siteOptions?.matchMode ?? e.matchMode ?? this.defaults.matchMode) === 'word') {
            const literal = e.en.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            compiled.pattern = new RegExp('(?<![\\p{L}\\p{N}\\p{M}\\p{Pc}])' + literal + '(?![\\p{L}\\p{N}\\p{M}\\p{Pc}])', compiled.caseSensitive ? 'gu' : 'giu');
            this.words.push(compiled);
          } else this.index.set(key, [...(this.index.get(key) || []), compiled]);
        }
        this.scan(this.document.body);
      });
    }
    setEnabled(enabled) { this.pause(() => { this.cancelWork(); this.restore(); this.enabled = enabled; if (this.active()) this.scan(this.document.body); }); }
    active() { return !this.suspended && (this.enabled || this.currency.enabled); }
    setCurrency(settings,snapshot=root.TextPatchCurrency?.snapshot) {
      this.currencySnapshot=snapshot;
      this.currency = root.TextPatchCurrency ? root.TextPatchCurrency.preferences(settings) : {enabled:false};
      this.render();
    }
    setSuspended(value) { this.suspended=value; this.render(); }
    render() { this.pause(()=>{this.cancelWork();this.restore();if(this.active())this.scan(this.document.body);}); }
    inspectText(node) {
      const parent=node?.nodeType===3 && node.parentElement;
      if (!node?.isConnected || !parent || parent.closest(excluded+','+controls+',[hidden],[inert],[aria-hidden="true"],[data-private],[data-crimson-private]') || editable(parent)) return null;
      const view=this.document.defaultView;
      for (let e=parent;e;e=e.parentElement) {
        const style=view.getComputedStyle(e);
        if (style.display==='none' || ['hidden','collapse'].includes(style.visibility) || style.contentVisibility==='hidden' || style.opacity==='0') return null;
      }
      if (this.document.documentElement.getClientRects().length) {
        const range=this.document.createRange();range.selectNodeContents(node);
        if (![...range.getClientRects()].some(rect=>rect.width>0 && rect.height>0)) return null;
      }
      const record=this.records.get(node)?.get('#text');
      const original=record && node.data===record.translated ? record.original : node.data;
      if (!original.trim()) return null;
      return {original,replacement:this.replace(original,parent)};
    }
    diagnostics() {
      let translated = 0;
      for (const [node, values] of this.records) {
        if (!node.isConnected) continue;
        for (const [key, record] of values) {
          const value = key === '#text' ? node.data : node.getAttribute(key);
          if (value === record.translated) translated++;
        }
      }
      return {enabled:this.enabled, revision:this.revision, eligibleEntries:this.words.length + [...this.index.values()].reduce((n, entries)=>n+entries.length,0), translated};
    }
    getReplacementLog() {
      const log=[];
      for (const [node,values] of this.records) {
        if (!node.isConnected) continue;
        for (const [attribute,record] of values) {
          const current=attribute==='#text' ? node.data : node.getAttribute(attribute);
          if (current===record.translated) log.push({original:record.original,replacement:record.translated,attribute});
        }
      }
      return log;
    }
    collectCandidates() {
      const candidates=new Set();
      const view=this.document.defaultView;
      // Layout-less DOMs still support semantic/CSS visibility checks. Browsers also
      // require a rendered text rectangle (off-screen rendered text is included).
      const hasLayout=this.document.documentElement.getClientRects().length > 0;
      const walker=this.document.createTreeWalker(this.document.body,4);
      while (walker.nextNode()) {
        const node=walker.currentNode, parent=node.parentElement;
        if (!parent || parent.closest(excluded+','+controls+',[hidden],[inert],[aria-hidden="true"],[data-private],[data-crimson-private]') || editable(parent)) continue;
        let visible=true;
        for (let e=parent;e;e=e.parentElement) {
          const style=view.getComputedStyle(e);
          if (style.display==='none' || ['hidden','collapse'].includes(style.visibility) || style.contentVisibility==='hidden' || style.opacity==='0') {visible=false;break;}
        }
        if (!visible) continue;
        if (hasLayout) {
          const range=this.document.createRange();range.selectNodeContents(node);
          if (![...range.getClientRects()].some(rect=>rect.width>0 && rect.height>0)) continue;
        }
        const record=this.records.get(node)?.get('#text');
        const original=normalize(record && node.data===record.translated ? record.original : node.data);
        if (!original || (/\p{N}/u.test(original) && /^[\p{N}\p{P}\p{S}\s]+$/u.test(original))) continue;
        candidates.add(original);
      }
      return [...candidates];
    }
    restoreNode(node) {
      const values = this.records.get(node);
      if (!values) return;
      for (const [key, record] of values) {
        const current = key === '#text' ? node.data : node.getAttribute(key);
        if (current === record.translated) {
          if (key === '#text') node.data = record.original; else node.setAttribute(key, record.original);
        }
      }
    }
    restore() { for (const [node] of this.records) this.restoreNode(node); this.records.clear(); }
    translate(node, key, element) {
      const current = key === '#text' ? node.data : node.getAttribute(key);
      if (current === null) return;
      const previous = this.records.get(node)?.get(key);
      const original = previous && current === previous.translated ? previous.original : current;
      const translated = this.replace(original, element);
      if (current !== translated) {
        if (key === '#text') node.data = translated; else node.setAttribute(key, translated);
      }
      if (translated !== original) {
        if (!this.records.has(node)) this.records.set(node, new Map());
        this.records.get(node).set(key, {original, translated});
      } else { this.records.get(node)?.delete(key); }
    }
    replace(original, element) {
      const spans = new Map();
      const add = (start, end, entry) => {
        if (entry.selector && !element.closest(entry.selector)) return;
        const key = start + ':' + end;
        if (!spans.has(key)) spans.set(key, {start,end,entries:[]});
        spans.get(key).entries.push(entry);
      };
      const trimmed = original.trim(), start = original.length - original.trimStart().length;
      for (const e of this.enabled ? this.index.get(trimmed.toLowerCase()) || [] : []) {
        if (!e.caseSensitive || trimmed === e.en.trim()) add(start,start+trimmed.length,e);
      }
      for (const e of this.enabled ? this.words : []) {
        e.pattern.lastIndex = 0;
        for (const match of original.matchAll(e.pattern)) add(match.index,match.index+match[0].length,e);
      }
      // Currency and table spans are independently recognized in original text.
      const selected = this.currency.enabled ? root.TextPatchCurrency.spans(original,this.currency,this.currencyMetadata,this.currencySnapshot) : [];
      for (const span of [...spans.values()].sort((a,b)=>(b.end-b.start)-(a.end-a.start) || a.start-b.start)) {
        if (selected.some(s=>span.start<s.end && span.end>s.start)) continue;
        const scoped = span.entries.filter(e=>e.selector);
        const matches = scoped.length ? scoped : span.entries;
        // Reserve ambiguous spans too: shorter alternatives must not bypass a conflict.
        selected.push({...span,replacement:matches.length === 1 ? matches[0].ko : original.slice(span.start,span.end)});
      }
      let result = '', offset = 0;
      for (const span of selected.sort((a,b)=>a.start-b.start)) {
        result += original.slice(offset,span.start) + span.replacement;
        offset = span.end;
      }
      return result + original.slice(offset);
    }
    *walk(node) {
      yield node;
      const walker=this.document.createTreeWalker(node, 1 | 4);
      while (walker.nextNode()) yield walker.currentNode;
    }
    scan(node) { this.pending.add(node); this.drain(); }
    drain() {
      if(this.currency.enabled && this.currency.source==='auto')this.currencyMetadata=root.TextPatchCurrency.pageCurrency(this.document);
      const roots=[...this.pending];this.pending.clear();
      const rootSet=new Set(roots);
      for (const node of roots) {
        let ancestor=node.parentNode;
        while (ancestor && !rootSet.has(ancestor)) ancestor=ancestor.parentNode;
        if (!ancestor) this.jobs.push(this.walk(node));
      }
      // Each turn touches at most 250 nodes; mutations are coalesced before walking.
      let budget=250;
      while (budget-- > 0 && this.jobs.length) {
        const next=this.jobs[0].next();
        if (next.done) this.jobs.shift(); else this.visit(next.value);
      }
      if (this.jobs.length || this.pending.size) this.schedule();
    }
    visit(node) {
      const element=node.nodeType===3 ? node.parentElement : node;
      const blocked=!this.active() || !node.isConnected || !element?.closest || element.closest(excluded) || editable(element);
      if (blocked || element.closest(controls)) {
        this.restoreNode(node);this.records.delete(node);
        return;
      }
      if (node.nodeType === 3) {
        this.translate(node, '#text', element);
        return;
      }
      if (node.nodeType !== 1) return;
      for (const key of ['title','aria-label','alt']) if (node.hasAttribute(key)) this.translate(node,key,node);
    }
  }
  root.CrimsonTranslator = Translator;
})(globalThis);
