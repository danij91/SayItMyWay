import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {copyNativeExtension} from './native-fixture.mjs';

test('native extension copy excludes user manifests, split tables and backups before copying',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'native-copy-'));
  try{
    const source=path.join(dir,'source'),destination=path.join(dir,'extension');
    await mkdir(path.join(source,'data/tables/private'),{recursive:true});
    for(const [file,body] of [['manifest.json','packaged code'],['data/dictionary.json','tracked seed'],['data/library.json','private manifest'],['data/tables/private/table.json','private table'],['data/dictionary.json.bak','private backup']])await writeFile(path.join(source,file),body);
    await copyNativeExtension(destination,source);
    assert.deepEqual(await readdir(path.join(destination,'data')),[]);
    assert.equal(await readFile(path.join(destination,'manifest.json'),'utf8'),'packaged code');
    await assert.rejects(readFile(path.join(destination,'data/dictionary.json')),{code:'ENOENT'});
    assert.equal(await readFile(path.join(source,'data/dictionary.json'),'utf8'),'tracked seed');
    assert.equal(await readFile(path.join(source,'data/library.json'),'utf8'),'private manifest');
    assert.equal(await readFile(path.join(source,'data/tables/private/table.json'),'utf8'),'private table');
  }finally{await rm(dir,{recursive:true,force:true});}
});
