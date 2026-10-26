(() => {
  const $ = id => document.getElementById(id);
  const json = value => JSON.stringify(value, null, 2);
  let content, generated, generation = 0;
  async function fetchJSON(url) {
    const response = await fetch(url), data = await response.json();
    if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
    return data;
  }
  function grid(id, headers, rows) {
    const table = document.createElement('table'), head = table.createTHead().insertRow();
    for (const title of headers) {const th = document.createElement('th'); th.textContent = title; head.append(th);}
    const body = table.createTBody();
    for (const row of rows) {const tr = body.insertRow(); for (const value of row) {const td = tr.insertCell(); td.dir = 'auto'; if (value && typeof value === 'object') {const details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre'); summary.textContent = '상세 보기'; pre.dir = 'ltr'; pre.textContent = json(value); details.append(summary, pre); td.append(details);} else td.textContent = String(value ?? '');}}
    $(id).replaceChildren(table);
  }
  function template() {
    const locale = $('locale').value;
    $('template-source').textContent = `${content.sources.builder} · extension/locales/${locale}.js · {p0}, {p1}은 생성 시 치환`;
    $('template').textContent = json(Object.fromEntries(content.templateKeys.map(key => [key, content.catalogs[locale][key] ?? content.catalogs.en[key] ?? key])));
  }
  function invalidate() {
    generation++; generated = null; $('output').value = ''; $('sample-json').textContent = '';
    $('copy').disabled = $('download').disabled = true;
    $('prompt-meta').textContent = '조건을 확인하고 요청문을 생성하세요.';
    if (content) template();
  }
  function catalog() {
    const locale = $('catalog-locale').value, query = $('locale-search').value.toLocaleLowerCase();
    const entries = Object.entries(content.catalogs[locale]), rows = entries.filter(row => row.join(' ').toLocaleLowerCase().includes(query));
    $('locale-meta').textContent = `extension/locales/${locale}.js · ${rows.length} / ${entries.length}개 문구`;
    grid('locale-rows', ['키', '문구'], rows);
  }
  function dictionary() {
    const query = $('dictionary-search').value.toLocaleLowerCase();
    const entries = content.dictionary.entries.filter(entry => json(entry).toLocaleLowerCase().includes(query));
    $('dictionary-count').textContent = `${entries.length} / ${content.dictionary.entries.length}행`;
    grid('dictionary-rows', ['ID', '원문', '대체문', '검증 상태', '종류 / 분류', '출처', '근거 / 메모', '전체 메타데이터'],
      entries.map(e => [e.id, e.en, e.ko, e.status, `${e.kind ?? ''} / ${e.category ?? ''}`, e.source, `${e.evidence ?? ''}\n${e.notes ?? ''}`, e]));
  }
  for (const button of document.querySelectorAll('[data-panel]')) button.onclick = () => {
    for (const item of document.querySelectorAll('[data-panel]')) {const active = item === button; item.setAttribute('aria-pressed', String(active)); $('panel-' + item.dataset.panel).hidden = !active;}
  };
  for (const id of ['locale','task','sample','source','target','site','instruction']) $(id).addEventListener('input', invalidate);
  $('catalog-locale').onchange = $('locale-search').oninput = () => content && catalog();
  $('dictionary-search').oninput = () => content && dictionary();
  $('generate').onclick = async () => {
    invalidate(); const current = generation;
    const params = new URLSearchParams(Object.fromEntries(['locale','task','sample','source','target','site','instruction'].map(id => [id, $(id).value])));
    try {
      const result = await fetchJSON('/api/prompt?' + params);
      if (current !== generation) return;
      generated = result; $('output').value = result.text; $('sample-json').textContent = json(result.table);
      $('copy').disabled = !result.copyable; $('download').disabled = false;
      $('prompt-meta').textContent = `${result.count}행 · UTF-8 ${result.bytes} bytes · ${result.copyable ? '복사 가능' : '큰 요청: TXT 받기 사용'}`;
    } catch (error) {if (current === generation) $('prompt-meta').textContent = error.message;}
  };
  $('copy').onclick = async () => {
    if (!generated?.copyable) return;
    try {await navigator.clipboard.writeText(generated.text); $('prompt-meta').textContent += ' · 복사 완료';}
    catch { $('prompt-meta').textContent = '복사하지 못했습니다. TXT 받기를 사용하세요.'; }
  };
  $('download').onclick = () => {
    if (!generated) return;
    const url = URL.createObjectURL(new Blob([generated.text], {type:'text/plain;charset=utf-8'})), link = document.createElement('a');
    link.href = url; link.download = 'crimsonmap-prompt.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  fetchJSON('/api/content').then(data => {
    content = data;
    for (const id of ['locale','catalog-locale']) for (const [value, label] of Object.entries(data.languages)) {const option = document.createElement('option'); option.value = value; option.textContent = label; $(id).append(option);}
    $('builder').textContent = data.builderSource;
    const {entries, ...metadata} = data.dictionary;
    const counts = entries.reduce((result, entry) => {result[entry.status] = (result[entry.status] || 0) + 1; return result;}, {});
    $('dictionary-meta').textContent = `${data.sources.dictionary} · ${entries.length}행 · 상태별 ${json(counts)}`;
    $('dictionary-source').textContent = json(metadata);
    invalidate(); catalog(); dictionary(); $('generate').disabled = false;
    $('status').textContent = '앱 번들 읽기 완료 · 파일 변경 후 서버를 다시 시작하세요.';
  }).catch(error => {$('status').textContent = '번들 읽기 실패: ' + error.message;});
})();
