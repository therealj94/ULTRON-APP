/**
 * Las caras conocidas en el servidor (server/caras-rutas.ts), con la sesión de la mesa: son de un
 * CORREO, y el correo sale de la sesión firmada, nunca de lo que mande el teléfono.
 *
 *   GET    /api/caras        → { personas: CaraConocida[] }
 *   POST   /api/caras        { nombre, relacion, vectores, consentimiento, parentesco? } → { persona }
 *   POST   /api/caras/:id/muestras { vectores } → { ok, muestras } (aprender con el uso)
 *   POST   /api/caras/:id/confirmar → { ok } (tanda F1: la dueña confirma en su pantalla a un posible menor)
 *   DELETE /api/caras/:id    → { ok, nombre }
 *   DELETE /api/caras        → { ok, borradas }
 */
import { api } from '../lib/api';
import type { CaraConocida, Relacion } from './caras';

export const RUTA_CARAS = '/api/caras';

export type Consentimiento = { como: 'dueño' | 'voz'; frase?: string };

export async function listarCaras(): Promise<CaraConocida[]> {
  const r = await api<{ personas: CaraConocida[] }>(RUTA_CARAS, undefined, 12_000);
  return Array.isArray(r?.personas) ? r.personas : [];
}

export async function guardarCara(o: { nombre: string; relacion: Relacion; vectores: number[][]; consentimiento: Consentimiento; parentesco?: string }): Promise<CaraConocida & { porConfirmar?: boolean }> {
  const r = await api<{ persona: CaraConocida & { porConfirmar?: boolean } }>(RUTA_CARAS, { method: 'POST', body: JSON.stringify(o) }, 15_000);
  return r.persona;
}

/** Aprender con el uso: 1-2 vectores más para alguien que ya está guardado. Devuelve cuántas muestras tiene. */
export async function sumarMuestrasCara(id: string, vectores: number[][]): Promise<number> {
  const r = await api<{ ok: boolean; muestras: number }>(`${RUTA_CARAS}/${encodeURIComponent(id)}/muestras`, { method: 'POST', body: JSON.stringify({ vectores }) }, 12_000);
  return r.muestras;
}

export async function olvidarCara(id: string): Promise<string> {
  const r = await api<{ ok: boolean; nombre: string }>(`${RUTA_CARAS}/${encodeURIComponent(id)}`, { method: 'DELETE' }, 12_000);
  return r.nombre;
}

export async function olvidarTodasLasCaras(): Promise<number> {
  const r = await api<{ ok: boolean; borradas: number }>(RUTA_CARAS, { method: 'DELETE' }, 12_000);
  return r.borradas;
}

/** Tanda F1: la dueña confirma EN SU PANTALLA a alguien que quedó por confirmar (un posible menor). */
export async function confirmarCara(id: string): Promise<void> {
  await api<{ ok: boolean }>(`${RUTA_CARAS}/${encodeURIComponent(id)}/confirmar`, { method: 'POST', body: '{}' }, 12_000);
}
