/**
 * EL NARRADOR DEL TRABAJO (José: «si es trabajo, armar una manera que se sienta que está trabajando, pero que no se
 * note una AI atrás»).
 *
 * Mientras AU-RA hace algo que tarda (buscar en internet, abrir su correo o su WhatsApp, leer una página, su
 * computadora), el servidor manda eventos de PROGRESO tomados de lo que de verdad pasa en el turno (lib/progreso-trabajo.ts:
 * la herramienta empezó, terminó con N resultados, no trajo nada, dejó algo esperando su «sí»). Este módulo los vuelve:
 *  · comentarios hablados cortos, como una asistente que trabaja («Abro tu correo…», «Hay dos de Ana…»), con la forma de
 *    ser del avatar y en su idioma (`Narrador`);
 *  · UNA línea suave de pantalla que se actualiza en su lugar («Buscando en tu correo…» → «Encontré 2 de Ana») y se va
 *    cuando llega la respuesta (`lineaDePantalla`).
 *
 * Reglas (las mismas que el resto del código: nunca prometer ni contar lo que no pasó, lib/cerebro-manos.ts):
 *  · nada antes de que la herramienta EMPIECE: «estoy buscando…» solo después de `empece`; «no aparece…» solo con `nada`;
 *    «hay dos…» solo con `encontre` y su número real. Sin evento no hay comentario (ni «ya casi»);
 *  · el primero, a PASO_NARRADOR.primeraMs de empezar la herramienta (≤ 700 ms) si la respuesta no llegó antes;
 *  · después, como mucho uno cada 3,5–5 s mientras sigue el trabajo, y como mucho `maxPorTurno` por turno;
 *  · nunca la misma frase dentro de la ventana de la sesión (`MemoriaNarrador`): sin frase nueva, se calla;
 *  · nunca encima de la respuesta: `alRespuesta()` cancela lo pendiente y apaga el turno;
 *  · `espera_ok` no se narra: lo pide la respuesta y aparece la ventana de decisión (la que ya existe).
 *
 * Puro (sin React Native ni red): lo usan el teléfono (DeskScreen), la voz del servidor (server/voz-agente.ts), la web
 * (solo la línea) y las pruebas (tests/narrador-trabajo.test.ts), con el reloj inyectado.
 */

export const FASES_PROGRESO = ['empece', 'paso', 'encontre', 'nada', 'espera_ok', 'listo'] as const;
export type FaseProgreso = (typeof FASES_PROGRESO)[number];

/**
 * Lo que viaja de cada herramienta: una CATEGORÍA pública, nunca el nombre interno ni sus argumentos. `trabajo` es lo
 * demás (sus misiones, su círculo, el estado del sistema…).
 */
export const HERRAMIENTAS_PROGRESO = ['web', 'leer', 'correo', 'whatsapp', 'computadora', 'trabajo'] as const;
export type HerramientaProgreso = (typeof HERRAMIENTAS_PROGRESO)[number];

/**
 * Un evento de progreso (`event: progreso` en el SSE de /api/turno/stream y en el turno de la voz).
 *  · `detalle_seguro`: a lo más un tema corto y saneado («Ana», «factura de luz»), solo para la dueña (nunca en modo
 *    invitado), nunca el texto de un borrador ni de un mensaje;
 *  · `n`: cuántos de verdad (resultados, correos, chats), solo si la herramienta lo dijo.
 */
export type EventoProgreso = { fase: FaseProgreso; herramienta: HerramientaProgreso; detalle_seguro?: string; n?: number; ronda?: number };

/** El detalle, otra vez saneado del lado de quien lo enseña o lo dice (un servidor viejo o raro no mete nada). */
export function limpiarDetalle(x: unknown): string {
  const t = String(x ?? '')
    .replace(/[\u0000-\u001f<>{}\[\]"«»`\\|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || /@|https?:|www\.|\d{3,}/i.test(t)) return '';
  return t.length > 40 ? `${t.slice(0, 39).trim()}…` : t;
}

/** Lo que llegó por el SSE, validado: null si no es un evento de progreso (un cliente nunca confía a ciegas). */
export function eventoProgresoValido(x: unknown): EventoProgreso | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const fase = String(o.fase || '') as FaseProgreso;
  const herramienta = String(o.herramienta || '') as HerramientaProgreso;
  if (!FASES_PROGRESO.includes(fase) || !HERRAMIENTAS_PROGRESO.includes(herramienta)) return null;
  const d = limpiarDetalle(o.detalle_seguro);
  const n = typeof o.n === 'number' && Number.isInteger(o.n) && o.n >= 0 && o.n < 10_000 ? o.n : undefined;
  const ronda = typeof o.ronda === 'number' && Number.isInteger(o.ronda) && o.ronda > 0 && o.ronda < 10 ? o.ronda : undefined;
  return { fase, herramienta, ...(d ? { detalle_seguro: d } : {}), ...(n !== undefined ? { n } : {}), ...(ronda ? { ronda } : {}) };
}

/* ------------------------------------------------------------------ la línea de pantalla */

/**
 * La línea suave de la mesa: dice lo que está pasando AHORA, en su lugar (no es un registro). '' = no se enseña nada
 * (`listo`: la respuesta ya viene).
 */
export function lineaDePantalla(ev: EventoProgreso, idioma: 'es' | 'en' = 'es'): string {
  const en = idioma === 'en';
  const d = limpiarDetalle(ev.detalle_seguro);
  const n = ev.n;
  switch (ev.fase) {
    case 'empece':
      switch (ev.herramienta) {
        case 'web':
          return d ? (en ? `Searching «${d}»…` : `Buscando «${d}»…`) : en ? 'Searching the web…' : 'Buscando en internet…';
        case 'leer':
          return en ? 'Reading the page…' : 'Leyendo la página…';
        case 'correo':
          return d ? (en ? `Looking for ${d} in your email…` : `Buscando lo de ${d} en tu correo…`) : en ? 'Checking your email…' : 'Revisando tu correo…';
        case 'whatsapp':
          return d ? (en ? `Looking for ${d} in your messages…` : `Buscando lo de ${d} en tus mensajes…`) : en ? 'Checking your messages…' : 'Revisando tus mensajes…';
        case 'computadora':
          return en ? 'Working on my computer…' : 'Trabajando en mi computadora…';
        default:
          return en ? 'Checking…' : 'Revisando…';
      }
    case 'encontre': {
      if (n === undefined) return en ? 'Found it' : 'Ya lo tengo';
      const de = d ? (en ? ` from ${d}` : ` de ${d}`) : '';
      if (ev.herramienta === 'web') return en ? `Found ${n} result${n === 1 ? '' : 's'}` : `Encontré ${n} resultado${n === 1 ? '' : 's'}`;
      return en ? `Found ${n}${de}` : `Encontré ${n}${de}`;
    }
    case 'nada':
      return d ? (en ? `Nothing from ${d}` : `No aparece nada de ${d}`) : en ? 'Nothing shows up' : 'No aparece nada';
    case 'paso':
      if (ev.herramienta === 'leer') return en ? 'Page open, reading…' : 'Ya la abrí, leyendo…';
      if (ev.herramienta === 'computadora') return en ? 'Still going on my computer…' : 'Sigue en mi computadora…';
      return en ? 'Checked, putting it together…' : 'Ya lo revisé, armando la respuesta…';
    case 'espera_ok':
      return en ? 'Waiting for your OK' : 'Esperando tu visto bueno';
    case 'listo':
      return '';
  }
}

/* ------------------------------------------------------------------ las frases */

export type AvatarNarrador = 'ojos' | 'aura' | 'claudio' | 'antonio';
type Banco = { es: readonly string[]; en: readonly string[] };
/**
 * La clave de cada banco: `<momento>:<herramienta>` (o `<momento>:*`, para todas). Los momentos: `empece` y `empece_d`
 * (con tema), `encontre1`/`encontreN` (con `_d`) y `encontre` (sin número), `nada` (con `_d`), `paso`, `seguir` (la
 * herramienta sigue corriendo) y `cerrando` (ya terminó con resultados y la respuesta todavía no empieza).
 * `{d}` es el tema y `{n}` el número.
 */
type Clave = string;

const BASE: Record<Clave, Banco> = {
  'empece:web': {
    es: ['Déjame buscarlo en internet…', 'A ver, lo busco…', 'Ya lo estoy buscando…', 'Dame un toque, lo busco…', 'Lo busco ahorita…', 'Buscándolo, un momentito…'],
    en: ['Let me look it up…', 'Okay, searching…', "I'm looking it up now…", 'Give me a sec, searching…', 'On it, searching…', 'Searching, one moment…'],
  },
  'empece:leer': {
    es: ['Abro la página…', 'Déjame leerla…', 'Ya la estoy abriendo…', 'A ver qué dice la página…'],
    en: ['Opening the page…', 'Let me read it…', "I'm opening it now…", "Let's see what the page says…"],
  },
  'empece:correo': {
    es: ['Abro tu correo…', 'Déjame ver tu correo…', 'Ya entro a tu correo…', 'A ver tu bandeja…'],
    en: ['Opening your email…', 'Let me check your email…', "I'm getting into your inbox…", "Let's see your inbox…"],
  },
  'empece_d:correo': {
    es: ['Busco lo de {d} en tu correo…', 'A ver qué hay de {d} en tu correo…', 'Déjame buscar lo de {d}…'],
    en: ['Looking for {d} in your email…', "Let's see what there is from {d}…", 'Let me find the {d} one…'],
  },
  'empece:whatsapp': {
    es: ['Reviso tu WhatsApp…', 'Déjame ver tus mensajes…', 'Ya abro tus mensajes…', 'A ver tus chats…'],
    en: ['Checking your WhatsApp…', 'Let me see your messages…', "I'm opening your messages…", "Let's see your chats…"],
  },
  'empece_d:whatsapp': {
    es: ['Busco lo de {d} en tus mensajes…', 'A ver qué hay de {d} en tus chats…'],
    en: ['Looking for {d} in your messages…', "Let's see what there is about {d} in your chats…"],
  },
  'empece:computadora': {
    es: ['Me pongo con eso en mi computadora…', 'Lo hago en mi computadora, dame un rato…', 'Ya lo estoy haciendo en mi computadora…', 'Va, lo trabajo en mi computadora…'],
    en: ["I'm getting on it on my computer…", "I'll do it on my computer, give me a bit…", "I'm doing it on my computer now…", 'Okay, working on it on my computer…'],
  },
  'empece:trabajo': {
    es: ['Déjame revisarlo…', 'Ya lo veo…', 'A ver, lo reviso…', 'Lo reviso ahorita…'],
    en: ['Let me check…', "I'm on it…", 'Okay, checking…', 'Checking right now…'],
  },
  'encontre:web': {
    es: ['Ya, encontré algo…', 'Aquí hay algo, déjame ver…', 'Ya tengo resultados…', 'Ya salió algo…'],
    en: ['Okay, found something…', "Here's something, let me see…", 'Got some results…', 'Something came up…'],
  },
  'encontre1:*': { es: ['Ya, hay uno…', 'Encontré uno…'], en: ["Okay, there's one…", 'Found one…'] },
  'encontre1_d:*': { es: ['Hay uno de {d}…', 'Ya, encontré uno de {d}…'], en: ["There's one from {d}…", 'Okay, found one from {d}…'] },
  'encontreN:*': { es: ['Hay {n}, déjame ver…', 'Encontré {n}…', 'Ya, son {n}…'], en: ['There are {n}, let me see…', 'Found {n}…', "Okay, that's {n}…"] },
  'encontreN_d:*': { es: ['Hay {n} de {d}…', 'Encontré {n} de {d}, a ver…'], en: ['There are {n} from {d}…', 'Found {n} from {d}, let me see…'] },
  'encontre:*': { es: ['Ya, aquí está…', 'Ya lo tengo…'], en: ["Okay, here it is…", 'Got it…'] },
  'nada:web': { es: ['Mmm, no aparece nada con eso…', 'No sale nada por ahí…'], en: ['Hmm, nothing comes up for that…', 'Nothing shows up there…'] },
  'nada:correo': { es: ['No veo nada en tu correo…', 'Por ahí no aparece nada…'], en: ["I don't see anything in your email…", 'Nothing shows up there…'] },
  'nada_d:correo': { es: ['No veo nada de {d} en tu correo…', 'De {d} no aparece nada…'], en: ["I don't see anything from {d} in your email…", 'Nothing from {d} shows up…'] },
  'nada:whatsapp': { es: ['No veo nada en tus mensajes…', 'En tus chats no aparece nada…'], en: ["I don't see anything in your messages…", 'Nothing shows up in your chats…'] },
  'nada_d:whatsapp': { es: ['No veo nada de {d} en tus mensajes…', 'De {d} no aparece nada en tus chats…'], en: ["I don't see anything about {d} in your messages…", 'Nothing about {d} in your chats…'] },
  'nada:*': { es: ['No aparece nada…', 'Mmm, por ahí no hay nada…'], en: ['Nothing shows up…', "Hmm, there's nothing there…"] },
  'paso:leer': { es: ['Ya la abrí, la estoy leyendo…', 'Ya entré, leyendo…'], en: ["It's open, I'm reading it…", "I'm in, reading…"] },
  'paso:computadora': { es: ['Mi computadora sigue con eso…', 'Eso sigue en mi computadora…'], en: ['My computer is still on it…', "That's still going on my computer…"] },
  'paso:*': { es: ['Ya lo revisé, te digo…', 'Ya lo vi…'], en: ['Checked, I’ll tell you…', 'I saw it…'] },
  'seguir:web': { es: ['Sigo buscando…', 'Todavía buscando…', 'Aquí sigo, buscando…'], en: ['Still searching…', 'Still looking…', "I'm still on it, searching…"] },
  'seguir:leer': { es: ['Sigo leyendo…', 'Todavía leyendo…'], en: ['Still reading…', 'Still going through it…'] },
  'seguir:correo': { es: ['Sigo revisando tu correo…', 'Todavía en tu correo…'], en: ['Still checking your email…', 'Still in your inbox…'] },
  'seguir:whatsapp': { es: ['Sigo con tus mensajes…', 'Todavía revisando tus chats…'], en: ['Still on your messages…', 'Still checking your chats…'] },
  'seguir:computadora': { es: ['Sigo en eso…', 'Mi computadora todavía está en eso…', 'Aquí sigo, trabajando…'], en: ['Still on it…', 'My computer is still working on it…', "I'm still working…"] },
  'seguir:*': { es: ['Sigo en eso…', 'Todavía revisando…'], en: ['Still on it…', 'Still checking…'] },
  'cerrando:*': { es: ['Ya, te cuento…', 'Aquí está…', 'Ya lo tengo, te digo…'], en: ["Okay, here's what I found…", 'Here it is…', "Got it, I'll tell you…"] },
};

/**
 * La forma de ser de cada uno (la misma de compa/frasesEstado.ts): el Guardián, sereno y breve (solo las suyas);
 * Claudio, el zorro curioso; ANT-ONIO, la hormiga de cuatro brazos. AU-RA usa la base (cálida, «un toque», «ahorita»).
 */
const PROPIAS: Partial<Record<AvatarNarrador, Record<Clave, Banco>>> = {
  ojos: {
    'empece:web': { es: ['Lo busco.', 'Buscando.', 'Un momento, lo busco.'], en: ["I'll look it up.", 'Searching.', 'One moment, searching.'] },
    'empece:correo': { es: ['Reviso tu correo.', 'Abro tu correo.'], en: ['Checking your email.', 'Opening your email.'] },
    'empece:whatsapp': { es: ['Reviso tus mensajes.', 'Abro tus mensajes.'], en: ['Checking your messages.', 'Opening your messages.'] },
    'seguir:*': { es: ['Sigo en ello.', 'Continúo.'], en: ['Still on it.', 'Continuing.'] },
  },
  claudio: {
    'empece:web': { es: ['Voy a husmear un poquito en internet…', 'Olfateando la pista…'], en: ["I'll sniff around online a bit…", 'Following the scent…'] },
    'seguir:web': { es: ['Sigo olfateando…', 'La pista sigue, no la suelto…'], en: ['Still sniffing around…', 'Still on the trail…'] },
    'encontre:web': { es: ['¡Ajá! Algo encontré…', 'La nariz no falla, aquí hay algo…'], en: ['Aha! Found something…', 'The nose never fails, here’s something…'] },
  },
  antonio: {
    'empece:web': { es: ['¡Cuatro brazos buscando!', 'Buscando a toda máquina…'], en: ['Four arms searching!', 'Searching full speed…'] },
    'empece:computadora': { es: ['¡Manos a la obra en mi computadora!', 'Con los cuatro brazos en la compu…'], en: ['Getting to work on my computer!', 'All four arms on the computer…'] },
    'seguir:*': { es: ['¡No aflojo, sigo!', 'Sigo dándole…'], en: ['Not slowing down!', 'Still at it…'] },
  },
};

/** Las frases candidatas de un momento, con las del avatar primero (el Guardián, solo las suyas si tiene). */
export function frasesNarrador(momento: string, herramienta: HerramientaProgreso, avatar: string = 'aura', idioma: 'es' | 'en' = 'es'): string[] {
  const a = (['ojos', 'aura', 'claudio', 'antonio'] as const).includes(avatar as AvatarNarrador) ? (avatar as AvatarNarrador) : 'aura';
  const i = idioma === 'en' ? 'en' : 'es';
  const prop = PROPIAS[a] || {};
  const propias = [...(prop[`${momento}:${herramienta}`]?.[i] || []), ...(prop[`${momento}:*`]?.[i] || [])];
  const base = [...(BASE[`${momento}:${herramienta}`]?.[i] || []), ...(BASE[`${momento}:*`]?.[i] || [])];
  if (a === 'ojos' && propias.length) return [...new Set(propias)];
  return [...new Set([...propias, ...base])];
}

/* ------------------------------------------------------------------ la memoria de la sesión */

/**
 * Lo que se dijo en esta sesión (la conversación o la mesa): ninguna frase se repite dentro de la ventana. Se guarda la
 * PLANTILLA («Hay {n} de {d}…»), no el texto ya armado: «Hay 2 de Ana» y luego «Hay 3 de Beto» suenan a lo mismo.
 */
export class MemoriaNarrador {
  private dichas: string[] = [];
  constructor(private tope = 24) {}
  ha(plantilla: string): boolean {
    return this.dichas.includes(plantilla);
  }
  anotar(plantilla: string) {
    this.dichas = [...this.dichas.filter((x) => x !== plantilla), plantilla].slice(-this.tope);
  }
  get recientes(): readonly string[] {
    return this.dichas;
  }
}

/* ------------------------------------------------------------------ el ritmo */

export const PASO_NARRADOR = {
  /** El primero, desde que la herramienta empezó (≤ primeraMaxMs). */
  primeraMs: 400,
  primeraMaxMs: 700,
  /** Lo menos entre dos comentarios (de quien sea: la frase de espera o lo que dijo el cerebro también cuentan). */
  cadaMinMs: 3_500,
  /** «Sigo…» si no pasó nada en este rato y el trabajo sigue. */
  seguirMs: 5_000,
  /** Lo que se espera tras un `encontre`/`paso` (la respuesta suele llegar enseguida: si llega, no se dice). */
  encontreMs: 300,
  /** Tras un `nada`, más: la respuesta honesta («no lo encontré») casi siempre llega antes y lo dice ella. */
  nadaMs: 1_200,
  maxPorTurno: 4,
};
export type TiemposNarrador = typeof PASO_NARRADOR;

type Pendiente = { momento: 'empece' | 'encontre' | 'nada' | 'paso'; ev: EventoProgreso; en: number };

/**
 * Decide QUÉ decir y CUÁNDO a partir de los eventos reales del turno. No tiene relojes propios: quien lo usa le pregunta
 * `proximo()` (cuándo volver a mirar) y `tomar(ahora)` (lo que toca decir ahora, o null). `ConductorNarrador` lo hace
 * con setTimeout.
 */
export class Narrador {
  private activo = false;
  private respondio = false;
  private ultimoDicho = Number.NEGATIVE_INFINITY;
  private ultimoEvento = 0;
  private dichos = 0;
  /** La herramienta que está corriendo ahora (empezó y no terminó). */
  private enCurso: HerramientaProgreso | null = null;
  private ultimaHerramienta: HerramientaProgreso = 'trabajo';
  private pendiente: Pendiente | null = null;
  private encontrado = false;
  private huboNada = false;
  private cerrandoDicho = false;
  readonly memoria: MemoriaNarrador;
  private t: TiemposNarrador;

  constructor(private o: { avatar?: string; idioma?: 'es' | 'en'; memoria?: MemoriaNarrador; tiempos?: Partial<TiemposNarrador>; azar?: () => number } = {}) {
    this.memoria = o.memoria || new MemoriaNarrador();
    this.t = { ...PASO_NARRADOR, ...(o.tiempos || {}) };
  }

  /** Un turno nuevo: se olvida lo del turno (la memoria de frases de la sesión queda). */
  nuevoTurno() {
    this.activo = false;
    this.respondio = false;
    this.ultimoDicho = Number.NEGATIVE_INFINITY;
    this.ultimoEvento = 0;
    this.dichos = 0;
    this.enCurso = null;
    this.pendiente = null;
    this.encontrado = false;
    this.huboNada = false;
    this.cerrandoDicho = false;
  }

  /** Algo ya sonó (la frase de espera, lo que dijo el cerebro antes de la herramienta): cuenta para el ritmo. */
  yaSeDijo(ahora: number) {
    this.ultimoDicho = Math.max(this.ultimoDicho, ahora);
  }

  /** Lo pendiente no se pudo decir ahora (sonaba otra cosa): se tira; lo siguiente espera su ritmo. */
  soltarPendiente(ahora: number) {
    this.pendiente = null;
    this.ultimoEvento = Math.max(this.ultimoEvento, ahora);
  }

  /** La respuesta empezó (o el turno terminó): desde aquí, ni una palabra más del narrador en este turno. */
  alRespuesta() {
    this.respondio = true;
    this.pendiente = null;
  }

  get respondida(): boolean {
    return this.respondio;
  }

  alEvento(ev: EventoProgreso, ahora: number) {
    if (this.respondio) return;
    this.activo = true;
    this.ultimoEvento = ahora;
    this.ultimaHerramienta = ev.herramienta;
    const trasRitmo = (ms: number) => Math.max(ahora + ms, this.ultimoDicho + this.t.cadaMinMs);
    switch (ev.fase) {
      case 'empece':
        this.enCurso = ev.herramienta;
        // El primero sale enseguida; uno de otra ronda (buscar → leer la página), con su ritmo.
        this.pendiente = { momento: 'empece', ev, en: this.dichos === 0 && this.ultimoDicho === Number.NEGATIVE_INFINITY ? ahora + this.t.primeraMs : trasRitmo(this.t.primeraMs) };
        break;
      case 'encontre':
        this.enCurso = null;
        this.encontrado = true;
        this.pendiente = { momento: 'encontre', ev, en: trasRitmo(this.t.encontreMs) };
        break;
      case 'nada':
        this.enCurso = null;
        this.huboNada = true;
        this.pendiente = { momento: 'nada', ev, en: trasRitmo(this.t.nadaMs) };
        break;
      case 'paso':
        // Su computadora sigue trabajando en segundo plano: el trabajo no terminó.
        this.enCurso = ev.herramienta === 'computadora' ? 'computadora' : null;
        this.pendiente = { momento: 'paso', ev, en: trasRitmo(this.t.encontreMs) };
        break;
      case 'espera_ok':
        // Lo pide la respuesta (y la ventana de decisión): el narrador no lo adelanta.
        this.enCurso = null;
        this.pendiente = null;
        this.cerrandoDicho = true;
        break;
      case 'listo':
        this.enCurso = null;
        // «Lo busco…» cuando ya terminó, no: llegaría tarde.
        if (this.pendiente?.momento === 'empece') this.pendiente = null;
        break;
    }
  }

  /** Cuándo volver a mirar (ms del mismo reloj), o null si no hay nada que decir en este turno. */
  proximo(): number | null {
    if (!this.activo || this.respondio || this.dichos >= this.t.maxPorTurno) return null;
    if (this.pendiente) return this.pendiente.en;
    const base = Math.max(this.ultimoDicho, this.ultimoEvento) + this.t.seguirMs;
    if (this.enCurso) return base;
    if (this.encontrado && !this.huboNada && !this.cerrandoDicho) return base;
    return null;
  }

  /** Lo que toca decir AHORA, o null. Lo que devuelve ya cuenta como dicho. */
  tomar(ahora: number): string | null {
    if (!this.activo || this.respondio || this.dichos >= this.t.maxPorTurno) return null;
    const p = this.pendiente;
    if (p) {
      if (ahora < p.en) return null;
      this.pendiente = null;
      return this.decir(this.momentoDe(p), p.ev, ahora);
    }
    const quieto = Math.max(this.ultimoDicho, this.ultimoEvento) + this.t.seguirMs;
    if (ahora < quieto) return null;
    if (this.enCurso) {
      const h = this.enCurso;
      const t = this.decir('seguir', { fase: 'paso', herramienta: h }, ahora);
      // Sin frase nueva no se insiste en cada vuelta: el siguiente intento, en otro rato.
      if (!t) this.ultimoEvento = ahora;
      return t;
    }
    if (this.encontrado && !this.huboNada && !this.cerrandoDicho) {
      this.cerrandoDicho = true;
      return this.decir('cerrando', { fase: 'encontre', herramienta: this.ultimaHerramienta }, ahora);
    }
    return null;
  }

  /** El banco que corresponde: con número y tema solo si el evento los trae de verdad. */
  private momentoDe(p: Pendiente): string {
    const d = limpiarDetalle(p.ev.detalle_seguro);
    if (p.momento === 'encontre') {
      const n = p.ev.n;
      // Una búsqueda en internet siempre trae «varios»: el número no dice nada al oído.
      if (n === undefined || p.ev.herramienta === 'web') return 'encontre';
      if (n === 0) return 'nada';
      return `${n === 1 ? 'encontre1' : 'encontreN'}${d ? '_d' : ''}`;
    }
    if ((p.momento === 'empece' || p.momento === 'nada') && d && (p.ev.herramienta === 'correo' || p.ev.herramienta === 'whatsapp')) return `${p.momento}_d`;
    return p.momento;
  }

  private decir(momento: string, ev: EventoProgreso, ahora: number): string | null {
    const lista = frasesNarrador(momento, ev.herramienta, this.o.avatar, this.o.idioma);
    const libres = lista.filter((f) => !this.memoria.ha(f));
    if (!libres.length) return null;
    const azar = this.o.azar || Math.random;
    const plantilla = libres[Math.floor(azar() * libres.length) % libres.length];
    const d = limpiarDetalle(ev.detalle_seguro);
    if (/\{d\}/.test(plantilla) && !d) return null;
    if (/\{n\}/.test(plantilla) && ev.n === undefined) return null;
    this.memoria.anotar(plantilla);
    this.dichos++;
    this.ultimoDicho = ahora;
    return plantilla.replace(/\{d\}/g, d).replace(/\{n\}/g, String(ev.n ?? ''));
  }
}

/* ------------------------------------------------------------------ el que lo hace sonar a tiempo */

type RelojConductor = {
  ahora?: () => number;
  setTimeout?: (f: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
};

/**
 * Le pone relojes al narrador: con cada evento mira cuándo toca hablar, y a esa hora dice lo que toque si `puede()`
 * (nada más está sonando y la respuesta no empezó). Si no puede, lo pendiente se tira (no se dice tarde).
 */
export class ConductorNarrador {
  private h: unknown = null;
  constructor(
    readonly narrador: Narrador,
    private o: { decir: (texto: string) => void; puede?: () => boolean } & RelojConductor
  ) {}

  private get ahora() {
    return (this.o.ahora || Date.now)();
  }

  nuevoTurno() {
    this.parar();
    this.narrador.nuevoTurno();
  }

  evento(ev: EventoProgreso) {
    this.narrador.alEvento(ev, this.ahora);
    this.programar();
  }

  /** Sonó otra cosa (relleno, texto del cerebro antes de la herramienta). */
  yaSeDijo() {
    this.narrador.yaSeDijo(this.ahora);
    this.programar();
  }

  /** La respuesta empezó o el turno terminó. */
  respuesta() {
    this.narrador.alRespuesta();
    this.parar();
  }

  parar() {
    if (this.h !== null) (this.o.clearTimeout || ((x: unknown) => clearTimeout(x as ReturnType<typeof setTimeout>)))(this.h);
    this.h = null;
  }

  private programar() {
    this.parar();
    const p = this.narrador.proximo();
    if (p === null) return;
    const st = this.o.setTimeout || ((f: () => void, ms: number) => setTimeout(f, ms));
    this.h = st(() => {
      this.h = null;
      const ahora = this.ahora;
      if (this.o.puede && !this.o.puede()) {
        this.narrador.soltarPendiente(ahora);
      } else {
        const t = this.narrador.tomar(ahora);
        if (t) {
          try {
            this.o.decir(t);
          } catch {
            /* quien habla no rompe al narrador */
          }
        }
      }
      this.programar();
    }, Math.max(0, p - this.ahora));
  }
}
