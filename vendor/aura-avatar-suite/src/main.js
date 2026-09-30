import * as THREE from 'three';
import {mountAvatar} from './stage.js';
import {CHARACTERS} from './characters.js';
import {EXPRESIONES_ESTUDIO,CLIPS_GESTO,CLIPS_ESTUDIO,CLIPS_BASE} from './kit/nombres.js';

// Estudio de avatares: los GLB móviles con el escenario premium. Reproduce lo que hace la app
// (caras, visemas, gestos, reacción al toque) y agrega parpadeo con variación.
const $=s=>document.querySelector(s);
const NOMBRE={tranquila:'Tranquila',contenta:'Contenta',encantada:'Encantada',risa:'Risa',enojada:'Enojada',dormida:'Dormida',escucha:'Escucha',piensa:'Piensa',sorprendida:'Sorprendida',triste:'Triste',uy:'¡Uy!',levantada:'Levantada',timida:'Tímida',curiosa:'Curiosa',
 saludar:'Saludar',senalar:'Señalar',toque_cabeza:'Toque cabeza',toque_mejilla:'Toque mejilla',toque_panza:'Toque panza',enojo:'Enojo',gusto:'Gusto',entrar:'Entrar',salir:'Salir',despertar:'Despertar',celebrar:'Celebrar',
 idle:'Reposo',caminar:'Caminar',escuchar:'Escuchar',hablar:'Hablar',pensar:'Pensar',dormir:'Dormir'};
const REACCION={cabeza:['contenta','toque_cabeza'],mejilla:['timida','toque_mejilla'],panza:['encantada','toque_panza'],cuerpo:['contenta','gusto']};
let stage=null,id='aura',tema='oscuro',calidad='high',toques=[],hablaT=null;
const estado=t=>{$('#estado').textContent=t;};
function cara(e){stage.avatar.setEmotion(e,1);document.querySelectorAll('[data-cara]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.cara===e));estado(NOMBRE[e]||e);}
function base(b){const s={idle:'idle',escuchar:'listening',pensar:'thinking',dormir:'sleeping',hablar:'speaking',caminar:'idle',levantada:'idle'}[b];stage.avatar.setState(s);
 if(b==='caminar')stage.avatar.playGesture('caminar');if(b==='levantada')cara('levantada');if(b==='hablar')probarVoz();document.querySelectorAll('[data-base]').forEach(x=>x.setAttribute('aria-pressed',x.dataset.base===b));estado(NOMBRE[b]);}
function elegir(nuevo){
 stage?.dispose();id=nuevo;const s=CHARACTERS[id];document.documentElement.style.setProperty('--accent',s.color);
 $('#nombre').textContent=s.name;$('#subtitulo').textContent=s.subtitle;$('#version').textContent=s.status;
 document.querySelectorAll('[data-avatar]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.avatar===id));
 const fondo=tema==='claro'?'#f7f3ec':'#1c1d20';
 stage=mountAvatar($('#stage'),{id,quality:calidad,transparent:true,fondo,
  onTap:zona=>{const ahora=performance.now();toques=toques.filter(t=>ahora-t<2500);toques.push(ahora);
   const [c,g]=toques.length>=4?['enojada','enojo']:REACCION[zona];cara(c);stage.avatar.playGesture(g);setTimeout(()=>cara('tranquila'),2600);},
  onListo:i=>{$('#datos').textContent=`${i.triangulos.toLocaleString('es')} triángulos · carga ${Math.round(i.tCarga)} ms`;window.AVATARS.listo=true;},
  onFallo:m=>estado('No se pudo cargar: '+m)});
 cara('contenta');
}
function probarVoz(){
 clearInterval(hablaT);const seq=['sil','PP','aa','E','I','O','U','FF','aa','sil'];let i=0,t=0;stage.avatar.setState('speaking');
 hablaT=setInterval(()=>{t+=.05;const v=seq[Math.floor(t/.32)%seq.length];const n=v==='sil'?0:.55+.35*Math.abs(Math.sin(t*9));stage.avatar.setSpeech(n,{aa:'A',PP:'MBP'}[v]||v);if(t>6.4){clearInterval(hablaT);stage.avatar.setSpeech(0);stage.avatar.setState('idle');}},50);
}
for(const e of Object.keys(EXPRESIONES_ESTUDIO)){const b=document.createElement('button');b.textContent=NOMBRE[e]||e;b.dataset.cara=e;b.onclick=()=>cara(e);$('#caras').append(b);}
for(const g of [...CLIPS_GESTO,...CLIPS_ESTUDIO]){const b=document.createElement('button');b.textContent=NOMBRE[g]||g;b.onclick=()=>{stage.avatar.playGesture(g);estado(NOMBRE[g]);};$('#gestos').append(b);}
for(const g of CLIPS_BASE){const b=document.createElement('button');b.textContent=NOMBRE[g]||g;b.dataset.base=g;b.onclick=()=>base(g);$('#bases').append(b);}
for(const b of document.querySelectorAll('[data-avatar]'))b.onclick=()=>elegir(b.dataset.avatar);
$('#retrato').onclick=()=>stage.closeup();$('#cuerpo').onclick=()=>stage.resetCamera();
$('#pausa').onclick=()=>{stage.setPaused(!stage.paused);$('#pausa').textContent=stage.paused?'Seguir':'Pausar';};
$('#hablar').onclick=probarVoz;$('#callar').onclick=()=>{clearInterval(hablaT);stage.audio.stop();stage.avatar.setSpeech(0);};
$('#tema').onclick=()=>{tema=tema==='claro'?'oscuro':'claro';document.documentElement.dataset.tema=tema;$('#tema').textContent=tema==='claro'?'Tema oscuro':'Tema claro';elegir(id);};
$('#calidad').onclick=()=>{calidad=calidad==='high'?'low':'high';$('#calidad').textContent=calidad==='high'?'Calidad baja':'Calidad alta';elegir(id);};
$('#audio').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{await stage.audio.play({blob:f});estado('Reproduciendo audio local');}catch(err){estado('No se pudo reproducir: '+err.message);}};
window.AVATARS={listo:false,get stage(){return stage;},get id(){return id;},elegir,THREE};
elegir('aura');
