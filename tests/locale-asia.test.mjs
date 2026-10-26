import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const locales = { ja: 'ja', 'zh-Hans': 'zh_CN', 'zh-Hant': 'zh_TW', id: 'id', vi: 'vi', th: 'th', hi: 'hi' };
// R1's complete-message contract, also usable before its en.js is integrated.
const additions = {
  collection_counts: '{total} collected · {additional} added',
  collection_pending: 'Save failed. Unsaved text retained: {count}.',
  active_replacement_count: 'Active · Replacements: {count}',
  imported_table_count: 'Imported table drafts: {count}. Save changes at the top.',
  entry_counts: 'Total: {total}',
  collection_activity: 'Collecting more',
  collection_deleted: 'The collected table was deleted.'
};

async function load(locale) {
  const source = await readFile(new URL(`extension/locales/${locale}.js`, root), 'utf8');
  const context = {};
  new vm.Script(source, { filename: `${locale}.js` }).runInNewContext(context, { timeout: 1000 });
  assert.deepEqual(Object.keys(context.TextPatchLocales), [locale], 'script registers only its own locale');
  const catalog = context.TextPatchLocales[locale];
  const declaredKeys = [...source.matchAll(/^\s*"([^"\n]+)":/gm)].map(match => match[1]);
  assert.equal(declaredKeys.length, new Set(declaredKeys).size, 'no duplicate keys hidden by object evaluation');
  return catalog;
}

const english = await load('en');
const expected = { ...english, ...additions };
const parameters = value => [...value.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map(match => match[1]).sort();
const unchanged = new Set(['text_table_patch', 'p0_p1']);
const scripts = {
  ja: /\p{Script=Han}/u,
  'zh-Hans': /\p{Script=Han}/u,
  'zh-Hant': /\p{Script=Han}/u,
  id: /[A-Za-z]/u,
  vi: /[ĐđÀ-ỹ]/u,
  th: /\p{Script=Thai}/u,
  hi: /\p{Script=Devanagari}/u
};

for (const [locale, chromeLocale] of Object.entries(locales)) {
  test(`${locale}: complete catalog, exact parameter parity, no English fallback`, async () => {
    const catalog = await load(locale);
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(expected).sort());
    assert.match(catalog.collection_complete, scripts[locale], 'expected language characters survive UTF-8 generation');
    for (const [key, value] of Object.entries(catalog)) {
      assert.equal(typeof value, 'string', key);
      assert.ok(value.trim(), `${key}: nonempty translation`);
      assert.deepEqual(parameters(value), parameters(expected[key]), `${key}: parameters`);
      assert.doesNotMatch(value, /[\uFFFD\u202A-\u202E\u2066-\u2069]/u, `${key}: no damaged text or bidi controls`);
      assert.doesNotMatch(value, /\?{2,}/u, `${key}: no ASCII replacement runs from a damaged encoding`);
      // Indonesian "Status" is the normal local term, identical to English.
      if (!unchanged.has(key) && !(locale === 'id' && ['status','entry_counts'].includes(key))) {
        assert.notEqual(value, expected[key], `${key}: untranslated English value`);
      }
    }
    for (const key of unchanged) assert.equal(catalog[key], expected[key], `${key}: technical delimiter/brand`);
  });

  test(`${locale}: AI schema and security-relevant technical literals survive translation`, async () => {
    const catalog = await load(locale);
    const portable = catalog.return_a_portable_table_json_object_with_formattextpatchtable;
    for (const literal of ['format:"text-patch-table"', 'version:2', 'defaults', 'captureSources', 'original', 'selector', 'notes']) {
      assert.ok(portable.includes(literal), `portable request retains ${literal}`);
    }
    const proposal = catalog.only_propose_text_for_empty_ko_fields_in;
    for (const literal of ['entries', 'replacement', 'JSON']) {
      assert.ok(proposal.includes(literal), `proposal request retains ${literal}`);
    }
    for (const key of ['verified_game_terms_need_an_official_source_url', 'game_terms_need_an_official_https_source_or']) {
      assert.ok(catalog[key].includes('사용자 확인:'), `${key}: validator prefix remains literal`);
    }
    assert.ok(catalog.auto_detects_the_source_language_you_can_enter.includes('auto'));
    assert.ok(catalog.translation_task_source_language_p0_auto_means_automatic.includes('auto'));
    assert.ok(catalog.dev_old_api.includes('/api/library'));
    for (const key of ['only_httphttps_sites_can_be_registered', 'capture_sources_must_use_httphttps']) {
      assert.ok(catalog[key].includes('HTTP/HTTPS'), key);
    }
    assert.ok(catalog.json_files_must_be_5mb_or_smaller.includes('5MB'));
    assert.ok(catalog.languages_and_instructions_must_be_at_most_4000.includes('4000'));
    assert.ok(catalog.each_table_can_store_up_to_50_capture.includes('50'));
  });

  test(`${locale}: matching Chrome locale metadata`, async () => {
    const metadata = JSON.parse(await readFile(new URL(`extension/_locales/${chromeLocale}/messages.json`, root), 'utf8'));
    assert.deepEqual(Object.keys(metadata).sort(), ['appDescription', 'appName']);
    assert.equal(metadata.appName.message, 'SayItMyWay');
    assert.ok(metadata.appDescription.message.trim());
    assert.match(metadata.appDescription.message, scripts[locale]);
    assert.ok(metadata.appDescription.message.length <= 132);
    assert.notEqual(metadata.appDescription.message, 'Apply local text replacement tables to selected sites and restore the original text.');
    assert.doesNotMatch(metadata.appDescription.message, /[\uFFFD\u202A-\u202E\u2066-\u2069]/u);
  });
}
