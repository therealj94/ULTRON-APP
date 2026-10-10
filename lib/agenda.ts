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
 *  · un fallo del almacén no es «no hay nada»: `ok: false`.
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

/** Agenda (o adelanta) algo para `cuando`. true si quedó en la agenda. Nunca lanza. */
export async function agendar(tipo: TipoAgenda, dueno: string, id: string, cuando: number, o: { almacen?: AlmacenDurable; ahora?: number } = {}): Promise<boolean> {
  const d = String(dueno || '').trim().toLowerCase();
  if (!d || !id) return false;
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
  if (lleno) avisar('la agenda del planificador está llena: no agendé más');
  if (r.ok === false) avisar(`no pude agendar (${r.detalle.slice(0, 100)})`);
  return r.ok === true && !lleno;
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
