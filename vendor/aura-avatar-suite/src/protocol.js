import {EMOTIONS,GESTURES,STATES} from './avatar.js';
export const FACE_STATES={IDLE:'idle',LISTENING:'listening',THINKING:'thinking',SPEAKING:'speaking',SLEEPING:'sleeping',SCAN:'reading',SING:'speaking',PRAY:'idle',HAPPY:'success'};
export const TASK_GESTURES={buscar:'lentes',leer:'lentes',anotar:'asentir',enviar:'senalar',oro:'explicar',mirar:'lentes'};
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const bound=(n,min,max)=>Math.min(max,Math.max(min,n));
/** Compatible subset of AURA's existing bridge. Unknown actions are not success. */
export function applyAvatarMessage(avatar,m){
 if(!m||typeof m!=='object'||Array.isArray(m))return false;
 switch(m.tipo){
  case 'estado':avatar.setState(FACE_STATES[m.face]||(STATES.includes(m.face)?m.face:'idle'));avatar.setEmotion(EMOTIONS.includes(m.emocion)?m.emocion:'neutral',finite(m.intensidad)?bound(m.intensidad,0,1):1);return true;
  case 'boca':if(!finite(m.n))return false;avatar.setSpeech(bound(m.n,0,1),['A','E','I','O','U','MBP','sil'].includes(m.visema)?m.visema:'A');return true;
  case 'mirar':if(m.activa!==true){avatar.lookAt(0,0);return true;}if(!finite(m.x)||!finite(m.y))return false;avatar.lookAt(bound(m.x,-1,1),bound(m.y,-1,1));return true;
  case 'tarea':if(!Object.hasOwn(TASK_GESTURES,m.tarea))return false;avatar.playGesture(TASK_GESTURES[m.tarea]);return true;
  case 'gesto':if(!GESTURES.includes(m.nombre))return false;avatar.playGesture(m.nombre);return true;
  case 'entrar':avatar.playGesture('saludar');return true;
  case 'postura':return m.p==='pie'; // Seating belongs to the room, not this standalone stage.
  default:return false;
 }
}
