(function(root){
  const snapshot=root.TextPatchCurrencyRates, codes=Object.keys(snapshot.rates).sort();
  const explicit={'원':'KRW','₩':'KRW','€':'EUR','£':'GBP','₹':'INR','US$':'USD','CA$':'CAD','C$':'CAD','AU$':'AUD','A$':'AUD','NZ$':'NZD','HK$':'HKD','SG$':'SGD','S$':'SGD','R$':'BRL','CN¥':'CNY','JP¥':'JPY'};
  const ambiguous={'$':['USD','CAD','AUD','NZD','HKD','SGD','MXN'],'¥':['JPY','CNY'],'￥':['JPY','CNY']};
  const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const labels=[...codes,...Object.keys(explicit),...Object.keys(ambiguous)].sort((a,b)=>b.length-a.length).map(escape).join('|');
  // Consume the entire numeric token before validating; never convert a valid
  // looking substring of a malformed amount. Whitespace grouping is unsupported.
  const number='[-−]?[0-9][0-9.,]*';
  const pattern=new RegExp('(?<![\\p{L}\\p{N}_.,])(?:(?<prefix>'+labels+')\\s*(?<a>'+number+')(?![\\p{L}\\p{N}_.,])|(?<b>'+number+')\\s*(?<suffix>'+labels+'))(?![\\p{L}\\p{N}_])','gu');
  function preferences(value={}){
    const source=value.source ?? 'auto',target=value.target ?? 'USD';
    if(!['auto','all',...codes].includes(source) || !codes.includes(target))throw Error('Invalid currency selection');
    return {enabled:value.enabled===true,source,target};
  }
  function amount(text){
    const sign=/^[-−]/.test(text)?-1:1,s=text.replace(/^[-−]/,'');
    let normalized;
    if(/^\d+$/.test(s) || /^\d+\.\d{1,2}$/.test(s))normalized=s;
    else if(/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s))normalized=s.replaceAll(',','');
    else if(/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s))normalized=s.replaceAll('.','').replace(',','.');
    else if(/^\d+,\d{1,2}$/.test(s))normalized=s.replace(',','.');
    else return null;
    const result=Number(normalized)*sign;
    return Number.isFinite(result) && Math.abs(result)<=1e12?result:null;
  }
  function pageCurrency(document){
    const values=new Set();
    for(const node of document.querySelectorAll('meta[property="product:price:currency"],meta[property="og:price:currency"],[itemprop="priceCurrency"]')){
      const value=(node.getAttribute('content') || node.textContent || '').trim().toUpperCase();
      values.add(value);
    }
    // Only explicit priceCurrency fields are read from JSON-LD, never prose.
    for(const node of document.querySelectorAll('script[type="application/ld+json"]')){
      try{
        const walk=value=>{if(!value || typeof value!=='object')return;for(const [key,v] of Object.entries(value)){if(key==='priceCurrency')values.add(String(v).trim().toUpperCase());else walk(v);}};
        walk(JSON.parse(node.textContent));
      }catch{/* Malformed metadata supplies no inference. */}
    }
    return values.size===1 && codes.includes([...values][0])?[...values][0]:null;
  }
  const trailingLabel=new RegExp('(?:'+labels+')\\s*$','u');
  const leadingLabel=new RegExp('^\\s*(?:'+labels+')(?![\\p{L}])','u');
  const formatters=new Map();
  function spans(original,settings,metadata=null,current=snapshot){
    const prefs=preferences(settings);if(!prefs.enabled)return [];
    const result=[];
    for(const match of original.matchAll(pattern)){
      const before=original.slice(0,match.index),after=original.slice(match.index+match[0].length);
      // Unsupported dual labels and spaced numeric groups stay untouched.
      if(trailingLabel.test(before) || leadingLabel.test(after) || (match.groups.suffix && /[0-9.,]\s+$/.test(before)) || (match.groups.prefix && /^\s+[0-9]/.test(after)))continue;
      const label=match.groups.prefix || match.groups.suffix;
      let source=codes.includes(label)?label:explicit[label];
      if(!source && ambiguous[label]){
        const selected=codes.includes(prefs.source)?prefs.source:prefs.source==='auto'?metadata:null;
        if(ambiguous[label].includes(selected))source=selected;
      }
      if(!source || (codes.includes(prefs.source) && source!==prefs.source))continue;
      const value=amount(match.groups.a || match.groups.b);if(value===null)continue;
      if(source===prefs.target){result.push({start:match.index,end:match.index+match[0].length,replacement:match[0]});continue;}
      const converted=value/current.rates[source]*current.rates[prefs.target];
      if(!Number.isFinite(converted) || (value!==0 && converted===0))continue;
      if(!formatters.has(prefs.target))formatters.set(prefs.target,new Intl.NumberFormat('en-US',{style:'currency',currency:prefs.target,currencyDisplay:prefs.target==='USD'?'symbol':'code'}));
      const replacement=formatters.get(prefs.target).format(converted);
      result.push({start:match.index,end:match.index+match[0].length,replacement});
    }
    return result;
  }
  root.TextPatchCurrency={codes,preferences,spans,pageCurrency,snapshot};
})(globalThis);
