import '../extension/shared.js';
const replacements=[
  ['OAKWOOD MUSHRO...','OAKWOOD MUSHROOM','참나무 버섯'],
  ['MYSTERIOUS CREATU...','MYSTERIOUS CREATURE','신비한 생물'],
  ['TREASURE MAP SOLUT...','TREASURE MAP SOLUTION','보물 지도 해답'],
  ['SEALED ABYSS ARTIFA...','SEALED ABYSS ARTIFACT','봉인된 어비스 아티팩트'],
  ['BLACK MARKET TRADIN...','BLACK MARKET TRADING POST','암시장 무역소'],
  ['DECORATIVE STONE SH...','DECORATIVE STONE SHOP','장식석 상점'],
  ['EQUIPMENT BLUEPRI...','EQUIPMENT BLUEPRINT','장비 설계도']
];
const base='http://127.0.0.1:4317';
const response=await fetch(base+'/api/dictionary');
if(!response.ok)throw Error('대응표 읽기 실패');
const data=await response.json();
for(const [partial,en,ko] of replacements){
  const old=data.entries.find(e=>e.en===partial);
  const existing=data.entries.find(e=>e.en===en);
  if(existing && !old)continue; // Repeat runs must preserve subsequent human edits.
  if(existing)throw Error(`전체 원문 항목이 이미 존재합니다: ${en}`);
  if(!old)throw Error(`교체할 항목 없음: ${partial}`);
  Object.assign(old,{en,ko,status:'review',source:'사용자 제공 영문 전체 원문: 프로젝트 대화 (2026-10-18)',evidence:`캡처에서 잘렸던 ${partial}의 전체 영문 표기를 사용자가 제공함. 한국어 번역은 검토용 초안이며 공식 명칭 미확인.`,notes:'영문 원문만 사용자 확인. 한국어는 사용자 확인 또는 공식 검증 전까지 검토 중. 검토 중 번역도 적용 옵션을 켰을 때 표시.'});
}
CrimsonShared.validate(data);
const saved=await fetch(base+'/api/dictionary',{method:'PUT',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(data)});
const result=await saved.json();if(!saved.ok)throw Error(result.error);
for(const [,en,ko] of replacements){
  const entry=result.entries.find(e=>e.en===en);
  if(!entry || !entry.ko)throw Error(`저장 검증 실패: ${en}`);
}
console.log(JSON.stringify({revision:result.revision,total:result.entries.length,updated:replacements.map(([,en])=>result.entries.find(e=>e.en===en)).map(({en,ko,status})=>({en,ko,status}))}));
