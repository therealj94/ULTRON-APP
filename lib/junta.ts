/**
 * Quién de la junta está hablando. José y Medardo no se mezclan.
 */

export type MiembroId = 'jose' | 'medardo';

export const MIEMBROS: Record<MiembroId, { id: MiembroId; nombre: string; correo: string }> = {
  jose: { id: 'jose', nombre: 'José', correo: 'j.ordonez@ordenglobal.org' },
  medardo: { id: 'medardo', nombre: 'Medardo', correo: 'm.ordonez@ordenglobal.org' },
};

function idsDe(envKey: string): string[] {
  return String(process.env[envKey] || '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function fold(s: string) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function nombreDe(id: MiembroId | null | undefined): string {
  if (!id) return 'la junta';
  return MIEMBROS[id].nombre;
}

export function quienEs(opts: {
  nombre?: string;
  correo?: string;
  telegramUserId?: string | number;
  telegramChatId?: string | number;
}): MiembroId | null {
  const correo = fold(opts.correo || '').replace(/^mailto:/, '');
  if (correo.startsWith('j.ordonez') || correo === 'jose@ordenglobal.org') return 'jose';
  if (correo.startsWith('m.ordonez') || correo === 'medardo@ordenglobal.org' || correo.startsWith('medardo@')) return 'medardo';

  const uid = String(opts.telegramUserId || '').trim();
  const cid = String(opts.telegramChatId || '').trim();
  const joseIds = [...idsDe('TELEGRAM_JOSE_USER_IDS'), ...idsDe('TELEGRAM_JOSE_CHAT_ID'), ...idsDe('TELEGRAM_JOSE_USER_ID')];
  const medIds = [...idsDe('TELEGRAM_MEDARDO_USER_IDS'), ...idsDe('TELEGRAM_MEDARDO_CHAT_ID'), ...idsDe('TELEGRAM_MEDARDO_USER_ID')];
  if (uid && joseIds.includes(uid)) return 'jose';
  if (cid && joseIds.includes(cid)) return 'jose';
  if (uid && medIds.includes(uid)) return 'medardo';
  if (cid && medIds.includes(cid)) return 'medardo';

  const n = fold(opts.nombre || '');
  if (!n) return null;
  if (/\bmedardo\b/.test(n)) return 'medardo';
  if (/\bjose\b/.test(n) || n === 'j' || n.startsWith('jose ')) return 'jose';
  return null;
}
