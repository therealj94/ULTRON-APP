import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {CHARACTERS} from './characters.js';
import {crearEscenario} from './escenario.js';
import {AntonioAudio} from './audio.js';

// Escenario del estudio y de los adaptadores (web y WebView) con los GLB MÓVILES de assets/movil/.
// Mantiene la API de la entrega anterior (mountAvatar → stage.avatar.setEmotion/setState/
// playGesture/lookAt/setSpeech) y la traduce al vocabulario común (caras de la app, visemas de
// Oculus y clips en español). El GLB se carga en segundo plano; lo pedido antes queda en cola.

const EMOCION={neutral:'tranquila',feliz:'contenta',risa:'risa',sorpresa:'sorprendida',curioso:'curiosa',pensando:'piensa',preocupado:'triste',triste:'triste',molesto:'enojada',cansado:'uy',carino:'timida',orgullo:'contenta',travieso:'curiosa',canto:'encantada',oracion:'dormida',escepticismo:'curiosa',alarma:'sorprendida',firme:'enojada',seco:'tranquila'};
const GESTO={lentes:'toque_mejilla',asentir:'gusto',negar:'enojo',explicar:'senalar',corazon:'gusto'};
const VISEMA={A:'aa',E:'E',I:'I',O:'O',U:'U',MBP:'PP',sil:'sil'};
const ESTADO={idle:{},listening:{escuchando:true},thinking:{pensando:true},speaking:{},working:{pensando:true},reading:{escuchando:true},success:{},needs_user:{escuchando:true},offline:{silenciado:true},sleeping:{silenciado:true}};

function deBase64(b64){const s=atob(b64),b=new Uint8Array(s.length);for(let i=0;i<s.length;i++)b[i]=s.charCodeAt(i);return b.buffer;}
async function glbDe(id,calidad){
 const emb=globalThis.__AVATAR_GLB?.[id];if(emb)return deBase64(emb);
 const url=(globalThis.__AVATAR_GLB_BASE||'assets/movil/')+id+(calidad==='low'?'-bajo':'')+'.glb';
 const r=await fetch(url);if(!r.ok)throw Error('No se pudo cargar '+url);return r.arrayBuffer();
}

/** Controlador con la API anterior; aplica al Controlador real cuando el GLB termina de cargar. */
function crearAvatar(){
 const cola={emocion:'tranquila',intensidad:1,estado:'idle',hablando:false,boca:[0,'sil'],mirar:null,gestos:[]};
 let ctrl=null;
 const aplicar=()=>{if(!ctrl)return;ctrl.setExpresion(cola.emocion,cola.intensidad);ctrl.setEstado({escuchando:false,pensando:false,silenciado:false,...ESTADO[cola.estado]});
  ctrl.setBoca(cola.boca[0],cola.boca[1]);if(cola.mirar)ctrl.mirar(...cola.mirar);else ctrl.mirarFrente();for(const g of cola.gestos.splice(0))ctrl.hacerGesto(g);};
 const a={
  get emotion(){return cola.emocionOriginal||cola.emocion;},get state(){return cola.estado;},get speech(){return cola.boca[0];},
  intensity:1,reducedMotion:false,
  setEmotion(e,i=1){cola.emocionOriginal=e;cola.emocion=EMOCION[e]||e;cola.intensidad=Math.max(0,Math.min(1,+i||0));a.intensity=cola.intensidad;aplicar();},
  setExpresion(e,i=1){a.setEmotion(e,i);},
  setState(s){cola.estado=ESTADO[s]?s:'idle';aplicar();},
  playGesture(g){const n=GESTO[g]||g;if(n==='caminar'){ctrl?.setEstado({caminando:true});setTimeout(()=>ctrl?.setEstado({caminando:false}),2200);return;}cola.gestos.push(n);aplicar();},
  lookAt(x,y){cola.mirar=Math.abs(x)+Math.abs(y)<1e-3?null:[x,y];aplicar();},
  setSpeech(n,v='A'){cola.boca=[Math.max(0,Math.min(1,+n||0)),VISEMA[v]||v];aplicar();},
  reset(){Object.assign(cola,{emocion:'tranquila',intensidad:1,estado:'idle',boca:[0,'sil'],mirar:null,gestos:[]});aplicar();},
  update(dt){ctrl?.update(dt);},
  _conectar(c){ctrl=c;aplicar();},get ctrl(){return ctrl;},
  dispose(){ctrl?.dispose();}
 };
 return a;
}

export function mountAvatar(host,{id='antonio',quality='high',transparent=false,fondo='#1c1d20',bloom=true,onTap=()=>{},onListo=()=>{},onFallo=()=>{}}={}){
 const spec=CHARACTERS[id];if(!spec)throw new TypeError('Avatar desconocido');
 const lienzo=document.createElement('canvas');lienzo.style.cssText='display:block;width:100%;height:100%;touch-action:none';host.appendChild(lienzo);
 const esc=crearEscenario(lienzo,{transparente:transparent,fondo,calidad:quality==='low'?'baja':'alta',bloom});
 const avatar=crearAvatar(),audio=new AntonioAudio(avatar);
 const controls=new OrbitControls(esc.camara,lienzo);controls.enableDamping=true;controls.dampingFactor=.08;controls.enablePan=false;controls.minDistance=.6;controls.maxDistance=8;controls.maxPolarAngle=Math.PI*.58;
 let listo=false,disposed=false,paused=false,frame=0,prev=performance.now(),tiempoManual=null,camaraBase=null;
 const encuadrar=e=>{esc.encuadrar(e);const obj=esc.modelo?.getObjectByName(e==='retrato'?'camara_retrato':'camara_cuerpo');const w=new T.Vector3();if(obj)obj.getWorldPosition(w);controls.target.set(0,obj?w.y:1,0);controls.update();};
 const resize=()=>{const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;esc.tamano(w,h);if(listo)encuadrar(camaraBase||'cuerpo');};
 const obs=new ResizeObserver(resize);obs.observe(host);resize();
 glbDe(id,quality).then(buf=>esc.cargar(buf)).then(({ctrl,tCarga})=>{if(disposed)return;listo=true;avatar._conectar(ctrl);ctrl.reducido=avatar.reducedMotion;resize();encuadrar('cuerpo');onListo({tCarga,...esc.stats()});}).catch(e=>{console.error(e);onFallo(String(e?.message||e));});
 // Toque: zona por rayo contra los colisionadores del modelo (cabeza, mejilla, panza, cuerpo).
 let abajo=null;const ray=new T.Raycaster();
 const pd=e=>{abajo={x:e.clientX,y:e.clientY};};
 const pu=e=>{if(abajo&&Math.hypot(e.clientX-abajo.x,e.clientY-abajo.y)<7&&listo){const r=lienzo.getBoundingClientRect();ray.setFromCamera(new T.Vector2((e.clientX-r.left)/r.width*2-1,-((e.clientY-r.top)/r.height*2-1)),esc.camara);const z=avatar.ctrl.zonaEn(ray);if(z)onTap(z);}abajo=null;};
 const pm=e=>{if(abajo)return;const r=lienzo.getBoundingClientRect();avatar.lookAt(((e.clientX-r.left)/r.width*2-1)*.8,((e.clientY-r.top)/r.height*2-1)*.8);};
 const pl=()=>avatar.lookAt(0,0);
 lienzo.addEventListener('pointerdown',pd);lienzo.addEventListener('pointerup',pu);lienzo.addEventListener('pointermove',pm);lienzo.addEventListener('pointerleave',pl);
 const bucle=t=>{if(disposed)return;frame=requestAnimationFrame(bucle);const dt=Math.min(.05,(t-prev)/1000);prev=t;if(tiempoManual!==null||document.hidden)return;if(!paused){audio.update(dt);avatar.update(dt);}controls.update();esc.dibujar();};
 frame=requestAnimationFrame(bucle);
 return {avatar,audio,renderer:esc.renderer,scene:esc.escena,camera:esc.camara,controls,escenario:esc,
  get listo(){return listo;},get paused(){return paused;},
  setPaused(v){paused=v;if(v)audio.audio?.pause();},
  resetCamera(){camaraBase='cuerpo';encuadrar('cuerpo');},closeup(){camaraBase='retrato';encuadrar('retrato');},
  renderAt(t){tiempoManual=t;esc.dibujar();},resume(){tiempoManual=null;},
  screenshot(){esc.dibujar();return lienzo.toDataURL('image/png');},
  stats(){const s=esc.stats();return {meshes:s.mallas,triangles:s.triangulos,drawCalls:s.llamadas};},
  dispose(){disposed=true;cancelAnimationFrame(frame);obs.disconnect();for(const [e,f] of [['pointerdown',pd],['pointerup',pu],['pointermove',pm],['pointerleave',pl]])lienzo.removeEventListener(e,f);controls.dispose();audio.dispose();avatar.dispose();esc.dispose();lienzo.remove();}
 };
}
