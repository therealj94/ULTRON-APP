// Genera los GLB crudos de los generadores (código → GLB) en Chromium sin pantalla.
// Uso: node tools/generar.cjs [aura] [claudio] [antonio]   (sin argumentos: los tres)
// Salida: .tmp/crudo/<id>-<calidad>.glb + .tmp/crudo/informe.json. Después: node tools/movil.mjs
const fs=require('node:fs');
const path=require('node:path');
const {build}=require('esbuild');
const {abrirNavegador}=require('./navegador.cjs');
const {servir}=require('./servidor.cjs');

const RAIZ=path.join(__dirname,'..');
const TMP=path.join(RAIZ,'.tmp');
const CRUDO=path.join(TMP,'crudo');
const APROBADO=path.join(RAIZ,'assets/ANT-ONIO.glb');

(async()=>{
 const ids=process.argv.slice(2).filter(a=>!a.startsWith('-'));const lista=ids.length?ids:['aura','claudio','antonio'];
 const calidades=process.argv.includes('--solo-alta')?['alta']:['alta','baja'];
 fs.mkdirSync(CRUDO,{recursive:true});
 await build({entryPoints:[path.join(RAIZ,'src/generar.js')],bundle:true,outfile:path.join(TMP,'generar.bundle.js'),format:'iife',target:'es2020',logLevel:'warning',preserveSymlinks:true});
 fs.writeFileSync(path.join(TMP,'generar.html'),'<!doctype html><meta charset="utf-8"><body><script src="generar.bundle.js"></script></body>');
 const srv=await servir(RAIZ);const browser=await abrirNavegador();
 const page=await browser.newPage();const errores=[];page.on('pageerror',e=>errores.push(e.message));page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')console.log('[página]',m.text());});
 await page.goto(srv.url+'/.tmp/generar.html');await page.waitForFunction(()=>window.GENERAR_LISTO,null,{timeout:60000});
 const informePrevio=fs.existsSync(path.join(CRUDO,'informe.json'))?JSON.parse(fs.readFileSync(path.join(CRUDO,'informe.json'),'utf8')):{};
 const informe={...informePrevio};
 for(const id of lista)for(const calidad of calidades){
  const t0=Date.now();
  const fuente=id==='antonio'?fs.readFileSync(APROBADO).toString('base64'):null;
  const r=await page.evaluate(([id,calidad,fuente])=>window.GENERAR(id,calidad,fuente),[id,calidad,fuente]);
  fs.writeFileSync(path.join(CRUDO,`${id}-${calidad}.glb`),Buffer.from(r.glb,'base64'));
  informe[`${id}-${calidad}`]={bytes:r.bytes,triangulos:r.triangulos,morphs:r.morphs,clips:r.clips,anclas:r.anclas,segundos:(Date.now()-t0)/1000};
  console.log(id,calidad,JSON.stringify({bytes:r.bytes,triangulos:r.triangulos,morphs:r.morphs,clips:r.clips.length}),((Date.now()-t0)/1000).toFixed(1)+' s');
 }
 fs.writeFileSync(path.join(CRUDO,'informe.json'),JSON.stringify(informe,null,1));
 await browser.close();srv.cerrar();
 if(errores.length){console.error(errores);process.exit(1);}
})().catch(e=>{console.error(e);process.exit(1);});
