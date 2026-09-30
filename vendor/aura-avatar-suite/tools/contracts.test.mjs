import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {applyAvatarMessage} from '../src/protocol.js';
import {visemeAt} from '../src/audio.js';
import {ARKIT_52,VISEMAS,MORPHS,EXPRESIONES,CLIPS,CLIPS_BASE,CLIPS_GESTO,ZONAS,CAMARAS} from '../src/kit/nombres.js';

const RAIZ=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const MOBILE=path.join(RAIZ,'../../mobile/src/avatar3d');
const fake=()=>({calls:[],setState(...x){this.calls.push(['state',...x]);},setEmotion(...x){this.calls.push(['emotion',...x]);},lookAt(...x){this.calls.push(['gaze',...x]);},setSpeech(...x){this.calls.push(['speech',...x]);},playGesture(...x){this.calls.push(['gesture',...x]);}});

test('host messages preserve positive-down gaze, clamp inputs, and close mouth immediately',()=>{const a=fake();assert(applyAvatarMessage(a,{tipo:'mirar',x:4,y:-3,activa:true}));assert.deepEqual(a.calls.pop(),['gaze',1,-1]);applyAvatarMessage(a,{tipo:'boca',n:9,visema:'O'});assert.deepEqual(a.calls.pop(),['speech',1,'O']);applyAvatarMessage(a,{tipo:'boca',n:0});assert.deepEqual(a.calls.pop(),['speech',0,'A']);assert.equal(applyAvatarMessage(a,{tipo:'boca',n:NaN}),false);});
test('unknown tasks cannot pretend success; unsupported seating is explicit',()=>{const a=fake();assert.equal(applyAvatarMessage(a,{tipo:'tarea',tarea:'desconocida'}),false);assert.equal(applyAvatarMessage(a,{tipo:'tarea',tarea:'__proto__'}),false);assert.equal(a.calls.length,0);assert.equal(applyAvatarMessage(a,{tipo:'postura',p:'sentada'}),false);assert.equal(applyAvatarMessage(a,{tipo:'tarea',tarea:'buscar'}),true);assert.deepEqual(a.calls.pop(),['gesture','lentes']);});
test('character alignment uses real playback time and closes in silence',()=>{const a={characters:['p','ó','e'],character_start_times_seconds:[0,.15,.4],character_end_times_seconds:[.12,.3,.55]};assert.equal(visemeAt(a,.04),'MBP');assert.equal(visemeAt(a,.2),'O');assert.equal(visemeAt(a,.35),'sil');assert.equal(visemeAt(a,.44),'E');assert.equal(visemeAt(a,2),'sil');});
test('el puente acepta las caras y gestos nuevos del vocabulario común',()=>{const a=fake();assert(applyAvatarMessage(a,{tipo:'gesto',nombre:'toque_mejilla'}));assert.deepEqual(a.calls.pop(),['gesture','toque_mejilla']);assert(applyAvatarMessage(a,{tipo:'estado',face:'IDLE',emocion:'timida'}));assert.deepEqual(a.calls.pop(),['emotion','timida',1]);});

/* ── el vocabulario es el mismo que el de la app (mobile/src/avatar3d) ─────────────────────── */
const lista=(txt,nombre)=>{const m=txt.match(new RegExp(nombre+'\\s*=\\s*\\[([\\s\\S]*?)\\]'));assert(m,'no encontré '+nombre);return [...m[1].matchAll(/'([^']+)'/g)].map(x=>x[1]);};
test('nombres.js coincide con mapeo.ts y tipos.ts de la app',{skip:!fs.existsSync(MOBILE)&&'la app no está junto a este paquete'},()=>{
 const mapeo=fs.readFileSync(path.join(MOBILE,'mapeo.ts'),'utf8'),tipos=fs.readFileSync(path.join(MOBILE,'tipos.ts'),'utf8');
 assert.deepEqual(ARKIT_52,lista(mapeo,'ARKIT_52'));assert.deepEqual(VISEMAS,lista(tipos,'VISEMAS'));
 assert.deepEqual(Object.keys(EXPRESIONES),lista(tipos,'EXPRESIONES_AVATAR'));
 assert.deepEqual(CLIPS_GESTO,lista(tipos,'GESTOS_AVATAR'));assert.deepEqual(CLIPS_BASE,lista(tipos,'BASES_AVATAR'));
});

/* ── contrato de los GLB móviles (lectura directa del JSON del GLB) ─────────────────────────── */
const HUESOS=['hips','spine','chest','neck','head','leftUpperArm','leftLowerArm','leftHand','rightUpperArm','rightLowerArm','rightHand','leftUpperLeg','leftLowerLeg','leftFoot','rightUpperLeg','rightLowerLeg','rightFoot','leftEye','rightEye','jaw','upperChest','leftShoulder','rightShoulder','leftToes','rightToes'];
const PROHIBIDAS=['KHR_draco_mesh_compression','KHR_texture_basisu','KHR_materials_transmission','KHR_materials_volume','KHR_materials_sheen','KHR_materials_iridescence'];
const leerGlb=f=>{const b=fs.readFileSync(f);assert.equal(b.toString('ascii',0,4),'glTF');const n=b.readUInt32LE(12);return {bytes:b.length,j:JSON.parse(b.subarray(20,20+n).toString('utf8'))};};
for(const id of ['antonio','claudio','aura'])for(const suf of ['','-bajo']){
 const f=path.join(RAIZ,`assets/movil/${id}${suf}.glb`);
 test(`${id}${suf}.glb cumple el contrato y el presupuesto móvil`,{skip:!fs.existsSync(f)&&'falta generar (npm run modelos)'},()=>{
  const {bytes,j}=leerGlb(f);
  assert(bytes<=3*1024*1024,`pesa ${bytes} bytes (máximo 3 MB)`);
  const usadas=j.extensionsUsed||[];for(const e of PROHIBIDAS)assert(!usadas.includes(e),'usa '+e);
  assert(usadas.includes('EXT_meshopt_compression')&&usadas.includes('KHR_mesh_quantization'),'falta meshopt + cuantización');
  const nombres=j.nodes.map(n=>n.name);for(const h of HUESOS)assert(nombres.includes(h),'falta el hueso '+h);
  for(const z of [...ZONAS,...CAMARAS])assert(nombres.includes(z),'falta '+z);
  const conMorph=j.meshes.filter(m=>m.extras?.targetNames);assert(conMorph.length>=1,'sin morphs');for(const m of conMorph)assert.deepEqual(m.extras.targetNames,MORPHS);
  const clips=j.animations.map(a=>a.name);for(const c of CLIPS)assert(clips.includes(c),'falta el clip '+c);
  for(const a of j.animations)for(const ch of a.channels)assert.notEqual(ch.target.path,'weights','los clips no deben tocar blendshapes');
  let tri=0;for(const [i,m] of j.meshes.entries()){const esZona=j.nodes.some(n=>n.mesh===i&&/^zona_/.test(n.name));if(esZona)continue;for(const p of m.primitives)tri+=j.accessors[p.indices].count/3;}
  assert(tri<=(suf?25000:60000),`${tri} triángulos`);
  for(const img of j.images||[])assert.equal(img.mimeType,'image/webp');
 });
}
test('el GLB aprobado de ANT-ONIO sigue intacto (SHA-256 del manifiesto de partes)',{skip:!fs.existsSync(path.join(RAIZ,'assets/ANT-ONIO.glb'))&&'falta npm run restore-models'},()=>{
 const cfg=JSON.parse(fs.readFileSync(path.join(RAIZ,'assets/model-parts.json'),'utf8'));const m=cfg.models.find(x=>x.file==='ANT-ONIO.glb');
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(RAIZ,'assets/ANT-ONIO.glb'))).digest('hex'),m.sha256);
});
