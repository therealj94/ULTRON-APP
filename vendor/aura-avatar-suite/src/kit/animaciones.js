import * as T from 'three';
import {CLIPS} from './nombres.js';

// La biblioteca de animaciones compartida. Cada clip es una función del tiempo que devuelve una
// POSE (rotaciones por hueso, objetivos de mano por IK de dos huesos, flexión de dedos y extras
// como cola, orejas, antenas u órbita). La pose se evalúa sobre una copia del esqueleto con
// three.js y se muestrea a 30 cuadros por segundo en pistas de cuaternión/posición: SOLO huesos,
// nada de pistas de blendshapes (la cara la manda la app). Los bucles cierran sin salto y los
// gestos empiezan y terminan en la pose de reposo, como pide la especificación.

const FPS=30;
const S=(x)=>x*x*(3-2*x);
const clamp01=x=>x<0?0:x>1?1:x;
/** Envolvente: sube de a→b, se mantiene, baja de c→d (suavizada). */
export const env=(t,a,b,c,d)=>t<=a||t>=d?0:t<b?S((t-a)/(b-a)):t<=c?1:S((d-t)/(d-c));
/** Rebote con pequeño sobrepaso (entradas con vida, estilo animación clásica). */
const resorte=x=>{x=clamp01(x);return 1-Math.exp(-6*x)*Math.cos(9*x)*(1-x);};
const sumar=(a,b,k=1)=>[a[0]+b[0]*k,a[1]+b[1]*k,a[2]+b[2]*k];
const espejo=e=>[e[0],-e[1],-e[2]];
const espejoV=v=>[-v[0],v[1],v[2]];

/** Pose vacía (todo en reposo). */
function poseVacia(){return {rot:{},pos:{},manos:{izq:null,der:null},dedos:{izq:{},der:{}},pies:{izq:null,der:null}};}
function rot(p,h,e,k=1){p.rot[h]=sumar(p.rot[h]||[0,0,0],e,k);}

/**
 * Crea los clips del vocabulario común. `perfil` describe el personaje (ver aura.js, claudio.js,
 * antonio-movil.js): nombres de huesos, anclas (mejilla, mentón, cadera…), reposo de la mano y
 * extras propios. Devuelve THREE.AnimationClip[] con nombres de nombres.js.
 */
export function crearClips(esq,perfil){
 const rig=esq.raiz.clone(true);const hueso={};rig.traverse(o=>{if(o.isBone)hueso[o.name]=o;});
 const nombres=Object.keys(hueso);
 const reposo={};for(const n of nombres)reposo[n]=hueso[n].position.clone();
 const tiene=n=>!!hueso[n];
 const L=perfil.lados;const alto=perfil.alto||1.6;
 const definiciones=DEFINICIONES(perfil);
 const clips=[];
 for(const nombre of CLIPS){
  const def=definiciones[nombre];if(!def)continue;
  const n=Math.max(2,Math.round(def.duracion*FPS));
  const tiempos=[],q={},p={};for(const h of nombres){q[h]=[];p[h]=[];}
  for(let f=0;f<=n;f++){
   const t=f/n*def.duracion;tiempos.push(t);
   const pose=def.pose(t);aplicar(pose,t);
   for(const h of nombres){hueso[h].quaternion.toArray(q[h],q[h].length);hueso[h].position.toArray(p[h],p[h].length);}
  }
  const pistas=[];
  for(const h of nombres){
   const cq=constante(q[h],4),cp=constante(p[h],3);
   // Pistas constantes con dos claves: cada clip lleva la pose completa (fundidos limpios).
   pistas.push(new T.QuaternionKeyframeTrack(h+'.quaternion',cq?[0,def.duracion]:tiempos,cq?[...q[h].slice(0,4),...q[h].slice(0,4)]:q[h]));
   if(!cp||h===perfil.cadera)pistas.push(new T.VectorKeyframeTrack(h+'.position',cp?[0,def.duracion]:tiempos,cp?[...p[h].slice(0,3),...p[h].slice(0,3)]:p[h]));
  }
  const clip=new T.AnimationClip(nombre,def.duracion,pistas);clip.userData={bucle:def.bucle};clips.push(clip);
 }
 return clips;

 function constante(arr,k){for(let i=k;i<arr.length;i++)if(Math.abs(arr[i]-arr[i%k])>1e-5)return false;return true;}

 function aplicar(pose,t){
  for(const n of nombres){hueso[n].quaternion.identity();hueso[n].position.copy(reposo[n]);}
  for(const [h,off] of Object.entries(pose.pos))if(tiene(h))hueso[h].position.add(new T.Vector3(...off));
  for(const [h,e] of Object.entries(pose.rot))if(tiene(h))hueso[h].quaternion.setFromEuler(new T.Euler(e[0],e[1],e[2],'YXZ'));
  rig.updateMatrixWorld(true);
  // Piernas por IK (pies plantados salvo que la pose diga otra cosa).
  if(perfil.piernas)for(const lado of ['izq','der']){const pl=perfil.piernas[lado];const obj=pose.pies[lado];ikPierna(pl,lado,obj);}
  for(const lado of ['izq','der']){
   const m=pose.manos[lado];const l=L[lado];
   if(m&&m.peso>0){
    const ant={b:hueso[l.brazo].quaternion.clone(),a:hueso[l.antebrazo].quaternion.clone(),m:hueso[l.mano].quaternion.clone()};
    ik2(l.brazo,l.antebrazo,l.mano,objetivoMundo(m.ik,lado),m.codo?polo(m.codo,lado):polo(perfil.codo||[.3,0,-1],lado));
    if(m.dedos||m.palma)orientarMano(l.mano,lado,m.dedos||perfil.manoReposo.dedos,m.palma||perfil.manoReposo.palma);
    if(m.giroMano)hueso[l.mano].quaternion.multiply(new T.Quaternion().setFromEuler(new T.Euler(...(lado==='der'?espejo(m.giroMano):m.giroMano))));
    if(m.peso<1){hueso[l.brazo].quaternion.copy(ant.b.slerp(hueso[l.brazo].quaternion,m.peso));hueso[l.antebrazo].quaternion.copy(ant.a.slerp(hueso[l.antebrazo].quaternion,m.peso));hueso[l.mano].quaternion.copy(ant.m.slerp(hueso[l.mano].quaternion,m.peso));}
    rig.updateMatrixWorld(true);
   }
   dedos(lado,pose.dedos[lado]);
  }
  rig.updateMatrixWorld(true);
 }

 /** Objetivo de mano {en:'cabeza'|'pecho'|'cadera'|'raiz', p:[x,y,z]} (lado izquierdo; el derecho se refleja). */
 function objetivoMundo(o,lado){
  const off=new T.Vector3(...(lado==='der'?espejoV(o.p):o.p));
  if(o.en==='raiz')return off;
  const h=hueso[{cabeza:perfil.cabeza,pecho:perfil.pecho,cadera:perfil.cadera}[o.en]];
  const w=new T.Vector3(),qq=new T.Quaternion();h.getWorldPosition(w);h.getWorldQuaternion(qq);
  return w.add(off.applyQuaternion(qq));
 }
 function polo(dir,lado){return new T.Vector3(...(lado==='der'?espejoV(dir):dir));}

 /** IK de dos huesos con vector polo; los huesos tienen rotación identidad en reposo. */
 function ik2(a,b,c,P,poloDir){
  const A=hueso[a],B=hueso[b],C=hueso[c];
  const pa=new T.Vector3(),pb=new T.Vector3(),pc=new T.Vector3();A.getWorldPosition(pa);B.getWorldPosition(pb);C.getWorldPosition(pc);
  const L1=pa.distanceTo(pb),L2=pb.distanceTo(pc);
  const d0=P.clone().sub(pa);let d=d0.length();const dmax=(L1+L2)*.999,dmin=Math.abs(L1-L2)+1e-4;
  if(d>dmax){d0.multiplyScalar(dmax/d);d=dmax;}if(d<dmin){d0.multiplyScalar(dmin/Math.max(d,1e-6));d=dmin;}
  const eje=d0.clone().normalize();const x=(L1*L1-L2*L2+d*d)/(2*d),h=Math.sqrt(Math.max(0,L1*L1-x*x));
  const pd=poloDir.clone().addScaledVector(eje,-poloDir.dot(eje));if(pd.lengthSq()<1e-8)pd.set(0,0,-1);pd.normalize();
  const E=pa.clone().addScaledVector(eje,x).addScaledVector(pd,h);
  girarHacia(A,pb.clone().sub(pa).normalize(),E.clone().sub(pa).normalize());
  rig.updateMatrixWorld(true);B.getWorldPosition(pb);C.getWorldPosition(pc);
  girarHacia(B,pc.clone().sub(pb).normalize(),pa.clone().add(d0).sub(pb).normalize());
  rig.updateMatrixWorld(true);
 }
 /** Rota el hueso (en su espacio local) para que la dirección mundial `de` pase a `a`. */
 function girarHacia(h,de,a){
  const qd=new T.Quaternion().setFromUnitVectors(de,a),qp=new T.Quaternion();h.parent.getWorldQuaternion(qp);
  const qw=new T.Quaternion();h.getWorldQuaternion(qw);
  const nueva=qd.multiply(qw);h.quaternion.copy(qp.clone().invert().multiply(nueva));
 }
 /** Orienta la mano para que los dedos apunten a `dedos` y la palma mire a `palma` (mundo). */
 /** Reposo de la mano (mundo): por lado si el perfil lo da, si no, el izquierdo reflejado. */
 function reposoMano(lado){const r=perfil.manoReposo;if(r.izq)return r[lado];return lado==='der'?{dedos:espejoV(r.dedos),palma:espejoV(r.palma)}:r;}
 function orientarMano(n,lado,dedosDir,palmaDir){
  const h=hueso[n];const r=reposoMano(lado);
  const f0=new T.Vector3(...r.dedos).normalize(),n0=new T.Vector3(...r.palma);
  n0.addScaledVector(f0,-n0.dot(f0)).normalize();
  const f=new T.Vector3(...(lado==='der'?espejoV(dedosDir):dedosDir)).normalize(),nn=new T.Vector3(...(lado==='der'?espejoV(palmaDir):palmaDir));
  nn.addScaledVector(f,-nn.dot(f));if(nn.lengthSq()<1e-6)nn.copy(n0);nn.normalize();
  const B0=new T.Matrix4().makeBasis(f0,n0,f0.clone().cross(n0)),B=new T.Matrix4().makeBasis(f,nn,f.clone().cross(nn));
  const qw=new T.Quaternion().setFromRotationMatrix(B.multiply(B0.transpose()));
  const qp=new T.Quaternion();h.parent.getWorldQuaternion(qp);h.quaternion.copy(qp.invert().multiply(qw));
 }
 /** Flexión de dedos 0..1 alrededor del eje de cierre de la mano en reposo. */
 function dedos(lado,d){
  const l=L[lado];if(!l.dedos)return;const r=reposoMano(lado);
  const f0=new T.Vector3(...r.dedos).normalize(),n0=new T.Vector3(...r.palma).normalize();
  const eje=f0.clone().cross(n0).normalize();
  const relajo=perfil.dedosReposo??.18;
  for(const [dedo,lista] of Object.entries(l.dedos)){
   const k=(d[dedo]??relajo);
   const ejeD=dedo==='pulgar'&&perfil.ejePulgar?new T.Vector3(...(lado==='der'?espejoV(perfil.ejePulgar):perfil.ejePulgar)).normalize():eje;
   const ang=(dedo==='pulgar'?.9:1.35)*k;
   lista.forEach((hn,i)=>{if(hueso[hn])hueso[hn].quaternion.setFromAxisAngle(ejeD,ang*(i?1.1:.85));});
  }
 }
 function ikPierna(pl,lado,obj){
  // Pie en su lugar de reposo en el mundo (o donde diga la pose), rodilla hacia adelante.
  const pie=hueso[pl.pie];const pos0=esq.pos?esq.pos(pl.pie):pie.getWorldPosition(new T.Vector3());
  const P=pos0.clone();if(obj)P.add(new T.Vector3(...(lado==='der'?espejoV(obj):obj)));
  ik2(pl.muslo,pl.pierna,pl.pie,P,new T.Vector3(0,0,1));
  // El pie queda paralelo al suelo.
  const qp=new T.Quaternion();pie.parent.getWorldQuaternion(qp);pie.quaternion.copy(qp.invert());
 }
}

/* ── las definiciones de cada clip ───────────────────────────────────────────────────────── */

function DEFINICIONES(pf){
 const C=pf.cadera,Sp=pf.columna,Ch=pf.pecho,Up=pf.pechoAlto,N=pf.cuello,H=pf.cabeza;
 const Lz=pf.lados.izq,Rz=pf.lados.der,A=pf.anclas,k=pf.amplitud??1,flota=!!pf.flota;
 // Los extras (cola, orejas, antenas, órbita) REEMPLAZAN los del reposo: sumar dos Euler de un eje inclinado sacaría las luces de la órbita.
 const ex=(pose,t,clip,extra)=>{if(pf.extras)for(const [h,e] of Object.entries(pf.extras(t,clip,extra||{})))if(Array.isArray(e))pose.rot[h]=e.slice();else if(e&&e.pos){pose.pos[h]=sumar(pose.pos[h]||[0,0,0],e.pos);if(e.rot)rot(pose,h,e.rot);}};
 const ojos=(pose,x,y)=>{if(pf.ojos){rot(pose,pf.ojos[0],[y,x,0]);rot(pose,pf.ojos[1],[y,x,0]);}};
 // Sacádicos: pequeños saltos de mirada, deterministas, que cierran el bucle.
 const sacadas=(t,dur,sem=1)=>{const puntos=[[0,0,0],[.9,.05,-.02],[1.9,-.04,.015],[2.6,.02,.03],[3.8,-.06,-.01],[4.9,.03,0]];let x=0,y=0;for(const [ti,px,py] of puntos){const tt=ti*dur/6;const s=clamp01((t-tt)/.07);x+= (px-x)*s;y+=(py-y)*s;}return [x*sem,y];};
 const respirar=(pose,t,per=3,amp=1)=>{const r=Math.sin(t/per*Math.PI*2);rot(pose,Ch,[-.018*r*amp*k,0,0]);if(Up)rot(pose,Up,[-.012*r*amp*k,0,0]);
  if(pf.hombros){rot(pose,pf.hombros[0],[0,0,.02*r*amp]);rot(pose,pf.hombros[1],[0,0,-.02*r*amp]);}
  pose.pos[C]=sumar(pose.pos[C]||[0,0,0],[0,(flota?.012:.0025)*r*amp*k,0]);};
 const brazosReposo=(pose,t,amp=1)=>{
  const s=Math.sin(t*Math.PI*2/6);const b=pf.brazoReposo||{brazo:[0,0,0],antebrazo:[-.12,0,0]};
  rot(pose,Lz.brazo,sumar(b.brazo,[.02*s*amp,0,.015*s*amp]));rot(pose,Rz.brazo,espejo(sumar(b.brazo,[-.02*s*amp,0,.015*s*amp])));
  rot(pose,Lz.antebrazo,b.antebrazo);rot(pose,Rz.antebrazo,espejo(b.antebrazo));
  if(pf.brazosB){const bb=pf.brazosB;rot(pose,bb.izq.brazo,[.03*s,0,.02*s]);rot(pose,bb.der.brazo,espejo([-.03*s,0,.02*s]));}
 };
 const mano=(pose,lado,o)=>{pose.manos[lado]=o;};
 const dedosLado=(pose,lado,d)=>{pose.dedos[lado]={...pose.dedos[lado],...d};};

 const idlePose=(t,dur=6)=>{
  const p=poseVacia();respirar(p,t);brazosReposo(p,t);
  const w=Math.sin(t*Math.PI*2/dur);
  if(!flota){pose2(p,C,[0,w*.03*k,w*.012]);p.pos[C]=sumar(p.pos[C]||[0,0,0],[w*.012*k,0,0]);rot(p,Sp,[0,-w*.02,-w*.01]);}
  else {rot(p,C,[Math.sin(t*Math.PI*2/dur*2)*.02,w*.05,w*.025]);p.pos[C]=sumar(p.pos[C]||[0,0,0],[w*.01,0,0]);}
  rot(p,H,[Math.sin(t*Math.PI*2/dur*2+1)*.02,Math.sin(t*Math.PI*2/dur)*.05,Math.sin(t*Math.PI*2/dur+.5)*.02]);
  const [sx,sy]=sacadas(t,dur);ojos(p,sx,sy);ex(p,t,'idle',{dur});return p;
 };
 function pose2(p,h,e){rot(p,h,e);}

 const D={};
 D.idle={duracion:6,bucle:true,pose:t=>idlePose(t,6)};
 D.escuchar={duracion:4,bucle:true,pose:t=>{
  const p=idlePose(t*1.5,6);const w=Math.sin(t*Math.PI*2/4);
  rot(p,Sp,[.05*k,0,0]);rot(p,Ch,[.03*k,0,0]);rot(p,H,[.04+.02*w,.03,.13]);
  // Asiente apenas cada tanto: está atenta.
  rot(p,H,[.05*Math.max(0,Math.sin(t*Math.PI*2/2))**3,0,0]);ex(p,t,'escuchar');return p;}};
 D.hablar={duracion:4,bucle:true,pose:t=>{
  const p=idlePose(t*1.5,6);const w1=Math.sin(t*Math.PI*2/2),w2=Math.sin(t*Math.PI*2/4+1);
  rot(p,H,[.03*w1,.08*w2,.03*w1]);rot(p,Ch,[0,.05*w2,0]);
  // Una mano explica y la otra acompaña: palmas hacia arriba, frente al pecho.
  mano(p,'der',{peso:.85,ik:{en:'pecho',p:A.explicar.map((v,i)=>v+[.03*w2,.04*w1,.02*w1][i])},dedos:[0,.25,1],palma:[-.3,1,.2],codo:[.4,-.3,-1]});
  mano(p,'izq',{peso:.55,ik:{en:'pecho',p:A.explicar.map((v,i)=>v+[-.02*w1,.03*w2-.05,0][i])},dedos:[0,.25,1],palma:[-.3,1,.2],codo:[.4,-.3,-1]});
  dedosLado(p,'der',{indice:.1,medio:.15,resto:.25,pulgar:.1});dedosLado(p,'izq',{indice:.2,medio:.25,resto:.35});
  ex(p,t,'hablar');return p;}};
 D.pensar={duracion:4,bucle:true,pose:t=>{
  const p=idlePose(t*1.5,6);const w=Math.sin(t*Math.PI*2/4);
  rot(p,H,[-.1,.12,-.1+.02*w]);rot(p,Sp,[0,.04,0]);
  mano(p,'der',{peso:1,ik:{en:'cabeza',p:A.menton},dedos:[0,1,.35],palma:[.2,-.1,-1],codo:[.2,-1,.2]});
  // Golpecitos del índice en el mentón.
  dedosLado(p,'der',{indice:.25+.2*Math.max(0,Math.sin(t*Math.PI*2*1.5)),medio:.75,resto:.85,pulgar:.3});
  mano(p,'izq',{peso:.8,ik:{en:'pecho',p:A.cruzado},dedos:[-1,.1,.2],palma:[0,1,0],codo:[.3,-1,-.2]});
  ojos(p,.06,-.12);ex(p,t,'pensar');return p;}};
 D.dormir={duracion:5,bucle:true,pose:t=>{
  const p=poseVacia();respirar(p,t,5,2.2);brazosReposo(p,t,.3);
  rot(p,H,[.32,.05,.12]);rot(p,N,[.12,0,0]);rot(p,Ch,[.06,0,0]);
  if(pf.hombros){rot(p,pf.hombros[0],[0,0,-.05]);rot(p,pf.hombros[1],[0,0,.05]);}
  dedosLado(p,'izq',{indice:.35,medio:.35,resto:.35});dedosLado(p,'der',{indice:.35,medio:.35,resto:.35});
  if(flota)p.pos[C]=sumar(p.pos[C]||[0,0,0],[0,-.04,0]);
  ex(p,t,'dormir');return p;}};
 D.levantada={duracion:2,bucle:true,pose:t=>{
  const p=poseVacia();const w=Math.sin(t*Math.PI);
  rot(p,H,[-.08,0,.08*w]);rot(p,Ch,[0,0,.04*w]);
  rot(p,Lz.brazo,[.1*w,0,.5+.1*w]);rot(p,Rz.brazo,espejo([-.1*w,0,.5-.1*w]));rot(p,Lz.antebrazo,[-.3,0,0]);rot(p,Rz.antebrazo,[-.3,0,0]);
  if(pf.piernas){p.pies.izq=[0,.06+.03*w,.05*w];p.pies.der=[0,.06-.03*w,-.05*w];}
  if(flota)p.pos[C]=[0,.05,0];
  ex(p,t,'levantada');return p;}};
 D.caminar={duracion:1.1,bucle:true,pose:t=>{
  const p=poseVacia();const ph=t/1.1*Math.PI*2,s=Math.sin(ph),c=Math.cos(ph);respirar(p,t*2,1.1,.5);
  if(flota){rot(p,C,[.12,0,.05*s]);p.pos[C]=[.02*s,.02*Math.sin(ph*2),0];rot(p,H,[-.08,0,-.03*s]);
   mano(p,'izq',{peso:.6,ik:{en:'pecho',p:A.caminar},dedos:[0,-1,-.3],palma:[-1,0,0]});mano(p,'der',{peso:.6,ik:{en:'pecho',p:A.caminar},dedos:[0,-1,-.3],palma:[-1,0,0]});}
  else{
   p.pos[C]=[0,.018*k*Math.abs(Math.sin(ph))-.01*k,0];rot(p,C,[0,.08*s,.03*s]);rot(p,Sp,[.04,-.1*s,0]);rot(p,H,[0,.06*s,0]);
   const paso=.13*(pf.paso??1),alt=.06*(pf.paso??1);
   p.pies.izq=[0,Math.max(0,-c)*alt,s*paso];p.pies.der=[0,Math.max(0,c)*alt,-s*paso];
   rot(p,Lz.brazo,[-.35*s,0,.05]);rot(p,Rz.brazo,espejo([.35*s,0,.05]));rot(p,Lz.antebrazo,[-.3-.15*Math.max(0,-s),0,0]);rot(p,Rz.antebrazo,[-.3-.15*Math.max(0,s),0,0]);
   if(pf.brazosB){rot(p,pf.brazosB.izq.brazo,[.25*s,0,0]);rot(p,pf.brazosB.der.brazo,[-.25*s,0,0]);}
  }
  ex(p,t,'caminar');return p;}};

 // Gestos de una vez: parten y vuelven al reposo (idle en t=0) con envolventes suaves.
 const gesto=(dur,f)=>({duracion:dur,bucle:false,pose:t=>{const p=idlePose(t,6);f(p,t);return p;}});
 D.saludar=gesto(2.2,(p,t)=>{
  const e=env(t,0,.45,1.7,2.2),o=Math.sin((t-.4)*Math.PI*2*2.2)*env(t,.4,.6,1.6,1.9);
  mano(p,'der',{peso:e,ik:{en:'cabeza',p:A.saludo},dedos:[.1,1,.05],palma:[0,.1,1],giroMano:[0,0,-.35*o],codo:[.6,-.9,-.3]});
  dedosLado(p,'der',{indice:.05,medio:.05,resto:.08,pulgar:.1});
  rot(p,H,[-.04*e,-.08*e,-.1*e]);rot(p,Ch,[0,-.06*e,-.04*e]);if(!flota)rot(p,C,[0,0,.03*e]);
  ex(p,t,'saludar',{e,o});});
 D.senalar=gesto(1.8,(p,t)=>{
  const e=env(t,0,.4,1.3,1.8);
  mano(p,'izq',{peso:e,ik:{en:'pecho',p:A.senal},dedos:[.55,-.75,.35],palma:[0,-.3,-1],codo:[.5,-.4,-1]});
  dedosLado(p,'izq',{indice:.02*e+(1-e)*.18,medio:.18+.8*e,resto:.18+.82*e,pulgar:.18+.5*e});
  rot(p,H,[.22*e,.32*e,.05*e]);rot(p,Ch,[.03*e,.12*e,0]);ojos(p,.1*e,.12*e);ex(p,t,'senalar',{e});});
 D.toque_cabeza=gesto(1.5,(p,t)=>{
  const e=env(t,0,.18,.8,1.5),w=Math.sin(t*Math.PI*2*3)*env(t,.15,.3,.9,1.3);
  rot(p,H,[.14*e,0,.08*w]);rot(p,N,[.06*e,0,0]);rot(p,Ch,[.05*e,0,.03*w]);
  if(pf.hombros){rot(p,pf.hombros[0],[0,0,.18*e]);rot(p,pf.hombros[1],[0,0,-.18*e]);}
  if(!flota)p.pos[C]=sumar(p.pos[C]||[0,0,0],[0,-.03*e*k,0]);else p.pos[C]=sumar(p.pos[C]||[0,0,0],[0,-.04*e,0]);
  mano(p,'izq',{peso:.5*e,ik:{en:'pecho',p:A.juntas},dedos:[0,-.3,1],palma:[-1,0,0]});mano(p,'der',{peso:.5*e,ik:{en:'pecho',p:A.juntas},dedos:[0,-.3,1],palma:[-1,0,0]});
  ex(p,t,'toque_cabeza',{e,w});});
 D.toque_mejilla=gesto(2,(p,t)=>{
  const e=env(t,0,.35,1.4,2),w=Math.sin(t*Math.PI*2*.8)*e;
  mano(p,'izq',{peso:e,ik:{en:'cabeza',p:A.mejilla},dedos:[-.2,1,.2],palma:[-1,0,-.2],codo:[.2,-1,.1]});
  dedosLado(p,'izq',{indice:.3,medio:.35,resto:.45,pulgar:.3});
  mano(p,'der',{peso:.6*e,ik:{en:'pecho',p:A.cruzado},dedos:[-1,.1,.2],palma:[0,1,0]});
  rot(p,H,[.12*e,-.25*e,.2*e+.03*w]);rot(p,Ch,[.04*e,-.08*e,.05*w]);
  if(pf.hombros){rot(p,pf.hombros[0],[0,0,.22*e]);rot(p,pf.hombros[1],[0,0,-.15*e]);}
  ojos(p,-.12*e,.1*e);if(!flota)rot(p,C,[0,0,.03*w]);ex(p,t,'toque_mejilla',{e,w});});
 D.toque_panza=gesto(1.8,(p,t)=>{
  const e=env(t,0,.2,1.2,1.8),b=Math.abs(Math.sin(t*Math.PI*2*3))*env(t,.15,.3,1.1,1.5);
  mano(p,'izq',{peso:e,ik:{en:'cadera',p:A.panza},dedos:[-.6,-.3,.5],palma:[-.3,0,-1]});mano(p,'der',{peso:e,ik:{en:'cadera',p:A.panza},dedos:[-.6,-.3,.5],palma:[-.3,0,-1]});
  rot(p,Sp,[.2*e,0,0]);rot(p,Ch,[.12*e,0,.05*b]);rot(p,H,[-.15*e,0,.08*b]);
  if(!flota)p.pos[C]=sumar(p.pos[C]||[0,0,0],[0,-.04*e*k+.012*b*k,0]);else{p.pos[C]=sumar(p.pos[C]||[0,0,0],[0,.03*b,0]);rot(p,C,[.1*e,0,0]);}
  dedosLado(p,'izq',{indice:.4,medio:.4,resto:.45});dedosLado(p,'der',{indice:.4,medio:.4,resto:.45});
  ex(p,t,'toque_panza',{e,b});});
 D.enojo=gesto(1.8,(p,t)=>{
  const e=env(t,0,.3,1.3,1.8),n=Math.sin((t-.3)*Math.PI*2*2.5)*env(t,.3,.4,1.1,1.3),pis=env(t,.55,.65,.72,.85);
  mano(p,'izq',{peso:e,ik:{en:'cadera',p:A.jarra},dedos:[-.7,-.6,.2],palma:[-1,0,0],codo:[1,.1,-.3]});mano(p,'der',{peso:e,ik:{en:'cadera',p:A.jarra},dedos:[-.7,-.6,.2],palma:[-1,0,0],codo:[1,.1,-.3]});
  dedosLado(p,'izq',{indice:.8,medio:.85,resto:.9,pulgar:.6});dedosLado(p,'der',{indice:.8,medio:.85,resto:.9,pulgar:.6});
  rot(p,H,[.08*e,.22*n,0]);rot(p,Ch,[-.04*e,0,0]);
  if(pf.piernas)p.pies.der=[0,.07*pis,.02*pis];
  if(!flota)p.pos[C]=sumar(p.pos[C]||[0,0,0],[0,-.012*env(t,.8,.85,.9,1.05)*k,0]);else p.pos[C]=sumar(p.pos[C]||[0,0,0],[0,-.03*env(t,.8,.85,.9,1.05),0]);
  ex(p,t,'enojo',{e,n});});
 D.gusto=gesto(1.6,(p,t)=>{
  const e=env(t,0,.25,1.1,1.6),salto=Math.max(0,Math.sin(clamp01((t-.2)/.5)*Math.PI));
  mano(p,'izq',{peso:e,ik:{en:'pecho',p:A.juntas},dedos:[.1,.5,1],palma:[-1,0,0],codo:[.4,-1,-.3]});mano(p,'der',{peso:e,ik:{en:'pecho',p:A.juntas},dedos:[.1,.5,1],palma:[-1,0,0],codo:[.4,-1,-.3]});
  dedosLado(p,'izq',{indice:.3,medio:.35,resto:.4});dedosLado(p,'der',{indice:.3,medio:.35,resto:.4});
  p.pos[C]=sumar(p.pos[C]||[0,0,0],[0,(flota?.08:.06*k)*salto,0]);
  if(pf.piernas){p.pies.izq=[0,.06*k*salto*.8,0];p.pies.der=[0,.06*k*salto*.8,0];}
  rot(p,H,[-.1*e,0,.08*Math.sin(t*Math.PI*2*1.2)*e]);rot(p,Ch,[-.05*e,0,0]);ex(p,t,'gusto',{e,salto});});
 D.celebrar=gesto(2.2,(p,t)=>{
  const e=env(t,0,.35,1.7,2.2),salto=Math.abs(Math.sin(clamp01((t-.3)/1.4)*Math.PI*2));
  mano(p,'izq',{peso:e,ik:{en:'cabeza',p:A.arriba},dedos:[0,1,0],palma:[-.5,0,1],codo:[1,-.3,-.3]});mano(p,'der',{peso:e,ik:{en:'cabeza',p:A.arriba},dedos:[0,1,0],palma:[-.5,0,1],codo:[1,-.3,-.3]});
  dedosLado(p,'izq',{indice:.9*e,medio:.9*e,resto:.9*e,pulgar:.7*e});dedosLado(p,'der',{indice:.9*e,medio:.9*e,resto:.9*e,pulgar:.7*e});
  p.pos[C]=sumar(p.pos[C]||[0,0,0],[0,(flota?.07:.07*k)*salto*e,0]);
  if(pf.piernas){p.pies.izq=[0,.05*k*salto*e,0];p.pies.der=[0,.05*k*salto*e,0];}
  rot(p,H,[-.15*e,0,0]);rot(p,Ch,[-.06*e,0,0]);ex(p,t,'celebrar',{e,salto});});
 D.entrar=gesto(1.3,(p,t)=>{
  const u=resorte(t/1.1),agache=1-u;
  p.pos[C]=sumar(p.pos[C]||[0,0,0],[0,-(flota?.18:.12*k)*agache+(flota?.05:.05*k)*Math.max(0,Math.sin(clamp01(t/.7)*Math.PI)),0]);
  rot(p,Sp,[.25*agache,0,0]);rot(p,H,[-.2*agache,0,0]);
  const e=env(t,.35,.6,.95,1.3),o=Math.sin(t*Math.PI*2*3)*e;
  mano(p,'der',{peso:e*.9,ik:{en:'cabeza',p:A.saludo},dedos:[.1,1,.05],palma:[0,.1,1],giroMano:[0,0,-.3*o],codo:[.6,-.9,-.3]});
  ex(p,t,'entrar',{e:u});});
 D.salir=gesto(1.3,(p,t)=>{
  const e=env(t,0,.25,.6,.9),o=Math.sin(t*Math.PI*2*3)*e,ag=S(clamp01((t-.55)/.55))*(1-S(clamp01((t-1.15)/.15)));
  mano(p,'der',{peso:e,ik:{en:'cabeza',p:A.saludo},dedos:[.1,1,.05],palma:[0,.1,1],giroMano:[0,0,-.3*o],codo:[.6,-.9,-.3]});
  p.pos[C]=sumar(p.pos[C]||[0,0,0],[0,-(flota?.2:.14*k)*ag,0]);rot(p,Sp,[.3*ag,0,0]);rot(p,H,[.15*ag,0,0]);
  ex(p,t,'salir',{e,ag});});
 D.despertar=gesto(2.2,(p,t)=>{
  const e=env(t,0,.6,1.4,2.2),y=env(t,.3,.7,1.1,1.5);
  mano(p,'izq',{peso:e,ik:{en:'cabeza',p:A.estirar},dedos:[0,1,0],palma:[-1,0,0],codo:[1,.2,-.4]});mano(p,'der',{peso:e,ik:{en:'cabeza',p:A.estirar},dedos:[0,1,0],palma:[-1,0,0],codo:[1,.2,-.4]});
  rot(p,H,[-.3*y,0,.05*y]);rot(p,Ch,[-.1*e,0,0]);rot(p,Sp,[-.06*e,0,0]);
  p.pos[C]=sumar(p.pos[C]||[0,0,0],[0,(flota?.03:.02*k)*e,0]);ex(p,t,'despertar',{e,y});});
 return D;
}
