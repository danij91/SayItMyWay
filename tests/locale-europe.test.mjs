import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const locales = ['es', 'fr', 'de', 'pt-BR', 'ru'];
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const parameters = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

// R1 owns en.js. These seven agreed additions allow this isolated worktree to
// validate before or after R1 is integrated, without weakening the 305-key base.
const additions = {
  collection_counts: '{total} collected · {additional} added',
  collection_pending: 'Save failed. Unsaved text retained: {count}.',
  active_replacement_count: 'Active · Replacements: {count}',
  imported_table_count: 'Imported table drafts: {count}. Save changes at the top.',
  entry_counts: 'Total: {total} · Not written: {untranslated} · In review: {review} · Verified: {verified}',
  collection_activity: 'Collecting more',
  collection_deleted: 'The collected table was deleted.'
};

function evaluate(source, filename) {
  const context = vm.createContext({});
  new vm.Script(source, {filename}).runInContext(context, {timeout: 1000});
  return context;
}

const english = evaluate(await read('extension/locales/en.js'), 'en.js').TextPatchLocales.en;
const expected = {...english, ...additions};
assert.equal(Object.keys(expected).length, Object.keys(english).length, 'all agreed additions are integrated');

// Exact English equality is permitted only for a brand, placeholders, and
// independently valid target-language cognates. This is not a fallback list.
const identical = {
  es: ['inline_original', 'total', 'text_table_patch', 'general', 'total_p0', 'p0_p1'],
  fr: ['inline_original', 'inline_table', 'total', 'text_table_patch', 'notes', 'site', 'total_p0', 'p0_p1', 'table_to_use'],
  de: ['inline_original', 'text_table_patch', 'name', 'status', 'p0_p1'],
  'pt-BR': ['inline_original', 'total', 'text_table_patch', 'site', 'total_p0', 'p0_p1'],
  ru: ['text_table_patch', 'p0_p1']
};

for (const locale of locales) {
  const path = `extension/locales/${locale}.js`;
  const source = await read(path);
  const context = evaluate(source, path);
  const catalog = context.TextPatchLocales[locale];

  test(`${locale}: standalone syntax, exact key coverage, no fallback dependency`, () => {
    assert.deepEqual(Object.keys(context), ['TextPatchLocales']);
    assert.deepEqual(Object.keys(context.TextPatchLocales), [locale]);
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(expected).sort());
    assert.equal([...source.matchAll(/^  "[^"]+":/gm)].length, Object.keys(expected).length, 'no duplicate key definitions');
    assert.doesNotMatch(source, /\.\.\.|TextPatchLocales\.en|\brequire\s*\(|\bimport\s/);
  });

  test(`${locale}: every value is UTF-8 text with exact parameters and fragment boundaries`, () => {
    for (const [key, value] of Object.entries(catalog)) {
      assert.equal(typeof value, 'string', key);
      assert.ok(value.trim(), key);
      assert.doesNotMatch(value, /\uFFFD|\?{2,}|[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u, key);
      assert.deepEqual(parameters(value), parameters(expected[key]), key);
      assert.equal(value.startsWith(' '), expected[key].startsWith(' '), `${key}: leading separator space`);
      assert.equal(value.endsWith(' '), expected[key].endsWith(' '), `${key}: trailing separator space`);
      // Interpolate every message using data containing braces, markup and mixed scripts.
      const params = Object.fromEntries(parameters(value).map(name => [name, `<${name}> العربية 한국어 {data}`]));
      const rendered = value.replace(/\{(\w+)\}/g, (_, name) => params[name]);
      for (const name of parameters(value)) assert.ok(rendered.includes(params[name]), key);
    }
    assert.match(catalog.collection_complete, /^✓ /u, 'Unicode check mark survived writing');
    assert.match(catalog.additional, / · /u, 'Unicode separator survived writing');
    assert.match(catalog.json_data_start, /^--- .+ JSON(?:[- ].+)? ---$/u);
    assert.match(catalog.json_data_end, /^--- .+ JSON(?:[- ].+)? ---$/u);
    if (locale === 'ru') assert.match(catalog.collection_complete, /[А-Яа-яЁё]/u);
    else assert.match(Object.values(catalog).join(''), /[à-ÿ]/u);
  });

  test(`${locale}: English equality is restricted to documented cognates and literals`, () => {
    assert.deepEqual(
      Object.keys(expected).filter(key => catalog[key] === expected[key]).sort(),
      [...identical[locale]].sort()
    );
  });

  test(`${locale}: AI and verification instructions preserve schema literals`, () => {
    const portable = catalog.return_a_portable_table_json_object_with_formattextpatchtable;
    for (const literal of ['format:"text-patch-table"', 'version:2', 'defaults', 'captureSources', 'original', 'source/evidence/notes']) {
      assert.ok(portable.includes(literal), literal);
    }
    const proposal = catalog.only_propose_text_for_empty_ko_fields_in;
    for (const literal of ['replacement', 'entries', 'status review', 'status untranslated', 'verified', 'replacement/status/source/evidence/notes', 'JSON']) {
      assert.ok(proposal.includes(literal), literal);
    }
    for (const key of ['verified_game_terms_need_an_official_source_url', 'game_terms_need_an_official_https_source_or']) {
      assert.ok(catalog[key].includes('사용자 확인:'), key);
    }
    assert.ok(catalog.auto_detects_the_source_language_you_can_enter.includes('auto'));
    assert.ok(catalog.translation_task_source_language_p0_auto_means_automatic.includes('auto'));
    assert.ok(catalog.dev_old_api.includes('/api/library'));
    assert.ok(catalog.capture_sources_must_use_httphttps.includes('HTTP/HTTPS'));
    assert.ok(catalog.game_terms_need_an_official_https_source_or.includes('HTTPS'));
    assert.ok(catalog.scope_css_selector_optional.includes('CSS'));
    assert.ok(catalog.scan_limit.includes('DOM'));
  });

  test(`${locale}: Chrome metadata is valid, localized and within manifest limits`, async () => {
    const folder = locale === 'pt-BR' ? 'pt_BR' : locale;
    const metadata = JSON.parse(await read(`extension/_locales/${folder}/messages.json`));
    assert.deepEqual(Object.keys(metadata).sort(), ['appDescription', 'appName']);
    assert.equal(metadata.appName.message, 'SayItMyWay', 'shared product brand');
    const description = metadata.appDescription.message;
    assert.equal(typeof description, 'string');
    assert.ok(description.length > 20 && description.length <= 132);
    assert.notEqual(description, 'Apply local text replacement tables to selected sites and restore the original text.');
    assert.doesNotMatch(description, /\uFFFD|\?/u);
    assert.match(description, locale === 'ru' ? /[А-Яа-яЁё]/u : /[à-ÿ]/u);
  });
}
