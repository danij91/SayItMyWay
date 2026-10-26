import vm from 'node:vm';
import {IDBFactory} from 'fake-indexeddb';
import {readFile} from 'node:fs/promises';
const source=async file=>readFile(new URL('../extension/'+file,import.meta.url),'utf8');
export const seed=JSON.parse(await source('data/dictionary.json'));
export async function harness(initial={}, indexedDB=new IDBFactory(),bundle=null, options={}) {
  const store=structuredClone(initial), listeners={}, registrations=[], sent=[], grants=new Set();
  let storageFailure=false, mode='ok', connected=true, request=()=>Promise.resolve(false);
  const alarms=new Map();
  const tabs=[{id:1,url:'https://example.com/docs/a'}];
  const executed=[];let executionResult,executionFailure=false;
  const event=name=>({addListener:fn=>listeners[name]=fn});
  const c=vm.createContext({navigator:{language:'ko'},URL,AbortSignal,AbortController,TextDecoder,TextEncoder,setTimeout,clearTimeout,Date:options.Date || Date,structuredClone,indexedDB,console,crypto:globalThis.crypto,chrome:{
    runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:event('message'),onInstalled:event('installed'),onStartup:event('startup')},
    alarms:{get:async name=>alarms.get(name),create:async(name,details)=>alarms.set(name,details),clear:async name=>alarms.delete(name),onAlarm:event('alarm')},
    storage:{local:{get:async keys=>structuredClone(keys ? Object.fromEntries(keys.filter(k=>k in store).map(k=>[k,store[k]])) : store),set:async p=>{if(storageFailure)throw Error('quota');Object.assign(store,structuredClone(p));}}},
    permissions:{request:details=>request(details),contains:async({origins})=>origins.every(o=>grants.has(o)),onAdded:event('added'),onRemoved:event('removed')},
    scripting:{getRegisteredContentScripts:async()=>registrations,unregisterContentScripts:async()=>{registrations.length=0;},registerContentScripts:async r=>registrations.push(...r),executeScript:async details=>{executed.push(details);if(executionFailure)throw Error("Cannot access contents of the page");connected=true;return executionResult;}},
    tabs:{get:async id=>{const tab=tabs.find(t=>t.id===id);if(!tab)throw Error('No tab with id: '+id);return structuredClone(tab);},query:async()=>structuredClone(tabs),sendMessage:async(id,m)=>{if(!connected)throw Error('No receiver');sent.push(m);},onUpdated:event('updated'),onRemoved:event('tabRemoved')}
  },fetch:async url=>{if(url.endsWith('data/library.json'))return bundle?{ok:true,json:async()=>structuredClone(bundle)}:{ok:false,status:404};if(url.startsWith('chrome-extension:'))return {ok:true,json:async()=>structuredClone(seed)};if(options.fetch)return options.fetch(url);throw Error('Unexpected network call: '+url);}});
  for(const f of ['locales/ko.js','locales/en.js','i18n.js','interaction-settings.js','currency-rates.js','currency.js','currency-feed.js','shared.js','library.js','collection.js','repository.js','editor/import.js'])vm.runInContext(await source(f),c);
  c.importScripts=()=>{};vm.runInContext(await source('background.js'),c);
  return {alarms,setExecutionResult:value=>executionResult=value,setExecutionFailure:value=>executionFailure=value,setStorageFailure:value=>storageFailure=value,indexedDB,store,registrations,sent,grants,listeners,executed,tabs,setRequest:fn=>request=fn,disconnect:()=>connected=false,setMode:m=>mode=m,send:(m,sender={id:'test',url:'chrome-extension://test/popup.html'})=>new Promise(r=>{if(listeners.message(m,sender,r)!==true)r(undefined);})};
}
