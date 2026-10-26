// npm install --prefix <tool-dir> --no-audit --no-fund @resvg/resvg-js@2.6.2
// ICON_RASTERIZER_MODULE=<tool-dir>/node_modules/@resvg/resvg-js/index.js node scripts/generate-icons.mjs
// Default tool-dir: OS temporary directory/crimson-icons. No runtime dependency.
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const modulePath=process.env.ICON_RASTERIZER_MODULE || path.join(os.tmpdir(),'crimson-icons/node_modules/@resvg/resvg-js/index.js');
const {Resvg}=require(modulePath);
const version=require(path.join(path.dirname(modulePath),'package.json')).version;
if(version!=='2.6.2')throw Error('Use @resvg/resvg-js 2.6.2 for reproducible assets');
const dir=fileURLToPath(new URL('../extension/icons/',import.meta.url));
const variants=['normal','active','warning'],sizes=[16,32,48,128];
const render=(svg,width)=>new Resvg(svg,{fitTo:{mode:'width',value:width},font:{loadSystemFonts:false}}).render().asPng();
let sheet='<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720" viewBox="0 0 720 720"><rect width="720" height="720" fill="#eef2f7"/>';
for(const [row,name] of variants.entries()){
  const svg=await readFile(path.join(dir,name+'.svg'),'utf8');
  for(const [column,size] of sizes.entries()){
    const png=render(svg,size);
    await writeFile(path.join(dir,`${name}-${size}.png`),png);
    // Enlarged raster plus native toolbar previews on light and dark surfaces.
    const x=column*180,y=row*240;
    sheet+=`<rect x="${x+6}" y="${y+6}" width="168" height="228" rx="8" fill="${row===2?'#fff4d9':'#fff'}"/>`;
    sheet+=`<image x="${x+26}" y="${y+14}" width="128" height="128" href="data:image/png;base64,${png.toString('base64')}"/>`;
    sheet+=`<rect x="${x+8}" y="${y+181}" width="164" height="34" rx="6" fill="#202632"/>`;
    const native=Math.min(size,28);
    sheet+=`<image x="${x+18}" y="${y+184}" width="${native}" height="${native}" href="data:image/png;base64,${png.toString('base64')}"/>`;
    sheet+=`<image x="${x+18}" y="${y+149}" width="${native}" height="${native}" href="data:image/png;base64,${png.toString('base64')}"/>`;
    // Numeric labels built as SVG paths avoid machine-dependent font rendering.
    const digits={1:'M3 0v10',2:'M0 0h6v5H0v5h6',3:'M0 0h6v10H0m0-5h6',4:'M0 0v5h6m0-5v10',6:'M6 0H0v10h6V5H0',8:'M0 0h6v10H0zm0 5h6'};
    for(const [i,digit] of String(size).split('').entries())sheet+=`<path d="${digits[digit]}" transform="translate(${x+102+i*10} ${y+193})" fill="none" stroke="#fff" stroke-width="1.5"/>`;
  }
}
sheet+='</svg>';
await writeFile(path.join(dir,'contact-sheet.svg'),sheet);
await writeFile(path.join(dir,'contact-sheet.png'),render(sheet,720));
console.log('Generated 12 PNGs and contact sheet with resvg '+version+'; rows: normal, active, warning; columns: 16, 32, 48, 128.');
