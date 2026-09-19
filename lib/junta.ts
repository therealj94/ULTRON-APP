/**
 * Quién de la junta está hablando. José, Medardo, Carlos y Mayra no se mezclan.
 * Carlos y Mayra: consulta. No cambian el sistema.
 */

export type MiembroId = 'jose' | 'medardo' | 'carlos' | 'mayra';

export const MIEMBROS: Record<MiembroId, { id: MiembroId; nombre: string; correo: string }> = {
  jose: { id: 'jose', nombre: 'José', correo: 'j.ordonez@ordenglobal.org' },
  medardo: { id: 'medardo', nombre: 'Medardo', correo: 'm.ordonez@ordenglobal.org' },
  carlos: { id: 'carlos', nombre: 'Carlos', correo: '' },
  mayra: { id: 'mayra', nombre: 'Mayra', correo: '' },
};

function idsDe(envKey: string): string[] {
  return String(process.env[envKey] || '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function idsTelegramDe(quien: MiembroId): string[] {
  const u = quien.toUpperCase();
  return [...idsDe(`TELEGRAM_${u}_USER_IDS`), ...idsDe(`TELEGRAM_${u}_CHAT_ID`), ...idsDe(`TELEGRAM_${u}_USER_ID`)];
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

/**
 * Mando = José o Medardo IDENTIFICADOS (sesión firmada o Telegram verificado).
 * Carlos, Mayra y cualquiera sin identificar: consulta. Nadie anónimo cambia el sistema.
 */
export function puedeCambiarSistema(id: MiembroId | null | undefined): boolean {
  return id === 'jose' || id === 'medardo';
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
  for (const id of Object.keys(MIEMBROS) as MiembroId[]) {
    const ids = idsTelegramDe(id);
    if (uid && ids.includes(uid)) return id;
    if (cid && ids.includes(cid)) return id;
  }

  const n = fold(opts.nombre || '');
  if (!n) return null;
  if (/\bmedardo\b/.test(n)) return 'medardo';
  if (/\bmayra\b/.test(n)) return 'mayra';
  if (/\b(carlos|paguada)\b/.test(n) || /\bleonardo paguada\b/.test(n)) return 'carlos';
  if (/\bjose\b/.test(n) || n === 'j' || n.startsWith('jose ')) return 'jose';
  return null;
}
