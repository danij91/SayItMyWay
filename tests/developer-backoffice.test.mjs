import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,cp,rm,rmdir,symlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import http from 'node:http';
import {startDeveloperServer} from '../scripts/developer-server.mjs';
const read = file => readFile(new URL('../'+file,import.meta.url),'utf8');
const locales = ['ko','en','ja','zh-Hans','zh-Hant','es','fr','de','pt-BR','ru','id','vi','th','hi','ar'];
async function serve(t, options) {
  const server = await startDeveloperServer({port:0,...options});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  assert.equal(server.address().address,'127.0.0.1');
  return `http://127.0.0.1:${server.address().port}`;
}
test('localhost serves bundled content and real shared builder in all 15 locales for both tasks',async t=>{
  const before = await readFile(new URL('../extension/data/dictionary.json',import.meta.url));
  const base = await serve(t), content = await (await fetch(base+'/api/content')).json();
  assert.equal(Object.keys(content.languages).length,15);
  assert.deepEqual(content.dictionary,JSON.parse(before));
  assert.equal(content.builderSource,await read('extension/ai-request.js'));
  const c=vm.createContext({URL,structuredClone,navigator:{language:'ko'}});
  for(const file of [...locales.map(locale=>`locales/${locale}.js`),'i18n.js','shared.js','library.js','ai-request.js'])vm.runInContext(await read('extension/'+file),c);
  await c.TextPatchI18n.ready;
  const cases = locales.flatMap(locale=>['translation','replacement'].flatMap(task=>['synthetic','bundled'].map(sample=>({locale,task,sample}))));
  for(const {locale,task,sample} of cases){
    const params=new URLSearchParams({locale,task,sample,target:'French',instruction:'Make it concise',site:'https://example.com/path?q=secret'});
    const response=await fetch(base+'/api/prompt?'+params);assert.equal(response.status,200);
    const result=await response.json();
    const expected=c.TextPatchAI.build({table:result.table,locale,task,targetLanguage:'French',instruction:'Make it concise',page:{url:'https://example.com/path?q=secret'}});
    assert.equal(result.text,expected.text);assert.equal(result.bytes,Buffer.byteLength(result.text));
    assert.equal(result.count,sample==='synthetic'?2:5);assert.doesNotMatch(result.text,/q=secret/);
    assert.equal(c.TextPatchI18n.locale,'ko');
  }
  assert.deepEqual(await readFile(new URL('../extension/data/dictionary.json',import.meta.url)),before);
  assert.deepEqual((await (await fetch(base+'/api/content')).json()).dictionary,content.dictionary);
  assert.equal((await fetch(base+'/api/prompt?task=replacement&instruction=')).status,400);
  assert.equal((await fetch(base+'/api/prompt?locale=unknown')).status,400);
});
test('HTTP allows only explicit routes, GET and same loopback host/origin',async t=>{
  const base=await serve(t);
  for(const route of ['/data/library.json','/extension/data/library.json','/extension/background.js','/package.json','/api/content/extra','/%2e%2e%2fpackage.json','/extension/devtools/index.html']) assert.equal((await fetch(base+route)).status,404,route);
  for(const method of ['POST','PUT','DELETE','PATCH'])assert.equal((await fetch(base+'/api/content',{method})).status,405);
  assert.equal((await fetch(base+'/api/content',{headers:{Origin:'https://example.com'}})).status,403);
  const badHost=await new Promise((resolve,reject)=>{const request=http.get(base+'/api/content',{headers:{Host:'example.com'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);});
  assert.equal(badHost,403);
  const html=await fetch(base+'/');assert.match(html.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.match(await html.text(),/개발자 백오피스/);
});
test('server needs no user files or installed extension and rejects linked allowed assets or parents',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'crimson-bundled-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  for(const file of ['tools/devtools/index.html','tools/devtools/app.js','tools/devtools/style.css','extension/data/dictionary.json','extension/i18n.js','extension/shared.js','extension/library.js','extension/ai-request.js',...locales.map(l=>`extension/locales/${l}.js`)]){
    await mkdir(path.dirname(path.join(root,file)),{recursive:true});await cp(new URL('../'+file,import.meta.url),path.join(root,file));
  }
  const base=await serve(t,{root});assert.equal((await fetch(base+'/api/content')).status,200);
  const outside=path.join(root,'secret.txt');await writeFile(outside,'private');
  await rm(path.join(root,'extension/data/dictionary.json'));
  await symlink(process.platform==='win32'?path.join(root,'tools'):outside,path.join(root,'extension/data/dictionary.json'),process.platform==='win32'?'junction':'file');
  await assert.rejects(startDeveloperServer({root,port:0}),/Symbolic links/);
  await rm(path.join(root,'extension/data/dictionary.json'));
  await rmdir(path.join(root,'extension/data'));
  await symlink(path.join(root,'tools'),path.join(root,'extension/data'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(startDeveloperServer({root,port:0}),/Symbolic links/);
});



test('dev:tools entrypoint starts a standalone loopback HTTP server',async t=>{
  const {spawn}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/dev-tools.mjs',import.meta.url))],{env:{...process.env,DEVTOOLS_PORT:'0'},windowsHide:true});
  t.after(()=>{child.kill();});
  let output='';
  const base=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Server startup timed out')),5000);
    child.once('exit',code=>{clearTimeout(timeout);reject(Error('Server exited '+code));});
    child.once('error',reject);
    child.stdout.on('data',data=>{output+=data.toString('utf8');const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timeout);resolve(match[0]);}});
  });
  assert.equal((await fetch(base+'/')).status,200);
  assert.doesNotMatch(output,/chrome-extension:/);
});
