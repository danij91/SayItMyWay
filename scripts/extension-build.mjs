import {lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const marker = '.crimsonmap-generated.json';
const owner = 'CrimsonMap extension build v1';

async function statIfPresent(file) {
  try { return await lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Check each component, not just the final file: a linked parent can escape root.
async function checkPath(root, relative) {
  const target = path.resolve(root, relative);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw Error(`Path escapes build root: ${relative}`);
  let current = path.resolve(root);
  for (const part of path.relative(root, target).split(path.sep)) {
    current = path.join(current, part);
    const stat = await statIfPresent(current);
    if (stat?.isSymbolicLink()) throw Error(`Refusing symbolic link: ${current}`);
  }
  return target;
}

async function sourceBytes(root, relative) {
  const file = await checkPath(root, relative);
  if (!(await lstat(file)).isFile()) throw Error(`Expected source file: ${relative}`);
  return readFile(file);
}

async function checkOwned(root, relative, kind) {
  const target = await checkPath(root, relative);
  if (!await statIfPresent(target)) return false;
  const expected = JSON.stringify({owner, kind});
  const markerPath = await checkPath(root, path.join(relative, marker));
  if (await readFile(markerPath, 'utf8').catch(() => '') !== expected) {
    throw Error(`Refusing to replace unowned output: ${target}`);
  }
  // Never recursively delete linked content, even inside an owned output.
  async function walk(relativeDir) {
    for (const entry of await readdir(path.join(root, relativeDir), {withFileTypes: true})) {
      const child = path.join(relativeDir, entry.name);
      await checkPath(root, child);
      if (entry.isDirectory()) await walk(child);
    }
  }
  await walk(relative);
  return true;
}

async function replaceGenerated(root, relative, kind, files, {renameDirectory = rename} = {}) {
  root = path.resolve(root);
  const target = await checkPath(root, relative);
  const existed = await checkOwned(root, relative, kind);
  await mkdir(path.dirname(target), {recursive: true});
  const temporary = await mkdtemp(target + '.tmp-');
  const temporaryRelative = path.relative(root, temporary);
  await writeFile(path.join(temporary, marker), JSON.stringify({owner, kind}));
  let previous;
  let published = false;
  // Windows scanners can briefly hold a generated directory open. Retry only
  // lock-like errors, with five total attempts and 375ms maximum delay per move.
  async function move(from, to) {
    for (let attempt = 0; ; attempt++) {
      // Revalidate containment, links and ownership after every wait as well.
      const fromRelative = path.relative(root, from);
      await checkPath(root, path.relative(root, to));
      if (!await checkOwned(root, fromRelative, kind)) throw Error(`Missing generated output: ${from}`);
      if (await statIfPresent(to)) throw Error(`Refusing occupied rename destination: ${to}`);
      try { return await renameDirectory(from, to); }
      catch (error) {
        if (!['EPERM', 'EBUSY'].includes(error.code) || attempt >= 4) throw error;
        await delay(25 * 2 ** attempt);
      }
    }
  }
  try {
    for (const [name, bytes] of files) {
      const destination = await checkPath(root, path.join(temporaryRelative, name));
      await mkdir(path.dirname(destination), {recursive: true});
      await writeFile(destination, bytes);
    }
    if (existed) {
      // Reserve a unique sibling name, then move the previous complete output there.
      previous = await mkdtemp(target + '.tmp-');
      await rmdir(previous); // Empty directory created by this invocation only.
      await checkOwned(root, relative, kind);
      await move(target, previous);
    }
    try { await move(temporary, target); published = true; }
    catch (error) {
      if (previous) {
        try { await move(previous, target); previous = undefined; }
        catch (rollbackError) {
          throw new AggregateError([error, rollbackError], `Publication and rollback failed; previous output retained at ${previous}`);
        }
      }
      throw error;
    }
  } finally {
    // If rollback fails, leave the last complete output for explicit recovery.
    for (const generated of [temporary, published && previous].filter(Boolean)) {
      const generatedRelative = path.relative(root, generated);
      if (await checkOwned(root, generatedRelative, kind)) await rm(generated, {recursive: true});
    }
  }
  return target;
}

// Deliberate allowlist: new production assets must be reviewed here. Unknown files,
// staging, backups and runtime data cannot enter the package by extension alone.
const productionFiles = [
  'currency-rates.js', 'currency.js', 'currency-feed.js', 'data/eurofxref-2026-10-23.xml',
  'manifest.json', 'background.js', 'content.js', 'collection.js',
  'interaction-settings.js', 'page-tools.js', 'ai-request.js', 'ai-request.css', 'ai-request-ui.js',
  'manager.js', 'manager.html', 'manager.css', 'library.js', 'site-settings.css',
  'site-list.js', 'shared.js', 'repository.js', 'popup.js', 'popup.html', 'popup.css',
  'options.js', 'options.html', 'options.css', 'i18n.js', 'engine.js',
  'editor/transport.js', 'editor/style.css', 'editor/index.html', 'editor/import.js', 'editor/app.js',
  'data/dictionary.json',
  ...['ar', 'de', 'en', 'es', 'fr', 'hi', 'id', 'ja', 'ko', 'pt-BR', 'ru', 'th', 'vi', 'zh-Hans', 'zh-Hant']
    .map(locale => `locales/${locale}.js`),
  ...['ar', 'de', 'en', 'es', 'fr', 'hi', 'id', 'ja', 'ko', 'pt_BR', 'ru', 'th', 'vi', 'zh_CN', 'zh_TW']
    .map(locale => `_locales/${locale}/messages.json`),
  ...['active', 'normal', 'warning'].flatMap(state => [
    `icons/${state}.svg`, ...[16, 32, 48, 128].map(size => `icons/${state}-${size}.png`)
  ])
].sort();

function validateManifest(files) {
  const assets = new Map(files);
  const manifest = JSON.parse(assets.get('manifest.json').toString('utf8'));
  const references = [manifest.background?.service_worker, ...(manifest.background?.scripts ?? []),
    manifest.action?.default_popup, manifest.browser_action?.default_popup,
    manifest.options_page, manifest.options_ui?.page, manifest.devtools_page,
    ...Object.values(manifest.icons ?? {}), ...Object.values(manifest.action?.default_icon ?? {}),
    ...Object.values(manifest.chrome_url_overrides ?? {}),
    ...(manifest.content_scripts ?? []).flatMap(script => [...(script.js ?? []), ...(script.css ?? [])]),
    ...(manifest.web_accessible_resources ?? []).flatMap(group => group.resources ?? [])
  ].filter(Boolean);
  if (manifest.default_locale) references.push(`_locales/${manifest.default_locale}/messages.json`);
  for (const reference of references) {
    // Fail closed for new wildcard declarations until their packaging policy is reviewed.
    if (typeof reference !== 'string' || !assets.has(reference)) {
      throw Error(`Manifest references an unpackaged asset: ${reference}`);
    }
  }
}

export async function buildExtension(root, options) {
  const files = [];
  for (const name of productionFiles) files.push([name, await sourceBytes(root, `extension/${name}`)]);
  validateManifest(files);
  return replaceGenerated(root, 'dist/extension', 'production', files, options);
}
