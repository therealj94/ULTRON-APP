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
  | 'YAWNING'
  | 'BURLA'
  | 'CANSADO'
  | 'TRISTE'
  | 'ESTRES'
  | 'EUFORIA'
  | 'FOCUS'
  | 'CURIOSITY'
  | 'PURR'
  | 'SMILE';

/** Tonos de una toma (espejo de server/desk.ts): semitonos vs voz base, palabras por minuto, cara. */
export const TONES = {
  IDLE: { st: 0, wpm: 150, face: 'SPEAKING' as FaceState },
  BURLA: { st: -1, wpm: 145, face: 'BURLA' as FaceState },
  CANSADO: { st: -2, wpm: 125, face: 'CANSADO' as FaceState },
  ENOJO_JUEGO: { st: 0, wpm: 140, face: 'BURLA' as FaceState },
  ENOJO_REAL: { st: -2, wpm: 130, face: 'ANGRY' as FaceState },
  TRISTE: { st: -3, wpm: 120, face: 'TRISTE' as FaceState },
  ESTRES: { st: 0, wpm: 155, face: 'ESTRES' as FaceState },
  EUFORIA: { st: 1, wpm: 160, face: 'EUFORIA' as FaceState },
  FOCUS: { st: 0, wpm: 150, face: 'FOCUS' as FaceState },
  CANTAR: { st: 0, wpm: 150, face: 'MUSIC' as FaceState },
  DESPUES_CANTO: { st: 0, wpm: 145, face: 'SMILE' as FaceState },
} as const;
export type Tone = keyof typeof TONES;

export function normalizeTone(raw: unknown): Tone {
  const t = String(raw || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z_]/g, '');
  return (t in TONES ? t : 'IDLE') as Tone;
}

/** Cómo se dirige ULTRON a cada miembro: Medardo es "jefe". */
export function tratoFor(name: string) {
  return /medardo/i.test(name) ? 'jefe' : name;
}

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
