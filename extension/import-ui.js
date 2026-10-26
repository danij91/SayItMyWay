// Acquire input without persisting clipboard contents.
(function(root){
 const t=key=>root.TextPatchI18n.t(key);
 function text(value){
  if(typeof value!=='string')throw Error(t('import_text_invalid'));
  if(new Blob([value]).size>5_000_000)throw Error(t('import_text_too_large'));
  value=value.trim();if(!value)throw Error(t('import_clipboard_empty'));
  const fence=/^```(?:json)?[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```$/i.exec(value);
  if(fence)value=fence[1].trim();
  try{JSON.parse(value);}catch{throw Error(t('import_text_invalid'));}return value;
 }
 function file(file){
  if(!/\.json$/i.test(file.name))return Promise.reject(Error(t('select_a_json_file')));
  if(file.size>5_000_000)return Promise.reject(Error(t('import_text_too_large')));
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error(t('could_not_read_the_file')));reader.readAsText(file);});
 }
 async function clipboard(current){
  if(!root.navigator.clipboard?.readText)throw Error(t('import_clipboard_unsupported'));
  try{
   if(root.chrome?.permissions?.request){const granted=await root.chrome.permissions.request({permissions:['clipboardRead']});if(!granted)throw Error(t('import_clipboard_denied'));}
   if(!current())return;
   return await root.navigator.clipboard.readText();
  }catch(error){if(error.message===t('import_clipboard_denied'))throw error;throw Error(t(error.name==='NotAllowedError'||error.name==='SecurityError'?'import_clipboard_denied':'import_clipboard_failed'));}
 }
 function chooser({open,dialog,fileInput,fileButton,clipboardButton,cancel,status,allowed,consume,changed=()=>{}}){
  let generation=0,pending=false,applying=false;
  const message=key=>root.TextPatchI18n.text(status,()=>key?t(key):'');
  function lock(value){pending=value;fileButton.disabled=value;clipboardButton.disabled=value;fileInput.disabled=value;changed();}
  function close(){if(applying)return;generation++;lock(false);cancel.disabled=false;dialog.close();open.focus();}
  open.onclick=()=>{if(!allowed()||pending)return;message('');dialog.showModal();fileButton.focus();};
  cancel.onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  fileButton.onclick=()=>{if(pending||!allowed())return;fileInput.value='';fileInput.click();};
  async function run(read,name,readingKey='import_file_reading'){
   if(pending||!allowed())return;const token=++generation;lock(true);message(readingKey);
   try{const raw=await read(()=>token===generation);if(token!==generation)return;const validated=text(raw);applying=true;cancel.disabled=true;const done=await consume(validated,name);if(done!==false){applying=false;close();}else message('');}
   catch(error){if(token===generation)root.TextPatchI18n.text(status,()=>root.TextPatchI18n.message(error.message));}
   finally{if(token===generation){applying=false;cancel.disabled=false;lock(false);fileInput.value='';}}
  }
  clipboardButton.onclick=()=>run(clipboard,t('import_clipboard_name')+'.json','import_clipboard_reading');
  return {files(files){if(!files.length)return;if(files.length!==1){message('import_one_json_file_at_a_time');return;}return run(()=>file(files[0]),files[0].name);},get pending(){return pending;}};
 }
 root.TextPatchImportUI={text,file,chooser};
})(globalThis);
