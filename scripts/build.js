import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'dist');
fs.mkdirSync(path.join(out,'recorder'),{recursive:true});
for(const file of ['index.html','style.css','icon.svg','app.js','model.js','paint.js','export.js','example.js'])fs.copyFileSync(path.join(root,file),path.join(out,file));
fs.copyFileSync(path.join(root,'recorder/render_proxy.lua'),path.join(out,'recorder/render_proxy.lua'));
fs.writeFileSync(path.join(out,'.nojekyll'),'');
console.log('Built static viewer; no private captures or user files included.');
