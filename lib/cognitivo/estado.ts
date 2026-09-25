/**
 * EL ESTADO DE LA CAPA COGNITIVA — qué está conectado de verdad, medido ahora.
 *
 * No lee la configuración y la da por buena: a cada servicio de la T4 se le pregunta `/health` con
 * su token, y se mide cuánto tardó. Una variable puesta con un servicio caído se ve como caído, que
 * es lo que importa cuando algo contesta raro.
 *
 * Se guarda 15 segundos para que la pestaña de Control no martille la T4.
 */
import type { Plataforma } from '../acceso';
import { modoClasificador } from './clasificador';
import { modeloChicoConfigurado } from './modelos';

export type Sonda = {
  servicio: 'laya' | 'embeddings' | 'modelo_chico' | 'docling';
  configurado: boolean;
  ok: boolean;
  ms: number | null;
  detalle: string;
};

export type EstadoCognitivo = {
  t: string;
  clasificador: { modo: string };
  servicios: Sonda[];
  vectores: { columna: boolean; con: number; sin: number } | null;
  mcp: { activo: boolean; motivo: string | null };
};

const FUENTES: Array<{ servicio: Sonda['servicio']; url: string; clave: string; activo?: () => boolean }> = [
  { servicio: 'laya', url: 'LAYA_URL', clave: 'LAYA_API_KEY' },
  { servicio: 'embeddings', url: 'EMBED_URL', clave: 'EMBED_API_KEY' },
  { servicio: 'modelo_chico', url: 'MODELO_CHICO_URL', clave: 'MODELO_CHICO_API_KEY', activo: modeloChicoConfigurado },
  { servicio: 'docling', url: 'DOCLING_URL', clave: 'DOCLING_API_KEY' },
];

async function sondear(f: (typeof FUENTES)[number]): Promise<Sonda> {
  const url = String(process.env[f.url] || '').replace(/\/$/, '');
  if (!url) return { servicio: f.servicio, configurado: false, ok: false, ms: null, detalle: `sin ${f.url}` };
  const clave = String(process.env[f.clave] || '');
  const t0 = Date.now();
  try {
    const r = await fetch(`${url}/health`, {
      headers: clave ? { Authorization: `Bearer ${clave}`, 'X-Api-Key': clave } : {},
      signal: AbortSignal.timeout(4000),
    });
    const ms = Date.now() - t0;
    if (!r.ok) return { servicio: f.servicio, configurado: true, ok: false, ms, detalle: r.status === 401 ? 'el token no coincide (401)' : `respondió ${r.status}` };
    const apagado = f.activo && !f.activo();
    return { servicio: f.servicio, configurado: true, ok: true, ms, detalle: apagado ? 'responde, pero está apagado (MODELO_CHICO_MODO)' : 'responde' };
  } catch (e: any) {
    const ms = Date.now() - t0;
    return { servicio: f.servicio, configurado: true, ok: false, ms, detalle: /timeout|abort/i.test(String(e?.name || e)) ? 'no respondió en 4 s' : 'no se pudo conectar' };
  }
}

let cache: { plataforma: Plataforma; valor: EstadoCognitivo; t: number } | null = null;

export async function estadoCognitivo(
  plataforma: Plataforma,
  extra: { vectores?: () => Promise<{ con: number; sin: number } | null>; mcp?: () => { ok: boolean; motivo?: string } } = {},
): Promise<EstadoCognitivo> {
  if (cache && cache.plataforma === plataforma && Date.now() - cache.t < 15_000) return cache.valor;
  const [servicios, cobertura] = await Promise.all([
    Promise.all(FUENTES.map(sondear)),
    extra.vectores ? extra.vectores().catch(() => null) : Promise.resolve(null),
  ]);
  const m = extra.mcp?.();
  const valor: EstadoCognitivo = {
    t: new Date().toISOString(),
    clasificador: { modo: modoClasificador() },
    servicios,
    vectores: extra.vectores ? (cobertura ? { columna: true, ...cobertura } : { columna: false, con: 0, sin: 0 }) : null,
    mcp: { activo: !!m?.ok, motivo: m && !m.ok ? m.motivo || null : null },
  };
  cache = { plataforma, valor, t: Date.now() };
  return valor;
}

export function resetEstadoTest() {
  cache = null;
}
