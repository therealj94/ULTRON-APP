import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const assets=fileURLToPath(new URL('../assets/',import.meta.url));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const config=JSON.parse(await fs.readFile(path.join(assets,'model-parts.json'),'utf8'));
for(const model of config.models){
 if(path.basename(model.file)!==model.file)throw Error('Invalid model filename');
 const output=path.join(assets,model.file);
 try{const existing=await fs.readFile(output);if(existing.length!==model.bytes||hash(existing)!==model.sha256)throw Error(`${model.file} already exists with different content; preserve or move your edited model before restoring.`);console.log(`${model.file}: verified, already present`);continue;}catch(e){if(e.code!=='ENOENT')throw e;}
 const chunks=[];
 for(const part of model.parts){
  if(path.basename(part.file)!==part.file)throw Error('Invalid part filename');
  const bytes=await fs.readFile(path.join(assets,'model-parts',part.file));
  if(bytes.length!==part.bytes||hash(bytes)!==part.sha256)throw Error(`Corrupt or missing part: ${part.file}`);
  chunks.push(bytes);
 }
 const glb=Buffer.concat(chunks);
 if(glb.length!==model.bytes||hash(glb)!==model.sha256||glb.toString('ascii',0,4)!=='glTF'||glb.readUInt32LE(8)!==glb.length)throw Error(`Model integrity failed: ${model.file}`);
 await fs.writeFile(output,glb,{flag:'wx'});console.log(`${model.file}: restored and verified (${glb.length} bytes)`);
}
