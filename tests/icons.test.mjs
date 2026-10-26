import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inflateSync} from 'node:zlib';
const root=new URL('../extension/',import.meta.url);

test('manifest supplies all normal app and action icons with only approved runtime permissions',async()=>{
 const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
 const expected={'16':'icons/normal-16.png','32':'icons/normal-32.png','48':'icons/normal-48.png','128':'icons/normal-128.png'};
 assert.deepEqual(manifest.icons,expected);assert.deepEqual(manifest.action.default_icon,expected);
 assert.deepEqual(manifest.permissions,['storage','scripting','activeTab','alarms']);
 assert.deepEqual(manifest.host_permissions,['https://www.ecb.europa.eu/*']);
});

test('every variant is a valid transparent PNG at each Chrome size with distinct pixels and an original vector source',async()=>{
 const outputs=new Map();
 for(const variant of ['normal','active','warning']){
  const svg=await readFile(new URL(`icons/${variant}.svg`,root),'utf8');
  assert.match(svg,/viewBox="0 0 128 128"/);assert.doesNotMatch(svg,/<text|<script|<image/);
  for(const size of [16,32,48,128]){
   const png=await readFile(new URL(`icons/${variant}-${size}.png`,root));
   assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
   assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);
   assert.equal(png[24],8);assert.equal(png[25],6); // RGBA8
   const chunks=[];let end=false;
   for(let offset=8;offset<png.length;){
    const length=png.readUInt32BE(offset),type=png.toString('ascii',offset+4,offset+8);
    assert.ok(offset+length+12<=png.length);
    if(type==='IDAT')chunks.push(png.subarray(offset+8,offset+8+length));
    if(type==='IEND')end=true;
    offset+=length+12;
   }
   assert.equal(end,true);
   const pixels=inflateSync(Buffer.concat(chunks));assert.equal(pixels.length,size*(size*4+1));
   // The transparent canvas corner stays transparent even with filtered PNG rows.
   assert.equal(pixels[4],0);
   outputs.set(variant+'-'+size,pixels);
  }
 }
 for(const size of [16,32,48,128]){
  assert.notDeepEqual(outputs.get('normal-'+size),outputs.get('active-'+size));
  assert.notDeepEqual(outputs.get('active-'+size),outputs.get('warning-'+size));
 }
});
