/**
 * Las caras conocidas en el servidor (server/caras-rutas.ts), con la sesión de la mesa: son de un
 * CORREO, y el correo sale de la sesión firmada, nunca de lo que mande el teléfono.
 *
 *   GET    /api/caras        → { personas: CaraConocida[] }
 *   POST   /api/caras        { nombre, relacion, vectores, consentimiento } → { persona }
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

export async function guardarCara(o: { nombre: string; relacion: Relacion; vectores: number[][]; consentimiento: Consentimiento }): Promise<CaraConocida> {
  const r = await api<{ persona: CaraConocida }>(RUTA_CARAS, { method: 'POST', body: JSON.stringify(o) }, 15_000);
  return r.persona;
}

export async function olvidarCara(id: string): Promise<string> {
  const r = await api<{ ok: boolean; nombre: string }>(`${RUTA_CARAS}/${encodeURIComponent(id)}`, { method: 'DELETE' }, 12_000);
  return r.nombre;
}

export async function olvidarTodasLasCaras(): Promise<number> {
  const r = await api<{ ok: boolean; borradas: number }>(RUTA_CARAS, { method: 'DELETE' }, 12_000);
  return r.borradas;
}
