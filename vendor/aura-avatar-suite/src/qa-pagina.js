import * as T from 'three';
import {crearEscenario} from './escenario.js';

// Página de QA sin interfaz (la manejan tools/capturas.cjs, tools/video.cjs y tools/qa.cjs):
// carga un GLB móvil en el escenario premium y deja fijar cara, clip, boca y cámara para cada
// captura, o medir cuadros por segundo con el bucle real.

let esc=null;
window.QA={
 async iniciar({ancho,alto,transparente=false,fondo='#1c1d20',calidad='alta',bloom=true,dpr=1,luz='estudio'}){
  esc?.dispose();document.body.innerHTML='';const c=document.createElement('canvas');c.style.cssText=`width:${ancho}px;height:${alto}px;display:block`;document.body.appendChild(c);
  esc=crearEscenario(c,{transparente,fondo,calidad,bloom,dpr,luz});esc.tamano(ancho,alto);return true;
 },
 async cargar(url){const t0=performance.now();const buf=await (await fetch(url)).arrayBuffer();const tRed=performance.now()-t0;const r=await esc.cargar(buf);esc.dibujar();return {tCarga:r.tCarga,tRed,bytes:buf.byteLength,clips:r.gltf.animations.map(a=>a.name),morphs:[...r.ctrl.morphs.keys()].length,...esc.stats()};},
 /** Una toma: {expresion, intensidad, clip, tiempo, boca:{nivel,visema}, mirar:[x,y], encuadre} */
 tomar({expresion='tranquila',intensidad=1,clip=null,tiempo=1,boca=null,mirar=null,encuadre='cuerpo',parpadeo=0}={}){
  const c=esc.ctrl;c.setExpresion(expresion,intensidad);c.setEstado({hablando:!!boca,silenciado:false});
  if(boca)c.setBoca(boca.nivel,boca.visema,boca.peso??1);else c.setBoca(0,'sil',0);
  if(mirar)c.mirar(mirar[0],mirar[1]);else c.mirarFrente();
  c.fijar(0,{clip,tiempo});
  if(mirar){c.mir={x:mirar[0],y:mirar[1]};c.update(0);c.fijar(0,{clip,tiempo});}
  if(parpadeo)for(const n of ['eyeBlinkLeft','eyeBlinkRight'])for(const {m,i} of c.morphs.get(n)||[])m.morphTargetInfluences[i]=Math.max(m.morphTargetInfluences[i],parpadeo);
  esc.encuadrar(encuadre);esc.dibujar();return esc.renderer.domElement.toDataURL('image/png');
 },
 /** Avanza el controlador en tiempo real simulado (video): dt fijo. */
 paso(dt,{expresion,boca,gesto,estado,mirar}={}){
  const c=esc.ctrl;if(expresion)c.setExpresion(expresion);if(estado)c.setEstado(estado);if(gesto)c.hacerGesto(gesto);
  if(boca)c.setBoca(boca.nivel,boca.visema,boca.peso??1);else if(boca===null)c.setBoca(0,'sil',0);
  if(mirar)c.mirar(mirar[0],mirar[1]);else if(mirar===null)c.mirarFrente();
  c.update(dt);esc.dibujar();
 },
 encuadrar(e){esc.encuadrar(e);},
 captura(tipo='image/png',q=.9){esc.dibujar();return esc.renderer.domElement.toDataURL(tipo,q);},
 /** Mide FPS reales durante `seg` segundos con requestAnimationFrame (idle + parpadeo). */
 medirFPS(seg=4){return new Promise(ok=>{let n=0,t0=performance.now(),prev=t0;const c=esc.ctrl;c.setExpresion('contenta');c.setEstado({escuchando:true});
  const f=t=>{const dt=Math.min(.05,(t-prev)/1000);prev=t;c.update(dt);esc.dibujar();n++;if(t-t0<seg*1000)requestAnimationFrame(f);else ok({fps:n/((t-t0)/1000),cuadros:n,...esc.stats()});};requestAnimationFrame(f);});},
 info(){return {...esc.stats(),caja:[esc.caja.min.toArray(),esc.caja.max.toArray()]};},
 get esc(){return esc;},T
};
window.QA_LISTO=true;
