/**
 * EL MAPEO: del estado de AURA a lo que tiene el modelo 3D por dentro (blendshapes, animaciones,
 * huesos, zonas, cámaras), POR NOMBRE.
 *
 * Todo lo que depende de cómo se llamen las cosas dentro del .glb vive aquí y en ningún otro lado:
 * si el modelo que entregue Codex trae nombres distintos, se corrige con un `aura.mapeo.json` junto
 * al modelo (ver docs/avatar-3d-especificacion.md y scripts/avatar3d-modelo.ts), sin tocar la escena
 * ni el teléfono. Los nombres por omisión son los de la especificación: los 52 blendshapes de ARKit,
 * los 15 visemas de Oculus (`viseme_*`), los huesos humanoides de VRM 1.0 y las animaciones en
 * español.
 *
 * Puro y sin importaciones de React Native: lo usa la escena 3D (dentro de la WebView) y lo prueban
 * en Node.
 */
import type { BaseAvatar, Boca, EstadoAvatar, ExpresionAvatar, GestoAvatar, Visema, ZonaToque } from './tipos';

/** Los 52 blendshapes de ARKit (Apple), el estándar de caras que exporta cualquier herramienta. */
export const ARKIT_52 = [
  'eyeBlinkLeft', 'eyeLookDownLeft', 'eyeLookInLeft', 'eyeLookOutLeft', 'eyeLookUpLeft', 'eyeSquintLeft', 'eyeWideLeft',
  'eyeBlinkRight', 'eyeLookDownRight', 'eyeLookInRight', 'eyeLookOutRight', 'eyeLookUpRight', 'eyeSquintRight', 'eyeWideRight',
  'jawForward', 'jawLeft', 'jawRight', 'jawOpen',
  'mouthClose', 'mouthFunnel', 'mouthPucker', 'mouthLeft', 'mouthRight', 'mouthSmileLeft', 'mouthSmileRight',
  'mouthFrownLeft', 'mouthFrownRight', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthStretchLeft', 'mouthStretchRight',
  'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper', 'mouthPressLeft', 'mouthPressRight',
  'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthUpperUpLeft', 'mouthUpperUpRight',
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight', 'noseSneerLeft', 'noseSneerRight', 'tongueOut',
] as const;

/** El blendshape de cada visema en el modelo (estándar Oculus / Ready Player Me). */
export const nombreVisema = (v: Visema) => `viseme_${v}`;

/** Huesos que la escena mueve por su cuenta (mirar, respirar, la mandíbula si no hay blendshapes). */
export type HuesoClave = 'cadera' | 'pecho' | 'cuello' | 'cabeza' | 'ojoIzq' | 'ojoDer' | 'mandibula';

export type Pesos = Record<string, number>;

export type Mapeo = {
  /** Cada cara → pesos de blendshapes (0..1). Lo que el modelo no tenga se ignora. */
  expresiones: Record<ExpresionAvatar, Pesos>;
  /** Cada visema → pesos, si el modelo trae los `viseme_*`. */
  visemas: Record<Visema, Pesos>;
  /** Cada visema con solo ARKit (sin `viseme_*`): una aproximación con la mandíbula y los labios. */
  visemasArkit: Record<Visema, Pesos>;
  /** Los párpados (el parpadeo automático). */
  parpadeo: string[];
  /** Blendshapes de la boca que la expresión suelta un poco mientras habla (no pelean con los visemas). */
  bocaDeExpresion: string[];
  /** Nombres posibles de cada animación, en orden de preferencia. */
  animaciones: { base: Record<BaseAvatar, string[]>; gestos: Record<GestoAvatar, string[]> };
  huesos: Record<HuesoClave, string[]>;
  /** Prefijo del nombre de un nodo colisionador → zona (`zona_mejilla_izq` → mejilla). */
  zonas: Record<string, ZonaToque>;
  /** Nodos (cámaras o vacíos) que encuadran; si no están, la escena encuadra sola con los huesos. */
  camaras: { retrato: string; cuerpo: string };
};

export type MapeoParcial = {
  expresiones?: Partial<Record<ExpresionAvatar, Pesos>>;
  visemas?: Partial<Record<Visema, Pesos>>;
  visemasArkit?: Partial<Record<Visema, Pesos>>;
  parpadeo?: string[];
  bocaDeExpresion?: string[];
  animaciones?: { base?: Partial<Record<BaseAvatar, string[]>>; gestos?: Partial<Record<GestoAvatar, string[]>> };
  huesos?: Partial<Record<HuesoClave, string[]>>;
  zonas?: Record<string, ZonaToque>;
  camaras?: Partial<Mapeo['camaras']>;
};

/** `ambos('mouthSmile', 0.6)` → los dos lados. */
function ambos(raiz: string, peso: number): Pesos {
  return { [`${raiz}Left`]: peso, [`${raiz}Right`]: peso };
}

const VISEMAS_LISTA: Visema[] = ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'I', 'O', 'U'];

export const MAPEO_BASE: Mapeo = {
  expresiones: {
    tranquila: {},
    contenta: { ...ambos('mouthSmile', 0.6), ...ambos('cheekSquint', 0.3), ...ambos('eyeSquint', 0.18) },
    encantada: { ...ambos('mouthSmile', 0.9), jawOpen: 0.12, ...ambos('cheekSquint', 0.5), ...ambos('eyeSquint', 0.45), browInnerUp: 0.15 },
    enojada: { ...ambos('browDown', 0.9), ...ambos('mouthFrown', 0.5), ...ambos('noseSneer', 0.35), ...ambos('eyeSquint', 0.3), ...ambos('mouthPress', 0.3) },
    dormida: { ...ambos('eyeBlink', 1), jawOpen: 0.04, ...ambos('mouthSmile', 0.1) },
    escucha: { browInnerUp: 0.25, ...ambos('eyeWide', 0.12), ...ambos('mouthSmile', 0.15) },
    piensa: { browInnerUp: 0.2, browDownLeft: 0.25, ...ambos('eyeLookUp', 0.45), eyeLookOutLeft: 0.3, eyeLookInRight: 0.3, mouthPucker: 0.2, mouthLeft: 0.2 },
    sorprendida: { browInnerUp: 0.8, ...ambos('browOuterUp', 0.8), ...ambos('eyeWide', 0.7), jawOpen: 0.3, mouthFunnel: 0.2 },
    triste: { browInnerUp: 0.7, ...ambos('mouthFrown', 0.6), ...ambos('eyeLookDown', 0.2), ...ambos('mouthPress', 0.15) },
    uy: { ...ambos('eyeSquint', 0.8), ...ambos('eyeBlink', 0.5), ...ambos('mouthStretch', 0.4), ...ambos('browDown', 0.3), jawOpen: 0.1 },
    levantada: { ...ambos('eyeWide', 0.5), jawOpen: 0.22, ...ambos('browOuterUp', 0.4), ...ambos('mouthSmile', 0.3) },
    // «rubor» es opcional (un blendshape que tiñe las mejillas); sin él, la cara tímida igual se nota.
    timida: { ...ambos('mouthSmile', 0.45), ...ambos('eyeLookDown', 0.4), ...ambos('cheekSquint', 0.3), browInnerUp: 0.25, rubor: 1 },
  },
  visemas: Object.fromEntries(VISEMAS_LISTA.map((v) => [v, { [nombreVisema(v)]: 1 }])) as Record<Visema, Pesos>,
  visemasArkit: {
    sil: {},
    PP: { mouthClose: 0.6, ...ambos('mouthPress', 0.5) },
    FF: { mouthRollLower: 0.6, ...ambos('mouthUpperUp', 0.25), jawOpen: 0.1 },
    TH: { jawOpen: 0.2, tongueOut: 0.3 },
    DD: { jawOpen: 0.3, ...ambos('mouthStretch', 0.15) },
    kk: { jawOpen: 0.35, ...ambos('mouthStretch', 0.2) },
    CH: { jawOpen: 0.2, mouthFunnel: 0.5, mouthPucker: 0.2 },
    SS: { jawOpen: 0.12, ...ambos('mouthStretch', 0.35), ...ambos('mouthSmile', 0.15) },
    nn: { jawOpen: 0.2, mouthClose: 0.2 },
    RR: { jawOpen: 0.25, mouthFunnel: 0.25 },
    aa: { jawOpen: 0.6, ...ambos('mouthLowerDown', 0.2) },
    E: { jawOpen: 0.35, ...ambos('mouthStretch', 0.35), ...ambos('mouthSmile', 0.2) },
    I: { jawOpen: 0.2, ...ambos('mouthStretch', 0.5), ...ambos('mouthSmile', 0.3) },
    O: { jawOpen: 0.45, mouthFunnel: 0.6, mouthPucker: 0.2 },
    U: { jawOpen: 0.2, mouthPucker: 0.8, mouthFunnel: 0.3 },
  },
  parpadeo: ['eyeBlinkLeft', 'eyeBlinkRight'],
  bocaDeExpresion: ['mouthSmileLeft', 'mouthSmileRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthPucker', 'mouthFunnel', 'jawOpen', 'mouthStretchLeft', 'mouthStretchRight', 'mouthPressLeft', 'mouthPressRight'],
  animaciones: {
    base: {
      idle: ['idle', 'reposo', 'Idle'],
      caminar: ['caminar', 'walk', 'Walking'],
      escuchar: ['escuchar', 'listen'],
      hablar: ['hablar', 'talk', 'Talking'],
      pensar: ['pensar', 'think', 'Thinking'],
      dormir: ['dormir', 'sleep', 'Sleeping'],
      levantada: ['levantada', 'colgando', 'hang'],
    },
    gestos: {
      saludar: ['saludar', 'wave', 'Wave'],
      senalar: ['senalar', 'señalar', 'point', 'Pointing'],
      toque_cabeza: ['toque_cabeza', 'reaccion_cabeza'],
      toque_mejilla: ['toque_mejilla', 'timida', 'reaccion_mejilla'],
      toque_panza: ['toque_panza', 'cosquillas', 'reaccion_panza'],
      enojo: ['enojo', 'angry', 'No'],
      gusto: ['gusto', 'happy', 'ThumbsUp', 'Yes'],
      entrar: ['entrar', 'enter', 'aparecer'],
      salir: ['salir', 'exit', 'desaparecer'],
      despertar: ['despertar', 'wake', 'Standing'],
    },
  },
  huesos: {
    cadera: ['hips', 'Hips', 'mixamorig:Hips', 'J_Bip_C_Hips'],
    pecho: ['upperChest', 'chest', 'Chest', 'Spine2', 'mixamorig:Spine2', 'J_Bip_C_UpperChest'],
    cuello: ['neck', 'Neck', 'mixamorig:Neck', 'J_Bip_C_Neck'],
    cabeza: ['head', 'Head', 'mixamorig:Head', 'J_Bip_C_Head'],
    ojoIzq: ['leftEye', 'LeftEye', 'mixamorig:LeftEye', 'J_Adj_L_FaceEye', 'eye_L'],
    ojoDer: ['rightEye', 'RightEye', 'mixamorig:RightEye', 'J_Adj_R_FaceEye', 'eye_R'],
    mandibula: ['jaw', 'Jaw', 'mixamorig:Jaw', 'J_Bip_C_Jaw'],
  },
  zonas: { zona_cabeza: 'cabeza', zona_mejilla: 'mejilla', zona_panza: 'panza', zona_mano: 'mano', zona_cuerpo: 'cuerpo' },
  camaras: { retrato: 'camara_retrato', cuerpo: 'camara_cuerpo' },
};

/** El mapeo por omisión con los cambios de un modelo encima (cada entrada reemplaza a la suya). */
export function combinarMapeo(base: Mapeo, p: MapeoParcial | null | undefined): Mapeo {
  if (!p || typeof p !== 'object') return base;
  return {
    expresiones: { ...base.expresiones, ...(p.expresiones || {}) } as Mapeo['expresiones'],
    visemas: { ...base.visemas, ...(p.visemas || {}) } as Mapeo['visemas'],
    visemasArkit: { ...base.visemasArkit, ...(p.visemasArkit || {}) } as Mapeo['visemasArkit'],
    parpadeo: Array.isArray(p.parpadeo) ? p.parpadeo : base.parpadeo,
    bocaDeExpresion: Array.isArray(p.bocaDeExpresion) ? p.bocaDeExpresion : base.bocaDeExpresion,
    animaciones: {
      base: { ...base.animaciones.base, ...(p.animaciones?.base || {}) } as Mapeo['animaciones']['base'],
      gestos: { ...base.animaciones.gestos, ...(p.animaciones?.gestos || {}) } as Mapeo['animaciones']['gestos'],
    },
    huesos: { ...base.huesos, ...(p.huesos || {}) } as Mapeo['huesos'],
    zonas: { ...base.zonas, ...(p.zonas || {}) },
    camaras: { ...base.camaras, ...(p.camaras || {}) },
  };
}

/* ── estado → blendshapes ────────────────────────────────────────────────────────────────── */

const limitar01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Los pesos que el modelo tiene que alcanzar ahora (la escena los suaviza cuadro a cuadro). `hay`
 * dice si el modelo tiene ese blendshape: lo que no tiene no sale.
 *
 *  · la expresión pone la cara;
 *  · la boca (visema × cuánto abre) va encima; mientras habla, la boca de la expresión baja al 60 %
 *    para que la sonrisa no pelee con la «o»;
 *  · con los `viseme_*` del modelo se usan esos; sin ellos, la aproximación con ARKit.
 * El parpadeo automático no va aquí (es de la escena), salvo dormida, que cierra los ojos.
 */
export function pesosObjetivo(e: EstadoAvatar, boca: Boca, m: Mapeo, hay: (nombre: string) => boolean): Pesos {
  const out: Pesos = {};
  const sumar = (p: Pesos, k: number) => {
    for (const nombre in p) {
      if (!hay(nombre)) continue;
      out[nombre] = limitar01((out[nombre] || 0) + p[nombre] * k);
    }
  };
  const expresion = e.silenciado ? 'dormida' : e.expresion;
  const abre = e.silenciado ? 0 : limitar01(boca.nivel * 1.35);
  const habla = abre > 0.03 && boca.visema !== 'sil';
  const cara = m.expresiones[expresion] || {};
  if (habla) {
    const deBoca = new Set(m.bocaDeExpresion);
    const suelta: Pesos = {};
    for (const nombre in cara) suelta[nombre] = deBoca.has(nombre) ? cara[nombre] * 0.6 : cara[nombre];
    sumar(suelta, 1);
  } else sumar(cara, 1);
  if (!habla) return out;
  const conVisemas = hay(nombreVisema('aa'));
  const tabla = conVisemas ? m.visemas : m.visemasArkit;
  const forma = tabla[boca.visema] || {};
  const peso = limitar01(boca.peso);
  // La forma elegida con su confianza; lo que falta de confianza es una «a» que solo abre.
  sumar(forma, abre * peso);
  if (peso < 1) sumar(tabla.aa || {}, abre * (1 - peso));
  return out;
}

/* ── estado → animaciones ────────────────────────────────────────────────────────────────── */

/** La animación de fondo que toca con este estado. */
export function claveBase(e: EstadoAvatar): BaseAvatar {
  if (e.expresion === 'levantada') return 'levantada';
  if (e.silenciado || e.expresion === 'dormida') return 'dormir';
  if (e.caminando) return 'caminar';
  if (e.hablando) return 'hablar';
  if (e.pensando || e.expresion === 'piensa') return 'pensar';
  if (e.escuchando) return 'escuchar';
  return 'idle';
}

/** Si el modelo no tiene la animación de fondo que toca, esta otra (y al final, reposo). */
const RESPALDO_BASE: Record<BaseAvatar, BaseAvatar | null> = {
  idle: null,
  caminar: 'idle',
  escuchar: 'idle',
  hablar: 'escuchar',
  pensar: 'idle',
  dormir: 'idle',
  levantada: 'idle',
};

const plano = (s: string) => String(s || '').toLowerCase().replace(/^mixamorig:?/, '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

/** El primer nombre de la lista que está en el modelo: exacto, sin mayúsculas ni signos, o contenido. */
export function buscarNombre(candidatos: readonly string[], disponibles: readonly string[]): string | null {
  for (const c of candidatos) if (disponibles.includes(c)) return c;
  const planos = disponibles.map(plano);
  for (const c of candidatos) {
    const i = planos.indexOf(plano(c));
    if (i >= 0) return disponibles[i];
  }
  for (const c of candidatos) {
    const pc = plano(c);
    if (pc.length < 4) continue;
    const i = planos.findIndex((d) => d.includes(pc));
    if (i >= 0) return disponibles[i];
  }
  return null;
}

/** La animación de fondo que el modelo sí tiene para este estado (con sus respaldos), o null. */
export function clipBase(e: EstadoAvatar, m: Mapeo, clips: readonly string[]): string | null {
  let k: BaseAvatar | null = claveBase(e);
  while (k) {
    const n = buscarNombre(m.animaciones.base[k], clips);
    if (n) return n;
    k = RESPALDO_BASE[k];
  }
  return null;
}

/** La animación de un gesto, o null si el modelo no la trae (entonces no se hace nada). */
export function clipGesto(g: GestoAvatar, m: Mapeo, clips: readonly string[]): string | null {
  return buscarNombre(m.animaciones.gestos[g] || [], clips);
}

/* ── toques ──────────────────────────────────────────────────────────────────────────────── */

/** La zona de un nodo colisionador por su nombre (`zona_mejilla_izq` → mejilla), o null. */
export function zonaDeNodo(nombre: string, m: Mapeo): ZonaToque | null {
  const n = String(nombre || '').toLowerCase();
  let mejor: { largo: number; zona: ZonaToque } | null = null;
  for (const prefijo in m.zonas) {
    const p = prefijo.toLowerCase();
    if (n.startsWith(p) && (!mejor || p.length > mejor.largo)) mejor = { largo: p.length, zona: m.zonas[prefijo] };
  }
  return mejor?.zona ?? null;
}

/**
 * Sin colisionadores en el modelo: la zona por dónde cayó el toque respecto de la cabeza. `dx`, `dy`
 * en radios de cabeza desde su centro (y positivo = abajo); `alto` es la altura del punto en el
 * cuerpo (0 pies … 1 coronilla).
 */
export function zonaPorPosicion(o: { dx: number; dy: number; alto: number }): ZonaToque {
  const r = Math.hypot(o.dx, o.dy);
  if (r <= 1.25) return Math.abs(o.dx) > 0.45 && o.dy > -0.1 ? 'mejilla' : 'cabeza';
  if (o.alto >= 0.42 && o.alto <= 0.64) return 'panza';
  return 'cuerpo';
}

/**
 * La misma idea para la figurita 2D (un círculo de radio `R` centrado en `cx, cy`): arriba la cabeza,
 * a los lados la mejilla, abajo la panza.
 */
export function zona2D(x: number, y: number, cx: number, cy: number, R: number): ZonaToque {
  const dx = (x - cx) / R;
  const dy = (y - cy) / R;
  if (dy < -0.35) return 'cabeza';
  if (dy > 0.45) return 'panza';
  if (Math.abs(dx) > 0.45) return 'mejilla';
  return 'cabeza';
}
