/**
 * LA BURBUJA, SU SESIÓN (revisión del dueño al diseño de la burbuja, F06 y §9): un solo dueño del micrófono y del turno,
 * lo que dice cada estado en corto, el indicador del micrófono que dice la verdad, «detener» medido y las marcas de
 * tiempo de cada sesión y cada turno para sacar p50/p95 de las migas.
 *
 *  · Un solo turno vivo: una segunda pulsación del botón (o «detener», o escribir encima) corta el turno y la voz que
 *    hubiera; lo que llegue tarde del turno cortado (una frase, «empezó a sonar», la emoción, el resultado) se tira: cada
 *    turno tiene su generación y solo la vigente cuenta (`SesionBurbuja`).
 *  · Estados con texto corto: iniciando, escuchando, procesando, hablando, esperando revisión, recuperando conexión,
 *    cerrada (`faseBurbuja`). Nada se dice solo con color o movimiento: cada estado tiene su palabra.
 *  · Mientras piensa y habla, la burbuja NO oye (pausa el micrófono, sin «hablarle encima» por ahora): se dice así, y el
 *    indicador del micrófono sale encendido solo si el oído captura de verdad (`indicadorMic`).
 *  · Las marcas (`TrazaBurbuja`): invocación, UI lista, inicio/fin de captura, fin de voz, petición, primer contenido útil,
 *    primer audio, cierre; con reloj monótono y en una miga por turno y otra por sesión (`[traza-burbuja] …`).
 *
 * Sin React Native: se prueba en Node (tests/burbuja-v2.test.ts).
 */
import type { EstadoBurbuja } from './logica';

/* ── lo que dice cada estado ─────────────────────────────────────────────────────────────────── */

export type FaseVisible = {
  /** La palabra corta (siempre hay una: nada se dice solo con color). */
  texto: string;
  /** Una línea más, si hace falta (por qué no oye, qué hacer). */
  detalle: string;
  /** Tono para el punto de color de al lado (el texto ya lo dice). */
  tono: 'activo' | 'trabajo' | 'aviso' | 'apagado';
};

/** Estados de la burbuja además de los de logica.ts: revisión, reconexión y cerrada. */
export type EstadoSesion = EstadoBurbuja | 'revision' | 'reconectando' | 'cerrada';

export function faseBurbuja(e: EstadoSesion, o: { en?: boolean; micSilenciado?: boolean; capturando?: boolean } = {}): FaseVisible {
  const en = !!o.en;
  const t = (es: string, ing: string) => (en ? ing : es);
  switch (e) {
    case 'arrancando':
      return { texto: t('Iniciando…', 'Starting…'), detalle: '', tono: 'trabajo' };
    case 'escuchando':
      if (o.micSilenciado) return { texto: t('Micrófono silenciado', 'Mic muted'), detalle: t('Actívalo o escríbeme.', 'Turn it on or type to me.'), tono: 'apagado' };
      if (o.capturando === false) return { texto: t('Abriendo el micrófono…', 'Opening the mic…'), detalle: '', tono: 'trabajo' };
      return { texto: t('Escuchando', 'Listening'), detalle: '', tono: 'activo' };
    case 'pensando':
      return { texto: t('Procesando…', 'Processing…'), detalle: t('No te oigo mientras pienso.', 'I can’t hear you while I think.'), tono: 'trabajo' };
    case 'hablando':
      return { texto: t('Hablando', 'Speaking'), detalle: t('No te oigo mientras hablo. Toca «Detener» para interrumpir.', 'I can’t hear you while I speak. Tap “Stop” to interrupt.'), tono: 'activo' };
    case 'revision':
      return { texto: t('Esperando revisión', 'Waiting for review'), detalle: t('Esto se revisa en AURA antes de hacerlo.', 'This needs your review in AURA first.'), tono: 'aviso' };
    case 'reconectando':
      return { texto: t('Recuperando conexión…', 'Reconnecting…'), detalle: '', tono: 'aviso' };
    case 'cerrada':
      return { texto: t('Cerrada', 'Closed'), detalle: '', tono: 'apagado' };
    case 'escribiendo':
      return { texto: t('Escribiendo', 'Typing'), detalle: t('El micrófono está en pausa.', 'The mic is paused.'), tono: 'apagado' };
    case 'camara':
      return { texto: t('Cámara', 'Camera'), detalle: t('Apunta y toma la foto.', 'Point and take the photo.'), tono: 'trabajo' };
    case 'sin-sesion':
      return { texto: t('Sin sesión', 'Signed out'), detalle: t('Entra a AURA primero.', 'Sign in to AURA first.'), tono: 'aviso' };
    case 'sin-permiso':
      return { texto: t('Sin micrófono', 'No microphone'), detalle: t('Necesito el permiso del micrófono para escucharte.', 'I need microphone permission to hear you.'), tono: 'aviso' };
    case 'sin-oido':
      return { texto: t('Micrófono ocupado', 'Mic busy'), detalle: t('No pude abrirlo. ¿Otra app lo usa? Puedes escribirme.', 'I couldn’t open it. Is another app using it? You can type.'), tono: 'aviso' };
    case 'ocupada':
      return { texto: t('En llamada', 'On a call'), detalle: t('AURA está en una llamada ahora.', 'AURA is on a call right now.'), tono: 'aviso' };
    case 'error':
      return { texto: t('Algo falló', 'Something failed'), detalle: t('Toca el orbe para intentarlo otra vez, o abre AURA.', 'Tap the orb to try again, or open AURA.'), tono: 'aviso' };
  }
}

/* ── el indicador del micrófono: la verdad, no lo pedido ─────────────────────────────────────── */

export type IndicadorMic = { abierto: boolean; texto: string; etiqueta: string };

/**
 * `capturando`: el oído escucha AHORA (speech.oidoEscuchando, sin pausa). El botón dice lo que pasa y lo que hace:
 * con la persona silenciándolo, «Activar»; capturando, «Silenciar»; en pausa (pensando, hablando, escribiendo) lo dice.
 */
export function indicadorMic(o: { silenciadoPorPersona: boolean; capturando: boolean; pausado: boolean; en?: boolean }): IndicadorMic {
  const t = (es: string, ing: string) => (o.en ? ing : es);
  if (o.silenciadoPorPersona) return { abierto: false, texto: t('Activar', 'Unmute'), etiqueta: t('Micrófono silenciado. Toca para activarlo.', 'Microphone muted. Tap to turn it on.') };
  if (o.pausado) return { abierto: false, texto: t('En pausa', 'Paused'), etiqueta: t('Micrófono en pausa mientras AURA piensa o habla. Toca para silenciarlo.', 'Microphone paused while AURA thinks or speaks. Tap to mute it.') };
  if (!o.capturando) return { abierto: false, texto: t('Silenciar', 'Mute'), etiqueta: t('El micrófono todavía no captura. Toca para silenciarlo.', 'The microphone isn’t capturing yet. Tap to mute it.') };
  return { abierto: true, texto: t('Silenciar', 'Mute'), etiqueta: t('Micrófono escuchando. Toca para silenciarlo.', 'Microphone listening. Tap to mute it.') };
}

/**
 * ¿El turno pidió algo que se revisa en la app? (acciones en pantalla o tareas creadas). La burbuja no lo hace encima de
 * otra app: queda «esperando revisión» y se abre en AURA.
 */
export function pideRevision(r: { acciones?: unknown; tareas?: unknown }): boolean {
  return (Array.isArray(r.acciones) && r.acciones.length > 0) || (Array.isArray(r.tareas) && r.tareas.length > 0);
}

/** ¿Hay algo que detener? (un turno pensando o la voz de AURA sonando). */
export function hayQueDetener(e: EstadoSesion): boolean {
  return e === 'pensando' || e === 'hablando' || e === 'reconectando';
}

/* ── un solo turno vivo ──────────────────────────────────────────────────────────────────────── */

export type MotivoCorte = 'reinvocacion' | 'detener' | 'escribir' | 'camara' | 'orbe' | 'cierre' | 'nuevo-turno';

/**
 * Un solo dueño del turno y de la voz en la burbuja. Cada turno tiene su generación: lo que llegue de una generación
 * cortada se tira (`vigente`). Una segunda pulsación del botón corta el turno y la voz y vuelve a escuchar; NUNCA abre un
 * segundo oído, una segunda voz ni una segunda petición (el oído es uno, prestado; el turno, este).
 */
export class SesionBurbuja {
  private gen = 0;
  private vivo: { gen: number; cancelar: () => void } | null = null;
  private cortes: MotivoCorte[] = [];

  /** Empieza un turno (corta el anterior si seguía). Devuelve su generación. */
  empezarTurno(cancelar: () => void): number {
    if (this.vivo) this.cortar('nuevo-turno');
    const gen = ++this.gen;
    this.vivo = { gen, cancelar };
    return gen;
  }

  /** ¿Lo que trae esta generación todavía cuenta? */
  vigente(gen: number): boolean {
    return !!this.vivo && this.vivo.gen === gen;
  }

  /** ¿Hay un turno vivo? */
  enCurso(): boolean {
    return !!this.vivo;
  }

  /** El turno terminó solo (si es el vigente). */
  terminar(gen: number) {
    if (this.vivo?.gen === gen) this.vivo = null;
  }

  /** Corta el turno vivo (si hay): true si cortó algo. Lo de esa generación ya no cuenta. */
  cortar(motivo: MotivoCorte): boolean {
    const v = this.vivo;
    if (!v) return false;
    this.vivo = null;
    this.gen++;
    this.cortes.push(motivo);
    try {
      v.cancelar();
    } catch {
      /* cortar nunca falla hacia fuera */
    }
    return true;
  }

  /** Para las pruebas y la miga: los cortes que hubo. */
  historialCortes(): readonly MotivoCorte[] {
    return this.cortes;
  }
}

/* ── las marcas de tiempo ────────────────────────────────────────────────────────────────────── */

export const MARCAS = ['invocacion', 'ui-lista', 'captura-inicio', 'captura-fin', 'fin-voz', 'peticion', 'primer-contenido', 'primer-audio', 'fin-turno', 'cierre'] as const;
export type Marca = (typeof MARCAS)[number];

/** El reloj monótono del motor de JS (performance.now en Hermes y en Node); si falta, Date.now. */
export function relojMonotono(): number {
  const p = (globalThis as { performance?: { now?: () => number } }).performance;
  return p && typeof p.now === 'function' ? p.now() : Date.now();
}

/**
 * Las marcas de una sesión de la burbuja (y de cada turno), en ms desde la invocación (la pulsación: el `t` del nativo,
 * en reloj de pared, se lleva al monótono una sola vez al arrancar). Una miga por turno al terminar y una por sesión al
 * cerrar; con ellas se calculan p50/p95 de cada tramo (`percentil`).
 */
export class TrazaBurbuja {
  readonly id: string;
  private cero: number;
  private sesion = new Map<Marca, number>();
  private turno = 0;
  private turnoMarcas = new Map<Marca, number>();

  /**
   * `invocadaEnPared`: la hora de la pulsación (Date.now del nativo), o null. `ahoraPared`: Date.now de este momento.
   */
  constructor(o: { invocadaEnPared: number | null; ahoraPared: number; reloj?: () => number; id?: string }) {
    this.reloj = o.reloj ?? relojMonotono;
    const ahora = this.reloj();
    const atras = o.invocadaEnPared && o.invocadaEnPared <= o.ahoraPared && o.ahoraPared - o.invocadaEnPared < 60_000 ? o.ahoraPared - o.invocadaEnPared : 0;
    this.cero = ahora - atras;
    this.id = o.id ?? Math.floor(Math.random() * 0xffffff).toString(36).padStart(4, '0');
    this.sesion.set('invocacion', 0);
    this.turnoMarcas.set('invocacion', 0);
  }

  private reloj: () => number;

  /** ms desde la invocación. */
  ahora(): number {
    return Math.round(this.reloj() - this.cero);
  }

  /** Una nueva invocación con la burbuja abierta (otra pulsación): su propio cero para los turnos que siguen. */
  reinvocar(invocadaEnPared: number | null, ahoraPared: number) {
    const ahora = this.reloj();
    const atras = invocadaEnPared && invocadaEnPared <= ahoraPared && ahoraPared - invocadaEnPared < 60_000 ? ahoraPared - invocadaEnPared : 0;
    this.cero = ahora - atras;
    this.turnoMarcas.clear();
    this.turnoMarcas.set('invocacion', 0);
  }

  /** Anota una marca (la primera vez cuenta: «primer contenido» es el primero). Devuelve los ms. */
  marcar(m: Marca): number {
    const t = this.ahora();
    if (m === 'ui-lista' || m === 'cierre') {
      if (!this.sesion.has(m)) this.sesion.set(m, t);
    }
    if (!this.turnoMarcas.has(m)) this.turnoMarcas.set(m, t);
    return t;
  }

  /** Empieza un turno nuevo (las marcas de turno empiezan vacías, salvo la captura que ya venía). */
  nuevoTurno(): number {
    const captura = this.turnoMarcas.get('captura-inicio');
    const finVoz = this.turnoMarcas.get('fin-voz');
    const captFin = this.turnoMarcas.get('captura-fin');
    const inv = this.turnoMarcas.get('invocacion');
    this.turnoMarcas = new Map();
    if (inv !== undefined) this.turnoMarcas.set('invocacion', inv);
    if (captura !== undefined) this.turnoMarcas.set('captura-inicio', captura);
    if (captFin !== undefined) this.turnoMarcas.set('captura-fin', captFin);
    if (finVoz !== undefined) this.turnoMarcas.set('fin-voz', finVoz);
    return ++this.turno;
  }

  /**
   * Termina el turno (o se cortó): marca `fin-turno`, devuelve su miga y deja las marcas de turno limpias para la
   * próxima captura (si no, el «fin de voz» del turno siguiente sería el de este).
   */
  finTurno(extra = ''): string {
    this.marcar('fin-turno');
    const linea = this.lineaTurno(extra);
    const inv = this.turnoMarcas.get('invocacion');
    this.turnoMarcas = new Map();
    if (inv !== undefined) this.turnoMarcas.set('invocacion', inv);
    return linea;
  }

  /** La miga del turno: `[traza-burbuja] s=… t=2 peticion=1234 primer-contenido=1800 …` (ms desde la invocación). */
  lineaTurno(extra = ''): string {
    return `[traza-burbuja] s=${this.id} t=${this.turno} ${serializar(this.turnoMarcas)}${extra ? ` ${extra}` : ''}`;
  }

  /** La miga de la sesión (al cerrar). */
  lineaSesion(extra = ''): string {
    return `[traza-burbuja] s=${this.id} sesion ${serializar(this.sesion)} turnos=${this.turno}${extra ? ` ${extra}` : ''}`;
  }

  /** Para las pruebas. */
  valor(m: Marca, deTurno = true): number | undefined {
    return (deTurno ? this.turnoMarcas : this.sesion).get(m);
  }
}

function serializar(m: Map<Marca, number>): string {
  return MARCAS.filter((k) => m.has(k))
    .map((k) => `${k}=${m.get(k)}`)
    .join(' ');
}

/** El percentil `p` (0..100) de unas medidas (vacío → NaN). Para sacar p50/p95 de las migas. */
export function percentil(medidas: readonly number[], p: number): number {
  const v = medidas.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const i = Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1));
  return v[i];
}

/** Lee de una miga `[traza-burbuja]` el valor de una marca (o el tramo `detener→silencio`). */
export function leerMarca(linea: string, clave: string): number | null {
  const m = linea.match(new RegExp(`(?:^|\\s)${clave.replace(/[-→]/g, (c) => `\\${c}`)}=(\\d+)`));
  return m ? Number(m[1]) : null;
}

/* ── detener: de la orden al silencio ────────────────────────────────────────────────────────── */

/** Lo que pide el dueño para «detener»: silencio en ~150 ms p50 y 300 ms p95. */
export const DETENER_P50_MS = 150;
export const DETENER_P95_MS = 300;

/** La miga de un «detener»: cuánto tardó de la orden al silencio efectivo (la voz dejó de sonar). */
export function lineaDetener(id: string, ms: number, motivo: MotivoCorte): string {
  const dentro = ms <= DETENER_P95_MS ? 'ok' : 'lento';
  return `[traza-burbuja] s=${id} detener→silencio=${Math.round(ms)} (${motivo}, ${dentro})`;
}

/* ── el teclado ──────────────────────────────────────────────────────────────────────────────── */

/**
 * Cuánto subir el campo de escribir sobre el teclado. Con `adjustResize` de verdad la ventana ya se encogió (no hay que
 * subir nada); con la app de borde a borde (Android 15) no se encoge y hay que subir lo que mide el teclado.
 */
export function margenTeclado(o: { alturaTeclado: number; altoVentanaSinTeclado: number; altoVentanaAhora: number }): number {
  const encogio = Math.max(0, o.altoVentanaSinTeclado - o.altoVentanaAhora);
  return Math.max(0, Math.round(o.alturaTeclado - encogio));
}
