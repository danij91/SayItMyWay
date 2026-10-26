import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm, cp, readdir, symlink, rename} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {buildExtension} from '../scripts/extension-build.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'crimson-packaging-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(path.join(root, 'extension'), {recursive: true});
  await cp(new URL('../extension/', import.meta.url), path.join(root, 'extension'), {recursive: true});
  await writeFile(path.join(root, 'extension/popup.js'), 'original popup.js');
  await writeFile(path.join(root, 'extension/popup.html'), 'original popup.html');
  return root;
}

test('generated replacement retries transient locks while moving old and publishing new output', async t => {
  const root = await fixture(t);
  await cp(new URL('../extension/', import.meta.url), path.join(root, 'extension'), {recursive: true});
  const output = await buildExtension(root);
  const attempts = new Map();
  await buildExtension(root, {renameDirectory: async (from, to) => {
    const phase = from === output ? 'backup' : 'publish';
    const count = (attempts.get(phase) ?? 0) + 1;
    attempts.set(phase, count);
    if (count <= 2) throw Object.assign(Error('transient lock'), {code: count === 1 ? 'EPERM' : 'EBUSY'});
    await rename(from, to);
  }});
  assert.deepEqual([...attempts], [['backup', 3], ['publish', 3]]);
  assert.deepEqual(await readdir(path.join(root, 'dist')), ['extension']);
  await assert.rejects(readFile(path.join(output, 'data/dictionary.json')), {code: 'ENOENT'});
});

test('persistent publication locks stop after five attempts and rollback retries transient locks', async t => {
  const root = await fixture(t);
  const output = await buildExtension(root);
  await writeFile(path.join(root, 'extension/popup.js'), 'updated');
  const attempts = {backup: 0, publish: 0, rollback: 0};
  const publicationError = Object.assign(Error('persistent publication lock'), {code: 'EPERM'});
  await assert.rejects(buildExtension(root, {renameDirectory: async (from, to) => {
    const phase = from === output ? 'backup' : attempts.publish === 5 ? 'rollback' : 'publish';
    attempts[phase]++;
    if (phase === 'publish') throw publicationError;
    if (phase === 'rollback' && attempts.rollback <= 2) throw Object.assign(Error('rollback lock'), {code: 'EBUSY'});
    await rename(from, to);
  }}), error => error === publicationError);
  assert.deepEqual(attempts, {backup: 1, publish: 5, rollback: 3});
  assert.equal(await readFile(path.join(output, 'popup.js'), 'utf8'), 'original popup.js');
  assert.deepEqual(await readdir(path.join(root, 'dist')), ['extension']);
});

test('persistent backup locks preserve the existing output without publishing', async t => {
  const root = await fixture(t);
  const output = await buildExtension(root);
  let attempts = 0;
  await assert.rejects(buildExtension(root, {renameDirectory: async from => {
    assert.equal(from, output);
    attempts++;
    throw Object.assign(Error('backup lock'), {code: 'EBUSY'});
  }}), {code: 'EBUSY'});
  assert.equal(attempts, 5);
  assert.equal(await readFile(path.join(output, 'popup.js'), 'utf8'), 'original popup.js');
  assert.deepEqual(await readdir(path.join(root, 'dist')), ['extension']);
});

test('non-transient publication and rollback errors are not retried and retain the last output', async t => {
  const root = await fixture(t);
  const output = await buildExtension(root);
  let attempts = 0;
  let backup;
  const failure = Object.assign(Error('I/O failure'), {code: 'EIO'});
  await assert.rejects(buildExtension(root, {renameDirectory: async (from, to) => {
    attempts++;
    if (from === output) { backup = to; return rename(from, to); }
    throw failure;
  }}), error => error instanceof AggregateError && error.errors.every(item => item === failure)
    && error.message.includes(backup));
  assert.equal(attempts, 3);
  assert.equal(await readFile(path.join(backup, 'popup.js'), 'utf8'), 'original popup.js');
  assert.deepEqual(await readdir(path.join(root, 'dist')), [path.basename(backup)]);
});

test('retry revalidates output ownership before another rename attempt', async t => {
  const root = await fixture(t);
  const output = await buildExtension(root);
  let attempts = 0;
  await assert.rejects(buildExtension(root, {renameDirectory: async from => {
    attempts++;
    await writeFile(path.join(from, '.crimsonmap-generated.json'), 'changed owner');
    throw Object.assign(Error('transient lock'), {code: 'EPERM'});
  }}), /unowned output/);
  assert.equal(attempts, 1);
  assert.equal(await readFile(path.join(output, 'popup.js'), 'utf8'), 'original popup.js');
  assert.deepEqual(await readdir(path.join(root, 'dist')), ['extension']);
});

test('persistent rollback locks exhaust their budget and preserve the backup', async t => {
  const root = await fixture(t);
  const output = await buildExtension(root);
  let backup;
  let rollbackAttempts = 0;
  await assert.rejects(buildExtension(root, {renameDirectory: async (from, to) => {
    if (from === output) { backup = to; return rename(from, to); }
    if (from === backup) {
      rollbackAttempts++;
      throw Object.assign(Error('persistent rollback lock'), {code: 'EBUSY'});
    }
    throw Object.assign(Error('publication failure'), {code: 'EIO'});
  }}), error => error instanceof AggregateError
    && error.errors[0].code === 'EIO' && error.errors[1].code === 'EBUSY');
  assert.equal(rollbackAttempts, 5);
  assert.equal(await readFile(path.join(backup, 'popup.js'), 'utf8'), 'original popup.js');
  assert.deepEqual(await readdir(path.join(root, 'dist')), [path.basename(backup)]);
});

test('build validates every source before replacing a prior output', async t => {
  const root = await fixture(t);
  await buildExtension(root);
  await writeFile(path.join(root, 'extension/popup.html'), 'changed');
  await rm(path.join(root, 'extension/popup.css'));
  await assert.rejects(buildExtension(root), /popup.css/);
  assert.equal(await readFile(path.join(root, 'dist/extension/popup.html'), 'utf8'), 'original popup.html');
});

test('production package excludes private and development files and preserves production bytes', async t => {
  const root = await fixture(t);
  await cp(new URL('../extension/', import.meta.url), path.join(root, 'extension'), {recursive: true});
  const privateFiles = ['data/examples/crimson-desert.json', 'devtools/index.html', 'data/library.json', 'data/tables/private.json', 'data/dictionary.json.bak',
    'data/private.tmp', 'layout-fit.js', 'private.js', 'editor/app.backup.js', 'locales/en.bak.js',
    'icons/private.png', 'editor/private.html', 'README.md'];
  for (const name of privateFiles) {
    const file = path.join(root, 'extension', name);
    await mkdir(path.dirname(file), {recursive: true});
    await writeFile(file, 'private');
  }
  await buildExtension(root);
  const output = await buildExtension(root);
  async function list(dir, prefix = '') {
    const files = [];
    for (const item of await readdir(dir, {withFileTypes: true})) {
      const relative = prefix + item.name;
      if (item.isDirectory()) files.push(...await list(path.join(dir, item.name), relative + '/'));
      else files.push(relative);
    }
    return files.sort();
  }
  const before = await list(output);
  for (const name of [...privateFiles, 'data/dictionary.json']) assert.ok(!before.includes(name), name);
  assert.deepEqual(before.filter(name => name.startsWith('data/')), ['data/eurofxref-2026-10-23.xml']);
  assert.ok(!before.some(name => name.startsWith('devtools/')));
  for (const name of ['manifest.json', 'manager.html', 'manager.js', 'manager.css',
    'interaction-settings.js', 'locales/ko.js', '_locales/en/messages.json', 'icons/normal-16.png', 'editor/app.js']) {
    assert.deepEqual(await readFile(path.join(output, name)), await readFile(path.join(root, 'extension', name)), name);
  }
  const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json')));
  for (const reference of [manifest.background.service_worker, manifest.action.default_popup,
    manifest.options_ui.page, ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)]) {
    assert.ok(before.includes(reference), reference);
  }
  assert.equal(await buildExtension(root), output);
  assert.deepEqual(await list(output), before);
  assert.equal(await readFile(path.join(root, 'extension/data/library.json'), 'utf8'), 'private');
});

test('production refresh is repeatable and removes obsolete generated files', async t => {
  const root = await fixture(t);
  const output = await buildExtension(root);
  await writeFile(path.join(output, 'obsolete.js'), 'obsolete');
  await writeFile(path.join(output, 'data/dictionary.json'), 'obsolete seed');
  await writeFile(path.join(root, 'extension/popup.js'), 'updated');
  assert.equal(await buildExtension(root), output);
  assert.equal(await readFile(path.join(output, 'popup.js'), 'utf8'), 'updated');
  await assert.rejects(readFile(path.join(output, 'obsolete.js')), {code: 'ENOENT'});
  await assert.rejects(readFile(path.join(output, 'data/dictionary.json')), {code: 'ENOENT'});
  await buildExtension(root);
  assert.equal(await readFile(path.join(output, 'popup.js'), 'utf8'), 'updated');
});

test('unowned destinations are never overwritten', async t => {
  const root = await fixture(t);
  await mkdir(path.join(root, 'dist/extension'), {recursive: true});
  await writeFile(path.join(root, 'dist/extension/keep.txt'), 'user owned');
  await assert.rejects(buildExtension(root), /unowned output/);
  assert.equal(await readFile(path.join(root, 'dist/extension/keep.txt'), 'utf8'), 'user owned');
});

test('manifest references fail closed before replacing the last valid build', async t => {
  const root = await fixture(t);
  await cp(new URL('../extension/', import.meta.url), path.join(root, 'extension'), {recursive: true});
  const output = await buildExtension(root);
  const original = await readFile(path.join(output, 'manifest.json'));
  const manifest = JSON.parse(original);
  manifest.action.default_popup = 'devtools/index.html';
  await writeFile(path.join(root, 'extension/manifest.json'), JSON.stringify(manifest));
  await assert.rejects(buildExtension(root), /unpackaged asset: devtools\/index.html/);
  assert.deepEqual(await readFile(path.join(output, 'manifest.json')), original);
  assert.deepEqual(await readdir(path.join(root, 'dist')), ['extension']);
});

test('missing sources on first build create no output', async t => {
  const root = await fixture(t);
  await rm(path.join(root, 'extension/popup.js'));
  await assert.rejects(buildExtension(root), /popup.js/);
  await assert.rejects(readFile(path.join(root, 'dist/extension/manifest.json')), {code: 'ENOENT'});
});

test('linked output parents and linked children cannot escape controlled generated directories', async t => {
  const root = await fixture(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'crimson-outside-'));
  t.after(() => rm(outside, {recursive: true, force: true}));
  await writeFile(path.join(outside, 'keep.txt'), 'private');
  await cp(new URL('../extension/', import.meta.url), path.join(root, 'extension'), {recursive: true});
  await symlink(outside, path.join(root, 'dist'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(buildExtension(root), /symbolic link/);
  assert.equal(await readFile(path.join(outside, 'keep.txt'), 'utf8'), 'private');
});


test('linked children inside previous production output prevent replacement', async t => {
  const root = await fixture(t);
  const output = await buildExtension(root);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'crimson-private-'));
  t.after(() => rm(outside, {recursive: true, force: true}));
  await writeFile(path.join(outside, 'keep.txt'), 'private');
  await symlink(outside, path.join(output, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(buildExtension(root), /symbolic link/);
  assert.equal(await readFile(path.join(outside, 'keep.txt'), 'utf8'), 'private');
});
