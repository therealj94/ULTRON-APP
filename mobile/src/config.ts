import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra || {}) as { ultronUrl?: string };

export const API_BASE = (extra.ultronUrl || 'https://ultron-looi-desk.onrender.com').replace(/\/+$/, '');
export const APP_VERSION = Constants.expoConfig?.version || '2.1.0';

export type DeskUser = {
  id: 'jose' | 'medardo';
  name: string;
  correo: string;
  role: string;
};

export const DESK_USERS: DeskUser[] = [
  {
    id: 'jose',
    name: 'José',
    correo: 'mjoseenamorado1994@gmail.com',
    role: 'Junta Directiva · Orden Global',
  },
  {
    id: 'medardo',
    name: 'Medardo',
    correo: 'medardo@ordenglobal.org',
    role: 'Junta Directiva · Orden Global',
  },
];

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
