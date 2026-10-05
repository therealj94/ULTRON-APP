#!/usr/bin/env -S npx tsx
/**
 * LA OTRA MITAD DE LA COMPARACIÓN (docs/voz/SPEECH-ENGINE.md): lo que mide ElevenLabs de cada turno, para
 * los dos caminos de la llamada. Nuestro servidor mide hasta que el primer texto sale hacia la voz
 * (/api/voz/comparacion); la red, el reconocimiento y la voz los mide ElevenLabs en cada mensaje del agente
 * (`conversation_turn_metrics`), y además marca cuáles se interrumpieron (`interrupted`) y qué «ajá» no tomó
 * como interrupción (`ignored_as_backchannel`).
 *
 *   ELEVENLABS_API_KEY=… npx tsx scripts/voz-comparar-eleven.ts --agente agent_… --motor seng_… --desde 2026-10-06T15:00:00Z [--hasta …]
 *
 * SOLO LEE (GET de conversaciones; https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/list
 * acepta el id de un agente o de un Speech Engine). No imprime NADA de lo dicho ni la llave: solo cuántos
 * turnos, percentiles de cada métrica y los conteos. Los nombres de las métricas los pone ElevenLabs (no
 * están documentados uno por uno): se resumen todas las que vengan, con su nombre tal cual.
 */
import { pathToFileURL } from 'node:url';
import { errorSeguro } from './elevenlabs-agentes';

const API = 'https://api.elevenlabs.io/v1';
const key = () => String(process.env.ELEVENLABS_API_KEY || '').trim();

type Metrica = { n: number; p50: number | null; p95: number | null };
export type ResumenEleven = { conversaciones: number; turnosAgente: number; interrumpidos: number; ignoradosComoAsentir: number; metricas: Record<string, Metrica> };

function percentil(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.max(0, Math.ceil((p / 100) * o.length) - 1))];
}

/** El resumen de unas conversaciones (lo que devuelve GET /convai/conversations/{id}), sin leer lo dicho. */
export function resumirConversaciones(convs: any[]): ResumenEleven {
  const valores = new Map<string, number[]>();
  let turnos = 0;
  let interrumpidos = 0;
  let ignorados = 0;
  for (const c of convs) {
    for (const m of Array.isArray(c?.transcript) ? c.transcript : []) {
      if (m?.ignored_as_backchannel) ignorados++;
      if (m?.role !== 'agent') continue;
      turnos++;
      if (m.interrupted) interrumpidos++;
      const met = m.conversation_turn_metrics?.metrics;
      if (!met || typeof met !== 'object') continue;
      for (const [k, v] of Object.entries(met as Record<string, any>)) {
        const x = Number(v?.elapsed_time);
        if (!Number.isFinite(x) || !/^[a-z0-9_.-]{1,80}$/i.test(k)) continue;
        if (!valores.has(k)) valores.set(k, []);
        valores.get(k)!.push(x);
      }
    }
  }
  const metricas: Record<string, Metrica> = {};
  for (const [k, xs] of [...valores].sort(([a], [b]) => a.localeCompare(b))) metricas[k] = { n: xs.length, p50: percentil(xs, 50), p95: percentil(xs, 95) };
  return { conversaciones: convs.length, turnosAgente: turnos, interrumpidos, ignoradosComoAsentir: ignorados, metricas };
}

async function api(ruta: string): Promise<any> {
  const r = await fetch(`${API}${ruta}`, { headers: { 'xi-api-key': key() } });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw errorSeguro('GET', ruta, r.status, j);
  return j;
}

async function conversacionesDe(id: string, desde: number, hasta?: number): Promise<any[]> {
  const ids: string[] = [];
  let cursor = '';
  for (let pagina = 0; pagina < 10; pagina++) {
    const q = new URLSearchParams({ agent_id: id, page_size: '100', call_start_after_unix: String(Math.floor(desde / 1000)) });
    if (hasta) q.set('call_start_before_unix', String(Math.floor(hasta / 1000)));
    if (cursor) q.set('cursor', cursor);
    const j = await api(`/convai/conversations?${q}`);
    for (const c of j?.conversations || []) if (typeof c?.conversation_id === 'string') ids.push(c.conversation_id);
    if (!j?.has_more || !j?.next_cursor) break;
    cursor = String(j.next_cursor);
  }
  const out: any[] = [];
  for (const c of ids) out.push(await api(`/convai/conversations/${encodeURIComponent(c)}`));
  return out;
}

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? String(process.argv[i + 1] || '') : '';
};

async function main() {
  const agente = arg('--agente');
  const motor = arg('--motor');
  const desde = Date.parse(arg('--desde'));
  const hasta = arg('--hasta') ? Date.parse(arg('--hasta')) : undefined;
  if (!key() || !/^agent_[A-Za-z0-9]+$/.test(agente) || !/^seng_[A-Za-z0-9]+$/.test(motor) || !Number.isFinite(desde)) {
    console.error('Uso: ELEVENLABS_API_KEY=… npx tsx scripts/voz-comparar-eleven.ts --agente agent_… --motor seng_… --desde <ISO> [--hasta <ISO>]');
    process.exit(1);
  }
  const resultado = {
    agente: resumirConversaciones(await conversacionesDe(agente, desde, hasta)),
    'speech-engine': resumirConversaciones(await conversacionesDe(motor, desde, hasta)),
  };
  console.log(JSON.stringify(resultado, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((e: any) => {
    console.error(`No se pudo: ${String(e?.message || e).slice(0, 300)}`);
    process.exit(1);
  });
}
