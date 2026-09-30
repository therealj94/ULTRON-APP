// Video corto por personaje (≤ 15 s, 30 cps): reposo vivo, voz con visemas, tres caras, un gesto
// y una reacción al toque, con el controlador real (mezclador de clips + morphs) en el escenario
// premium. Cuadros en .tmp/video/, MP4 H.264 en qa/video/<id>.mp4 (necesita ffmpeg: variable
// FFMPEG o ffmpeg en el PATH).
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {abrirQA,RAIZ}=require('./pagina-qa.cjs');

const FPS=30,W=540,H=960;
// Guion: [desde (s), qué pasa]
const GUION=[
 [0,{expresion:'tranquila',rotulo:'Reposo: respira, se balancea, parpadea y mira'}],
 [2.2,{expresion:'escucha',estado:{escuchando:true},rotulo:'Escucha'}],
 [3.4,{habla:true,rotulo:'Habla: A · E · I · O · U · M/B/P · F/V'}],
 [6.6,{habla:false,expresion:'contenta',rotulo:'Contenta'}],
 [7.8,{expresion:'sorprendida',rotulo:'Sorprendida'}],
 [9.0,{expresion:'triste',rotulo:'Triste'}],
 [10.2,{expresion:'contenta',gesto:'saludar',rotulo:'Gesto: saludar'}],
 [12.4,{expresion:'timida',gesto:'toque_mejilla',rotulo:'Toque en la mejilla: tímida'}],
 [14.6,{fin:true}]
];
const VIS=['PP','aa','E','I','O','U','FF','aa','O','sil'];
(async()=>{
 const ffmpeg=process.env.FFMPEG||'ffmpeg';
 const q=await abrirQA();const {page}=q;await page.setViewportSize({width:W,height:H});
 fs.mkdirSync(path.join(RAIZ,'qa/video'),{recursive:true});
 for(const id of (process.argv.slice(2).length?process.argv.slice(2):['antonio','claudio','aura'])){
  const dir=path.join(RAIZ,'.tmp/video',id);fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});
  await page.evaluate(o=>QA.iniciar(o),{ancho:W,alto:H,transparente:false,fondo:'#1c1d20',dpr:1});
  await page.evaluate(u=>QA.cargar(u),q.url+`/assets/movil/${id}.glb`);
  // Encuadre de medio cuerpo (la cara se lee) con un leve giro.
  await page.evaluate(id=>{const e=QA.esc,m=e.modelo,T=QA.T;const b=new T.Box3().setFromObject(m,true);const c=new T.Vector3();m.getObjectByName('head').getWorldPosition(c);
   const alto=id==='aura'?b.max.y-b.min.y+.05:(b.max.y-(c.y-.55));const cy=id==='aura'?(b.max.y+b.min.y)/2:b.max.y-alto/2;const ancho=id==='aura'?1.15:.9;
   e.encuadrar({objetivo:[0,cy,0],distancia:Math.max(alto*1.1,ancho/e.camara.aspect)/2/Math.tan(14*Math.PI/180),angulo:12});},id);
  const total=Math.round(GUION[GUION.length-1][0]*FPS);let paso=0;
  for(let f=0;f<total;f++){
   const t=f/FPS;let acc={};while(paso<GUION.length-1&&t>=GUION[paso][0]){acc={...acc,...GUION[paso][1],nuevo:true};paso++;}
   const hablando=t>=3.4&&t<6.6;let boca;
   if(hablando){const k=(t-3.4)/.32;const v=VIS[Math.floor(k)%VIS.length];boca={nivel:v==='sil'?0:.6+.3*Math.abs(Math.sin(t*11)),visema:v};}else if(t>=6.6&&t<6.7)boca=null;
   const orden={dt:1/FPS};if(acc.nuevo){if(acc.expresion)orden.expresion=acc.expresion;if(acc.estado)orden.estado=acc.estado;else if(acc.expresion)orden.estado={escuchando:false};if(acc.gesto)orden.gesto=acc.gesto;}
   if(boca!==undefined)orden.boca=boca;
   // La mirada sigue un punto que se mueve despacio (como el dedo o la cámara).
   orden.mirar=t<2.2?[.5*Math.sin(t*1.3),.2*Math.sin(t*.9)]:null;
   const url=await page.evaluate(o=>{QA.paso(o.dt,o);return QA.esc.renderer.domElement.toDataURL('image/png');},orden);
   fs.writeFileSync(path.join(dir,String(f).padStart(4,'0')+'.png'),Buffer.from(url.split(',')[1],'base64'));
   if(f%90===0)console.log(id,'cuadro',f,'/',total);
  }
  const salida=path.join(RAIZ,'qa/video',id+'.mp4');
  execFileSync(ffmpeg,['-y','-loglevel','error','-framerate',String(FPS),'-i',path.join(dir,'%04d.png'),'-c:v','libx264','-pix_fmt','yuv420p','-crf','23','-preset','medium','-movflags','+faststart',salida]);
  fs.rmSync(dir,{recursive:true,force:true});
  console.log('video',salida,(fs.statSync(salida).size/1024|0)+' KB');
 }
 await q.cerrar();if(q.errores.length){console.error(q.errores);process.exit(1);}
})().catch(e=>{console.error(e);process.exit(1);});
