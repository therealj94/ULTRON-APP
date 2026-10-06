/**
 * EL PUENTE DE ACCIONES: lo que AURA decide hacer llega al teléfono y se hace.
 *
 *   «vete atrás», «abre ajustes», «escríbele a mi mamá que llego tarde» → el cerebro (en el servidor,
 *   durante la conversación fluida o el turno de la mesa) decide la acción y la manda por
 *   GET /api/app/acciones (SSE). Este puente la recibe y la emite en el bus (`emitir('accion', …)`):
 *   la navegación, el chat y los ajustes la hacen y avisan `hecho`.
 *
 * Para que el cerebro sepa a quién le puede escribir y dónde está la persona, el teléfono le cuenta el
 * CONTEXTO por POST /api/app/contexto: la pantalla, el chat abierto, los contactos (solo nombre y
 * correo) y el borrador que AURA dejó escrito. Nunca viaja el contenido de los chats.
 *
 * El SSE va por XMLHttpRequest: `fetch` de React Native no entrega el cuerpo a trozos, el XHR sí
 * (onprogress, también en Android). Si se cae, se reconecta con espera creciente (1 s, 2 s, 4 s… hasta
 * 30 s); si el servidor aún no tiene la ruta (404) se vuelve a probar cada minuto sin molestar a nadie.
 *
 * Sin React Native: todo lo de afuera entra por `deps` y las pruebas lo corren con un servidor falso.
 */
import type { AccionApp, Ambiente, Contexto, Eventos, Pantalla, RecordatorioPuesto } from '../nucleo/contrato';
import { EVENTO_AMBIENTE, MANOS_APP, RUTA_ACCIONES } from '../nucleo/contrato';
import { LectorSse, jsonDe } from './sse';
import { esAccionPc, PANTALLAS_MAS } from './computadora';
import { esAccionIniciativa } from './iniciativa';
import { PANTALLAS_CEREBRO } from './cerebro';

/** Lo que se usa de un XMLHttpRequest (el de React Native o uno falso en las pruebas). */
export type XhrMin = {
  open: (metodo: string, url: string) => void;
  setRequestHeader: (k: string, v: string) => void;
  send: (cuerpo?: string | null) => void;
  abort: () => void;
  readonly responseText: string;
  readonly status: number;
  readonly readyState: number;
  onprogress: ((ev?: unknown) => void) | null;
  onreadystatechange: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
};

type Temporizador = (f: () => void, ms: number) => () => void;
const temporizador: Temporizador = (f, ms) => {
  const t = setTimeout(f, ms);
  return () => clearTimeout(t);
};

// Las del contrato y las de más (su computadora, WhatsApp y sus correos: compa/computadora.ts; sus misiones,
// lo que sabe de ti y tu círculo: compa/cerebro.ts).
const PANTALLAS: readonly string[] = ['mesa', 'chats', 'ajustes', 'perfil', ...PANTALLAS_MAS, ...PANTALLAS_CEREBRO] satisfies readonly (
  | Pantalla
  | (typeof PANTALLAS_MAS)[number]
  | (typeof PANTALLAS_CEREBRO)[number]
)[];
const TEMAS = ['oscuro', 'claro', 'sistema'];
const AVATARES = ['ojos', 'aura', 'claudio', 'antonio'];
const CAMPOS_PERFIL = ['apodo', 'cumple', 'vive', 'comida', 'musica', 'familia', 'trabajo', 'gustos', 'otros'];
const PRESENCIAS = ['paseo', 'lado', 'completa'];
const txt = (v: unknown, max = 2000) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const boletoOk = (v: unknown) => v === undefined || (typeof v === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(v));

/** ¿Es una acción que la app sabe hacer? Lo que no, se descarta (un servidor más nuevo no rompe nada). */
export function esAccionApp(a: any): a is AccionApp {
  if (!a || typeof a !== 'object') return false;
  switch (a.tipo) {
    case 'atras':
    case 'descartar':
      return true;
    case 'abrir':
      return PANTALLAS.includes(a.pantalla);
    case 'tema':
      return TEMAS.includes(a.valor);
    case 'avatar':
      return AVATARES.includes(a.valor);
    case 'abrir_chat':
      return txt(a.con, 200);
    case 'redactar':
      return txt(a.para, 200) && txt(a.texto);
    case 'enviar':
      return (a.para === undefined || txt(a.para, 200)) && (a.texto === undefined || txt(a.texto));
    case 'silencio':
      return typeof a.valor === 'boolean';
    case 'presencia':
      return PRESENCIAS.includes(a.valor);
    // Las manos: con la misma forma estricta que valida el servidor.
    case 'llamar':
      return txt(a.con, 254) && typeof a.video === 'boolean';
    case 'leer':
      return (a.de === undefined || txt(a.de, 254)) && boletoOk(a.boleto);
    case 'buscar':
      return txt(a.q, 80) && a.q.trim().length >= 2 && boletoOk(a.boleto);
    case 'idioma':
      return a.valor === 'es' || a.valor === 'en';
    case 'perfil':
      return CAMPOS_PERFIL.includes(a.campo) && txt(a.valor, 300);
    case 'recordatorio':
      return txt(a.texto, 140) && typeof a.cuando === 'number' && Number.isFinite(a.cuando) && (a.llamada === undefined || typeof a.llamada === 'boolean');
    case 'cancelar_recordatorio':
      return typeof a.id === 'string' && /^aura-rec-[a-z0-9-]{1,80}$/.test(a.id);
    case 'llamame':
      return true;
    // La cartera (cartera/HojasCartera.tsx): abrir la hoja, o la de enviar llenada (se firma en Veta Wallet).
    case 'cartera':
      return true;
    case 'pagar':
      return txt(a.con, 254) && (a.monto === undefined || txt(a.monto, 40)) && (a.moneda === undefined || txt(a.moneda, 16));
    // Lo que hace su computadora en la nube (server/computadora.ts): abrir la vista, avances y el final.
    case 'computadora':
      return esAccionPc(a);
    // Lo que AURA propone por su cuenta (server/iniciativa.ts): la tarjeta de la mesa (compa/iniciativa.ts).
    case 'iniciativa':
      return esAccionIniciativa(a);
    // Los controles de voz separados (AUR10, compa/controles.ts): cada uno con un solo efecto.
    case 'detener_audio':
    case 'colgar':
      return true;
    case 'tarea':
      return a.que === 'pausar' || a.que === 'reanudar' || a.que === 'cancelar' || a.que === 'tomar';
    default:
      return false;
  }
}

/** Los mismos de compa/frasesEstado.ts (SONIDOS_AMBIENTE) y del servidor (lib/acciones-app.ts). */
const SONIDOS = ['teclado', 'papel', 'lapiz', 'clics', 'pensando'];

/** El `data` de un `event: ambiente`, validado: un sonido que no conozco es «sin sonido». */
export function ambienteDe(d: any): Ambiente | null {
  if (!d || typeof d !== 'object' || typeof d.on !== 'boolean') return null;
  const sonido = d.on && SONIDOS.includes(d.sonido) ? (d.sonido as Ambiente['sonido']) : null;
  return { sonido, on: !!sonido };
}

/**
 * La lectura del teléfono tal como viaja por la conversación de voz: el servidor la reconoce por el
 * boleto (lib/manos-app.ts, RE_LECTURA) y la dice tal cual, sin pasar por el cerebro.
 */
export function mensajeDeLectura(boleto: string, texto: string): string {
  return `[[lectura:${boleto}]] ${String(texto || '').replace(/\s+/g, ' ').trim()}`;
}

/**
 * La persona contestó la llamada de un recordatorio: así viaja por la conversación de voz y el servidor
 * lo vuelve la indicación de decírselo (lib/manos-app.ts, turnoDeRecordatorio).
 */
export function mensajeDeRecordatorio(texto: string): string {
  return `[[recordatorio]] ${String(texto || '').replace(/\s+/g, ' ').trim().slice(0, 300)}`;
}

export type DepsRecordatorioVoz = {
  vista: () => VistaLectura;
  /** Abre la conversación (o la despierta si estaba silenciada o dormida). */
  despertar: () => void;
  enviarTexto: (t: string) => boolean;
  hablarMesa: (t: string) => Promise<unknown> | unknown;
  /** ¿Hay una llamada de PULSE2CHAT en curso? Y una promesa que se cumple cuando termina. */
  enLlamada: () => boolean;
  finDeLlamada: () => Promise<void>;
  esperar?: (ms: number) => Promise<void>;
  /** Cuánto se espera a que la conversación conecte antes de decirlo con la voz de la mesa. */
  topeMs?: number;
};

/**
 * Contestó la llamada de AURA: se abre la conversación y, en cuanto escucha, AURA le dice el
 * recordatorio con su voz (y la charla sigue). Si hay una llamada de PULSE2CHAT, espera a que termine.
 * Si la conversación no conecta a tiempo, lo dice la voz de la mesa.
 */
export async function decirRecordatorio(texto: string, d: DepsRecordatorioVoz): Promise<'conversacion' | 'mesa' | 'nada'> {
  const esperar = d.esperar || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const limpio = String(texto || '').trim();
  if (!limpio) return 'nada';
  if (d.enLlamada()) await d.finDeLlamada();
  const v = d.vista();
  if (!v.montada || v.silenciada || v.dormida) d.despertar();
  const vueltas = Math.ceil((d.topeMs ?? 15_000) / 250);
  for (let i = 0; i < vueltas; i++) {
    const x = d.vista();
    if (x.montada && !x.silenciada && x.estado === 'escuchando') {
      if (d.enviarTexto(mensajeDeRecordatorio(limpio))) return 'conversacion';
      break;
    }
    await esperar(250);
  }
  if (d.vista().suspendida) return 'nada';
  await d.hablarMesa(`Te llamo para recordarte: ${limpio}`);
  return 'mesa';
}

/** Lo que mira `decirLectura` de la sesión de voz (la VistaSesion de sesion.ts). */
type VistaLectura = { montada: boolean; estado: string; silenciada: boolean; dormida: boolean; suspendida: boolean };

export type DepsLectura = {
  vista: () => VistaLectura;
  /** Un mensaje hacia la conversación fluida abierta (sendUserMessage). false: no se pudo. */
  enviarTexto: (t: string) => boolean;
  /** La voz de la mesa, en modo privado (sin caché). */
  hablarMesa: (t: string) => Promise<unknown> | unknown;
  mesaHablando: () => boolean;
  vozSuspendida: () => boolean;
  esperar?: (ms: number) => Promise<void>;
};

/**
 * Dice la lectura del teléfono con la voz de AURA:
 *  · con la conversación fluida abierta, como `[[lectura:<boleto>]] …` (el servidor la dice tal cual,
 *    sin cerebro); espera a que AURA termine su «A ver…» para no cortarse sola. Sin boleto NO se
 *    manda: sería un turno normal y el cerebro leería el mensaje de otra persona;
 *  · sin conversación, con la voz de la mesa en modo privado, cuando nadie esté hablando;
 *  · en una llamada, silenciada o dormida, no se dice (la persona pidió silencio o está hablando).
 */
export async function decirLectura(l: { texto: string; boleto?: string }, d: DepsLectura): Promise<'conversacion' | 'mesa' | 'nada'> {
  const esperar = d.esperar || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const texto = String(l.texto || '').trim();
  const v = d.vista();
  if (!texto || v.suspendida || v.silenciada || v.dormida) return 'nada';
  if (v.montada) {
    if (!l.boleto) return 'nada';
    for (let i = 0; i < 30 && d.vista().estado === 'hablando'; i++) await esperar(200);
    return d.enviarTexto(mensajeDeLectura(l.boleto, texto)) ? 'conversacion' : 'nada';
  }
  if (d.vozSuspendida()) return 'nada';
  for (let i = 0; i < 25 && d.mesaHablando(); i++) await esperar(200);
  await d.hablarMesa(texto);
  return 'mesa';
}

/*
 * Las acciones ya hechas. Una misma acción puede llegar dos veces —por el SSE y en el `done` del
 * turno de la mesa o de la voz— y no debe hacerse dos veces («envíalo» mandaría el mensaje repetido).
 *
 *  · Con id (el servidor responde `acciones: [{ id, accion }]` con el MISMO id que empujó por el SSE):
 *    un id ya visto no se repite nunca (se guardan los últimos 300).
 *  · Sin id (un servidor viejo devuelve la AccionApp pelada en el `done`, o el SSE llega sin id): la
 *    misma acción —mismo contenido— dentro de 5 s se da por repetida. Dos acciones iguales CON ids
 *    distintos sí son dos (la persona pidió «envíalo» dos veces y el servidor las distinguió).
 *
 * Contra lo que sí se compara lo sin id es contra lo de hace 5 s: un «vete atrás» sin id de hace un
 * minuto no bloquea el de ahora.
 */
export const VENTANA_MISMA_ACCION_MS = 5_000;
type Vista = { id: string; firma: string; en: number };
const vistas: Vista[] = [];

/** La acción en texto estable (claves en orden): dos objetos iguales dan la misma firma. */
export function firmaAccion(a: unknown): string {
  if (!a || typeof a !== 'object') return '';
  const o = a as Record<string, unknown>;
  return JSON.stringify(Object.keys(o).sort().map((k) => [k, typeof o[k] === 'string' ? String(o[k]).trim() : o[k]]));
}

/**
 * true si esta acción es nueva (y queda anotada). `accion` permite reconocer la misma acción que llega
 * sin id por otro camino; sin id ni acción no hay con qué comparar y es nueva.
 */
export function accionNueva(id?: string | null, accion?: unknown, ahora: number = Date.now()): boolean {
  const i = String(id || '').trim();
  const firma = accion === undefined ? '' : firmaAccion(accion);
  if (i && vistas.some((v) => v.id === i)) return false;
  if (firma) {
    // La misma acción hace menos de 5 s, y a una de las dos le falta el id: es la misma que volvió.
    const misma = vistas.find((v) => v.firma === firma && Math.abs(ahora - v.en) <= VENTANA_MISMA_ACCION_MS && (!i || !v.id));
    if (misma) {
      if (i && !misma.id) misma.id = i; // si luego llega otra vez con ese id, también se reconoce
      return false;
    }
  }
  if (!i && !firma) return true;
  vistas.push({ id: i, firma, en: ahora });
  if (vistas.length > 300) vistas.shift();
  return true;
}

/**
 * Las `acciones` que trae el `done` de /api/turno (y de /api/turno/stream): `[{ id, accion }]` (el
 * formato nuevo) o AccionApp sueltas (el viejo). Las válidas y nuevas, en orden; lo que no se entiende
 * se descarta.
 */
export function accionesDelTurno(r: unknown, ahora: number = Date.now()): AccionApp[] {
  const lista = (r as { acciones?: unknown } | null)?.acciones;
  if (!Array.isArray(lista)) return [];
  const out: AccionApp[] = [];
  for (const x of lista) {
    const envuelta = x && typeof x === 'object' && 'accion' in (x as object);
    const accion = envuelta ? (x as { accion: unknown }).accion : x;
    const id = envuelta ? String((x as { id?: unknown }).id || '') : '';
    if (esAccionApp(accion) && accionNueva(id, accion, ahora)) out.push(accion);
  }
  return out;
}

export type EstadoPuente = 'parado' | 'conectando' | 'abierto' | 'esperando';

export type DepsPuente = {
  /** API_BASE del servidor. */
  base: string;
  /** El token de la sesión de la mesa (null: todavía no hay sesión). */
  token: () => Promise<string | null>;
  xhr: () => XhrMin;
  /** Por cada acción válida y nueva. */
  alAccion: (a: AccionApp, id?: string) => void;
  /** El sonido de fondo de la conversación (`event: ambiente`). Sin esto, se salta. */
  alAmbiente?: (a: Ambiente) => void;
  /** El servidor dijo 401: renovar la sesión (en la app, una petición por api() que la renueva sola). */
  renovar?: () => Promise<void>;
  /** Cabeceras de más para el SSE (en la app, `x-aura-aparato`: qué teléfono escucha). */
  cabeceras?: () => Promise<Record<string, string>>;
  esperar?: Temporizador;
  reloj?: () => number;
  miga?: (t: string) => void;
  /** Sin datos (ni latidos) en este tiempo, la conexión se da por muerta y se rehace. */
  silencioMaxMs?: number;
};

export const ESPERA_MAX_MS = 30_000;
export const ESPERA_SIN_RUTA_MS = 60_000;
export const ESPERA_SIN_SESION_MS = 15_000;

export class PuenteAcciones {
  estado: EstadoPuente = 'parado';
  /** Cuántos fallos seguidos (para la espera creciente). */
  private fallos = 0;
  private xhr: XhrMin | null = null;
  private cancelarEspera: (() => void) | null = null;
  private cancelarVigia: (() => void) | null = null;
  private lector = new LectorSse();
  private ultimoId = '';
  private vivo = false;
  private conexion = 0;
  private esperar: Temporizador;
  private reloj: () => number;

  constructor(private d: DepsPuente) {
    this.esperar = d.esperar || temporizador;
    this.reloj = d.reloj || Date.now;
  }

  arrancar() {
    if (this.vivo) return;
    this.vivo = true;
    this.fallos = 0;
    void this.conectar();
  }

  parar() {
    this.vivo = false;
    this.conexion += 1;
    this.cancelarEspera?.();
    this.cancelarEspera = null;
    this.cancelarVigia?.();
    this.cancelarVigia = null;
    const x = this.xhr;
    this.xhr = null;
    try {
      x?.abort();
    } catch {
      /* ya cerrada */
    }
    this.estado = 'parado';
  }

  /** La espera antes del siguiente intento, según cuántos fallos van. */
  static espera(fallos: number): number {
    return Math.min(ESPERA_MAX_MS, 1000 * 2 ** Math.max(0, fallos - 1));
  }

  private reintentar(ms: number) {
    if (!this.vivo) return;
    this.estado = 'esperando';
    this.cancelarEspera?.();
    this.cancelarEspera = this.esperar(() => {
      this.cancelarEspera = null;
      void this.conectar();
    }, ms);
  }

  private vigilar(n: number) {
    this.cancelarVigia?.();
    this.cancelarVigia = this.esperar(() => {
      if (n !== this.conexion || !this.vivo) return;
      this.d.miga?.('acciones: sin latido, reconecto');
      this.cerrarConexion();
      this.fallos += 1;
      this.reintentar(PuenteAcciones.espera(this.fallos));
    }, this.d.silencioMaxMs ?? 90_000);
  }

  private cerrarConexion() {
    this.conexion += 1;
    const x = this.xhr;
    this.xhr = null;
    try {
      x?.abort();
    } catch {
      /* */
    }
  }

  private async conectar() {
    if (!this.vivo) return;
    const n = ++this.conexion;
    this.estado = 'conectando';
    const token = await this.d.token().catch(() => null);
    if (!this.vivo || n !== this.conexion) return;
    if (!token) return this.reintentar(ESPERA_SIN_SESION_MS);
    const extra = (await this.d.cabeceras?.().catch(() => ({}) as Record<string, string>)) || {};
    if (!this.vivo || n !== this.conexion) return;
    const x = this.d.xhr();
    this.xhr = x;
    this.lector.reiniciar();
    let recibio = false;
    const abiertaEn = this.reloj();
    const leer = () => {
      if (n !== this.conexion) return;
      const texto = x.responseText || '';
      if (!texto) return;
      if (!recibio) {
        recibio = true;
        this.estado = 'abierto';
      }
      this.vigilar(n);
      for (const ev of this.lector.leer(texto)) {
        if (ev.id) this.ultimoId = ev.id;
        if (ev.evento === EVENTO_AMBIENTE) {
          const a = ambienteDe(jsonDe(ev));
          if (a) this.d.alAmbiente?.(a);
          continue;
        }
        if (ev.evento !== 'message' && ev.evento !== 'accion') continue;
        const d = jsonDe<{ id?: string; accion?: unknown }>(ev);
        if (!d) continue;
        const id = String(d.id || ev.id || '');
        if (!esAccionApp(d.accion)) {
          this.d.miga?.('acciones: una acción que no conozco');
          continue;
        }
        if (!accionNueva(id, d.accion)) continue;
        this.fallos = 0;
        this.d.alAccion(d.accion, id || undefined);
      }
    };
    x.onprogress = leer;
    x.onreadystatechange = () => {
      if (n !== this.conexion) return;
      if (x.readyState === 2 || x.readyState === 3) {
        if (x.status >= 200 && x.status < 300 && this.estado === 'conectando') this.estado = 'abierto';
        leer();
        return;
      }
      if (x.readyState !== 4) return;
      leer();
      this.cancelarVigia?.();
      this.xhr = null;
      const st = x.status;
      if (!this.vivo) return;
      if (st === 404) {
        // El servidor todavía no tiene la ruta: se prueba cada tanto, sin ruido.
        this.fallos = 0;
        return this.reintentar(ESPERA_SIN_RUTA_MS);
      }
      if (st === 401 || st === 403) {
        this.fallos += 1;
        void (this.d.renovar?.() || Promise.resolve()).catch(() => {}).finally(() => this.reintentar(Math.max(2000, PuenteAcciones.espera(this.fallos))));
        return;
      }
      if (st >= 200 && st < 300) {
        // El servidor cerró una conexión sana (reciclaje): se reabre enseguida.
        const sana = recibio || this.reloj() - abiertaEn > 20_000;
        this.fallos = sana ? 0 : this.fallos + 1;
        return this.reintentar(sana ? 1000 : PuenteAcciones.espera(this.fallos));
      }
      this.fallos += 1;
      this.reintentar(PuenteAcciones.espera(this.fallos));
    };
    x.onerror = () => {
      if (n !== this.conexion) return;
      this.cancelarVigia?.();
      this.xhr = null;
      this.fallos += 1;
      this.reintentar(PuenteAcciones.espera(this.fallos));
    };
    try {
      x.open('GET', `${this.d.base}${RUTA_ACCIONES}`);
      x.setRequestHeader('Accept', 'text/event-stream');
      x.setRequestHeader('Cache-Control', 'no-cache');
      x.setRequestHeader('x-ultron-sesion', token);
      for (const [k, v] of Object.entries(extra)) if (v) x.setRequestHeader(k, v);
      if (this.ultimoId) x.setRequestHeader('Last-Event-ID', this.ultimoId);
      x.send();
      this.vigilar(n);
    } catch {
      this.xhr = null;
      this.fallos += 1;
      this.reintentar(PuenteAcciones.espera(this.fallos));
    }
  }
}

/* ── el contexto ─────────────────────────────────────────────────────────────────────────── */

export type Contacto = { correo: string; nombre: string };

export type DepsContexto = {
  enviar: (c: Contexto) => Promise<unknown>;
  /** Nombres y correos de la gente con la que se puede hablar (nunca mensajes). */
  contactos: () => Promise<Contacto[]>;
  /** Los recordatorios puestos en el teléfono (se leen en cada envío: es local y barato). */
  recordatorios?: () => Promise<RecordatorioPuesto[]>;
  escuchar: <K extends 'pantalla' | 'hecho' | 'enviado'>(tipo: K, f: (d: Eventos[K]) => void) => () => void;
  esperar?: Temporizador;
  reloj?: () => number;
  /** Cada cuánto se repite mientras hay conversación. */
  cadaMs?: number;
  /** Cuánto se guardan los contactos antes de volver a pedirlos. */
  vidaContactosMs?: number;
};

export class ContextoApp {
  private pantalla: Pantalla = 'mesa';
  private chatAbierto: { correo: string; nombre: string } | null = null;
  private borrador: string | undefined;
  private contactosGuardados: { lista: Contacto[]; en: number } | null = null;
  private apagar: (() => void)[] = [];
  private cancelarPronto: (() => void) | null = null;
  private cancelarRonda: (() => void) | null = null;
  private conversando = false;
  private ultimoEnviado = '';
  private esperar: Temporizador;
  private reloj: () => number;

  constructor(private d: DepsContexto) {
    this.esperar = d.esperar || temporizador;
    this.reloj = d.reloj || Date.now;
  }

  arrancar() {
    if (this.apagar.length) return;
    this.apagar.push(
      this.d.escuchar('pantalla', (p) => {
        this.pantalla = p.pantalla;
        this.chatAbierto = p.chatAbierto ?? null;
        this.pronto();
      }),
      // El borrador es lo que AURA dejó escrito (lo leyó en voz alta): el cerebro lo necesita para
      // «envíalo». Se fija cuando `redactar` salió BIEN (si no encontró a quién, no hay borrador) y se
      // borra cuando se envió o se descartó de verdad.
      this.d.escuchar('hecho', (h) => {
        if (!h.ok) return;
        if (h.accion.tipo === 'redactar') {
          this.borrador = h.accion.texto;
          this.pronto();
        } else if (h.accion.tipo === 'enviar' || h.accion.tipo === 'descartar') {
          this.borrador = undefined;
          this.pronto();
        } else if (h.accion.tipo === 'recordatorio' || h.accion.tipo === 'cancelar_recordatorio') {
          // La lista de recordatorios cambió: que el servidor la sepa para «¿qué recordatorios tengo?».
          this.pronto();
        }
      }),
      this.d.escuchar('enviado', () => {
        if (this.borrador !== undefined) {
          this.borrador = undefined;
          this.pronto();
        }
      })
    );
    this.pronto();
  }

  parar() {
    for (const f of this.apagar) f();
    this.apagar = [];
    this.cancelarPronto?.();
    this.cancelarPronto = null;
    this.cancelarRonda?.();
    this.cancelarRonda = null;
  }

  /** Mientras hay conversación fluida el contexto se repite cada tanto (los contactos pudieron cambiar). */
  fijarConversando(v: boolean) {
    if (v === this.conversando) return;
    this.conversando = v;
    this.cancelarRonda?.();
    this.cancelarRonda = null;
    if (v) {
      this.pronto(true);
      this.ronda();
    }
  }

  private ronda() {
    this.cancelarRonda = this.esperar(() => {
      if (!this.conversando) return;
      void this.enviarAhora(true);
      this.ronda();
    }, this.d.cadaMs ?? 30_000);
  }

  /** Junta cambios seguidos en un solo envío. */
  private pronto(forzar = false) {
    this.cancelarPronto?.();
    this.cancelarPronto = this.esperar(() => {
      this.cancelarPronto = null;
      void this.enviarAhora(forzar);
    }, 400);
  }

  private async contactos(): Promise<Contacto[]> {
    const g = this.contactosGuardados;
    if (g && this.reloj() - g.en < (this.d.vidaContactosMs ?? 120_000)) return g.lista;
    const lista = await this.d.contactos().catch(() => g?.lista || []);
    const limpia = depurarContactos(lista);
    this.contactosGuardados = { lista: limpia, en: this.reloj() };
    return limpia;
  }

  /** Lo que se manda ahora. Igual a lo último, no se repite (salvo `forzar`, la ronda). */
  async enviarAhora(forzar = false): Promise<Contexto | null> {
    const c: Contexto = {
      pantalla: this.pantalla,
      chatAbierto: this.chatAbierto,
      contactos: await this.contactos(),
      ...(this.borrador !== undefined ? { borrador: this.borrador } : {}),
      // Lo que este teléfono sabe hacer: el servidor solo le ofrece (y le manda) esas manos.
      manos: MANOS_APP,
      ...(this.d.recordatorios ? { recordatorios: await this.d.recordatorios().catch(() => []) } : {}),
    };
    const firma = JSON.stringify(c);
    if (!forzar && firma === this.ultimoEnviado) return null;
    this.ultimoEnviado = firma;
    await this.d.enviar(c).catch(() => {
      this.ultimoEnviado = '';
    });
    return c;
  }
}

/** Solo nombre y correo, sin repetidos, a lo sumo 200. Nada más de la persona sale del teléfono. */
export function depurarContactos(lista: unknown[]): Contacto[] {
  const vistos = new Set<string>();
  const out: Contacto[] = [];
  for (const x of lista as any[]) {
    const correo = String(x?.correo || '').trim().toLowerCase();
    if (!correo || !correo.includes('@') || vistos.has(correo)) continue;
    vistos.add(correo);
    out.push({ correo, nombre: String(x?.nombre || '').trim().slice(0, 80) || correo });
    if (out.length >= 200) break;
  }
  return out;
}
