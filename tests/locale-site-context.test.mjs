import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import vm from 'node:vm';

const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8');
const files = (await readdir(new URL('../extension/locales/', import.meta.url))).filter(file => file.endsWith('.js'));
const context = vm.createContext({navigator:{language:'en'}});
for (const file of files) vm.runInContext(await read('extension/locales/' + file), context);
vm.runInContext(await read('extension/i18n.js'), context);
const i18n = context.TextPatchI18n, catalogs = context.TextPatchLocales;
await i18n.ready;
const newKeys = ['site_matching_settings','site_word_replacement','site_settings_saved','ai_website_url','ai_website_url_hint','ai_invalid_website_url','ai_language_auto','ai_language_choose','ai_language_custom','ai_source_language_custom','ai_target_language_custom'];
const parameters = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('all fifteen catalogs cover site and AI contracts with exact keys and parameters', async () => {
  assert.equal(files.length, 15);
  for (const key of [...newKeys, 'ai_response_language', 'ai_replacement_field']) assert.ok(Object.hasOwn(catalogs.en, key), key);
  for (const [locale, catalog] of Object.entries(catalogs)) {
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(catalogs.en).sort(), locale);
    assert.equal(catalog.text_table_patch, 'SayItMyWay', locale + ': shared product brand');
    const chromeLocale = {'zh-Hans':'zh_CN','zh-Hant':'zh_TW','pt-BR':'pt_BR'}[locale] || locale;
    const metadata = JSON.parse(await read('extension/_locales/' + chromeLocale + '/messages.json'));
    assert.equal(metadata.appName.message, 'SayItMyWay', locale + ': manifest brand');
    const declared = [...(await read('extension/locales/' + locale + '.js')).matchAll(/^  "([^"]+)":/gm)].map(match => match[1]);
    assert.equal(new Set(declared).size, declared.length, locale + ': no duplicate keys');
    for (const [key, value] of Object.entries(catalog)) {
      assert.ok(value.trim(), locale + ':' + key);
      assert.deepEqual(parameters(value), parameters(catalogs.en[key]), locale + ':' + key);
      assert.doesNotMatch(value, /\uFFFD|\?{2,}|[\u202a-\u202e\u2066-\u2069]/u);
    }
    for (const key of newKeys) if (locale !== 'en') assert.notEqual(catalog[key], catalogs.en[key], locale + ':' + key);
  }
});

test('Korean terminology consistently uses 테이블 and preserves 표시', async () => {
  for (const value of Object.values(catalogs.ko)) {
    assert.doesNotMatch(value, /대응표|(?<![가-힣])표(?!시)|테이블[를가는와]/u);
  }
  assert.equal(catalogs.ko.table_2, '테이블');
  assert.equal(catalogs.ko.replacement_off_showing_original_text, '원문 표시 중');
  assert.equal(catalogs.en.table_2, 'Table');
  const metadata = JSON.parse(await read('extension/_locales/ko/messages.json'));
  assert.equal(metadata.appName.message, 'SayItMyWay');
  assert.match(metadata.appDescription.message, /테이블을/);
});

test('unchanged validator and repository source errors still localize in every language', async () => {
  const producers = ['extension/shared.js','extension/library.js','extension/repository.js','extension/collection.js','extension/editor/import.js','server.mjs'];
  const errors = new Set();
  for (const file of producers) {
    const source = await read(file);
    for (const [, value] of source.matchAll(/(?:Error|fail)\('([^'\n]+)'/g)) {
      if (/대응표|(?<![가-힣])표(?!시)/u.test(value)) errors.add(value);
    }
  }
  assert.ok(errors.size >= 25, 'checks actual raw producer messages');
  for (const source of errors) {
    await i18n.setLocale('ko');
    const korean = i18n.message(source);
    assert.notEqual(korean, source, source);
    assert.doesNotMatch(korean, /대응표|(?<![가-힣])표(?!시)/u);
    const key = Object.keys(catalogs.ko).find(key => catalogs.ko[key] === korean);
    assert.ok(key, source + ': recognized catalog error');
    for (const locale of Object.keys(catalogs)) {
      await i18n.setLocale(locale);
      assert.equal(i18n.message(source), catalogs[locale][key], locale + ':' + source);
    }
  }
  await i18n.setLocale('ko');
  assert.equal(i18n.message('기본 대응표 읽기 실패: 대응표 형식이 올바르지 않습니다.'), '기본 테이블 읽기 실패: 테이블 형식이 올바르지 않습니다.');
  assert.equal(i18n.message('기본 대응표 읽기 실패: 404'), '기본 테이블 읽기 실패: 404');
  assert.equal(i18n.message('수집한 대응표가 삭제되었습니다.'), '수집한 테이블이 삭제되었습니다.');
  assert.equal(i18n.message('내 대응표 이름과 표시'), '내 대응표 이름과 표시');
  await i18n.setLocale('en');
  assert.equal(i18n.message('기본 대응표 읽기 실패: 404'), catalogs.en.could_not_read_the_default_table_2 + '404');
});
