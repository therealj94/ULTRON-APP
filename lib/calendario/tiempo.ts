/**
 * LA HORA DEL CALENDARIO, SIEMPRE LA DE HONDURAS (America/Tegucigalpa, UTC−6 todo el año).
 *
 * Sin red ni reloj propio: el instante «ahora» siempre se pasa (las pruebas lo fijan). Aquí:
 *  · `rangoDe`: «hoy», «mañana», «pasado mañana», «el jueves», «esta semana», «la próxima semana» o «2026-10-09» → el
 *    día (o los días) de Honduras, como [desde, hasta) en instantes UTC. A las 23:30 de Honduras ya es el día siguiente
 *    en UTC: «hoy» sigue siendo el día de Honduras.
 *  · `inicioDe`: «AAAA-MM-DDTHH:MM» en hora de Honduras (lo que escribe el cerebro) o con zona explícita → instante.
 *  · `huecosLibres`: los ratos libres de un día entre lo ocupado (eventos que cruzan la medianoche o de todo el día
 *    cuentan solo en lo que tocan de ese día).
 *  · `decirEvento` / `decirRango`: cómo se le dice a la persona («jueves 9 de octubre, 15:00 a 16:00»).
 *
 * «el jueves» dicho un jueves es HOY; «el próximo jueves» / «el jueves que viene» es el de la semana siguiente.
 */
import { ZONA_POR_OMISION, fechaLocal, fechaValida, instanteDeLocal, partesLocales, sumarDias } from '../zona-horaria';

export const ZONA_HN = ZONA_POR_OMISION;
const MIN = 60_000;

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIA_DE: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };

/** Un rango de días de Honduras: [desde, hasta) en instantes, con las fechas locales que cubre. */
export type Rango = { desde: number; hasta: number; fechas: string[]; etiqueta: string };

const plano = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** El inicio del día local (00:00 de Honduras) de esa fecha. */
export const inicioDelDia = (fecha: string) => instanteDeLocal(fecha, '00:00', ZONA_HN);

function rangoDeFechas(desde: string, dias: number, etiqueta: string): Rango {
  const fechas = Array.from({ length: dias }, (_, i) => sumarDias(desde, i));
  return { desde: inicioDelDia(desde), hasta: inicioDelDia(sumarDias(desde, dias)), fechas, etiqueta };
}

/**
 * El rango que nombra la frase, en días de Honduras. null si no se entiende (el cerebro pregunta). Vacío = hoy.
 */
export function rangoDe(texto: string, ahora: number): Rango | null {
  const t = plano(texto) || 'hoy';
  const hoy = fechaLocal(ahora, ZONA_HN);
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(String(texto || ''));
  if (iso && fechaValida(iso[1])) return rangoDeFechas(iso[1], 1, `el ${diaLargo(iso[1])}`);
  if (/\b(semana|week)\b/.test(t)) {
    // La semana de lunes a domingo; «esta semana» desde hoy hasta el domingo, «la próxima» la de después.
    const dow = partesLocales(ahora, ZONA_HN).diaSemana;
    const hastaDomingo = (7 - dow) % 7;
    if (/\b(proxima|siguiente|que viene|next)\b/.test(t)) return rangoDeFechas(sumarDias(hoy, hastaDomingo + 1), 7, 'la próxima semana');
    return rangoDeFechas(hoy, hastaDomingo + 1, 'esta semana');
  }
  if (/\bpasado manana\b|\bday after tomorrow\b/.test(t)) return rangoDeFechas(sumarDias(hoy, 2), 1, 'pasado mañana');
  // «mañana» es el día, salvo «la / esta mañana» (la parte del día): «mañana en la mañana» es mañana.
  if (/(?<!\b(?:la|esta) )\bmanana\b|\btomorrow\b/.test(t)) return rangoDeFechas(sumarDias(hoy, 1), 1, 'mañana');
  for (const [nombre, n] of Object.entries(DIA_DE)) {
    if (!new RegExp(`\\b${nombre}\\b`).test(t)) continue;
    const dow = partesLocales(ahora, ZONA_HN).diaSemana;
    let dif = (n - dow + 7) % 7;
    if (/\b(proximo|siguiente|que viene)\b/.test(t) && dif === 0) dif = 7;
    const f = sumarDias(hoy, dif);
    return rangoDeFechas(f, 1, dif === 0 ? 'hoy' : dif === 1 ? 'mañana' : `el ${diaLargo(f)}`);
  }
  if (/\b(hoy|today|ahora|ahorita|esta (tarde|noche)|la tarde|la noche|en la manana|esta manana)\b/.test(t) || !t) return rangoDeFechas(hoy, 1, 'hoy');
  return null;
}

/**
 * Un instante desde lo que escribe el cerebro: «AAAA-MM-DDTHH:MM» en hora de Honduras, o con zona explícita (…Z,
 * …-06:00). null si no vale.
 */
export function inicioDe(v: unknown): number | null {
  const s = String(v ?? '').trim();
  const local = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (local) {
    try {
      const t = instanteDeLocal(local[1], `${local[2]}:${local[3]}`, ZONA_HN);
      // 25:00 o el 31 de febrero no existen: la vuelta a la hora local tiene que dar lo mismo.
      const p = partesLocales(t, ZONA_HN);
      return p.fecha === local[1] && p.hora === Number(local[2]) && p.minuto === Number(local[3]) ? t : null;
    } catch {
      return null;
    }
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(s)) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/** «AAAA-MM-DDTHH:MM:SS» de pared en Honduras (lo que pide Graph con su zona). */
export function paredHN(t: number): string {
  const p = partesLocales(t, ZONA_HN);
  const d2 = (n: number) => String(n).padStart(2, '0');
  return `${p.fecha}T${d2(p.hora)}:${d2(p.minuto)}:00`;
}

/** Con su desfase («2026-10-09T15:00:00-06:00»): lo que pide Google. Honduras no tiene horario de verano. */
export function isoHN(t: number): string {
  return `${paredHN(t)}-06:00`;
}

/** «jueves 9 de octubre». */
export function diaLargo(fecha: string): string {
  const [a, m, d] = fecha.split('-').map(Number);
  const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return `${DIAS[dow]} ${d} de ${MESES[m - 1]}`;
}

export const horaHN = (t: number) => {
  const p = partesLocales(t, ZONA_HN);
  return `${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`;
};

/** Un evento ya normalizado (lib/calendario/proveedores.ts). */
export type EventoCal = {
  id: string;
  proveedor: 'microsoft' | 'google';
  titulo: string;
  inicio: number;
  fin: number;
  todoElDia: boolean;
  lugar?: string;
  enlace?: string;
  cancelado?: boolean;
};

/** «jueves 9 de octubre, 15:00 a 16:00» (o «todo el día»), hora de Honduras. */
export function decirCuando(inicio: number, fin: number, todoElDia = false): string {
  const fi = fechaLocal(inicio, ZONA_HN);
  if (todoElDia) {
    const ff = fechaLocal(fin - 1, ZONA_HN);
    return ff === fi ? `${diaLargo(fi)}, todo el día` : `del ${diaLargo(fi)} al ${diaLargo(ff)}, todo el día`;
  }
  const ff = fechaLocal(fin, ZONA_HN);
  return ff === fi ? `${diaLargo(fi)}, ${horaHN(inicio)} a ${horaHN(fin)}` : `${diaLargo(fi)} ${horaHN(inicio)} al ${diaLargo(ff)} ${horaHN(fin)}`;
}

/** La línea de un evento en una lista: «15:00–16:00 Reunión con Ana (Oficina)». */
export function lineaEvento(e: EventoCal): string {
  const hora = e.todoElDia ? 'todo el día' : `${horaHN(e.inicio)}–${horaHN(e.fin)}`;
  return `${hora} ${e.titulo || '(sin título)'}${e.lugar ? ` (${e.lugar})` : ''}`;
}

/** Los eventos agrupados por día de Honduras (un evento de varios días sale en cada día que toca). */
export function porDia(eventos: EventoCal[], r: Rango): Array<{ fecha: string; eventos: EventoCal[] }> {
  return r.fechas.map((fecha) => {
    const d0 = inicioDelDia(fecha);
    const d1 = inicioDelDia(sumarDias(fecha, 1));
    return { fecha, eventos: eventos.filter((e) => !e.cancelado && e.inicio < d1 && e.fin > d0).sort((a, b) => a.inicio - b.inicio) };
  });
}

/**
 * Los ratos libres de UN día de Honduras entre `desde` y `hasta` (horas «HH:MM», por omisión 08:00–18:00) de al menos
 * `minutos`, sin lo ocupado. Lo de todo el día cuenta como ocupado solo si la persona lo marcó así (no se sabe: aquí
 * NO bloquea, igual que un feriado no quita la oficina). Nada antes de `ahora`.
 */
export function huecosLibres(eventos: EventoCal[], fecha: string, minutos: number, o: { desde?: string; hasta?: string; ahora?: number } = {}): Array<{ inicio: number; fin: number }> {
  const a = instanteDeLocal(fecha, o.desde || '08:00', ZONA_HN);
  const b = instanteDeLocal(fecha, o.hasta || '18:00', ZONA_HN);
  let cursor = Math.max(a, o.ahora ? Math.ceil(o.ahora / (5 * MIN)) * 5 * MIN : a);
  const ocupado = eventos
    .filter((e) => !e.cancelado && !e.todoElDia && e.inicio < b && e.fin > a)
    .map((e) => [Math.max(e.inicio, a), Math.min(e.fin, b)] as const)
    .sort((x, y) => x[0] - y[0]);
  const out: Array<{ inicio: number; fin: number }> = [];
  for (const [i, f] of ocupado) {
    if (i - cursor >= minutos * MIN) out.push({ inicio: cursor, fin: i });
    cursor = Math.max(cursor, f);
  }
  if (b - cursor >= minutos * MIN) out.push({ inicio: cursor, fin: b });
  return out;
}
