import * as T from 'three';
import {rejilla,barrido,elipsoide,geometria,suave,clamp,TAU,lerp,suavizarCostura} from './kit/geo.js';
import {Esqueleto,Constructor,rgb,mezclaColor,zona,camaraNodo} from './kit/cuerpo.js';
import {campoCompleto} from './kit/cara.js';
import {crearClips} from './kit/animaciones.js';
import {atlasBrillo,normalCeramica} from './kit/texturas.js';

// AU-RA · Grafito · Orbe, versión móvil. Un huevo de cerámica marfil partido en dos (cabeza y
// base) con una junta grafito y filetes de oro; visor curvo grafito con ojos dorados que brillan
// (iris, pupila y destello), cejas y boca de luz; manos flotantes con dedos; órbita de oro que
// precesiona sin tocar nada. Ella habla en femenino: presencia serena, elegante y cálida.
// Metros, mirando hacia +Z, cabeza a 1,20 m (la base flota a ~1 m del suelo).

const Y0=1.02,Y1=1.73,YC=(Y0+Y1)/2,H2=(Y1-Y0)/2,W=.258,PROF=.94,YJ=1.30;
const S_JUNTA=(YJ-YC)/H2; // la junta cabeza/base, en lo más ancho del huevo
/** Radio del huevo en función de s∈[-1,1] (abajo→arriba): lleno, apenas más angosto arriba. */
const radio=s=>W*Math.pow(Math.max(0,1-Math.abs(s)**2.5),1/2.5)*(1-.07*s);
const sDeY=y=>(y-YC)/H2;
const zCasco=(x,y)=>{const r=radio(sDeY(y));return PROF*Math.sqrt(Math.max(0,r*r-x*x));};
// Visor: contorno superelíptico en XY y abombado sobre la cerámica.
const VIS={yc:1.515,a:.196,b:.114,n:3.0};
const rhoVisor=(x,y)=>Math.pow(Math.abs(x/VIS.a)**VIS.n+Math.abs((y-VIS.yc)/VIS.b)**VIS.n,1/VIS.n);
const zVisor=(x,y)=>{const r=rhoVisor(x,y);return zCasco(x,y)+.0045+.0080*Math.max(0,1-r*r);};
const sobreVisor=(x,y,off)=>[x,y,zVisor(x,y)+off];
// Cara de luz.
const OJO={x:.075,y:1.527,a:.031,b:.041};
const BOCA={y:1.446,escala:1.35}; // la boca se lee a distancia de teléfono (escala sobre el contorno base)
const CAPA={iris:.0035,pupila:.0043,destello:.0051,pestana:.0036,ceja:.0035,boca:.0040,relleno:.0034,rubor:.0030,lengua:.0037};

export function crearAura({calidad='alta'}={}){
 const alta=calidad!=='baja',q=alta?1:.55;
 const N=v=>Math.max(6,Math.round(v*q));
 const atlas=atlasBrillo();
 const mat={
  ceramica:new T.MeshPhysicalMaterial({name:'ceramica',color:'#ffffff',vertexColors:true,roughness:.4,clearcoat:.55,clearcoatRoughness:.22,normalMap:alta?normalCeramica():null,normalScale:new T.Vector2(.12,.12)}),
  grafito:new T.MeshPhysicalMaterial({name:'grafito',color:'#ffffff',vertexColors:true,roughness:.45,metalness:0,specularIntensity:.12,clearcoat:.28,clearcoatRoughness:.18}),
  oro:new T.MeshStandardMaterial({name:'oro',color:'#d6b56c',metalness:1,roughness:.3}),
  brillo:new T.MeshStandardMaterial({name:'brillo',color:'#ffffff',map:atlas.tex,emissive:'#ffffff',emissiveMap:atlas.tex,emissiveIntensity:1.45,roughness:.35}),
  zona:new T.MeshBasicMaterial({name:'zona',transparent:true,opacity:0,depthWrite:false})
 };
 const hx=(x,y,z)=>[x,y,z];
 const esq=new Esqueleto([
  {n:'hips',x:[0,1.09,0]},{n:'spine',p:'hips',x:[0,1.15,0]},{n:'chest',p:'spine',x:[0,1.21,0]},{n:'upperChest',p:'chest',x:[0,1.26,0]},
  {n:'neck',p:'upperChest',x:[0,1.285,0]},{n:'head',p:'neck',x:[0,YJ,0]},
  {n:'leftEye',p:'head',x:[0,OJO.y,zVisor(0,OJO.y)-.28]},{n:'rightEye',p:'head',x:[0,OJO.y,zVisor(0,OJO.y)-.28]},{n:'jaw',p:'head',x:[0,BOCA.y,.12]},
  ...['left','right'].flatMap(l=>{const s=l==='left'?1:-1,m=v=>[v[0]*s,v[1],v[2]];const H=manoBase(s);return [
   {n:l+'Shoulder',p:'upperChest',x:m([.06,1.27,0])},{n:l+'UpperArm',p:l+'Shoulder',x:m([.10,1.27,0])},{n:l+'LowerArm',p:l+'UpperArm',x:m([.19,1.09,-.11])},{n:l+'Hand',p:l+'LowerArm',x:H.origen},
   {n:l+'ThumbProximal',p:l+'Hand',x:H.hueso('pulgar')},{n:l+'IndexProximal',p:l+'Hand',x:H.hueso('indice')},{n:l+'MiddleProximal',p:l+'Hand',x:H.hueso('medio')},{n:l+'RingProximal',p:l+'Hand',x:H.hueso('resto')}];}),
  {n:'orbita',p:'hips',x:[0,1.15,0]},{n:'orbitaLuz',p:'orbita',x:[0,1.15,0]},
  ...['left','right'].flatMap(l=>{const s=l==='left'?1:-1;return [
   {n:l+'UpperLeg',p:'hips',x:[.08*s,1.04,0]},{n:l+'LowerLeg',p:l+'UpperLeg',x:[.08*s,.55,0]},{n:l+'Foot',p:l+'LowerLeg',x:[.08*s,.1,0]},{n:l+'Toes',p:l+'Foot',x:[.08*s,.03,.08]}];})
 ]);
 const K=new Constructor(esq,mat);
 const marfil=rgb('#efe7d7'),marfilCalido=rgb('#e9dcc6'),grafitoC=rgb('#16181d'),grafitoSatin=rgb('#2a2c31');

 // ── casco: cabeza (arriba de la junta) y base ──────────────────────────────────────────────
 const ANG=N(112);
 const casco=(s0,s1,nv)=>rejilla(ANG,nv,(u,v)=>{const s=lerp(s0,s1,v),th=u*TAU,r=radio(s);return [r*Math.sin(th),YC+s*H2,PROF*r*Math.cos(th)];},{cerradaU:true,uvEscala:[26,12]});
 const tinteCasco=p=>{const s=sDeY(p.y);return mezclaColor(marfil,marfilCalido,clamp(.5-s*.6));};
 const gap=.006/H2;
 K.agregar(casco(S_JUNTA+gap,1,N(40)),{material:'ceramica',hueso:'head',color:tinteCasco});
 K.agregar(casco(-1,S_JUNTA-gap,N(26)),{material:'ceramica',hueso:'chest',color:tinteCasco});
 // Tapas interiores (no se ve a través de la junta cuando la cabeza se inclina).
 const tapa=(y,hueso)=>{const r=radio(sDeY(y))*.97;K.agregar(rejilla(N(40),3,(u,v)=>{const th=u*TAU,rr=r*(1-v);return [rr*Math.sin(th),y,PROF*rr*Math.cos(th)];},{cerradaU:true,invertir:hueso==='head'}),{material:'grafito',hueso,color:grafitoSatin,ao:false});};
 tapa(YJ+.006,'head');tapa(YJ-.006,'chest');
 // Junta grafito satinada con filete de oro arriba y abajo.
 const aro=(y,rr,ra,rb,n=N(10))=>rejilla(ANG,n,(u,v)=>{const th=u*TAU,ph=v*TAU,R=rr+ra*Math.cos(ph);return [R*Math.sin(th),y+rb*Math.sin(ph),PROF*R*Math.cos(th)];},{cerradaU:true});
 const rJ=radio(S_JUNTA);
 K.agregar(aro(YJ,rJ-.006,.009,.0105),{material:'grafito',hueso:'neck',color:grafitoSatin,ocluye:false});
 for(const dy of [.0068,-.0068]){const y=YJ+dy;K.agregar(aro(y,radio(sDeY(y))+.0004,.0016,.0016,N(6)),{material:'oro',hueso:dy>0?'head':'chest',ao:false,ocluye:false});}
 // Filete de oro que cruza la coronilla de oreja a oreja (costura de diadema).
 const diadema=[];for(let i=0;i<=40;i++){const a=-Math.PI/2+i/40*Math.PI;const y=YC+H2*(S_JUNTA+.03+(1-S_JUNTA-.03)*Math.cos(a)*.98);const x=Math.sin(a)*radio(sDeY(y))*.999;const z=-.045;const rr=radio(sDeY(y));const xx=Math.sign(x)*Math.min(Math.abs(x),Math.sqrt(Math.max(0,rr*rr-(z/PROF)**2)));diadema.push([xx,y,z]);}
 const diademaProy=diadema.map(([x,y,z])=>{const r=radio(sDeY(y));const th=Math.atan2(x,z/PROF);return [r*Math.sin(th)*1.004,y,PROF*r*Math.cos(th)*1.004];});
 K.agregar(barrido(diademaProy,()=>.0014,{lados:6,pasos:N(60),tapas:true}),{material:'oro',hueso:'head',ao:false,ocluye:false});
 // Emblema de planeta en la espalda (logo de AU-RA).
 {const c=[0,1.17,-zCasco(0,1.17)-.001];const disco=elipsoide([.016,.016,.004],{c:[0,0,0],nu:20,nv:10});disco.translate(c[0],c[1],c[2]);K.agregar(disco,{material:'oro',hueso:'chest',ao:false,ocluye:false});
  const anillo=aro(0,.027,.0022,.0022,6);anillo.scale(1,1,1/PROF);anillo.rotateX(Math.PI/2);anillo.rotateZ(-.35);anillo.translate(c[0],c[1],c[2]-.002);K.agregar(anillo,{material:'oro',hueso:'chest',ao:false,ocluye:false});}
 // Base: casquete grafito con aro de oro y una luz suave de levitación.
 {const y=Y0+.018;K.agregar(aro(y,radio(sDeY(y))*.95,.004,.004,N(6)),{material:'oro',hueso:'chest',ao:false,ocluye:false});
  K.agregar(elipsoide([.045,.012,.045*PROF],{c:[0,Y0+.004,0],nu:N(32),nv:N(10)}),{material:'grafito',hueso:'chest',color:grafitoSatin});
  const luz=rejilla(N(28),2,(u,v)=>{const th=u*TAU,r=.03*v;return [r*Math.sin(th),Y0-.0085,r*Math.cos(th)];},{cerradaU:true});
  const uvL=luz.attributes.uv;for(let i=0;i<uvL.count;i++){const th=uvL.getX(i)*TAU,r=uvL.getY(i)*.5;const [uu,vv]=atlas.uv('luz',.5+Math.sin(th)*r,.5+Math.cos(th)*r);uvL.setXY(i,uu,vv);}
  K.agregar(luz,{material:'brillo',hueso:'chest',ao:false});}

 // ── visor grafito con bisel de oro ─────────────────────────────────────────────────────────
 const contorno=(th,r)=>{const c=Math.cos(th),s=Math.sin(th);const x=VIS.a*Math.sign(c)*Math.abs(c)**(2/VIS.n)*r,y=VIS.yc+VIS.b*Math.sign(s)*Math.abs(s)**(2/VIS.n)*r;return [x,y];};
 {const g=rejilla(N(96),N(16),(u,v)=>{const [x,y]=contorno(u*TAU,v*1.02);return [x,y,zVisor(x,y)];},{cerradaU:true,invertir:true});
  // El vidrio: grafito profundo con un leve azul en el centro (se lee como pantalla apagada).
  K.agregar(g,{material:'grafito',hueso:'head',color:p=>{const r=rhoVisor(p.x,p.y);return mezclaColor(rgb('#1b2029'),grafitoC,clamp(r));},ao:false});
  const borde=[];for(let i=0;i<N(96);i++){const [x,y]=contorno(i/N(96)*TAU,1);borde.push([x,y,zVisor(x,y)-.0005]);}
  K.agregar(barrido(new T.CatmullRomCurve3(borde.map(p=>new T.Vector3(...p)),true,'centripetal'),()=>.0034,{lados:8,pasos:N(140),tapas:false}),{material:'oro',hueso:'head',ao:false,ocluye:false});}

 // ── cara de luz (malla con morphs) ─────────────────────────────────────────────────────────
 const pesoOjo=l=>()=>[[l+'Eye',.45],['head',.55]];
 for(const [lado,s] of [['left',1],['right',-1]]){
  const cx=OJO.x*s,L=lado==='left'?'I':'D';
  // Capas del ojo en coordenadas locales del ojo (ex, ey).
  const capa=(nombre,rx,ry,ox,oy,anillos,segs,region)=>{
   const pos=[],uv=[],idx=[],datos=[];
   for(let j=0;j<=anillos;j++)for(let i=0;i<=segs;i++){const r=j/anillos,a=i/segs*TAU;const ex=ox+rx*Math.sign(Math.cos(a))*Math.abs(Math.cos(a))**(2/2.25)*r,ey=oy+ry*Math.sign(Math.sin(a))*Math.abs(Math.sin(a))**(2/2.25)*r;
    pos.push(...sobreVisor(cx+ex,OJO.y+ey,CAPA[nombre]));uv.push(...atlas.uv(region,.5+Math.cos(a)*r*.5,.5-Math.sin(a)*r*.5));datos.push({ojo:L,s,capa:nombre,ex,ey});}
   for(let j=0;j<anillos;j++)for(let i=0;i<segs;i++){const A=j*(segs+1)+i,B=A+segs+1;idx.push(A,B,A+1,B,B+1,A+1);}
   const g=geometria(pos,idx,{uv});const n=g.attributes.normal;for(let i=0;i<n.count;i++)n.setXYZ(i,0,0,1);
   K.agregar(g,{material:'brillo',pesos:pesoOjo(lado),cara:true,etiqueta:'ojo',datos,ao:false,ocluye:false});
  };
  capa('iris',OJO.a,OJO.b,0,0,N(6),N(32),'iris');
  capa('pupila',.0115,.0155,.0015*s,-.002,N(4),N(24),'pupila');
  capa('destello',.0056,.0056,-.0085,.0125,2,N(16),'destello');
  capa('destello',.0024,.0024,.0095,-.012,2,N(12),'destello');
  // Pestañas: tres trazos de luz en el borde exterior de arriba (se lee femenina a 104 px).
  {const pos=[],uv=[],idx=[],datos=[];let base=0;
   for(const [th,largo] of [[.42,.0105],[.78,.0125],[1.12,.0095]]){
    const c=Math.cos(th),sn=Math.sin(th),ex=s*OJO.a*c**(2/2.25),ey=OJO.b*sn**(2/2.25);
    const dir=[s*Math.cos(th-.25),Math.sin(th-.25)],nrm=[-dir[1],dir[0]];
    for(let i=0;i<=4;i++){const t=i/4,g=.0013*(1-t*.85);for(const k of [-1,1]){const dx=dir[0]*largo*t+nrm[0]*g*k,dy=dir[1]*largo*t+nrm[1]*g*k+.0025*t*t;
     pos.push(...sobreVisor(cx+ex+dx,OJO.y+ey+dy,CAPA.pestana));uv.push(...atlas.uv('linea',t,k*.5+.5));datos.push({ojo:L,s,capa:'pestana',ex,ey,dx,dy});}}
    for(let i=0;i<4;i++){const A=base+i*2;idx.push(A,A+2,A+1,A+1,A+2,A+3);}base+=10;
   }
   const g=geometria(pos,idx,{uv});const nn=g.attributes.normal;for(let i=0;i<nn.count;i++)nn.setXYZ(i,0,0,1);
   K.agregar(g,{material:'brillo',pesos:()=>[['head',1]],cara:true,etiqueta:'ojo',datos,ao:false,ocluye:false});}
  // Ceja: cinta de luz sobre el ojo (t=0 adentro … 1 afuera).
  {const pos=[],uv=[],idx=[],datos=[],M=N(20);for(let i=0;i<=M;i++)for(const k of [-1,1]){const t=i/M;const [x,y]=cejaPunto(t,k,{},s);pos.push(...sobreVisor(x,y,CAPA.ceja));uv.push(...atlas.uv('linea',t,k*.5+.5));datos.push({ceja:L,s,t,k});}
   for(let i=0;i<M;i++){const A=i*2;if(s>0)idx.push(A,A+2,A+1,A+1,A+2,A+3);else idx.push(A,A+1,A+2,A+1,A+3,A+2);}
   const g=geometria(pos,idx,{uv});K.agregar(g,{material:'brillo',hueso:'head',cara:true,etiqueta:'ceja',datos,ao:false,ocluye:false});}
  // Rubor (escondido bajo el vidrio hasta que «rubor» lo trae).
  {const pos=[],uv=[],idx=[],datos=[],R=3,S=N(20),c=[(.112)*s,1.487];for(let j=0;j<=R;j++)for(let i=0;i<=S;i++){const r=j/R,a=i/S*TAU;const ex=Math.cos(a)*.025*r,ey=Math.sin(a)*.014*r;pos.push(...sobreVisor(c[0]+ex*.02,c[1]+ey*.02,-.0015));uv.push(...atlas.uv('rubor',.5+Math.cos(a)*r*.5,.5+Math.sin(a)*r*.5));datos.push({rubor:1,c,ex,ey});}
   for(let j=0;j<R;j++)for(let i=0;i<S;i++){const A=j*(S+1)+i,B=A+S+1;idx.push(A,B,A+1,B,B+1,A+1);}
   const g=geometria(pos,idx,{uv});const n=g.attributes.normal;for(let i=0;i<n.count;i++)n.setXYZ(i,0,0,1);K.agregar(g,{material:'brillo',hueso:'head',cara:true,etiqueta:'rubor',datos,ao:false,ocluye:false});}
 }
 // Boca: trazo de luz + relleno tenue; su forma sale de parámetros (ver bocaPunto).
 {const M=N(72);
  const trazo=[],uvT=[],idxT=[],datT=[];for(let i=0;i<=M;i++)for(const k of [-1,1]){const t=i/M;const [x,y]=bocaPunto(t,k,BOCA_NEUTRA);trazo.push(...sobreVisor(x,y,CAPA.boca));uvT.push(...atlas.uv('linea',t,k*.5+.5));datT.push({boca:'trazo',t,k});}
  for(let i=0;i<M;i++){const A=i*2;idxT.push(A,A+1,A+2,A+1,A+3,A+2);}
  const g=geometria(trazo,idxT,{uv:uvT});K.agregar(g,{material:'brillo',hueso:'head',cara:true,etiqueta:'boca',datos:datT,ao:false,ocluye:false});
  const rel=[],uvR=[],idxR=[],datR=[],R=3;for(let j=0;j<=R;j++)for(let i=0;i<=M;i++){const t=i/M,r=j/R;const [x,y]=bocaRelleno(t,r,BOCA_NEUTRA);rel.push(...sobreVisor(x,y,CAPA.relleno));uvR.push(...atlas.uv('relleno',t,r));datR.push({boca:'relleno',t,r});}
  for(let j=0;j<R;j++)for(let i=0;i<M;i++){const A=j*(M+1)+i,B=A+M+1;idxR.push(A,B,A+1,B,B+1,A+1);}
  const gr=geometria(rel,idxR,{uv:uvR});K.agregar(gr,{material:'brillo',hueso:'head',cara:true,etiqueta:'boca',datos:datR,ao:false,ocluye:false});
  // Lengüita (escondida; «tongueOut» la muestra).
  const len=[],uvL=[],idxL=[],datL=[],S=N(18);for(let j=0;j<=2;j++)for(let i=0;i<=S;i++){const r=j/2,a=i/S*TAU;const ex=Math.cos(a)*.011*r,ey=Math.sin(a)*.009*r;len.push(...sobreVisor(ex*.03,BOCA.y-.004+ey*.03,-.0015));uvL.push(...atlas.uv('lengua',.5+Math.cos(a)*r*.5,.5+Math.sin(a)*r*.5));datL.push({lengua:1,ex,ey});}
  for(let j=0;j<2;j++)for(let i=0;i<S;i++){const A=j*(S+1)+i,B=A+S+1;idxL.push(A,B,A+1,B,B+1,A+1);}
  const gl=geometria(len,idxL,{uv:uvL});K.agregar(gl,{material:'brillo',hueso:'head',cara:true,etiqueta:'lengua',datos:datL,ao:false,ocluye:false});}

 // ── manos flotantes ────────────────────────────────────────────────────────────────────────
 for(const [lado,s] of [['left',1],['right',-1]]){
  const H=manoBase(s);
  for(const pz of H.piezas(N))K.agregar(pz.g,{material:pz.material,hueso:pz.hueso?lado+pz.hueso:lado+'Hand',color:pz.color||marfil,uvEscala:[6,6]});
 }

 // ── órbita de oro con dos luces que la recorren ────────────────────────────────────────────
 const ORB={r:.54,tubo:.0075,rx:.2,rz:-.12,y:1.15};
 const qOrb=new T.Quaternion().setFromEuler(new T.Euler(ORB.rx,0,ORB.rz));
 {const g=rejilla(N(180),N(10),(u,v)=>{const th=u*TAU,ph=v*TAU,R=ORB.r+ORB.tubo*Math.cos(ph);const p=new T.Vector3(R*Math.cos(th),ORB.tubo*Math.sin(ph),R*Math.sin(th)).applyQuaternion(qOrb);return [p.x,p.y+ORB.y,p.z];},{cerradaU:true,invertir:true});
  K.agregar(g,{material:'oro',hueso:'orbita',ao:false,ocluye:false});
  for(const a of [0,Math.PI]){const p=new T.Vector3(ORB.r*Math.cos(a),0,ORB.r*Math.sin(a)).applyQuaternion(qOrb);const b=elipsoide([.011,.011,.011],{c:[p.x,p.y+ORB.y,p.z],nu:N(14),nv:N(9)});
   const uvB=b.attributes.uv;for(let i=0;i<uvB.count;i++){const [uu,vv]=atlas.uv('luz',.5+(uvB.getY(i)-.5)*.6,.5);uvB.setXY(i,uu,vv);}K.agregar(b,{material:'brillo',hueso:'orbitaLuz',ao:false,ocluye:false});}}

 // ── morphs: la cara entera es luz sobre el visor ───────────────────────────────────────────
 const campo=campoCompleto((nombre,info)=>campoAura(nombre,info));
 const r=K.construir({nombre:'AURA',morphs:campo,ao:alta?{rayos:20,distancia:.06,fuerza:.55}:{rayos:10,distancia:.06,fuerza:.5}});

 // Zonas tocables y cámaras sugeridas.
 zona(esq,'zona_cabeza','head',[0,1.64,-.01],[.23,.12,.21],mat.zona);
 zona(esq,'zona_mejilla_izq','head',[.17,1.47,.19],[.065,.06,.065],mat.zona);
 zona(esq,'zona_mejilla_der','head',[-.17,1.47,.19],[.065,.06,.065],mat.zona);
 zona(esq,'zona_panza','chest',[0,1.18,.1],[.22,.09,.16],mat.zona);
 camaraNodo(r.raiz,'camara_retrato',[0,1.5,0],1.35);
 camaraNodo(r.raiz,'camara_cuerpo',[0,1.38,0],2.5);

 const perfil=perfilAura(ORB,qOrb);
 const clips=crearClips(esq,perfil);
 r.raiz.userData={personaje:'AU-RA',identidad:'Grafito · Orbe',version:'2.0.0',calidad,rig:'esqueleto VRM con piel, 67+1 morphs en la cara'};
 return {raiz:r.raiz,clips,perfil,esqueleto:esq,mallas:{cuerpo:r.cuerpo,cara:r.cara},materiales:mat,anclas:perfil.anclas};
}

/* ── la cara: parámetros y campos de morph ──────────────────────────────────────────────── */

const BOCA_NEUTRA={wI:.034,wD:.034,upI:.0012,upD:.0012,dnI:.0012,dnD:.0012,cI:.0065,cD:.0065,x:0,dy:0,ro:0,rr:.01};
/** Contorno de la boca (t∈[0,1) alrededor) desplazado ±k·grosor/2 hacia afuera. Izquierda = +X. */
function bocaContorno(t,p){
 const a=t*TAU,c=Math.cos(a),s=Math.sin(a),izq=c>=0,f=(c+1)/2;
 let x=(izq?p.wI:p.wD)*c;
 const up=lerp(p.upD,p.upI,f),dn=lerp(p.dnD,p.dnI,f);
 const cc=(izq?p.cI:p.cD)*(c*c-.35);let y=(s>=0?up:dn)*s+cc*(s>=0?.55:1);
 x=lerp(x,p.rr*c,p.ro);y=lerp(y,p.rr*s*1.1,p.ro);
 return [(x+p.x)*BOCA.escala,(y+p.dy)*BOCA.escala];
}
function bocaPunto(t,k,p){
 const e=1e-3,a=bocaContorno(t,p),b=bocaContorno(t+e,p),c=bocaContorno(t-e,p);
 let nx=b[1]-c[1],ny=-(b[0]-c[0]);const l=Math.hypot(nx,ny)||1;nx/=l;ny/=l;
 const g=.0026*(1-.35*Math.abs(Math.cos(t*TAU))**6);
 return [a[0]+nx*g*k,BOCA.y+a[1]+ny*g*k];
}
function bocaRelleno(t,r,p){const a=bocaContorno(t,p);const cx=p.x*BOCA.escala,cy=p.dy*BOCA.escala;return [cx+(a[0]-cx)*r*.96,BOCA.y+cy+(a[1]-cy)*r*.96];}
/** Deltas de parámetros de boca por forma ARKit. */
function bocaParam(nombre){
 const d={};
 switch(nombre){
  case 'jawOpen':Object.assign(d,{dnI:.024,dnD:.024,upI:.004,upD:.004,wI:-.005,wD:-.005,dy:-.003});break;
  case 'mouthClose':Object.assign(d,{upI:-.0012,upD:-.0012,dnI:-.0012,dnD:-.0012,wI:-.001,wD:-.001});break;
  case 'mouthFunnel':Object.assign(d,{ro:.85,rr:.013,upI:.01,upD:.01,dnI:.012,dnD:.012,cI:-.006,cD:-.006});break;
  case 'mouthPucker':Object.assign(d,{ro:.95,rr:.0075,upI:.004,upD:.004,dnI:.004,dnD:.004,cI:-.006,cD:-.006});break;
  case 'mouthLeft':d.x=.012;break;case 'mouthRight':d.x=-.012;break;
  case 'mouthSmileLeft':Object.assign(d,{cI:.015,wI:.005,upI:.0008});break;case 'mouthSmileRight':Object.assign(d,{cD:.015,wD:.005,upD:.0008});break;
  case 'mouthFrownLeft':Object.assign(d,{cI:-.024,wI:-.003,dy:-.001});break;case 'mouthFrownRight':Object.assign(d,{cD:-.024,wD:-.003,dy:-.001});break;
  case 'mouthDimpleLeft':Object.assign(d,{wI:.004,cI:.003});break;case 'mouthDimpleRight':Object.assign(d,{wD:.004,cD:.003});break;
  case 'mouthStretchLeft':Object.assign(d,{wI:.01,cI:-.002,dnI:.002});break;case 'mouthStretchRight':Object.assign(d,{wD:.01,cD:-.002,dnD:.002});break;
  case 'mouthRollLower':Object.assign(d,{dnI:-.0012,dnD:-.0012,dy:.0018});break;case 'mouthRollUpper':Object.assign(d,{upI:-.0012,upD:-.0012,dy:-.0018});break;
  case 'mouthShrugLower':Object.assign(d,{dy:.004,dnI:-.0008,dnD:-.0008});break;case 'mouthShrugUpper':Object.assign(d,{dy:.003,upI:-.0008,upD:-.0008});break;
  case 'mouthPressLeft':Object.assign(d,{wI:.003,upI:-.0012,dnI:-.0012});break;case 'mouthPressRight':Object.assign(d,{wD:.003,upD:-.0012,dnD:-.0012});break;
  case 'mouthLowerDownLeft':d.dnI=.012;break;case 'mouthLowerDownRight':d.dnD=.012;break;
  case 'mouthUpperUpLeft':d.upI=.008;break;case 'mouthUpperUpRight':d.upD=.008;break;
  case 'jawForward':Object.assign(d,{dy:-.001,wI:-.002,wD:-.002});break;
  case 'jawLeft':Object.assign(d,{x:.006,dnI:.002,dnD:.002});break;case 'jawRight':Object.assign(d,{x:-.006,dnI:.002,dnD:.002});break;
  case 'cheekPuff':Object.assign(d,{wI:.004,wD:.004,ro:.2,rr:.03});break;
  case 'tongueOut':Object.assign(d,{dnI:.009,dnD:.009,upI:.001,upD:.001});break;
  case 'noseSneerLeft':Object.assign(d,{upI:.004,cI:-.002});break;case 'noseSneerRight':Object.assign(d,{upD:.004,cD:-.002});break;
  default:return null;
 }
 return d;
}
const sumarParam=(a,d)=>{const r={...a};for(const k in d)r[k]=(r[k]||0)+d[k];if(d.ro)r.rr=d.rr;return r;};

/** Punto de ceja: t=0 extremo interior, 1 exterior; k=-1/1 los dos bordes de la cinta. */
function cejaPunto(t,k,d,s){
 const xi=.036,xo=.094,base=OJO.y+OJO.b+.013;
 let x=lerp(xi,xo,t),y=base+.0065*Math.sin(Math.PI*(.15+.8*t));
 y+=(d.adentro||0)*(1-t)**1.5+(d.afuera||0)*t**1.5+(d.todo||0);x+=(d.x||0)*(1-t);
 const g=.0019*Math.sin(Math.PI*(.06+.9*t))**.6;
 return [x*s,y+k*g];
}
function cejaParam(nombre,s){
 const lado=s>0?'Left':'Right';
 switch(nombre){
  case 'browDown'+lado:return {adentro:-.011,afuera:.002,todo:-.004,x:-.002};
  case 'browInnerUp':return {adentro:.012,todo:.002};
  case 'browOuterUp'+lado:return {afuera:.011,todo:.004};
  case 'eyeWide'+lado:return {todo:.004};
  case 'eyeSquint'+lado:return {todo:-.002};
  case 'noseSneer'+lado:return {adentro:-.005,todo:-.002};
  case 'cheekSquint'+lado:return {todo:-.001};
  default:return null;
 }
}
/** Transformación 2D del ojo (coordenadas locales ex,ey) para cada forma. */
function ojoForma(nombre,dato){
 const s=dato.s,lado=s>0?'Left':'Right',capa=dato.capa,A=OJO.a,B=OJO.b;
 const mueve=(dx,dy)=>{const k=capa==='iris'||capa==='pestana'?.28:capa==='destello'?.55:1;return (ex,ey)=>[ex+dx*k,ey+dy*k];};
 const corte=(recta)=>(ex,ey)=>{const xs=ex*s/A,lim=B*recta(xs);if(ey<=lim)return [ex,ey];const t=capa==='iris'?1:.9;return [ex,lim-(ey-lim)*.05*t];};
 const achica=(k,dy)=>(ex,ey)=>capa==='pupila'||capa==='destello'?[ex*k,ey*k+dy]:[ex,ey];
 switch(nombre){
  case 'browDown'+lado:return corte(xs=>.18+.62*xs);
  case 'browInnerUp':return corte(xs=>.38-.55*xs);
  case 'eyeBlink'+lado:return (ex,ey)=>{const xn=ex/A;const arco=-.2*B-.18*B*(1-xn*xn);const grueso=capa==='iris'?.11:0;return [ex*.96,arco+ey*grueso];};
  case 'eyeSquint'+lado:return (ex,ey)=>{if(capa==='pupila'||capa==='destello')[ex,ey]=[ex*.45,ey*.45+B*.28];const xn=Math.max(-1,Math.min(1,ex/A)),bn=-.05+.55*(1-xn*xn),yn=ey/B;return [ex,B*(bn+(yn+1)/2*(1-bn))];};
  case 'cheekSquint'+lado:return (ex,ey)=>{const xn=Math.max(-1,Math.min(1,ex/A)),bn=-.55+.35*(1-xn*xn),yn=ey/B;return [ex,B*(yn<bn?bn+(yn-bn)*.3:yn)+(yn<0?.0015:0)];};
  case 'eyeWide'+lado:return (ex,ey)=>[ex*1.08,ey*1.2];
  case 'eyeLookUp'+lado:return mueve(0,.0105);
  case 'eyeLookDown'+lado:return mueve(0,-.011);
  case 'eyeLookIn'+lado:return mueve(-.0095*s,0);
  case 'eyeLookOut'+lado:return mueve(.0095*s,0);
  default:return null;
 }
}
function campoAura(nombre,{p,dato}){
 if(!dato)return null;
 if(dato.ojo){
  const f=ojoForma(nombre,dato);if(!f)return null;
  const cx=OJO.x*dato.s,[ex,ey]=f(dato.ex,dato.ey);
  if(dato.capa==='pestana'){const cierra=nombre.startsWith('eyeBlink');const dx=dato.dx*(cierra?.9:1),dy=cierra?-dato.dy*.7:dato.dy;const q=sobreVisor(cx+ex+dx,OJO.y+ey+dy,CAPA.pestana);return [q[0]-p.x,q[1]-p.y,q[2]-p.z];}
  const q=sobreVisor(cx+ex,OJO.y+ey,CAPA[dato.capa]);return [q[0]-p.x,q[1]-p.y,q[2]-p.z];
 }
 if(dato.ceja){
  const d=cejaParam(nombre,dato.s);if(!d)return null;const [x,y]=cejaPunto(dato.t,dato.k,d,dato.s);const q=sobreVisor(x,y,CAPA.ceja);return [q[0]-p.x,q[1]-p.y,q[2]-p.z];
 }
 if(dato.boca){
  const d=bocaParam(nombre);if(!d)return null;const pr=sumarParam(BOCA_NEUTRA,d);
  const [x,y]=dato.boca==='trazo'?bocaPunto(dato.t,dato.k,pr):bocaRelleno(dato.t,dato.r,pr);const q=sobreVisor(x,y,dato.boca==='trazo'?CAPA.boca:CAPA.relleno);return [q[0]-p.x,q[1]-p.y,q[2]-p.z];
 }
 if(dato.rubor){
  if(nombre!=='rubor'&&!nombre.startsWith('cheekSquint'))return null;
  const k=nombre==='rubor'?1:(nombre==='cheekSquint'+(dato.c[0]>0?'Left':'Right')?.35:0);if(!k)return null;
  const q=sobreVisor(dato.c[0]+dato.ex,dato.c[1]+dato.ey,CAPA.rubor);return [(q[0]-p.x)*k,(q[1]-p.y)*k,(q[2]-p.z)*k];
 }
 if(dato.lengua){
  if(nombre!=='tongueOut')return null;const q=sobreVisor(dato.ex,BOCA.y-.0165+dato.ey,CAPA.lengua);return [q[0]-p.x,q[1]-p.y,q[2]-p.z];
 }
 return null;
}

/* ── manos ──────────────────────────────────────────────────────────────────────────────── */

/** Mano flotante izquierda (s=1) o derecha (s=-1): huesos y piezas en su pose de reposo. */
function manoBase(s){
 const origen=[.345*s,1.285,.05];
 const f=new T.Vector3(.12*s,-1,.22).normalize(),n=new T.Vector3(-s,0,0);n.addScaledVector(f,-n.dot(f)).normalize();
 const sx=new T.Vector3().crossVectors(f,n);if(s<0)sx.negate();
 // Canónico: x lateral (pulgar en −x), y a lo largo de los dedos, z hacia la palma.
 const E=1.55; // manos grandes y expresivas (se leen a 104 px)
 const M=(x,y,z)=>{x*=E;y*=E;z*=E;return [origen[0]+sx.x*x+f.x*y+n.x*z,origen[1]+sx.y*x+f.y*y+n.y*z,origen[2]+sx.z*x+f.z*y+n.z*z];};
 const DEDOS={indice:[-.0175,.037],medio:[-.0058,.041],anular:[.0058,.037],menique:[.0168,.031]};
 const hueso=nombre=>{if(nombre==='pulgar')return M(-.024,.03,.006);if(nombre==='resto')return M(.0113,.064,0);const [x]=DEDOS[nombre];return M(x,.064,0);};
 const piezas=N=>{
  const out=[];const trans=(g)=>{const p=g.attributes.position;for(let i=0;i<p.count;i++){const q=M(p.getX(i),p.getY(i),p.getZ(i));p.setXYZ(i,...q);}if(s<0){const ix=g.index.array;for(let i=0;i<ix.length;i+=3){const t=ix[i];ix[i]=ix[i+2];ix[i+2]=t;}}g.computeVertexNormals();suavizarCostura(g);return g;};
  out.push({g:trans(elipsoide([.030,.037,.0155],{c:[0,.034,0],nu:N(28),nv:N(18),e1:.85,e2:.9,forma:(x,y,z)=>[x*(1+.12*(y-.034)/.037),y,z*(1-.25*Math.max(0,(y-.034)/.037))]})),material:'ceramica'});
  out.push({g:trans(rejilla(N(24),3,(u,v)=>{const th=u*TAU,r=.0205+.002*Math.sin(v*Math.PI);return [r*Math.cos(th),-.012+v*.018,r*Math.sin(th)*.8];},{cerradaU:true,invertir:true})),material:'ceramica'});
  out.push({g:trans(rejilla(N(28),N(6),(u,v)=>{const th=u*TAU,ph=v*TAU,R=.0215+.0033*Math.cos(ph);return [R*Math.cos(th),-.004+.0033*Math.sin(ph),R*Math.sin(th)*.82];},{cerradaU:true,invertir:true})),material:'oro'});
  out.push({g:trans(elipsoide([.019,.022,.004],{c:[0,.036,.0135],nu:N(18),nv:N(10)})),material:'grafito',color:rgb('#2a2c31')});
  for(const [nombre,[x,L]] of Object.entries(DEDOS)){
   const g=barrido([[x,.058,0],[x*1.02,.058+L*.5,.003],[x*1.05,.058+L,.009]],t=>.0079-.0012*t,{lados:N(12),pasos:N(8)});
   out.push({g:trans(g),material:'ceramica',hueso:nombre==='indice'?'IndexProximal':nombre==='medio'?'MiddleProximal':'RingProximal'});
  }
  out.push({g:trans(barrido([[-.02,.024,.004],[-.032,.04,.01],[-.038,.056,.016]],t=>.0088-.0015*t,{lados:N(12),pasos:N(8)})),material:'ceramica',hueso:'ThumbProximal'});
  return out;
 };
 return {origen,hueso,piezas,f,n};
}

/* ── perfil de animación ────────────────────────────────────────────────────────────────── */

function perfilAura(ORB,qOrb){
 const nOrb=new T.Vector3(0,1,0).applyQuaternion(qOrb);
 const lados={izq:{brazo:'leftUpperArm',antebrazo:'leftLowerArm',mano:'leftHand',dedos:{pulgar:['leftThumbProximal'],indice:['leftIndexProximal'],medio:['leftMiddleProximal'],resto:['leftRingProximal']}},
  der:{brazo:'rightUpperArm',antebrazo:'rightLowerArm',mano:'rightHand',dedos:{pulgar:['rightThumbProximal'],indice:['rightIndexProximal'],medio:['rightMiddleProximal'],resto:['rightRingProximal']}}};
 const eu=new T.Euler();const giroOrb=a=>{eu.setFromQuaternion(new T.Quaternion().setFromAxisAngle(nOrb,a),'YXZ');return [eu.x,eu.y,eu.z];};
 return {
  cadera:'hips',columna:'spine',pecho:'chest',pechoAlto:'upperChest',cuello:'neck',cabeza:'head',ojos:['leftEye','rightEye'],hombros:['leftShoulder','rightShoulder'],
  lados,flota:true,amplitud:1,dedosReposo:.12,
  manoReposo:{dedos:[.12,-1,.22],palma:[-1,0,0]},codo:[.4,-.6,-1],
  brazoReposo:{brazo:[0,0,0],antebrazo:[0,0,0]},
  // Anclas en el lado izquierdo (se reflejan para la derecha). Espacio de cabeza: desde head (0,1.20,0).
  anclas:{
   mejilla:[.23,.16,.17],menton:[.03,.1,.29],saludo:[.37,.26,.13],arriba:[.27,.6,.05],estirar:[.25,.58,-.04],
   explicar:[.22,.12,.27],cruzado:[-.02,.08,.3],senal:[.34,-.2,.2],juntas:[.05,.14,.3],caminar:[.35,.04,-.08],
   panza:[.12,.12,.27],jarra:[.34,.14,.04]
  },
  extras:(t,clip,x)=>{
   // Las luces recorren la órbita (media vuelta por ciclo cierra el bucle: son dos, opuestas).
   const dur={idle:6,escuchar:4,hablar:4,pensar:4,dormir:5,levantada:2,caminar:1.1}[clip]||x.dur||6;
   const vel=clip==='dormir'?.5:1;let fase=Math.PI*t/dur*vel*(clip==='dormir'?2:1);
   if(clip==='celebrar')fase+=Math.PI*2*(x.e||0);
   const wob=Math.sin(t/dur*Math.PI*2);
   const r={orbitaLuz:giroOrb(fase),orbita:[.035*wob,0,.03*Math.cos(t/dur*Math.PI*2)]};
   if(clip==='toque_panza')r.orbita=[.08*(x.b||0),0,.06*(x.b||0)];
   if(clip==='enojo')r.orbita=[-.06*(x.e||0),0,.05*(x.n||0)];
   if(clip==='dormir')r.orbita=[.02*wob,0,-.05];
   return r;
  }
 };
}
