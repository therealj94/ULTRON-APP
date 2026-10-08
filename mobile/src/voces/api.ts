/**
 * Las voces conocidas en el servidor (server/voces-rutas.ts), con la sesión de la mesa: son de un
 * CORREO, y el correo sale de la sesión firmada, nunca de lo que mande el teléfono. El audio va, se
 * convierte en números allá y se descarta.
 *
 *   GET    /api/voces            → { personas, motor }
 *   POST   /api/voces/aprender   { nombre, relacion, parentesco?, audios: wav[], consentimiento } → { persona }
 *   POST   /api/voces/quien      { audio: wav } → { persona | null, similitud, motivo }
 *   POST   /api/voces/:id/confirmar → { ok } (tanda F1: la dueña confirma en su pantalla a un posible menor)
 *   DELETE /api/voces/:id        → { ok, nombre }
 *   DELETE /api/voces            → { ok, borradas }
 */
import { api } from '../lib/api';
import { TOPE_CONSULTA_VOZ_MS, type PersonaVoz } from './voces';

export const RUTA_VOCES = '/api/voces';

/** Tanda F1: `porConfirmar` (un posible menor que la dueña todavía no confirmó en su pantalla: no se reconoce), con la constancia. */
export type VozGuardada = PersonaVoz & { muestras: number; creado?: number; porConfirmar?: boolean; menor?: boolean; presentadoPor?: string; presentadoEn?: number };
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

/**
 * Con tope corto (revisión 7.5, M1′): las consultas van de a una y el turno solo espera 350 ms; una que tarda 25 s
 * atascaba la fila. A los TOPE_CONSULTA_VOZ_MS se corta (y esa frase queda «sin dato»).
 */
export async function quienHabla(audio: string): Promise<RespuestaQuien> {
  return api<RespuestaQuien>(`${RUTA_VOCES}/quien`, { method: 'POST', body: JSON.stringify({ audio }) }, TOPE_CONSULTA_VOZ_MS);
}

export async function olvidarVoz(id: string): Promise<string> {
  const r = await api<{ ok: boolean; nombre: string }>(`${RUTA_VOCES}/${encodeURIComponent(id)}`, { method: 'DELETE' }, 12_000);
  return r.nombre;
}

export async function olvidarTodasLasVoces(): Promise<number> {
  const r = await api<{ ok: boolean; borradas: number }>(RUTA_VOCES, { method: 'DELETE' }, 12_000);
  return r.borradas;
}

/** Tanda F1: la dueña confirma EN SU PANTALLA a alguien que quedó por confirmar (un posible menor). */
export async function confirmarVoz(id: string): Promise<void> {
  await api<{ ok: boolean }>(`${RUTA_VOCES}/${encodeURIComponent(id)}/confirmar`, { method: 'POST', body: '{}' }, 12_000);
}
