// ECB reference feed. This module owns validation, durable attempts and cache;
// network work never enters the background's general settings mutation queue.
(function(root){
  const URL='https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
  const PERIOD=6*60*60*1000,RETRY=5*60*1000,LIMIT=32768;
  const fallback=root.TextPatchCurrencyRates,codes=Object.keys(fallback.rates);
  const invalid=()=>{throw Error('Invalid ECB reference rates');};
  function dateValid(date,now){
    return typeof date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10)===date && date<=new Date(now).toISOString().slice(0,10);
  }
  function validate(snapshot,now,minDate=fallback.date){
    if(!snapshot || snapshot.base!=='EUR' || !dateValid(snapshot.date,now) || snapshot.date<minDate || snapshot.rates?.EUR!==1)invalid();
    for(const code of codes)if(typeof snapshot.rates[code]!=='number' || !Number.isFinite(snapshot.rates[code]) || snapshot.rates[code]<=0)invalid();
    return {source:fallback.source,url:URL,base:'EUR',date:snapshot.date,rates:Object.fromEntries(codes.map(code=>[code,snapshot.rates[code]]))};
  }
  function attributes(text){
    const result={};let rest=text;
    while(rest.trim()){
      const match=/^\s+([A-Za-z_:][\w:.-]*)\s*=\s*(['"])([^'"<> &]*)\2/.exec(rest);
      if(!match || Object.hasOwn(result,match[1]))invalid();result[match[1]]=match[3];rest=rest.slice(match[0].length);
    }
    return result;
  }
  function parse(xml,now,minDate){
    if(typeof xml!=='string' || new TextEncoder().encode(xml).length>LIMIT)invalid();
    // An intentionally narrow full-document grammar rejects entities, DTDs,
    // extra roots, mismatched tags and partial XML without a DOM or remote code.
    const document=/^\s*(?:<\?xml\s+version=(?:'1\.0'|"1\.0")\s+encoding=(?:'UTF-8'|"UTF-8")\s*\?>\s*)?<gesmes:Envelope([^<>]*)>\s*<gesmes:subject>Reference rates<\/gesmes:subject>\s*<gesmes:Sender>\s*<gesmes:name>European Central Bank<\/gesmes:name>\s*<\/gesmes:Sender>\s*<Cube>\s*<Cube([^<>]*)>([\s\S]*?)<\/Cube>\s*<\/Cube>\s*<\/gesmes:Envelope>\s*$/.exec(xml);
    if(!document)invalid();
    const ns=attributes(document[1]);
    if(Object.keys(ns).length!==2 || ns['xmlns:gesmes']!=='http://www.gesmes.org/xml/2002-08-01' || ns.xmlns!=='http://www.ecb.int/vocabulary/2002-08-01/eurofxref')invalid();
    const dated=attributes(document[2]);if(Object.keys(dated).length!==1 || !dated.time)invalid();
    const rates={EUR:1},seen=new Set(['EUR']);let rest=document[3];
    while(rest.trim()){
      const match=/^\s*<Cube([^<>]*)\/>/.exec(rest);if(!match)invalid();
      const row=attributes(match[1]),code=row.currency;
      if(Object.keys(row).length!==2 || !/^[A-Z]{3}$/.test(code) || seen.has(code) || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(row.rate) || !Number.isFinite(Number(row.rate)) || Number(row.rate)<=0)invalid();
      seen.add(code);if(codes.includes(code))rates[code]=Number(row.rate);rest=rest.slice(match[0].length);
    }
    return validate({base:'EUR',date:dated.time,rates},now,minDate);
  }
  async function read(response){
    if(!response.ok || Number(response.headers?.get('content-length'))>LIMIT)throw Error('ECB request failed');
    if(!response.body?.getReader)throw Error('ECB response stream unavailable');
    const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,text='';
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>LIMIT)throw Error('ECB response too large');text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}
    finally{await reader.cancel().catch(()=>{});}
  }
  function create({storage,fetch,now=Date.now,onChange=()=>{},timeoutMs=15000}){
    let good=null,checkedAt=null,lastAttempt=null,error=false,inflight=null;
    const metadata=()=>({date:(good || fallback).date,checkedAt,status:good ? error || !checkedAt || now()-Date.parse(checkedAt)>=PERIOD ? 'cached':'current':'bundled',refreshing:!!inflight,error});
    const snapshot=()=>({...(good || fallback),...metadata(),rates:{...(good || fallback).rates}});
    const ready=(async()=>{
      try{
        const saved=(await storage.get(['currencyRateCache','currencyRateAttempt']));
        const attempt=saved.currencyRateAttempt;
        if(Number.isFinite(attempt?.at) && attempt.at>=0){lastAttempt=Math.min(attempt.at,now());error=attempt.error===true || attempt.pending===true;}
        const cache=saved.currencyRateCache;
        if(cache){good=validate(cache.snapshot,now());if(typeof cache.checkedAt!=='string' || !Number.isFinite(Date.parse(cache.checkedAt)) || Date.parse(cache.checkedAt)>now())invalid();checkedAt=cache.checkedAt;}
      }catch{good=null;checkedAt=null;error=true;}
    })();
    async function attempt(manual){
      await ready;
      if(lastAttempt!==null){lastAttempt=Math.min(lastAttempt,now());if(now()-lastAttempt<(manual?15000:RETRY))return;}
      lastAttempt=now();
      try{
        // Do not hit the network unless the throttle survives suspension/restart.
        await storage.set({currencyRateAttempt:{at:lastAttempt,pending:true,error:false}});
        const controller=new AbortController();let timer;
        try{
          const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('ECB timeout'));},timeoutMs);});
          const xml=await Promise.race([(async()=>read(await fetch(URL,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',redirect:'error',signal:controller.signal})))(),timeout]);
          const next=parse(xml,now(),(good || fallback).date),checked=new Date(now()).toISOString();
          await storage.set({currencyRateCache:{snapshot:next,checkedAt:checked},currencyRateAttempt:{at:lastAttempt,pending:false,error:false}});
          good=next;checkedAt=checked;error=false;
        }finally{clearTimeout(timer);}
      }catch{
        error=true;
        try{await storage.set({currencyRateAttempt:{at:lastAttempt,pending:false,error:true}});}catch{/* Retain last good snapshot and durable pending attempt. */}
      }
    }
    function refresh({manual=false}={}){
      if(inflight)return inflight;
      inflight=attempt(manual).finally(()=>{inflight=null;onChange();});onChange();return inflight;
    }
    async function refreshIfDue(){await ready;if(!checkedAt || error || now()-Date.parse(checkedAt)>=PERIOD)return refresh();}
    return {ready,metadata,snapshot,refresh,refreshIfDue};
  }
  root.TextPatchCurrencyFeed={create};
})(globalThis);
