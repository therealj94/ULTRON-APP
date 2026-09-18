import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra || {}) as { ultronUrl?: string };

export const API_BASE = (extra.ultronUrl || 'https://ultron-looi-desk.onrender.com').replace(/\/+$/, '');
export const APP_VERSION = Constants.expoConfig?.version || '3.0.0';

export type DeskUser = {
  id: 'jose' | 'medardo' | 'otro';
  name: string;
  correo: string;
  role: string;
};

/** Correos oficiales de junta (Orden Global). */
export const DESK_USERS: DeskUser[] = [
  {
    id: 'jose',
    name: 'José',
    correo: 'j.ordonez@ordenglobal.org',
    role: 'Junta Directiva · Orden Global',
  },
  {
    id: 'medardo',
    name: 'Medardo',
    correo: 'm.ordonez@ordenglobal.org',
    role: 'Junta Directiva · Orden Global',
  },
];

/** Alias antiguos → correo canónico (migración login / SecureStore). */
export const EMAIL_ALIASES: Record<string, string> = {
  'mjoseenamorado1994@gmail.com': 'j.ordonez@ordenglobal.org',
  'medardo@ordenglobal.org': 'm.ordonez@ordenglobal.org',
  'j.ordonez@ordenglobal.org': 'j.ordonez@ordenglobal.org',
  'm.ordonez@ordenglobal.org': 'm.ordonez@ordenglobal.org',
};

export function normalizeDeskEmail(correo: string): string {
  const raw = String(correo || '').trim().toLowerCase();
  return EMAIL_ALIASES[raw] || raw;
}

export function findDeskUserByEmail(correo: string): DeskUser | undefined {
  const n = normalizeDeskEmail(correo);
  return DESK_USERS.find((u) => u.correo === n);
}

export type FaceState =
  | 'IDLE'
  | 'LISTENING'
  | 'THINKING'
  | 'SPEAKING'
  | 'HAPPY'
  | 'CONCERNED'
  | 'ANGRY'
  | 'SLEEPING'
  | 'STARTLE'
  | 'WINK'
  | 'CONFUSED'
  | 'MUSIC'
  | 'SCAN'
  | 'YAWNING';

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
