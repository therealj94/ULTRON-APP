/**
 * EL ALMACÉN DEL CHAT: la lista de conversaciones, el círculo, cada hilo y quién está escribiendo.
 *
 * Las pantallas lo leen con `useSyncExternalStore` y no piden nada por su cuenta: así la lista, el
 * hilo, la voz (borradores) y la compañera ven lo mismo, y un mensaje enviado por voz aparece en el
 * hilo abierto sin recargar.
 *
 * El sondeo es con cuidado, porque en Android cada vuelta cuesta datos y batería:
 *   · nunca dos peticiones a la vez para lo mismo (la que llega mientras hay una en curso se suma);
 *   · el hilo abierto pregunta cada 4 s y, si nada cambia, se va espaciando hasta 15 s; vuelve a 4 s
 *     en cuanto llega algo, alguien escribe o se envía;
 *   · con la app en segundo plano NO se sondea nada; al volver, se pregunta una vez en el acto.
 * El relevo solo sabe devolver la última página del hilo (no «lo nuevo desde»), así que lo ahorrado
 * de verdad está en `relevo.ts`: lo ya abierto no se vuelve a descifrar.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { emitir } from '../nucleo/contrato';
import * as RELEVO from './relevo';

/* ── un almacén mínimo ────────────────────────────────────────────────────────────────────── */

type Almacen<T> = { get: () => T; set: (v: T) => void; sub: (f: () => void) => () => void };

function almacen<T>(inicial: T): Almacen<T> {
  let v = inicial;
  const oyentes = new Set<() => void>();
  return {
    get: () => v,
    set: (n) => {
      v = n;
      for (const f of [...oyentes]) f();
    },
    sub: (f) => {
      oyentes.add(f);
      return () => {
        oyentes.delete(f);
      };
    },
  };
}

/* ── tipos ────────────────────────────────────────────────────────────────────────────────── */

/** Un mensaje del hilo; los que salieron de aquí y no confirmó el relevo van `pendiente` o `fallido`. */
export type MensajeHilo = RELEVO.Mensaje & { pendiente?: boolean; fallido?: boolean };

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

/* ── desconexión (401: la llave del relevo ya no vale) ────────────────────────────────────── */

const alDesconectar = new Set<() => void>();
/** PulseProvider escucha aquí para salir de la cuenta cuando el relevo ya no la reconoce. */
export function escucharDesconexion(f: () => void): () => void {
  alDesconectar.add(f);
  return () => {
    alDesconectar.delete(f);
  };
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

const lista = almacen<EstadoLista>({ conversaciones: null, circulo: null, error: '' });
let listaEnCurso: Promise<void> | null = null;

/** Trae conversaciones y círculo. Si ya hay una vuelta en curso, espera esa. */
export function refrescarLista(): Promise<void> {
  if (listaEnCurso) return listaEnCurso;
  if (!RELEVO.quien()) return Promise.resolve();
  listaEnCurso = (async () => {
    try {
      const [conversaciones, circulo] = await Promise.all([RELEVO.conversaciones(), RELEVO.circulo()]);
      // Los grupos se ven en la app Orden Global: desde aquí no hay llaves de grupo y saldría en claro.
      lista.set({ conversaciones: conversaciones.filter((c) => !c.esGrupo), circulo, error: '' });
    } catch (e) {
      const v = lista.get();
      lista.set({ ...v, conversaciones: v.conversaciones ?? [], error: errorDe(e) });
    } finally {
      listaEnCurso = null;
    }
  })();
  return listaEnCurso;
}

export const estadoLista = () => lista.get();

/** La lista viva: se trae al montar, cada 15 s con la app delante, y en el acto al volver a ella. */
export function useLista(): EstadoLista {
  const v = useSyncExternalStore(lista.sub, lista.get, lista.get);
  useEffect(() => sondear(refrescarLista, () => 15_000), []);
  return v;
}

/** La lista tal como está, sin sondear (el hilo la usa para el nombre y la foto de la otra persona). */
export function useListaQuieta(): EstadoLista {
  return useSyncExternalStore(lista.sub, lista.get, lista.get);
}

/* ── quién está escribiendo ───────────────────────────────────────────────────────────────── */

const escriben = almacen<Record<string, number>>({});
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
    // Dejó de escribir: casi siempre porque mandó. Se pregunta ya, sin esperar la vuelta.
    for (const k of Object.keys(v)) if (!quedan[k]) apurar(k, true);
  }, 4100);
}

export function useEscribiendo(): Record<string, number> {
  return useSyncExternalStore(escriben.sub, escriben.get, escriben.get);
}

export const estaEscribiendo = (mapa: Record<string, number>, correo: string) => (mapa[String(correo).toLowerCase()] || 0) > Date.now();

/* ── los hilos ────────────────────────────────────────────────────────────────────────────── */

const hilos = new Map<string, Almacen<EstadoHilo>>();
const hilosEnCurso = new Map<string, Promise<boolean>>();
/** Lo enviado desde aquí que el relevo todavía no devolvió en la bandeja. */
const locales = new Map<string, MensajeHilo[]>();

function hiloDe(correo: string): Almacen<EstadoHilo> {
  const c = String(correo).toLowerCase();
  let h = hilos.get(c);
  if (!h) hilos.set(c, (h = almacen<EstadoHilo>(HILO_VACIO)));
  return h;
}

export const estadoHilo = (correo: string) => hiloDe(correo).get();

/** Lo del relevo más lo local que aún no aparece allí, en orden. */
function mezclar(del: RELEVO.Mensaje[], correo: string): MensajeHilo[] {
  const ids = new Set(del.map((m) => m.id));
  const propios = (locales.get(correo) || []).filter((m) => !ids.has(m.id));
  locales.set(correo, propios);
  return propios.length ? [...del, ...propios].sort((a, b) => a.cuando - b.cuando) : del;
}

/** Firma barata de lo visible: si no cambió, el sondeo se espacia. */
const huella = (e: EstadoHilo) => {
  const m = e.mensajes || [];
  const u = m[m.length - 1];
  return `${m.length}|${u?.id}|${u?.pendiente ? 1 : 0}|${e.leidoHasta}|${e.enLinea ? 1 : 0}|${m.filter((x) => x.borrado).length}`;
};

/** Trae la última página del hilo. Devuelve true si algo cambió. Nunca dos a la vez por hilo. */
export function refrescarHilo(correo: string): Promise<boolean> {
  const c = String(correo).toLowerCase();
  const ya = hilosEnCurso.get(c);
  if (ya) return ya;
  if (!RELEVO.quien()) return Promise.resolve(false);
  const p = (async () => {
    const h = hiloDe(c);
    try {
      const b = await RELEVO.bandeja(c);
      const antes = h.get();
      // Si ya había páginas viejas cargadas, se conservan: la bandeja trae solo lo último.
      const viejas = (antes.mensajes || []).filter((m) => !m.pendiente && !m.fallido && b.mensajes.length && m.cuando < b.mensajes[0].cuando);
      const nuevo: EstadoHilo = {
        ...antes,
        mensajes: mezclar([...viejas, ...b.mensajes], c),
        hayMas: viejas.length ? antes.hayMas : b.hayMas,
        leidoHasta: b.leidoHasta,
        enLinea: !!b.enLinea,
        error: '',
      };
      const cambio = huella(nuevo) !== huella(antes) || antes.mensajes === null;
      h.set(nuevo);
      return cambio;
    } catch (e) {
      const antes = h.get();
      h.set({ ...antes, mensajes: antes.mensajes ?? mezclar([], c), error: errorDe(e) });
      return false;
    } finally {
      hilosEnCurso.delete(c);
    }
  })();
  hilosEnCurso.set(c, p);
  return p;
}

/** Los mensajes de antes (desplazándose hacia arriba). */
export async function cargarAnteriores(correo: string) {
  const c = String(correo).toLowerCase();
  const h = hiloDe(c);
  const v = h.get();
  const primero = (v.mensajes || []).find((m) => !m.pendiente && !m.fallido);
  if (!v.hayMas || v.cargandoAntes || !primero) return;
  h.set({ ...v, cargandoAntes: true });
  try {
    const b = await RELEVO.bandeja(c, primero.cuando);
    const ahora = h.get();
    const ids = new Set((ahora.mensajes || []).map((m) => m.id));
    h.set({ ...ahora, mensajes: [...b.mensajes.filter((m) => !ids.has(m.id)), ...(ahora.mensajes || [])], hayMas: b.hayMas, cargandoAntes: false });
  } catch {
    h.set({ ...h.get(), cargandoAntes: false });
  }
}

/* ── el sondeo: con la app delante, sin solaparse y espaciándose ─────────────────────────── */

let activa = AppState.currentState === 'active';
const alVolver = new Set<() => void>();
AppState.addEventListener('change', (st: AppStateStatus) => {
  const antes = activa;
  activa = st === 'active';
  if (activa && !antes) for (const f of [...alVolver]) f();
});

/**
 * Repite `tarea` mientras haya quien mire. La siguiente vuelta se agenda al TERMINAR la anterior
 * (nunca se pisan) y solo con la app delante. Devuelve la función que lo para.
 */
function sondear(tarea: () => Promise<unknown>, espera: () => number, despertador?: { tocar?: () => void }): () => void {
  let vivo = true;
  let t: ReturnType<typeof setTimeout> | null = null;
  const vuelta = async () => {
    t = null;
    if (!vivo) return;
    if (activa) await tarea().catch(() => undefined);
    if (vivo && activa && !t) t = setTimeout(vuelta, espera());
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

/** Solo para pruebas: el mismo sondeo que usan los ganchos. */
export const _sondearParaPruebas = sondear;

/** Por hilo abierto: cuántas vueltas seguidas sin cambios (para espaciar) y cómo despertarlo. */
const ritmo = new Map<string, { quietas: number; despertador: { tocar?: () => void } }>();

function apurar(correo: string, ya = false) {
  const r = ritmo.get(correo);
  if (!r) return;
  r.quietas = 0;
  if (ya) r.despertador.tocar?.();
}

const esperaHilo = (quietas: number) => (quietas < 3 ? 4000 : quietas < 10 ? 8000 : 15_000);

/** El hilo vivo con alguien: lo trae, lo sondea con cabeza y marca leído lo que llega. */
export function useHilo(correo: string): EstadoHilo {
  const c = String(correo).toLowerCase();
  const h = hiloDe(c);
  const v = useSyncExternalStore(h.sub, h.get, h.get);
  useEffect(() => {
    const r = { quietas: 0, despertador: {} as { tocar?: () => void } };
    ritmo.set(c, r);
    let ultimoAjeno = 0;
    const tarea = async () => {
      const cambio = await refrescarHilo(c);
      r.quietas = cambio ? 0 : r.quietas + 1;
      // Lo que llegó de la otra persona con el hilo abierto ya está visto.
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
    };
  }, [c]);
  return v;
}

function quitarSinLeer(correo: string) {
  const v = lista.get();
  if (!v.conversaciones?.some((x) => x.correo === correo && x.sinLeer)) return;
  lista.set({ ...v, conversaciones: v.conversaciones.map((x) => (x.correo === correo ? { ...x, sinLeer: 0 } : x)) });
}

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
    (locales.get(correo) || []).map((x) => (x.id === id ? { ...x, ...cambio } : x))
  );
  const h = hiloDe(correo);
  const v = h.get();
  h.set({ ...v, mensajes: (v.mensajes || []).map((x) => (x.id === id ? { ...x, ...cambio } : x)) });
}

let serie = 0;

/**
 * Envía un texto con el cifrado normal. Aparece en el hilo en el acto (pendiente), se confirma con el
 * id del relevo y avisa `enviado` (la palomita, el «listo» de AURA). Si falla queda `fallido` en el
 * hilo, con su texto, para reintentar.
 */
export async function enviarTexto(correo: string, texto: string, reintento?: string): Promise<Envio> {
  const c = String(correo).toLowerCase();
  const limpio = texto.trim();
  if (!limpio) return { ok: false, motivo: 'vacio' };
  const yo = RELEVO.quien();
  if (!yo) return { ok: false, motivo: 'sin-cuenta' };
  const idLocal = reintento || `local-${Date.now().toString(36)}-${++serie}`;
  ponerLocal(c, { id: idLocal, de: yo.correo, para: c, cuando: Date.now(), texto: limpio, pendiente: true, e2e: true });
  apurar(c);
  try {
    const r = await RELEVO.enviar(c, limpio);
    cambiarLocal(c, idLocal, { id: r.id || idLocal, pendiente: false, e2e: r.e2e });
    emitir('enviado', { para: c, id: r.id });
    void refrescarHilo(c);
    void refrescarLista();
    return { ok: true, id: r.id, e2e: r.e2e };
  } catch (e: any) {
    cambiarLocal(c, idLocal, { pendiente: false, fallido: true });
    if (e?.code === 401) errorDe(e);
    return { ok: false, motivo: e?.motivo || (e?.code ? 'http-' + e.code : 'sin-red'), code: e?.code };
  }
}

/** Vuelve a mandar uno que falló (mismo texto, mismo lugar en el hilo). */
export function reintentar(correo: string, id: string): Promise<Envio> {
  const c = String(correo).toLowerCase();
  const m = (locales.get(c) || []).find((x) => x.id === id);
  if (!m) return Promise.resolve({ ok: false, motivo: 'no-esta' });
  return enviarTexto(c, m.texto, id);
}

/** Quita del hilo uno que falló y no se quiere reintentar. */
export function descartarFallido(correo: string, id: string) {
  const c = String(correo).toLowerCase();
  locales.set(
    c,
    (locales.get(c) || []).filter((x) => x.id !== id)
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
