/**
 * LOS BORRADORES DEL CHAT ATRAVIESAN LA ACTUALIZACIÓN POR AIRE (auditoría del 3-oct, UI01).
 *
 * Los borradores viven en memoria (pulse/borradores.ts). La OTA no recarga con uno recién tocado, pero uno
 * olvidado más de diez minutos deja de frenarla (lib/barreraOta.ts) y recargar lo tiraba. Ahora, justo
 * antes de recargar, se guardan en el llavero del teléfono (un «alijo» con la cuenta dueña) y al volver se
 * devuelven SOLO a esa cuenta; otra cuenta lo descarta sin verlo. Lo puro está aquí (sin React Native ni el
 * llavero): lo prueba tests/borradores-recarga.test.ts.
 */

export type BorradorAlijo = { texto: string; deVoz: boolean; en: number };

/** Lo más que se guarda en el llavero (SecureStore avisa por encima de 2048 bytes por valor). */
export const MAX_ALIJO_BYTES = 2000;
/** Un alijo más viejo que esto ya no es «lo que escribía antes de que se actualizara»: se descarta. */
export const VIDA_ALIJO_MS = 30 * 60_000;

/** Los bytes de un texto en UTF-8 (sin depender de TextEncoder). */
export function bytesUtf8(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) || 0;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

const correoNormal = (c: string) => String(c || '').trim().toLowerCase();

/**
 * El alijo de estos borradores para `correo` (la cuenta del chat). `json: null` si no hay nada que guardar;
 * `cabe: false` si hay borradores pero no caben en el llavero (o no hay cuenta): entonces no se puede
 * prometer que sobrevivan a una recarga.
 */
export function armarAlijo(correo: string, borradores: Record<string, BorradorAlijo | undefined>, ahora: number): { json: string | null; cabe: boolean } {
  const conTexto = Object.entries(borradores).filter(([, b]) => !!b && typeof b.texto === 'string' && b.texto.trim()) as [string, BorradorAlijo][];
  if (!conTexto.length) return { json: null, cabe: true };
  const dueno = correoNormal(correo);
  if (!dueno) return { json: null, cabe: false };
  const json = JSON.stringify({ v: 1, correo: dueno, en: ahora, borradores: Object.fromEntries(conTexto.map(([k, b]) => [k, { texto: b.texto, deVoz: !!b.deVoz, en: Number(b.en) || ahora }])) });
  return bytesUtf8(json) <= MAX_ALIJO_BYTES ? { json, cabe: true } : { json: null, cabe: false };
}

/**
 * Qué hacer con el alijo al volver: `restaurar` (es de esta cuenta y reciente), `descartar` (de otra cuenta,
 * viejo o roto: borrarlo sin usarlo), `esperar` (todavía no hay cuenta del chat) o `nada` (no hay alijo).
 */
export function restaurarAlijo(
  json: string | null | undefined,
  correoActual: string,
  ahora: number
): { accion: 'restaurar' | 'descartar' | 'esperar' | 'nada'; borradores: Record<string, BorradorAlijo> | null } {
  if (!json) return { accion: 'nada', borradores: null };
  let a: { v?: unknown; correo?: unknown; en?: unknown; borradores?: unknown };
  try {
    a = JSON.parse(json);
  } catch {
    return { accion: 'descartar', borradores: null };
  }
  const en = Number(a?.en) || 0;
  if (a?.v !== 1 || typeof a.correo !== 'string' || !a.correo || !en || ahora - en > VIDA_ALIJO_MS || !a.borradores || typeof a.borradores !== 'object') {
    return { accion: 'descartar', borradores: null };
  }
  const actual = correoNormal(correoActual);
  if (!actual) return { accion: 'esperar', borradores: null };
  if (actual !== a.correo) return { accion: 'descartar', borradores: null };
  const out: Record<string, BorradorAlijo> = {};
  for (const [k, b] of Object.entries(a.borradores as Record<string, any>)) {
    if (b && typeof b.texto === 'string' && b.texto.trim()) out[correoNormal(k)] = { texto: b.texto, deVoz: b.deVoz === true, en: Number(b.en) || en };
  }
  return { accion: 'restaurar', borradores: out };
}
