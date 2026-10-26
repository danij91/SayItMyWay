// Runs the real DOM engine in an already-open Orca browser tab, not Chrome's
// extension runtime. No site data is submitted; all changes are restored.
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const page = process.argv[2];
if (!page) throw Error('Usage: node scripts/browser-smoke.mjs <Orca browserPageId>');
function evaluate(expression) {
  const receipt = JSON.parse(execFileSync(process.env.ORCA_CLI_COMMAND || 'orca',
    ['eval', '--page', page, '--expression', expression, '--json'],
    {encoding:'utf8', maxBuffer:2_000_000, windowsHide:true}));
  if (!receipt.ok) throw Error(receipt.error?.message || 'Orca evaluation failed');
  const result = receipt.result.result;
  return typeof result === 'string' ? JSON.parse(result) : result;
}
const source = (await Promise.all(['shared.js','library.js','engine.js'].map(file =>
  readFile(new URL('../extension/'+file, import.meta.url), 'utf8')))).join('\n');
const dictionary = JSON.parse(await readFile(new URL('../extension/data/dictionary.json',import.meta.url),'utf8'));
evaluate('globalThis.__patchSmokeSource = ""; JSON.stringify(true)');
const encoded = Buffer.from(source,'utf8').toString('base64');
for(let i=0;i<encoded.length;i+=6000) evaluate(`globalThis.__patchSmokeSource += ${JSON.stringify(encoded.slice(i,i+6000))}; JSON.stringify(true)`);
evaluate('globalThis.eval(new TextDecoder().decode(Uint8Array.from(atob(globalThis.__patchSmokeSource), c=>c.charCodeAt(0)))); JSON.stringify(true)');
evaluate('globalThis.__patchSmokeSource = ""; JSON.stringify(true)');
const encodedData = Buffer.from(JSON.stringify(dictionary),'utf8').toString('base64');
for(let i=0;i<encodedData.length;i+=6000) evaluate(`globalThis.__patchSmokeSource += ${JSON.stringify(encodedData.slice(i,i+6000))}; JSON.stringify(true)`);
evaluate('globalThis.__patchSmokeTable=TextPatch.migrate(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(globalThis.__patchSmokeSource), c=>c.charCodeAt(0))))).tables[0]; JSON.stringify(true)');
const before = evaluate(`JSON.stringify({title:document.querySelector('#category-item-15095 .title')?.textContent,count:document.querySelector('#category-item-15095 .bubble')?.textContent,canvas:document.querySelectorAll('canvas').length})`);
assert.equal(before.title,'Abyss Cresset');
try {
  evaluate(`globalThis.__patchSmoke = new CrimsonTranslator(document); __patchSmoke.setData(__patchSmokeTable); JSON.stringify(true)`);
  await new Promise(resolve=>setTimeout(resolve,250));
  const result = evaluate(`JSON.stringify({title:document.querySelector('#category-item-15095 .title').textContent,count:document.querySelector('#category-item-15095 .bubble').textContent,diagnostics:__patchSmoke.diagnostics()})`);
  assert.equal(result.title,'어비스 표석');
  assert.equal(result.count,before.count);
  const capture = evaluate(`(() => {const candidates=__patchSmoke.collectCandidates(),log=__patchSmoke.getReplacementLog();return JSON.stringify({candidateCount:candidates.length,hasOriginal:candidates.includes('Abyss Cresset'),hasReplacement:candidates.includes('어비스 표석'),hasNumeric:candidates.some(s=>/^\\d+$/.test(s)),logged:log.some(row=>row.original==='Abyss Cresset' && row.replacement==='어비스 표석')});})()`);
  assert.equal(capture.hasOriginal,true);
  assert.equal(capture.hasReplacement,false);
  assert.equal(capture.hasNumeric,false);
  assert.equal(capture.logged,true);
  const click = evaluate(`(() => {const button=document.querySelector('#category-item-15095');const previous=button.className;button.click();const after=button.className;button.click();return JSON.stringify({changed:previous!==after,restored:previous===button.className});})()`);
  assert.equal(click.changed,true);
  assert.equal(click.restored,true);
  evaluate('__patchSmoke.setEnabled(false); JSON.stringify(true)');
  const restored = evaluate(`JSON.stringify({title:document.querySelector('#category-item-15095 .title').textContent,count:document.querySelector('#category-item-15095 .bubble').textContent})`);
  assert.equal(restored.title,before.title);
  assert.equal(restored.count,before.count);
  console.log(JSON.stringify({environment:'Orca browser; direct engine injection, not installed Chrome extension',before,applied:result,capture,categoryClick:click,restored},null,2));
} finally {
  evaluate('globalThis.__patchSmoke?.setEnabled(false); globalThis.__patchSmoke?.observer?.disconnect(); delete globalThis.__patchSmokeSource; JSON.stringify(true)');
}
