import http from 'node:http';
import {lstat, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const locales = ['ko','en','ja','zh-Hans','zh-Hant','es','fr','de','pt-BR','ru','id','vi','th','hi','ar'];
// Only explicit bundled assets are read. Request paths never become filesystem paths.
const assets = ['tools/devtools/index.html','tools/devtools/app.js','tools/devtools/style.css',
  'extension/data/dictionary.json','extension/shared.js','extension/library.js',
  'extension/i18n.js','extension/ai-request.js', ...locales.map(locale => `extension/locales/${locale}.js`)];
async function readBundled(root, relative) {
  const filename = path.resolve(root, relative);
  let current = path.parse(filename).root;
  for (const part of filename.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw Error(`Symbolic links are not allowed: ${relative}`);
  }
  if (!(await lstat(filename)).isFile()) throw Error(`Expected bundled file: ${relative}`);
  return readFile(filename);
}
export async function startDeveloperServer({root = projectRoot, port = 4318} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid developer port');
  const files = new Map(await Promise.all(assets.map(async name => [name, await readBundled(root, name)])));
  // Real shared builder, without browser APIs, extension storage or a user library.
  const context = vm.createContext({URL, structuredClone, navigator: {language: 'ko'}});
  for (const file of [...locales.map(locale => `locales/${locale}.js`), 'i18n.js','shared.js','library.js','ai-request.js']) {
    vm.runInContext(files.get('extension/' + file).toString('utf8'), context, {filename: file});
  }
  await context.TextPatchI18n.ready;
  const builderSource = files.get('extension/ai-request.js').toString('utf8');
  const templateKeys = [...new Set([...builderSource.matchAll(/(?:i18n|TextPatchI18n)\.t\('([^']+)'/g)].map(match => match[1]))];
  const dictionary = JSON.parse(files.get('extension/data/dictionary.json'));
  const content = {languages: context.TextPatchI18n.languages, catalogs: context.TextPatchLocales,
    dictionary, templateKeys, builderSource,
    sources: {dictionary: 'extension/data/dictionary.json', builder: 'extension/ai-request.js', locale: 'extension/locales/<locale>.js'}};
  const routes = new Map([
    ['/', ['text/html; charset=utf-8', files.get('tools/devtools/index.html')]],
    ['/app.js', ['text/javascript; charset=utf-8', files.get('tools/devtools/app.js')]],
    ['/style.css', ['text/css; charset=utf-8', files.get('tools/devtools/style.css')]],
    ['/api/content', ['application/json; charset=utf-8', Buffer.from(JSON.stringify(content))]]
  ]);
  const server = http.createServer((request, response) => {
    const send = (status, type, body) => {
      response.writeHead(status, {'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
      response.end(body);
    };
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (request.headers.host !== new URL(origin).host || (request.headers.origin && request.headers.origin !== origin)) return send(403, 'text/plain', 'Forbidden');
    if (request.method !== 'GET') return send(405, 'text/plain', 'Read only');
    try {
      const url = new URL(request.url, origin);
      if (request.url.split('?')[0] !== url.pathname) return send(404, 'text/plain', 'Not found');
      if (url.pathname === '/api/prompt') {
        const locale = url.searchParams.get('locale') || 'ko';
        if (!locales.includes(locale)) throw Error('Unsupported locale');
        const sample = url.searchParams.get('sample') || 'synthetic';
        if (!['synthetic','bundled'].includes(sample)) throw Error('Unknown sample');
        // Only cloned original text; the bundled dictionary is never mutated.
        const table = sample === 'bundled'
          ? {schemaVersion: 1, name: '번들 원문 샘플 (대체문 비움)', entries: dictionary.entries.slice(0, 5).map(entry => ({...entry, ko: '', status: 'untranslated'}))}
          : {schemaVersion: 1, name: '개발용 합성 샘플', entries: [{en: 'Hello, traveler.', ko: '', status: 'untranslated'}, {en: 'Open the map', ko: '', status: 'untranslated'}]};
        const result = context.TextPatchAI.build({table, locale, task: url.searchParams.get('task') || 'translation',
          sourceLanguage: url.searchParams.get('source') ?? 'auto', targetLanguage: url.searchParams.get('target') ?? '한국어',
          instruction: url.searchParams.get('instruction') ?? '', page: {url: url.searchParams.get('site') ?? ''}});
        return send(200, 'application/json; charset=utf-8', JSON.stringify({...result, table}));
      }
      const asset = routes.get(url.pathname);
      if (!asset) return send(404, 'text/plain', 'Not found');
      send(200, ...asset);
    } catch (error) { send(400, 'application/json; charset=utf-8', JSON.stringify({error: error.message})); }
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(port, '127.0.0.1', resolve);});
  return server;
}
