// QA en Chromium sin pantalla (SwiftShader): contrato de los GLB móviles, presupuesto, órbita de
// AU-RA sin choques, estudio y puente de la WebView, audio → boca, y rendimiento RELATIVO.
// Los FPS de SwiftShader son de CPU, no de un teléfono: sirven para comparar modelos entre sí.
// Salida: qa/runtime-tests.json y qa/rendimiento.json. Sale con error si algo falla.
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {abrirQA,RAIZ}=require('./pagina-qa.cjs');

const IDS=['antonio','claudio','aura'];
const PRESUPUESTO={alta:{triangulos:60000,bytes:3*1024*1024},bajo:{triangulos:25000,bytes:3*1024*1024}};
(async()=>{
 const {MORPHS,CLIPS,ZONAS,CAMARAS}=await import('../src/kit/nombres.js');
 const res={modelos:{},errores:[]};const fallos=[];const ok=(c,m)=>{if(!c)fallos.push(m);return !!c;};
 const q=await abrirQA();const {page}=q;
 await page.setViewportSize({width:390,height:844});
 const perf={nota:'Chromium sin pantalla con SwiftShader (WebGL por CPU). No es un teléfono: los FPS son una referencia relativa entre modelos.',modelos:{}};
 for(const id of IDS)for(const [cal,suf] of [['alta',''],['bajo','-bajo']]){
  const archivo=`assets/movil/${id}${suf}.glb`;const bytes=fs.statSync(path.join(RAIZ,archivo)).size;
  await page.evaluate(o=>QA.iniciar(o),{ancho:390,alto:844,transparente:true,calidad:cal==='alta'?'alta':'baja',bloom:cal==='alta'});
  const info=await page.evaluate(u=>QA.cargar(u),q.url+'/'+archivo);
  const r=await page.evaluate(({MORPHS,CLIPS,ZONAS,CAMARAS})=>{
   const m=QA.esc.modelo,c=QA.esc.ctrl;const nombres=[];m.traverse(o=>nombres.push(o.name));
   const morphs=[...c.morphs.keys()];const clips=c.clips.map(a=>a.name);
   // Cada clip y cada cara dan números finitos.
   let finito=true;for(const clip of clips){c.fijar(0,{clip,tiempo:.7});m.traverse(o=>{if(o.isBone)finito&&=[...o.position.toArray(),...o.quaternion.toArray()].every(Number.isFinite);});}
   c.setExpresion('triste');c.fijar(0);const triste=(c.pesos.get('mouthFrownLeft')||0)>.5;
   c.setExpresion('tranquila');c.setBoca(.8,'O');c.fijar(0);const boca=(c.pesos.get('viseme_O')||0)>.5;c.setBoca(0,'sil');c.fijar(0);const cierra=(c.pesos.get('viseme_O')||0)===0;
   return {morphsOk:MORPHS.every(n=>morphs.includes(n)),morphsExtra:morphs.filter(n=>!MORPHS.includes(n)),clipsOk:CLIPS.every(n=>clips.includes(n)),zonas:ZONAS.every(z=>nombres.includes(z)),camaras:CAMARAS.every(z=>nombres.includes(z)),finito,triste,boca,cierra};
  },{MORPHS,CLIPS,ZONAS,CAMARAS});
  const p=await page.evaluate(()=>QA.medirFPS(1.5));
  const tri=info.triangulos-(await page.evaluate(()=>{let t=0;QA.esc.modelo.traverse(o=>{if(o.isMesh&&/^zona_/.test(o.name))t+=o.geometry.index.count/3;});return t;}));
  const clave=id+suf;res.modelos[clave]={archivo,bytes,triangulos:tri,llamadas:p.llamadas,...r};
  perf.modelos[clave]={bytes,triangulos:tri,cargaMs:Math.round(info.tCarga),fps390x844:+p.fps.toFixed(1),llamadas:p.llamadas};
  const pres=PRESUPUESTO[cal];
  ok(tri<=pres.triangulos,`${clave}: ${tri} triángulos > ${pres.triangulos}`);ok(bytes<=pres.bytes,`${clave}: ${bytes} bytes > 3 MB`);
  for(const k of ['morphsOk','clipsOk','zonas','camaras','finito','triste','boca','cierra'])ok(r[k],`${clave}: falla ${k}`);
  console.log(clave,JSON.stringify(perf.modelos[clave]));
 }
 // AU-RA: la órbita no atraviesa las manos en ningún cuadro de ningún clip.
 await page.evaluate(o=>QA.iniciar(o),{ancho:390,alto:844});await page.evaluate(u=>QA.cargar(u),q.url+'/assets/movil/aura.glb');
 res.orbita=await page.evaluate(()=>{
  const m=QA.esc.modelo,c=QA.esc.ctrl,T=QA.T;const orb=m.getObjectByName('orbita');
  let cuerpo=null;m.traverse(o=>{if(o.isSkinnedMesh&&!cuerpo&&o.skeleton.bones.some(b=>b.name==='leftHand')&&!o.morphTargetInfluences)cuerpo=o;});
  const huesosMano=new Set(cuerpo.skeleton.bones.map((b,i)=>/Hand|Thumb|Index|Middle|Ring/.test(b.name)?i:-1).filter(i=>i>=0));
  const si=cuerpo.geometry.attributes.skinIndex,sw=cuerpo.geometry.attributes.skinWeight,ids=[];
  for(let i=0;i<si.count;i++){let mx=0,b=-1;for(let k=0;k<4;k++){const w=sw.getComponent(i,k);if(w>mx){mx=w;b=si.getComponent(i,k);}}if(huesosMano.has(b))ids.push(i);}
  const R=.54,TUBO=.0075,q=new T.Quaternion().setFromEuler(new T.Euler(.2,0,-.12));const v=new T.Vector3();
  let minimo=9,peor='';
  for(const clip of c.clips){const d=clip.duration;for(let t=0;t<=d+1e-6;t+=1/15){c.fijar(0,{clip:clip.name,tiempo:t});
   const M=new T.Matrix4().copy(orb.matrixWorld).multiply(new T.Matrix4().makeTranslation(0,-1.15,0));
   const centro=new T.Vector3(0,1.15,0).applyMatrix4(M),n=new T.Vector3(0,1,0).applyQuaternion(q).transformDirection(M);
   for(const i of ids){cuerpo.getVertexPosition(i,v);v.applyMatrix4(cuerpo.matrixWorld);const dd=v.clone().sub(centro),h=dd.dot(n),rin=dd.addScaledVector(n,-h).length();const dist=Math.hypot(h,rin-R)-TUBO;if(dist<minimo){minimo=dist;peor=clip.name+' t='+t.toFixed(2);}}
  }}
  return {distanciaMinima:+minimo.toFixed(3),peor,verticesMano:ids.length};
 });
 ok(res.orbita.distanciaMinima>.02,`AU-RA: la órbita pasa a ${res.orbita.distanciaMinima} m de una mano (${res.orbita.peor})`);
 console.log('órbita',JSON.stringify(res.orbita));
 // Estudio autónomo (archivo local) y ancho móvil sin desborde.
 const demo=await q.browser.newPage({viewport:{width:390,height:844}});const errDemo=[];demo.on('pageerror',e=>errDemo.push(e.message));
 await demo.goto('file://'+path.join(RAIZ,'AVATARES-AURA-DEMO.html'));await demo.waitForFunction(()=>window.AVATARS?.listo,null,{timeout:120000});
 res.estudio={sinDesborde:await demo.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),errores:errDemo};ok(res.estudio.sinDesborde,'estudio: desborde a 390 px');ok(!errDemo.length,'estudio: errores '+errDemo.join('; '));
 // Audio real → boca → se cierra al detener.
 res.audio=await demo.evaluate(async()=>{const n=16000,buf=new ArrayBuffer(44+n*2),v=new DataView(buf),tx=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};tx(0,'RIFF');v.setUint32(4,36+n*2,true);tx(8,'WAVE');tx(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,n,true);v.setUint32(28,n*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);tx(36,'data');v.setUint32(40,n*2,true);for(let i=0;i<n;i++)v.setInt16(44+i*2,Math.sin(i/n*440*Math.PI*2)*11000,true);
  const s=AVATARS.stage;await s.audio.play({blob:new Blob([buf],{type:'audio/wav'})});await new Promise(r=>setTimeout(r,300));s.audio.update(.1);s.avatar.update(.1);const mueve=s.avatar.speech>.1;s.audio.stop();return {mueve,cierra:s.avatar.speech===0};});
 ok(res.audio.mueve&&res.audio.cierra,'audio → boca');
 // Página de la WebView: «listo» tras cargar y puente compatible.
 const wv=await q.browser.newPage({viewport:{width:390,height:844}});await wv.addInitScript(()=>{window.msgs=[];window.ReactNativeWebView={postMessage:m=>window.msgs.push(JSON.parse(m))};});
 await wv.goto('file://'+path.join(RAIZ,'integration/claudio-embed.html'));await wv.waitForFunction(()=>window.msgs.some(m=>m.tipo==='listo'),null,{timeout:120000});
 res.puente=await wv.evaluate(()=>{const a=window.__avatarStage.avatar;window.__aura({tipo:'estado',face:'LISTENING',emocion:'curioso'});const estado=a.state==='listening'&&a.emotion==='curioso';window.__aura({tipo:'boca',n:.8,visema:'O'});const boca=a.speech===.8;const nan=window.__aura({tipo:'boca',n:NaN})===false;window.__aura({tipo:'boca',n:0});const cierra=a.speech===0;const sinExito=window.__aura({tipo:'tarea',tarea:'desconocida'})===false;const nuevo=window.__aura({tipo:'gesto',nombre:'toque_mejilla'})===true;return {estado,boca,nan,cierra,sinExito,nuevo};});
 for(const [k,v] of Object.entries(res.puente))ok(v,'puente: '+k);
 console.log('estudio',JSON.stringify(res.estudio),'audio',JSON.stringify(res.audio),'puente',JSON.stringify(res.puente));
 await q.cerrar();
 // Revisor de la app (mobile/scripts/avatar3d-modelo.mjs), si está tsx.
 const tsx=[path.join(RAIZ,'node_modules/.bin/tsx'),path.join(RAIZ,'../../node_modules/.bin/tsx')].find(f=>fs.existsSync(f));const mobile=path.join(RAIZ,'../../mobile');
 res.revisorApp={};
 if(tsx&&fs.existsSync(path.join(mobile,'scripts/avatar3d-modelo.mjs')))for(const id of IDS){
  try{const out=execFileSync(tsx,['scripts/avatar3d-modelo.mjs','revisar',path.join(RAIZ,`assets/movil/${id}.glb`)],{cwd:mobile,encoding:'utf8'});res.revisorApp[id]={cumple:true,avisos:out.split('\n').filter(l=>l.includes('aviso')).map(l=>l.trim())};}
  catch(e){res.revisorApp[id]={cumple:false,salida:String(e.stdout||e.message)};fallos.push('revisor de la app: '+id);}
 }
 res.errores=[...q.errores,...fallos];
 fs.writeFileSync(path.join(RAIZ,'qa/runtime-tests.json'),JSON.stringify(res,null,1));
 if(res.errores.length){console.error(res.errores);process.exit(1);}
 console.log('QA: todo bien');
})().catch(e=>{console.error(e);process.exit(1);});
