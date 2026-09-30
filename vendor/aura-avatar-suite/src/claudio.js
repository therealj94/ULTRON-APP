import * as T from 'three';
import {rejilla,barrido,elipsoide,geometria,suave,clamp,TAU,lerp,suavizarCostura,burbuja,curva,deformar} from './kit/geo.js';
import {Esqueleto,Constructor,rgb,mezclaColor,zona,camaraNodo,pesosArticulacion} from './kit/cuerpo.js';
import {campoCompleto} from './kit/cara.js';
import {MeshBVH} from 'three-mesh-bvh';
import {crearClips} from './kit/animaciones.js';
import {normalPelo,normalTejido} from './kit/texturas.js';

// CLAUDIO, versión móvil. Zorro masculino naranja con hocico crema, lentes ámbar tipo wayfarer,
// sudadera negra con capucha, cordones y la corona verde bordada, joggers y tenis negros, y una
// cola grande con punta clara. Pelo estilizado en MECHONES GRUESOS y redondeados (mejillas,
// coronilla, cola, orejas), sin púas ni ruido. Boca con corte real (se abre), dientes, colmillos y
// lengua; párpados que cierran; orejas que se mueven con la cara (morphs) y con los clips.
// Metros, mirando hacia +Z, cabeza (hueso) a 1,22 m, pies en y = 0.

/* ── la cabeza: superficie única definida por dirección ──────────────────────────────────── */

const C=new T.Vector3(0,1.385,0);           // centro de la cabeza (el hueso head, en la base del cráneo, a 1,22)
const RA=[.23,.213,.212];                    // semiejes base
const nrm=(x,y,z)=>{const l=Math.hypot(x,y,z)||1;return [x/l,y/l,z/l];};
/** Coordenadas angulares de d en el plano tangente de un rasgo centrado en c (con ancho wx, wy). */
function rasgo(d,c,wx,wy){
 const dot=d[0]*c[0]+d[1]*c[1]+d[2]*c[2];if(dot<=0)return 9;
 let t1=[c[2],0,-c[0]];const l=Math.hypot(...t1)||1;t1=t1.map(v=>v/l);
 const t2=[c[1]*t1[2]-c[2]*t1[1],c[2]*t1[0]-c[0]*t1[2],c[0]*t1[1]-c[1]*t1[0]];
 const ax=(d[0]*t1[0]+d[1]*t1[1]+d[2]*t1[2])/wx,ay=(d[0]*t2[0]+d[1]*t2[1]+d[2]*t2[2])/wy;return Math.hypot(ax,ay);
}
const HOCICO=nrm(0,-.36,.93),MEJILLA=[nrm(.78,-.42,.46),nrm(-.78,-.42,.46)],OJOD=[nrm(.43,.2,.88),nrm(-.43,.2,.88)];
/** Punto de la piel de la cabeza para la dirección d (unitaria, desde C). */
function piel(d){
 let [x,y,z]=[d[0]*RA[0],d[1]*RA[1],d[2]*RA[2]];
 // Mejillas llenas (la «melena» corta del zorro), coronilla apenas aplanada, nuca llena.
 for(const m of MEJILLA){const q=rasgo(d,m,.55,.45);if(q<1.6){const k=.034*Math.exp(-q*q*1.4);x+=d[0]*k;y+=d[1]*k*.5;z+=d[2]*k;}}
 if(d[1]>.6)y-=(d[1]-.6)*.03;
 // Base de la cabeza ancha: la «papada» de pelo esconde el cuello.
 if(d[1]<-.45){const k=suave(-.45,-.98,d[1]);x*=1+.3*k;z*=1+.2*k;y-=.028*k;}
 // Mechones suaves en el borde de las mejillas (lóbulos redondeados, sin puntas).
 const lado=suave(.45,.8,Math.abs(d[0]))*suave(-.1,.35,d[2]+.25);
 if(lado>0){let m=0;for(const yc of [-.12,-.3,-.48])m+=Math.exp(-(((d[1]-yc)/.09)**2));const k=.009*m*lado*suave(.7,.85,Math.abs(d[0]));x+=d[0]*k;z+=d[2]*k*.5;y-=k*.5;}
 if(d[2]<-.2)z-=(-.2-d[2])*.012;
 // Cuencas de los ojos y arco de la ceja.
 for(const o of OJOD){const q=rasgo(d,o,.2,.17);if(q<2){const k=-.008*Math.exp(-q*q*1.8);x+=d[0]*k;y+=d[1]*k;z+=d[2]*k;}
  const qb=rasgo(d,nrm(o[0]*.95,o[1]+.2,o[2]),.24,.1);if(qb<2){const k=.006*Math.exp(-qb*qb*2);z+=k;}}
 // Hocico: empuja hacia adelante (+Z) con la punta más angosta; puente de la nariz hacia la frente.
 const qh=rasgo(d,HOCICO,.44,.34);
 if(qh<1){const f=(1-qh*qh)**1.5,ancho=1-.3*Math.min(1,Math.abs(d[0])/.3);z+=.128*f*ancho;x*=1-.24*f;}
 const puente=Math.exp(-((d[0]/.11)**2))*suave(-.12,.06,d[1])*(1-suave(.2,.45,d[1]))*Math.max(0,d[2]);z+=.016*puente;
 // Mentón chico bajo el hocico.
 const qm=rasgo(d,nrm(0,-.66,.75),.28,.16);if(qm<1.5){const k=.012*Math.exp(-qm*qm*2);z+=k;y-=k*.4;}
 return [C.x+x,C.y+y,C.z+z];
}
/** Dirección para la rejilla de la piel: u alrededor (0 = nuca, .5 = frente), v de abajo a arriba. */
const V_BOCA=.345,U_ESQ=.074;
function dirUV(u,v){
 const th=u*TAU;
 // Las filas cercanas a la boca se curvan hacia arriba en los lados: la boca queda en sonrisa.
 const du=u-.5,curvado=1.1*du*du*Math.exp(-(((v-V_BOCA)/.07)**2))*Math.max(0,1-Math.abs(du)/.2);
 const ph=(v-.5)*Math.PI+curvado*6;
 return [-Math.sin(th)*Math.cos(ph),Math.sin(ph),-Math.cos(th)*Math.cos(ph)];
}
const pielUV=(u,v)=>piel(dirUV(u,Math.min(1,Math.max(0,v))));
/** Normal de la piel por diferencias (para ubicar ojos, lentes y mechones). */
function normalPiel(u,v){const e=1e-3,a=pielUV(u+e,v),b=pielUV(u-e,v),c=pielUV(u,v+e),d=pielUV(u,v-e);const du=[a[0]-b[0],a[1]-b[1],a[2]-b[2]],dv=[c[0]-d[0],c[1]-d[1],c[2]-d[2]];return nrm(du[1]*dv[2]-du[2]*dv[1],du[2]*dv[0]-du[0]*dv[2],du[0]*dv[1]-du[1]*dv[0]);}
/** (u,v) de la rejilla cuya dirección es la más cercana a d (búsqueda simple). */
function uvDeDir(d){let mejor=null,md=-2;for(let i=0;i<=200;i++)for(let j=0;j<=100;j++){const u=i/200,v=j/100,q=dirUV(u,v);const k=q[0]*d[0]+q[1]*d[1]+q[2]*d[2];if(k>md){md=k;mejor=[u,v];}}return mejor;}

/** La piel de la cabeza ya armada (BVH para rayos), para acomodar la boca por dentro. */
const PIEL={bvh:null};

/* ── colores (lineales) ─────────────────────────────────────────────────────────────────── */
const COL={naranja:rgb('#cf6630'),naranjaClaro:rgb('#e0803f'),naranjaHondo:rgb('#a94b1f'),crema:rgb('#f3e4cc'),cremaHondo:rgb('#dcc7a8'),rubor:rgb('#ee9a8c'),
 labio:rgb('#3d2520'),nariz:rgb('#1d1614'),boca:rgb('#4a1414'),lengua:rgb('#d9766e'),diente:rgb('#f6f1e6'),ceja:rgb('#8e3e18'),orejaIn:rgb('#efd4c0'),punta:rgb('#3a2418'),
 sudadera:rgb('#1e1f22'),sudaderaHondo:rgb('#141517'),pantalon:rgb('#18191b'),cordon:rgb('#e6dfd1'),corona:rgb('#3fae6f'),suela:rgb('#2b2b2e'),franja:rgb('#9b9892'),zapato:rgb('#121214'),ojal:rgb('#6e6e70'),remache:rgb('#cfcfd2'),montura:rgb('#0e0e10'),iris:rgb('#c8791f')};
function colorPiel(p){
 const x=p.x-C.x,y=p.y-C.y,z=p.z-C.z,d=nrm(x/RA[0],y/RA[1],z/RA[2]);
 // Máscara crema: hocico (salvo el lomo), mejillas bajas, mentón y garganta.
 const qh=rasgo(d,HOCICO,.5,.4);
 const lomo=Math.exp(-((x/.028)**2))*suave(-.03,.03,y)*(z>.1?1:0);
 let crema=Math.max(1-suave(.75,1.0,qh),0)*(1-lomo*.85);
 const linea=-.075-.12*(x/.2)**2;crema=Math.max(crema,(1-suave(linea-.012,linea+.012,y))*suave(-.35,.0,d[2]+.25));
 let c=mezclaColor(COL.naranja,COL.crema,clamp(crema));
 if(y>.1)c=mezclaColor(c,COL.naranjaClaro,clamp((y-.1)/.1)*.35*(1-crema));
 // Rubor permanente en las mejillas (identidad de la referencia).
 for(const s of [1,-1]){const r=Math.hypot(x-.125*s,(y+.05)*1.3,Math.max(0,.14-z)*.6);c=mezclaColor(c,COL.rubor,.42*Math.exp(-((r/.036)**2)));}
 return c;
}

/* ── el generador ───────────────────────────────────────────────────────────────────────── */

export function crearClaudio({calidad='alta'}={}){
 const alta=calidad!=='baja',q=alta?1:.5;const N=v=>Math.max(6,Math.round(v*q));PIEL.bvh=null;
 const mat={
  pelaje:new T.MeshStandardMaterial({name:'pelaje',color:'#ffffff',vertexColors:true,roughness:.82,normalMap:alta?normalPelo():null,normalScale:new T.Vector2(.55,.55)}),
  tela:new T.MeshStandardMaterial({name:'tela',color:'#ffffff',vertexColors:true,roughness:.92,normalMap:alta?normalTejido():null,normalScale:new T.Vector2(.7,.7)}),
  brillo:new T.MeshPhysicalMaterial({name:'brillo',color:'#ffffff',vertexColors:true,roughness:.3,clearcoat:.9,clearcoatRoughness:.12}),
  ojo:new T.MeshPhysicalMaterial({name:'ojo',color:'#ffffff',map:texturaOjo(),roughness:.18,clearcoat:1,clearcoatRoughness:.05}),
  lente:new T.MeshPhysicalMaterial({name:'lente',color:'#e8961c',transparent:true,opacity:.5,roughness:.06,metalness:0,specularIntensity:.5,clearcoat:.6,clearcoatRoughness:.05,depthWrite:false}),
  zona:new T.MeshBasicMaterial({name:'zona',transparent:true,opacity:0,depthWrite:false})
 };
 mat.lente.side=T.FrontSide;
 const ojoPos=s=>{const [u,v]=uvDeDir(OJOD[s>0?0:1]);return {u,v,p:pielUV(u,v),n:normalPiel(u,v)};};
 const OJ={I:ojoPos(1),D:ojoPos(-1)};
 const RE=.05; // radio del globo ocular (casquete poco profundo: el párpado lineal no se hunde)
 const centroOjo=s=>{const o=s>0?OJ.I:OJ.D;return [o.p[0]-o.n[0]*.03,o.p[1]-o.n[1]*.03,o.p[2]-o.n[2]*.03];};
 const H=manoZorro;
 const esq=new Esqueleto([
  {n:'hips',x:[0,.76,0]},{n:'spine',p:'hips',x:[0,.86,0]},{n:'chest',p:'spine',x:[0,.98,0]},{n:'upperChest',p:'chest',x:[0,1.07,0]},
  {n:'neck',p:'upperChest',x:[0,1.15,0]},{n:'head',p:'neck',x:[0,1.22,0]},
  {n:'leftEye',p:'head',x:centroOjo(1)},{n:'rightEye',p:'head',x:centroOjo(-1)},{n:'jaw',p:'head',x:[0,1.37,.02]},
  {n:'orejaIzq',p:'head',x:[.135,1.555,-.02]},{n:'orejaIzqPunta',p:'orejaIzq',x:[.195,1.71,-.035]},
  {n:'orejaDer',p:'head',x:[-.135,1.555,-.02]},{n:'orejaDerPunta',p:'orejaDer',x:[-.195,1.71,-.035]},
  ...['left','right'].flatMap(l=>{const s=l==='left'?1:-1,m=v=>[v[0]*s,v[1],v[2]];const h=H(s);return [
   {n:l+'Shoulder',p:'upperChest',x:m([.07,1.12,0])},{n:l+'UpperArm',p:l+'Shoulder',x:m([.165,1.105,-.005])},{n:l+'LowerArm',p:l+'UpperArm',x:m([.285,.93,-.012])},{n:l+'Hand',p:l+'LowerArm',x:h.origen},
   ...['Thumb','Index','Middle','Ring'].flatMap(f=>[{n:l+f+'Proximal',p:l+'Hand',x:h.hueso(f,0)},{n:l+f+'Distal',p:l+f+'Proximal',x:h.hueso(f,1)}])];}),
  ...['left','right'].flatMap(l=>{const s=l==='left'?1:-1;return [
   {n:l+'UpperLeg',p:'hips',x:[.095*s,.7,0]},{n:l+'LowerLeg',p:l+'UpperLeg',x:[.1*s,.39,.012]},{n:l+'Foot',p:l+'LowerLeg',x:[.1*s,.085,0]},{n:l+'Toes',p:l+'Foot',x:[.1*s,.03,.11]}];}),
  ...COLA_PUNTOS_HUESOS.map((x,i)=>({n:'cola'+(i+1),p:i?'cola'+i:'hips',x}))
 ]);
 const K=new Constructor(esq,mat);

 /* ── piel de la cabeza con corte de boca (va en la malla de cara) ────────────────────────── */
 {const NU=N(104),NV=N(64);
  const g=rejilla(NU,NV,pielUV,{cerradaU:true,uvEscala:[18,9]});
  // Corte de boca: la fila de la boca se duplica entre las comisuras; la copia es el labio de arriba.
  const jM=Math.round(V_BOCA*NV),iA=Math.round((.5-U_ESQ)*NU),iB=Math.round((.5+U_ESQ)*NU);
  const pos=g.attributes.position,nor=g.attributes.normal,uv=g.attributes.uv,base=pos.count;
  const P=[...pos.array],Nn=[...nor.array],U=[...uv.array],dup=new Map();
  for(let i=iA+1;i<iB;i++){const k=jM*(NU+1)+i;dup.set(k,P.length/3);P.push(pos.getX(k),pos.getY(k),pos.getZ(k));Nn.push(nor.getX(k),nor.getY(k),nor.getZ(k));U.push(uv.getX(k),uv.getY(k));}
  const idx=[...g.index.array];
  // Los triángulos de la banda de arriba (filas jM..jM+1) usan la copia.
  for(let j=jM;j<=jM;j++)for(let i=iA;i<iB;i++){const t=(j*NU+i)*6;for(let k=0;k<6;k++){const vtx=idx[t+k];if(dup.has(vtx))idx[t+k]=dup.get(vtx);}}
  // Faldones de labio hacia adentro (dan grosor al abrir; oscuros).
  const lab=(fila,arriba)=>{const ini=P.length/3;for(let i=iA;i<=iB;i++){const k=jM*(NU+1)+i;const v0=arriba&&dup.has(k)?dup.get(k):k;const x=P[v0*3],y=P[v0*3+1],z=P[v0*3+2];
    const tt=(i-iA)/(iB-iA),prof=Math.sin(Math.PI*tt);P.push(x*.97,y+(arriba?.004:-.004)*prof,z-.012*prof-.001);Nn.push(0,arriba?-1:1,.2);U.push(0,0);}
   for(let i=iA;i<iB;i++){const k=jM*(NU+1)+i,k1=k+1;const a=arriba&&dup.has(k)?dup.get(k):k,b=arriba&&dup.has(k1)?dup.get(k1):k1,c=ini+(i-iA),d=c+1;if(arriba)idx.push(a,c,b,b,c,d);else idx.push(a,b,c,b,d,c);}return ini;};
  const iniSup=lab(jM,true),iniInf=lab(jM,false);
  const gg=geometria(P,idx,{uv:U,normal:Nn});
  // La piel real (con BVH) para meter la boca por dentro sin que nada asome.
  const soloPiel=new T.BufferGeometry();soloPiel.setAttribute('position',new T.Float32BufferAttribute(P,3));soloPiel.setIndex(idx.slice());PIEL.bvh=new MeshBVH(soloPiel);
  const datos=[];for(let k=0;k<gg.attributes.position.count;k++){
   let parte='piel',lado=0,j=0,i=0;
   if(k<base){j=Math.floor(k/(NU+1));i=k%(NU+1);lado=j<jM?-1:j>jM?1:-1;}
   else if(k<base+dup.size){const orig=[...dup.entries()].find(e=>e[1]===k)[0];j=jM;i=orig%(NU+1);lado=1;}
   else if(k<iniInf){parte='faldon';lado=1;i=iA+(k-iniSup);j=jM;}
   else{parte='faldon';lado=-1;i=iA+(k-iniInf);j=jM;}
   datos.push({parte,lado,fila:j-jM,col:i});
  }
  K.agregar(gg,{material:'pelaje',pesos:p=>{const h=clamp((p.y-1.2)/.05);return [['head',h],['neck',1-h]];},cara:true,etiqueta:'piel',datos,color:(p,n,k)=>{const d=datos[k];if(d.parte==='faldon')return COL.labio;const c=colorPiel(p);if(Math.abs(d.fila)<=1&&d.col>=iA&&d.col<=iB)return mezclaColor(c,COL.labio,d.fila===0?.95:.22);return c;},uvEscala:1});
 }

 /* ── ojos (globo con iris, párpados de piel) ────────────────────────────────────────────── */
 for(const s of [1,-1]){
  const L=s>0?'I':'D',o=s>0?OJ.I:OJ.D,c=centroOjo(s),fw=new T.Vector3(...o.n),up0=new T.Vector3(0,1,0),rt=new T.Vector3().crossVectors(up0,fw).normalize(),up=new T.Vector3().crossVectors(fw,rt).normalize();
  const marco={c,fw:fw.toArray(),rt:rt.toArray(),up:up.toArray()};
  const dirOjo=(x,y)=>{const zz=Math.sqrt(Math.max(0,1-x*x-y*y));return [rt.x*x+up.x*y+fw.x*zz,rt.y*x+up.y*y+fw.y*zz,rt.z*x+up.z*y+fw.z*zz];};
  // Globo: casquete de esfera (radio RE) con UV planas para el iris.
  {const pos=[],uv=[],idx=[],datos=[],A=N(28),R=N(12),amax=1.05;
   for(let j=0;j<=R;j++)for(let i=0;i<=A;i++){const r=j/R*amax,a=i/A*TAU,x=Math.sin(r)*Math.cos(a),y=Math.sin(r)*Math.sin(a),d=dirOjo(x,y);pos.push(c[0]+d[0]*RE,c[1]+d[1]*RE,c[2]+d[2]*RE);uv.push(.5+x*.5,.5+y*.5);datos.push({ojo:L,s,parte:'globo',x,y,m:marco});}
   for(let j=0;j<R;j++)for(let i=0;i<A;i++){const a=j*(A+1)+i,b=a+A+1;idx.push(a,b,a+1,b,b+1,a+1);}
   const g=geometria(pos,idx,{uv});K.agregar(g,{material:'ojo',hueso:s>0?'leftEye':'rightEye',cara:true,etiqueta:'globo',datos,ao:false});}
  // Párpados: casquetes apenas más grandes; el borde (t=0) define la apertura.
  for(const arriba of [true,false]){
   const pos=[],idx=[],datos=[],CX=N(22),RY=N(8),RL=RE+.0028;
   for(let j=0;j<=RY;j++)for(let i=0;i<=CX;i++){const xn=-1+2*i/CX,t=j/RY;const [x,y]=parpado(xn,t,arriba,'abierto');const d=dirOjo(x,y);pos.push(c[0]+d[0]*RL,c[1]+d[1]*RL,c[2]+d[2]*RL);datos.push({ojo:L,s,parte:arriba?'parpadoSup':'parpadoInf',xn,t,m:marco,RL});}
   for(let j=0;j<RY;j++)for(let i=0;i<CX;i++){const a=j*(CX+1)+i,b=a+CX+1;if(arriba)idx.push(a,a+1,b,b,a+1,b+1);else idx.push(a,b,a+1,b,b+1,a+1);}
   const g=geometria(pos,idx);K.agregar(g,{material:'pelaje',hueso:'head',cara:true,etiqueta:'parpado',datos,color:(p,n,k)=>{const d=datos[k];return d.t<.12?mezclaColor(COL.naranjaHondo,COL.labio,.4):colorPiel(p);}});
  }
  // Rubor extra (escondido bajo la piel hasta «rubor»).
  {const [u0,v0]=uvDeDir(nrm(.62*s,-.2,.76));const cp=pielUV(u0,v0),cn=normalPiel(u0,v0);const pos=[],idx=[],datos=[],A=N(18),R=3;
   const t1=new T.Vector3().crossVectors(new T.Vector3(0,1,0),new T.Vector3(...cn)).normalize(),t2=new T.Vector3().crossVectors(new T.Vector3(...cn),t1);
   for(let j=0;j<=R;j++)for(let i=0;i<=A;i++){const r=j/R,a=i/A*TAU;const ex=Math.cos(a)*.032*r,ey=Math.sin(a)*.02*r;const full=[cp[0]+t1.x*ex+t2.x*ey+cn[0]*.0035,cp[1]+t1.y*ex+t2.y*ey+cn[1]*.0035,cp[2]+t1.z*ex+t2.z*ey+cn[2]*.0035];
    pos.push(cp[0]-cn[0]*.004+(full[0]-cp[0])*.05,cp[1]-cn[1]*.004+(full[1]-cp[1])*.05,cp[2]-cn[2]*.004+(full[2]-cp[2])*.05);datos.push({rubor:1,full,r});}
   for(let j=0;j<R;j++)for(let i=0;i<A;i++){const a=j*(A+1)+i,b=a+A+1;idx.push(a,b,a+1,b,b+1,a+1);}
   const g=geometria(pos,idx);const nn=g.attributes.normal;for(let i=0;i<nn.count;i++)nn.setXYZ(i,...cn);
   K.agregar(g,{material:'pelaje',hueso:'head',cara:true,etiqueta:'rubor',datos,ao:false,ocluye:false,color:(p,n,k)=>mezclaColor(COL.rubor,rgb('#e9806f'),1-datos[k].r)});}
 }

 /* ── boca por dentro: bolsa, dientes, colmillos, lengua ─────────────────────────────────── */
 const BOCA=bocaReferencia();
 // Todo lo de adentro queda DENTRO de la piel (si un vértice asoma, se acerca al centro de la cabeza).
 // Todo lo de adentro queda DENTRO de la piel: rayo desde el centro de la boca hacia cada vértice.
 const centroBoca=new T.Vector3(0,BOCA.centro[1]-.002,BOCA.centro[2]-.062);
 const adentro=(g,margen=.006)=>{const p=g.attributes.position,v=new T.Vector3(),ray=new T.Ray();for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i);const d=v.clone().sub(centroBoca);const L=d.length();if(L<1e-6)continue;ray.set(centroBoca,d.clone().normalize());const hit=PIEL.bvh.raycastFirst(ray,T.DoubleSide);if(hit&&hit.distance<L+margen){const q=centroBoca.clone().addScaledVector(ray.direction,Math.max(0,hit.distance-margen));p.setXYZ(i,q.x,q.y,q.z);}}g.computeVertexNormals();return g;};
 {const bc=BOCA.bolsa;const g=adentro(elipsoide(bc.r,{c:bc.c,nu:N(28),nv:N(16)}),.004);const datos=[];const p=g.attributes.position;for(let i=0;i<p.count;i++)datos.push({parte:'bolsa',abajo:p.getY(i)<bc.c[1]});
  // Se ve desde adentro: invertir caras.
  const ix=g.index.array;for(let i=0;i<ix.length;i+=3){const t=ix[i];ix[i]=ix[i+2];ix[i+2]=t;}const nn=g.attributes.normal;for(let i=0;i<nn.count;i++)nn.setXYZ(i,-nn.getX(i),-nn.getY(i),-nn.getZ(i));
  K.agregar(g,{material:'brillo',hueso:'head',cara:true,etiqueta:'boca',datos,ao:false,ocluye:false,color:COL.boca});}
 {const L=BOCA.lengua;const g=adentro(elipsoide(L.r,{c:L.c,nu:N(20),nv:N(10)}),.007);const datos=[];const p=g.attributes.position;for(let i=0;i<p.count;i++)datos.push({parte:'lengua',abajo:true});
  K.agregar(g,{material:'brillo',hueso:'head',cara:true,etiqueta:'boca',datos,ao:false,ocluye:false,color:COL.lengua});}
 for(const [fila,arriba] of [[BOCA.dientesSup,true],[BOCA.dientesInf,false]]){
  const pts=fila.map(p=>new T.Vector3(...p));const cur=new T.CatmullRomCurve3(pts);
  const g=adentro(barrido(cur,t=>[.0055,.0035],{lados:8,pasos:N(18),tapas:true,arriba:[0,1,0]}),.004);const datos=[];const p=g.attributes.position;for(let i=0;i<p.count;i++)datos.push({parte:'diente',abajo:!arriba});
  K.agregar(g,{material:'brillo',hueso:'head',cara:true,etiqueta:'boca',datos,ao:false,ocluye:false,color:COL.diente});
  if(arriba)for(const s of [1,-1]){const b=BOCA.colmillo(s);const gc=adentro(barrido([b[0],b[1],b[2]],t=>.0032*(1-t*.75),{lados:8,pasos:6,tapas:true}),.003);const dc=[];for(let i=0;i<gc.attributes.position.count;i++)dc.push({parte:'diente',abajo:false});K.agregar(gc,{material:'brillo',hueso:'head',cara:true,etiqueta:'boca',datos:dc,ao:false,ocluye:false,color:COL.diente});}
 }

 /* ── nariz, cejas, mechones de mejilla y coronilla ──────────────────────────────────────── */
 {const n=BOCA.nariz;const g=elipsoide([.024,.016,.017],{c:[0,0,0],nu:N(24),nv:N(14),forma:(x,y,z)=>[x*(1+.25*Math.max(0,y/.016)),y,z*(1-.15*Math.max(0,-y/.016))]});g.rotateX(-.35);g.translate(...n);
  const datos=[];const p=g.attributes.position;for(let i=0;i<p.count;i++)datos.push({parte:'nariz'});
  K.agregar(g,{material:'brillo',hueso:'head',cara:true,etiqueta:'nariz',datos,color:COL.nariz,ao:false});}
 for(const s of [1,-1]){
  // Ceja: mechón corto y grueso de pelo más oscuro sobre el ojo (t=0 adentro, 1 afuera).
  const pts=[];for(let i=0;i<=4;i++){const t=i/4;const d=nrm((.18+.3*t)*s,.47+.05*Math.sin(Math.PI*t)-.03*t,.86-.15*t);const [u,v]=uvDeDir(d);const p=pielUV(u,v),nn=normalPiel(u,v);pts.push([p[0]+nn[0]*.006,p[1]+nn[1]*.006,p[2]+nn[2]*.006]);}
  const g=barrido(pts,t=>[.0085*Math.sin(Math.PI*(.12+.76*t))+.002,.0055],{lados:N(10),pasos:N(16),tapas:true});
  const datos=[];const p=g.attributes.position;const cur=curva(pts);const tt=[];for(let i=0;i<=40;i++)tt.push(cur.getPointAt(i/40));
  for(let i=0;i<p.count;i++){let mt=0,md=9;for(let k=0;k<tt.length;k++){const dd=tt[k].distanceToSquared(new T.Vector3(p.getX(i),p.getY(i),p.getZ(i)));if(dd<md){md=dd;mt=k/40;}}datos.push({parte:'ceja',s,t:mt});}
  K.agregar(g,{material:'pelaje',hueso:'head',cara:true,etiqueta:'ceja',datos,color:COL.ceja,uvEscala:[1,4]});
  // Mechones de mejilla: lóbulos gruesos con punta redonda (la silueta esponjosa, sin púas).
  const tufos=[];
  for(const [dx,dy,dz,largo,r0] of tufos){const d=nrm(dx*s,dy,dz);const [u,v]=uvDeDir(d);const p0=pielUV(u,v),n0=new T.Vector3(...normalPiel(u,v));
   const tg=new T.Vector3(s*.55,-.8,-.15);tg.addScaledVector(n0,-tg.dot(n0)).normalize();
   const P0=new T.Vector3(...p0),a=P0.clone().addScaledVector(n0,-.012),b=P0.clone().addScaledVector(tg,largo*.5).addScaledVector(n0,.004),cc=P0.clone().addScaledVector(tg,largo).addScaledVector(n0,.012);
   const g=barrido([a.toArray(),b.toArray(),cc.toArray()],t=>{const r=Math.max(.012,r0*(1-t)**.6);return [r,Math.max(.008,r*.6)];},{lados:N(12),pasos:N(10),tapas:true,arriba:n0.toArray()});const datos=[];const pp=g.attributes.position;for(let i=0;i<pp.count;i++)datos.push({parte:'mechon',s});
   K.agregar(g,{material:'pelaje',hueso:'head',cara:true,etiqueta:'mechon',datos,color:COL.crema,uvEscala:[1,3]});}
 }

 /* ── orejas (en la malla de cara: se mueven con las expresiones) ────────────────────────── */
 for(const s of [1,-1]){
  const base=[.135*s,1.55,-.02],punta=[.205*s,1.795,-.04];const eje=new T.Vector3(...punta).sub(new T.Vector3(...base));const largo=eje.length();eje.normalize();
  const frente=new T.Vector3(.18*s,.05,1).normalize();frente.addScaledVector(eje,-frente.dot(eje)).normalize();const lat=new T.Vector3().crossVectors(eje,frente).normalize();
  const hueso=s>0?'orejaIzq':'orejaDer',puntaH=s>0?'orejaIzqPunta':'orejaDerPunta';
  const g=rejilla(N(26),N(18),(u,v)=>{const a=u*TAU,ancho=.068*Math.pow(1-v,.75)*(1+.25*Math.sin(Math.PI*v))+.004,grueso=.022*(1-v)+.006;
   let x=Math.cos(a)*ancho,z=Math.sin(a)*grueso;if(z>0)z-=.014*(1-v)*Math.pow(Math.abs(Math.cos(a)),.3)*(1-Math.abs(Math.cos(a)));
   const h=v*largo;return [base[0]+eje.x*h+lat.x*x+frente.x*z,base[1]+eje.y*h+lat.y*x+frente.y*z,base[2]+eje.z*h+lat.z*x+frente.z*z];},{cerradaU:true,uvEscala:[3,4]});
  const datos=[];const p=g.attributes.position,uvO=g.attributes.uv;for(let i=0;i<p.count;i++)datos.push({parte:'oreja',s,h:new T.Vector3(p.getX(i),p.getY(i),p.getZ(i)).sub(new T.Vector3(...base)).dot(eje)/largo,a:uvO.getX(i)/3*TAU});
  K.agregar(g,{material:'pelaje',pesos:pt=>{const h=clamp(new T.Vector3(pt.x,pt.y,pt.z).sub(new T.Vector3(...base)).dot(eje)/largo);const w=suave(.45,.85,h);return [[hueso,1-w],[puntaH,w]];},cara:true,etiqueta:'oreja',datos,
   color:(pt,nn,k)=>{const {h,a}=datos[k];const adentro=Math.sin(a)>0?clamp((Math.sin(a)-.35)*2.2)*(1-suave(.62,.8,h)):0;let c=mezclaColor(COL.naranja,COL.orejaIn,adentro);if(h>.8)c=mezclaColor(c,COL.punta,suave(.8,.95,h));return c;}});
 }

 /* ── lentes ámbar tipo wayfarer (rígidos a la cabeza) ───────────────────────────────────── */
 armarLentes(K,OJ,N);

 /* ── cuerpo: cuello, sudadera con capucha, cordones, corona, bolsillo ───────────────────── */
 armarCuerpo(K,N,esq);
 armarBrazosManos(K,N,esq);
 armarPiernas(K,N);
 armarCola(K,N);

 const campo=campoCompleto((nombre,info)=>campoClaudio(nombre,info,{OJ,BOCA}));
 const r=K.construir({nombre:'CLAUDIO',morphs:campo,ao:alta?{rayos:22,distancia:.07,fuerza:.7}:{rayos:10,distancia:.07,fuerza:.6}});
 zona(esq,'zona_cabeza','head',[0,1.53,-.02],[.21,.1,.2],mat.zona);
 zona(esq,'zona_mejilla_izq','head',[.16,1.33,.11],[.075,.07,.085],mat.zona);
 zona(esq,'zona_mejilla_der','head',[-.16,1.33,.11],[.075,.07,.085],mat.zona);
 zona(esq,'zona_panza','chest',[0,.88,.1],[.19,.13,.12],mat.zona);
 camaraNodo(r.raiz,'camara_retrato',[0,1.35,0],1.5);
 camaraNodo(r.raiz,'camara_cuerpo',[0,.92,0],4.1);
 const perfil=perfilClaudio();
 const clips=crearClips(esq,perfil);
 r.raiz.userData={personaje:'Claudio',version:'2.0.0',calidad,rig:'esqueleto VRM con piel, 67+1 morphs en la cara (incluye orejas)'};
 return {raiz:r.raiz,clips,perfil,esqueleto:esq,mallas:{cuerpo:r.cuerpo,cara:r.cara},materiales:mat,anclas:perfil.anclas};
}

/* ── textura del ojo: iris ámbar con aro oscuro, pupila grande y destellos ──────────────── */
function texturaOjo(){
 const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');
 x.fillStyle='#f7f1e6';x.fillRect(0,0,256,256);
 const g=x.createRadialGradient(128,128,4,128,128,74);g.addColorStop(0,'#5a2f08');g.addColorStop(.3,'#b8621b');g.addColorStop(.62,'#e0982f');g.addColorStop(.86,'#a35a14');g.addColorStop(1,'#3a1d06');
 x.fillStyle=g;x.beginPath();x.arc(128,128,74,0,TAU);x.fill();
 x.globalAlpha=.18;x.strokeStyle='#ffe0a0';for(let i=0;i<60;i++){const a=i/60*TAU;x.beginPath();x.moveTo(128+Math.cos(a)*30,128+Math.sin(a)*30);x.lineTo(128+Math.cos(a)*68,128+Math.sin(a)*68);x.stroke();}x.globalAlpha=1;
 x.fillStyle='#0d0806';x.beginPath();x.arc(128,128,33,0,TAU);x.fill();
 x.fillStyle='#ffffff';x.beginPath();x.ellipse(104,100,13,15,-.4,0,TAU);x.fill();x.beginPath();x.arc(154,156,6,0,TAU);x.fill();
 const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.userData.mimeType='image/webp';return t;
}

/* ── boca: referencias en la cabeza ─────────────────────────────────────────────────────── */
function bocaReferencia(){
 const pm=u=>pielUV(u,V_BOCA);const centro=pm(.5),izq=pm(.5+U_ESQ*.95),der=pm(.5-U_ESQ*.95);
 const nariz=(()=>{const d=nrm(0,-.215,.975);const p=piel(d);return [p[0],p[1]+.003,p[2]+.004];})();
 const atras=.028;
 const dientes=(dy,dz,k)=>{const f=[];for(let i=0;i<=6;i++){const u=.5+(i/6-.5)*2*U_ESQ*k;const p=pm(u);f.push([p[0]*.9,p[1]+dy,p[2]-dz-.004*Math.cos((i/6-.5)*Math.PI)**0]);}return f;};
 return {
  centro,izq,der,nariz,
  bolsa:{c:[0,centro[1]-.002,centro[2]-.05],r:[Math.abs(izq[0])*1.1,.035,.06]},
  lengua:{c:[0,centro[1]-.012,centro[2]-.035],r:[Math.abs(izq[0])*.6,.008,.03]},
  dientesSup:dientes(.0045,.009,.7),dientesInf:dientes(-.0065,.012,.6),
  colmillo:s=>{const p=pm(.5+s*U_ESQ*.45);return [[p[0]*.92,p[1]+.004,p[2]-.008],[p[0]*.92,p[1]-.002,p[2]-.0075],[p[0]*.92,p[1]-.007,p[2]-.0065]];},
  bisagra:new T.Vector3(0,C.y-.03,C.z+.02)
 };
}

/* ── párpados: coordenadas (x,y) en el plano del ojo para cada estado ───────────────────── */
function parpado(xn,t,arriba,estado,k=1){
 const X=.78*xn;
 if(arriba){
  const borde={abierto:.56-.18*xn*xn,cerrado:-.1-.12*xn*xn,ancho:.74-.18*xn*xn,entrecerrado:.28-.16*xn*xn,triste:.5-.18*xn*xn}[estado];
  const y0=borde,y1=.97;const y=lerp(y0,y1,t);return [X*Math.sqrt(Math.max(.05,1-y*y*.2)),Math.min(.98,y)];
 }
 const borde={abierto:-.5+.12*xn*xn,cerrado:-.12+.05*xn*xn,ancho:-.62+.12*xn*xn,entrecerrado:-.08+.06*xn*xn,triste:-.5+.12*xn*xn}[estado];
 const y=lerp(borde,-.97,t);return [X*Math.sqrt(Math.max(.05,1-y*y*.2)),Math.max(-.98,y)];
}

/* ── lentes ─────────────────────────────────────────────────────────────────────────────── */
function armarLentes(K,OJ,N){
 const forma=(w,h,rr)=>{const s=new T.Shape(),t=w*.54,b=w*.46;s.moveTo(-b+rr,-h/2);s.lineTo(b-rr,-h/2);s.quadraticCurveTo(b,-h/2,b+.004,-h/2+rr);s.lineTo(t,h/2-rr);s.quadraticCurveTo(t+.002,h/2,t-rr,h/2);s.lineTo(-t+rr,h/2);s.quadraticCurveTo(-t-.002,h/2,-t,h/2-rr);s.lineTo(-b-.004,-h/2+rr);s.quadraticCurveTo(-b,-h/2,-b+rr,-h/2);return s;};
 const zFrente=Math.max(OJ.I.p[2],OJ.D.p[2])+.028,yc=(OJ.I.p[1]+OJ.D.p[1])/2+.004;
 const envolver=(x,z)=>z-.55*x*x; // la montura abraza la cara
 for(const s of [1,-1]){
  const cx=(s>0?OJ.I.p[0]:OJ.D.p[0])*1.02;
  const ext=forma(.108,.082,.02),hueco=forma(.082,.056,.013);ext.holes.push(new T.Path(hueco.getPoints(40).reverse()));
  const g=new T.ExtrudeGeometry(ext,{depth:.008,bevelEnabled:true,bevelThickness:.0025,bevelSize:.0022,bevelSegments:2,curveSegments:N(14),steps:1});g.deleteAttribute('uv');
  const p=g.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i)+cx,y=p.getY(i)+yc,z=p.getZ(i)+zFrente-.004;p.setXYZ(i,x,y,envolver(x,z));}g.computeVertexNormals();
  K.agregar(g,{material:'brillo',hueso:'head',color:COL.montura,ao:false});
  // Vidrio abombado.
  const pts=hueco.getSpacedPoints(64);const gl=rejilla(64,4,(u,v)=>{const q=pts[Math.round(u*64)%64];const x=q.x*v*1.03+cx,y=q.y*v*1.03+yc;return [x,y,envolver(x,zFrente+.0045+.005*(1-v*v))];},{cerradaU:true,invertir:true});
  K.agregar(gl,{material:'lente',hueso:'head',ao:false,ocluye:false});
  // Remaches plateados y patilla hacia la oreja.
  const esq=[cx+s*.046,yc+.024];K.agregar(elipsoide([.0035,.0035,.002],{c:[esq[0],esq[1],envolver(esq[0],zFrente+.0065)],nu:10,nv:6}),{material:'brillo',hueso:'head',color:COL.remache,ao:false});
  const inicio=[cx+s*.05,yc+.02,envolver(cx+s*.05,zFrente)-.004];
  K.agregar(barrido([inicio,[s*.2,yc+.022,.03],[s*.222,yc+.012,-.06],[s*.2,yc-.01,-.1]],t=>[.0032,.0055],{lados:8,pasos:N(20),tapas:true,arriba:[0,1,0]}),{material:'brillo',hueso:'head',color:COL.montura,ao:false});
 }
 const puente=[[OJ.I.p[0]*.55,yc+.012,envolver(OJ.I.p[0]*.55,zFrente)],[0,yc+.02,envolver(0,zFrente+.004)],[OJ.D.p[0]*.55,yc+.012,envolver(OJ.D.p[0]*.55,zFrente)]];
 K.agregar(barrido(puente,t=>[.0045,.004],{lados:8,pasos:N(10),tapas:true}),{material:'brillo',hueso:'head',color:COL.montura,ao:false});
}

/* ── cuerpo ─────────────────────────────────────────────────────────────────────────────── */
const perfilTorso=[[.685,.2,.15],[.74,.215,.165],[.82,.212,.162],[.92,.205,.155],[1.02,.2,.148],[1.085,.19,.135],[1.13,.15,.11],[1.168,.078,.072]];
function radiosTorso(y){for(let i=0;i<perfilTorso.length-1;i++){const [y0,a0,b0]=perfilTorso[i],[y1,a1,b1]=perfilTorso[i+1];if(y<=y1){const t=suave(0,1,(y-y0)/(y1-y0));return [lerp(a0,a1,t),lerp(b0,b1,t)];}}return perfilTorso[perfilTorso.length-1].slice(1);}
function puntoTorso(y,th,{sinPliegues=false}={}){
 const [a,b]=radiosTorso(y),c=Math.cos(th),s=Math.sin(th),e=2/2.6;
 let x=a*Math.sign(s)*Math.abs(s)**e,z=b*Math.sign(c)*Math.abs(c)**e;
 if(!sinPliegues){
  // Pliegues suaves arriba del ribete y desde las axilas; bolsillo canguro levemente elevado.
  const pl=.0035*Math.sin(y*95+th*2)**2*suave(.74,.78,y)*(1-suave(.84,.9,y));
  const ax=.003*Math.exp(-(((Math.abs(x)-.13)/.03)**2))*suave(.9,1,y)*(1-suave(1.05,1.08,y))*Math.sin((y-Math.abs(x))*120)**2;
  const bol=z>0?.004*(1-suave(.08,.1,Math.abs(x)-.04*(y-.76)/.12))*suave(.745,.76,y)*(1-suave(.87,.885,y)):0;
  const k=1-pl-ax;x*=k;z=z*k+bol;
 }
 return [x,y,z];
}
function armarCuerpo(K,N,esq){
 const pesoTorso=p=>{const y=p.y;if(y<.8)return [['hips',1-suave(.72,.8,y)],['spine',suave(.72,.8,y)]];if(y<.96)return [['spine',1-suave(.84,.96,y)],['chest',suave(.84,.96,y)]];if(y<1.08)return [['chest',1-suave(1,1.08,y)],['upperChest',suave(1,1.08,y)]];return [['upperChest',1]];};
 const colorTorso=p=>{
  let c=COL.sudadera;
  // Costuras: hombros, laterales, borde del bolsillo; ribete del bajo con acanalado.
  const x=Math.abs(p.x);if(p.y<.745)c=mezclaColor(c,COL.sudaderaHondo,.5+.5*Math.sin(Math.atan2(p.x,p.z)*40));
  if(p.z>0&&p.y>.745&&p.y<.885){const borde=Math.abs(x-(.1-.04*(p.y-.76)/.12));if(borde<.005)c=mezclaColor(c,COL.sudaderaHondo,.8);if(Math.abs(p.y-.882)<.004&&x<.1)c=mezclaColor(c,COL.sudaderaHondo,.8);}
  if(Math.abs(p.z)<.02&&x>.15)c=mezclaColor(c,COL.sudaderaHondo,.5);
  return c;};
 K.agregar(rejilla(N(64),N(40),(u,v)=>puntoTorso(lerp(.685,1.168,v),u*TAU),{cerradaU:true,uvEscala:[14,8]}),{material:'tela',pesos:pesoTorso,color:colorTorso});
 // Cuello de pelo (crema adelante) que sube a la cabeza.
 K.agregar(rejilla(N(28),N(6),(u,v)=>{const th=u*TAU,y=lerp(1.12,1.25,v),r=.052-.004*v;return [r*Math.sin(th),y,r*Math.cos(th)*.95+.012];},{cerradaU:true,uvEscala:[4,3]}),{material:'pelaje',pesos:p=>{const h=suave(1.16,1.24,p.y);return [['neck',1-h],['head',h]];},color:()=>COL.naranjaHondo});
 // Capucha caída: rollo grueso alrededor del cuello, abierto adelante, y su volumen sobre la espalda.
 const cap=[];for(let i=0;i<=16;i++){const a=-2.45+i/16*4.9;const r=.105+.015*Math.cos(a);cap.push([Math.sin(a)*r*1.08,1.158+.012*Math.cos(a),-Math.cos(a)*r*.95+.012]);}
 K.agregar(barrido(cap,t=>{const b=Math.sin(Math.PI*t);return [.02+.03*b,.018+.012*b];},{lados:N(14),pasos:N(40),tapas:true,arriba:[0,1,0],perfil:(t,a)=>1+.08*Math.sin(a*3+t*9)**2}),{material:'tela',pesos:()=>[['upperChest',1]],color:COL.sudadera,uvEscala:[6,3]});
 K.agregar(elipsoide([.125,.1,.038],{c:[0,1.05,-.148],nu:N(28),nv:N(16),forma:(x,y,z)=>[x*(1-.25*Math.max(0,-y/.1)),y,z+.01*Math.cos(x*12)-.018*(y/.1)]}),{material:'tela',pesos:()=>[['upperChest',.7],['chest',.3]],color:p=>mezclaColor(COL.sudadera,COL.sudaderaHondo,clamp((p.z+.15)*-20+.3)),uvEscala:[6,4]});
 // Cordones con puntas.
 for(const s of [1,-1]){const top=[.034*s,1.132,.118],mid=[.04*s,1.065,.142],end=[.036*s,1.0,.148];
  K.agregar(barrido([top,mid,end],()=>.0048,{lados:8,pasos:N(12),tapas:true}),{material:'tela',pesos:()=>[['upperChest',1]],color:COL.cordon});
  K.agregar(barrido([[end[0],end[1]+.004,end[2]],[end[0],end[1]-.018,end[2]+.001]],()=>.0062,{lados:8,pasos:4,tapas:true}),{material:'brillo',pesos:()=>[['upperChest',1]],color:COL.montura,ao:false});}
 // Corona bordada (misma silueta del logo actual: contorno, M y barra), conforme al pecho.
 const trazos=[[[83,374],[28,145],[174,216],[228,35],[324,162],[459,63],[429,342],[83,374]],[[150,309],[135,228],[230,260],[261,155],[320,243],[381,196],[370,298]],[[97,438],[423,402]]];
 const escala=.17/512,yc=1.0;
 for(const tr of trazos){
  const pos=[],idx=[];
  for(let i=0;i<tr.length-1;i++){const [ax,ay]=tr[i],[bx,by]=tr[i+1];const A=[(ax-256)*escala,yc-(ay-256)*escala],B=[(bx-256)*escala,yc-(by-256)*escala];const dx=B[0]-A[0],dy=B[1]-A[1],l=Math.hypot(dx,dy),nx=-dy/l*.0058,ny=dx/l*.0058;
   const ex=dx/l*.0058,ey=dy/l*.0058;const base=pos.length/3;
   for(const [px,py] of [[A[0]-ex+nx,A[1]-ey+ny],[A[0]-ex-nx,A[1]-ey-ny],[B[0]+ex+nx,B[1]+ey+ny],[B[0]+ex-nx,B[1]+ey-ny]]){const a=radiosTorso(py)[0],sn=Math.sign(px)*Math.min(1,Math.abs(px)/a)**(2.6/2);const q=puntoTorso(py,Math.asin(sn),{sinPliegues:true});pos.push(px,py,q[2]+.0026);}
   idx.push(base,base+1,base+2,base+1,base+3,base+2);}
  const g=geometria(pos,idx);const n=g.attributes.normal;for(let i=0;i<n.count;i++){const z=1;n.setXYZ(i,0,.1,z);}g.computeVertexNormals();
  K.agregar(g,{material:'tela',pesos:()=>[['chest',.6],['upperChest',.4]],color:COL.corona,ao:false,ocluye:false});
 }
}

/* ── brazos (mangas con pliegues) y manos de zorro ──────────────────────────────────────── */
function manoZorro(s){
 const origen=[.385*s,.755,.022];
 const f=new T.Vector3(.18*s,-1,.12).normalize(),n=new T.Vector3(-s,0,0);n.addScaledVector(f,-n.dot(f)).normalize();
 const sx=new T.Vector3().crossVectors(f,n);if(s<0)sx.negate();
 const E=1.35; // manos grandes y expresivas
 const M=(x,y,z)=>{x*=E;y*=E;z*=E;return [origen[0]+sx.x*x+f.x*y+n.x*z,origen[1]+sx.y*x+f.y*y+n.y*z,origen[2]+sx.z*x+f.z*y+n.z*z];};
 const DEDOS={Index:[-.024,.05],Middle:[-.002,.056],Ring:[.021,.05]};
 const hueso=(dedo,k)=>{if(dedo==='Thumb')return k?M(-.052,.042,.014):M(-.036,.022,.008);const [x,L]=DEDOS[dedo];return M(x*1.05,.07+k*L*.5,0);};
 const piezas=N=>{
  const out=[],trans=g=>{const p=g.attributes.position;for(let i=0;i<p.count;i++)p.setXYZ(i,...M(p.getX(i),p.getY(i),p.getZ(i)));if(s<0){const ix=g.index.array;for(let i=0;i<ix.length;i+=3){const t=ix[i];ix[i]=ix[i+2];ix[i+2]=t;}}g.computeVertexNormals();suavizarCostura(g);return g;};
  // Palma mullida, pelo naranja por fuera y almohadillas oscuras en la palma y las yemas.
  out.push({g:trans(elipsoide([.043,.046,.022],{c:[0,.036,0],nu:N(28),nv:N(18),e1:.85,e2:.85,forma:(x,y,z)=>[x*(1+.1*(y-.036)/.046),y,z*(1-.2*Math.max(0,(y-.036)/.046))]})),material:'pelaje',color:(p,nn)=>COL.naranja});
  out.push({g:trans(elipsoide([.026,.022,.006],{c:[0,.036,.019],nu:N(16),nv:N(10)})),material:'brillo',color:rgb('#4a2c28')});
  for(const [dedo,[x,L]] of Object.entries(DEDOS)){
   const g=barrido([[x,.062,0],[x*1.04,.062+L*.5,.004],[x*1.08,.062+L,.012]],t=>.0135-.0025*t,{lados:N(10),pasos:N(8)});
   out.push({g:trans(g),material:'pelaje',pesosDedo:dedo,color:COL.naranja});
   out.push({g:trans(elipsoide([.0085,.009,.004],{c:[x*1.08,.062+L*.86,.0135],nu:10,nv:6})),material:'brillo',hueso:dedo+'Distal',color:rgb('#4a2c28')});
  }
  out.push({g:trans(barrido([[-.026,.018,.006],[-.042,.034,.012],[-.056,.05,.018]],t=>.0145-.003*t,{lados:N(10),pasos:N(8)})),material:'pelaje',pesosDedo:'Thumb',color:COL.naranja});
  // Mechón de muñeca que asoma del puño.
  out.push({g:trans(elipsoide([.038,.014,.03],{c:[0,-.004,0],nu:N(20),nv:N(8),forma:(x,y,z,u)=>{const k=1+.18*Math.max(0,Math.cos(u*TAU*7))**2;return [x*k,y,z*k];}})),material:'pelaje',color:COL.naranjaClaro});
  return out;
 };
 return {origen,hueso,piezas,M,f,n};
}
function armarBrazosManos(K,N,esq){
 for(const [lado,s] of [['left',1],['right',-1]]){
  const h=manoZorro(s);
  const hom=[.13*s,1.1,-.005],codo=esq.pos(lado+'LowerArm').toArray(),mun=[h.origen[0]*.99,h.origen[1]+.03,h.origen[2]];
  const cur=new T.CatmullRomCurve3([new T.Vector3(...hom),new T.Vector3(...esq.pos(lado+'UpperArm').toArray()),new T.Vector3(...codo),new T.Vector3(...mun)],false,'centripetal');
  const muestras=[];for(let i=0;i<=80;i++)muestras.push(cur.getPointAt(i/80));
  const tCodo=(()=>{let mt=0,md=9;muestras.forEach((m,i)=>{const d=m.distanceToSquared(new T.Vector3(...codo));if(d<md){md=d;mt=i/80;}});return mt;})();
  const pesos=p=>{const q=new T.Vector3(p.x,p.y,p.z);let mt=0,md=9;muestras.forEach((m,i)=>{const d=m.distanceToSquared(q);if(d<md){md=d;mt=i/80;}});
   if(mt<tCodo*.45){const w=suave(.02,tCodo*.4,mt);return [[lado+'Shoulder',1-w],[lado+'UpperArm',w]];}
   const w=suave(tCodo-.07,tCodo+.07,mt);return [[lado+'UpperArm',1-w],[lado+'LowerArm',w]];};
  const g=barrido(cur,t=>{const r=lerp(.075,.056,t)+.012*Math.exp(-(((t-.5)/.06)**2))+.006*Math.exp(-(((t-.86)/.05)**2));return [r,r*.95];},{lados:N(20),pasos:N(40),tapas:false,
   perfil:(t,a)=>1-.05*Math.exp(-(((t-.47)/.05)**2))*Math.sin(a*3+1)**2-.04*Math.exp(-(((t-.56)/.04)**2))*Math.cos(a*2)**2-.03*Math.exp(-(((t-.8)/.05)**2))*Math.sin(a*4)**2});
  K.agregar(g,{material:'tela',pesos,color:COL.sudadera,uvEscala:[4,10]});
  // Puño acanalado.
  const d=new T.Vector3(...mun).sub(new T.Vector3(...codo)).normalize();const p0=new T.Vector3(...mun).addScaledVector(d,-.035),p1=new T.Vector3(...mun).addScaledVector(d,.012);
  K.agregar(barrido([p0.toArray(),p1.toArray()],t=>[.05+.004*Math.sin(t*Math.PI),.048],{lados:N(24),pasos:4,tapas:false}),{material:'tela',pesos:()=>[[lado+'LowerArm',1]],color:(p)=>mezclaColor(COL.sudadera,COL.sudaderaHondo,.5+.5*Math.sin(Math.atan2(p.x-mun[0],p.z-mun[2])*18))});
  for(const pz of h.piezas(N)){
   const opc={material:pz.material,color:pz.color};
   if(pz.pesosDedo){const pr=lado+pz.pesosDedo+'Proximal',ds=lado+pz.pesosDedo+'Distal';const a=esq.pos(pr),b=esq.pos(ds);opc.pesos=p=>{const q=new T.Vector3(p.x,p.y,p.z);const t=q.clone().sub(a).dot(b.clone().sub(a))/b.distanceToSquared(a);const w=suave(.7,1.1,t),w0=suave(-.35,.1,t);return [[lado+'Hand',1-w0],[pr,w0*(1-w)],[ds,w0*w]];};}
   else opc.hueso=pz.hueso?lado+pz.hueso:lado+'Hand';
   K.agregar(pz.g,opc);
  }
 }
}

/* ── piernas (joggers) y tenis ──────────────────────────────────────────────────────────── */
function armarPiernas(K,N){
 // Pelvis del pantalón (bajo el ribete de la sudadera).
 K.agregar(elipsoide([.165,.06,.12],{c:[0,.725,-.005],nu:N(40),nv:N(14)}),{material:'tela',pesos:()=>[['hips',1]],color:COL.pantalon,uvEscala:[8,3]});
 for(const [lado,s] of [['left',1],['right',-1]]){
  const top=[.095*s,.75,0],rod=[.1*s,.39,.012],tob=[.1*s,.11,0];
  const cur=new T.CatmullRomCurve3([new T.Vector3(...top),new T.Vector3(.1*s,.55,.008),new T.Vector3(...rod),new T.Vector3(.1*s,.25,.004),new T.Vector3(...tob)],false,'centripetal');
  const pesos=p=>{const w=suave(.35,.45,p.y);const h=suave(.66,.72,p.y);return [['hips',h*.6],[lado+'UpperLeg',w*(1-h*.6)],[lado+'LowerLeg',(1-w)]];};
  K.agregar(barrido(cur,t=>{const r=lerp(.088,.058,t)+.006*Math.exp(-(((t-.5)/.06)**2))+.01*Math.exp(-(((t-.93)/.05)**2));return [r,r*.96];},{lados:N(20),pasos:N(36),tapas:false,
   perfil:(t,a)=>1-.05*Math.exp(-(((t-.52)/.04)**2))*Math.sin(a*2+.6)**2-.04*Math.exp(-(((t-.86)/.05)**2))*Math.cos(a*3)**2}),{material:'tela',pesos,color:COL.pantalon,uvEscala:[5,10]});
  K.agregar(barrido([[tob[0],.135,0],[tob[0],.085,0]],t=>.05+.003*Math.sin(t*Math.PI),{lados:N(20),pasos:3,tapas:false}),{material:'tela',pesos:()=>[[lado+'LowerLeg',1]],color:p=>mezclaColor(COL.pantalon,COL.sudaderaHondo,.5+.5*Math.sin(Math.atan2(p.x-tob[0],p.z)*16))});
  // Tenis: suela gris oscuro con franja clara, capellada negra brillante, cordones y talón.
  const x0=.1*s,pie=lado+'Foot';
  K.agregar(elipsoide([.058,.02,.12],{c:[x0,.02,.035],nu:N(28),nv:N(10),e1:.35,e2:.8,forma:(x,y,z)=>[x*(1+.12*z/.12),y,z]}),{material:'tela',hueso:pie,color:p=>p.y>.028&&p.y<.034?COL.franja:COL.suela});
  K.agregar(elipsoide([.054,.058,.108],{c:[x0,.04,.032],nu:N(28),nv:N(16),forma:(x,y,z)=>{const alto=y>0?(1-.62*suave(-.05,.1,z)):1;return [x*(1+.08*z/.1),Math.max(-.012,y*alto),z];}}),{material:'brillo',hueso:pie,color:COL.zapato});
  for(let i=0;i<3;i++){const z=.055+i*.024,y=.078-i*.012;K.agregar(barrido([[x0-.022,y,z],[x0,y+.006,z+.006],[x0+.022,y,z]],()=>.0028,{lados:6,pasos:6,tapas:true}),{material:'tela',hueso:pie,color:COL.ojal,ao:false});}
  K.agregar(barrido([[x0-.045,.1,-.04],[x0,.108,-.07],[x0+.045,.1,-.04]],()=>.008,{lados:8,pasos:N(10),tapas:true}),{material:'tela',hueso:pie,color:COL.suela});
 }
}

/* ── cola con mechones y punta crema ────────────────────────────────────────────────────── */
const COLA_CURVA=[[0,.73,-.13],[-.03,.6,-.27],[-.16,.44,-.35],[-.33,.33,-.29],[-.44,.26,-.13],[-.43,.21,.03],[-.36,.19,.14]];
const COLA_PUNTOS_HUESOS=(()=>{const c=curva(COLA_CURVA);return [0,.22,.45,.68,.9].map(t=>c.getPointAt(t).toArray());})();
function armarCola(K,N){
 const c=curva(COLA_CURVA);
 const radio=t=>{const r=.045+.095*Math.sin(Math.PI*Math.min(1,t*1.1))**.7+.02*suave(.3,.7,t);return Math.max(.03,r*(t>.86?1-(t-.86)*4:1));};
 const g=barrido(c,t=>radio(t),{lados:N(22),pasos:N(48),tapas:true,perfil:(t,a)=>1+.13*Math.max(0,Math.cos(a*5+t*16))**3*suave(.12,.3,t)});
 const ts=[0,.22,.45,.68,.9];
 const pesos=p=>{const q=new T.Vector3(p.x,p.y,p.z);let mt=0,md=9;for(let i=0;i<=60;i++){const d=c.getPointAt(i/60).distanceToSquared(q);if(d<md){md=d;mt=i/60;}}
  let k=0;while(k<ts.length-1&&mt>ts[k+1])k++;if(k>=ts.length-1)return [['cola5',1]];const w=suave(0,1,(mt-ts[k])/(ts[k+1]-ts[k]));const base=mt<.08?[['hips',1-suave(0,.08,mt)]]:[];return [...base,['cola'+(k+1),(1-w)*(mt<.08?suave(0,.08,mt):1)],['cola'+(k+2),w*(mt<.08?suave(0,.08,mt):1)]];};
 const tDe=p=>{const q=new T.Vector3(p.x,p.y,p.z);let mt=0,md=9;for(let i=0;i<=60;i++){const d=c.getPointAt(i/60).distanceToSquared(q);if(d<md){md=d;mt=i/60;}}return mt;};
 K.agregar(g,{material:'pelaje',pesos,color:p=>{const t=tDe(p);const ang=Math.atan2(p.x,p.z);return mezclaColor(COL.naranja,COL.crema,suave(.76+.03*Math.sin(ang*5),.83+.03*Math.sin(ang*5),t));},uvEscala:[3,8]});
}

/* ── campos de morph ────────────────────────────────────────────────────────────────────── */

function campoClaudio(nombre,info,ctx){
 const {p,dato}=info;if(!dato)return null;const B=ctx.BOCA;
 const lado=nombre.endsWith('Left')?1:nombre.endsWith('Right')?-1:0;
 const x=p.x,y=p.y-C.y,z=p.z-C.z;
 // ── ojos ──
 if(dato.ojo){
  const s=dato.s;if(lado&&lado!==s&&/^eye|^cheekSquint/.test(nombre))return null;
  const m=dato.m,c=m.c,fw=m.fw,rt=m.rt,up=m.up;
  const dirOjo=(xx,yy)=>{const zz=Math.sqrt(Math.max(0,1-xx*xx-yy*yy));return [rt[0]*xx+up[0]*yy+fw[0]*zz,rt[1]*xx+up[1]*yy+fw[1]*zz,rt[2]*xx+up[2]*yy+fw[2]*zz];};
  const enOjo=(xx,yy,R)=>{const d=dirOjo(xx,yy);return [c[0]+d[0]*R-p.x,c[1]+d[1]*R-p.y,c[2]+d[2]*R-p.z];};
  const lid=(estado,mezcla=1)=>{if(dato.parte==='globo')return null;const arriba=dato.parte==='parpadoSup';const [xa,ya]=parpado(dato.xn,dato.t,arriba,'abierto'),[xb,yb]=parpado(dato.xn,dato.t,arriba,estado);const xx=lerp(xa,xb,mezcla),yy=lerp(ya,yb,mezcla);return enOjo(xx,yy,dato.RL);};
  const soloSup=(estado,k=1)=>dato.parte==='parpadoSup'?lid(estado,k):null,soloInf=(estado,k=1)=>dato.parte==='parpadoInf'?lid(estado,k):null;
  const rotar=(ax,ay)=>{if(dato.parte!=='globo')return null;const xx=dato.x+ax,yy=dato.y+ay;const n=Math.hypot(xx,yy);const f=n>.999?.999/n:1;return enOjo(xx*f,yy*f,RE_G);};
  switch(nombre.replace(/Left|Right$/,'')){
   case 'eyeBlink':{if(dato.parte==='globo'){// el globo se aplana hacia atrás: el párpado lineal nunca se hunde
     const k=Math.max(0,Math.cos(Math.asin(Math.min(1,Math.hypot(dato.x,dato.y)))))**2*.007;return [-fw[0]*k,-fw[1]*k,-fw[2]*k];}return lid('cerrado');}
   case 'eyeSquint':return dato.parte==='parpadoInf'?lid('entrecerrado',.85):dato.parte==='parpadoSup'?lid('entrecerrado',.25):null;
   case 'eyeWide':return lid('ancho');
   case 'cheekSquint':return soloInf('entrecerrado',.45);
   case 'eyeLookUp':return dato.parte==='globo'?rotar(0,.22):soloSup('ancho',.35);
   case 'eyeLookDown':return dato.parte==='globo'?rotar(0,-.22):soloSup('entrecerrado',.45);
   case 'eyeLookIn':return rotar(-.24*s,0);
   case 'eyeLookOut':return rotar(.24*s,0);
   case 'browInnerUp':return soloSup('triste',1);
   case 'browDown':return soloSup('entrecerrado',.62);
   default:return null;
  }
 }
 // ── orejas: se aplanan con el enojo, caen con la tristeza, se paran con la sorpresa ──
 if(dato.parte==='oreja'){
  const s=dato.s,h=dato.h;if(lado&&lado!==s&&!/^brow(Down|OuterUp)/.test(nombre)&&nombre!=='browInnerUp')return null;
  const piv=new T.Vector3(.135*s,1.55,-.02),q=new T.Vector3(p.x,p.y,p.z).sub(piv);
  const giro=(ax,ang)=>{const r=q.clone().applyAxisAngle(ax,ang*Math.min(1,h*1.4+.2));return [r.x-q.x,r.y-q.y,r.z-q.z];};
  switch(nombre){
   case 'browDownLeft':case 'browDownRight':return lado===s?giro(new T.Vector3(1,0,0),-.7):null;           // hacia atrás
   case 'browInnerUp':return giro(new T.Vector3(0,0,1),-.85*s);                                             // caen a los lados
   case 'browOuterUpLeft':case 'browOuterUpRight':return lado===s?giro(new T.Vector3(1,0,0),.18):null;     // atentas
   case 'eyeWideLeft':case 'eyeWideRight':return lado===s?giro(new T.Vector3(1,0,0),.22):null;
   case 'mouthSmileLeft':case 'mouthSmileRight':return lado===s?giro(new T.Vector3(0,0,1),-.08*s):null;
   default:return null;
  }
 }
 // ── cejas ──
 if(dato.parte==='ceja'){
  const s=dato.s,t=dato.t,ad=1-t;if(lado&&lado!==s&&nombre!=='browInnerUp')return null;
  switch(nombre){
   case 'browDownLeft':case 'browDownRight':return [-.006*s*ad,-.022*ad-.006,.003];
   case 'browInnerUp':return [.003*s*ad,.026*ad**1.2+.003,0];
   case 'browOuterUpLeft':case 'browOuterUpRight':return [0,.014*t**1.3+.004,0];
   case 'eyeSquintLeft':case 'eyeSquintRight':return [0,-.003,0];
   case 'noseSneerLeft':case 'noseSneerRight':return [0,-.004*ad,.001];
   case 'eyeWideLeft':case 'eyeWideRight':return [0,.005,0];
   default:return null;
  }
 }
 if(dato.parte==='rubor'){if(nombre!=='rubor')return null;return [dato.full[0]-p.x,dato.full[1]-p.y,dato.full[2]-p.z];}
 // ── boca y mandíbula (piel, faldones, bolsa, dientes, lengua) ──
 const bis=B.bisagra;
 const esquina=Math.abs(B.izq[0]);
 const enBoca=burbuja(Math.hypot(x/1.3,(p.y-B.centro[1])*1.6,(p.z-B.centro[2])*1.2),.075);
 const abajoDeLaBoca=dato.parte==='piel'||dato.parte==='faldon'?(dato.lado>0?0:1):dato.abajo?1:0;
 const regionMandibula=(dato.parte==='piel'||dato.parte==='faldon')?(1-suave(esquina*.55,esquina*1.25,Math.abs(x)))*(1-suave(.15,.24,-y))*suave(-.02,.12,z+.05):1;
 const mand=abajoDeLaBoca*regionMandibula;
 const labios=(dato.parte==='piel'&&Math.abs(dato.fila)<=3)||dato.parte==='faldon'?(1-Math.min(1,Math.abs(dato.fila)/3.5))*(1-suave(esquina*.6,esquina*1.15,Math.abs(x))):0;
 const sup=dato.lado>0?1:0,inf=1-sup;
 const cerca=(cx,cy,cz,r)=>burbuja(Math.hypot(p.x-cx,p.y-cy,p.z-cz),r);
 const rotMand=ang=>{const q=new T.Vector3(p.x,p.y,p.z).sub(bis);const r=q.clone().applyAxisAngle(new T.Vector3(1,0,0),ang);return [r.x-q.x,r.y-q.y,r.z-q.z];};
 const esq=s=>s>0?B.izq:B.der;
 const porLado=s=>s===0?1:suave(-.01,.02,x*s);
 switch(nombre){
  case 'jawOpen':{if(!mand)return null;const d=rotMand(.34);return [d[0]*mand,d[1]*mand,d[2]*mand];}
  case 'jawForward':return mand?[0,0,.008*mand]:null;
  case 'jawLeft':case 'jawRight':return mand?[.01*lado*mand,0,0]:null;
  case 'mouthClose':{if(!mand||!labios&&dato.parte!=='bolsa')return null;const d=rotMand(.34);const k=-.35*mand*Math.max(labios,dato.parte==='faldon'?1:0);return [d[0]*k,d[1]*k,d[2]*k];}
  case 'mouthFunnel':{const k=labios+(dato.parte==='diente'?0:0);if(!k)return null;return [-x*.3*k,(sup?.006:-.009)*k,.011*k];}
  case 'mouthPucker':{if(!labios)return null;return [-x*.45*labios,(sup?.001:-.001)*labios,.014*labios];}
  case 'mouthLeft':case 'mouthRight':{const k=enBoca*(dato.parte==='piel'||dato.parte==='faldon'?1:.6);return k?[.014*lado*k,0,-.002*k*Math.abs(x)*10]:null;}
  case 'mouthSmileLeft':case 'mouthSmileRight':{const e=esq(lado);const k=cerca(e[0],e[1],e[2],.055)*(dato.parte==='piel'||dato.parte==='faldon'?1:.3);if(!k)return null;const mej=cerca(e[0]*1.25,e[1]+.03,e[2]-.03,.06)*.5;return [(.007*lado)*k,.017*k+.006*mej,-.008*k];}
  case 'mouthFrownLeft':case 'mouthFrownRight':{const e=esq(lado);const k=cerca(e[0],e[1],e[2],.065)*(dato.parte==='piel'||dato.parte==='faldon'?1:.3);return k?[.003*lado*k,-.026*k,-.003*k]:null;}
  case 'mouthDimpleLeft':case 'mouthDimpleRight':{const e=esq(lado);const k=cerca(e[0],e[1],e[2],.035);return k?[.003*lado*k,.002*k,-.006*k]:null;}
  case 'mouthStretchLeft':case 'mouthStretchRight':{const e=esq(lado);const k=cerca(e[0],e[1],e[2],.05);return k?[.012*lado*k,-.004*k,-.006*k]:null;}
  case 'mouthRollLower':return labios*inf?[0,.003*labios,-.008*labios]:null;
  case 'mouthRollUpper':return labios*sup?[0,-.003*labios,-.008*labios]:null;
  case 'mouthShrugLower':return labios*inf||dato.parte==='piel'&&mand?[0,.006*Math.max(labios*inf,mand*.4),.003*labios]:null;
  case 'mouthShrugUpper':return labios*sup?[0,.004*labios,.002*labios]:null;
  case 'mouthPressLeft':case 'mouthPressRight':{const k=labios*porLado(lado);return k?[.002*lado*k,(sup?-.002:.002)*k,-.002*k]:null;}
  case 'mouthLowerDownLeft':case 'mouthLowerDownRight':{const k=labios*inf*porLado(lado)+(dato.parte==='diente'||dato.parte==='lengua'||dato.parte==='bolsa'?0:0);return k?[0,-.011*k,.001*k]:null;}
  case 'mouthUpperUpLeft':case 'mouthUpperUpRight':{const k=labios*sup*porLado(lado);const nar=dato.parte==='piel'?cerca(esq(lado)[0]*.5,B.centro[1]+.02,B.centro[2],.04)*.4:0;return k+nar?[0,.009*(k+nar),.001*k]:null;}
  case 'cheekPuff':{let k=0;for(const s of [1,-1])k+=cerca(.125*s,C.y-.05,.12,.07);if(dato.parte!=='piel'&&dato.parte!=='mechon')return null;return k?[Math.sign(x)*.011*k,-.002*k,.006*k]:null;}
  case 'cheekSquintLeft':case 'cheekSquintRight':{if(dato.parte!=='piel'&&dato.parte!=='mechon')return null;const k=cerca(.12*lado,C.y-.02,.13,.06);return k?[0,.009*k,.002*k]:null;}
  case 'noseSneerLeft':case 'noseSneerRight':{const k=(dato.parte==='nariz'?.35:0)+(dato.parte==='piel'?cerca(.03*lado,B.nariz[1]-.005,B.nariz[2]-.02,.045):0);return k?[.001*lado*k,.007*k,-.001*k]:null;}
  case 'tongueOut':{if(dato.parte==='lengua'){const k=suave(B.lengua.c[2]-.03,B.lengua.c[2]+.02,p.z);return [0,-.006-.004*k,.026+.012*k];}return null;}
  case 'rubor':return null;
  default:return null;
 }
}
const RE_G=.05;

/* ── perfil de animación ────────────────────────────────────────────────────────────────── */
function perfilClaudio(){
 const dedos=l=>({pulgar:[l+'ThumbProximal',l+'ThumbDistal'],indice:[l+'IndexProximal',l+'IndexDistal'],medio:[l+'MiddleProximal',l+'MiddleDistal'],resto:[l+'RingProximal',l+'RingDistal']});
 return {
  cadera:'hips',columna:'spine',pecho:'chest',pechoAlto:'upperChest',cuello:'neck',cabeza:'head',ojos:['leftEye','rightEye'],hombros:['leftShoulder','rightShoulder'],
  lados:{izq:{brazo:'leftUpperArm',antebrazo:'leftLowerArm',mano:'leftHand',dedos:dedos('left')},der:{brazo:'rightUpperArm',antebrazo:'rightLowerArm',mano:'rightHand',dedos:dedos('right')}},
  piernas:{izq:{muslo:'leftUpperLeg',pierna:'leftLowerLeg',pie:'leftFoot'},der:{muslo:'rightUpperLeg',pierna:'rightLowerLeg',pie:'rightFoot'}},
  amplitud:1,paso:.9,dedosReposo:.22,manoReposo:{dedos:[.18,-1,.12],palma:[-1,0,0]},codo:[.3,-.2,-1],
  brazoReposo:{brazo:[0,0,-.05],antebrazo:[-.18,0,0]},
  // Anclas (lado izquierdo). Cabeza: desde head (0,1.22,0); pecho: desde chest (0,.98,0); cadera: desde hips (0,.76,0).
  anclas:{
   mejilla:[.2,.12,.12],menton:[.02,.03,.25],saludo:[.32,.32,.1],arriba:[.2,.58,.05],estirar:[.17,.62,-.04],
   explicar:[.2,.02,.26],cruzado:[-.03,-.02,.21],senal:[.36,-.32,.26],juntas:[.03,.03,.24],caminar:[.3,-.05,-.05],
   panza:[.09,.14,.21],jarra:[.21,.05,.03]
  },
  extras:(t,clip,x)=>{
   const dur={idle:6,escuchar:4,hablar:4,pensar:4,dormir:5,levantada:2,caminar:1.1}[clip]||x.dur||6;
   const w=Math.sin(t/dur*Math.PI*2),w2=Math.sin(t/dur*Math.PI*4+.7);
   const r={};
   // Cola: vaivén en ola (cada hueso con retraso), más viva al celebrar o con gusto.
   const viva=clip==='celebrar'||clip==='gusto'||clip==='saludar'?2:clip==='dormir'?.3:clip==='caminar'?1.4:1;
   for(let i=1;i<=5;i++){const f=Math.sin(t/dur*Math.PI*2*(clip==='caminar'?1:1)-i*.55);r['cola'+i]=[.04*f*viva,.1*f*viva,.03*w2*viva];}
   if(clip==='enojo'){for(let i=1;i<=5;i++)r['cola'+i]=[.12*(x.e||0),.15*Math.sin(t*20-i)*(x.e||0),0];}
   if(clip==='toque_mejilla'){for(let i=1;i<=5;i++)r['cola'+i]=[0,.25*(x.e||0),.05*i*(x.e||0)];}
   // Orejas: pequeños tics; alertas al escuchar, caídas al dormir.
   const tic=Math.max(0,Math.sin(t/dur*Math.PI*2*3))**12;
   const base=clip==='escuchar'?[.12,0,0]:clip==='dormir'?[-.2,0,0]:[0,0,0];
   r.orejaIzq=[base[0]+.12*tic,0,-.05*tic];r.orejaDer=[base[0],0,.04*Math.max(0,Math.sin(t/dur*Math.PI*2*2+1))**12];
   if(clip==='toque_cabeza'){r.orejaIzq=[-.5*(x.e||0),0,-.3*(x.e||0)];r.orejaDer=[-.5*(x.e||0),0,.3*(x.e||0)];}
   if(clip==='enojo'){r.orejaIzq=[-.6*(x.e||0),0,0];r.orejaDer=[-.6*(x.e||0),0,0];}
   return r;
  }
 };
}
