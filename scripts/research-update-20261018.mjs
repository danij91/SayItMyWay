// Explicit, reviewed delta. Does not rerun or reset the screenshot import.
import '../extension/shared.js';
const base='http://127.0.0.1:4317';
const response=await fetch(base+'/api/dictionary');
if(!response.ok)throw Error('백오피스를 먼저 실행하세요.');
const data=await response.json();
const changes=[
  ['ABYSS GEAR','어비스 기어',90,'콘텐츠: 비지오네 등 장비 강화 및 소켓 추가'],
  ['SMITHY','대장간',90,'신규: 담금질 재료 추출 기능을 이용하는 NPC'],
  ['SADDLERY','마구 상점',90,'신규: 도시별 특수 탑승물 안장 판매처. 일반 판매처와 에퀸셔 안장 공방의 개별 이름은 구분'],
  ['SECRET SHOP','비밀 상점',90,'신규: 용맹의 부적 판매처'],
  ['RESEARCH INSTITUTE','연구소',90,'UI: 연구소 UI를 더 직관적으로 개선'],
  ['IRON ORE','철광석',90,'신규: 담금질 추출 시 일반 재료 반환율 목록'],
  ['COPPER ORE','구리광석',90,'신규: 담금질 추출 시 일반 재료 반환율 목록'],
  ['BLOODSTONE','혈석',90,'신규: 담금질 추출 시 일반 재료 반환율 목록'],
  ['MAIN QUEST','메인 의뢰',117,'콘텐츠: 의뢰 지식 하위 분류 목록'],
  ['FACTION QUEST','세력 의뢰',117,'콘텐츠: 의뢰 지식 하위 분류 목록'],
  ['CONSTELLATION','별자리',117,'콘텐츠: 의뢰 지식 하위 분류 목록'],
  ['STABLE','마구간',117,'콘텐츠: 말 장비 장착 기능 개선'],
  ['BANK','은행',110,'신규: 은행 관련 콘텐츠 개선'],
  ['LIVESTOCK FENCE','가축 장물아비',110,'콘텐츠: 코끼리 판매 오류 수정'],
  ["TAILOR'S SHOP",'의상점',110,'콘텐츠: 지도 아이콘과 실제 위치 불일치 수정'],
  ['KEY','열쇠',110,'콘텐츠: 별의 탑 문을 열쇠로 열지 못하는 오류 수정'],
  ['WELL','우물',84,'UI: 지도 및 미니맵 우물 아이콘 개선'],
  ['STONE','석재',84,'조작: 광부의 랜턴 모자로 식별하는 대상 추가'],
  ['MEMORY FRAGMENT','기억의 파편',84,'UI: 획득한 기억의 파편의 지도·미니맵 아이콘과 랜턴 감지. 기존 1.00.03 설명의 기억의 흔적보다 지도 표시를 직접 명시한 후속 자료를 우선'],
  ['SPECIAL COOKING TOOL','특제 요리 도구',73,'콘텐츠: 자동 발견 거리의 도구 목록. 캡처에서는 원문 끝이 잘림; 이 전체 명칭은 공식 영문 문서에서 별도로 확인']
];
for(const [en,ko,board,reason] of changes){
  const old=data.entries.find(e=>e.en.toLowerCase()===en.toLowerCase());
  const source=`https://crimsondesert.pearlabyss.com/ko-KR/News/Notice/Detail?_boardNo=${board}`;
  const entry={id:old?.id||'research-'+en.toLowerCase().replace(/[^a-z0-9]+/g,'-'),en,ko,kind:'game',category:old?.category||'제작 도구',context:old?.context||'screenshot-sidebar',selector:old?.selector||'',status:'verified',source,evidence:`2026-10-18 영·한 공식 동일 게시물 대조. ${reason}. 영문: ${source.replace('ko-KR','en-US')}`,notes:'공식 공개 자료 확인. 실제 한국어 클라이언트 직접 대조는 미실시.'};
  if(old)data.entries[data.entries.indexOf(old)]=entry;else data.entries.push(entry);
}
// Ordinary site controls and non-game-specific classification labels.
for(const [en,ko] of [['Settings','설정'],['Login','로그인'],['MISCELLANEOUS','기타'],['POINT OF INTEREST','관심 지점'],['MY SUGGESTIONS (','내 제안 ('],['MY SUGGESTIONS(','내 제안('],['MY SUGGESTIONS(0)','내 제안(0)']]){
  const old=data.entries.find(e=>e.en.toLowerCase()===en.toLowerCase());
  const entry={id:old?.id||'ui-variant-'+data.entries.length,en,ko,kind:'ui',category:'메뉴·분류',context:old?.context||'screenshot-sidebar',selector:old?.selector||'',status:'verified',source:'사용자 UI·메뉴 일반 번역 허용 (2026-10-18)',evidence:'일반 사이트 UI 번역 검토. 공식 게임 명칭 검증이 아님.',notes:en.startsWith('MY SUGGESTIONS')?'카운터가 별도 텍스트 노드인 경우의 전체 일치 변형. 실제 DOM 분할 형태는 미확인. 숫자는 번역하지 않음.':'사이트 메뉴 및 일반 분류명. Settings/Login 실제 노출 여부는 미확인.'};
  if(old)data.entries[data.entries.indexOf(old)]=entry;else data.entries.push(entry);
}
CrimsonShared.validate(data);
const saved=await fetch(base+'/api/dictionary',{method:'PUT',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(data)});
const result=await saved.json();if(!saved.ok)throw Error(result.error);
console.log(JSON.stringify({revision:result.revision,total:result.entries.length,verified:result.entries.filter(e=>e.status==='verified').length,review:result.entries.filter(e=>e.status==='review').length,untranslated:result.entries.filter(e=>e.status==='untranslated').length}));
