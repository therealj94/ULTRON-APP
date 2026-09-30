// Capturas ANTES: la entrega original (demo de Codex con sus controladores vivos), con los mismos
// encuadres que las capturas DESPUÉS. Se guardan en qa/antes/ en 1080×1920 y 390×844.
// Uso: node tools/capturas-antes.cjs   (requiere `npm run build` previo con el código original)
const fs=require('node:fs');
const path=require('node:path');
const {abrirNavegador}=require('./navegador.cjs');

const SALIDA=path.join(__dirname,'../qa/antes');
const DEMO=process.env.DEMO_ANTES||path.join(__dirname,'../AVATARES-AURA-DEMO.html');
const TAMANOS=[[1080,1920],[390,844]];
// Encuadres en las unidades del modelo original (suelo en y≈0,3; ANT-ONIO y Claudio miden ~4,6).
const ENCUADRE={
 antonio:{cuerpo:[0,2.62,0,9.6],cara:[0,3.55,.3,3.3],pecho:[0,3.5,0,6.2]},
 claudio:{cuerpo:[-.1,2.55,0,9.6],cara:[0,3.5,.3,3.3],pecho:[0,3.5,0,6.2]},
 aura:{cuerpo:[0,2.35,0,7.6],cara:[0,2.5,0,3.8],pecho:[0,2.4,0,5.6]}
};
const VISTAS=[['frente','cuerpo',0],['tres-cuartos','cuerpo',35],['perfil','cuerpo',90],['cara','cara',0]];
const EMOCIONES=[['feliz','feliz'],['risa','risa'],['triste','triste'],['pensando','pensando'],['curioso','curioso'],['enojado','molesto'],['sorprendido','sorpresa']];

(async()=>{
 fs.mkdirSync(SALIDA,{recursive:true});
 const browser=await abrirNavegador();
 const page=await browser.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
 const errores=[];page.on('pageerror',e=>errores.push(e.message));
 await page.goto('file://'+DEMO);await page.waitForFunction(()=>window.AVATARS?.ready);
 await page.addStyleTag({content:'header,aside,.heading,.view-buttons,.hint{display:none!important}main{display:block!important}#stage{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;min-height:0!important}'});
 const hechas=[];
 for(const id of ['antonio','claudio','aura']){
  await page.evaluate(id=>AVATARS.select(id),id);
  for(const [w,h] of TAMANOS){
   await page.setViewportSize({width:w,height:h});
   const tomas=[...VISTAS.map(([n,e,ang])=>({n,e,ang,emo:'neutral'})),...EMOCIONES.map(([n,emo])=>({n:'emocion-'+n,e:'pecho',ang:0,emo}))];
   for(const t of tomas){
    const [x,y,z,d]=ENCUADRE[id][t.e];let datos;
    await page.evaluate(({x,y,z,d,ang,emo})=>{
     const s=AVATARS.stage,a=s.avatar;s.renderer.setPixelRatio(1);
     a.reset();a.intensity=1;a.setEmotion(emo,1);a.time=0;
     const r=ang*Math.PI/180;s.controls.minDistance=.3;s.controls.maxDistance=50;
     s.controls.target.set(x,y,z);s.camera.position.set(x+Math.sin(r)*d,y+.05*d,z+Math.cos(r)*d);
     s.renderer.setSize(innerWidth,innerHeight);s.camera.aspect=innerWidth/innerHeight;s.camera.updateProjectionMatrix();s.renderAt(1.1);
     return s.renderer.domElement.toDataURL('image/jpeg',.88);
    },{x,y,z,d,ang:t.ang,emo:t.emo}).then(u=>{datos=u;});
    const archivo=`${id}-${t.n}-${w}x${h}.jpg`;
    fs.writeFileSync(path.join(SALIDA,archivo),Buffer.from(datos.split(',')[1],'base64'));
    hechas.push(archivo);
   }
  }
  console.log('antes',id,'listo');
 }
 await browser.close();
 fs.writeFileSync(path.join(SALIDA,'indice.json'),JSON.stringify({fuente:'demo original (controladores vivos de la entrega)',capturas:hechas,errores},null,1));
 if(errores.length){console.error(errores);process.exit(1);}
})().catch(e=>{console.error(e);process.exit(1);});
