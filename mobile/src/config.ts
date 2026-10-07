import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra || {}) as { ultronUrl?: string };

export const API_BASE = (extra.ultronUrl || 'https://ultron-looi-desk.onrender.com').replace(/\/+$/, '');
export const APP_VERSION = Constants.expoConfig?.version || '4.7.0';

/** Nombre público de la única voz de AU-RA (servidor propio: Voicebox, perfil Kokoro Dora). */
export const VOICE_NAME = 'AU-RA (Dora · servidor propio)';

export type DeskUser = {
  id: string;
  name: string;
  correo: string;
  role: string;
};

/**
 * Las cuentas de la junta para elegir en «Otras formas de entrar». Eran correos y nombres reales metidos en el JS de la
 * app (el repositorio es público; auditoría del 7-oct, C-1). La lista va vacía: se entra con el correo (la app lo
 * recuerda en este teléfono tras la primera vez, con su huella) y el SERVIDOR pasa los correos viejos o personales al
 * de la casa (server/desk.ts normalizarCorreo, AURA_CORREOS_ALIAS en Render).
 */
export const DESK_USERS: DeskUser[] = [];

/** Alias de correo del lado del teléfono: ninguno (los resuelve el servidor al entrar). */
export const EMAIL_ALIASES: Record<string, string> = {};

export function normalizeDeskEmail(correo: string): string {
  const raw = String(correo || '').trim().toLowerCase();
  return EMAIL_ALIASES[raw] || raw;
}

export function findDeskUserByEmail(correo: string): DeskUser | undefined {
  const n = normalizeDeskEmail(correo);
  return DESK_USERS.find((u) => u.correo === n);
}

export type { FaceState } from './caraTipos';

export type Mode =
  | 'GUARDIAN'
  | 'MINING'
  | 'GOLD'
  | 'CREATIVE'
  | 'ANALYTICAL'
  | 'STRATEGIC'
  | 'EXPLORER'
  | 'CONOCER';

export type DeskPresence = 'sleep' | 'stay' | 'explore';

export type SessionUser = {
  name: string;
  role: string;
  correo: string;
};
