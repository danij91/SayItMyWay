const $=id=>document.getElementById(id);
const sites=TextPatchSites.mount({rows:$('rules'),status:$('status')});
let refreshing=false,lastRefresh=0,refreshTimer;
async function send(message){const result=await chrome.runtime.sendMessage(message);if(result.error)throw Error(result.error);return result;}
// Network refresh is bounded to entry/focus; storage events only render the cache.
async function refresh(){
  if(refreshing)return;
  const remaining=1500-(Date.now()-lastRefresh);
  if(remaining>0){clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,remaining);return;}
  clearTimeout(refreshTimer);
  refreshing=true;lastRefresh=Date.now();
  try{const result=await send({type:'refresh'});if(result.offline)TextPatchI18n.text($('status'),()=>result.notice);}
  catch{TextPatchI18n.text($('status'),()=>TextPatchI18n.t('could_not_refresh_tables_showing_the_saved_list'));}
  finally{refreshing=false;await sites.load();}
}
sites.load();refresh();
window.addEventListener('focus',refresh);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
window.addEventListener('message',event=>{if(event.source===parent&&event.origin===location.origin&&event.data?.type==='sites-visible')refresh();});
chrome.storage?.onChanged?.addListener((changes,area)=>{
  if(area==='local'&&['libraryRevision','rules','originEnabled','enabled','offline','loadedAt'].some(key=>key in changes))sites.load();
});
