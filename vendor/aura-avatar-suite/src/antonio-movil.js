import * as T from 'three';
import {MeshoptSimplifier} from 'meshoptimizer';
import {Esqueleto,Constructor,zona,camaraNodo} from './kit/cuerpo.js';
import {campoCompleto} from './kit/cara.js';
import {crearClips} from './kit/animaciones.js';

// ANT-ONIO móvil: el GLB APROBADO (assets/ANT-ONIO.glb, intacto) convertido al contrato de la app
// SIN cambiar su diseño. Misma geometría (simplificada con un error máximo de fracciones de
// milímetro), mismos materiales y colores (el color de cada material pasa al color por vértice
// para agrupar primitivas; el «sheen» de la tela se quita porque la especificación lo prohíbe),
// mismas formas de boca. Lo que cambia es técnico: esqueleto VRM con piel, escala en metros con
// los pies en y = 0, los 52 blendshapes ARKit + 15 visemas + «rubor» (armados posando el rig
// original: párpados, cejas, antenas, dientes y lengua) y los clips del vocabulario común.

const K=.4,Y0=.296,COMP_SHEEN=.9; // escala a metros (1,74 m de alto) y suelo del modelo original

export async function convertirAntonio(gltf,{calidad='alta'}={}){
 await MeshoptSimplifier.ready;
 const alta=calidad!=='baja';
 const esc=gltf.scene;const nodo=n=>{const o=esc.getObjectByName(n);if(!o)throw Error('Falta el nodo '+n);return o;};
 // Pose de reposo = clip «neutral» en t=0 (lo que mostraba el controlador original).
 const mezcla=new T.AnimationMixer(esc);const neutro=gltf.animations.find(a=>a.name==='neutral');if(neutro){mezcla.clipAction(neutro).play();mezcla.setTime(0);}
 esc.updateMatrixWorld(true);
 const aM=v=>new T.Vector3(v.x*K,(v.y-Y0)*K,v.z*K);
 const mundo=n=>aM(nodo(n).getWorldPosition(new T.Vector3())).toArray();

 /* ── esqueleto con nombres VRM (posiciones = pivotes originales) ──────────────────────── */
 const piernaY=mundo('leg_1')[1];
 const def=[
  {n:'hips',x:[0,piernaY,0]},{n:'spine',p:'hips',x:[0,(piernaY+mundo('torso')[1])/2,0]},{n:'chest',p:'spine',x:mundo('torso')},
  {n:'upperChest',p:'chest',x:[0,mundo('torso')[1]+.4*K,0]},{n:'neck',p:'upperChest',x:[0,mundo('torso')[1]+.72*K,0]},{n:'head',p:'neck',x:mundo('head')},
  {n:'leftEye',p:'head',x:mundo('gaze_1')},{n:'rightEye',p:'head',x:mundo('gaze_-1')},{n:'jaw',p:'head',x:[0,mundo('teeth')[1],mundo('teeth')[2]]},
  {n:'lentes',p:'head',x:mundo('glasses')},
  {n:'antenaIzq',p:'head',x:mundo('antenna_1')},{n:'antenaIzqPunta',p:'antenaIzq',x:mundo('antenna_tip_1')},
  {n:'antenaDer',p:'head',x:mundo('antenna_-1')},{n:'antenaDerPunta',p:'antenaDer',x:mundo('antenna_tip_-1')},
 ];
 for(const [l,s] of [['left',1],['right',-1]]){
  const L=l==='left'?'Izq':'Der';
  def.push({n:l+'Shoulder',p:'upperChest',x:[s*.2*K,mundo('upper_arm_'+s)[1],0]},{n:l+'UpperArm',p:l+'Shoulder',x:mundo('upper_arm_'+s)},{n:l+'LowerArm',p:l+'UpperArm',x:mundo('upper_fore_'+s)},{n:l+'Hand',p:l+'LowerArm',x:mundo('upper_hand_'+s)});
  for(const [f,orig] of [['Ring',0],['Middle',1],['Index',2]])def.push({n:l+f+'Proximal',p:l+'Hand',x:mundo(`upper_hand_${s}_finger_${orig}`)});
  def.push({n:l+'ThumbProximal',p:l+'Hand',x:mundo(`upper_hand_${s}_thumb`)});
  def.push({n:'brazo'+L+'B',p:'chest',x:mundo('lower_arm_'+s)},{n:'antebrazo'+L+'B',p:'brazo'+L+'B',x:mundo('lower_fore_'+s)},{n:'mano'+L+'B',p:'antebrazo'+L+'B',x:mundo('lower_hand_'+s)});
  def.push({n:l+'UpperLeg',p:'hips',x:mundo('leg_'+s)},{n:l+'LowerLeg',p:l+'UpperLeg',x:mundo('knee_'+s)},{n:l+'Foot',p:l+'LowerLeg',x:mundo('foot_'+s)});
  const pie=mundo('foot_'+s);def.push({n:l+'Toes',p:l+'Foot',x:[pie[0],pie[1]-.05,pie[2]+.12]});
 }
 const esq=new Esqueleto(def);
 // Nodo original → hueso nuevo (el primer ancestro que figure aquí manda).
 const MAPA={body:'hips',torso:'chest',head:'head',glasses:'lentes',teeth:'head',tongue:'head'};
 for(const [l,s] of [['left',1],['right',-1]]){const L=l==='left'?'Izq':'Der';
  Object.assign(MAPA,{['gaze_'+s]:l+'Eye',['sclera_'+s]:l+'Eye',['eye_'+s]:'head',['antenna_'+s]:'antena'+L,['antenna_tip_'+s]:'antena'+L+'Punta',['upper_arm_'+s]:l+'UpperArm',['upper_fore_'+s]:l+'LowerArm',['upper_hand_'+s]:l+'Hand',
   [`upper_hand_${s}_finger_0`]:l+'RingProximal',[`upper_hand_${s}_finger_1`]:l+'MiddleProximal',[`upper_hand_${s}_finger_2`]:l+'IndexProximal',[`upper_hand_${s}_thumb`]:l+'ThumbProximal',
   ['lower_arm_'+s]:'brazo'+L+'B',['lower_fore_'+s]:'antebrazo'+L+'B',['lower_hand_'+s]:'mano'+L+'B',['leg_'+s]:l+'UpperLeg',['knee_'+s]:l+'LowerLeg',['foot_'+s]:l+'Foot'});}
 const huesoDe=o=>{let n=o;while(n){if(MAPA[n.name])return MAPA[n.name];if(n.name==='neck')return 'neck';n=n.parent;}return 'hips';};

 /* ── materiales: se agrupan los que solo cambian de color (el color va por vértice) ────── */
 const grupos=new Map(),matDe=new Map();
 const claveMat=m=>JSON.stringify([m.type,m.roughness,m.metalness,m.map?.uuid,m.normalMap?.uuid,m.normalScale?.x,m.roughnessMap?.uuid,m.clearcoat??0,m.clearcoatRoughness??0,m.specularIntensity??1,m.transparent,m.opacity<1?m.opacity:1,m.side,m.map?.repeat?.x]);
 const mats={};
 esc.traverse(o=>{if(!o.isMesh)return;const m=o.material;const k=claveMat(m);if(!grupos.has(k)){const id='m'+grupos.size;grupos.set(k,id);
  const nm=m.clone();nm.name='antonio_'+id;if(!nm.isMeshBasicMaterial){nm.color=new T.Color(1,1,1);}else nm.color=new T.Color(1,1,1);
  nm.vertexColors=true;if('sheen' in nm)nm.sheen=0;mats[id]=nm;}
  matDe.set(o,grupos.get(k));});
 mats.zona=new T.MeshBasicMaterial({name:'zona',transparent:true,opacity:0,depthWrite:false});
 const B=new Constructor(esq,mats);

 /* ── piezas: cara (con morphs) o cuerpo; simplificadas con error absoluto ─────────────── */
 const CARA=/continuous_face|^mouth$|lip_contour|upper_dental_plate|tongue_surface|eyelid|closed_eye_line|tapered_brow|sclera|detailed_amber_iris|cornea_glint|antenna/;
 const piezasCara=[];
 const err=(o)=>{if(!alta)return /continuous_face|^mouth$|lip_contour/.test(o.name)?.0012:.0032;return /head|eye|lid|brow|iris|glint|face|mouth|lip|teeth|tongue|dental|nostril|glasses|temple|frame/.test(o.name+' '+(o.parent?.name||''))?.00035:/sneaker|sole|abdomen|cranium/.test(o.name)?.0004:.0009;};
 esc.traverse(o=>{
  if(!o.isMesh)return;
  const g0=o.geometry;const cara=CARA.test(o.name);
  const idx=g0.index?g0.index.array:Uint32Array.from({length:g0.attributes.position.count},(_,i)=>i);
  // Posiciones en metros para medir el error de la simplificación.
  const pos=g0.attributes.position,mw=o.matrixWorld,v=new T.Vector3(),pm=new Float32Array(pos.count*3);
  for(let i=0;i<pos.count;i++){v.fromBufferAttribute(pos,i).applyMatrix4(mw);const q=aM(v);pm.set([q.x,q.y,q.z],i*3);}
  let nuevo;
  const morphPos=g0.morphAttributes.position||[];
  if(morphPos.length){ // las formas de boca cuentan como atributos: se conserva su detalle
   const at=new Float32Array(pos.count*morphPos.length*3),w=[];for(let k=0;k<morphPos.length;k++){w.push(1,1,1);for(let i=0;i<pos.count;i++){at[(i*morphPos.length+k)*3]=morphPos[k].getX(i)*K;at[(i*morphPos.length+k)*3+1]=morphPos[k].getY(i)*K;at[(i*morphPos.length+k)*3+2]=morphPos[k].getZ(i)*K;}}
   [nuevo]=MeshoptSimplifier.simplifyWithAttributes(Uint32Array.from(idx),pm,3,at,morphPos.length*3,w.slice(0,Math.min(32,w.length)),null,0,err(o),['LockBorder','ErrorAbsolute']);
  }else [nuevo]=MeshoptSimplifier.simplify(Uint32Array.from(idx),pm,3,0,err(o),['LockBorder','ErrorAbsolute']);
  // Compacta: solo los vértices usados, en el mismo orden relativo.
  const usados=[...new Set(nuevo)].sort((a,b)=>a-b),mapa=new Map(usados.map((u,i)=>[u,i]));
  const g=new T.BufferGeometry();const P=new Float32Array(usados.length*3),Nn=new Float32Array(usados.length*3),Uv=new Float32Array(usados.length*2);
  const nor=g0.attributes.normal,uv=g0.attributes.uv,col=g0.attributes.color,nm=new T.Matrix3().getNormalMatrix(mw),nv=new T.Vector3();
  usados.forEach((u,i)=>{P.set(pm.subarray(u*3,u*3+3),i*3);if(nor){nv.fromBufferAttribute(nor,u).applyMatrix3(nm).normalize();Nn.set([nv.x,nv.y,nv.z],i*3);}if(uv)Uv.set([uv.getX(u),uv.getY(u)],i*2);});
  g.setAttribute('position',new T.BufferAttribute(P,3));g.setAttribute('normal',new T.BufferAttribute(Nn,3));g.setAttribute('uv',new T.BufferAttribute(Uv,2));
  // El determinante negativo (escalas espejadas) invierte el orden de los triángulos.
  const ix=Uint32Array.from(nuevo,u=>mapa.get(u));if(mw.determinant()<0)for(let t=0;t<ix.length;t+=3){const a=ix[t];ix[t]=ix[t+2];ix[t+2]=a;}
  g.setIndex(new T.BufferAttribute(ix,1));
  // Color del material × color por vértice original (lineal): el aspecto no cambia.
  const base=o.material.color?o.material.color.clone():new T.Color(1,1,1);
  // Sin «sheen» (prohibido en la especificación) la tela negra se ve un poco más oscura: se compensa.
  if(o.material.sheen>0)base.multiplyScalar(1+o.material.sheen*COMP_SHEEN);const cols=usados.map(u=>col?[base.r*col.getX(u),base.g*col.getY(u),base.b*col.getZ(u)]:[base.r,base.g,base.b]);
  const datos=usados.map((u,i)=>({pieza:piezasCara.length,i,orig:u}));
  if(cara)piezasCara.push({o,usados,morph:morphPos.length?morphPos:null});
  B.agregar(g,{material:matDe.get(o),hueso:huesoDe(o),color:(p,n,i)=>cols[i],cara,etiqueta:o.name,datos:cara?datos:null,ao:false});
 });

 /* ── morphs: se posa el rig ORIGINAL y se leen las posiciones ─────────────────────────── */
 const r={}; // nodos originales
 for(const n of ['head','teeth','tongue','glasses'])r[n]=nodo(n);
 for(const s of [1,-1]){for(const n of ['gaze_','brow_','closed_eye_crease_','antenna_','antenna_tip_','sclera_'])r[n+s]=nodo(n+s);for(const lw of ['upper','lower'])r[`${lw}_lid_pivot_${s}`]=nodo(`${lw}_lid_pivot_${s}`);}
 const guardado=new Map();esc.traverse(o=>guardado.set(o,{p:o.position.clone(),q:o.quaternion.clone(),s:o.scale.clone()}));
 const reponer=()=>{for(const [o,b] of guardado){o.position.copy(b.p);o.quaternion.copy(b.q);o.scale.copy(b.s);}};
 /** Estado del rig original (como faceTarget + animate del controlador de la entrega). */
 const posar=e=>{
  reponer();const m=e.m||[0,0,0,0,0,0];
  for(const s of [1,-1]){const k=s>0?0:1;
   const ab=Math.min(1.25,Math.max(0,e.ojo?.[k]??.97)),op=ab<.1?0:ab;
   r[`upper_lid_pivot_${s}`].rotation.x=-1.47*op;r[`lower_lid_pivot_${s}`].rotation.x=1.47*op;
   r['closed_eye_crease_'+s].scale.setScalar(op<.12?Math.max(.0001,1-op/.12):.0001);
   const g=e.mirada?.[k]||[0,0];r['gaze_'+s].rotation.set(g[1],g[0],0);r['sclera_'+s].rotation.set(g[1],g[0],0);
   r['brow_'+s].position.y+=e.cejaY?.[k]||0;r['brow_'+s].rotation.z=(e.cejaGiro?.[k]||0)*s;
   r['antenna_'+s].rotation.z=s*(e.antena?.[k]||0);r['antenna_'+s].rotation.x=e.antenaX?.[k]||0;
  }
  const abre=m[0]+m[1]+m[2]+m[3]*.4;
  r.teeth.position.y+=m[1]*.023+m[0]*.016;r.teeth.position.z-=m[2]*.02;
  r.teeth.scale.set(Math.max(.0001,(1-m[2]*.6)*Math.min(1,abre*5)),Math.max(.001,Math.min(1,abre*2)*(1-m[2]))*.66,Math.max(.0001,Math.min(1,abre*5)));
  const lg=Math.max(0,abre-.4)+(e.lengua||0);r.tongue.scale.set(Math.max(.0001,(1-m[2]*.65)*lg*1.8),Math.max(.001,lg*1.5),Math.max(.0001,lg*1.8));
  if(e.lengua)r.tongue.position.z+=e.lengua*.09;
  esc.updateMatrixWorld(true);
  return m;
 };
 /** Posiciones (metros) de cada vértice de las piezas de cara en un estado. */
 // Por vértice: posición (metros) y normal, 6 valores. Las normales también son morphs aquí: los
 // párpados giran 84° y sin normales propias el párpado cerrado se sombrearía como abierto.
 const leer=e=>{
  const m=posar(e);const out=[];const v=new T.Vector3(),n=new T.Vector3();
  for(const pz of piezasCara){const g=pz.o.geometry,pos=g.attributes.position,nor=g.attributes.normal,mn=g.morphAttributes.normal||[],mw=pz.o.matrixWorld,nm=new T.Matrix3().getNormalMatrix(mw),arr=new Float32Array(pz.usados.length*6);
   pz.usados.forEach((u,i)=>{v.fromBufferAttribute(pos,u);n.fromBufferAttribute(nor,u);if(pz.morph)for(let k=0;k<pz.morph.length;k++)if(m[k]){v.addScaledVector(new T.Vector3().fromBufferAttribute(pz.morph[k],u),m[k]);if(mn[k])n.addScaledVector(new T.Vector3().fromBufferAttribute(mn[k],u),m[k]);}
    v.applyMatrix4(mw);n.applyMatrix3(nm).normalize();const q=aM(v);arr.set([q.x,q.y,q.z,n.x,n.y,n.z],i*6);});out.push(arr);}
  return out;
 };
 const REPOSO={ojo:[.97,.97]};
 const base=leer(REPOSO);
 // Coordenadas en el espacio de la cabeza original (para las máscaras por lado y por región).
 const inv=new T.Matrix4().copy(r.head.matrixWorld).invert();const local=[];
 {posar(REPOSO);const v=new T.Vector3();for(const pz of piezasCara){const pos=pz.o.geometry.attributes.position,arr=[];pz.usados.forEach(u=>{v.fromBufferAttribute(pos,u).applyMatrix4(pz.o.matrixWorld).applyMatrix4(inv);arr.push(v.clone());});local.push(arr);}}
 // Diferencias menores a 1 µm son ruido de redondeo: se anulan (así los morphs quedan dispersos y pesan poco).
 const limpiar=v=>Math.abs(v)<1e-6?0:v;
 const delta=e=>{const d=leer({...REPOSO,...e});return d.map((a,k)=>a.map((x,i)=>i%6<3?limpiar(x-base[k][i]):(Math.abs(x-base[k][i])<1e-4?0:x-base[k][i])));};
 const ladoMask=(k,i,s)=>{const x=local[k][i].x;const t=Math.min(1,Math.max(0,.5+x*s/.12));return t*t*(3-2*t);};
 const bocaMask=(k,i,{r=.3,cy=-.315}={})=>{const p=local[k][i];const d=Math.hypot(p.x/1.2,p.y-cy);return Math.max(0,1-d/r)**1.5;};
 const esBoca=k=>/continuous_face|^mouth$|lip_contour|dental|tongue/.test(piezasCara[k].o.name);
 const DEF={}; // nombre → deltas por pieza
 const forma=(m,mask=null)=>{const d=delta({m});return mask?d.map((a,k)=>a.map((x,j)=>x*mask(k,Math.floor(j/6)))):d;};
 const suma=(...lista)=>lista.reduce((acc,[d,w])=>acc?acc.map((a,k)=>a.map((x,j)=>x+d[k][j]*w)):d.map(a=>a.map(x=>x*w)),null);
 const M=i=>{const m=[0,0,0,0,0,0];m[i]=1;return m;};
 const F={open:forma(M(0)),laugh:forma(M(1)),round:forma(M(2)),wide:forma(M(3)),frown:forma(M(4)),closed:forma(M(5))};
 const lado=(d,s)=>d.map((a,k)=>a.map((x,j)=>x*ladoMask(k,Math.floor(j/6),s)));
 const region=(d,fn)=>d.map((a,k)=>a.map((x,j)=>x*fn(k,Math.floor(j/6))));
 const abajo=(k,i)=>{const y=local[k][i].y;const t=Math.min(1,Math.max(0,(-.3-y)/.04+.5));return t*t*(3-2*t);},arriba=(k,i)=>1-abajo(k,i);
 const mover=(fn)=>base.map((a,k)=>{const o=new Float32Array(a.length);for(let i=0;i<a.length/6;i++){const d=fn(k,i);if(d){o[i*6]=d[0];o[i*6+1]=d[1];o[i*6+2]=d[2];}}return o;});
 for(const [s,Ld] of [[1,'Left'],[-1,'Right']]){
  const k=s>0?0:1,ojo=(v)=>{const o=[.97,.97];o[k]=v;return o;},par=(v)=>{const o=[0,0];o[k]=v;return o;};
  DEF['eyeBlink'+Ld]=delta({ojo:ojo(0)});
  DEF['eyeSquint'+Ld]=delta({ojo:ojo(.62)});
  DEF['eyeWide'+Ld]=delta({ojo:ojo(1.12)});
  DEF['cheekSquint'+Ld]=delta({ojo:ojo(.82)});
  const mir=v=>{const o=[[0,0],[0,0]];o[k]=v;return o;};
  DEF['eyeLookUp'+Ld]=delta({mirada:mir([0,-.2])});DEF['eyeLookDown'+Ld]=delta({mirada:mir([0,.2])});
  DEF['eyeLookIn'+Ld]=delta({mirada:mir([-.24*s,0])});DEF['eyeLookOut'+Ld]=delta({mirada:mir([.24*s,0])});
  DEF['browDown'+Ld]=delta({cejaY:par(-.035),cejaGiro:par(-.3)});
  DEF['browOuterUp'+Ld]=delta({cejaY:par(.075),cejaGiro:par(-.1),antena:par(-.12)});
  DEF['mouthSmile'+Ld]=lado(F.laugh,s);DEF['mouthFrown'+Ld]=lado(F.frown,s);DEF['mouthStretch'+Ld]=lado(F.wide,s);
  DEF['mouthDimple'+Ld]=lado(suma([F.wide,.3],[F.laugh,.1]),s);DEF['mouthPress'+Ld]=lado(region(F.closed,esBoca?(()=>.6):null),s);
  DEF['mouthLowerDown'+Ld]=lado(region(F.open,abajo),s);DEF['mouthUpperUp'+Ld]=lado(suma([region(F.open,arriba),.45],[F.laugh,.08]),s);
  DEF['noseSneer'+Ld]=mover((kk,i)=>{const p=local[kk][i];const w=Math.max(0,1-Math.hypot(p.x-.06*s,p.y+.08)/.12);return w?[0,.012*K*w,0]:null;});
 }
 DEF.browInnerUp=delta({cejaY:[.045,.045],cejaGiro:[.3,.3],antena:[.42,.42]});
 DEF.jawOpen=F.open;DEF.mouthClose=F.closed;DEF.mouthFunnel=suma([F.round,.8],[F.open,.2]);DEF.mouthPucker=F.round;
 DEF.mouthRollLower=region(F.closed,abajo);DEF.mouthRollUpper=region(F.closed,arriba);
 DEF.mouthShrugLower=region(suma([F.closed,.35],[F.frown,.25]),abajo);DEF.mouthShrugUpper=region(suma([F.closed,.25],[F.laugh,.1]),arriba);
 DEF.mouthLeft=mover((k,i)=>{const w=bocaMask(k,i);return w?[.028*K*w,0,0]:null;});DEF.mouthRight=mover((k,i)=>{const w=bocaMask(k,i);return w?[-.028*K*w,0,0]:null;});
 DEF.jawLeft=mover((k,i)=>{const w=bocaMask(k,i)*abajo(k,i);return w?[.02*K*w,0,0]:null;});DEF.jawRight=mover((k,i)=>{const w=bocaMask(k,i)*abajo(k,i);return w?[-.02*K*w,0,0]:null;});
 DEF.jawForward=mover((k,i)=>{const w=bocaMask(k,i)*abajo(k,i);return w?[0,0,.02*K*w]:null;});
 DEF.cheekPuff=mover((k,i)=>{if(!/continuous_face/.test(piezasCara[k].o.name))return null;const p=local[k][i];let w=0;for(const s of [1,-1])w+=Math.max(0,1-Math.hypot(p.x-.42*s,p.y+.22)/.2);return w?[Math.sign(p.x)*.03*K*w,0,.02*K*w]:null;});
 DEF.tongueOut=delta({lengua:.5,m:[.25,0,0,0,0,0]});
 // Antenas con las caras: caen con la tristeza, se paran con la sorpresa, se levantan al sonreír.
 const antenas=(e)=>{const d=delta(e);return d.map((a,k)=>/antenna/.test(piezasCara[k].o.name)?a:new Float32Array(a.length));};
 const sumarA=(n,e)=>{const d=antenas(e);DEF[n]=DEF[n].map((a,k)=>a.map((x,j)=>x+d[k][j]));};
 sumarA('eyeWideLeft',{antena:[-.18,0]});sumarA('eyeWideRight',{antena:[0,-.18]});
 sumarA('browDownLeft',{antenaX:[-.2,0]});sumarA('browDownRight',{antenaX:[0,-.2]});
 sumarA('mouthSmileLeft',{antena:[-.08,0]});sumarA('mouthSmileRight',{antena:[0,-.08]});
 reponer();esc.updateMatrixWorld(true);
 const campoArkit=(nombre,info)=>{const d=DEF[nombre];if(!d||!info.dato)return null;const a=d[info.dato.pieza],i=info.dato.i;const x=a[i*6],y=a[i*6+1],z=a[i*6+2];return x||y||z?[x,y,z]:null;};
 const campoNormal=(nombre,info)=>{const d=DEF[nombre];if(!d||!info.dato)return null;const a=d[info.dato.pieza],i=info.dato.i;const x=a[i*6+3],y=a[i*6+4],z=a[i*6+5];return x||y||z?[x,y,z]:null;};
 // Visemas con las formas propias de ANT-ONIO (reemplazan la receta genérica).
 const V=(o)=>o;
 const campo=campoCompleto(campoArkit,{campoNormalArkit:campoNormal,reemplazar:{
  sil:V({}),aa:V({jawOpen:1}),E:V({mouthStretchLeft:.7,mouthStretchRight:.7,jawOpen:.35}),I:V({mouthStretchLeft:1,mouthStretchRight:1,jawOpen:.15}),
  O:V({mouthPucker:1,jawOpen:.15}),U:V({mouthPucker:.85}),PP:V({mouthClose:1}),FF:V({mouthClose:.6,mouthStretchLeft:.3,mouthStretchRight:.3}),
  TH:V({jawOpen:.35,tongueOut:.4}),DD:V({jawOpen:.45,mouthStretchLeft:.2,mouthStretchRight:.2}),kk:V({jawOpen:.55,mouthStretchLeft:.2,mouthStretchRight:.2}),
  CH:V({mouthPucker:.6,jawOpen:.25}),SS:V({mouthStretchLeft:.7,mouthStretchRight:.7,jawOpen:.1}),nn:V({jawOpen:.3,mouthClose:.3}),RR:V({mouthPucker:.5,jawOpen:.3})
 }});
 const res=B.construir({nombre:'ANT_ONIO',morphs:campo});

 // Zonas, cámaras y clips del vocabulario común.
 const cab=esq.pos('head');
 zona(esq,'zona_cabeza','head',[0,cab.y+.2,cab.z-.02],[.28,.13,.24],mats.zona);
 zona(esq,'zona_mejilla_izq','head',[.2,cab.y-.06,cab.z+.16],[.08,.08,.08],mats.zona);
 zona(esq,'zona_mejilla_der','head',[-.2,cab.y-.06,cab.z+.16],[.08,.08,.08],mats.zona);
 zona(esq,'zona_panza','chest',[0,esq.pos('chest').y-.12,.12],[.16,.12,.1],mats.zona);
 camaraNodo(res.raiz,'camara_retrato',[0,cab.y+.03,0],1.7);
 camaraNodo(res.raiz,'camara_cuerpo',[0,.9,0],4.1);
 const perfil=perfilAntonio(esq);
 const clips=crearClips(esq,perfil);
 res.raiz.userData={personaje:'ANT-ONIO',version:'2.0.0-movil',calidad,origen:'assets/ANT-ONIO.glb (aprobado, sin cambios de diseño)'};
 return {raiz:res.raiz,clips,perfil,esqueleto:esq,mallas:{cuerpo:res.cuerpo,cara:res.cara},materiales:mats,anclas:perfil.anclas};
}

function perfilAntonio(esq){
 const dedos=l=>({pulgar:[l+'ThumbProximal'],indice:[l+'IndexProximal'],medio:[l+'MiddleProximal'],resto:[l+'RingProximal']});
 const cab=esq.pos('head');
 return {
  cadera:'hips',columna:'spine',pecho:'chest',pechoAlto:'upperChest',cuello:'neck',cabeza:'head',ojos:['leftEye','rightEye'],hombros:['leftShoulder','rightShoulder'],
  lados:{izq:{brazo:'leftUpperArm',antebrazo:'leftLowerArm',mano:'leftHand',dedos:dedos('left')},der:{brazo:'rightUpperArm',antebrazo:'rightLowerArm',mano:'rightHand',dedos:dedos('right')}},
  piernas:{izq:{muslo:'leftUpperLeg',pierna:'leftLowerLeg',pie:'leftFoot'},der:{muslo:'rightUpperLeg',pierna:'rightLowerLeg',pie:'rightFoot'}},
  brazosB:{izq:{brazo:'brazoIzqB'},der:{brazo:'brazoDerB'}},
  amplitud:1,paso:1,dedosReposo:0,
  // Las manos originales miran con la palma hacia adelante; los dedos se cierran hacia la palma.
  manoReposo:{izq:{dedos:[0,-1,0],palma:[0,0,1]},der:{dedos:[0,-1,0],palma:[0,0,-1]}},codo:[.4,-.2,-1],
  brazoReposo:{brazo:[0,0,0],antebrazo:[0,0,0]},
  anclas:{
   mejilla:[.29,-.04,.22],menton:[.05,-.16,.3],saludo:[.47,.12,.17],arriba:[.45,.46,.1],estirar:[.42,.5,0],
   explicar:[.22,.05,.26],cruzado:[-.02,.02,.24],senal:[.38,-.3,.24],juntas:[.04,.05,.25],caminar:[.3,-.05,-.05],
   panza:[.1,.16,.22],jarra:[.22,.08,.04]
  },
  extras:(t,clip,x)=>{
   const dur={idle:6,escuchar:4,hablar:4,pensar:4,dormir:5,levantada:2,caminar:1.1}[clip]||x.dur||6;
   const f=k=>Math.sin(t/dur*Math.PI*2*k);
   const r={antenaIzq:[.024*f(2),0,.025*f(1)],antenaDer:[.024*f(2),0,-.025*Math.sin(t/dur*Math.PI*2+1)],antenaIzqPunta:[0,0,.034*f(3)],antenaDerPunta:[0,0,-.034*Math.sin(t/dur*Math.PI*6+1)]};
   if(clip==='escuchar'){r.antenaIzq[2]-=.15;r.antenaDer[2]+=.15;}
   if(clip==='dormir'){r.antenaIzq[2]+=.35;r.antenaDer[2]-=.35;}
   if(clip==='celebrar'||clip==='gusto'){const e=x.e||0;r.antenaIzq[2]-=.3*e;r.antenaDer[2]+=.3*e;r.antenaIzqPunta[2]+=.2*Math.sin(t*14)*e;r.antenaDerPunta[2]-=.2*Math.sin(t*14)*e;}
   if(clip==='toque_cabeza'){const e=x.e||0;r.antenaIzq[2]+=.4*e;r.antenaDer[2]-=.4*e;}
   if(clip==='enojo'){const e=x.e||0;r.antenaIzq[0]=-.25*e;r.antenaDer[0]=-.25*e;}
   // El segundo par de brazos acompaña los gestos grandes.
   if(clip==='celebrar'){const e=x.e||0;r.brazoIzqB=[0,0,.9*e];r.brazoDerB=[0,0,-.9*e];}
   if(clip==='saludar'){const e=x.e||0;r.brazoDerB=[-.3*e,0,-.3*e];}
   if(clip==='toque_panza'){const e=x.e||0;r.brazoIzqB=[-.3*e,0,0];r.brazoDerB=[-.3*e,0,0];}
   return r;
  }
 };
}
