import * as T from 'three';
import {EXPRESIONES_ESTUDIO,nombreVisema,RECETA_VISEMAS} from './kit/nombres.js';

// Controlador del estudio para los GLB móviles. Replica lo que hace la escena de la app
// (src/12-avatar3d/escena.ts + mobile/src/avatar3d/mapeo.ts): clip de fondo según el estado,
// gestos de una vez con fundidos, cara = expresión + visema (la boca de la expresión baja al 60 %
// mientras habla), mirada con cuello/cabeza/ojos. Suma lo que la app todavía no hace y se propone
// para ella: parpadeo con variación (dobles y a medias) y micro‑movimientos de mirada.

const BOCA_DE_EXPRESION=['mouthSmileLeft','mouthSmileRight','mouthFrownLeft','mouthFrownRight','mouthPucker','mouthFunnel','jawOpen','mouthStretchLeft','mouthStretchRight','mouthPressLeft','mouthPressRight'];
const RESPALDO={idle:null,caminar:'idle',escuchar:'idle',hablar:'escuchar',pensar:'idle',dormir:'idle',levantada:'idle'};
const HUESOS={cadera:'hips',pecho:'upperChest',cuello:'neck',cabeza:'head',ojoIzq:'leftEye',ojoDer:'rightEye'};
const suave=(a,b,r,dt)=>a+(b-a)*(1-Math.exp(-r*dt));

export class Controlador{
 constructor(gltf,{azar=Math.random}={}){
  this.raiz=gltf.scene;this.clips=gltf.animations;this.azar=azar;
  this.morphs=new Map();this.zonas=[];this.mallas=[];this.huesos={};this.reposo=new Map();
  this.raiz.traverse(o=>{
   if(/^zona_/.test(o.name)){this.zonas.push(o);o.visible=false;return;}
   if(o.isMesh){o.frustumCulled=false;this.mallas.push(o);
    if(o.morphTargetDictionary)for(const [k,i] of Object.entries(o.morphTargetDictionary)){if(!this.morphs.has(k))this.morphs.set(k,[]);this.morphs.get(k).push({m:o,i});}}
  });
  for(const [k,n] of Object.entries(HUESOS)){const o=this.raiz.getObjectByName(n);if(o){this.huesos[k]=o;this.reposo.set(o,o.quaternion.clone());}}
  this.mezclador=new T.AnimationMixer(this.raiz);this.acciones=new Map(this.clips.map(c=>[c.name,this.mezclador.clipAction(c)]));
  this.mezclador.addEventListener('finished',e=>this._termino(e.action));
  this.estado={expresion:'tranquila',intensidad:1,hablando:false,escuchando:false,silenciado:false,pensando:false,caminando:false,mirar:{x:0,y:0,activa:false}};
  this.boca={nivel:0,visema:'sil',peso:0};
  this.pesos=new Map();this.base=null;this.gesto=null;this.t=0;this.mir={x:0,y:0};
  this.parpadeo={fase:0,prox:1.2,dur:.14,doble:false,amp:1};this.reducido=false;
  this._base(true);this.mezclador.update(0);
 }
 hay(n){return this.morphs.has(n);}
 setExpresion(e,intensidad=1){this.estado.expresion=EXPRESIONES_ESTUDIO[e]?e:'tranquila';this.estado.intensidad=Math.max(0,Math.min(1,intensidad));}
 setEstado(parcial){Object.assign(this.estado,parcial);}
 setBoca(nivel,visema='aa',peso=1){this.boca={nivel:Math.max(0,Math.min(1,+nivel||0)),visema,peso:Math.max(0,Math.min(1,peso))};this.estado.hablando=this.boca.nivel>.02;}
 mirar(x,y){this.estado.mirar={x,y,activa:true};}
 mirarFrente(){this.estado.mirar={x:0,y:0,activa:false};}
 claveBase(){const e=this.estado;if(e.expresion==='levantada')return 'levantada';if(e.silenciado||e.expresion==='dormida')return 'dormir';if(e.caminando)return 'caminar';if(e.hablando)return 'hablar';if(e.pensando||e.expresion==='piensa')return 'pensar';if(e.escuchando)return 'escuchar';return 'idle';}
 _clipBase(){let k=this.claveBase();while(k){if(this.acciones.has(k))return k;k=RESPALDO[k];}return null;}
 _base(inmediato=false){
  const n=this._clipBase();if(n===this.base)return;const nueva=n&&this.acciones.get(n),vieja=this.base&&this.acciones.get(this.base);this.base=n;
  if(nueva){nueva.reset().setLoop(T.LoopRepeat,Infinity).setEffectiveWeight(1).play();if(!inmediato&&!this.gesto)nueva.fadeIn(.35);if(this.gesto)nueva.setEffectiveWeight(0);}
  if(vieja&&vieja!==nueva)vieja.fadeOut(inmediato?0:.35);
 }
 /** Gesto de una vez (saludar, senalar, toque_cabeza…). */
 hacerGesto(nombre){
  const a=this.acciones.get(nombre);if(!a)return false;
  this.gesto?.fadeOut(.15);a.reset().setLoop(T.LoopOnce,1);a.clampWhenFinished=true;a.fadeIn(.2).play();this.gesto=a;
  const b=this.base&&this.acciones.get(this.base);b?.fadeOut(.2);return true;
 }
 _termino(a){if(a!==this.gesto)return;this.gesto=null;a.fadeOut(.3);const b=this.base&&this.acciones.get(this.base);if(b)b.reset().setEffectiveWeight(1).fadeIn(.3).play();}
 /** Pesos de la cara: igual que pesosObjetivo() de la app, con intensidad. */
 pesosObjetivo(){
  const e=this.estado,out={};const sumar=(p,k)=>{for(const n in p){if(!this.hay(n))continue;out[n]=Math.min(1,Math.max(0,(out[n]||0)+p[n]*k));}};
  const expr=e.silenciado?'dormida':e.expresion;const abre=e.silenciado?0:Math.min(1,this.boca.nivel*1.35);const habla=abre>.03&&this.boca.visema!=='sil';
  const cara=EXPRESIONES_ESTUDIO[expr]||{};const I=expr==='dormida'?1:e.intensidad;
  if(habla){const s={};for(const n in cara)s[n]=BOCA_DE_EXPRESION.includes(n)?cara[n]*.6:cara[n];sumar(s,I);}else sumar(cara,I);
  if(habla){const v=nombreVisema(this.boca.visema);const con=this.hay(nombreVisema('aa'));const forma=con?{[v]:1}:(RECETA_VISEMAS[this.boca.visema]||{});const aa=con?{[nombreVisema('aa')]:1}:RECETA_VISEMAS.aa;sumar(forma,abre*this.boca.peso);if(this.boca.peso<1)sumar(aa,abre*(1-this.boca.peso));}
  return out;
 }
 _parpadeo(dt){
  const p=this.parpadeo;p.prox-=dt;
  if(p.prox<=0&&p.fase<=0){p.fase=1;p.dur=.12+this.azar()*.06;p.amp=this.azar()<.12?.55+this.azar()*.25:1;p.doble=!p.doble&&this.azar()<.18;p.prox=p.doble?.18+this.azar()*.08:2.4+this.azar()*3.8;}
  if(p.fase>0)p.fase=Math.max(0,p.fase-dt/p.dur);
  return p.fase>0?Math.sin(Math.PI*(1-p.fase))*p.amp:0;
 }
 update(dt){
  this.t+=dt;for(const [h,q] of this.reposo)h.quaternion.copy(q);
  this._base();this.mezclador.update(dt);
  const e=this.estado,mx=e.mirar.activa?Math.max(-1,Math.min(1,e.mirar.x)):0,my=e.mirar.activa?Math.max(-1,Math.min(1,e.mirar.y)):0;
  this.mir.x=suave(this.mir.x,mx,5,dt);this.mir.y=suave(this.mir.y,my,5,dt);
  const girar=(h,x,y)=>{if(h)h.quaternion.multiply(new T.Quaternion().setFromEuler(new T.Euler(x,y,0,'YXZ')));};
  girar(this.huesos.cuello,this.mir.y*.12,this.mir.x*.2);girar(this.huesos.cabeza,this.mir.y*.18,this.mir.x*.32);
  girar(this.huesos.ojoIzq,this.mir.y*.2,this.mir.x*.35);girar(this.huesos.ojoDer,this.mir.y*.2,this.mir.x*.35);
  const cierre=this.reducido?0:this._parpadeo(dt);
  const meta=this.pesosObjetivo();
  if(!e.silenciado&&e.expresion!=='dormida')for(const n of ['eyeBlinkLeft','eyeBlinkRight'])if(this.hay(n))meta[n]=Math.max(meta[n]||0,cierre);
  for(const [n,lista] of this.morphs){
   const deBoca=n.startsWith('viseme_')||n==='jawOpen'||n.startsWith('mouth'),parpado=n.startsWith('eyeBlink');
   const antes=this.pesos.get(n)||0,obj=meta[n]||0,ahora=parpado?obj:suave(antes,obj,deBoca?18:8,dt);
   this.pesos.set(n,ahora);for(const {m,i} of lista)m.morphTargetInfluences[i]=ahora;
  }
 }
 /** Pone la cara y la pose de un instante sin suavizado (capturas y pruebas). */
 fijar(t,{clip=null,tiempo=0}={}){
  for(const a of this.acciones.values())a.stop();this.gesto=null;this.base=null;
  const n=clip||this._clipBase();const a=n&&this.acciones.get(n);if(a){a.reset().play();a.time=tiempo;a.setEffectiveWeight(1);}this.base=clip?null:n;
  this.mezclador.update(0);for(const [h,q] of this.reposo)h.quaternion.copy(q);this.mezclador.update(0);
  const meta=this.pesosObjetivo();for(const [n,lista] of this.morphs){const w=meta[n]||0;this.pesos.set(n,w);for(const {m,i} of lista)m.morphTargetInfluences[i]=w;}
  this.raiz.updateMatrixWorld(true);
 }
 /** ¿Qué zona hay bajo el rayo? (cabeza, mejilla, panza o cuerpo). */
 zonaEn(raycaster){
  for(const z of this.zonas)z.visible=true;const hits=raycaster.intersectObjects(this.zonas,true);for(const z of this.zonas)z.visible=false;
  if(hits.length){const n=hits[0].object.name;return n.startsWith('zona_mejilla')?'mejilla':n.startsWith('zona_cabeza')?'cabeza':n.startsWith('zona_panza')?'panza':'cuerpo';}
  return raycaster.intersectObjects(this.mallas,false).length?'cuerpo':null;
 }
 dispose(){this.mezclador.stopAllAction();this.mezclador.uncacheRoot(this.raiz);}
}
