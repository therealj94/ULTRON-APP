/**
 * EL LIBRO DE COMPROMISOS (Fase 2): lo que AURA dijo que haría después —«te aviso», «lo dejo listo», «mañana lo
 * reviso»— queda ANOTADO, para que no se pierda entre conversaciones. Por ahora solo es registro: no avisa, no recuerda y
 * no hace nada por su cuenta; tampoco dice que se cumplió.
 *
 * La detección es la de las promesas (lib/promesas.ts `frasesDeCompromiso`: las mismas exclusiones de preguntas, ofertas
 * condicionales y negaciones). Lo durable, lib/durable.ts: `compromisos/<huella del dueño>/<id>` y un índice por dueño.
 * El id sale del dueño, la frase y la ventana de tiempo (o el id del turno): el mismo turno procesado dos veces (un
 * reintento, la voz y el JSON) no anota dos veces lo mismo.
 */
import crypto from 'node:crypto';
import { almacenDurable, claveDe, crearUnaVez, huellaDueno, leerDurable, modificarDurable, type AlmacenDurable } from './durable';
import { frasesDeCompromiso } from './promesas';

export type EstadoCompromiso = 'abierto';
export type Compromiso = {
  v: 1;
  id: string;
  /** Huella del dueño (nunca el correo). No sale al cliente. */
  dueno: string;
  texto: string;
  /** Cuándo se dijo. */
  cuando: number;
  /** Para cuándo, si la frase lo dice («mañana», «en 2 horas», «esta tarde»). */
  vence?: number;
  objetivoId?: string;
  estado: EstadoCompromiso;
};

export const MAX_COMPROMISOS_INDICE = 200;
/** Lo mismo dicho dentro de esta ventana (sin id de turno) es el mismo compromiso. */
const VENTANA_MS = 10 * 60_000;
const HN_MS = 6 * 3600_000; // Honduras: UTC−6, sin horario de verano (lib/zona-horaria.ts)

const claveCompromiso = (dueno: string, id: string) => claveDe('compromisos', dueno, id);
const claveIndice = (dueno: string) => claveDe('compromisos/indice', dueno, 'lista');
type Indice = { v: 1; ids: { id: string; t: number }[] };

const plano = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** El instante de una hora de reloj de Honduras en el día de `ahora` + `dias`. */
function horaHN(ahora: number, dias: number, h: number, m = 0): number {
  const local = new Date(ahora - HN_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dias, h, m) + HN_MS;
}

const NUMEROS: Record<string, number> = { un: 1, una: 1, dos: 2, tres: 3, media: 0.5 };
const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

/** Para cuándo lo promete, si lo dice (en hora de Honduras). undefined si no. */
export function venceDe(frase: string, ahora: number): number | undefined {
  const p = plano(frase);
  const en = /\ben (\d+|un|una|dos|tres|media) (minutos?|horas?|dias?)\b/.exec(p);
  if (en) {
    const n = /^\d+$/.test(en[1]) ? Number(en[1]) : NUMEROS[en[1]];
    const u = en[2].startsWith('minuto') ? 60_000 : en[2].startsWith('hora') ? 3600_000 : 86_400_000;
    return ahora + n * u;
  }
  if (/\bpasado manana\b/.test(p)) return horaHN(ahora, 2, 9);
  if (/\bmanana\b/.test(p) && !/\b(esta|en la) manana\b/.test(p)) return horaHN(ahora, 1, 9);
  if (/\besta noche\b/.test(p)) return horaHN(ahora, 0, 21);
  if (/\besta tarde\b/.test(p)) return horaHN(ahora, 0, 17);
  if (/\bhoy\b/.test(p)) return horaHN(ahora, 0, 23, 59);
  const dia = /\bel (lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.exec(p);
  if (dia) {
    const hoy = new Date(ahora - HN_MS).getUTCDay();
    const objetivo = DIAS.indexOf(dia[1]);
    const faltan = ((objetivo - hoy + 7) % 7) || 7;
    return horaHN(ahora, faltan, 9);
  }
  return undefined;
}

/** Los compromisos de una respuesta de AURA (puro): la frase y para cuándo. */
export function detectarCompromisos(texto: string, ahora = Date.now()): { texto: string; vence?: number }[] {
  return frasesDeCompromiso(texto)
    .slice(0, 5)
    .map((f) => {
      const vence = venceDe(f, ahora);
      return { texto: f.slice(0, 240), ...(vence ? { vence } : {}) };
    });
}

/**
 * Anota los compromisos de lo que AURA respondió. Nunca lanza; devuelve los que quedaron (nuevos o ya estaban).
 * `idTurno`: con él, el mismo turno nunca anota dos veces la misma frase.
 */
export async function registrarCompromisos(
  dueno: string,
  respuesta: string,
  o: { objetivoId?: string; idTurno?: string; ahora?: number; almacen?: AlmacenDurable } = {}
): Promise<Compromiso[]> {
  const d = String(dueno || '').trim().toLowerCase();
  if (!d) return [];
  const ahora = o.ahora ?? Date.now();
  const a = o.almacen || almacenDurable();
  const hallados = detectarCompromisos(respuesta, ahora);
  const out: Compromiso[] = [];
  for (const h of hallados) {
    const base = o.idTurno ? `turno:${o.idTurno}` : `v:${Math.floor(ahora / VENTANA_MS)}`;
    const id = `cp_${crypto.createHash('sha256').update(`${huellaDueno(d)}|${base}|${plano(h.texto)}`).digest('hex').slice(0, 24)}`;
    const c: Compromiso = {
      v: 1,
      id,
      dueno: huellaDueno(d),
      texto: h.texto,
      cuando: ahora,
      ...(h.vence ? { vence: h.vence } : {}),
      ...(o.objetivoId && /^ob_[a-z0-9]{8,40}$/.test(o.objetivoId) ? { objetivoId: o.objetivoId } : {}),
      estado: 'abierto',
    };
    try {
      const ix = await modificarDurable<Indice>(claveIndice(d), (x) => (x?.ids.some((e) => e.id === id) ? undefined : { v: 1, ids: [{ id, t: ahora }, ...(x?.ids || [])].slice(0, MAX_COMPROMISOS_INDICE) }), a);
      if (ix.ok === false) continue;
      const r = await crearUnaVez(claveCompromiso(d, id), c, a);
      if (r.ok) out.push(r.valor);
    } catch {
      /* lo mejor posible: es un registro */
    }
  }
  return out;
}

/** Los compromisos del dueño, el más reciente primero. `ok: false` si el índice no se pudo leer. */
export async function listarCompromisos(dueno: string, a: AlmacenDurable = almacenDurable()): Promise<{ ok: true; compromisos: Compromiso[]; noLeidos: number } | { ok: false; detalle: string }> {
  const ix = await leerDurable<Indice>(claveIndice(dueno), a);
  if (ix.ok === false) return { ok: false, detalle: ix.detalle };
  const ids = (ix.valor?.ids || []).map((e) => e.id);
  const compromisos: Compromiso[] = [];
  let noLeidos = 0;
  for (let i = 0; i < ids.length; i += 10) {
    const tanda = await Promise.all(ids.slice(i, i + 10).map((id) => leerDurable<Compromiso>(claveCompromiso(dueno, id), a).catch(() => ({ ok: false as const, detalle: '' }))));
    for (const l of tanda) {
      if (l.ok === false) noLeidos++;
      else if (l.valor && l.valor.dueno === huellaDueno(dueno)) compromisos.push(l.valor);
    }
  }
  return { ok: true, compromisos: compromisos.sort((x, y) => y.cuando - x.cuando), noLeidos };
}

/** Lo que ve el cliente: sin la huella del dueño. */
export function vistaCompromiso(c: Compromiso) {
  const { dueno: _d, v: _v, ...resto } = c;
  return resto;
}
