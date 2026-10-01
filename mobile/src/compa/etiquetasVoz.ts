/**
 * EL CATÁLOGO DE ETIQUETAS DE AUDIO DE LA VOZ v4: qué sonido o qué tono le pone cada avatar a lo que
 * está haciendo (pensar, buscar, leer, calcular, abrir, terminar, equivocarse, reírse…).
 *
 * José (1-oct): «todas las voces con audio tags… agregar realismo en cosas que pueden hacer nuestros
 * asistentes… más random tags, muchos diferentes, no escuchemos siempre lo mismo».
 *
 * LAS VERIFICADAS (1-oct-2026, con la API de ElevenLabs: texto a voz con eleven_v4_turbo y la voz de
 * Claudio en español y en inglés, y luego speech-to-text `scribe_v1` con `tag_audio_events`): NINGUNA
 * de estas se lee en voz alta. Las de sonido suenan como tal (la transcripción las marca como evento):
 *  · risa: laughs, laughs softly, chuckles, giggles, nervous laugh, scoffs
 *  · respiración: sighs, exhales, inhales, relieved sigh, wistful sigh, tired (suspira), yawns
 *  · garganta y boca: clears throat (carraspeo), hums («mmm»), gasps («¡ah!»)
 * Las de tono no suenan como palabra y cambian cómo se dice: thoughtful, curious, hesitates, whispers,
 * softly, warmly, cheerfully, excited, playfully, mischievously, sarcastic, deadpan, impressed, amazed,
 * delighted, relieved, nervously, sheepish, reassuring, gently, tender, focused, matter-of-fact, calm,
 * confident, enthusiastic, surprised, concerned, sad, proud, annoyed, short pause, stammers.
 * En las 8 voces (los cuatro avatares en español e inglés) se repitió con 15 de las más usadas (warmly,
 * thoughtful, curious, laughs softly, chuckles, sighs, hums, exhales, playfully, mischievously,
 * enthusiastic, calm, matter-of-fact, concerned, cheerfully): 105 de 105 sin leerse (1-oct).
 * Cualquier etiqueta nueva se comprueba igual antes de entrar aquí (tests/etiquetas-voz.test.ts vigila
 * que el catálogo, el tono de cada emoción y las marcas del cerebro solo usen las de esta lista).
 *
 * Puro y sin React Native: lo usan el servidor (las frases de espera de la llamada), la mesa del
 * teléfono, la web y las pruebas en Node.
 */
import type { AvatarFrase, EstadoFrase } from './frasesEstado';

export const ETIQUETAS_VERIFICADAS = [
  'laughs', 'laughs softly', 'chuckles', 'giggles', 'nervous laugh', 'scoffs',
  'sighs', 'exhales', 'inhales', 'relieved sigh', 'wistful sigh', 'tired', 'yawns',
  'clears throat', 'hums', 'gasps',
  'thoughtful', 'curious', 'hesitates', 'whispers', 'softly', 'warmly', 'cheerfully', 'excited', 'playfully',
  'mischievously', 'sarcastic', 'deadpan', 'impressed', 'amazed', 'delighted', 'relieved', 'nervously',
  'sheepish', 'reassuring', 'gently', 'tender', 'focused', 'matter-of-fact', 'calm', 'confident',
  'enthusiastic', 'surprised', 'concerned', 'sad', 'proud', 'annoyed', 'short pause', 'stammers',
  // Las del tono de cada emoción en el servidor (server/eleven.ts, TONO_V4) y alguna marca del cerebro,
  // verificadas igual el 1-oct (auditoría externa: faltaban). «amused» suena con una risita.
  'amused', 'pleasantly surprised', 'playful', 'skeptical', 'hesitant', 'reverent', 'serious, urgent',
  'firm, measured', 'softly, reverent', 'annoyed, restrained', 'softly, sad', 'warmly, tender',
] as const;
export type EtiquetaVoz = (typeof ETIQUETAS_VERIFICADAS)[number];

type PorEstado = Partial<Record<EstadoFrase, readonly EtiquetaVoz[]>>;

/** Lo que le queda bien a cualquiera en cada momento. */
const COMUN: PorEstado = {
  escuchando: ['warmly', 'gently', 'curious', 'calm'],
  conectando: ['calm', 'gently', 'exhales', 'reassuring'],
  pensando: ['thoughtful', 'hums', 'hesitates', 'curious', 'focused', 'inhales', 'calm'],
  revisando: ['focused', 'thoughtful', 'matter-of-fact', 'hums', 'calm', 'clears throat'],
  buscando: ['curious', 'focused', 'hums', 'thoughtful', 'inhales'],
  calculando: ['focused', 'thoughtful', 'hums', 'matter-of-fact', 'confident'],
  abriendo: ['cheerfully', 'confident', 'warmly', 'calm'],
  leyendo: ['focused', 'thoughtful', 'softly', 'hums', 'curious', 'clears throat'],
  mirando: ['curious', 'impressed', 'focused', 'gently', 'hums'],
  seguimiento: ['exhales', 'laughs softly', 'chuckles', 'sheepish', 'reassuring', 'sighs', 'hums', 'nervously', 'short pause'],
  esperando_confirmacion: ['curious', 'gently', 'reassuring', 'warmly'],
  listo: ['cheerfully', 'delighted', 'proud', 'confident', 'warmly', 'relieved', 'relieved sigh'],
  no_pude: ['sighs', 'sheepish', 'concerned', 'exhales', 'nervous laugh', 'sad'],
  disculpa: ['sheepish', 'nervous laugh', 'gently', 'softly', 'stammers'],
  sorpresa: ['gasps', 'surprised', 'amazed', 'impressed'],
  alegria: ['delighted', 'excited', 'laughs', 'cheerfully', 'warmly'],
  empatia: ['gently', 'tender', 'softly', 'reassuring', 'concerned', 'sad'],
  humor: ['laughs', 'chuckles', 'giggles', 'playfully', 'mischievously', 'laughs softly'],
};

/** Lo propio de cada uno (se suma a lo común). La forma de ser es la de frasesEstado.ts. */
const PROPIAS: Record<AvatarFrase, PorEstado> = {
  // El Guardián: sereno, preciso, breve. Exhala, carraspea, habla firme; no se ríe (su humor es seco).
  ojos: {
    pensando: ['matter-of-fact'],
    buscando: ['matter-of-fact', 'calm'],
    seguimiento: ['calm', 'matter-of-fact'],
    listo: ['matter-of-fact', 'calm'],
    humor: ['deadpan', 'matter-of-fact'],
    empatia: ['calm'],
  },
  // AU-RA: cálida y cercana. Tararea, habla bajito, se ríe tierno.
  aura: {
    pensando: ['softly', 'warmly'],
    buscando: ['cheerfully'],
    seguimiento: ['giggles', 'warmly'],
    listo: ['giggles'],
    empatia: ['warmly'],
    humor: ['warmly'],
  },
  // Claudio, el zorro: curioso, pícaro, ingenioso.
  claudio: {
    pensando: ['mischievously', 'playfully'],
    buscando: ['playfully', 'mischievously', 'excited'],
    leyendo: ['impressed'],
    mirando: ['amazed', 'playfully'],
    seguimiento: ['giggles', 'playfully'],
    listo: ['mischievously', 'proud'],
    sorpresa: ['excited'],
    humor: ['sarcastic', 'deadpan'],
  },
  // ANT-ONIO, la hormiga de cuatro brazos: enérgico y práctico.
  antonio: {
    pensando: ['enthusiastic'],
    buscando: ['enthusiastic', 'excited', 'confident'],
    calculando: ['enthusiastic'],
    abriendo: ['enthusiastic', 'excited'],
    seguimiento: ['laughs', 'inhales'],
    listo: ['enthusiastic', 'excited'],
    alegria: ['enthusiastic'],
  },
};

/** Lo que NO va con la forma de ser de cada uno. */
const NUNCA: Partial<Record<AvatarFrase, ReadonlySet<EtiquetaVoz>>> = {
  ojos: new Set<EtiquetaVoz>(['laughs', 'giggles', 'laughs softly', 'chuckles', 'nervous laugh', 'scoffs', 'excited', 'playfully', 'mischievously', 'cheerfully', 'delighted', 'enthusiastic', 'stammers', 'nervously']),
};

/** Las etiquetas que puede usar este avatar en este momento (sin repetidas). */
export function etiquetasDe(estado: EstadoFrase, avatar: AvatarFrase = 'aura'): EtiquetaVoz[] {
  const a: AvatarFrase = avatar in PROPIAS ? avatar : 'aura';
  const nunca = NUNCA[a];
  return [...new Set([...(PROPIAS[a][estado] || []), ...(COMUN[estado] || [])])].filter((e) => !nunca?.has(e));
}

/**
 * Para no oír la misma: recuerda las últimas que sonaron (por avatar, sin importar el momento) y
 * elige entre las demás. Con pocas opciones, al menos no repite la última.
 */
export class MemoriaEtiquetas {
  private recientes = new Map<string, EtiquetaVoz[]>();
  constructor(private readonly cuantas = 4) {}
  elegir(opciones: readonly EtiquetaVoz[], avatar: string, azar: () => number = Math.random): EtiquetaVoz | null {
    if (!opciones.length) return null;
    const antes = this.recientes.get(avatar) || [];
    const libres = opciones.filter((o) => !antes.includes(o));
    const pool = libres.length ? libres : opciones.filter((o) => o !== antes[antes.length - 1]);
    const lista = pool.length ? pool : opciones;
    const elegida = lista[Math.floor(azar() * lista.length) % lista.length];
    this.recientes.set(avatar, [...antes, elegida].slice(-this.cuantas));
    return elegida;
  }
  olvidar() {
    this.recientes.clear();
  }
}

const memoria = new MemoriaEtiquetas();

/**
 * Qué tanto llevan etiqueta las frases de espera: casi siempre (una frase corta con su tono suena a
 * persona), pero no todas: una de cada cuatro va sin nada, para que tampoco se vuelva fórmula.
 */
export const PROB_ETIQUETA = 0.75;

/** Una etiqueta para este momento y avatar, sin repetir las últimas; null si esta vez va sin. */
export function etiquetaPara(
  estado: EstadoFrase,
  avatar: AvatarFrase = 'aura',
  o: { azar?: () => number; memoria?: MemoriaEtiquetas; siempre?: boolean; sin?: readonly EtiquetaVoz[] } = {}
): EtiquetaVoz | null {
  const azar = o.azar || Math.random;
  if (!o.siempre && azar() >= PROB_ETIQUETA) return null;
  const opciones = etiquetasDe(estado, avatar).filter((e) => !o.sin?.includes(e));
  return (o.memoria || memoria).elegir(opciones, avatar, azar);
}

/**
 * La frase como la DICE la voz v4: con su etiqueta delante la mayoría de las veces. El texto sin
 * etiqueta (el que se lee o va al globito) es `texto` tal cual. Si la frase ya trae una, no se le pone
 * otra; si ya empieza con «Mmm», no le toca el tarareo (sonaría «mmm… mmm»).
 */
export function conEtiqueta(texto: string, estado: EstadoFrase, avatar: AvatarFrase = 'aura', o: { azar?: () => number; memoria?: MemoriaEtiquetas } = {}): string {
  const t = String(texto || '').trim();
  if (!t || t.startsWith('[')) return t;
  const e = etiquetaPara(estado, avatar, { ...o, sin: /^(mmm+|hmm+)\b/i.test(t) ? ['hums'] : [] });
  return e ? `[${e}] ${t}` : t;
}
