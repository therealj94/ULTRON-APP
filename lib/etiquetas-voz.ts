/**
 * LA POLÍTICA DE ETIQUETAS DE VOZ — una sola, para todas las superficies (mesa web, teléfono, Windows, Dr Electrum,
 * la llamada). José (10-oct): «que la voz de AURA suene natural y igual en todas partes».
 *
 * Antes cada camino tenía su tope: el pulidor del turno hablado una por turno (lib/habla-natural.ts), la mesa cuatro
 * por trozo (server/eleven.ts), la llamada dos por turno más el tono (server/voz-agente.ts); y los tonos compuestos
 * («softly, sad», «warmly, tender») sonaban a teatro. Ahora, por TURNO:
 *
 *   · como mucho UN tono, y solo al comienzo (el primer trozo del turno, antes de la primera frase): el de la emoción
 *     del turno (TONO_EMOCION) o el que el cerebro escribió delante («[con ternura] Ay…»);
 *   · como mucho UNA reacción dentro del texto (una risa, un suspiro, un «mmm»);
 *   · NINGUNA en un turno triste, preocupado, de alarma, firme o seco, ni cuando se habla de dinero o de algo legal
 *     (y en la oración solo su tono, [softly], sin reacciones);
 *   · nunca un tono compuesto: «softly, reverent» se dice [softly].
 *
 * Y `quitarEtiquetasVoz`: lo que se enseña, lo que dice la voz de respaldo y los vecinos que se mandan a ElevenLabs
 * (`previous_text`/`next_text`) sin las marcas, pero sin tocar un «[1]», un «[Anexo A]» ni un enlace `[texto](url)`.
 *
 * Módulo puro (sin Node, sin red): lo importan el servidor, la web y la llamada. El teléfono lleva su copia de lo que
 * usa (mobile/src/lib/etiquetasVoz.ts) y una prueba vigila que digan lo mismo (tests/etiquetas-politica.test.ts).
 */
import type { Emocion } from './emocion';

/* ------------------------------------------------------------------ las marcas del cerebro, en la etiqueta v4 */

/**
 * Las marcas de expresión que escribe el cerebro (las mismas de AU-RA, lib/expresiones.ts), en la etiqueta de v4 que
 * suena a eso. Las que no suman se quitan (''). Verificadas con la API el 1-oct (mobile/src/compa/etiquetasVoz.ts).
 */
export const EXPRESION_A_V4: Record<string, string> = {
  risa: 'laughs',
  // José, 10-oct («más expresiones»): las nuevas de la voz hablada (lib/habla-natural.ts ETIQUETAS_VOZ_CORTA).
  'risa suave': 'laughs softly',
  entusiasmo: 'enthusiastic',
  ternura: 'tender',
  risita: 'chuckles',
  'risa tierna': 'chuckles',
  'risa nerviosa': 'nervous laugh',
  je: 'chuckles',
  suspiro: 'sighs',
  'suspiro cansado': 'sighs',
  'suspiro aliviado': 'relieved sigh',
  'suspiro sonador': 'wistful sigh',
  sorpresa: 'surprised',
  asombro: 'gasps',
  mmm: 'thoughtful',
  hmm: 'hesitant',
  bostezo: 'yawns',
  shh: 'whispers',
  susurro: 'whispers',
  ooh: 'impressed',
  aww: 'tender',
  respiro: 'inhales',
  bufido: 'scoffs',
  carraspeo: 'clears throat',
  tarareo: 'hums',
  jadeo: 'gasps',
  carcajada: 'laughs',
  'risa burlona': 'scoffs',
  'risa picara': 'mischievously',
  emocionado: 'excited',
  emocionada: 'excited',
  entusiasmado: 'enthusiastic',
  entusiasmada: 'enthusiastic',
  'con ternura': 'tender',
  'en voz baja': 'whispers',
  bajito: 'softly',
  pensativo: 'thoughtful',
  pensativa: 'thoughtful',
  curioso: 'curious',
  curiosa: 'curious',
  'con picardia': 'mischievously',
  jugueton: 'playfully',
  juguetona: 'playfully',
  serio: 'matter-of-fact',
  seria: 'matter-of-fact',
  aliviado: 'relieved',
  aliviada: 'relieved',
  nervioso: 'nervously',
  nerviosa: 'nervously',
  apenado: 'sheepish',
  apenada: 'sheepish',
  impresionado: 'impressed',
  impresionada: 'impressed',
  asombrado: 'amazed',
  asombrada: 'amazed',
  encantado: 'delighted',
  encantada: 'delighted',
  tranquilizando: 'reassuring',
  calmado: 'calm',
  calmada: 'calm',
  orgulloso: 'proud',
  orgullosa: 'proud',
  sarcastico: 'sarcastic',
  sarcastica: 'sarcastic',
  'sin emocion': 'deadpan',
  titubeo: 'hesitates',
  tartamudeo: 'stammers',
  'con calidez': 'warmly',
  alegre: 'cheerfully',
  concentrado: 'focused',
  concentrada: 'focused',
  aja: '',
  eso: '',
  auch: '',
  ups: '',
  beso: '',
  'mmm rico': '',
};

/** Minúsculas, sin tildes y con un solo espacio. */
export function sinTildes(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Una etiqueta ya en inglés pasa si TODAS sus palabras son de este vocabulario. Mirar solo si «parece ASCII» dejaba
 * pasar «[carcajada estruendosa]», y v4 la leía en voz alta.
 */
const VOCABULARIO_INGLES = new Set(
  (
    'a an and with without very slightly more less quiet quietly soft softly warm warmly tender reverent firm firmly ' +
    'calm calmly measured slow slower fast faster rising falling low lower high deep thoughtful curious excited ' +
    'happy sad serious urgent concerned worried relieved proud playful amused surprised pleasantly skeptical annoyed ' +
    'restrained tired gentle gently emotion emotional conviction confident sincere hopeful nostalgic wistful ' +
    'laughs laughing chuckles chuckle giggles sighs sigh sighing whispers whispering whisper gasps gasp inhales ' +
    'exhales breath breathes clears throat pause short long hesitant hesitates impressed scoffs yawns nervous ' +
    'laugh matter of fact flat dry casual friendly authoritative dramatic cheerful solemn intimate ' +
    'whispering shouting laughing ecstatic excitedly cheerfully nervously sarcastic sarcastically confidently ' +
    'seriously dramatically proudly sadly happily curiously thoughtfully reassuring encouraging ' +
    'patient patiently enthusiastic enthusiastically amazed awe hushed chuckling giggling grin smiling ' +
    'hums mischievously deadpan delighted sheepish focused stammers playfully'
  ).split(' ')
);

export function esEtiquetaIngles(k: string): boolean {
  const palabras = k.split(/[\s,'-]+/).filter(Boolean);
  return palabras.length > 0 && palabras.length <= 8 && palabras.every((w) => VOCABULARIO_INGLES.has(w));
}

/** ¿Es una pausa escrita como marca? Esas no son etiquetas: se dicen «...». */
export function esPausa(marca: string): boolean {
  return /^(short |long )?pause$|^pausa( corta| larga)?$/.test(sinTildes(marca));
}

/**
 * La etiqueta v4 de una marca del cerebro («risa» → «laughs», «softly, reverent» tal cual), o null si no tiene una que
 * sume (se quita). Sin aplicar la política: para eso, `EtiquetasTurno`.
 */
export function etiquetaV4(marca: string): string | null {
  const k = sinTildes(marca);
  if (k in EXPRESION_A_V4) return EXPRESION_A_V4[k] || null;
  return esEtiquetaIngles(k) ? k : null;
}

/** Sin tonos compuestos: «softly, reverent» → «softly»; «warmly, tender» → «warmly». */
export function simplificarEtiqueta(etiqueta: string): string {
  return String(etiqueta || '').split(',')[0].trim();
}

/* ------------------------------------------------------------------ tonos y reacciones */

/**
 * El tono de cada emoción: uno solo, sencillo. `neutral` no lleva nada (la voz ya es serena, y una etiqueta en cada
 * turno la vuelve actuada); las emociones serias tampoco (EMOCIONES_SIN_ETIQUETAS).
 */
export const TONO_EMOCION: Partial<Record<Emocion, string>> = {
  feliz: 'warmly',
  risa: 'chuckles',
  sorpresa: 'surprised',
  curioso: 'curious',
  pensando: 'thoughtful',
  carino: 'tender',
  travieso: 'playfully',
  oracion: 'softly',
};

/** Turnos sin ninguna etiqueta: la tristeza, la preocupación, una alarma, un «no» firme o un dato seco no se actúan. */
export const EMOCIONES_SIN_ETIQUETAS: ReadonlySet<string> = new Set(['triste', 'preocupado', 'alarma', 'firme', 'seco', 'molesto']);
/** Turnos con su tono pero sin reacciones (una risa en medio de la oración, nunca). */
const SIN_REACCIONES: ReadonlySet<string> = new Set([...EMOCIONES_SIN_ETIQUETAS, 'oracion', 'canto']);

/**
 * Las etiquetas que son un SONIDO (una risa, un suspiro, un carraspeo): las reacciones. Todo lo demás es un tono (cómo
 * se dice: [warmly], [whispers], [curious]).
 */
export const REACCIONES_V4: ReadonlySet<string> = new Set([
  'laughs', 'laughs softly', 'laughing', 'chuckles', 'chuckle', 'giggles', 'nervous laugh', 'scoffs', 'sighs', 'sigh',
  'exhales', 'inhales', 'relieved sigh', 'wistful sigh', 'yawns', 'clears throat', 'hums', 'gasps', 'gasp',
  'hesitates', 'stammers', 'short pause', 'long pause',
]);

export function esReaccion(etiquetaV4: string): boolean {
  return REACCIONES_V4.has(sinTildes(etiquetaV4));
}

/** Lo que vuelve serio un turno por lo que se habla (en texto sin tildes): pérdidas, salud, dinero, lo legal. */
export const TEMA_SENSIBLE =
  /\b(muri\w*|murio|fallec\w*|velorio|funeral|entierro|cancer|hospital\w*|enferm\w*|diagnost\w*|depres\w*|ansiedad|suicid\w*|me quiero morir|matar\w*|llor\w*|divorci\w*|despid\w*|accidente|violencia|abus\w*|deuda\w*|embargo|demanda\w*|abogad\w*|contrato\w*|legal|pag(ar|o|ue|aste|amos|aron|ad|ando)\w*|transf[ie]r\w*|lempiras?|lps|hnl|dolares|dinero|banco|prestamo\w*|died|passed away|sick|depress\w*|lawyer|contract|payment|money|debt)\b/;

/** Dinero escrito con su signo («L. 1,500», «$20», «US$ 300»): también es un tema serio. */
const DINERO_ESCRITO = /(?:^|[^\p{L}\d])(?:L\.?|Lps\.?|HNL|US\$|\$)\s?\d/u;

export function temaSensible(texto: string): boolean {
  const t = String(texto || '');
  return TEMA_SENSIBLE.test(sinTildes(t)) || DINERO_ESCRITO.test(t);
}

export type PoliticaEtiquetas = {
  /** El tono de la emoción (si el cerebro no puso otro delante), o null. */
  tono: string | null;
  /** Cuántos tonos caben al comienzo del turno (0 o 1). */
  maxTonos: 0 | 1;
  /** Cuántas reacciones caben en el turno (0 o 1). */
  maxReacciones: 0 | 1;
};

/**
 * Lo que le toca a un turno con esta emoción. `contexto`: lo que se habla (el mensaje de la persona o el texto que se
 * va a decir): dinero, lo legal o una pérdida lo vuelven serio.
 */
export function politicaEtiquetas(emocion: string | undefined, contexto = ''): PoliticaEtiquetas {
  const e = String(emocion || 'neutral');
  if (EMOCIONES_SIN_ETIQUETAS.has(e) || (contexto && temaSensible(contexto))) return { tono: null, maxTonos: 0, maxReacciones: 0 };
  return { tono: TONO_EMOCION[e as Emocion] ?? null, maxTonos: 1, maxReacciones: SIN_REACCIONES.has(e) ? 0 : 1 };
}

/**
 * La política aplicada a un turno, marca por marca. La usan la mesa (server/eleven.ts guionEleven, por frase), el
 * pulidor del turno hablado (lib/habla-natural.ts) y la llamada (server/voz-agente.ts, que recibe el texto a trozos):
 *
 *     const et = new EtiquetasTurno(emocion, { contexto: mensaje });
 *     et.marca('risa', alComienzo)  // → 'laughs' | null (null: se quita sin sonar)
 *     et.tono()                     // → el tono de la emoción, una vez, si el comienzo no trajo ya uno
 *
 * `alComienzo`: todavía no se ha dicho nada de este turno (la marca va delante de la primera frase). Solo ahí cabe un
 * tono; una reacción cabe en cualquier sitio, una vez.
 */
export class EtiquetasTurno {
  readonly politica: PoliticaEtiquetas;
  private tonos = 0;
  private reacciones = 0;
  /** El comienzo ya tiene algo (un tono o una reacción): el de la emoción no se pone encima. */
  private comienzoOcupado = false;
  private tonoDado = false;

  constructor(emocion: string | undefined, o: { contexto?: string; activo?: boolean; primerSegmento?: boolean } = {}) {
    this.politica = o.activo === false ? { tono: null, maxTonos: 0, maxReacciones: 0 } : politicaEtiquetas(emocion, o.contexto);
    // No es el primer trozo del turno: el tono ya se dio (o no tocaba) en el primero.
    if (o.primerSegmento === false) {
      this.tonos = 1;
      this.tonoDado = true;
    }
  }

  /** La etiqueta v4 de esta marca si la política la deja sonar (y la cuenta), o null. */
  marca(marca: string, alComienzo: boolean): string | null {
    const v4 = etiquetaV4(marca);
    if (!v4) return null;
    const etiqueta = simplificarEtiqueta(v4);
    if (!etiqueta) return null;
    if (esReaccion(etiqueta)) {
      if (this.reacciones >= this.politica.maxReacciones) return null;
      this.reacciones++;
      if (alComienzo) this.comienzoOcupado = true;
      return etiqueta;
    }
    if (!alComienzo || this.tonos >= this.politica.maxTonos) return null;
    this.tonos++;
    this.comienzoOcupado = true;
    return etiqueta;
  }

  /**
   * Una reacción sin etiqueta v4 (una toma grabada de AU-RA: «[ajá]», «[beso]», que solo suena con la voz de
   * respaldo): ocupa el mismo lugar que cualquier reacción. true si cabe (y la cuenta).
   */
  reaccion(): boolean {
    if (this.reacciones >= this.politica.maxReacciones) return false;
    this.reacciones++;
    return true;
  }

  /** El tono de la emoción, una sola vez y solo si el comienzo no trajo ya su tono o su reacción. */
  tono(): string | null {
    if (this.tonoDado) return null;
    this.tonoDado = true;
    if (this.comienzoOcupado || this.tonos >= this.politica.maxTonos || !this.politica.tono) return null;
    this.tonos++;
    return this.politica.tono;
  }
}

/* ------------------------------------------------------------------ quitar las marcas (pantalla, respaldo, vecinos) */

/** Una marca escrita a mano (`[risas]`, `[softly, warm]`): minúsculas y nada más. Nunca un número ni un nombre. */
const PARECE_ETIQUETA = /^[a-záéíóúüñ][a-záéíóúüñ ,'-]{0,38}$/;

/** ¿Lo de dentro de un corchete es una marca de voz (y no un «[1]», un «[Anexo A]» o un «[José]»)? */
export function esMarcaDeVoz(dentro: string): boolean {
  const d = String(dentro || '').trim();
  if (!d) return false;
  if (/^EMO:[a-z_]+$/i.test(d)) return true;
  if (/\d/.test(d)) return false;
  return etiquetaV4(d) !== null || esPausa(d) || sinTildes(d) in EXPRESION_A_V4 || PARECE_ETIQUETA.test(d);
}

/**
 * El texto sin las marcas de voz. No toca «[1]», «[Anexo A]» ni los enlaces `[texto](url)`. No recorta los bordes (se
 * aplica también a trozos de un stream que se pegan); quien tenga el texto entero hace `.trim()`.
 */
export function quitarEtiquetasVoz(texto: string): string {
  let quito = false;
  const sin = String(texto || '').replace(/[ \t]*\[([^\]\n]{1,80})\]/g, (todo: string, dentro: string, donde: number, entero: string) => {
    if (entero[donde + todo.length] === '(' || !esMarcaDeVoz(dentro)) return todo;
    quito = true;
    return '';
  });
  if (!quito) return sin;
  return sin
    .replace(/([¿¡])[ \t]+/g, '$1')
    .replace(/[ \t]+([,.;:!?…])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');
}

/**
 * Cuánto texto vecino se manda a ElevenLabs. 100 caracteres: el tope de Text to Dialogue (previous_text/future_text),
 * que en el TTS por HTTP no tiene tope publicado. Una frase entera de contexto basta para enlazar la entonación.
 */
export const TOPE_VECINO = 100;

/**
 * Lo dicho justo antes (`previo`: su final) o lo que viene (`siguiente`: su comienzo), como lo quiere ElevenLabs: sin
 * marcas, en una línea, corto y cortado en una palabra entera. undefined si no queda nada.
 */
export function textoVecino(texto: unknown, lado: 'previo' | 'siguiente', max = TOPE_VECINO): string | undefined {
  const t = typeof texto === 'string' ? quitarEtiquetasVoz(texto).replace(/\s+/g, ' ').trim() : '';
  if (!t) return undefined;
  if (t.length <= max) return t;
  if (lado === 'previo') {
    const cola = t.slice(-max);
    const i = cola.indexOf(' ');
    return (i > 0 && i < max / 2 ? cola.slice(i + 1) : cola).trim() || undefined;
  }
  const cabeza = t.slice(0, max);
  const i = cabeza.lastIndexOf(' ');
  return (i > max / 2 ? cabeza.slice(0, i) : cabeza).trim() || undefined;
}
