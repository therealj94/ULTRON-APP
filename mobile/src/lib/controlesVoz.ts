/**
 * LOS CONTROLES DE LA VOZ EN EL TELÉFONO (AUR10): COPIA de lib/controles-voz.ts (Metro no importa fuera de
 * mobile/). La explicación está allí. tests/controles-voz.test.ts comprueba que las dos dicen exactamente
 * lo mismo (frases, estados, efectos y respuestas): si cambias una, cambia la otra.
 *
 * Sin React Native: la mesa (lib/intenciones.ts), la voz (compa/VozProvider.tsx, compa/controles.ts) y las
 * pruebas en Node la usan igual.
 */

export const CONTROLES = ['silenciar_mic', 'activar_mic', 'detener_audio', 'interrumpir', 'colgar', 'pausar_tarea', 'reanudar_tarea', 'cancelar_tarea', 'tomar_control'] as const;
export type ControlVoz = (typeof CONTROLES)[number];

export type QueTarea = 'pausar' | 'reanudar' | 'cancelar' | 'tomar';

/** Lo que toca cada control. Lo que no aparece, no se toca. */
export type Efectos = {
  audio?: 'parar';
  mic?: 'silenciar' | 'activar';
  turno?: 'cortar';
  llamada?: 'colgar';
  tarea?: QueTarea;
};

export const EFECTOS: Readonly<Record<ControlVoz, Readonly<Efectos>>> = {
  silenciar_mic: { mic: 'silenciar' },
  activar_mic: { mic: 'activar' },
  detener_audio: { audio: 'parar' },
  interrumpir: { audio: 'parar', turno: 'cortar' },
  colgar: { llamada: 'colgar' },
  pausar_tarea: { tarea: 'pausar' },
  reanudar_tarea: { tarea: 'reanudar' },
  cancelar_tarea: { tarea: 'cancelar' },
  tomar_control: { tarea: 'tomar' },
};

/**
 * Lo que está vivo cuando se dice la frase (lo que se sepa; lo que no se sabe, no está):
 *  · audio: algo de AURA suena o espera en la cola;
 *  · tarea: una tarea durable (su computadora) está viva;
 *  · llamada: hay una llamada abierta;
 *  · turno: hay una respuesta en curso que todavía no suena (pensando).
 */
export type EstadoControles = { audio?: boolean; tarea?: boolean; llamada?: boolean; turno?: boolean };

export type ResultadoControl = { tipo: 'control'; control: ControlVoz } | { tipo: 'aclarar'; opciones: ControlVoz[]; pregunta: string };

type Idioma = 'es' | 'en';

/** Sin acentos, sin signos, sin el «AURA,» del principio ni el «por favor» / «ya» del final. */
export function fraseControl(texto: string): string {
  let q = String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (let i = 0; i < 3; i++) {
    const antes = q;
    q = q.replace(/^(?:oye|hey|ey|ok|okay|aura|au ra|claudio|antonio|ant onio|guardian) (\S)/, '$1');
    q = q.replace(/(\S) (?:por favor|porfa|porfis|please|ya|ahora|ahorita|gracias|ahora mismo|right now|now)$/, '$1');
    if (q === antes) break;
  }
  return q;
}

/* ------------------------------------------------------------------ las frases */

const RATO = '(?: (?:un|por un|el|a) (?:rato|ratito|momento|segundo|sec|second|bit))?';
const DET = '(?:(?:la|el|esa|ese|esta|este|tu|su|mi|the|that|this|your|my) )?';
const TAREA = '(?:tarea|mision|trabajo|computadora|compu|task|mission|job|computer)(?: (?:en|de) (?:la|tu|mi) (?:computadora|compu))?';

/** Detener lo que suena (y su cola). */
const RE_DETENER_AUDIO = new RegExp(
  `^(?:(?:ya )?callate(?: ya)?|calla|silencio|shh+|chito|(?:para|deja|basta|parale) de hablar|no hables(?: mas)?|ya no hables|(?:deten|para|parar|detener|corta|quita|apaga|silencia) ${DET}(?:audio|voz|sonido)|stop (?:talking|speaking)|stop the (?:audio|voice)|shut up|be quiet|quiet|hush)${RATO}$`
);
/** Silenciar el micrófono de esta sesión (no cuelga). */
const RE_SILENCIAR_MIC = new RegExp(
  `^(?:(?:silencia|apaga|corta|mutea|desactiva|cierra|quita) ${DET}(?:microfono|mic)|mutea(?:te)?|silenciate|mute(?: (?:the )?(?:mic|microphone|yourself))?|deja de escuchar(?:me)?|no me escuches|stop listening)${RATO}$`
);
/** Volver a mandar el micrófono. */
const RE_ACTIVAR_MIC =
  /^(?:(?:ya )?puedes (?:hablar|escuchar(?:me)?)|vuelve a (?:hablar|escuchar(?:me)?)|(?:activa|prende|enciende|abre) (?:el |tu |mi )?(?:microfono|mic)|unmute(?: (?:the )?(?:mic|microphone))?|despierta|you can talk now)$/;
/** Cortar la respuesta en curso. */
const RE_INTERRUMPIR = /^(?:olvidalo|no importa|cambia de tema|interrumpe|corta (?:la|esa) respuesta|never ?mind|forget it)$/;
/** Colgar la llamada. */
const RE_COLGAR = /^(?:(?:ya )?cuelga(?: (?:la|esta) llamada)?|colgar(?: la llamada)?|cuelguemos|(?:corta|termina|terminar|finaliza|cierra|acaba) (?:la|esta) llamada|hang up(?: the call)?|end (?:the |this )?call)$/;
const RE_CANCELAR_TAREA = new RegExp(
  `^(?:(?:cancela|cancelar|cancelala|deten|detener|para|parar|aborta|abortar|frena|stop|cancel|abort|kill) ${DET}${TAREA}|(?:ya )?no sigas con ${DET}${TAREA})$`
);
const RE_PAUSAR_TAREA = new RegExp(`^(?:(?:pausa|pausar|pause) ${DET}${TAREA}|pon ${DET}${TAREA} en pausa|pon en pausa ${DET}${TAREA})$`);
const RE_REANUDAR_TAREA = new RegExp(`^(?:(?:sigue|seguir|continua|continuar|reanuda|reanudar|resume|continue)(?: con)? ${DET}${TAREA})$`);
const RE_TOMAR_CONTROL = /^(?:(?:tomo|tomar|quiero|dame|deja(?:me)? tomar) el control|dejame (?:a mi|manejar)(?: la computadora)?|take (?:the )?control|give me (?:the )?control|let me (?:drive|take over))$/;

/** Las palabras sueltas que no dicen el alcance. */
const RE_SUELTA_PARAR = /^(?:para|parale|para ya|ya para|basta|ya basta|detente|deten|alto|stop|enough)$/;
const RE_SUELTA_PAUSAR = /^(?:pausa|pause)$/;
const RE_SUELTA_CANCELAR = /^(?:cancela|cancelalo|cancelala|cancel|cancel it)$/;

const EXPLICITAS: Array<[RegExp, ControlVoz]> = [
  [RE_COLGAR, 'colgar'],
  [RE_CANCELAR_TAREA, 'cancelar_tarea'],
  [RE_PAUSAR_TAREA, 'pausar_tarea'],
  [RE_REANUDAR_TAREA, 'reanudar_tarea'],
  [RE_TOMAR_CONTROL, 'tomar_control'],
  [RE_SILENCIAR_MIC, 'silenciar_mic'],
  [RE_ACTIVAR_MIC, 'activar_mic'],
  [RE_DETENER_AUDIO, 'detener_audio'],
  [RE_INTERRUMPIR, 'interrumpir'],
];

/** El control que dice la frase por sí sola (sin mirar qué está vivo), o null. */
export function controlExplicito(texto: string): ControlVoz | null {
  const q = fraseControl(texto);
  if (!q) return null;
  for (const [re, c] of EXPLICITAS) if (re.test(q)) return c;
  return null;
}

/**
 * La frase, como control: el explícito si lo dice; si es una palabra suelta, según lo que está vivo
 * (uno solo → ese; dos → aclarar); si no es un control, null (lo decide el resto: un borrador, el cerebro).
 */
export function interpretarControl(texto: string, estado: EstadoControles = {}, idioma: Idioma = 'es'): ResultadoControl | null {
  const q = fraseControl(texto);
  if (!q) return null;
  const explicito = controlExplicito(q);
  if (explicito) return { tipo: 'control', control: explicito };
  const suelta = RE_SUELTA_PARAR.test(q) ? 'parar' : RE_SUELTA_PAUSAR.test(q) ? 'pausar' : RE_SUELTA_CANCELAR.test(q) ? 'cancelar' : null;
  if (!suelta) return null;
  const opciones: ControlVoz[] = [];
  // Lo que suena (o la respuesta que todavía no suena) primero: es lo que la persona tiene encima.
  if (estado.audio) opciones.push('detener_audio');
  else if (estado.turno) opciones.push('interrumpir');
  if (estado.tarea) opciones.push(suelta === 'pausar' ? 'pausar_tarea' : 'cancelar_tarea');
  if (opciones.length === 1) return { tipo: 'control', control: opciones[0] };
  if (opciones.length > 1) return { tipo: 'aclarar', opciones, pregunta: preguntaAclaracion(opciones, idioma) };
  // Nada vivo: «para» / «basta» es callar (inofensivo, lo de siempre); «cancela» o «pausa» solos no son nada.
  return suelta === 'parar' || suelta === 'pausar' ? { tipo: 'control', control: 'detener_audio' } : null;
}

const NOMBRE: Record<Idioma, Partial<Record<ControlVoz, string>>> = {
  es: { detener_audio: 'mi voz', interrumpir: 'esta respuesta', cancelar_tarea: 'la tarea', pausar_tarea: 'la tarea', colgar: 'la llamada' },
  en: { detener_audio: 'my voice', interrumpir: 'this answer', cancelar_tarea: 'the task', pausar_tarea: 'the task', colgar: 'the call' },
};

/** «¿Qué paro: mi voz, la tarea o las dos?» */
export function preguntaAclaracion(opciones: readonly ControlVoz[], idioma: Idioma = 'es'): string {
  const n = opciones.map((c) => NOMBRE[idioma][c] || c);
  const pausa = opciones.includes('pausar_tarea');
  if (idioma === 'en') return `What should I ${pausa ? 'pause' : 'stop'}: ${n.join(', ')}, or both?`;
  return `¿Qué ${pausa ? 'pauso' : 'paro'}: ${n.join(', ')} o las dos?`;
}

const RE_RESP_AUDIO = /^(?:(?:solo |nada mas )?(?:tu |la |el |mi )?(?:voz|audio|hablar|de hablar|sonido)|(?:solo )?callate|deja de hablar|que te calles|(?:your |the |my )?(?:voice|audio|talking)|stop talking)$/;
const RE_RESP_TAREA = new RegExp(`^(?:(?:solo |nada mas )?${DET}${TAREA}|(?:only )?${DET}${TAREA})$`);
const RE_RESP_AMBAS = /^(?:(?:las |los )?dos(?: cosas)?|ambas|ambos|todo|las dos cosas|both|everything|all|all of it)$/;
const RE_RESP_NADA = /^(?:no|nada|ninguna|ninguno|ninguna de las dos|no nada|no sigue|sigue|continua|nothing|neither|none|no keep going|keep going)$/;

/**
 * La respuesta a la pregunta: los controles que pide, 'ninguno' si no quiere parar nada, o null si no es
 * una respuesta (otra frase: sigue su camino). Un control explícito («cuelga») se respeta tal cual.
 */
export function respuestaAclaracion(texto: string, opciones: readonly ControlVoz[]): ControlVoz[] | 'ninguno' | null {
  const q0 = fraseControl(texto);
  if (!q0) return null;
  if (RE_RESP_NADA.test(q0)) return 'ninguno';
  const q = q0.replace(/^mejor (\S)/, '$1');
  if (RE_RESP_AMBAS.test(q)) return [...opciones];
  const deAudio = opciones.find((c) => c === 'detener_audio' || c === 'interrumpir');
  const deTarea = opciones.find((c) => c === 'cancelar_tarea' || c === 'pausar_tarea');
  if (deAudio && RE_RESP_AUDIO.test(q)) return [deAudio];
  if (deTarea && RE_RESP_TAREA.test(q)) return [deTarea];
  const c = controlExplicito(q);
  return c ? [c] : null;
}

/* ------------------------------------------------------------------ ejecutar */

export type ResultadoPuerto = { ok: boolean; detalle?: string };
type Puede<T> = T | Promise<T>;

/**
 * Cómo hace cada efecto quien ejecuta (el teléfono, la web). Lo que no tenga, no lo puede hacer: se dice.
 * Detener el audio y cortar el turno no fallan (lo que no suena ya está callado).
 */
export type PuertosControl = {
  pararAudio?: () => Puede<void>;
  cortarTurno?: () => Puede<void>;
  microfono?: (silenciar: boolean) => Puede<ResultadoPuerto>;
  colgar?: () => Puede<ResultadoPuerto>;
  tarea?: (que: QueTarea) => Puede<ResultadoPuerto>;
};

export type ResultadoEjecucion = { ok: boolean; detalle?: string; hechos: Array<keyof Efectos> };

const NO_DISPONIBLE: Record<keyof Efectos, string> = {
  audio: 'Aquí no puedo parar el audio.',
  turno: 'Aquí no puedo cortar la respuesta.',
  mic: 'Aquí no puedo silenciar el micrófono.',
  llamada: 'Aquí no hay llamada que colgar.',
  tarea: 'Aquí no puedo manejar la tarea.',
};

/**
 * Ejecuta UN control tocando solo los puertos de su efecto, en este orden: lo que suena (al instante),
 * el turno, el micrófono, la llamada y la tarea. Lo que no se pudo, con su porqué (nunca «listo» de más).
 */
export async function ejecutarControl(control: ControlVoz, p: PuertosControl): Promise<ResultadoEjecucion> {
  const e = EFECTOS[control];
  const hechos: Array<keyof Efectos> = [];
  const fallo = (que: keyof Efectos, detalle?: string): ResultadoEjecucion => ({ ok: false, detalle: detalle || NO_DISPONIBLE[que], hechos });
  try {
    if (e.audio) {
      if (!p.pararAudio) return fallo('audio');
      await p.pararAudio();
      hechos.push('audio');
    }
    if (e.turno) {
      if (!p.cortarTurno) return fallo('turno');
      await p.cortarTurno();
      hechos.push('turno');
    }
    if (e.mic) {
      if (!p.microfono) return fallo('mic');
      const r = await p.microfono(e.mic === 'silenciar');
      if (!r.ok) return fallo('mic', r.detalle);
      hechos.push('mic');
    }
    if (e.llamada) {
      if (!p.colgar) return fallo('llamada');
      const r = await p.colgar();
      if (!r.ok) return fallo('llamada', r.detalle);
      hechos.push('llamada');
    }
    if (e.tarea) {
      if (!p.tarea) return fallo('tarea');
      const r = await p.tarea(e.tarea);
      if (!r.ok) return fallo('tarea', r.detalle);
      hechos.push('tarea');
    }
  } catch (err) {
    const que = (['audio', 'turno', 'mic', 'llamada', 'tarea'] as const).find((k) => e[k] && !hechos.includes(k)) || 'audio';
    return fallo(que, `No pude: ${String((err as Error)?.message || err).slice(0, 120)}`);
  }
  return { ok: true, hechos };
}

/** Lo que se dice al hacerlo (corto: quien calla no habla de más). */
export function dichoDeControl(control: ControlVoz, idioma: Idioma = 'es'): string {
  const en = idioma === 'en';
  switch (control) {
    case 'detener_audio':
    case 'interrumpir':
      return en ? 'Okay.' : 'Va.';
    case 'silenciar_mic':
      return en ? 'Mic off.' : 'Micrófono apagado.';
    case 'activar_mic':
      return en ? "I'm here." : 'Aquí estoy.';
    case 'colgar':
      return en ? 'Hanging up.' : 'Cuelgo.';
    case 'pausar_tarea':
      return en ? 'Pausing the task.' : 'Pauso la tarea.';
    case 'reanudar_tarea':
      return en ? 'Resuming the task.' : 'Sigo con la tarea.';
    case 'cancelar_tarea':
      return en ? 'Cancelling the task.' : 'Cancelo la tarea.';
    case 'tomar_control':
      return en ? "It's yours: I'll wait." : 'Te paso el control: espero.';
  }
}
