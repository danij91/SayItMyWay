(function (root) {
  const statuses = ['untranslated', 'review', 'verified'];
  const normalize = text => text.trim().replace(/\s+/g, ' ');
  function validate(data) {
    if (data?.schemaVersion !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 1 || !Array.isArray(data.entries) || data.entries.length > 50000) throw Error('대응표 형식이 올바르지 않습니다.');
    const ids = new Set(), keys = new Set();
    for (const e of data.entries) {
      if(e.matchMode !== undefined && !['exact','word'].includes(e.matchMode))throw Error('일치 방식이 올바르지 않습니다.');
      if(e.caseSensitive !== undefined && typeof e.caseSensitive !== 'boolean')throw Error('대소문자 옵션이 올바르지 않습니다.');
      for (const field of ['id','en','ko','kind','category','context','selector','status','source','evidence','notes']) {
        if (typeof e[field] !== 'string' || e[field].length > 20000) throw Error(`잘못된 필드: ${field}`);
      }
      if (!e.id || !normalize(e.en) || !e.category.trim() || !e.context.trim() || !['game','ui','general'].includes(e.kind) || !statuses.includes(e.status)) throw Error('필수 항목을 확인하세요.');
      if (e.status === 'verified' && (!e.ko.trim() || !e.source.trim() || !e.evidence.trim())) throw Error('확인 완료에는 번역, 출처, 확인 근거가 필요합니다.');
      if (e.kind === 'game' && e.status === 'verified' && !/^(https:\/\/|사용자 확인:)/.test(e.source)) throw Error('게임 용어는 공식 자료 HTTPS 주소 또는 사용자 확인:으로 시작하는 출처가 필요합니다.');
      const key = JSON.stringify([normalize(e.en), e.context, e.selector]);
      if (ids.has(e.id) || keys.has(key)) throw Error('중복 ID 또는 원문·문맥·선택자입니다.');
      ids.add(e.id); keys.add(key);
    }
    return data;
  }
  function filter(entries, query = '', kind = '', status = '', category = '') {
    const q = query.toLocaleLowerCase();
    return entries.filter(e => (!kind || e.kind === kind) && (!status || e.status === status) && (!category || e.category === category) && [e.en,e.ko].some(s => s.toLocaleLowerCase().includes(q)));
  }
  root.CrimsonShared = {validate, normalize, filter};
})(globalThis);
