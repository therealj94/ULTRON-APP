/**
 * LA HORA DE CADA PERSONA (AUR12): zona IANA, hora local e instante UTC, sin confundirlos.
 *
 * Reglas de la casa:
 *   · Un INSTANTE (ms desde 1970, UTC) es absoluto: una cita, un vencimiento, «hasta el lunes a las 9»
 *     ya convertido. Cambiar la zona de la persona NO lo mueve; solo cambia cómo se muestra.
 *   · Una HORA LOCAL («07:00», «AAAA-MM-DD») es de una zona: las horas quietas, el «día» del presupuesto,
 *     «mañana temprano». Se convierte a instante en el momento de usarla, con la zona vigente.
 *   · Horario de verano: la hora que no existe (02:30 del cambio de primavera) avanza lo que dura el hueco;
 *     la que existe dos veces (01:30 del cambio de otoño) toma la PRIMERA. Honduras no tiene horario de
 *     verano, pero el código no lo supone (las pruebas usan America/New_York).
 *
 * Solo Intl (sin dependencias). Nada aquí lee el reloj por su cuenta: el instante siempre se pasa.
 */

export const ZONA_POR_OMISION = 'America/Tegucigalpa';

const MIN_MS = 60_000;
const formatos = new Map<string, Intl.DateTimeFormat>();

function formato(zona: string): Intl.DateTimeFormat {
  let f = formatos.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hourCycle: 'h23' });
    formatos.set(zona, f);
  }
  return f;
}

/**
 * La zona si es una zona IANA que este Node conoce («America/New_York», «UTC»); null si no. No vale un
 * desfase suelto («GMT-6») ni un país: un desfase fijo no sabe de horario de verano.
 */
export function zonaValida(z: unknown): string | null {
  const s = typeof z === 'string' ? z.trim() : '';
  if (!s || s.length > 64) return null;
  if (s !== 'UTC' && !/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){1,2}$/.test(s)) return null;
  if (/^Etc\//.test(s)) return null;
  try {
    const r = new Intl.DateTimeFormat('en-US', { timeZone: s }).resolvedOptions().timeZone;
    return r ? s : null;
  } catch {
    return null;
  }
}

export type PartesLocales = { anio: number; mes: number; dia: number; hora: number; minuto: number; segundo: number; fecha: string; diaSemana: number };

const DIAS_SEMANA: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** El reloj de pared en esa zona para ese instante. */
export function partesLocales(instante: number, zona: string = ZONA_POR_OMISION): PartesLocales {
  const partes = formato(zona).formatToParts(new Date(instante));
  const v = (t: string) => partes.find((p) => p.type === t)?.value || '0';
  const anio = Number(v('year'));
  const mes = Number(v('month'));
  const dia = Number(v('day'));
  return {
    anio,
    mes,
    dia,
    hora: Number(v('hour')) % 24,
    minuto: Number(v('minute')),
    segundo: Number(v('second')),
    fecha: `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`,
    diaSemana: DIAS_SEMANA[v('weekday')] ?? 0,
  };
}

/** «AAAA-MM-DD» del día local. */
export function fechaLocal(instante: number, zona: string = ZONA_POR_OMISION): string {
  return partesLocales(instante, zona).fecha;
}

/** Minutos que esa zona va por delante de UTC en ese instante (Honduras: −360). */
export function desfaseMin(instante: number, zona: string): number {
  const p = partesLocales(instante, zona);
  const comoUtc = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return Math.round((comoUtc - Math.floor(instante / 1000) * 1000) / MIN_MS);
}

/** «HH:MM» → minutos del día (0–1439), o null. */
export function minutosDe(hhmm: unknown): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function fechaValida(f: unknown): string | null {
  const s = String(f ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? s : null;
}

/** La fecha `n` días después (calendario, sin zona). */
export function sumarDias(fecha: string, n: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * El instante de una hora local en esa zona. Hora inexistente (hueco de primavera): avanza el hueco
 * (02:30 → 03:30 EDT). Hora repetida (otoño): la primera vez. Lanza si la fecha o la hora no valen.
 */
export function instanteDeLocal(fecha: string, hhmm: string, zona: string = ZONA_POR_OMISION): number {
  const f = fechaValida(fecha);
  const min = minutosDe(hhmm);
  if (!f || min === null) throw new Error('La fecha es AAAA-MM-DD y la hora HH:MM.');
  const [a, m, d] = f.split('-').map(Number);
  const pared = Date.UTC(a, m - 1, d, Math.floor(min / 60), min % 60);
  // Los desfases posibles alrededor de esa fecha (antes y después de un cambio).
  const desfases = new Set([desfaseMin(pared - 36 * 60 * MIN_MS, zona), desfaseMin(pared, zona), desfaseMin(pared + 36 * 60 * MIN_MS, zona)]);
  const validos: number[] = [];
  for (const o of desfases) {
    const t = pared - o * MIN_MS;
    const p = partesLocales(t, zona);
    if (p.fecha === f && p.hora * 60 + p.minuto === min) validos.push(t);
  }
  if (validos.length) return Math.min(...validos);
  // Hueco: con el desfase de ANTES del cambio cae justo después del salto.
  return pared - desfaseMin(pared - 36 * 60 * MIN_MS, zona) * MIN_MS;
}

/** El último milisegundo de ese día local («vence el 5» = hasta que se acabe el 5 en su zona). */
export function finDelDiaLocal(fecha: string, zona: string = ZONA_POR_OMISION): number {
  return instanteDeLocal(sumarDias(fecha, 1), '00:00', zona) - 1;
}

export type Quietas = { desde: string; hasta: string };
export const QUIETAS_POR_OMISION: Quietas = { desde: '21:00', hasta: '07:00' };

/** ¿Ese instante cae dentro de las horas quietas de esa zona? La ventana puede cruzar medianoche; desde = hasta es «sin quietas». */
export function enQuietas(instante: number, zona: string = ZONA_POR_OMISION, q: Quietas = QUIETAS_POR_OMISION): boolean {
  const desde = minutosDe(q.desde);
  const hasta = minutosDe(q.hasta);
  if (desde === null || hasta === null || desde === hasta) return false;
  const p = partesLocales(instante, zona);
  const ahora = p.hora * 60 + p.minuto;
  return desde < hasta ? ahora >= desde && ahora < hasta : ahora >= desde || ahora < hasta;
}

/** Si está en horas quietas, el instante en que terminan (en esa zona, con su horario de verano); si no, el mismo instante. */
export function finDeQuietas(instante: number, zona: string = ZONA_POR_OMISION, q: Quietas = QUIETAS_POR_OMISION): number {
  if (!enQuietas(instante, zona, q)) return instante;
  const p = partesLocales(instante, zona);
  const hasta = minutosDe(q.hasta)!;
  const ahora = p.hora * 60 + p.minuto;
  const fecha = ahora < hasta ? p.fecha : sumarDias(p.fecha, 1);
  return instanteDeLocal(fecha, q.hasta, zona);
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** «5 oct 2026, 19:59 (America/New_York)»: un instante dicho en la zona de quien lo lee. */
export function describirInstante(instante: number, zona: string = ZONA_POR_OMISION): string {
  const p = partesLocales(instante, zona);
  return `${p.dia} ${MESES[p.mes - 1]} ${p.anio}, ${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')} (${zona})`;
}
