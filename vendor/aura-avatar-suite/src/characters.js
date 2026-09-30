import {createAntonio} from './avatar.js';
import {createClaudio} from './claudio.js';
import {createAura} from './aura.js';
export const CHARACTERS={
 antonio:{name:'ANT-ONIO',subtitle:'Tu aliado inteligente',color:'#45c9de',status:'Diseño aprobado · revisión 2',factory:createAntonio,camera:[3.8,2.9,8.7],target:[0,2.40,0],closeCamera:[1.35,3.8,5.6],closeTarget:[0,3.46,0]},
 claudio:{name:'Claudio',subtitle:'Ideas con personalidad',color:'#f4ad72',status:'Nueva propuesta 3D',factory:createClaudio,camera:[3.8,2.9,8.7],target:[-.15,2.4,0],closeCamera:[1.15,3.8,5.6],closeTarget:[0,3.55,0]},
 aura:{name:'AU-RA',subtitle:'Presencia que acompaña',color:'#d6b56c',status:'Grafito · Orbe refinado',factory:createAura,camera:[2.8,2.85,7.2],target:[0,2.3,0],closeCamera:[.75,2.85,4.3],closeTarget:[0,2.5,0]}
};
export function createAvatar(id='antonio',options={}){if(!CHARACTERS[id])throw new TypeError('Avatar desconocido');return CHARACTERS[id].factory(options);}
