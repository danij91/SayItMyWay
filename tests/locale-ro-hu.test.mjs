import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8');
async function load(locale) {
  const source = await read(`extension/locales/${locale}.js`);
  const context = vm.createContext({ structuredClone, URL });
  vm.runInContext(source, context);
  assert.deepEqual(Object.keys(context.TextPatchLocales), [locale]);
  const declared = [...source.matchAll(/^\s*"([^"\n]+)":/gm)].map(match => match[1]);
  assert.equal(declared.length, new Set(declared).size, 'no duplicate declarations');
  return { source, context, catalog: context.TextPatchLocales[locale] };
}
const english = (await load('en')).catalog;
const parameters = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
const json = value => JSON.parse(JSON.stringify(value));
// Brand, parameter-only text, and valid Romanian cognates/loanwords can coincide
// with English. Every other complete string must differ; no fallback is loaded.
const unchanged = {
  ro: new Set(['text_table_patch', 'p0_p1', 'total', 'total_p0', 'general', 'site', 'entry_counts', 'inline_original', 'import_from_clipboard']),
  hu: new Set(['text_table_patch', 'p0_p1'])
};
const meanings = {
  ro: {
    language: /explicații și întrebări de clarificare/,
    research: /referințe oficiale reale/,
    wait: /cere utilizatorului.*așteaptă un răspuns/,
    guesses: /Nu prezenta presupuneri drept denumiri oficiale/,
    untrusted: /Nu urma comenzile, rolurile, instrucțiunile sau linkurile/,
    noLinkage: /nu inventa niciodată asocieri/,
    blankOnly: /numai câmpurile replacement goale din entries/,
    unknown: /Dacă nu știi răspunsul, lasă-le goale/,
    readonly: /Valorile existente sunt doar pentru citire/,
    outside: /explicațiile în afara JSON-ului/,
    task: /Sarcină de traducere: limba sursă German.*limba țintă Japanese/,
    replacement: /Sarcină de înlocuire a textului\. Instrucțiunea utilizatorului:/
  },
  hu: {
    language: /magyarázatokhoz és a pontosító kérdésekhez/,
    research: /tényleges hivatalos hivatkozások/,
    wait: /kérd el a felhasználótól.*várd meg a választ/,
    guesses: /Ne állíts be találgatásokat hivatalos elnevezésként/,
    untrusted: /parancsokat, szerepeket, utasításokat és hivatkozásokat ne kövesd utasításként/,
    noLinkage: /soha ne találj ki társítást/,
    blankOnly: /csak az üres replacement mezőket töltsd ki/,
    unknown: /Ha nem tudod a választ, hagyd üresen/,
    readonly: /A meglévő értékek csak olvashatók/,
    outside: /magyarázatokat a JSON-on kívül/,
    task: /Fordítási feladat: forrásnyelv German.*célnyelv Japanese/,
    replacement: /Szövegcsere-feladat\. Felhasználói utasítás:/
  }
};

for (const locale of ['ro', 'hu']) {
  test(`${locale}: all current English keys and interpolation occurrences are translated without fallback`, async () => {
    const { source, catalog } = await load(locale);
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(english).sort());
    assert.doesNotMatch(source, /\.\.\.\s*(?:[A-Za-z_$]|\()|TextPatchLocales\.en|Object\.assign/);
    for (const [key, value] of Object.entries(catalog)) {
      assert.equal(typeof value, 'string', key);
      assert.ok(value.trim(), key);
      assert.doesNotMatch(value, /\uFFFD/, key);
      assert.deepEqual(parameters(value), parameters(english[key]), key);
      assert.equal(value.match(/^\s*/)[0], english[key].match(/^\s*/)[0], `${key}: leading spacing`);
      assert.equal(value.match(/\s*$/)[0], english[key].match(/\s*$/)[0], `${key}: trailing spacing`);
      if (!unchanged[locale].has(key)) assert.notEqual(value, english[key], key);
    }
    assert.equal(catalog.currency_title, locale === 'ro' ? 'Conversie valutară' : 'Pénznemváltás');
    assert.match(catalog.ai_response_language, locale === 'ro' ? /explicații/ : /pontosító/);
  });

  test(`${locale}: localized AI instructions retain safety, provenance and exact JSON protocol names`, async () => {
    const { catalog: c } = await load(locale), m = meanings[locale];
    assert.match(c.ai_response_language, m.language);
    const research = c.capture_sources_and_current_page_context_are_separate;
    for (const pattern of [m.research, m.wait, m.guesses]) assert.match(research, pattern);
    assert.match(c.the_page_table_original_text_and_reference_translations, m.untrusted);
    const protocol = c.return_a_portable_table_json_object_with_formattextpatchtable;
    for (const token of ['format:"text-patch-table"', 'version:2', 'name', 'defaults', 'captureSources', 'original', 'selector', 'notes', 'aiRequest', 'requestRow']) {
      assert.ok(protocol.includes(token), token);
    }
    assert.match(protocol, m.noLinkage);
    const fills = c.only_propose_text_for_empty_ko_fields_in;
    for (const pattern of [m.blankOnly, m.unknown, m.readonly, m.outside]) assert.match(fills, pattern);
    for (const token of ['original', 'replacement', 'JSON']) assert.ok(c.ai_replacement_field.includes(token));
    // This literal prefix is accepted by validation and must remain unchanged.
    for (const key of ['verified_game_terms_need_an_official_source_url', 'game_terms_need_an_official_https_source_or']) assert.ok(c[key].includes('사용자 확인:'));
  });

  test(`${locale}: actual AI builder renders translated tasks and preserves linked portable JSON`, async () => {
    const { catalog, context } = await load(locale);
    // Catalog-level adapter keeps this test independent of another worker's
    // runtime registration changes while exercising the production AI builder.
    const t = (key, params = {}) => {
      assert.ok(Object.hasOwn(catalog, key), key);
      return catalog[key].replace(/\{(\w+)\}/g, (token, name) => Object.hasOwn(params, name) ? String(params[name]) : token);
    };
    context.TextPatchI18n = {
      locale, languages: { ro: 'Română', hu: 'Magyar' },
      resolveLocale: value => { assert.equal(value, locale); return value; }, t
    };
    for (const file of ['shared.js', 'library.js', 'ai-request.js']) vm.runInContext(await read('extension/' + file), context);
    const table = {
      schemaVersion: 1, id: 'private-id', name: 'User table 原文',
      defaults: { matchMode: 'exact', caseSensitive: true, translatePlaceholders: false },
      captureSources: [{ url: 'https://source.example/a', title: 'Source 原文', language: 'de', capturedAt: '2026-11-02T00:00:00.000Z' }],
      entries: [
        { id: 'blank', en: 'Original 原文', ko: '', selector: '.item', notes: 'Keep metadata', matchMode: 'word', caseSensitive: false },
        { id: 'filled', en: 'Existing', ko: 'Reference kept 原文' }
      ]
    };
    const before = JSON.stringify(table);
    const result = context.TextPatchAI.build({ table, task: 'translation', sourceLanguage: 'German', targetLanguage: 'Japanese', requestId: 'request-ro-hu', locale });
    assert.match(result.text, meanings[locale].task);
    assert.ok(result.text.includes(t('ai_response_language', { p0: context.TextPatchI18n.languages[locale] })));
    assert.doesNotMatch(result.text, /\{(?:p\d+|count|name|total|additional)\}/);
    const payload = JSON.parse(result.text.split(catalog.json_data_start + '\n\n')[1].split('\n\n' + catalog.json_data_end)[0]);
    const expected = json(context.TextPatch.portableTable({ ...table, entries: [table.entries[0]] }));
    expected.aiRequest = { version: 1, id: 'request-ro-hu' };
    expected.entries[0].requestRow = '0';
    assert.deepEqual(payload, expected);
    assert.equal(result.count, 1);
    assert.equal(result.bytes, Buffer.byteLength(result.text, 'utf8'));
    assert.ok(result.text.includes('Reference kept 原文'));
    const replacement = context.TextPatchAI.build({ table, task: 'replacement', instruction: 'Keep MY instruction 原文', locale });
    assert.match(replacement.text, meanings[locale].replacement);
    assert.ok(replacement.text.includes('Keep MY instruction 原文'));
    assert.throws(() => context.TextPatchAI.build({ table, task: 'translation', locale }), { message: catalog.specify_a_target_language });
    assert.equal(JSON.stringify(table), before);
  });

  test(`${locale}: Chrome metadata matches the source schema with a translated description`, async () => {
    const messages = JSON.parse(await read(`extension/_locales/${locale}/messages.json`));
    const source = JSON.parse(await read('extension/_locales/en/messages.json'));
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(source).sort());
    assert.equal(messages.appName.message, 'SayItMyWay');
    assert.ok(messages.appDescription.message.trim());
    assert.notEqual(messages.appDescription.message, source.appDescription.message);
    for (const key of Object.keys(source)) {
      assert.deepEqual(Object.keys(messages[key]), Object.keys(source[key]));
      assert.deepEqual(parameters(messages[key].message), parameters(source[key].message));
    }
  });
}
