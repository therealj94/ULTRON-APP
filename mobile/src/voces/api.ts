/**
 * Las voces conocidas en el servidor (server/voces-rutas.ts), con la sesión de la mesa: son de un
 * CORREO, y el correo sale de la sesión firmada, nunca de lo que mande el teléfono. El audio va, se
 * convierte en números allá y se descarta.
 *
 *   GET    /api/voces            → { personas, motor }
 *   POST   /api/voces/aprender   { nombre, relacion, parentesco?, audios: wav[], consentimiento } → { persona }
 *   POST   /api/voces/quien      { audio: wav } → { persona | null, similitud, motivo }
 *   DELETE /api/voces/:id        → { ok, nombre }
 *   DELETE /api/voces            → { ok, borradas }
 */
import { api } from '../lib/api';
import type { PersonaVoz } from './voces';

export const RUTA_VOCES = '/api/voces';

export type VozGuardada = PersonaVoz & { muestras: number };
export type Consentimiento = { como: 'dueño' | 'voz'; frase?: string };

export async function listarVoces(): Promise<VozGuardada[]> {
  const r = await api<{ personas: VozGuardada[] }>(RUTA_VOCES, undefined, 12_000);
  return Array.isArray(r?.personas) ? r.personas : [];
}

/** Aprender tarda la primera vez (el servidor baja y carga el modelo): hasta 60 s. */
export async function aprenderVoz(o: { nombre: string; relacion: 'yo' | 'conocido'; parentesco?: string; audios: string[]; consentimiento: Consentimiento }): Promise<VozGuardada> {
  const r = await api<{ persona: VozGuardada }>(`${RUTA_VOCES}/aprender`, { method: 'POST', body: JSON.stringify(o) }, 60_000);
  return r.persona;
}

export type RespuestaQuien = { persona: PersonaVoz | null; similitud: number; motivo: string };

export async function quienHabla(audio: string): Promise<RespuestaQuien> {
  return api<RespuestaQuien>(`${RUTA_VOCES}/quien`, { method: 'POST', body: JSON.stringify({ audio }) }, 25_000);
}

export async function olvidarVoz(id: string): Promise<string> {
  const r = await api<{ ok: boolean; nombre: string }>(`${RUTA_VOCES}/${encodeURIComponent(id)}`, { method: 'DELETE' }, 12_000);
  return r.nombre;
}

export async function olvidarTodasLasVoces(): Promise<number> {
  const r = await api<{ ok: boolean; borradas: number }>(RUTA_VOCES, { method: 'DELETE' }, 12_000);
  return r.borradas;
}
