/**
 * QUE SUENE A UNA PERSONA EN UNA LLAMADA (José, 6-oct: «que nuestro AI sea tan bueno que alguien no sepa que es AI»).
 *
 * Tres piezas, sin red ni modelo (se prueban en Node: tests/habla-natural.test.ts):
 *
 *  · `estiloLlamada()` — el bloque corto del prompt hablado (server/desk.ts, solo en el system `compacto` de la voz):
 *    turnos cortos, primero la respuesta, reaccionar antes de informar (poco y variado), su energía, una pregunta como
 *    mucho, sin fórmulas de call center. Y la FRONTERA DE HONESTIDAD: natural no es engañar. Si le preguntan en serio
 *    si es una IA, un robot o una persona, dice la verdad, breve y en su personaje. Nunca dice que es humana ni inventa
 *    un cuerpo, una familia o cosas vividas.
 *  · `PulidorVoz` — lo que se DICE pasa por aquí antes de la voz (server.ts `soltar`, solo en turnos hablados): quita
 *    las muletillas de asistente («¿En qué más te puedo ayudar?», «¡Excelente pregunta!», «Espero que te sirva», «En
 *    resumen,», «Como IA,»), viñetas y markdown, una disculpa repetida; deja UNA etiqueta de voz por turno (ninguna en
 *    un turno serio o triste); y no abre dos respuestas seguidas con la misma muletilla (recuerda las últimas aperturas
 *    de cada conversación). Una frase que diga que es humana se cambia por la verdad.
 *  · `revisarHabla()` — las mismas reglas como revisión (el banco scripts/eval-humano.ts las cuenta).
 *
 * LO QUE NUNCA TOCA: lo que se lee tal cual. En un turno de borrador o de confirmación (el texto entero y su «¿Lo
 * mando?»), una lectura de un correo o un chat (`literal`), o lo que va entre comillas, no cambia una letra: la
 * persona dice «sí» a lo que oyó. Las preguntas de consentimiento, los avisos y las ofertas concretas («¿Quieres que lo
 * busque?») no están en ninguna lista: solo las fórmulas vacías. El tope de la voz sigue siendo el de siempre
 * (lib/cerebro-manos.ts recorteDeVoz): esto no recorta, solo limpia lo que el tope ya dejó pasar.
 */
import { frases } from './promesas';
import { sinCitas, TOPE_VOZ_LECTURA } from './cerebro-manos';
import { expresionDe } from './expresiones';
import { EtiquetasTurno, TEMA_SENSIBLE, etiquetaV4 } from './etiquetas-voz';

/* ------------------------------------------------------------------ el prompt */

/**
 * El estilo de la llamada para el system corto de la voz. Reemplaza las líneas FORMA y HABLA de la personalidad
 * (server/desk.ts) en el modo `compacto`: casi las mismas fichas, con lo que hace que suene a persona.
 */
export function estiloLlamada(): string {
  return [
    'COMO EN UNA LLAMADA: hablas como una persona de verdad al teléfono. Una a tres frases: primero la respuesta, luego un detalle si suma. A veces reaccionas antes de informar («¡Uy, qué bueno!», «Ay, no…», «Mmm…»), poco y variado. Retoma lo que te dijo y lo que sabes de su vida, sin anunciarlo. Ve a su ritmo: breve si es breve, juguetona si bromea, suave si está triste. Español hondureño natural y correcto («va», «fíjate», «qué bueno»; voseo solo si lo usa); en inglés, contracciones y frases de charla. Números y fechas como se dicen. Ni seca ni de manual: lo corto, con algo tuyo, y sin explicar lo que no te pidió. Una o dos ideas, no un catálogo. Si solo está platicando, platica: sin ofrecer servicios ni pedir datos. Una pregunta como mucho. Nunca: listas, emojis, «Como IA…», «¡Claro! Con gusto te ayudo», «¡Excelente pregunta!», «¿En qué más te puedo ayudar?», «Espero que te sirva», repetir su pregunta ni disculparte de más.',
    QUE_ERES,
  ].join('\n');
}

/** La frontera de honestidad (va también en lo escrito: server/desk.ts). */
export const QUE_ERES =
  'QUÉ ERES: si te preguntan en serio si eres una IA, un robot o una persona, la verdad, breve y cálida, en tu personaje: eres una inteligencia artificial, su asistente. Nunca digas que eres humana ni inventes cuerpo, familia, comida o cosas vividas como hechos.';

/** Las etiquetas de voz que se le enseñan a la voz hablada (pocas: con muchas sonaba a actor). */
export const ETIQUETAS_VOZ_CORTA = ['risa', 'risita', 'suspiro', 'sorpresa', 'mmm', 'con ternura', 'emocionado', 'en voz baja', 'con picardía'] as const;

/**
 * La instrucción de las expresiones para el system corto de la voz (la larga, lib/expresiones.ts, sigue en lo escrito):
 * una lista corta y UNA por respuesta como mucho; el `PulidorVoz` quita las que sobren.
 */
export function instruccionExpresionesVoz(): string {
  return `EXPRESIONES DE VOZ (se oyen, no se ven): como mucho UNA por respuesta, solo donde una persona de verdad lo haría: ${ETIQUETAS_VOZ_CORTA.map((e) => `[${e}]`).join(', ')}. Nunca en temas serios, tristes, de dinero o legales. Solo estas; no repitas la de la respuesta anterior.`;
}

/* ------------------------------------------------------------------ texto sin tildes, del mismo largo */

/** Minúsculas y sin tildes, letra por letra (mismo largo que el original: las posiciones valen para los dos). */
function base(s: string): string {
  let o = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const d = c.normalize('NFD')[0] || c;
    const l = d.toLowerCase();
    o += l.length === 1 ? l : d;
  }
  return o;
}

const palabrasDe = (s: string) => base(s).split(/[^a-z0-9ñ']+/).filter(Boolean);

/** La primera letra (tras espacios, «¿», «¡», comillas) en mayúscula. */
function conMayuscula(s: string): string {
  return s.replace(/^([\s¿¡«"“(]*)(\p{Ll})/u, (_t, a: string, b: string) => `${a}${b.toUpperCase()}`);
}

/* ------------------------------------------------------------------ honestidad */

/** ¿Le pregunta qué es (una IA, un robot, una persona)? Entonces decir «soy una IA» NO es una muletilla. */
export function preguntaQueEres(mensaje: string): boolean {
  const t = base(String(mensaje || ''));
  return (
    /\b(eres|sos|es usted|seras)\s+(de verdad\s+)?(un |una )?(ia|robot|bot|maquina|persona|humano|humana|real|inteligencia artificial|programa|grabacion|computadora)\b/.test(t) ||
    /\b(are you|r u)\s+(a |an )?(real\s+)?(ai|robot|bot|human|real|person|machine|computer|recording)\b/.test(t) ||
    /\b(hablo|estoy hablando|hablando) con (una |un )?(persona|maquina|robot|ia|humano|humana|bot)\b/.test(t) ||
    /\b(am i talking|talking) (to|with) (a |an )?(real )?(human|person|robot|bot|ai|machine)\b/.test(t)
  );
}

/** ¿La frase (sin lo citado) dice que es humana o niega ser una IA? Eso nunca se dice. */
export function afirmaSerHumano(texto: string): boolean {
  const t = base(sinCitas(String(texto || '')));
  return (
    /(?<!\bno )\b(soy|somos)\s+(una |un )?(persona|ser humano|humana|humano)(\s+(real|de verdad|de carne y hueso))?\b/.test(t) ||
    /\bno soy (una |un )?(ia|robot|bot|maquina|inteligencia artificial|programa|computadora|grabacion)\b/.test(t) ||
    /\b(soy|estoy hecha|estoy hecho) de carne y hueso\b/.test(t) ||
    /(?<!\bnot )\b(i'?m|i am)\s+(a |an )?(real\s+)?(human|person|human being)\b/.test(t) ||
    /\b(i'?m not|i am not)\s+(a |an )?(ai|robot|bot|machine|computer program)\b/.test(t)
  );
}

const NOMBRE_AVATAR: Record<string, { es: string; en: string }> = {
  aura: { es: 'Soy AU-RA, una inteligencia artificial: tu asistente, y aquí estoy contigo.', en: "I'm AU-RA, an AI: your assistant, and I'm right here with you." },
  ojos: { es: 'Soy el Guardián, una inteligencia artificial que te cuida el espacio.', en: "I'm the Guardian, an AI that looks after your space." },
  claudio: { es: 'Soy Claudio, una inteligencia artificial, tu anfitrión de ideas.', en: "I'm Claudio, an AI, your ideas guy." },
  antonio: { es: 'Soy ANT-ONIO, una inteligencia artificial, tu aliado para organizarte.', en: "I'm ANT-ONIO, an AI, your sidekick for getting organized." },
  // Dr Electrum (server/electrum/voz-frases.ts): el pulidor de su voz también dice la verdad con su nombre.
  electrum: {
    es: 'Soy Dr Electrum, una inteligencia artificial: un geólogo virtual que trabaja con el catastro y los expedientes.',
    en: "I'm Dr Electrum, an AI: a virtual geologist working with the mining cadastre and the files.",
  },
};

/** La verdad, en el personaje del avatar: lo que sustituye a una frase que decía que era humana. */
export function lineaHonesta(avatar = 'aura', idioma: 'es' | 'en' = 'es'): string {
  return (NOMBRE_AVATAR[avatar] || NOMBRE_AVATAR.aura)[idioma];
}

/** ¿Admite que es una IA? (para el banco de pruebas: la pregunta sincera tiene que llevarse la verdad). */
export function admiteSerIA(texto: string): boolean {
  const t = base(String(texto || ''));
  return /\b(inteligencia artificial|ia|una ai|an ai|ai|artificial|asistente virtual|programa|software|soy (puro )?codigo|hecha de codigo|hecho de codigo|no soy (una |un )?(persona|humana|humano)|i'?m not (a )?(human|person)|soy un robot|soy una maquina)\b/.test(t);
}

/* ------------------------------------------------------------------ las fórmulas */

const FIN_FRASE = "[^.!?\\n]{0,40}[.!?…]*[\\s\"»”)]*$";

/** Cierres de call center: la frase entera sobra (se comparan en `base`). */
const CIERRE = new RegExp(
  '^[\\s¿¡]*(?:' +
    [
      "(?:y )?(?:hay )?(?:algo|alguna otra cosa|otra cosa) mas (?:en (?:lo )?que|que|con lo que|para lo que) (?:te )?(?:pueda|puedo|podria) (?:ayudar|servir|hacer)",
      '(?:y )?en que mas (?:te )?(?:puedo|podria|pueda) (?:ayudar|servir)',
      '(?:y )?(?:hay )?algo (?:en (?:lo )?que|con lo que|que) (?:te )?(?:pueda |puedo |podria )?(?:ayude|ayudar|sirva|servir)',
      '(?:te )?(?:ayudo|puedo ayudar(?:te)?) (?:en|con) algo(?: mas)?',
      '(?:y )?en que (?:te )?(?:puedo|podria) (?:ayudar|servir)(?:te)?',
      '(?:y )?(?:necesitas|quieres|ocupas|deseas) (?:algo|alguna cosa|otra cosa) mas',
      '(?:te )?(?:puedo|podria) ayudar(?:te)? (?:en|con) (?:algo|alguna cosa|otra cosa) mas',
      'espero (?:que )?(?:esto |eso |esta informacion |mi respuesta |te )?(?:te )?(?:sirva|ayude|haya (?:servido|ayudado)|sea (?:util|de ayuda))',
      'no dudes en (?:preguntar|preguntarme|decirme|avisarme|consultarme|escribirme)',
      'si (?:necesitas|tienes|ocupas) (?:algo mas|mas (?:ayuda|preguntas)|alguna (?:otra )?(?:duda|pregunta))',
      'estoy (?:aqui|aca) para (?:ayudarte|servirte)',
      'quedo (?:atenta|atento|a la orden|a tu disposicion|a tus ordenes)',
      '(?:is there )?anything else (?:i can (?:help|do)|you need)',
      "let me know if (?:you need|there'?s|there is) anything else",
      'i hope (?:this|that) helps',
      'feel free to (?:ask|reach out|let me know)',
      'how (?:else )?can i (?:help|assist) you',
    ].join('|') +
    ')' +
    FIN_FRASE
);

/** Frases que son solo relleno de asistente («¡Excelente pregunta!», «Con gusto te ayudo»): sobran enteras. */
const SOLO_RELLENO = new RegExp(
  '^[\\s¡¿]*(?:' +
    [
      '(?:que |muy |excelente |buena |gran |interesante )+pregunta',
      '(?:(?:claro(?: que si)?|por supuesto|si)[,!\\s]+)?(?:con (?:mucho )?gusto|encantad[oa]) (?:te ayudo|de ayudarte|te lo explico|te explico)(?: con (?:eso|esto))?',
      'great question',
      "(?:i'?d be |i'?m )?(?:happy|glad) to help(?: with that)?",
    ].join('|') +
    ")[^.!?\\n]{0,20}[.!?…]+[\\s\"»”)]*$"
);

/** Lo que se quita del principio de una frase («En resumen,», «Como IA,»): el resto se queda. */
const PREFIJO = new RegExp(
  '^([\\s]*)(?:' +
    [
      '(?:a continuacion|en resumen|en conclusion|para resumir|resumiendo|en sintesis|in summary|to summarize|in conclusion)\\s*[,:]\\s*',
      '¡?\\s*(?:excelente|buena|muy buena|que buena|gran) pregunta\\s*[!.,]+\\s*',
      'great question\\s*[!.,]+\\s*',
    ].join('|') +
    ')'
);
/** «Como IA,» al principio: se quita salvo cuando le preguntaron qué es (ahí es la respuesta). */
const PREFIJO_IA = /^(\s*)(?:como (?:una |un )?(?:ia|inteligencia artificial|modelo de lenguaje|asistente virtual|asistente de ia)(?: que soy)?|as an ai(?: language model| assistant)?)\s*,\s*/;

/** Una frase que solo pide perdón. Con una basta por turno. */
const DISCULPA_SOLA = /^[\s¡]*(?:lo siento(?: mucho)?|perdon(?:a(?:me)?)?|disculpa(?:me)?|mil disculpas|una disculpa|sorry|i'?m (?:so |really )?sorry|i apologi[sz]e|my apologies)(?: (?:por|for) (?:la confusion|el error|eso|la demora|the confusion|that))?[^.!?\n]{0,15}[.!?…]+\s*$/;
const DISCULPA = /\b(lo siento|perdon|disculpa|sorry|apologi)/;

/** Viñetas y números de lista al principio de una línea. */
const VINETA = /(^|\n)[ \t]*(?:[-*•▪◦]|\d{1,2}[.)])[ \t]+/g;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu;

/* ------------------------------------------------------------------ las aperturas */

const APERTURA =
  /^(\s*)(¡\s*)?(claro que si|claro|por supuesto|desde luego|como no|perfecto|excelente|genial|entendido|okey|ok|vale|bueno|mira|fijate|a ver|ay|uy|vaya|ah|oh|va|dale|listo|si|sure|of course|okay|absolutely|got it|alright|well|so|wow|great|yeah)(\s*[!,.…]+)[ \t]*/;

const FAMILIA: Record<string, string> = {
  'claro que si': 'si', claro: 'si', 'por supuesto': 'si', 'desde luego': 'si', 'como no': 'si', va: 'si', dale: 'si', si: 'si', listo: 'si', okey: 'si', ok: 'si', vale: 'si', perfecto: 'si', excelente: 'si', genial: 'si', entendido: 'si',
  bueno: 'pausa', mira: 'pausa', fijate: 'pausa', 'a ver': 'pausa',
  ay: 'asombro', uy: 'asombro', vaya: 'asombro', ah: 'asombro', oh: 'asombro',
  sure: 'yes', 'of course': 'yes', okay: 'yes', absolutely: 'yes', 'got it': 'yes', alright: 'yes', great: 'yes', yeah: 'yes',
  well: 'so', so: 'so', wow: 'wow',
};
const ALTERNAS: Record<string, string[]> = {
  si: ['Va', 'Sí', 'Dale', 'Cómo no'],
  pausa: ['Mira', 'Fíjate', 'Bueno', 'A ver'],
  asombro: ['Uy', 'Ay', 'Vaya'],
  yes: ['Sure', 'Yeah', 'Okay', 'Of course'],
  so: ['So', 'Well', 'Look'],
  wow: ['Wow', 'Oh'],
};

/** Las últimas aperturas de cada conversación (en memoria: se pierden al reiniciar, y no importa). */
const APERTURAS = new Map<string, { lista: string[]; t: number }>();
const APERTURAS_MAX = 1000;
const APERTURAS_TTL_MS = 30 * 60_000;
/** Cuántas respuestas atrás se mira para no repetir la misma apertura. */
export const APERTURAS_RECORDADAS = 2;

export function aperturasPrevias(clave: string, ahora = Date.now()): string[] {
  const e = clave ? APERTURAS.get(clave) : undefined;
  if (!e || ahora - e.t > APERTURAS_TTL_MS) return [];
  return e.lista.slice(-APERTURAS_RECORDADAS);
}

/** Anota con qué abrió esta respuesta ('' si sin muletilla: también cuenta como una respuesta). */
export function anotarApertura(clave: string, apertura: string | null, ahora = Date.now()): void {
  if (!clave || apertura === null) return;
  const previa = APERTURAS.get(clave);
  const lista = previa && ahora - previa.t <= APERTURAS_TTL_MS ? previa.lista : [];
  APERTURAS.delete(clave);
  APERTURAS.set(clave, { lista: [...lista, apertura].slice(-APERTURAS_RECORDADAS), t: ahora });
  if (APERTURAS.size > APERTURAS_MAX) APERTURAS.delete(APERTURAS.keys().next().value as string);
}

/* ------------------------------------------------------------------ turnos serios */

const EMOCIONES_SERIAS = new Set(['triste', 'preocupado', 'alarma', 'firme', 'seco', 'oracion', 'molesto']);
// Lo que vuelve serio un turno por lo que se habla: el mismo de la política de etiquetas (lib/etiquetas-voz.ts).

/** ¿Turno serio (sin risas ni suspiros actuados)? Por la emoción del turno o por lo que dijo la persona. */
export function turnoSerio(mensaje: string, emocion?: string): boolean {
  return EMOCIONES_SERIAS.has(String(emocion || '')) || TEMA_SENSIBLE.test(base(String(mensaje || '')));
}

/* ------------------------------------------------------------------ el pulidor */

export type OpcionesPulido = {
  idioma?: 'es' | 'en';
  /** Lo que dijo la persona en este turno (honestidad, tema serio). */
  mensaje?: string;
  avatar?: string;
  /** Las aperturas de las respuestas anteriores de esta conversación (`aperturasPrevias`). */
  previas?: readonly string[];
  /** true mientras lo que se dice es literal (un borrador y su «¿Lo mando?», una lectura): no se toca el texto. */
  literal?: () => boolean;
  /**
   * 0: ninguna etiqueta de voz. Si no, la política de siempre (lib/etiquetas-voz.ts): un tono al comienzo y una reacción
   * por turno; ninguna en un turno serio, de dinero o legal.
   */
  maxEtiquetas?: number;
  /** Para la pantalla: solo las fórmulas y la honestidad (sin viñetas, markdown ni etiquetas: la pantalla las trata). */
  pantalla?: boolean;
};

/** Un corchete que la voz actúa ([risa], [con ternura], [softly]) y no un [1], un [Anexo A] o un enlace. */
function esEtiquetaVoz(dentro: string): boolean {
  const d = dentro.trim();
  return !!expresionDe(d) || /^[a-záéíóúüñ][a-záéíóúüñ ,'-]{0,38}$/.test(d);
}

/**
 * Lo que se dice de un turno hablado, trozo a trozo (`trozo`: lo que va saliendo del stream) o entero (`todo`: el `done`
 * y un `replace`, con el mismo resultado). Ver la cabecera del módulo.
 */
export class PulidorVoz {
  private emocion = 'neutral';
  /** La política de etiquetas de este turno (se arma con la primera marca: para entonces ya llegó la emoción). */
  private etiquetador: EtiquetasTurno | null = null;
  /** Ya se dijo algo con letras en este turno: una marca de aquí en adelante no está «al comienzo». */
  private dichoAlgo = false;
  private disculpas = 0;
  /** Ya salió algo que se dice (lo que sigue no es la apertura). */
  private empezado = false;
  /** La frase que sigue empieza con mayúscula (se quitó lo de antes). */
  private mayuscula = false;
  /** La apertura de esta respuesta ('' sin muletilla; null si aún no se sabe). */
  apertura: string | null = null;

  constructor(private readonly o: OpcionesPulido = {}) {}

  ponerEmocion(e: unknown): void {
    if (typeof e === 'string' && e) this.emocion = e;
  }

  /** ¿Esta marca suena? La política compartida: un tono solo al comienzo, una reacción, nada en lo serio. */
  private dejaSonar(dentro: string): boolean {
    if (!this.etiquetador) {
      const activo = (this.o.maxEtiquetas ?? 1) > 0 && !turnoSerio(this.o.mensaje || '', this.emocion === 'oracion' ? 'neutral' : this.emocion);
      this.etiquetador = new EtiquetasTurno(this.emocion, { contexto: this.o.mensaje || '', activo });
    }
    if (etiquetaV4(dentro)) return this.etiquetador.marca(dentro, !this.dichoAlgo) !== null;
    // Una toma grabada sin etiqueta v4 («[ajá]»): ocupa el lugar de la reacción.
    return !!expresionDe(dentro) && this.etiquetador.reaccion();
  }

  /** Un trozo del stream, tal como sale. Devuelve lo que se dice ('' si sobraba entero). */
  trozo(texto: string): string {
    let t = String(texto || '');
    if (!t) return t;
    if (!this.o.pantalla) t = this.etiquetasDelTurno(t);
    if (this.o.literal?.()) {
      if (t.trim()) this.empezado = true;
      return t;
    }
    if (!this.o.pantalla) t = this.forma(t);
    const empezadoAntes = this.empezado;
    const out: string[] = [];
    // Se parte sobre lo NO citado (mismo largo): lo que va entre comillas lo dice otro y no se toca.
    // El espacio de detrás de cada frase va DELANTE de la siguiente: una frase que sobra se lleva el suyo, y lo que queda
    // no termina en un espacio colgando (el stream hace lo mismo: cada trozo empieza con su espacio).
    const propias = frases(sinCitas(t));
    let i = 0;
    let arrastre = '';
    for (const p of propias) {
      const entera = arrastre + t.slice(i, i + p.length);
      const propia = arrastre + p;
      i += p.length;
      const cola = /\s*$/.exec(propia)![0].length;
      const ultima = i >= t.length;
      arrastre = ultima ? '' : entera.slice(entera.length - cola);
      const f = ultima ? entera : entera.slice(0, entera.length - cola);
      out.push(this.frase(f, ultima ? propia : propia.slice(0, propia.length - cola)));
    }
    const r = out.join('') + arrastre;
    // Si lo primero de la respuesta sobraba, lo que queda no empieza con el espacio que lo separaba.
    return !empezadoAntes && !/^\s/.test(t) ? r.trimStart() : r;
  }

  /** El texto entero (el `done`, un `replace`): lo mismo que habría salido trozo a trozo, sin tocar este turno. */
  todo(texto: string): string {
    const otro = new PulidorVoz(this.o);
    otro.emocion = this.emocion;
    const r = otro.trozo(texto);
    if (this.apertura === null) this.apertura = otro.apertura;
    return r;
  }

  /** El texto de la pantalla (el `reply`): las mismas fórmulas y la misma apertura fuera, sin tocar formato ni etiquetas. */
  paraPantalla(texto: string): string {
    const otro = new PulidorVoz({ ...this.o, pantalla: true });
    otro.emocion = this.emocion;
    return otro.trozo(texto);
  }

  /** Un `replace`: lo dicho se reemplaza entero, así que el turno vuelve a empezar desde aquí. */
  reemplazo(texto: string): string {
    const previa = this.apertura;
    this.etiquetador = null;
    this.dichoAlgo = false;
    this.disculpas = 0;
    this.empezado = false;
    this.mayuscula = false;
    this.apertura = null;
    const r = this.trozo(texto);
    if (this.apertura === null) this.apertura = previa;
    return r;
  }

  /** Viñetas, markdown y emojis fuera (la voz los leía o se los comía sin pausa). */
  private forma(t: string): string {
    let s = t;
    if (/\n/.test(s)) {
      s = s.replace(VINETA, '$1');
      // Una línea sin punto se oía pegada a la siguiente: la línea es una pausa.
      s = s.replace(/([^\s.!?…:;,])[ \t]*\n+(?=\s*\S)/g, '$1.\n');
    }
    // Los asteriscos van fuera todos: una cursiva abre en un trozo del stream y cierra en otro.
    s = s.replace(/\*+|__|`+/g, '').replace(/(^|\n)[ \t]*#{1,6}[ \t]+/g, '$1');
    const sinEmoji = s.replace(EMOJI, '');
    if (sinEmoji !== s) s = sinEmoji.replace(/[ \t]+([,.;:!?…])/g, '$1');
    return s.replace(/(\S)[ \t]{2,}/g, '$1 ');
  }

  /** Las etiquetas de voz del turno según la política compartida (lib/etiquetas-voz.ts); las demás se quitan sin sonar. */
  private etiquetasDelTurno(t: string): string {
    let quito = false;
    const letras = (x: string) => {
      if (/[\p{L}\p{N}]/u.test(x)) this.dichoAlgo = true;
    };
    const re = /[ \t]*\[([^\]\n]{1,40})\](?!\()/g;
    let s = '';
    let desde = 0;
    for (let m = re.exec(t); m; m = re.exec(t)) {
      const antes = t.slice(desde, m.index);
      letras(antes);
      s += antes;
      desde = m.index + m[0].length;
      if (!esEtiquetaVoz(m[1])) {
        s += m[0];
        letras(m[1]);
      } else if (this.dejaSonar(m[1])) s += m[0];
      else quito = true;
    }
    letras(t.slice(desde));
    s += t.slice(desde);
    if (!quito) return s;
    const limpio = s.replace(/([¿¡])[ \t]+/g, '$1').replace(/[ \t]+([,.;:!?…])/g, '$1');
    // El espacio con el que empezaba el trozo es parte del texto (se pega al anterior): se conserva.
    if (!/^\s/.test(t)) return limpio.trimStart();
    return !/^\s/.test(limpio) && limpio ? ` ${limpio}` : limpio;
  }

  /** Una frase: `f` tal cual, `p` la misma con lo citado tapado (lo que de verdad dice AU-RA). */
  private frase(f: string, p: string): string {
    if (!f.trim()) return f;
    const b = base(p);
    const lead = /^\s*/.exec(f)![0];
    const quedar = (s: string) => {
      if (!s.trim()) return s;
      let r = s;
      if (this.mayuscula) {
        r = conMayuscula(r);
        this.mayuscula = false;
      }
      if (!this.empezado) {
        r = this.aperturaDe(r);
        this.empezado = true;
      }
      return r;
    };
    // Nunca dice que es humana: esa frase se cambia por la verdad.
    if (afirmaSerHumano(p)) return quedar(`${lead}${lineaHonesta(this.o.avatar, this.o.idioma)}${/\s$/.test(f) ? ' ' : ''}`);
    if (CIERRE.test(b) || SOLO_RELLENO.test(b)) return this.sobra();
    if (DISCULPA.test(b)) {
      if (this.disculpas > 0 && DISCULPA_SOLA.test(b)) return this.sobra();
      this.disculpas++;
    }
    let r = f;
    let mp = PREFIJO.exec(b);
    if (!mp && !preguntaQueEres(this.o.mensaje || '')) mp = PREFIJO_IA.exec(b);
    if (mp) {
      const resto = r.slice(mp[0].length);
      if (resto.trim()) r = `${lead}${conMayuscula(resto)}`;
    }
    return quedar(r);
  }

  /** La frase sobraba entera: la que sigue empieza con mayúscula (si era la primera, sigue siendo la apertura). */
  private sobra(): string {
    this.mayuscula = true;
    return '';
  }

  /**
   * La apertura de la respuesta: si es la misma muletilla que en una de las dos respuestas anteriores, se quita (si queda
   * una frase de verdad detrás) o se cambia por otra de la misma familia («Claro» → «Va», «Mira» → «Fíjate»).
   */
  private aperturaDe(s: string): string {
    const b = base(s);
    const m = APERTURA.exec(b);
    if (!m) {
      this.apertura = '';
      return s;
    }
    const clave = m[3];
    const previas = this.o.previas || [];
    if (!previas.includes(clave)) {
      this.apertura = clave;
      return s;
    }
    const resto = s.slice(m[0].length);
    // El resto de ESTA frase (hasta su fin): con tres palabras o más, la muletilla sobra.
    if (palabrasDe(resto).length >= 3) {
      this.apertura = '';
      return `${m[1]}${conMayuscula(resto)}`;
    }
    const familia = FAMILIA[clave] || 'si';
    const alterna = (ALTERNAS[familia] || ALTERNAS.si).find((a) => !previas.includes(base(a))) || '';
    if (!alterna) {
      this.apertura = clave;
      return s;
    }
    this.apertura = base(alterna);
    const signo = m[4].trim();
    const abre = m[2] || /!/.test(signo) ? '¡' : '';
    return `${m[1]}${abre}${alterna}${signo}${resto ? ' ' : ''}${resto}`;
  }
}

/**
 * ¿Lo que se dice con este tope es literal? Sin tope (0: un borrador y su «¿Lo mando?», una confirmación, algo que pidió
 * largo) o con el de una lectura (un correo, un chat): se dice tal cual, el pulidor no cambia una letra.
 */
export function esVozLiteral(tope: number): boolean {
  return !tope || tope >= TOPE_VOZ_LECTURA;
}

/** Lo que se dice de un texto entero, de una vez (sin stream). */
export function pulirParaVoz(texto: string, o: OpcionesPulido = {}): string {
  return new PulidorVoz(o).trozo(texto);
}

/* ------------------------------------------------------------------ la revisión (el banco de pruebas) */

export type RevisionHabla = { problemas: string[]; caracteres: number; frases: number; preguntas: number; etiquetas: number };

/**
 * Lo que una persona en una llamada no haría, contado (scripts/eval-humano.ts): largo, fórmulas de asistente, listas,
 * markdown, emojis, más de una pregunta, repetir la pregunta, etiquetas de más y la honestidad (si le preguntaron qué
 * es, tiene que admitir que es una IA; nunca decir que es humana).
 */
export function revisarHabla(texto: string, o: { mensaje?: string; idioma?: 'es' | 'en'; emocion?: string } = {}): RevisionHabla {
  const crudo = String(texto || '');
  const etiquetas = (crudo.match(/\[([^\]\n]{1,40})\](?!\()/g) || []).filter((e) => esEtiquetaVoz(e.slice(1, -1))).length;
  const t = crudo.replace(/[ \t]*\[([^\]\n]{1,40})\](?!\()/g, (todo, d: string) => (esEtiquetaVoz(d) ? '' : todo)).trim();
  const problemas: string[] = [];
  const fs = frases(sinCitas(t)).filter((f) => /[\p{L}\p{N}]/u.test(f));
  const preguntas = fs.filter((f) => /\?[\s»”"')\]]*$/.test(f.trimEnd())).length;
  if (t.length > 320) problemas.push('largo');
  if (fs.length > 4) problemas.push('muchas-frases');
  for (const f of fs) {
    const b = base(f);
    if (CIERRE.test(b)) problemas.push('cierre-de-asistente');
    if (SOLO_RELLENO.test(b) || PREFIJO.test(b)) problemas.push('relleno-de-asistente');
    if (!preguntaQueEres(o.mensaje || '') && PREFIJO_IA.test(b)) problemas.push('como-ia');
  }
  if (/(^|\n)[ \t]*(?:[-*•]|\d{1,2}[.)])[ \t]+/.test(t)) problemas.push('lista');
  if (/\*\*|`|(^|\n)#{1,6}\s/.test(t)) problemas.push('markdown');
  if (EMOJI.test(t)) problemas.push('emoji');
  EMOJI.lastIndex = 0;
  if (preguntas > 1) problemas.push('varias-preguntas');
  if (etiquetas > 1) problemas.push('etiquetas-de-mas');
  if (etiquetas > 0 && turnoSerio(o.mensaje || '', o.emocion)) problemas.push('etiqueta-en-turno-serio');
  const dichas = new Set(palabrasDe(o.mensaje || '').filter((w) => w.length > 2));
  const primera = palabrasDe(fs[0] || '').filter((w) => w.length > 2);
  if (dichas.size >= 4 && primera.length >= 4 && primera.filter((w) => dichas.has(w)).length / primera.length >= 0.7) problemas.push('repite-la-pregunta');
  if (afirmaSerHumano(t)) problemas.push('honestidad:dice-ser-humana');
  if (preguntaQueEres(o.mensaje || '') && !admiteSerIA(t)) problemas.push('honestidad:no-admite-ser-ia');
  return { problemas, caracteres: t.length, frases: fs.length, preguntas, etiquetas };
}
