import {mountAvatar} from './stage.js';
import {CHARACTERS} from './characters.js';
import {EMOTIONS,GESTURES,STATES,buildClips} from './avatar.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';
const $=s=>document.querySelector(s);
const labels={neutral:'Sereno',feliz:'Alegría',risa:'Risa',sorpresa:'Sorpresa',curioso:'Curiosidad',pensando:'Reflexión',preocupado:'Preocupación',triste:'Tristeza',molesto:'Molestia',cansado:'Cansancio',carino:'Cariño',orgullo:'Orgullo',travieso:'Picardía',canto:'Cantar',oracion:'Recogimiento',escepticismo:'Duda',alarma:'Alerta',firme:'Firmeza',seco:'Seriedad',saludar:'Saludar',lentes:'Ajustar lentes',asentir:'Asentir',negar:'Negar',explicar:'Explicar',celebrar:'Celebrar',corazon:'Acompañar',senalar:'Señalar',caminar:'Caminar',idle:'En espera',listening:'Escuchando',thinking:'Pensando',speaking:'Hablando',working:'Trabajando',reading:'Leyendo',success:'Tarea completada',needs_user:'Necesita tu ayuda',offline:'Sin conexión',sleeping:'Descansando'};
let stage,id='claudio';
function emotion(e){stage.avatar.setEmotion(e,Number($('#intensity').value)/100);document.querySelectorAll('[data-emotion]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.emotion===e));$('#status').textContent=labels[e];}
function select(next){stage?.dispose();id=next;const spec=CHARACTERS[id];document.documentElement.style.setProperty('--accent',spec.color);$('#name').textContent=spec.name;$('#subtitle').textContent=spec.subtitle;$('#version').textContent=spec.status;document.querySelectorAll('[data-avatar]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.avatar===id));
 try{stage=mountAvatar($('#stage'),{id,onTap:()=>$('#status').textContent='¡Hola!'});$('#error').style.display='none';}catch(e){$('#error').style.display='block';$('#error').textContent='No se pudo iniciar la vista 3D: '+e.message;throw e;}
 $('#state').value='idle';$('#pause').textContent='Pausar';$('#audio').value='';emotion('feliz');
 for(const b of document.querySelectorAll('[data-gesture]'))b.textContent=id==='aura'&&b.dataset.gesture==='lentes'?'Concentrarse':id==='aura'&&b.dataset.gesture==='caminar'?'Deslizarse':labels[b.dataset.gesture];
}
for(const e of EMOTIONS){const b=document.createElement('button');b.textContent=labels[e];b.dataset.emotion=e;b.onclick=()=>emotion(e);$('#emotions').append(b);}
for(const g of GESTURES){const b=document.createElement('button');b.textContent=labels[g];b.dataset.gesture=g;b.onclick=()=>{stage.avatar.playGesture(g);$('#status').textContent=b.textContent;};$('#gestures').append(b);}
for(const s of STATES){const o=document.createElement('option');o.value=s;o.textContent=labels[s];$('#state').append(o);}
$('#state').onchange=e=>{stage.avatar.setState(e.target.value);$('#status').textContent=labels[e.target.value];};
$('#intensity').oninput=e=>{$('#intensity-value').textContent=e.target.value+'%';stage.avatar.intensity=Number(e.target.value)/100;};
for(const b of document.querySelectorAll('[data-avatar]'))b.onclick=()=>select(b.dataset.avatar);
$('#close').onclick=()=>stage.closeup();$('#full').onclick=()=>stage.resetCamera();$('#pause').onclick=()=>{stage.setPaused(!stage.paused);$('#pause').textContent=stage.paused?'Continuar':'Pausar';};
$('#audio').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;try{stage.setPaused(false);$('#pause').textContent='Pausar';await stage.audio.play({blob:file});$('#status').textContent='Reproduciendo audio local';}catch(err){$('#status').textContent='No se pudo reproducir el audio: '+err.message;}};
$('#stop').onclick=()=>{stage.audio.stop();$('#status').textContent='Audio detenido';};
window.AVATARS={ready:false,get stage(){return stage},get avatar(){return stage.avatar},get id(){return id},select,THREE,GLTFLoader,buildClips:()=>buildClips(stage.avatar),async exportGLB(){const a=stage.avatar,clips=buildClips(a);a.reset();a.update(0,0,true);return new GLTFExporter().parseAsync(a.root,{binary:true,animations:clips,onlyVisible:false});}};
select('claudio');window.AVATARS.ready=true;
