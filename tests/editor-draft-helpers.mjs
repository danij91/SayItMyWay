export function toggleDraftName(w){
 const doc=w.document,button=doc.querySelector('#table-rename');if(button.disabled)return;
 button.click();const input=doc.querySelector('#table-name');input.value=input.value.endsWith(' draft')?input.value.slice(0,-6):input.value+' draft';
 doc.querySelector('#table-form').dispatchEvent(new w.Event('submit',{cancelable:true}));
}
export function hasDraftName(w){return w.document.querySelector('#table-select').selectedOptions[0].textContent.endsWith(' draft');}
