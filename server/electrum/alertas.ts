/**
 * ALERTAS POR TELEGRAM — Dr Electrum avisa sin que nadie pregunte.
 *
 * Un chat se suscribe con /alertas (solo personas del padrón con acceso a Electrum; en una sala de
 * demostración no) y desde ahí recibe:
 *
 *  · Vencimientos: el día que una concesión queda a 90, 30, 7 o 1 días de vencer, y el día que
 *    vence. Una vez por umbral, no todos los días la misma lista.
 *  · Satélite: cuando se carga una medición nueva de Sentinel-2, las concesiones con caída de
 *    vegetación densa fuerte o muy fuerte (≥ 5 ha), de la mayor a la menor.
 *  · Los lunes, el resumen: lo que vence en los próximos 90 días.
 *
 * Todo se decide contra lo guardado en `alerta_suscripcion` (qué día y qué medición se avisó por
 * última vez): un reinicio del servidor no repite avisos ni los pierde.
 */
import { consulta as consultaCruda, conTextoReparado, hayBase } from './db';

// Los nombres del catastro vienen a veces con la codificación rota («Construcci?n»): se reparan al leer.
const consulta = <T = any>(sql: string, params: unknown[] = []) => consultaCruda<T>(sql, params).then(conTextoReparado);
import { asegurarSatelite } from './satelite';
import { nivelDe, personaPorId } from '../../lib/acceso';

export const UMBRALES = [90, 30, 7, 1, 0] as const;
const PERDIDA_MINIMA_HA = 5;
const HN = 'America/Tegucigalpa';

let tabla: Promise<void> | null = null;
function asegurarTabla(): Promise<void> {
  if (!tabla) {
    tabla = consulta(
      `CREATE TABLE IF NOT EXISTS alerta_suscripcion (
         chat_id         text PRIMARY KEY,
         persona_id      text,
         desde           timestamptz NOT NULL DEFAULT now(),
         ultimo_diario   date,
         ultimo_semanal  date,
         ultimo_satelite timestamptz
       )`
    )
      .then(() => undefined)
      .catch((e) => {
        tabla = null;
        throw e;
      });
  }
  return tabla;
}

export async function suscribir(chatId: string, personaId: string | null): Promise<void> {
  await asegurarTabla();
  // Al suscribirse, la medición de satélite vigente cuenta como vista: se avisa de las próximas.
  await asegurarSatelite();
  await consulta(
    `INSERT INTO alerta_suscripcion (chat_id, persona_id, ultimo_satelite)
     VALUES ($1, $2, (SELECT max(cargado) FROM satelite_concesion))
     ON CONFLICT (chat_id) DO UPDATE SET persona_id = EXCLUDED.persona_id`,
    [chatId, personaId]
  );
}

export async function desuscribir(chatId: string): Promise<boolean> {
  await asegurarTabla();
  const r = await consulta<{ chat_id: string }>(`DELETE FROM alerta_suscripcion WHERE chat_id = $1 RETURNING chat_id`, [chatId]);
  return r.length > 0;
}

export async function suscrito(chatId: string): Promise<boolean> {
  await asegurarTabla();
  const r = await consulta<{ chat_id: string }>(`SELECT chat_id FROM alerta_suscripcion WHERE chat_id = $1`, [chatId]);
  return r.length > 0;
}

/* ------------------------------------------------------------------ textos */

type Vence = { nombre: string; expediente: string | null; vence: string; dias: number };
type Perdida = { nombre: string; ha: number; pct: number | null };

const nf = (x: number, d = 1) => x.toLocaleString('es-HN', { maximumFractionDigits: d });
const cuando = (d: number) => (d < 0 ? `venció hace ${-d} ${-d === 1 ? 'día' : 'días'}` : d === 0 ? 'vence HOY' : d === 1 ? 'vence mañana' : `vence en ${d} días`);

export function textoVencimientos(filas: Vence[], titulo: string): string {
  if (!filas.length) return '';
  const l = filas.slice(0, 25).map((f) => `• ${f.nombre}${f.expediente ? ` (${f.expediente})` : ''}: ${cuando(f.dias)} — ${f.vence}`);
  if (filas.length > 25) l.push(`… y ${filas.length - 25} más.`);
  return `${titulo}\n${l.join('\n')}`;
}

export function textoSatelite(filas: Perdida[], periodo: string | null): string {
  if (!filas.length) return '';
  const l = filas.slice(0, 15).map((f) => `• ${f.nombre}: ${nf(f.ha)} ha${f.pct != null ? ` (${nf(f.pct)} % de lo comparable)` : ''}`);
  if (filas.length > 15) l.push(`… y ${filas.length - 15} más.`);
  return [
    `🛰 Nueva medición de Sentinel-2${periodo ? ` (${periodo})` : ''}: caída fuerte de vegetación densa dentro de ${filas.length} ${filas.length === 1 ? 'concesión' : 'concesiones'}.`,
    ...l,
    'Puede ser desmonte, camino o tajo, pero también quema, sequía o cosecha: se confirma con la imagen o en campo.',
  ].join('\n');
}

/* ------------------------------------------------------------------ consultas */

/** «Hoy» en Honduras, como texto YYYY-MM-DD. Las consultas lo reciben de acá: una vuelta que cruza
 * la medianoche no mezcla el día de la marca con los umbrales del día siguiente. */
export const hoyHN = (ahora = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: HN, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);

async function venceEnUmbral(hoy: string): Promise<Vence[]> {
  return consulta<Vence>(
    `SELECT nombre, expediente, to_char(vence, 'DD/MM/YYYY') AS vence, (vence - $2::date)::int AS dias
       FROM concesion WHERE vence IS NOT NULL AND (vence - $2::date) = ANY($1::int[])
      ORDER BY vence, nombre`,
    [UMBRALES as unknown as number[], hoy]
  );
}

async function venceEn90(hoy: string): Promise<Vence[]> {
  return consulta<Vence>(
    `SELECT nombre, expediente, to_char(vence, 'DD/MM/YYYY') AS vence, (vence - $1::date)::int AS dias
       FROM concesion WHERE vence IS NOT NULL AND vence BETWEEN $1::date AND $1::date + 90
      ORDER BY vence, nombre`,
    [hoy]
  );
}

/** Las caídas fuertes de vegetación cargadas DESPUÉS de `desde` (todas, si es null). */
async function perdidas(desde: string | null): Promise<{ filas: Perdida[]; periodo: string | null }> {
  await asegurarSatelite();
  const filas = await consulta<{ nombre: string; ha: number; comp: number; periodo: string }>(
    `SELECT c.nombre, ((s.datos->'veg'->>1)::float8 + (s.datos->'veg'->>2)::float8) AS ha, (s.datos->>'ha_comparable')::float8 AS comp, s.periodo
       FROM satelite_concesion s JOIN concesion c ON c.id = s.concesion_id
      WHERE (s.datos->'veg'->>1)::float8 + (s.datos->'veg'->>2)::float8 >= $1
        AND ($2::timestamptz IS NULL OR s.cargado > $2::timestamptz)
      ORDER BY s.cargado DESC, ha DESC`,
    [PERDIDA_MINIMA_HA, desde]
  );
  const ordenadas = filas.map((f) => ({ nombre: f.nombre, ha: Number(f.ha), pct: f.comp > 0 ? (Number(f.ha) / Number(f.comp)) * 100 : null }));
  // El período es el de la carga más reciente (la primera fila, por el orden); la lista, de mayor a menor.
  return { filas: ordenadas.sort((a, b) => b.ha - a.ha), periodo: filas[0]?.periodo ?? null };
}

async function ultimaCarga(): Promise<string | null> {
  await asegurarSatelite();
  const [m] = await consulta<{ cargado: string | null }>(`SELECT max(cargado)::text AS cargado FROM satelite_concesion`);
  return m?.cargado ?? null;
}

/** Lo que se le manda a quien pide /alertas_ya: todo lo vigente, sin marcar nada como enviado. */
export async function resumenAhora(ahora = new Date()): Promise<string> {
  const [v, p] = await Promise.all([venceEn90(hoyHN(ahora)), perdidas(null)]);
  const partes = [
    textoVencimientos(v, '📅 Vencen en los próximos 90 días:') || '📅 Nada vence en los próximos 90 días (de las que tienen fecha cargada).',
    textoSatelite(p.filas, p.periodo) || '🛰 Sin caídas fuertes de vegetación en las mediciones de Sentinel-2 cargadas.',
  ];
  return partes.join('\n\n');
}

/* ------------------------------------------------------------------ el reloj */

type Enviar = (chatId: string, texto: string) => Promise<{ ok: boolean }>;
type Campo = 'ultimo_diario' | 'ultimo_semanal';

/**
 * Reclamar antes de mandar: el UPDATE solo gana si el chat todavía no tenía la marca, así que dos
 * instancias del servidor (un despliegue sin corte las tiene a las dos vivas un rato) no mandan dos
 * veces lo mismo. Si el envío falla, la marca vuelve a lo que era.
 */
async function reclamarDia(chat: string, campo: Campo, hoy: string): Promise<{ ok: boolean; antes: string | null }> {
  const r = await consulta<{ antes: string | null }>(
    `UPDATE alerta_suscripcion s SET ${campo} = $2::date
       FROM (SELECT ${campo} AS antes FROM alerta_suscripcion WHERE chat_id = $1 FOR UPDATE) v
      WHERE s.chat_id = $1 AND (v.antes IS NULL OR v.antes <> $2::date)
      RETURNING to_char(v.antes, 'YYYY-MM-DD') AS antes`,
    [chat, hoy]
  );
  return r.length ? { ok: true, antes: r[0].antes } : { ok: false, antes: null };
}

async function reclamarSatelite(chat: string, carga: string): Promise<{ ok: boolean; antes: string | null }> {
  const r = await consulta<{ antes: string | null }>(
    `UPDATE alerta_suscripcion s SET ultimo_satelite = $2::timestamptz
       FROM (SELECT ultimo_satelite AS antes FROM alerta_suscripcion WHERE chat_id = $1 FOR UPDATE) v
      WHERE s.chat_id = $1 AND (v.antes IS NULL OR v.antes < $2::timestamptz)
      RETURNING v.antes::text AS antes`,
    [chat, carga]
  );
  return r.length ? { ok: true, antes: r[0].antes } : { ok: false, antes: null };
}

/**
 * Una vuelta: para cada suscripción, lo que le toca y todavía no se le mandó. Devuelve cuántos
 * mensajes salieron. `ahora` se inyecta para las pruebas.
 */
export async function revisarAlertas(enviar: Enviar, ahora = new Date()): Promise<number> {
  if (!hayBase()) return 0;
  await asegurarTabla();
  const hoy = hoyHN(ahora);
  const hora = Number(new Intl.DateTimeFormat('en-US', { timeZone: HN, hour: 'numeric', hourCycle: 'h23' }).format(ahora));
  const lunes = new Intl.DateTimeFormat('en-US', { timeZone: HN, weekday: 'short' }).format(ahora) === 'Mon';
  // Nada antes de las 7 de la mañana hondureña: una alerta de madrugada es ruido.
  if (hora < 7) return 0;
  const subs = await consulta<{ chat_id: string; persona_id: string | null }>(`SELECT chat_id, persona_id FROM alerta_suscripcion`);
  if (!subs.length) return 0;
  // Quien ya no tiene acceso a Dr Electrum (lo sacaron del padrón) deja de recibir el catastro.
  const vigentes: typeof subs = [];
  for (const s of subs) {
    if (nivelDe(personaPorId(s.persona_id), 'electrum')) vigentes.push(s);
    else await consulta(`DELETE FROM alerta_suscripcion WHERE chat_id = $1`, [s.chat_id]);
  }
  // Lo común se consulta una vez por vuelta, no una por chat.
  const diario = await venceEnUmbral(hoy);
  const semanal = lunes ? await venceEn90(hoy) : null;
  const carga = await ultimaCarga();
  let enviados = 0;
  const mandar = async (chat: string, texto: string, deshacer: () => Promise<unknown>) => {
    const r = await enviar(chat, texto).catch(() => ({ ok: false }));
    if (r.ok) enviados++;
    else await deshacer();
  };
  for (const s of vigentes) {
    const t = textoVencimientos(diario, '⏰ Vencimientos que llegan a un umbral hoy (90, 30, 7, 1 días o el mismo día):');
    const d = await reclamarDia(s.chat_id, 'ultimo_diario', hoy);
    if (d.ok && t) await mandar(s.chat_id, t, () => consulta(`UPDATE alerta_suscripcion SET ultimo_diario = $2::date WHERE chat_id = $1`, [s.chat_id, d.antes]));
    if (semanal) {
      const w = await reclamarDia(s.chat_id, 'ultimo_semanal', hoy);
      const tw = textoVencimientos(semanal, '📅 Resumen del lunes — vencen en los próximos 90 días:') || '📅 Resumen del lunes: nada vence en los próximos 90 días.';
      if (w.ok) await mandar(s.chat_id, tw, () => consulta(`UPDATE alerta_suscripcion SET ultimo_semanal = $2::date WHERE chat_id = $1`, [s.chat_id, w.antes]));
    }
    if (carga) {
      const c = await reclamarSatelite(s.chat_id, carga);
      if (c.ok) {
        // Solo lo cargado después de lo último que se le avisó: una concesión nueva no reenvía el país.
        const p = await perdidas(c.antes);
        const ts = textoSatelite(p.filas, p.periodo);
        if (ts) await mandar(s.chat_id, ts, () => consulta(`UPDATE alerta_suscripcion SET ultimo_satelite = $2::timestamptz WHERE chat_id = $1`, [s.chat_id, c.antes]));
      }
    }
  }
  return enviados;
}

let reloj: ReturnType<typeof setInterval> | null = null;
/** Cada media hora; la primera vuelta a los dos minutos del arranque, cuando la base ya contestó. */
export function iniciarAlertas(enviar: Enviar): void {
  if (reloj) return;
  const vuelta = () =>
    revisarAlertas(enviar)
      .then((n) => n && console.log(`[electrum] alertas: ${n} mensajes`))
      .catch((e) => console.warn('[electrum] alertas:', String(e?.message || e).slice(0, 160)));
  setTimeout(vuelta, 120_000).unref?.();
  reloj = setInterval(vuelta, 30 * 60_000);
  reloj.unref?.();
}
