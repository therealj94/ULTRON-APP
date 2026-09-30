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
import type { AccionApp, Contexto, Eventos, Pantalla } from '../nucleo/contrato';
import { RUTA_ACCIONES } from '../nucleo/contrato';
import { LectorSse, jsonDe } from './sse';

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

const PANTALLAS: readonly Pantalla[] = ['mesa', 'chats', 'ajustes', 'perfil'];
const TEMAS = ['oscuro', 'claro', 'sistema'];
const AVATARES = ['ojos', 'aura', 'claudio'];
const txt = (v: unknown, max = 2000) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

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
      return a.para === undefined || txt(a.para, 200);
    case 'silencio':
      return typeof a.valor === 'boolean';
    default:
      return false;
  }
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
  /** El servidor dijo 401: renovar la sesión (en la app, una petición por api() que la renueva sola). */
  renovar?: () => Promise<void>;
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
  private vistos: string[] = [];
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
        if (ev.evento !== 'message' && ev.evento !== 'accion') continue;
        const d = jsonDe<{ id?: string; accion?: unknown }>(ev);
        if (!d) continue;
        const id = String(d.id || ev.id || '');
        if (id) {
          if (this.vistos.includes(id)) continue;
          this.vistos.push(id);
          if (this.vistos.length > 200) this.vistos.shift();
        }
        if (!esAccionApp(d.accion)) {
          this.d.miga?.('acciones: una acción que no conozco');
          continue;
        }
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
  escuchar: <K extends 'pantalla' | 'accion' | 'hecho' | 'enviado'>(tipo: K, f: (d: Eventos[K]) => void) => () => void;
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
      this.d.escuchar('accion', (a) => {
        // El borrador es lo que AURA dejó escrito (lo leyó en voz alta): el cerebro lo necesita para «envíalo».
        if (a.tipo === 'redactar') {
          this.borrador = a.texto;
          this.pronto();
        } else if (a.tipo === 'descartar') {
          this.borrador = undefined;
          this.pronto();
        }
      }),
      this.d.escuchar('hecho', (h) => {
        if (h.ok && (h.accion.tipo === 'enviar' || h.accion.tipo === 'descartar')) {
          this.borrador = undefined;
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
