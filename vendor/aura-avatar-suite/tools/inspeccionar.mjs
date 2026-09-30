// Resumen técnico de uno o varios GLB: triángulos, primitivas, materiales, texturas, morphs y clips.
// Uso: node tools/inspeccionar.mjs assets/movil/aura.glb [...más]
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
import fs from 'node:fs';

await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});

export async function inspeccionar(ruta){
 const doc=await io.read(ruta),root=doc.getRoot();
 let triangulos=0,primitivas=0;const mallas=[];const morphs=new Set();
 for(const m of root.listMeshes()){
  let t=0;
  for(const p of m.listPrimitives()){primitivas++;const idx=p.getIndices();t+=(idx?idx.getCount():p.getAttribute('POSITION').getCount())/3;}
  triangulos+=t;for(const n of m.getExtras()?.targetNames||[])morphs.add(n);
  mallas.push({nombre:m.getName(),triangulos:Math.round(t),morphs:m.listPrimitives()[0]?.listTargets().length||0});
 }
 mallas.sort((a,b)=>b.triangulos-a.triangulos);
 return {
  archivo:ruta,bytes:fs.statSync(ruta).size,triangulos:Math.round(triangulos),primitivas,mallas:mallas.length,
  materiales:root.listMaterials().length,
  texturas:root.listTextures().map(t=>`${t.getMimeType()} ${t.getSize()?.join('×')} ${(t.getImage()?.byteLength/1024|0)} KB`),
  huesos:new Set(root.listSkins().flatMap(s=>s.listJoints())).size,
  nodos:root.listNodes().length,morphs:morphs.size,clips:root.listAnimations().map(a=>a.getName()),
  extensiones:root.listExtensionsUsed().map(e=>e.extensionName),principales:mallas.slice(0,12)
 };
}

if(import.meta.url===`file://${process.argv[1]}`){
 for(const f of process.argv.slice(2)){const r=await inspeccionar(f);console.log(JSON.stringify(r,null,1));}
}
