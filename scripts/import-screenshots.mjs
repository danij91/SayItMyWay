import {groups,ui,official} from './screenshot-entries.mjs';
import '../extension/shared.js';
const base='http://127.0.0.1:4317';
const response=await fetch(base+'/api/dictionary');
if(!response.ok)throw Error('백오피스를 먼저 실행하세요.');
const data=await response.json();
const koSource='https://crimsondesert.pearlabyss.com/ko-KR/News/Notice/Detail?_boardNo=73';
const enSource=koSource.replace('ko-KR','en-US');
function upsert(en,ko,kind,category,extra={}) {
  const old=data.entries.find(e=>e.en.toLowerCase()===en.toLowerCase() && ['global','ui-candidate','screenshot-sidebar'].includes(e.context));
  // Do not undo later human verification or research updates on a repeat import.
  if(old?.status === 'verified')return;
  if(old && !old.id.startsWith('ui-') && !old.id.startsWith('capture-'))return;
  const entry={id:old?.id||'capture-'+en.toLowerCase().replace(/[^a-z0-9]+/g,'-'),en,ko,kind,category,context:'screenshot-sidebar',selector:'',status:ko?'review':'untranslated',source:'사용자 제공 캡처 #1–#3 (2026-10-18)',evidence:'캡처의 영문 표기를 육안 확인. DOM 원문·선택자는 미확인.',notes:ko?'한국어는 검토용 초안이며 공식 명칭 미확인. 기본 미적용.':'캡처에서 말줄임. 전체 원문 확보 전까지 번역하지 않음.',...extra};
  if(old)data.entries[data.entries.indexOf(old)]=entry;else data.entries.push(entry);
}
for(const line of ui.split('\n')) {
  const [en,ko]=line.split('|');upsert(en,ko,'ui','메뉴·분류',{status:'verified',evidence:'사용자 캡처의 버튼·안내·분류 제목을 확인하고 일반 UI 한국어 번역 검토. 게임 고유명칭의 공식 검증을 의미하지 않음.',notes:'대소문자 무시 전체 일치. 숫자와 아이콘은 변경하지 않음.'});
}
for(const [category,lines] of Object.entries(groups))for(const line of lines.split('\n')){
  const [en,draft]=line.split('|'),verified=official[en];
  const board=verified?.[2]||73;
  upsert(en,verified?.[0]||draft,'game',category,verified?{status:'verified',source:koSource.replace('=73','='+board),evidence:`2026-10-18 공식 패치 ${board===73?'1.00.03':'1.04.01'} 영·한 동일 항목 대조: ${verified[1]}. 영문: ${enSource.replace('=73','='+board)}`,notes:'캡처 원문 확인. 공식 클라이언트 직접 실행 대조는 미실시.'}:{});
}
CrimsonShared.validate(data);
const saved=await fetch(base+'/api/dictionary',{method:'PUT',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(data)});
const result=await saved.json();if(!saved.ok)throw Error(result.error);
console.log(JSON.stringify({total:result.entries.length,verified:result.entries.filter(e=>e.status==='verified').length,review:result.entries.filter(e=>e.status==='review').length,untranslated:result.entries.filter(e=>e.status==='untranslated').length}));
