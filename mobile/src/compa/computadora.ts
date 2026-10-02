/**
 * SU COMPUTADORA EN LA APP (la lógica, sin React Native): qué decir del estado de la computadora en la
 * nube del avatar (server/computadora.ts) y cada cuánto preguntar.
 *
 * José (2-oct): «le dimos una computadora pero no logro ver lo que hace ni nada, ni cómo usarla». La
 * app no la mostraba en ningún lado. Ahora: «Más → Su computadora» (ajustes/Computadora.tsx) con lo
 * que está viendo, cada paso en palabras, el resultado y el botón de parar; y en la mesa un aviso
 * mientras trabaja (DeskScreen), con «Ver».
 *
 * José (2-oct, tarde: «copiemos cómo lo hacen Grok, el agente de ChatGPT»): como un agente tipo Operator, la
 * vista muestra el PLAN que se va marcando, el tiempo, Detener / Pausar / Tomar el control (si su servicio
 * lo sabe: `controlesPc`), la pregunta antes de algo sensible con Sí / No, la tarjeta del resultado para
 * compartir (`textoParaCompartir`) y el historial de sus misiones.
 */

/**
 * Los estados de una tarea. `pausada`, `confirmar` (espera tu sí antes de algo sensible) y `control` (la
 * tienes tú) son del servicio nuevo de la computadora: la tarea sigue viva, pero quieta.
 */
export type EstadoTareaPc = 'en_cola' | 'trabajando' | 'pausada' | 'confirmar' | 'control' | 'hecha' | 'parada' | 'sin_pasos' | 'fallo';

export type PasoPc = { n: number; t: number; accion: string; texto?: string; miniatura?: string | null };
export type TareaPc = { id: string; instruccion: string; estado: EstadoTareaPc; pasos: PasoPc[]; respuesta: string | null; error: string | null; segundos: number; pregunta?: string | null };
export type ResumenPc = { id: string; estado: EstadoTareaPc; pasos: number; instruccion: string; ultimo: string | null };
/** Una misión de su historial (server/computadora.ts, historialDe). */
export type ItemHistorialPc = { id: string; tareaId: string; instruccion: string; estado: EstadoTareaPc; ok: boolean | null; inicio: number; segundos: number; resultado: string | null };
export type CapacidadPc = 'pausar' | 'confirmar' | 'control';
export type EstadoPc = {
  configurada: boolean;
  ok: boolean;
  motores: string[];
  ocupada: boolean;
  ultima: string | null;
  actual: ResumenPc | null;
  detalle?: string;
  /** Lo que sabe su servicio además de detener (un servicio viejo: nada). */
  capacidades?: CapacidadPc[];
  historial?: ItemHistorialPc[];
};
/** Cómo va cada paso del plan, y la tarjeta del final (server/computadora.ts, vistaMision). */
export type EstadoPlanPc = 'hecho' | 'actual' | 'espera' | 'pendiente' | 'fallo';
export type FinalPc = {
  estado: EstadoTareaPc;
  ok: boolean;
  texto: string;
  respuesta: string | null;
  error: string | null;
  enlaces: string[];
  datos: { clave: string; valor: string }[];
  captura: string | null;
  segundos: number;
  pasos: number;
};
export type MisionPc = {
  id: string;
  instruccion: string;
  plan: { texto: string; estado: EstadoPlanPc }[];
  inicio: number;
  transcurrido: number;
  vuelta: number;
  tareaId: string;
  pregunta: string | null;
  final: FinalPc | null;
  puedeSeguir: boolean;
};

/** Viva: no terminó (trabajando, en fila, en pausa, esperando tu sí o contigo al mando). */
export const trabajando = (e: EstadoTareaPc | null | undefined) => e === 'en_cola' || e === 'trabajando' || e === 'pausada' || e === 'confirmar' || e === 'control';
/** Avanzando sola (suena el tecleo). */
export const enMarcha = (e: EstadoTareaPc | null | undefined) => e === 'en_cola' || e === 'trabajando';
/** Viva pero quieta: en pausa, esperando tu sí o la tienes tú. */
export const quieta = (e: EstadoTareaPc | null | undefined): e is 'pausada' | 'confirmar' | 'control' => e === 'pausada' || e === 'confirmar' || e === 'control';

/** Cada cuánto se pregunta: rápido mientras trabaja (se ve avanzar), lento si no hace nada. */
export function sondeoMs(e: EstadoTareaPc | null | undefined, abierta: boolean): number {
  if (trabajando(e)) return abierta ? 2500 : 8000;
  return abierta ? 8000 : 20000;
}

/** La línea de arriba: cómo está la computadora. */
export function estadoEnPalabras(s: EstadoPc | null, idioma: 'es' | 'en' = 'es'): { texto: string; tono: 'bien' | 'trabaja' | 'mal' | 'espera' } {
  const en = idioma === 'en';
  if (!s) return { texto: en ? 'Checking…' : 'Revisando…', tono: 'espera' };
  if (!s.configurada) return { texto: en ? 'Not set up on the server yet' : 'Todavía no está conectada en el servidor', tono: 'mal' };
  if (!s.ok) return { texto: en ? 'Not answering right now (it may be off)' : 'No contesta ahora (puede estar apagada)', tono: 'mal' };
  if (s.actual?.estado === 'confirmar') return { texto: en ? 'Waiting for your OK' : 'Espera tu sí', tono: 'espera' };
  if (s.actual?.estado === 'pausada') return { texto: en ? 'Paused' : 'En pausa', tono: 'espera' };
  if (s.actual?.estado === 'control') return { texto: en ? 'You have control' : 'La tienes tú', tono: 'espera' };
  if (trabajando(s.actual?.estado)) return { texto: en ? 'Working on your task' : 'Trabajando en tu encargo', tono: 'trabaja' };
  if (s.ocupada) return { texto: en ? 'Busy with another task' : 'Ocupada con otro encargo', tono: 'trabaja' };
  return { texto: en ? 'Ready' : 'Lista para trabajar', tono: 'bien' };
}

/** Lo que dice la tarjeta de la tarea, según cómo terminó (o en qué va). */
export function tareaEnPalabras(t: Pick<TareaPc, 'estado' | 'pasos' | 'error'>, idioma: 'es' | 'en' = 'es'): string {
  const en = idioma === 'en';
  const hechos = t.pasos.filter((p) => p.accion !== 'escritorio_limpio' && p.accion !== 'answer').length;
  const ultimo = t.pasos[t.pasos.length - 1];
  switch (t.estado) {
    case 'en_cola':
      return en ? 'In line: it starts in a moment' : 'En fila: empieza en un momento';
    case 'trabajando':
      return ultimo?.texto ? `${en ? 'Step' : 'Paso'} ${hechos || 1} · ${ultimo.texto}` : en ? 'Starting…' : 'Empezando…';
    case 'pausada':
      return en ? 'Paused: it continues when you say' : 'En pausa: sigue cuando le digas';
    case 'confirmar':
      return en ? 'Waiting for your OK before going on' : 'Espera tu sí para seguir';
    case 'control':
      return en ? 'You have control: it waits for you' : 'La tienes tú: te espera';
    case 'hecha':
      return en ? `Done in ${hechos} steps` : `Lista en ${hechos} pasos`;
    case 'parada':
      return en ? 'You stopped it' : 'La paraste';
    case 'sin_pasos':
      return en ? `It didn’t finish in ${hechos} steps` : `No terminó en ${hechos} pasos`;
    default:
      return en ? `It failed: ${t.error || 'no details'}` : `Falló: ${t.error || 'sin detalle'}`;
  }
}

/** Para empezar: encargos que la computadora sabe hacer bien (y que muestran cómo pedir). */
export const EJEMPLOS_PC: { es: string; en: string }[] = [
  { es: 'Entra a es.wikipedia.org y dime en qué fecha nació Francisco Morazán', en: 'Go to en.wikipedia.org and tell me when Francisco Morazán was born' },
  { es: 'Busca en Google el clima de mañana en Tegucigalpa y dime la temperatura', en: 'Search Google for tomorrow’s weather in Tegucigalpa and tell me the temperature' },
  { es: 'Entra a bch.hn y dime el precio de compra del dólar de hoy', en: 'Go to bch.hn and tell me today’s dollar buying rate' },
];

/**
 * El aviso de la mesa: mientras trabaja, «trabajando · paso»; cuando termina, «terminó» un rato (para
 * que lo vea aunque no estuviera mirando). null = no se muestra.
 */
export function avisoMesa(antes: ResumenPc | null, ahora: ResumenPc | null, idioma: 'es' | 'en' = 'es'): { texto: string; terminada: boolean } | null {
  const en = idioma === 'en';
  if (!ahora) return null;
  if (ahora.estado === 'confirmar') return { texto: en ? 'Its computer is waiting for your OK · see' : 'Su computadora espera tu sí · ver', terminada: false };
  if (trabajando(ahora.estado)) return { texto: ahora.ultimo ? `${en ? 'Its computer' : 'Su computadora'} · ${ahora.ultimo}` : en ? 'Its computer is working' : 'Su computadora está trabajando', terminada: false };
  if (antes && antes.id === ahora.id && trabajando(antes.estado)) return { texto: en ? 'Its computer finished · see the result' : 'Su computadora terminó · ver el resultado', terminada: true };
  return null;
}

/* ── en vivo y hasta el final (José, 2-oct: «abrió la página y se quedó ahí») ─────────────── */

/**
 * Las pantallas que «abrir» sabe además de las del contrato (nucleo/contrato.ts `Pantalla`): la vista en
 * vivo de su computadora, los chats con la pestaña de WhatsApp y sus correos. El servidor (lib/acciones-app.ts)
 * las manda igual que las otras: {"tipo":"abrir","pantalla":"computadora"}.
 */
export const PANTALLAS_MAS = ['computadora', 'whatsapp', 'correos'] as const;
export type PantallaMas = (typeof PANTALLAS_MAS)[number];

/**
 * Lo que su computadora le cuenta al teléfono por el canal de acciones (server/computadora.ts):
 *  · empieza: una tarea arrancó → se abre sola la vista en vivo y suena el tecleo bajito;
 *  · paso:    una frase corta de avance para decir («Ya entré a bch.hn.»);
 *  · sigue:   la tarea no alcanzó y la misión sigue con otra (otro `id`);
 *  · confirmar: se detuvo antes de algo sensible: `pregunta` para los botones Sí / No (y `texto` para decirla);
 *  · pausa:   la pausaron o tomaste el control (`estado`); reanuda: siguió;
 *  · termina: terminó; con `texto`, el resultado para decirlo ya (si no, lo dijo el turno).
 * `plan` (en empieza) es la lista corta de la misión. `boleto` (lo pone el servidor) deja decirlo tal cual en
 * la conversación de voz.
 */
export type FasePc = 'empieza' | 'paso' | 'sigue' | 'confirmar' | 'pausa' | 'reanuda' | 'termina';
export type AccionPc = {
  tipo: 'computadora';
  fase: FasePc;
  id: string;
  texto?: string;
  ok?: boolean;
  boleto?: string;
  plan?: string[];
  pregunta?: string;
  estado?: 'pausada' | 'control';
};

const FASES: readonly string[] = ['empieza', 'paso', 'sigue', 'confirmar', 'pausa', 'reanuda', 'termina'];

/** ¿Es un aviso de su computadora bien formado? Lo que no, se descarta. */
export function esAccionPc(a: any): a is AccionPc {
  if (!a || typeof a !== 'object' || a.tipo !== 'computadora') return false;
  if (!FASES.includes(a.fase) || typeof a.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(a.id)) return false;
  if (a.texto !== undefined && (typeof a.texto !== 'string' || !a.texto.trim() || a.texto.length > 1200)) return false;
  if (a.ok !== undefined && typeof a.ok !== 'boolean') return false;
  if (a.plan !== undefined && (!Array.isArray(a.plan) || a.plan.length < 1 || a.plan.length > 6 || !a.plan.every((p: unknown) => typeof p === 'string' && !!p.trim() && p.length <= 120))) return false;
  if (a.pregunta !== undefined && (typeof a.pregunta !== 'string' || !a.pregunta.trim() || a.pregunta.length > 400)) return false;
  if (a.estado !== undefined && a.estado !== 'pausada' && a.estado !== 'control') return false;
  return a.boleto === undefined || (typeof a.boleto === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(a.boleto));
}

/* ── como un agente (José, 2-oct: «copiemos cómo lo hacen Grok, el agente de ChatGPT») ─────────────── */

/** El tiempo transcurrido de la misión: «0:42», «12:05», «1:02:09». */
export function relojMision(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** La marca de cada paso del plan en la lista. */
export function marcaPlan(e: EstadoPlanPc): string {
  return e === 'hecho' ? '✓' : e === 'actual' ? '●' : e === 'espera' ? 'Ⅱ' : e === 'fallo' ? '✕' : '○';
}

/**
 * Qué botones van, según lo que sabe su servicio y cómo está la tarea. Detener, siempre que esté viva;
 * Pausar/Seguir y Tomar el control/Devolver solo con el servicio nuevo (si no, se explica por qué no).
 */
export function controlesPc(caps: readonly string[] | undefined, e: EstadoTareaPc | null | undefined) {
  const viva = trabajando(e);
  const pausa = !!caps?.includes('pausar');
  const control = !!caps?.includes('control');
  return {
    detener: viva,
    pausar: viva && pausa && enMarcha(e),
    seguir: viva && pausa && e === 'pausada',
    tomar: viva && control && (enMarcha(e) || e === 'pausada'),
    devolver: viva && control && e === 'control',
    contestar: viva && e === 'confirmar',
    /** El servicio todavía no sabe pausar ni dar el control: la app lo dice. */
    faltaActualizar: viva && !pausa && !control,
  };
}

/** Un toque sobre la captura (que ocupa toda la caja, 16:10 como el escritorio) en las coordenadas del nodo, [0, 1000]. */
export function aCoordenadas(x: number, y: number, ancho: number, alto: number): { x: number; y: number } {
  const c = (v: number, total: number) => Math.max(0, Math.min(1000, Math.round((v / Math.max(1, total)) * 1000)));
  return { x: c(x, ancho), y: c(y, alto) };
}

/** Lo que se comparte del resultado: la misión, lo que encontró, los datos y los enlaces. */
export function textoParaCompartir(instruccion: string, f: Pick<FinalPc, 'respuesta' | 'error' | 'datos' | 'enlaces' | 'ok'>, idioma: 'es' | 'en' = 'es'): string {
  const en = idioma === 'en';
  const partes = [`«${instruccion.trim()}»`];
  const r = (f.respuesta || '').trim();
  partes.push(r || (f.ok ? '' : `${en ? 'It did not finish' : 'No terminó'}${f.error ? `: ${f.error}` : ''}.`));
  const datosSueltos = f.datos.filter((d) => !r.includes(`${d.clave}: ${d.valor}`));
  if (datosSueltos.length) partes.push(datosSueltos.map((d) => `${d.clave}: ${d.valor}`).join('\n'));
  const enlaces = f.enlaces.filter((u) => !r.includes(u));
  if (enlaces.length) partes.push(enlaces.join('\n'));
  partes.push(en ? '— from my AU-RA computer' : '— desde la computadora de AU-RA');
  return partes.filter(Boolean).join('\n\n');
}

/** Cómo terminó, en una palabra para la tarjeta. */
export function finalEnPalabras(f: Pick<FinalPc, 'estado' | 'ok'>, idioma: 'es' | 'en' = 'es'): string {
  const en = idioma === 'en';
  if (f.ok) return en ? 'Done' : 'Listo';
  if (f.estado === 'parada') return en ? 'Stopped' : 'Detenida';
  if (f.estado === 'fallo') return en ? 'Failed' : 'Falló';
  return en ? 'Unfinished' : 'A medias';
}

/** «hace 3 min», «hace 2 h»: para el historial. */
export function haceCuanto(desde: number, ahora = Date.now(), idioma: 'es' | 'en' = 'es'): string {
  const min = Math.max(0, Math.round((ahora - desde) / 60_000));
  const en = idioma === 'en';
  if (min < 1) return en ? 'just now' : 'recién';
  if (min < 60) return en ? `${min} min ago` : `hace ${min} min`;
  const h = Math.round(min / 60);
  return en ? `${h} h ago` : `hace ${h} h`;
}

/** Tras hablar la persona, este rato sin frases de avance (no se le habla encima). */
export const PAUSA_TRAS_PERSONA_MS = 20_000;
/** Entre una frase de avance y la siguiente, como mínimo (además del tope del servidor). */
export const MIN_ENTRE_FRASES_MS = 10_000;
/** El resultado espera a que haya silencio (la persona o AURA hablando) hasta este tope; después se dice igual. */
export const FINAL_ESPERA_MAX_MS = 45_000;
/** Sin noticias de la tarea en este rato, se da por terminada (el tecleo no se queda sonando). */
export const TOPE_TRABAJO_MS = 6 * 60_000;
/** Quieta (en pausa, esperando tu sí o contigo al mando) puede durar más sin noticias: el servicio la cierra a los 30 min. */
export const TOPE_QUIETA_MS = 32 * 60_000;

type Temporizador = (f: () => void, ms: number) => () => void;
const temporizadorPc: Temporizador = (f, ms) => {
  const t = setTimeout(f, ms);
  return () => clearTimeout(t);
};

export type DepsCompaneroPc = {
  /** Abre la vista en vivo siguiendo esa tarea (la hoja global, app/ComputadoraEnVivo.tsx). */
  abrirVista: (id: string) => void;
  /** ¿Se puede abrir ahora? (no en medio de una llamada de PULSE2CHAT). */
  puedeAbrir: () => boolean;
  /** Lo dice AURA: con la conversación abierta, tal cual con el boleto; si no, con la voz de la mesa. */
  decir: (texto: string, boleto?: string) => void;
  /** Quiere (o no) el tecleo de fondo; quien lo pone decide si de verdad puede sonar. */
  sonido: (on: boolean) => void;
  /** Alguien está hablando o pensando ahora mismo (la persona, AURA, la mesa esperando al cerebro). */
  ocupado: () => boolean;
  esperar?: Temporizador;
  reloj?: () => number;
  miga?: (t: string) => void;
};

/**
 * LA COMPAÑÍA MIENTRAS TRABAJA SU COMPUTADORA (sin React Native): qué hacer con cada aviso del servidor.
 * Abre la vista sola al empezar, pone el tecleo, dice los avances sin hablarle encima a nadie (nunca dos
 * seguidas, nunca justo después de que la persona habló) y dice el resultado en cuanto hay silencio.
 */
export class CompaneroPc {
  /** La tarea que se sigue (cambia si la misión sigue con otra). */
  tareaId: string | null = null;
  trabajando = false;
  /** Lo último que dijo (o iba a decir) de la computadora: la vista lo muestra arriba. */
  ultimaFrase = '';
  /** El plan de la misión (llega con `empieza`; la vista lo muestra antes de la primera consulta). */
  plan: string[] = [];
  /** Viva pero quieta: en pausa, esperando tu sí o contigo al mando (sin tecleo). */
  quieta: 'pausada' | 'confirmar' | 'control' | null = null;
  /** Lo que pregunta antes de algo sensible (los botones Sí / No). */
  pregunta: string | null = null;
  private cerradaPorPersona = false;
  private ultimaPersona = -Infinity;
  private ultimoDicho = -Infinity;
  private cancelarTope: (() => void) | null = null;
  private cancelarFinal: (() => void) | null = null;
  private oyentes = new Set<() => void>();
  private esperar: Temporizador;
  private reloj: () => number;

  constructor(private d: DepsCompaneroPc) {
    this.esperar = d.esperar || temporizadorPc;
    this.reloj = d.reloj || Date.now;
  }

  /** Para la vista: avisa cuando cambia la tarea, si trabaja o la frase. */
  suscribir(f: () => void): () => void {
    this.oyentes.add(f);
    return () => {
      this.oyentes.delete(f);
    };
  }

  private cambio() {
    for (const f of [...this.oyentes]) {
      try {
        f();
      } catch {
        /* un oyente roto no rompe nada */
      }
    }
  }

  alAccion(a: AccionPc) {
    this.d.miga?.(`computadora: ${a.fase} ${a.id}`);
    switch (a.fase) {
      case 'empieza':
        this.cerradaPorPersona = false;
        this.plan = a.plan ?? [];
        this.quieta = null;
        this.pregunta = null;
        this.empezar(a.id, true);
        // Encargada desde la app: AURA dice el plan («Va. Mi plan: …»).
        if (a.texto) this.final(a.texto, a.boleto);
        break;
      case 'sigue':
        this.quieta = null;
        this.pregunta = null;
        this.empezar(a.id, !this.cerradaPorPersona);
        if (a.texto) this.avance(a.texto, a.boleto);
        break;
      case 'confirmar':
        // Una pregunta es para la persona: se le abre la vista con los botones (aunque la hubiera cerrado).
        this.tareaId = a.id;
        this.trabajando = true;
        this.quieta = 'confirmar';
        this.pregunta = a.pregunta ?? a.texto ?? null;
        this.d.sonido(false);
        this.renovarTope(TOPE_QUIETA_MS);
        if (this.d.puedeAbrir()) this.d.abrirVista(a.id);
        if (a.texto) this.final(a.texto, a.boleto);
        break;
      case 'pausa':
        if (this.tareaId && a.id !== this.tareaId) break;
        this.quieta = a.estado ?? 'pausada';
        this.d.sonido(false);
        this.renovarTope(TOPE_QUIETA_MS);
        if (a.texto) this.final(a.texto, a.boleto);
        break;
      case 'reanuda':
        if (this.tareaId && a.id !== this.tareaId) break;
        this.quieta = null;
        this.pregunta = null;
        if (this.trabajando) {
          this.d.sonido(true);
          this.renovarTope();
        }
        if (a.texto) this.final(a.texto, a.boleto);
        break;
      case 'paso':
        if (a.id !== this.tareaId && this.tareaId) break; // de otra tarea (vieja): no se cuenta
        if (!this.trabajando) this.empezar(a.id, false);
        if (a.texto) this.avance(a.texto, a.boleto);
        this.renovarTope(this.quieta ? TOPE_QUIETA_MS : TOPE_TRABAJO_MS);
        break;
      case 'termina':
        if (this.tareaId && a.id !== this.tareaId && this.trabajando) {
          // El final de otra tarea (una vieja) no apaga la de ahora, pero su resultado sí se dice.
          if (a.texto) this.final(a.texto, a.boleto);
          break;
        }
        this.tareaId = a.id;
        this.quieta = null;
        this.pregunta = null;
        this.terminar();
        if (a.texto) this.final(a.texto, a.boleto);
        break;
    }
    this.cambio();
  }

  /** La persona habló (o la mesa se puso a pensar lo que dijo): las frases de avance esperan. */
  personaHablo() {
    this.ultimaPersona = this.reloj();
  }

  /** La persona cerró la vista: la misión que sigue no se la vuelve a abrir. */
  vistaCerrada() {
    if (this.trabajando) this.cerradaPorPersona = true;
  }

  /**
   * Lo que dice el servidor de su última tarea (el sondeo): si ya no trabaja, se apaga todo; con `estado`,
   * si se quedó quieta (pausa, tu sí, el control) o volvió a avanzar aunque el aviso se perdiera.
   */
  alEstado(id: string | null, trabajandoAhora: boolean, estado?: EstadoTareaPc) {
    if (!this.trabajando || !id) return;
    if (trabajandoAhora) {
      if (id !== this.tareaId) {
        this.tareaId = id; // la misión siguió con otra y el aviso no llegó
        this.cambio();
      }
      if (estado) {
        const q = quieta(estado) ? estado : null;
        if (q !== this.quieta) {
          this.quieta = q;
          if (q !== 'confirmar') this.pregunta = null;
          this.d.sonido(!q);
          this.cambio();
        }
      }
      return this.renovarTope(this.quieta ? TOPE_QUIETA_MS : TOPE_TRABAJO_MS);
    }
    if (id === this.tareaId) {
      this.terminar();
      this.cambio();
    }
  }

  /** La app se va atrás o la voz se desmonta: sin tecleo ni frases pendientes. */
  parar() {
    this.cancelarFinal?.();
    this.cancelarFinal = null;
    this.d.sonido(false);
  }

  private empezar(id: string, abrir: boolean) {
    this.tareaId = id;
    this.trabajando = true;
    if (abrir && this.d.puedeAbrir()) this.d.abrirVista(id);
    this.d.sonido(true);
    this.renovarTope();
  }

  private terminar() {
    this.trabajando = false;
    this.quieta = null;
    this.pregunta = null;
    this.cancelarTope?.();
    this.cancelarTope = null;
    this.d.sonido(false);
  }

  private renovarTope(ms = TOPE_TRABAJO_MS) {
    this.cancelarTope?.();
    this.cancelarTope = this.esperar(() => {
      this.cancelarTope = null;
      this.d.miga?.('computadora: sin noticias, se apaga el tecleo');
      this.terminar();
      this.cambio();
    }, ms);
  }

  /** Un avance: solo si nadie habla, no habló la persona hace poco y no se dijo otro hace nada. */
  private avance(texto: string, boleto?: string) {
    this.ultimaFrase = texto;
    const ahora = this.reloj();
    if (ahora - this.ultimaPersona < PAUSA_TRAS_PERSONA_MS) return;
    if (ahora - this.ultimoDicho < MIN_ENTRE_FRASES_MS) return;
    if (this.d.ocupado()) return;
    this.ultimoDicho = ahora;
    this.d.decir(texto, boleto);
  }

  /** El resultado: en cuanto haya silencio (y nunca encima de la persona), o al tope igual. */
  private final(texto: string, boleto?: string) {
    this.ultimaFrase = texto;
    this.cancelarFinal?.();
    const desde = this.reloj();
    const intentar = () => {
      this.cancelarFinal = null;
      const ahora = this.reloj();
      const quieto = !this.d.ocupado() && ahora - this.ultimaPersona >= 3_000;
      if (quieto || ahora - desde >= FINAL_ESPERA_MAX_MS) {
        this.ultimoDicho = ahora;
        this.d.decir(texto, boleto);
        return;
      }
      this.cancelarFinal = this.esperar(intentar, 500);
    };
    intentar();
  }
}
