// Vista rápida de un GLB móvil (para iterar el diseño): hoja con frente, 3/4, perfil, cara y caras.
// Uso: node tools/vista.cjs <modelo.glb> <salida.png> [--caras] [--clips]
const path=require('node:path');
const fs=require('node:fs');
const {abrirQA,RAIZ}=require('./pagina-qa.cjs');

(async()=>{
 const [glb,salida]=process.argv.slice(2);const conCaras=process.argv.includes('--caras'),conClips=process.argv.includes('--clips');
 const q=await abrirQA();const {page}=q;
 const W=540,H=960;await page.setViewportSize({width:W,height:H});
 await page.evaluate(o=>QA.iniciar(o),{ancho:W,alto:H,transparente:false,fondo:'#1c1d20',luz:process.argv.includes('--app')?'app':'estudio',bloom:!process.argv.includes('--app')});
 const info=await page.evaluate(u=>QA.cargar(u),q.url+'/'+path.relative(RAIZ,path.resolve(glb)));console.log(JSON.stringify(info));
 const caja=await page.evaluate(()=>QA.info());console.log("caja",JSON.stringify(caja.caja));const [mn,mx]=caja.caja;const cy=(mn[1]+mx[1])/2,alto=mx[1]-mn[1];
 const cab=await page.evaluate(()=>{const h=QA.esc.modelo.getObjectByName('head');const v=new QA.T.Vector3();h.getWorldPosition(v);return v.toArray();});
 const rc=await page.evaluate(()=>{const n=QA.esc.modelo.getObjectByName('camara_retrato');const v=new QA.T.Vector3();n.getWorldPosition(v);return v.toArray();});
 const ancho=Math.max(mx[0]-mn[0],mx[2]-mn[2]);const cuerpo=a=>({objetivo:[0,cy,0],distancia:Math.max(alto*1.15,ancho*1.08/(W/H))/2/Math.tan(14*Math.PI/180),angulo:a});
 const cara={objetivo:[0,rc[1],0],distancia:rc[2]*.95,angulo:0};
 let tomas=[['frente',{encuadre:cuerpo(0)}],['34',{encuadre:cuerpo(35)}],['perfil',{encuadre:cuerpo(90)}],['espalda',{encuadre:cuerpo(180)}],['cara',{encuadre:cara}],['cara34',{encuadre:{...cara,angulo:30}}]];
 if(conCaras)tomas=[...['contenta','encantada','risa','triste','piensa','curiosa','enojada','sorprendida','timida','dormida','escucha','uy'].map(e=>[e,{expresion:e,encuadre:cara}]),
  ...['aa','E','I','O','U','PP','FF'].map(v=>['v_'+v,{boca:{nivel:.75,visema:v},encuadre:cara}]),['parpadeo',{parpadeo:1,encuadre:cara}],['mirar',{mirar:[.9,.4],encuadre:cara}]];
 if(conClips)tomas=[['saludar',{clip:'saludar',tiempo:1.0}],['senalar',{clip:'senalar',tiempo:.9}],['pensar',{clip:'pensar',tiempo:1}],['toque_cabeza',{clip:'toque_cabeza',tiempo:.5}],['toque_mejilla',{clip:'toque_mejilla',tiempo:1}],['toque_panza',{clip:'toque_panza',tiempo:.8}],['enojo',{clip:'enojo',tiempo:.9}],['gusto',{clip:'gusto',tiempo:.5}],['celebrar',{clip:'celebrar',tiempo:1}],['hablar',{clip:'hablar',tiempo:1}],['dormir',{clip:'dormir',tiempo:1}],['caminar',{clip:'caminar',tiempo:.3}],['despertar',{clip:'despertar',tiempo:1}],['entrar',{clip:'entrar',tiempo:.3}],['salir',{clip:'salir',tiempo:.9}],['levantada',{clip:'levantada',tiempo:.5}]].map(([n,o])=>[n,{...o,encuadre:cuerpo(20)}]);
 const tmp=path.join(RAIZ,'.tmp/vista');fs.mkdirSync(tmp,{recursive:true});const archivos=[];
 for(const [n,o] of tomas){const u=await page.evaluate(o=>QA.tomar(o),o);const f=path.join(tmp,n+'.png');q.guardar(u,f);archivos.push(f);}
 await q.cerrar();if(q.errores.length)console.error(q.errores);
 // Hoja de contacto con sharp.
 const sharp=require('sharp');const cols=Math.min(6,archivos.length),filas=Math.ceil(archivos.length/cols),w=270,h=480;
 const comps=await Promise.all(archivos.map(async(f,i)=>({input:await sharp(f).resize(w,h).toBuffer(),left:(i%cols)*w,top:Math.floor(i/cols)*h})));
 await sharp({create:{width:cols*w,height:filas*h,channels:3,background:'#1c1d20'}}).composite(comps).png().toFile(salida);
 console.log('hoja',salida);
})().catch(e=>{console.error(e);process.exit(1);});
