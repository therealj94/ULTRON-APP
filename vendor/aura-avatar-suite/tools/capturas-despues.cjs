// Capturas DESPUÉS: los GLB móviles (assets/movil/*.glb, calidad alta) en el escenario premium,
// con los mismos encuadres que qa/antes/ (frente, 3/4, perfil, cara y 7 emociones) en 1080×1920 y
// 390×844, más una toma en tema claro. Salida: qa/despues/
const fs=require('node:fs');
const path=require('node:path');
const {abrirQA,RAIZ}=require('./pagina-qa.cjs');

const SALIDA=path.join(RAIZ,'qa/despues');
const TAMANOS=[[1080,1920],[390,844]];
const VISTAS=[['frente','cuerpo',0],['tres-cuartos','cuerpo',35],['perfil','cuerpo',90],['cara','cara',0]];
const EMOCIONES=[['feliz','contenta'],['risa','risa'],['triste','triste'],['pensando','piensa'],['curioso','curiosa'],['enojado','enojada'],['sorprendido','sorprendida'],['timido','timida']];

(async()=>{
 fs.mkdirSync(SALIDA,{recursive:true});
 const q=await abrirQA();const {page}=q;const hechas=[];
 for(const id of ['antonio','claudio','aura']){
  for(const [w,h] of TAMANOS){
   await page.setViewportSize({width:w,height:h});
   for(const tema of ['oscuro','claro']){
    if(tema==='claro'&&w!==1080)continue;
    await page.evaluate(o=>QA.iniciar(o),{ancho:w,alto:h,transparente:false,fondo:tema==='claro'?'#f7f3ec':'#1c1d20',dpr:1});
    await page.evaluate(u=>QA.cargar(u),q.url+`/assets/movil/${id}.glb`);
    const g=await page.evaluate(()=>{const e=QA.esc,m=e.modelo,T=QA.T;const b=new T.Box3().setFromObject(m,true);const rc=new T.Vector3();m.getObjectByName('camara_retrato').getWorldPosition(rc);const cab=new T.Vector3();m.getObjectByName('head').getWorldPosition(cab);return {min:b.min.toArray(),max:b.max.toArray(),rc:rc.toArray(),cab:cab.toArray(),aspect:e.camara.aspect};});
    const alto=g.max[1]-g.min[1],ancho=Math.max(g.max[0]-g.min[0],g.max[2]-g.min[2]),cy=(g.max[1]+g.min[1])/2,tan=Math.tan(14*Math.PI/180);
    const enc={cuerpo:a=>({objetivo:[0,cy,0],distancia:Math.max(alto*1.12,ancho*1.06/g.aspect)/2/tan,angulo:a}),
     cara:()=>({objetivo:[0,g.rc[1]+.02,0],distancia:Math.max(.62,(g.max[1]-g.cab[1])*1.9/2/tan),angulo:0}),
     pecho:()=>{const alt=id==='aura'?.78:(g.max[1]-(g.cab[1]-.35));return {objetivo:[0,g.max[1]-alt/2,0],distancia:Math.max(alt*1.08,(id==='aura'?.62:ancho*.9)/g.aspect)/2/tan,angulo:0};}};
    const tomas=tema==='claro'?[{n:'frente-tema-claro',e:enc.cuerpo(0),expr:'contenta'}]:[...VISTAS.map(([n,e,a])=>({n,e:enc[e](a),expr:'tranquila'})),...EMOCIONES.map(([n,expr])=>({n:'emocion-'+n,e:enc.pecho(),expr}))];
    for(const t of tomas){
     const url=await page.evaluate(({t})=>QA.tomar({expresion:t.expr,tiempo:1.1,encuadre:t.e}),{t});
     const archivo=`${id}-${t.n}-${w}x${h}.jpg`;const png=Buffer.from(url.split(',')[1],'base64');
     await require('sharp')(png).jpeg({quality:88}).toFile(path.join(SALIDA,archivo));hechas.push(archivo);
    }
   }
  }
  console.log('después',id,'listo');
 }
 await q.cerrar();
 fs.writeFileSync(path.join(SALIDA,'indice.json'),JSON.stringify({fuente:'assets/movil/*.glb (calidad alta) en src/escenario.js (ACES, RoomEnvironment PMREM, luces principal/relleno/contraluces, sombra de contacto, bloom solo emisivo)',capturas:hechas,errores:q.errores},null,1));
 if(q.errores.length){console.error(q.errores);process.exit(1);}
})().catch(e=>{console.error(e);process.exit(1);});
