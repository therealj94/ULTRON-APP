/**
 * LOS INTERRUPTORES: apagar o ajustar una pieza de la voz sin redesplegar.
 *
 * Antes, cualquier ajuste (el modelo chico, el prompt corto de la voz, cuánto se espera el reintento de
 * ElevenLabs o la frase de espera) era una variable de entorno y un despliegue de varios minutos. Aquí
 * viven en un JSON en el bucket de la memoria (S3); el servidor lo relee cada minuto y la junta con mando
 * lo cambia por /api/interruptores. Sin S3, quedan en memoria del proceso. Lo que no está en el JSON
 * toma el valor de siempre (POR_OMISION): sin tocar nada, nada cambia.
 */
import { s3GetJson, s3Listo, s3PutJson } from './s3';

export type Interruptores = {
  /** El modelo chico de la T4 contesta saludos y charla ligera (lib/cognitivo/modelos.ts). */
  modeloChico: boolean;
  /** Los turnos hablados usan el system corto (server/prompt-turno.ts, compacto). */
  vozCompacta: boolean;
  /** Cuánto se espera el reintento de ElevenLabs antes de cortar un turno sin oyente (ms). */
  graciaReintentoMs: number;
  /** Cuándo dice la llamada su frase de espera si el cerebro no habló (ms; 0 la apaga). */
  puenteVozMs: number;
};

export const POR_OMISION: Interruptores = {
  modeloChico: true,
  vozCompacta: true,
  graciaReintentoMs: 2_500,
  puenteVozMs: 3_000,
};

/** Lo que se acepta de cada uno: los números con su rango (un valor fuera de rango no se guarda). */
const RANGOS: Partial<Record<keyof Interruptores, [number, number]>> = {
  graciaReintentoMs: [0, 10_000],
  puenteVozMs: [0, 3_500],
};

const CLAVE_S3 = 'aura/interruptores.json';
const RELEER_MS = 60_000;

let actuales: Interruptores = { ...POR_OMISION };
let leidoEn = 0;
let leyendo: Promise<void> | null = null;

/** Solo las claves conocidas y con el tipo y el rango correctos. Lo demás se descarta. */
export function validar(cambios: unknown): Partial<Interruptores> {
  const out: Partial<Interruptores> = {};
  if (!cambios || typeof cambios !== 'object') return out;
  for (const [k, v] of Object.entries(cambios as Record<string, unknown>)) {
    if (!(k in POR_OMISION)) continue;
    const clave = k as keyof Interruptores;
    const base = POR_OMISION[clave];
    if (typeof base === 'boolean' && typeof v === 'boolean') (out as any)[clave] = v;
    else if (typeof base === 'number' && typeof v === 'number' && Number.isFinite(v)) {
      const [min, max] = RANGOS[clave] ?? [-Infinity, Infinity];
      if (v >= min && v <= max) (out as any)[clave] = Math.round(v);
    }
  }
  return out;
}

function releer() {
  if (leyendo || !s3Listo()) return;
  leyendo = s3GetJson(CLAVE_S3)
    .then((r) => {
      if (r.ok) actuales = { ...POR_OMISION, ...validar(r.json) };
      else if (r.missing) actuales = { ...POR_OMISION };
    })
    .catch(() => undefined)
    .finally(() => {
      leidoEn = Date.now();
      leyendo = null;
    });
}

/** El valor de un interruptor ahora. Nunca espera: si toca releer, se relee de fondo. */
export function interruptor<K extends keyof Interruptores>(k: K): Interruptores[K] {
  if (Date.now() - leidoEn > RELEER_MS) releer();
  return actuales[k];
}

export function todosLosInterruptores(): Interruptores {
  return { ...actuales };
}

/** Cambia los interruptores (solo las claves válidas) y los guarda. Devuelve cómo quedaron. */
export async function fijarInterruptores(cambios: unknown): Promise<{ ok: boolean; interruptores: Interruptores; detalle: string; descartados: string[] }> {
  const validos = validar(cambios);
  const descartados = cambios && typeof cambios === 'object' ? Object.keys(cambios).filter((k) => !(k in validos)) : [];
  const nuevos = { ...actuales, ...validos };
  if (!s3Listo()) {
    actuales = nuevos;
    leidoEn = Date.now();
    return { ok: true, interruptores: { ...actuales }, detalle: 'Sin S3: quedan en este proceso hasta el próximo despliegue.', descartados };
  }
  // Solo lo que difiere de lo de siempre: si mañana cambia un valor por omisión, el JSON no lo tapa.
  const guardar = Object.fromEntries(Object.entries(nuevos).filter(([k, v]) => POR_OMISION[k as keyof Interruptores] !== v));
  const r = await s3PutJson(CLAVE_S3, guardar);
  if (r.ok) {
    actuales = nuevos;
    leidoEn = Date.now();
  }
  return { ok: r.ok, interruptores: { ...actuales }, detalle: r.ok ? 'Guardado.' : r.detalle, descartados };
}

/** Solo pruebas. */
export function _reiniciarInterruptores() {
  actuales = { ...POR_OMISION };
  leidoEn = Date.now();
}
