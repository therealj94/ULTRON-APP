// El VOCABULARIO común de los tres avatares móviles. Es copia de lo que la app ya espera
// (mobile/src/avatar3d/mapeo.ts y tipos.ts, docs/avatar-3d-especificacion.md); la prueba
// tools/contracts.test.mjs compara estas listas con las de la app para que no se desincronicen.

export const ARKIT_52=[
 'eyeBlinkLeft','eyeLookDownLeft','eyeLookInLeft','eyeLookOutLeft','eyeLookUpLeft','eyeSquintLeft','eyeWideLeft',
 'eyeBlinkRight','eyeLookDownRight','eyeLookInRight','eyeLookOutRight','eyeLookUpRight','eyeSquintRight','eyeWideRight',
 'jawForward','jawLeft','jawRight','jawOpen',
 'mouthClose','mouthFunnel','mouthPucker','mouthLeft','mouthRight','mouthSmileLeft','mouthSmileRight',
 'mouthFrownLeft','mouthFrownRight','mouthDimpleLeft','mouthDimpleRight','mouthStretchLeft','mouthStretchRight',
 'mouthRollLower','mouthRollUpper','mouthShrugLower','mouthShrugUpper','mouthPressLeft','mouthPressRight',
 'mouthLowerDownLeft','mouthLowerDownRight','mouthUpperUpLeft','mouthUpperUpRight',
 'browDownLeft','browDownRight','browInnerUp','browOuterUpLeft','browOuterUpRight',
 'cheekPuff','cheekSquintLeft','cheekSquintRight','noseSneerLeft','noseSneerRight','tongueOut'
];
export const VISEMAS=['sil','PP','FF','TH','DD','kk','CH','SS','nn','RR','aa','E','I','O','U'];
export const nombreVisema=v=>'viseme_'+v;
/** Todos los morph targets de la malla de cara, en este orden, en los tres modelos. */
export const MORPHS=[...ARKIT_52,...VISEMAS.map(nombreVisema),'rubor'];

/**
 * Cada visema como mezcla de formas ARKit del mismo personaje (el campo de desplazamiento es
 * lineal, así que el visema es exactamente esa suma). Un personaje puede agregar retoques propios.
 * Correspondencia pedida por José: A=aa · E=E · I=I · O=O · U=U · M/B/P=PP · F/V=FF.
 */
export const RECETA_VISEMAS={
 sil:{},
 PP:{mouthClose:.55,mouthPressLeft:.6,mouthPressRight:.6,mouthRollUpper:.25,mouthRollLower:.25},
 FF:{mouthRollLower:.8,mouthUpperUpLeft:.3,mouthUpperUpRight:.3,jawOpen:.08},
 TH:{jawOpen:.22,tongueOut:.45,mouthStretchLeft:.1,mouthStretchRight:.1},
 DD:{jawOpen:.3,mouthStretchLeft:.18,mouthStretchRight:.18,mouthShrugUpper:.15},
 kk:{jawOpen:.36,mouthStretchLeft:.22,mouthStretchRight:.22},
 CH:{jawOpen:.2,mouthFunnel:.55,mouthPucker:.2,mouthShrugUpper:.2},
 SS:{jawOpen:.1,mouthStretchLeft:.4,mouthStretchRight:.4,mouthSmileLeft:.12,mouthSmileRight:.12},
 nn:{jawOpen:.2,mouthClose:.12,mouthStretchLeft:.1,mouthStretchRight:.1},
 RR:{jawOpen:.26,mouthFunnel:.3,mouthPucker:.1},
 aa:{jawOpen:.72,mouthLowerDownLeft:.25,mouthLowerDownRight:.25,mouthUpperUpLeft:.1,mouthUpperUpRight:.1},
 E:{jawOpen:.36,mouthStretchLeft:.45,mouthStretchRight:.45,mouthSmileLeft:.18,mouthSmileRight:.18},
 I:{jawOpen:.18,mouthStretchLeft:.6,mouthStretchRight:.6,mouthSmileLeft:.28,mouthSmileRight:.28},
 O:{jawOpen:.46,mouthFunnel:.75,mouthPucker:.2},
 U:{jawOpen:.18,mouthPucker:.9,mouthFunnel:.35}
};

/** Las caras de la app (tipos.ts, EXPRESIONES_AVATAR) con sus pesos (mapeo.ts, MAPEO_BASE). */
const ambos=(r,p)=>({[r+'Left']:p,[r+'Right']:p});
export const EXPRESIONES={
 tranquila:{},
 contenta:{...ambos('mouthSmile',.6),...ambos('cheekSquint',.3),...ambos('eyeSquint',.18)},
 encantada:{...ambos('mouthSmile',.9),jawOpen:.12,...ambos('cheekSquint',.5),...ambos('eyeSquint',.45),browInnerUp:.15},
 enojada:{...ambos('browDown',.9),...ambos('mouthFrown',.5),...ambos('noseSneer',.35),...ambos('eyeSquint',.3),...ambos('mouthPress',.3)},
 dormida:{...ambos('eyeBlink',1),jawOpen:.04,...ambos('mouthSmile',.1)},
 escucha:{browInnerUp:.25,...ambos('eyeWide',.12),...ambos('mouthSmile',.15)},
 piensa:{browInnerUp:.2,browDownLeft:.25,...ambos('eyeLookUp',.45),eyeLookOutLeft:.3,eyeLookInRight:.3,mouthPucker:.2,mouthLeft:.2},
 sorprendida:{browInnerUp:.8,...ambos('browOuterUp',.8),...ambos('eyeWide',.7),jawOpen:.3,mouthFunnel:.2},
 triste:{browInnerUp:.7,...ambos('mouthFrown',.6),...ambos('eyeLookDown',.2),...ambos('mouthPress',.15)},
 uy:{...ambos('eyeSquint',.8),...ambos('eyeBlink',.5),...ambos('mouthStretch',.4),...ambos('browDown',.3),jawOpen:.1},
 levantada:{...ambos('eyeWide',.5),jawOpen:.22,...ambos('browOuterUp',.4),...ambos('mouthSmile',.3)},
 timida:{...ambos('mouthSmile',.45),...ambos('eyeLookDown',.4),...ambos('cheekSquint',.3),browInnerUp:.25,rubor:1}
};

/**
 * Caras extra del estudio (demo y capturas), con el mismo vocabulario. «curiosa» no existe en la
 * app; se deja aquí para las capturas y como sugerencia de mapeo.
 */
export const EXPRESIONES_ESTUDIO={
 ...EXPRESIONES,
 risa:{...ambos('mouthSmile',1),jawOpen:.45,...ambos('cheekSquint',.7),...ambos('eyeSquint',.85),browInnerUp:.2,...ambos('mouthUpperUp',.25)},
 curiosa:{browOuterUpLeft:.55,browDownRight:.2,...ambos('eyeWide',.25),eyeLookOutLeft:.15,eyeLookInRight:.15,mouthLeft:.25,...ambos('mouthSmile',.2)}
};

/** Animaciones de fondo y gestos de la app (tipos.ts) + los del estudio. */
export const CLIPS_BASE=['idle','caminar','escuchar','hablar','pensar','dormir','levantada'];
export const CLIPS_GESTO=['saludar','senalar','toque_cabeza','toque_mejilla','toque_panza','enojo','gusto','entrar','salir','despertar'];
export const CLIPS_ESTUDIO=['celebrar'];
export const CLIPS=[...CLIPS_BASE,...CLIPS_GESTO,...CLIPS_ESTUDIO];
export const ZONAS=['zona_cabeza','zona_mejilla_izq','zona_mejilla_der','zona_panza'];
export const CAMARAS=['camara_retrato','camara_cuerpo'];
