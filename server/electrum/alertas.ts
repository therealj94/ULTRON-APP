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

const HOY_HN = `(now() AT TIME ZONE '${HN}')::date`;

async function venceEnUmbral(): Promise<Vence[]> {
  return consulta<Vence>(
    `SELECT nombre, expediente, to_char(vence, 'DD/MM/YYYY') AS vence, (vence - ${HOY_HN})::int AS dias
       FROM concesion WHERE vence IS NOT NULL AND (vence - ${HOY_HN}) = ANY($1::int[])
      ORDER BY vence, nombre`,
    [UMBRALES as unknown as number[]]
  );
}

async function venceEn90(): Promise<Vence[]> {
  return consulta<Vence>(
    `SELECT nombre, expediente, to_char(vence, 'DD/MM/YYYY') AS vence, (vence - ${HOY_HN})::int AS dias
       FROM concesion WHERE vence IS NOT NULL AND vence BETWEEN ${HOY_HN} AND ${HOY_HN} + 90
      ORDER BY vence, nombre`
  );
}

async function perdidas(): Promise<{ filas: Perdida[]; periodo: string | null; cargado: string | null }> {
  await asegurarSatelite();
  const filas = await consulta<{ nombre: string; ha: number; comp: number; periodo: string }>(
    `SELECT c.nombre, ((s.datos->'veg'->>1)::float8 + (s.datos->'veg'->>2)::float8) AS ha, (s.datos->>'ha_comparable')::float8 AS comp, s.periodo
       FROM satelite_concesion s JOIN concesion c ON c.id = s.concesion_id
      WHERE (s.datos->'veg'->>1)::float8 + (s.datos->'veg'->>2)::float8 >= $1
      ORDER BY ha DESC`,
    [PERDIDA_MINIMA_HA]
  );
  const [m] = await consulta<{ cargado: string | null }>(`SELECT max(cargado)::text AS cargado FROM satelite_concesion`);
  return {
    filas: filas.map((f) => ({ nombre: f.nombre, ha: Number(f.ha), pct: f.comp > 0 ? (Number(f.ha) / Number(f.comp)) * 100 : null })),
    periodo: filas[0]?.periodo ?? null,
    cargado: m?.cargado ?? null,
  };
}

/** Lo que se le manda a quien pide /alertas_ya: todo lo vigente, sin marcar nada como enviado. */
export async function resumenAhora(): Promise<string> {
  const [v, p] = await Promise.all([venceEn90(), perdidas()]);
  const partes = [
    textoVencimientos(v, '📅 Vencen en los próximos 90 días:') || '📅 Nada vence en los próximos 90 días (de las que tienen fecha cargada).',
    textoSatelite(p.filas, p.periodo) || '🛰 Sin caídas fuertes de vegetación en la última medición de Sentinel-2.',
  ];
  return partes.join('\n\n');
}

/* ------------------------------------------------------------------ el reloj */

type Enviar = (chatId: string, texto: string) => Promise<{ ok: boolean }>;

/**
 * Una vuelta: para cada suscripción, lo que le toca y todavía no se le mandó. Devuelve cuántos
 * mensajes salieron. `ahora` se inyecta para las pruebas.
 */
export async function revisarAlertas(enviar: Enviar, ahora = new Date()): Promise<number> {
  if (!hayBase()) return 0;
  await asegurarTabla();
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: HN, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
  const hora = Number(new Intl.DateTimeFormat('en-US', { timeZone: HN, hour: 'numeric', hourCycle: 'h23' }).format(ahora));
  const lunes = new Intl.DateTimeFormat('en-US', { timeZone: HN, weekday: 'short' }).format(ahora) === 'Mon';
  const subs = await consulta<{ chat_id: string; ultimo_diario: string | null; ultimo_semanal: string | null; ultimo_satelite: string | null }>(
    `SELECT chat_id, to_char(ultimo_diario, 'YYYY-MM-DD') AS ultimo_diario, to_char(ultimo_semanal, 'YYYY-MM-DD') AS ultimo_semanal, ultimo_satelite::text FROM alerta_suscripcion`
  );
  if (!subs.length) return 0;
  // Lo común se consulta una vez por vuelta, no una por chat.
  const diario = hora >= 7 ? await venceEnUmbral() : null;
  const semanal = hora >= 7 && lunes ? await venceEn90() : null;
  const sat = await perdidas();
  let enviados = 0;
  for (const s of subs) {
    if (diario && s.ultimo_diario !== hoy) {
      const t = textoVencimientos(diario, '⏰ Vencimientos que llegan a un umbral hoy (90, 30, 7, 1 días o el mismo día):');
      if (!t || (await enviar(s.chat_id, t)).ok) {
        await consulta(`UPDATE alerta_suscripcion SET ultimo_diario = $2::date WHERE chat_id = $1`, [s.chat_id, hoy]);
        if (t) enviados++;
      }
    }
    if (semanal && s.ultimo_semanal !== hoy) {
      const t = textoVencimientos(semanal, '📅 Resumen del lunes — vencen en los próximos 90 días:') || '📅 Resumen del lunes: nada vence en los próximos 90 días.';
      if ((await enviar(s.chat_id, t)).ok) {
        await consulta(`UPDATE alerta_suscripcion SET ultimo_semanal = $2::date WHERE chat_id = $1`, [s.chat_id, hoy]);
        enviados++;
      }
    }
    if (sat.cargado && (!s.ultimo_satelite || new Date(sat.cargado) > new Date(s.ultimo_satelite))) {
      const t = textoSatelite(sat.filas, sat.periodo);
      if (!t || (await enviar(s.chat_id, t)).ok) {
        await consulta(`UPDATE alerta_suscripcion SET ultimo_satelite = $2::timestamptz WHERE chat_id = $1`, [s.chat_id, sat.cargado]);
        if (t) enviados++;
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
