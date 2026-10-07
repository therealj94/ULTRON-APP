/**
 * CADA CUÁNTO SE REPITE UN RECORDATORIO (auditoría del 7-oct, A-3: «cada lunes junta», «todos los días la pastilla»).
 *
 *   nunca        → una vez
 *   diario       → todos los días a esa hora
 *   laborables   → de lunes a viernes
 *   semanal      → cada semana, el día `dia` (0 = domingo … 6 = sábado)
 *   mensual      → cada mes, el día `dia` (1–31); en un mes más corto, su último día (el 31 en febrero es el 28 o el 29)
 *
 * La hora es la del RELOJ DE PARED en su zona (lib/zona-horaria.ts): «a las 7:00» sigue siendo a las 7:00 aunque la zona
 * tuviera horario de verano. Honduras (UTC−6) no lo tiene, pero aquí no se supone. Puro: sin reloj propio (el instante
 * siempre se pasa) y sin dependencias de fuera.
 */
import { fechaValida, instanteDeLocal, partesLocales, sumarDias, ZONA_POR_OMISION, zonaValida } from './zona-horaria';

export type Repeticion = { tipo: 'nunca' } | { tipo: 'diario' } | { tipo: 'laborables' } | { tipo: 'semanal'; dia: number } | { tipo: 'mensual'; dia: number };
export const TIPOS_REPETICION = ['nunca', 'diario', 'laborables', 'semanal', 'mensual'] as const;

/** Lo más lejos que se busca la próxima vez (un mensual del 31 cae a lo sumo a 31 días; con margen). */
const DIAS_BUSQUEDA = 400;

const DIAS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Un día de la semana dicho («lunes», «miércoles», "monday", 0–6), o null. */
export function diaSemanaDe(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6) return v;
  const s = String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
  if (/^[0-6]$/.test(s)) return Number(s);
  const i = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'].indexOf(s);
  if (i >= 0) return i;
  const j = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(s);
  return j >= 0 ? j : null;
}

/**
 * La repetición con su forma estricta, o null si no vale. Acepta el objeto ({tipo, dia}) o la palabra («diario»,
 * «laborables», «semanal», «mensual»); a «semanal» o «mensual» sin día les pone el de `primera` (el día de la semana o
 * del mes de la primera vez, en su zona).
 */
export function validarRepeticion(v: unknown, primera?: number, zona: string = ZONA_POR_OMISION): Repeticion | null {
  if (v === undefined || v === null || v === '') return { tipo: 'nunca' };
  const o = (typeof v === 'string' ? { tipo: v } : v) as Record<string, unknown>;
  if (!o || typeof o !== 'object') return null;
  const tipo = String(o.tipo ?? '').trim().toLowerCase();
  const p = primera !== undefined && Number.isFinite(primera) ? partesLocales(primera, zona) : null;
  switch (tipo) {
    case 'nunca':
    case 'una':
    case 'una vez':
      return { tipo: 'nunca' };
    case 'diario':
    case 'diaria':
      return { tipo: 'diario' };
    case 'laborables':
    case 'entre semana':
      return { tipo: 'laborables' };
    case 'semanal': {
      const d = o.dia === undefined || o.dia === null || o.dia === '' ? (p ? p.diaSemana : null) : diaSemanaDe(o.dia);
      return d === null ? null : { tipo: 'semanal', dia: d };
    }
    case 'mensual': {
      const n = o.dia === undefined || o.dia === null || o.dia === '' ? (p ? p.dia : null) : Number(o.dia);
      return n !== null && Number.isInteger(n) && n >= 1 && n <= 31 ? { tipo: 'mensual', dia: n } : null;
    }
    default:
      return null;
  }
}

/** Los días del mes (año y mes de calendario). */
export function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/** ¿Ese día local (AAAA-MM-DD, con su día de la semana) toca para esta repetición? */
function toca(r: Repeticion, fecha: string): boolean {
  const [a, m, d] = fecha.split('-').map(Number);
  const semana = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  switch (r.tipo) {
    case 'nunca':
      return false;
    case 'diario':
      return true;
    case 'laborables':
      return semana >= 1 && semana <= 5;
    case 'semanal':
      return semana === r.dia;
    case 'mensual':
      return d === Math.min(r.dia, diasDelMes(a, m));
  }
}

/** «HH:MM» de un instante en su zona. */
export function horaDe(instante: number, zona: string = ZONA_POR_OMISION): string {
  const p = partesLocales(instante, zona);
  return `${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`;
}

/**
 * La primera vez ESTRICTAMENTE después de `despuesDe` (y nunca antes de `primera`), o null si ya no hay (una que no se
 * repite y ya pasó). `hora` es la del reloj de pared en `zona`.
 */
export function siguienteVez(o: { primera: number; hora: string; zona?: string; repetir: Repeticion }, despuesDe: number): number | null {
  const zona = zonaValida(o.zona) || ZONA_POR_OMISION;
  if (o.repetir.tipo === 'nunca') return o.primera > despuesDe ? o.primera : null;
  const desde = Math.max(despuesDe, o.primera - 1);
  let fecha = partesLocales(desde, zona).fecha;
  for (let i = 0; i <= DIAS_BUSQUEDA; i++) {
    if (toca(o.repetir, fecha)) {
      const t = instanteDeLocal(fecha, o.hora, zona);
      if (t > despuesDe && t >= o.primera) return t;
    }
    fecha = sumarDias(fecha, 1);
  }
  return null;
}

/** Las próximas `n` veces (para la pantalla y las pruebas). */
export function proximasVeces(o: { primera: number; hora: string; zona?: string; repetir: Repeticion }, despuesDe: number, n: number): number[] {
  const out: number[] = [];
  let t = despuesDe;
  for (let i = 0; i < n; i++) {
    const s = siguienteVez(o, t);
    if (s === null) break;
    out.push(s);
    t = s;
  }
  return out;
}

/** Cómo se dice la repetición («todos los días», «cada lunes», «cada mes, el día 31»). '' si no se repite. */
export function describirRepeticion(r: Repeticion | null | undefined, idioma: 'es' | 'en' = 'es'): string {
  if (!r || r.tipo === 'nunca') return '';
  const en = idioma === 'en';
  switch (r.tipo) {
    case 'diario':
      return en ? 'every day' : 'todos los días';
    case 'laborables':
      return en ? 'every weekday' : 'de lunes a viernes';
    case 'semanal':
      return en ? `every ${DIAS_EN[r.dia]}` : `cada ${DIAS_ES[r.dia]}`;
    case 'mensual':
      return en ? `every month on day ${r.dia}` : `cada mes, el día ${r.dia}`;
  }
}

/** La fecha local válida de un «AAAA-MM-DD» (re-exportado para las rutas). */
export { fechaValida };
