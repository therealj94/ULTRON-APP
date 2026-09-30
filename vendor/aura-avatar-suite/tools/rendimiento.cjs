// Rendimiento RELATIVO antes/después en Chromium sin pantalla con SwiftShader (WebGL por CPU).
// NO es un teléfono: SwiftShader dibuja en la CPU y depende mucho del relleno de píxeles; sirve
// para comparar modelos entre sí con la misma escena. Mide carga (parseo del GLB) y FPS en
// 390×844 (dpr 1) con dos ajustes: sin bloom y con bloom (calidad alta del estudio).
// Salida: qa/rendimiento.json
const fs=require('node:fs');
const path=require('node:path');
const {abrirQA,RAIZ}=require('./pagina-qa.cjs');
const MODELOS=[
 ['antes','antonio','assets/ANT-ONIO.glb'],['antes','claudio','assets/CLAUDIO.glb'],['antes','aura','assets/AURA-ORBE.glb'],
 ['despues','antonio','assets/movil/antonio.glb'],['despues','claudio','assets/movil/claudio.glb'],['despues','aura','assets/movil/aura.glb'],
 ['despues','antonio-bajo','assets/movil/antonio-bajo.glb'],['despues','claudio-bajo','assets/movil/claudio-bajo.glb'],['despues','aura-bajo','assets/movil/aura-bajo.glb']
];
(async()=>{
 const q=await abrirQA();const {page}=q;await page.setViewportSize({width:390,height:844});
 const out={nota:'Chromium sin pantalla + SwiftShader (CPU), 390×844, dpr 1. Referencia RELATIVA entre modelos, no FPS de teléfono.',antes:{},despues:{}};
 for(const [cuando,id,archivo] of MODELOS){
  const fila={archivo,bytes:fs.statSync(path.join(RAIZ,archivo)).size};
  for(const bloom of [false,true]){
   await page.evaluate(o=>QA.iniciar(o),{ancho:390,alto:844,transparente:true,calidad:id.endsWith('bajo')?'baja':'alta',bloom});
   const info=await page.evaluate(u=>QA.cargar(u),q.url+'/'+archivo);
   const p=await page.evaluate(()=>QA.medirFPS(4));
   fila.triangulos=info.triangulos;fila.cargaMs=Math.round(info.tCarga);
   fila[bloom?'fpsConBloom':'fpsSinBloom']=+p.fps.toFixed(1);fila[bloom?'llamadasConBloom':'llamadasSinBloom']=p.llamadas;
  }
  out[cuando][id]=fila;console.log(cuando,id,JSON.stringify(fila));
 }
 await q.cerrar();fs.writeFileSync(path.join(RAIZ,'qa/rendimiento.json'),JSON.stringify(out,null,1));
})().catch(e=>{console.error(e);process.exit(1);});
