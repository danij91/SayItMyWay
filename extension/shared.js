(function (root) {
  const normalize = text => text.trim().replace(/\s+/g, ' ');
  function validate(data) {
    if (data?.schemaVersion !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 1 || !Array.isArray(data.entries) || data.entries.length > 50000) throw Error('대응표 형식이 올바르지 않습니다.');
    const ids = new Set();
    for (const e of data.entries) {
      if(!e || typeof e!=='object' || Array.isArray(e))throw Error('행의 JSON 형식을 확인하세요.');
      if(e.matchMode !== undefined && !['exact','word'].includes(e.matchMode))throw Error('일치 방식이 올바르지 않습니다.');
      if(e.caseSensitive !== undefined && typeof e.caseSensitive !== 'boolean')throw Error('대소문자 옵션이 올바르지 않습니다.');
      for (const field of ['id','en','ko']) {
        if (typeof e[field] !== 'string' || e[field].length > 20000) throw Error(`잘못된 필드: ${field}`);
      }
      for(const field of ['selector','notes'])if(e[field]!==undefined && (typeof e[field]!=='string' || e[field].length>20000))throw Error(`잘못된 필드: ${field}`);
      if (!e.id || !normalize(e.en)) throw Error('필수 항목을 확인하세요.');
      // Distinct rows may share source text and selector. The engine preserves
      // original text on ambiguous matches, including legacy context duplicates.
      if (ids.has(e.id)) throw Error('중복 ID입니다.');
      ids.add(e.id);
    }
    return data;
  }
  function filter(entries, query = '') {
    const q = query.toLocaleLowerCase();
    return entries.filter(e => [e.en,e.ko].some(s => s.toLocaleLowerCase().includes(q)));
  }
  const activeRow = row => row && Object.fromEntries(Object.entries(row).filter(([key])=>!['status','kind','context','category','source','evidence'].includes(key)));
  root.CrimsonShared = {validate, normalize, filter, activeRow};
})(globalThis);
