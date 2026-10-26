import http from 'node:http';
import {readFile, rename, copyFile, mkdir, open} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import './extension/shared.js';
import './extension/library.js';
import {appendCapture} from './server-collection.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
export async function createServer({dataPath = path.join(root,'extension/data/dictionary.json'), libraryPath = path.join(path.dirname(dataPath),'library.json')} = {}) {
  const directory=path.dirname(libraryPath);
  async function writeJSON(file,value) {
    const handle=await open(file,'wx');
    try {await handle.writeFile(JSON.stringify(value,null,2)+'\n','utf8');await handle.sync();}
    finally {await handle.close();}
  }
  // Immutable table generations become visible together through one atomic manifest swap.
  async function persist(next,previousRevision) {
    const generation='tables/'+next.revision+'-'+randomUUID();
    await mkdir(path.join(directory,generation),{recursive:true});
    const tableFiles=[];
    for(const table of next.tables){
      const file=generation+'/'+table.id+'.json';
      await writeJSON(path.join(directory,file),table);tableFiles.push(file);
    }
    const {tables,...metadata}=next;
    const temp=libraryPath+'.'+randomUUID()+'.tmp';
    await writeJSON(temp,{...metadata,storageVersion:1,tableFiles});
    if(previousRevision){
      try {await copyFile(libraryPath,libraryPath+'.rev-'+previousRevision+'.bak',1);}catch(error){if(error.code!=='EEXIST')throw error;}
      await copyFile(libraryPath,libraryPath+'.bak');
    }
    await rename(temp,libraryPath);
  }
  let data;
  try {
    const stored=JSON.parse(await readFile(libraryPath,'utf8'));
    if(stored.storageVersion===1){
      const {storageVersion,tableFiles,...metadata}=stored;
      if(!Array.isArray(tableFiles) || tableFiles.some(file=>typeof file!=='string' || !/^tables\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.json$/.test(file)))throw Error('잘못된 저장 파일 경로입니다.');
      const tables=[];
      for(const file of tableFiles)tables.push(JSON.parse(await readFile(path.join(directory,file),'utf8')));
      data=TextPatch.validateLibrary({...metadata,tables});
    }else{
      data=TextPatch.validateLibrary(stored);
      await persist(data,data.revision);
    }
  }
  catch(error) {
    if(error.code !== 'ENOENT')throw error;
    // A missing table in an existing manifest is corruption, never a fresh migration.
    try {await readFile(libraryPath);throw Error('대응표 저장 파일이 누락되었습니다. 백업을 복구하세요.');}catch(check){if(check.code!=='ENOENT')throw check;}
    data = TextPatch.migrate(JSON.parse(await readFile(dataPath,'utf8')));
    await persist(data);
  }
  let saving = false;
  const files = {...Object.fromEntries(['ko','en','ja','zh-Hans','zh-Hant','es','fr','de','pt-BR','ru','id','vi','th','hi','ar'].map(code=>['/locales/'+code+'.js','extension/locales/'+code+'.js'])),'/locales/ko.js':'extension/locales/ko.js','/locales/en.js':'extension/locales/en.js','/i18n.js':'extension/i18n.js','/':'extension/editor/index.html','/app.js':'extension/editor/app.js','/transport.js':'extension/editor/transport.js','/prompt.js':'backoffice/prompt.js','/import.js':'extension/editor/import.js','/import-ui.js':'extension/import-ui.js','/style.css':'extension/editor/style.css','/shared.js':'extension/shared.js','/library.js':'extension/library.js','/ai-request.js':'extension/ai-request.js','/ai-request-ui.js':'extension/ai-request-ui.js','/ai-request.css':'extension/ai-request.css'};
  return http.createServer(async (req,res) => {
    const json = (status,value) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value));};
    try {
      const localPort = req.socket.localPort;
      const hosts = [`127.0.0.1:${localPort}`, `localhost:${localPort}`];
      if (!hosts.includes(req.headers.host)) return json(403,{error:'로컬 Host만 허용합니다.'});
      const url = new URL(req.url,`http://${req.headers.host}`);
      if (req.method === 'GET' && url.pathname === '/api/dictionary') return json(200,data.tables.find(t=>t.id==='crimson-desert'));
      if (req.method === 'PUT' && url.pathname === '/api/dictionary') return json(410,{error:'범용 버전에서는 /api/library와 백오피스를 사용하세요. 기존 원본 파일은 보존됩니다.'});
      if (req.method === 'GET' && url.pathname === '/api/library') return json(200,data);
      if (req.method === 'POST' && url.pathname === '/api/capture') {
        // MV3 worker fetch can omit Origin. The non-simple header prevents web pages
        // from sending this request without a preflight, which this server rejects.
        const origin=req.headers.origin;
        if (req.headers['content-type'] !== 'application/json' || req.headers['x-text-patch-client'] !== 'extension' ||
            (origin !== undefined && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin))) return json(403,{error:'확장 프로그램에서만 수집할 수 있습니다.'});
        if (saving) return json(409,{error:'저장 중입니다. 다시 시도하세요.'});
        saving=true;
        try {
          const chunks=[];let bytes=0;
          for await (const chunk of req) {chunks.push(chunk);bytes+=chunk.length;if(bytes>5_000_000)return json(413,{error:'파일이 너무 큽니다.'});}
          const {changed,...result}=appendCapture(data,JSON.parse(Buffer.concat(chunks).toString('utf8')));
          if(changed){await persist(result.library,data.revision);data=result.library;}
          return json(200,result);
        } finally {saving=false;}
      }
      if (req.method === 'PUT' && url.pathname === '/api/library') {
        if (req.headers.origin !== `http://${req.headers.host}` || req.headers['content-type'] !== 'application/json') return json(403,{error:'백오피스에서만 저장할 수 있습니다.'});
        if (saving) return json(409,{error:'저장 중입니다. 다시 시도하세요.'});
        saving = true;
        try {
          const chunks=[];let bytes=0;
          for await (const chunk of req) { chunks.push(chunk); bytes+=chunk.length; if (bytes > 5_000_000) return json(413,{error:'파일이 너무 큽니다.'}); }
          const next = TextPatch.validateLibrary(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          if (next.revision !== data.revision) return json(409,{error:'다른 창에서 변경되었습니다. 목록을 다시 불러오세요.'});
          next.revision = data.revision + 1;
          next.updatedAt = new Date().toISOString();
          if(data.tables.some(t=>t.id==='crimson-desert') && !next.tables.some(t=>t.id==='crimson-desert'))return json(400,{error:'기본 붉은사막 대응표는 삭제할 수 없습니다. 새 표를 추가하거나 복사하세요.'});
          for(const table of next.tables){
            const old=data.tables.find(t=>t.id===table.id);
            table.revision=old ? old.revision+(JSON.stringify({...table,revision:old.revision})!==JSON.stringify(old)?1:0) : 1;
          }
          await persist(next,data.revision);
          data = next;
          return json(200,data);
        } finally { saving = false; }
      }
      if (req.method !== 'GET' || !files[url.pathname]) return json(404,{error:'찾을 수 없습니다.'});
      const file = files[url.pathname];
      const content = await readFile(path.join(root,file));
      const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
      const ancestors=url.pathname==='/' && url.searchParams.get('embedded')==='1' ? 'chrome-extension:' : "'none'";
      res.writeHead(200,{'Content-Type':type+'; charset=utf-8','X-Content-Type-Options':'nosniff','Content-Security-Policy':`default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors ${ancestors}`}); res.end(content);
    } catch(error) { json(400,{error:error.message}); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createServer();
  server.on('error', error => {console.error(`서버 시작 실패: ${error.message}`); process.exitCode = 1;});
  server.listen(4317,'127.0.0.1',() => console.log('백오피스: http://127.0.0.1:4317 (종료: Ctrl+C)'));
}
