// ANT-ONIO: compara el GLB APROBADO (original, clip «neutral» en t=0) con el móvil optimizado
// (pose de reposo), con la misma cámara y la misma luz, píxel a píxel. Salida:
//   qa/antonio-comparacion/<vista>.png  (original | móvil | diferencia ×4)
//   qa/antonio-comparacion/informe.json (diferencia media y % de píxeles que cambian > 6 %)
// Uso: node tools/comparar-antonio.cjs [assets/movil/antonio.glb]
const fs=require('node:fs');
const path=require('node:path');
const {abrirQA,RAIZ}=require('./pagina-qa.cjs');

const K=.4,Y0=.296;
(async()=>{
 const movil=process.argv[2]||'assets/movil/antonio.glb';
 const salida=path.join(RAIZ,'qa/antonio-comparacion');fs.mkdirSync(salida,{recursive:true});
 const q=await abrirQA();const {page}=q;const W=720,H=1080;await page.setViewportSize({width:W,height:H});
 const vistas=[['cuerpo-frente',{objetivo:[0,.88,0],distancia:4.4,angulo:0}],['cuerpo-34',{objetivo:[0,.88,0],distancia:4.4,angulo:35}],['cuerpo-perfil',{objetivo:[0,.88,0],distancia:4.4,angulo:90}],
  ['cara',{objetivo:[0,1.33,.1],distancia:1.25,angulo:0}],['cara-34',{objetivo:[0,1.33,.1],distancia:1.25,angulo:30}],['manos',{objetivo:[.2,.75,.1],distancia:1.1,angulo:10}],['pies',{objetivo:[0,.12,.05],distancia:1.1,angulo:15}]];
 const tomar=async(url,original)=>{
  await page.evaluate(o=>QA.iniciar(o),{ancho:W,alto:H,transparente:false,fondo:'#1c1d20',bloom:false,luz:'app'});
  await page.evaluate(async([url,original,K,Y0])=>{
   await QA.cargar(url);const esc=QA.esc,m=esc.modelo,c=esc.ctrl;c.mezclador.stopAllAction();
   if(original){m.scale.setScalar(K);m.position.set(0,-Y0*K,0);const clip=c.clips.find(a=>a.name==='neutral');const a=c.mezclador.clipAction(clip);a.play();c.mezclador.setTime(0);}
   else{m.traverse(o=>{if(o.isBone)o.quaternion.identity();if(o.morphTargetInfluences)o.morphTargetInfluences.fill(0);});c.reposo.clear();}
   m.updateMatrixWorld(true);esc.blob.visible=false;
  },[url,original,K,Y0]);
  const out={};for(const [n,e] of vistas)out[n]=await page.evaluate(e=>{QA.esc.encuadrar(e);QA.esc.dibujar();return QA.esc.renderer.domElement.toDataURL('image/png');},e);
  return out;
 };
 const A=await tomar(q.url+'/assets/ANT-ONIO.glb',true);
 const B=await tomar(q.url+'/'+movil,false);
 await q.cerrar();
 const sharp=require('sharp');const informe={original:'assets/ANT-ONIO.glb (sha intacto)',movil,vistas:{}};
 for(const [n] of vistas){
  const a=await sharp(Buffer.from(A[n].split(',')[1],'base64')).raw().toBuffer({resolveWithObject:true});
  const b=await sharp(Buffer.from(B[n].split(',')[1],'base64')).raw().toBuffer({resolveWithObject:true});
  const ch=a.info.channels,dif=Buffer.alloc(a.data.length);let suma=0,cuenta=0,cambian=0;
  for(let i=0;i<a.data.length;i+=ch){
   const fondo=[28,29,32];const esFondo=v=>Math.abs(v[0]-fondo[0])+Math.abs(v[1]-fondo[1])+Math.abs(v[2]-fondo[2])<4;
   const pa=[a.data[i],a.data[i+1],a.data[i+2]],pb=[b.data[i],b.data[i+1],b.data[i+2]];
   const d=(Math.abs(pa[0]-pb[0])+Math.abs(pa[1]-pb[1])+Math.abs(pa[2]-pb[2]))/3;
   if(!(esFondo(pa)&&esFondo(pb))){suma+=d;cuenta++;if(d>15)cambian++;}
   const v=Math.min(255,d*4);dif[i]=v;dif[i+1]=v*.35;dif[i+2]=v*.1;if(ch===4)dif[i+3]=255;
  }
  informe.vistas[n]={diferenciaMedia:+(suma/Math.max(1,cuenta)/2.55).toFixed(2)+' %',pixelesQueCambian:+(cambian/Math.max(1,cuenta)*100).toFixed(2)+' %'};
  const imgA=await sharp(a.data,{raw:a.info}).png().toBuffer(),imgB=await sharp(b.data,{raw:b.info}).png().toBuffer(),imgD=await sharp(dif,{raw:a.info}).png().toBuffer();
  await sharp({create:{width:W*3,height:H,channels:3,background:'#1c1d20'}}).composite([{input:imgA,left:0,top:0},{input:imgB,left:W,top:0},{input:imgD,left:W*2,top:0}]).png().toFile(path.join(salida,n+'.png'));
  console.log(n,JSON.stringify(informe.vistas[n]));
 }
 fs.writeFileSync(path.join(salida,'informe.json'),JSON.stringify(informe,null,1));
})().catch(e=>{console.error(e);process.exit(1);});
