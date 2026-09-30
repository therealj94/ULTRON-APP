// Comprime los GLB crudos (.tmp/crudo) para el teléfono y los deja en assets/movil/:
//   aura.glb, claudio.glb, antonio.glb (calidad alta) y *-bajo.glb (LOD bajo).
// Pasos (gltf-transform): quitar duplicados y lo no usado, remuestrear animaciones, texturas WebP
// ≤ 1024 px, cuantización (KHR_mesh_quantization) y meshopt (EXT_meshopt_compression). Nada de
// Draco ni KTX2: la escena de la app solo trae el decodificador meshopt (especificación §3).
// Uso: node tools/movil.mjs [aura] [claudio] [antonio]
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {dedup,prune,resample,quantize,meshopt,textureCompress,weld,sparse,compactPrimitive} from '@gltf-transform/functions';
import {MeshoptEncoder,MeshoptDecoder} from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const RAIZ=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const CRUDO=path.join(RAIZ,'.tmp/crudo'),SALIDA=path.join(RAIZ,'assets/movil');
await MeshoptEncoder.ready;await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder,'meshopt.decoder':MeshoptDecoder});

export async function comprimir(entrada,salida,{soldar=true,bajo=false}={}){
 const doc=await io.read(entrada);
 // Cada primitiva se queda solo con sus vértices (el exportador las hace compartir todo el búfer).
 for(const m of doc.getRoot().listMeshes())for(const p of m.listPrimitives())compactPrimitive(p);
 doc.getRoot().getAsset().generator='aura-avatar-suite · tools/movil.mjs';
 await doc.transform(
  dedup(),
  ...(soldar?[weld()]:[]),
  resample({tolerance:1e-4}),
  prune({keepAttributes:true,keepLeaves:true}),
  // LOD bajo: texturas a 256 px (a 104–300 px en pantalla no se distingue).
  textureCompress({encoder:sharp,targetFormat:'webp',resize:bajo?[256,256]:[1024,1024],quality:bajo?80:88}),
  sparse({ratio:1/3}),
  quantize({quantizePosition:14,quantizeNormal:10,quantizeTexcoord:12,quantizeColor:8,quantizeWeight:8,quantizeGeneric:12,cleanup:true}),
  meshopt({encoder:MeshoptEncoder,level:'high'})
 );
 fs.mkdirSync(path.dirname(salida),{recursive:true});
 await io.write(salida,doc);return fs.statSync(salida).size;
}

if(import.meta.url===`file://${process.argv[1]}`){
 const ids=process.argv.slice(2).filter(a=>!a.startsWith('-'));
 for(const id of ids.length?ids:['aura','claudio','antonio']){
  for(const [cal,sufijo] of [['alta',''],['baja','-bajo']]){
   const e=path.join(CRUDO,`${id}-${cal}.glb`);if(!fs.existsSync(e))continue;
   const s=path.join(SALIDA,`${id}${sufijo}.glb`);const bytes=await comprimir(e,s,{bajo:cal==='baja'});
   console.log(`${id}${sufijo}.glb`,(fs.statSync(e).size/1048576).toFixed(2),'MB →',(bytes/1048576).toFixed(2),'MB');
  }
 }
}
