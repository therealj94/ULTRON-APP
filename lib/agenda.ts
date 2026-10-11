/**
 * LA AGENDA DEL PLANIFICADOR (Fase 2): qué hay que mirar sin que nadie lo pida — una tarea `queued` que nadie corre, una
 * `proximaRevision` que llegó, un objetivo `incierto` que hay que reconciliar.
 *
 * Por qué aparte: las tareas y los objetivos viven POR DUEÑO (la clave lleva la huella del correo, que no se puede
 * deshacer). Para encontrarlos después de un reinicio, sin que nadie abra la app, hace falta saber de quién son. Aquí
 * vive UNA lista durable (lib/durable.ts, con compare-and-set) con lo mínimo para volver a ellos: el tipo, el id, cuándo
 * toca y la identidad del dueño (el correo de su sesión o su `veta:0x…`; como el índice de los recordatorios del
 * servidor). Nada del contenido: ni títulos, ni textos, ni borradores.
 *
 * Reglas:
 *  · agendar es idempotente: la misma cosa (tipo + dueño + id) tiene UNA entrada; si ya estaba, se queda la hora más
 *    temprana (lo que ya tocaba no se atrasa) y su marca `t` sube (otra réplica la volvió a pedir);
 *  · quitar es condicional a la marca: si alguien la volvió a agendar mientras el planificador la trabajaba, se queda;
 *  · un fallo del almacén no es «no hay nada»: `ok: false`;
 *  · EX-02: no poder agendar no es un silencio. `agendarDetallado` dice por qué (`lleno` o `almacen`) y quien agenda una
 *    tarea lo anota en los «despertares pendientes» (otra lista, otra clave) y en el propio objeto, para repararlo.
 */
import { almacenDurable, claveDe, huellaDueno, modificarDurable, type AlmacenDurable } from './durable';

/** `aviso` (F04): un aviso «necesito tu decisión» de la bandeja de salida (lib/avisos-decision.ts). */
export type TipoAgenda = 'tarea' | 'objetivo' | 'aviso';
/** `intentos`: cuántas veces el planificador intentó arrancarla sin poder (vive aquí: un reinicio no lo pierde). */
export type EntradaAgenda = { k: string; tipo: TipoAgenda; dueno: string; id: string; cuando: number; t: number; intentos?: number };
type Agenda = { v: 1; entradas: EntradaAgenda[] };

/** Cuántas entradas como mucho (una agenda llena no crece: se avisa y no se agenda más). */
export const MAX_AGENDA = 5000;
const DUENO_AGENDA = 'aura-planificador';
const claveAgenda = () => claveDe('planificador', DUENO_AGENDA, 'agenda');

/** La llave de una entrada: tipo, huella del dueño e id (dos dueños con el mismo id son dos entradas). */
export const llaveAgenda = (tipo: TipoAgenda, dueno: string, id: string) => `${tipo}:${huellaDueno(dueno)}:${id}`;

let avisado = 0;
function avisar(que: string) {
  const t = Date.now();
  if (t - avisado < 600_000) return;
  avisado = t;
  console.warn(`[agenda] ${que}`);
}

/**
 * Por qué no quedó en la agenda (EX-02): `lleno` (la agenda llegó a MAX_AGENDA: un estado visible y recuperable, no un
 * silencio), `almacen` (no se pudo leer o escribir) o `invalida` (sin dueño o sin id).
 */
export type ResultadoAgendar = { ok: true } | { ok: false; motivo: 'lleno' | 'almacen' | 'invalida'; detalle?: string };

/**
 * Agenda (o adelanta) algo para `cuando` y dice por qué no, si no pudo. Nunca lanza. `soloSiFalta`: si ya hay una entrada
 * para eso, no se toca (ni su hora ni su marca `t` ni sus `intentos`): lo usan las reparaciones, que solo quieren que
 * EXISTA el despertar sin mover lo que el planificador ya decidió (un «mañana» por el tope diario, un reintento).
 */
export async function agendarDetallado(tipo: TipoAgenda, dueno: string, id: string, cuando: number, o: { almacen?: AlmacenDurable; ahora?: number; soloSiFalta?: boolean } = {}): Promise<ResultadoAgendar> {
  const d = String(dueno || '').trim().toLowerCase();
  if (!d || !id) return { ok: false, motivo: 'invalida' };
  const k = llaveAgenda(tipo, d, id);
  const t = o.ahora ?? Date.now();
  let lleno = false;
  const r = await modificarDurable<Agenda>(
    claveAgenda(),
    (ag) => {
      lleno = false;
      const entradas = ag?.entradas || [];
      const i = entradas.findIndex((e) => e.k === k);
      if (i >= 0) {
        if (o.soloSiFalta) return undefined;
        const e = entradas[i];
        entradas[i] = { ...e, cuando: Math.min(e.cuando, cuando), t: Math.max(t, e.t + 1) };
        return { v: 1, entradas };
      }
      if (entradas.length >= MAX_AGENDA) {
        lleno = true;
        return undefined;
      }
      return { v: 1, entradas: [...entradas, { k, tipo, dueno: d, id, cuando, t }] };
    },
    o.almacen || almacenDurable()
  ).catch((e) => ({ ok: false as const, conflicto: false, detalle: String(e?.message || e) }));
  if (r.ok === false) {
    avisar(`no pude agendar (${r.detalle.slice(0, 100)})`);
    return { ok: false, motivo: 'almacen', detalle: r.detalle };
  }
  if (lleno) {
    avisar('la agenda del planificador está llena: no agendé más (queda en los despertares pendientes)');
    return { ok: false, motivo: 'lleno' };
  }
  return { ok: true };
}

/** Agenda (o adelanta) algo para `cuando`. true si quedó en la agenda. Nunca lanza. */
export async function agendar(tipo: TipoAgenda, dueno: string, id: string, cuando: number, o: { almacen?: AlmacenDurable; ahora?: number } = {}): Promise<boolean> {
  return (await agendarDetallado(tipo, dueno, id, cuando, o)).ok;
}

/** La agenda entera (ordenada por hora). `ok: false` si el almacén no contestó. */
export async function leerAgenda(a: AlmacenDurable = almacenDurable()): Promise<{ ok: true; entradas: EntradaAgenda[] } | { ok: false; detalle: string }> {
  const l = await a.leer<Agenda>(claveAgenda()).catch((e) => ({ ok: false as const, detalle: String(e?.message || e) }));
  if (l.ok === false) return { ok: false, detalle: l.detalle };
  const entradas = (l.valor?.entradas || []).filter((e) => e && typeof e.k === 'string' && (e.tipo === 'tarea' || e.tipo === 'objetivo' || e.tipo === 'aviso'));
  return { ok: true, entradas: entradas.sort((x, y) => x.cuando - y.cuando) };
}

/**
 * Lo que el planificador terminó con una entrada: `quitar` (no queda nada que hacer) o `cuando` (la próxima vez). Solo si
 * la entrada sigue con la marca `t` que vio (si otro la volvió a agendar entretanto, se queda como la dejó ese otro).
 */
export async function cerrarEntrada(k: string, t: number, siguiente: { quitar: true } | { cuando: number; intentos?: number }, a: AlmacenDurable = almacenDurable()): Promise<boolean> {
  const r = await modificarDurable<Agenda>(
    claveAgenda(),
    (ag) => {
      const entradas = ag?.entradas || [];
      const i = entradas.findIndex((e) => e.k === k);
      if (i < 0 || entradas[i].t !== t) return undefined;
      if ('quitar' in siguiente) return { v: 1, entradas: entradas.filter((_, j) => j !== i) };
      entradas[i] = { ...entradas[i], cuando: siguiente.cuando, ...(siguiente.intentos !== undefined ? { intentos: siguiente.intentos } : {}) };
      return { v: 1, entradas };
    },
    a
  ).catch(() => null);
  return !!r && r.ok === true && r.cambiado;
}

/* ------------------------------------------------------------------ despertares pendientes (EX-02) */

/**
 * Lo que se quiso agendar y no se pudo (la agenda llena o el almacén caído): una lista durable APARTE (otra clave: si la
 * agenda está llena o su escritura falla, esta sigue escribiéndose) para que `repararDespertares`
 * (lib/tareas-durables.ts), que llama el planificador en cada vuelta, la encuentre sin saber de quién es cada tarea.
 * Igual que la agenda: lo mínimo (tipo, id, dueño y por qué), nada del contenido. La verdad sigue en el objeto (su marca
 * `despertar`): esta lista solo dice dónde mirar; una entrada cuya tarea ya no tiene marca se quita sin más.
 */
export type MotivoPendiente = 'agenda-llena' | 'almacen' | 'sin-confirmar';
export type DespertarPendiente = { k: string; tipo: TipoAgenda; dueno: string; id: string; motivo: MotivoPendiente; t: number };
type Pendientes = { v: 1; entradas: DespertarPendiente[] };
/** Cuántos despertares pendientes como mucho (con la agenda llena, lo que no cabe aquí aún tiene su marca en el objeto). */
export const MAX_PENDIENTES = 5000;
const clavePendientes = () => claveDe('planificador', DUENO_AGENDA, 'despertares');

/** Anota (o refresca) un despertar pendiente. true si quedó anotado. Nunca lanza. */
export async function anotarDespertarPendiente(tipo: TipoAgenda, dueno: string, id: string, motivo: MotivoPendiente, o: { almacen?: AlmacenDurable; ahora?: number } = {}): Promise<boolean> {
  const d = String(dueno || '').trim().toLowerCase();
  if (!d || !id) return false;
  const k = llaveAgenda(tipo, d, id);
  const t = o.ahora ?? Date.now();
  let lleno = false;
  const r = await modificarDurable<Pendientes>(
    clavePendientes(),
    (p) => {
      lleno = false;
      const entradas = p?.entradas || [];
      const i = entradas.findIndex((e) => e.k === k);
      if (i >= 0) {
        entradas[i] = { ...entradas[i], motivo, t: Math.max(t, entradas[i].t + 1) };
        return { v: 1, entradas };
      }
      if (entradas.length >= MAX_PENDIENTES) {
        lleno = true;
        return undefined;
      }
      return { v: 1, entradas: [...entradas, { k, tipo, dueno: d, id, motivo, t }] };
    },
    o.almacen || almacenDurable()
  ).catch((e) => ({ ok: false as const, conflicto: false, detalle: String(e?.message || e) }));
  if (lleno) {
    // Desborde (Codex, PR #181): la lista está llena; el dueño queda en otra lista, chica (una entrada por cuenta),
    // para que la vuelta del planificador revise sus tareas por su índice. Así la tarea sigue siendo descubrible.
    avisar('la lista de despertares pendientes está llena: se anota la cuenta para revisar sus tareas');
    return anotarDuenoDesbordado(d, o);
  }
  return r.ok === true;
}

/* Cuentas con despertares que no cupieron en la lista: la reparación las recorre por su índice de tareas. */
type Desbordados = { v: 1; duenos: { dueno: string; t: number }[] };
/** Tope de cuentas desbordadas (muy por encima de las cuentas reales; si se llena, se avisa). */
export const MAX_DESBORDADOS = 20000;
const claveDesbordados = () => claveDe('planificador', DUENO_AGENDA, 'despertares-desbordados');

/** Anota una cuenta cuyo despertar no cupo en la lista. true si quedó anotada. Nunca lanza. */
export async function anotarDuenoDesbordado(dueno: string, o: { almacen?: AlmacenDurable; ahora?: number } = {}): Promise<boolean> {
  const d = String(dueno || '').trim().toLowerCase();
  if (!d) return false;
  const t = o.ahora ?? Date.now();
  let lleno = false;
  const r = await modificarDurable<Desbordados>(
    claveDesbordados(),
    (p) => {
      lleno = false;
      const duenos = p?.duenos || [];
      const i = duenos.findIndex((x) => x.dueno === d);
      if (i >= 0) {
        duenos[i] = { dueno: d, t: Math.max(t, duenos[i].t + 1) };
        return { v: 1, duenos };
      }
      if (duenos.length >= MAX_DESBORDADOS) {
        lleno = true;
        return undefined;
      }
      return { v: 1, duenos: [...duenos, { dueno: d, t }] };
    },
    o.almacen || almacenDurable()
  ).catch(() => null);
  if (lleno) avisar('la lista de cuentas desbordadas está llena: la marca queda solo en el objeto');
  return !!r && r.ok === true && !lleno;
}

/** Las cuentas desbordadas (la más vieja primero). `ok: false` si el almacén no contestó. */
export async function leerDuenosDesbordados(a: AlmacenDurable = almacenDurable()): Promise<{ ok: true; duenos: { dueno: string; t: number }[] } | { ok: false; detalle: string }> {
  const l = await a.leer<Desbordados>(claveDesbordados()).catch((e) => ({ ok: false as const, detalle: String(e?.message || e) }));
  if (l.ok === false) return { ok: false, detalle: l.detalle };
  const duenos = (l.valor?.duenos || []).filter((x) => x && typeof x.dueno === 'string');
  return { ok: true, duenos: duenos.sort((x, y) => x.t - y.t) };
}

/** Quita una cuenta desbordada, solo si sigue con la marca `t` que se vio. */
export async function quitarDuenoDesbordado(dueno: string, t: number, a: AlmacenDurable = almacenDurable()): Promise<boolean> {
  const r = await modificarDurable<Desbordados>(
    claveDesbordados(),
    (p) => {
      const duenos = p?.duenos || [];
      const i = duenos.findIndex((x) => x.dueno === dueno);
      if (i < 0 || duenos[i].t !== t) return undefined;
      return { v: 1, duenos: duenos.filter((_, j) => j !== i) };
    },
    a
  ).catch(() => null);
  return !!r && r.ok === true && r.cambiado;
}

/** Los despertares pendientes (el más viejo primero). `ok: false` si el almacén no contestó. */
export async function leerDespertaresPendientes(a: AlmacenDurable = almacenDurable()): Promise<{ ok: true; entradas: DespertarPendiente[] } | { ok: false; detalle: string }> {
  const l = await a.leer<Pendientes>(clavePendientes()).catch((e) => ({ ok: false as const, detalle: String(e?.message || e) }));
  if (l.ok === false) return { ok: false, detalle: l.detalle };
  const entradas = (l.valor?.entradas || []).filter((e) => e && typeof e.k === 'string' && typeof e.dueno === 'string' && typeof e.id === 'string');
  return { ok: true, entradas: entradas.sort((x, y) => x.t - y.t) };
}

/** Quita un despertar pendiente, solo si sigue con la marca `t` que se vio (si otro lo volvió a anotar, se queda). */
export async function quitarDespertarPendiente(k: string, t: number, a: AlmacenDurable = almacenDurable()): Promise<boolean> {
  const r = await modificarDurable<Pendientes>(
    clavePendientes(),
    (p) => {
      const entradas = p?.entradas || [];
      const i = entradas.findIndex((e) => e.k === k);
      if (i < 0 || entradas[i].t !== t) return undefined;
      return { v: 1, entradas: entradas.filter((_, j) => j !== i) };
    },
    a
  ).catch(() => null);
  return !!r && r.ok === true && r.cambiado;
}
