/**
 * EL ALMACÉN DEL CHAT en el Centro: la lista de conversaciones, el círculo, cada hilo y quién escribe.
 *
 * Portado de `mobile/src/pulse/chats.ts` sin React: cada almacén tiene `get` y `sub`, y la vista se
 * suscribe. El sondeo es el mismo del teléfono:
 *   · nunca dos peticiones a la vez para lo mismo (la que llega mientras hay una en curso se suma);
 *   · la lista cada 15 s (30 s con la ventana escondida: los avisos del notch siguen llegando);
 *   · el hilo abierto cada 4 s y, si nada cambia, se espacia a 8 y a 15 s; vuelve a 4 s en cuanto
 *     llega algo, alguien escribe o se envía. Con la ventana escondida el hilo no se sondea.
 */
import * as RELEVO from './relevo';

/* ── un almacén mínimo ────────────────────────────────────────────────────────────────────── */

export type Almacen<T> = { get: () => T; set: (v: T) => void; sub: (f: () => void) => () => void };

export function almacen<T>(inicial: T): Almacen<T> {
  let v = inicial;
  const oyentes = new Set<() => void>();
  return {
    get: () => v,
    set: (n) => {
      v = n;
      for (const f of [...oyentes]) {
        try {
          f();
        } catch (e) {
          console.error(e);
        }
      }
    },
    sub: (f) => {
      oyentes.add(f);
      return () => void oyentes.delete(f);
    },
  };
}

/* ── tipos ────────────────────────────────────────────────────────────────────────────────── */

export type MensajeHilo = RELEVO.Mensaje & { pendiente?: boolean; fallido?: boolean; motivoFallo?: string };
export type ErrorChat = '' | 'sin-red' | 'desconectado' | 'sin-permiso';

export type EstadoLista = {
  conversaciones: RELEVO.Conversacion[] | null;
  circulo: RELEVO.Circulo | null;
  error: ErrorChat;
};

export type EstadoHilo = {
  mensajes: MensajeHilo[] | null;
  hayMas: boolean;
  leidoHasta: number;
  enLinea: boolean;
  error: ErrorChat;
  cargandoAntes: boolean;
};

const HILO_VACIO: EstadoHilo = { mensajes: null, hayMas: false, leidoHasta: 0, enLinea: false, error: '', cargandoAntes: false };

/* ── la ventana: ¿se ve? ──────────────────────────────────────────────────────────────────── */

const hayDocumento = typeof document !== 'undefined';
export const ventanaVisible = () => !hayDocumento || document.visibilityState !== 'hidden';
const alVolver = new Set<() => void>();
if (hayDocumento) {
  document.addEventListener('visibilitychange', () => {
    if (ventanaVisible()) for (const f of [...alVolver]) f();
  });
}

/* ── desconexión (401: la llave del relevo ya no vale) ────────────────────────────────────── */

const alDesconectar = new Set<() => void>();
export function escucharDesconexion(f: () => void): () => void {
  alDesconectar.add(f);
  return () => void alDesconectar.delete(f);
}

function errorDe(e: any): ErrorChat {
  if (e?.code === 401) {
    for (const f of [...alDesconectar]) {
      try {
        f();
      } catch {
        /* nada */
      }
    }
    return 'desconectado';
  }
  if (e?.code === 403) return 'sin-permiso';
  return 'sin-red';
}

/* ── la lista ─────────────────────────────────────────────────────────────────────────────── */

export const lista = almacen<EstadoLista>({ conversaciones: null, circulo: null, error: '' });
let listaEnCurso: Promise<void> | null = null;

/** Lo que llegó de otra persona desde la vuelta anterior (para el aviso del notch). */
export type Novedad = { correo: string; nombre: string; mensaje: RELEVO.Mensaje };
const oyentesNovedad = new Set<(n: Novedad) => void>();
export function alMensajeNuevo(f: (n: Novedad) => void): () => void {
  oyentesNovedad.add(f);
  return () => void oyentesNovedad.delete(f);
}

function avisarNovedades(antes: RELEVO.Conversacion[] | null, ahora: RELEVO.Conversacion[]) {
  // La primera carga no avisa de nada: todo sería «nuevo».
  if (!antes) return;
  const yo = RELEVO.quien()?.correo || '';
  const previos = new Map(antes.map((c) => [c.correo, c.ultimo?.id || '']));
  for (const c of ahora) {
    const u = c.ultimo;
    if (!u || u.de === yo || !c.sinLeer) continue;
    if (previos.get(c.correo) === u.id) continue;
    for (const f of [...oyentesNovedad]) {
      try {
        f({ correo: c.correo, nombre: c.nombre, mensaje: u });
      } catch {
        /* nada */
      }
    }
  }
}

/** Trae conversaciones y círculo. Si ya hay una vuelta en curso, espera esa. */
export function refrescarLista(): Promise<void> {
  if (listaEnCurso) return listaEnCurso;
  if (!RELEVO.quien()) return Promise.resolve();
  const cuenta = RELEVO.quien();
  listaEnCurso = (async () => {
    try {
      const [conversaciones, circulo] = await Promise.all([RELEVO.conversaciones(), RELEVO.circulo()]);
      // Se salió de la cuenta (o se cambió) mientras volvía la respuesta: lo de antes no se pinta.
      if (RELEVO.quien() !== cuenta) return;
      // Los grupos se ven en la app Orden Global: desde aquí no hay llaves de grupo y saldría en claro.
      const solas = conversaciones.filter((c) => !c.esGrupo).map((c) => (abiertoAhora === c.correo ? { ...c, sinLeer: 0 } : c));
      const antes = lista.get().conversaciones;
      lista.set({ conversaciones: solas, circulo, error: '' });
      avisarNovedades(antes, solas);
    } catch (e) {
      if (RELEVO.quien() !== cuenta) return;
      // PRIMERO el error: un 401 sale de la cuenta (y vacía la lista) EN ESTA MISMA LLAMADA. Leer la
      // lista antes y escribirla después volvía a poner las conversaciones de quien acaba de salir.
      const error = errorDe(e);
      const v = lista.get();
      lista.set({ ...v, conversaciones: v.conversaciones ?? [], error });
    } finally {
      listaEnCurso = null;
    }
  })();
  return listaEnCurso;
}

/** La lista viva mientras haya cuenta: 15 s con la ventana a la vista, 30 s escondida. */
export function sondearLista(): () => void {
  return sondear(refrescarLista, () => (ventanaVisible() ? 15_000 : 30_000), undefined, false);
}

/* ── quién está escribiendo ───────────────────────────────────────────────────────────────── */

export const escriben = almacen<Record<string, number>>({});
let limpiarEscriben: ReturnType<typeof setTimeout> | null = null;

/** Llegó la señal «escribe» de alguien: se muestra 4 s y el hilo con esa persona se apura. */
export function marcarEscribiendo(correo: string) {
  const c = String(correo || '').toLowerCase();
  if (!c) return;
  escriben.set({ ...escriben.get(), [c]: Date.now() + 4000 });
  apurar(c);
  if (limpiarEscriben) clearTimeout(limpiarEscriben);
  limpiarEscriben = setTimeout(() => {
    const ahora = Date.now();
    const v = escriben.get();
    const quedan = Object.fromEntries(Object.entries(v).filter(([, hasta]) => hasta > ahora));
    escriben.set(quedan);
    // Dejó de escribir: casi siempre porque mandó. Se pregunta ya.
    for (const k of Object.keys(v)) if (!quedan[k]) apurar(k, true);
  }, 4100);
}

export const estaEscribiendo = (correo: string) => (escriben.get()[String(correo).toLowerCase()] || 0) > Date.now();

/* ── los hilos ────────────────────────────────────────────────────────────────────────────── */

const hilos = new Map<string, Almacen<EstadoHilo>>();
const hilosEnCurso = new Map<string, Promise<boolean>>();
/** Lo enviado desde aquí que el relevo todavía no devolvió en la bandeja. */
const locales = new Map<string, MensajeHilo[]>();
/** El hilo que la persona tiene a la vista (sus mensajes nuevos no suman «sin leer» ni avisan). */
let abiertoAhora: string | null = null;

export function hiloDe(correo: string): Almacen<EstadoHilo> {
  const c = String(correo).toLowerCase();
  let h = hilos.get(c);
  if (!h) hilos.set(c, (h = almacen<EstadoHilo>(HILO_VACIO)));
  return h;
}

function mezclar(del: RELEVO.Mensaje[], correo: string): MensajeHilo[] {
  const ids = new Set(del.map((m) => m.id));
  const propios = (locales.get(correo) || []).filter((m) => !ids.has(m.id));
  locales.set(correo, propios);
  return propios.length ? [...del, ...propios].sort((a, b) => a.cuando - b.cuando) : del;
}

/** Firma barata de lo visible: si no cambió, el sondeo se espacia. */
export const huellaHilo = (e: EstadoHilo) => {
  const m = e.mensajes || [];
  const u = m[m.length - 1];
  return `${m.length}|${m[0]?.id}|${u?.id}|${m.filter((x) => x.pendiente).length}|${m.filter((x) => x.fallido).length}|${e.leidoHasta}|${e.enLinea ? 1 : 0}|${m.filter((x) => x.borrado).length}|${m.filter((x) => x.cerrado).length}|${m.filter((x) => x.verificado).length}|${e.error}|${e.hayMas ? 1 : 0}|${e.cargandoAntes ? 1 : 0}`;
};

/** Trae la última página del hilo. Devuelve true si algo cambió. Nunca dos a la vez por hilo. */
export function refrescarHilo(correo: string): Promise<boolean> {
  const c = String(correo).toLowerCase();
  const ya = hilosEnCurso.get(c);
  if (ya) return ya;
  if (!RELEVO.quien()) return Promise.resolve(false);
  const cuenta = RELEVO.quien();
  const p = (async () => {
    const h = hiloDe(c);
    try {
      const b = await RELEVO.bandeja(c);
      if (RELEVO.quien() !== cuenta) return false;
      const antes = h.get();
      const viejas = (antes.mensajes || []).filter((m) => !m.pendiente && !m.fallido && b.mensajes.length && m.cuando < b.mensajes[0].cuando);
      const nuevo: EstadoHilo = {
        ...antes,
        mensajes: mezclar([...viejas, ...b.mensajes], c),
        hayMas: viejas.length ? antes.hayMas : b.hayMas,
        leidoHasta: b.leidoHasta,
        enLinea: !!b.enLinea,
        error: '',
      };
      const cambio = huellaHilo(nuevo) !== huellaHilo(antes) || antes.mensajes === null;
      if (cambio) h.set(nuevo);
      return cambio;
    } catch (e) {
      if (RELEVO.quien() !== cuenta) return false;
      // El error primero (ver `refrescarLista`): un 401 vacía el hilo al salir de la cuenta.
      const error = errorDe(e);
      const antes = h.get();
      h.set({ ...antes, mensajes: antes.mensajes ?? mezclar([], c), error });
      return false;
    } finally {
      hilosEnCurso.delete(c);
    }
  })();
  hilosEnCurso.set(c, p);
  return p;
}

/** Los mensajes de antes (al subir hasta arriba). */
export async function cargarAnteriores(correo: string) {
  const c = String(correo).toLowerCase();
  const h = hiloDe(c);
  const v = h.get();
  const primero = (v.mensajes || []).find((m) => !m.pendiente && !m.fallido);
  if (!v.hayMas || v.cargandoAntes || !primero) return;
  h.set({ ...v, cargandoAntes: true });
  try {
    const cuenta = RELEVO.quien();
    const b = await RELEVO.bandeja(c, primero.cuando);
    if (RELEVO.quien() !== cuenta) return;
    const ahora = h.get();
    const ids = new Set((ahora.mensajes || []).map((m) => m.id));
    h.set({ ...ahora, mensajes: [...b.mensajes.filter((m) => !ids.has(m.id)), ...(ahora.mensajes || [])], hayMas: b.hayMas, cargandoAntes: false });
  } catch {
    h.set({ ...h.get(), cargandoAntes: false });
  }
}

/* ── el sondeo: sin solaparse y espaciándose ─────────────────────────────────────────────── */

// Apareció la cuenta: lo que ya estaba montado pregunta en el acto.
RELEVO.escucharCuenta(() => {
  if (RELEVO.quien()) for (const f of [...alVolver]) f();
});

/**
 * Repite `tarea`. La siguiente vuelta se agenda al TERMINAR la anterior (nunca se pisan). Con
 * `soloVisible`, con la ventana escondida no se pregunta (se retoma al volver). Devuelve cómo pararlo.
 */
function sondear(tarea: () => Promise<unknown>, espera: () => number, despertador?: { tocar?: () => void }, soloVisible = true): () => void {
  let vivo = true;
  let t: ReturnType<typeof setTimeout> | null = null;
  let corriendo = false;
  const vuelta = async () => {
    t = null;
    if (!vivo || corriendo) return;
    const toca = !soloVisible || ventanaVisible();
    if (toca) {
      corriendo = true;
      await tarea().catch(() => undefined);
      corriendo = false;
    }
    if (vivo && !t && (toca || !soloVisible)) t = setTimeout(vuelta, espera());
  };
  const ya = () => {
    if (!vivo) return;
    if (t) clearTimeout(t);
    t = null;
    void vuelta();
  };
  if (despertador) despertador.tocar = ya;
  alVolver.add(ya);
  void vuelta();
  return () => {
    vivo = false;
    alVolver.delete(ya);
    if (t) clearTimeout(t);
  };
}

const ritmo = new Map<string, { quietas: number; despertador: { tocar?: () => void } }>();

function apurar(correo: string, ya = false) {
  const r = ritmo.get(correo);
  if (!r) return;
  r.quietas = 0;
  if (ya) r.despertador.tocar?.();
}

const esperaHilo = (quietas: number) => (quietas < 3 ? 4000 : quietas < 10 ? 8000 : 15_000);

/** Abre el hilo con alguien: lo trae, lo sondea con cabeza y marca leído lo que llega. Devuelve cómo cerrarlo. */
export function abrirHilo(correo: string): () => void {
  const c = String(correo).toLowerCase();
  const r = { quietas: 0, despertador: {} as { tocar?: () => void } };
  ritmo.set(c, r);
  abiertoAhora = c;
  let ultimoAjeno = 0;
  const tarea = async () => {
    const cambio = await refrescarHilo(c);
    r.quietas = cambio ? 0 : r.quietas + 1;
    const ms = hiloDe(c).get().mensajes || [];
    const ajeno = ms.reduce((max, m) => (m.de === c && m.cuando > max ? m.cuando : max), 0);
    if (ajeno > ultimoAjeno) {
      ultimoAjeno = ajeno;
      void RELEVO.leido(c);
      quitarSinLeer(c);
    }
  };
  const parar = sondear(tarea, () => esperaHilo(r.quietas), r.despertador);
  void RELEVO.leido(c);
  quitarSinLeer(c);
  return () => {
    parar();
    if (ritmo.get(c) === r) ritmo.delete(c);
    if (abiertoAhora === c) abiertoAhora = null;
  };
}

function quitarSinLeer(correo: string) {
  const v = lista.get();
  if (!v.conversaciones?.some((x) => x.correo === correo && x.sinLeer)) return;
  lista.set({ ...v, conversaciones: v.conversaciones.map((x) => (x.correo === correo ? { ...x, sinLeer: 0 } : x)) });
}

/** Cuántos mensajes sin leer hay en total (el punto del menú lateral). */
export const totalSinLeer = () => (lista.get().conversaciones || []).reduce((n, c) => n + (c.sinLeer || 0), 0);

/* ── enviar ───────────────────────────────────────────────────────────────────────────────── */

export type Envio = { ok: true; id?: string; e2e: boolean } | { ok: false; motivo: string; code?: number };

function ponerLocal(correo: string, m: MensajeHilo) {
  const otros = (locales.get(correo) || []).filter((x) => x.id !== m.id);
  locales.set(correo, [...otros, m]);
  const h = hiloDe(correo);
  const v = h.get();
  const resto = (v.mensajes || []).filter((x) => x.id !== m.id);
  h.set({ ...v, mensajes: [...resto, m].sort((a, b) => a.cuando - b.cuando) });
}

function cambiarLocal(correo: string, id: string, cambio: Partial<MensajeHilo>) {
  locales.set(
    correo,
    (locales.get(correo) || []).map((x) => (x.id === id ? { ...x, ...cambio } : x)),
  );
  const h = hiloDe(correo);
  const v = h.get();
  h.set({ ...v, mensajes: (v.mensajes || []).map((x) => (x.id === id ? { ...x, ...cambio } : x)) });
}

let serie = 0;
const idLocal = () => `local-${Date.now().toString(36)}-${++serie}`;

function motivoDe(e: any): string {
  return e?.motivo || (e?.code ? 'http-' + e.code : 'sin-red');
}

/**
 * Envía un texto cifrado. Aparece en el hilo en el acto (pendiente), se confirma con el id del relevo
 * y, si falla, queda `fallido` en el hilo, con su texto, para reintentar.
 */
export async function enviarTexto(correo: string, texto: string, reintento?: string, o: { sinCifrar?: boolean } = {}): Promise<Envio> {
  const c = String(correo).toLowerCase();
  const limpio = texto.trim();
  if (!limpio) return { ok: false, motivo: 'vacio' };
  const yo = RELEVO.quien();
  if (!yo) return { ok: false, motivo: 'sin-cuenta' };
  const id = reintento || idLocal();
  ponerLocal(c, { id, de: yo.correo, para: c, cuando: Date.now(), texto: limpio, pendiente: true, e2e: undefined });
  apurar(c);
  try {
    const r = await RELEVO.enviar(c, limpio, { sinCifrar: o.sinCifrar === true });
    cambiarLocal(c, id, { id: r.id || id, pendiente: false, fallido: false, e2e: r.e2e });
    void refrescarHilo(c);
    void refrescarLista();
    return { ok: true, id: r.id, e2e: r.e2e };
  } catch (e: any) {
    cambiarLocal(c, id, { pendiente: false, fallido: true, motivoFallo: motivoDe(e) });
    if (e?.code === 401) errorDe(e);
    return { ok: false, motivo: motivoDe(e), code: e?.code };
  }
}

/** Envía una foto cifrada; mientras sube se ve en el hilo con la imagen local. */
export async function enviarFoto(correo: string, bytes: Uint8Array, mime: string, vistaPrevia: string, texto = ''): Promise<Envio> {
  const c = String(correo).toLowerCase();
  const yo = RELEVO.quien();
  if (!yo) return { ok: false, motivo: 'sin-cuenta' };
  const id = idLocal();
  ponerLocal(c, { id, de: yo.correo, para: c, cuando: Date.now(), texto, tipo: 'imagen', archivo: vistaPrevia, pendiente: true, e2e: undefined });
  apurar(c);
  try {
    const r = await RELEVO.enviarFoto(c, bytes, mime, texto);
    // Se quita la local: la de verdad (con su archivo en el relevo) llega en la próxima vuelta.
    descartarFallido(c, id);
    await refrescarHilo(c);
    void refrescarLista();
    return { ok: true, id: r.id, e2e: true };
  } catch (e: any) {
    cambiarLocal(c, id, { pendiente: false, fallido: true, motivoFallo: motivoDe(e) });
    return { ok: false, motivo: motivoDe(e), code: e?.code };
  }
}

/** Vuelve a mandar uno que falló (mismo texto, mismo lugar en el hilo). Las fotos no se reintentan. */
export function reintentar(correo: string, id: string): Promise<Envio> {
  const c = String(correo).toLowerCase();
  const m = (locales.get(c) || []).find((x) => x.id === id);
  if (!m || m.tipo === 'imagen') return Promise.resolve({ ok: false, motivo: 'no-esta' });
  return enviarTexto(c, m.texto, id);
}

/** Quita del hilo uno que falló y no se quiere reintentar. */
export function descartarFallido(correo: string, id: string) {
  const c = String(correo).toLowerCase();
  locales.set(
    c,
    (locales.get(c) || []).filter((x) => x.id !== id),
  );
  const h = hiloDe(c);
  const v = h.get();
  h.set({ ...v, mensajes: (v.mensajes || []).filter((x) => x.id !== id) });
}

/* ── amistades ────────────────────────────────────────────────────────────────────────────── */

export async function responder(de: string, aceptar: boolean): Promise<boolean> {
  try {
    await RELEVO.responderAmistad(de, aceptar);
    await refrescarLista();
    return true;
  } catch {
    return false;
  }
}

/** Pide amistad. Devuelve el estado: 'enviada' | 'amigos' | 'no-esta' | 'demasiadas' | 'no-se-puede' | 'sin-red'. */
export async function agregar(correo: string): Promise<string> {
  try {
    const r = await RELEVO.pedirAmistad(correo);
    void refrescarLista();
    return r?.estado || 'enviada';
  } catch (e: any) {
    if (e?.code === 404) return 'no-esta';
    if (e?.code === 429) return 'demasiadas';
    if (e?.code === 403) return 'no-se-puede';
    return 'sin-red';
  }
}

/** Al salir de la cuenta: nada de lo de esta persona queda en memoria. */
export function vaciar() {
  lista.set({ conversaciones: null, circulo: null, error: '' });
  for (const h of hilos.values()) h.set(HILO_VACIO);
  locales.clear();
  escriben.set({});
}
RELEVO.alSalir(vaciar);
