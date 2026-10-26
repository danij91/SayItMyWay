import {readFile} from 'node:fs/promises';
const scripts=await Promise.all(['locales/ko.js','locales/en.js','i18n.js'].map(file=>readFile(new URL('../extension/'+file,import.meta.url),'utf8')));
export function loadKorean(window){
  Object.defineProperty(window.navigator,'language',{configurable:true,value:'ko-KR'});
  for(const source of scripts)window.eval(source);
}
