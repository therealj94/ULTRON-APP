import {EXPRESIONES_ESTUDIO,CLIPS_GESTO,CLIPS_ESTUDIO} from './kit/nombres.js';

// Nombres que acepta el puente (protocol.js): los de la entrega anterior (siguen funcionando, el
// escenario los traduce) y los del vocabulario común de los GLB móviles.
export const EMOTIONS=['neutral','feliz','risa','sorpresa','curioso','pensando','preocupado','triste','molesto','cansado','carino','orgullo','travieso','canto','oracion','escepticismo','alarma','firme','seco',...Object.keys(EXPRESIONES_ESTUDIO)];
export const GESTURES=['saludar','lentes','asentir','negar','explicar','celebrar','corazon','senalar','caminar',...CLIPS_GESTO,...CLIPS_ESTUDIO].filter((g,i,a)=>a.indexOf(g)===i);
export const STATES=['idle','listening','thinking','speaking','working','reading','success','needs_user','offline','sleeping'];
