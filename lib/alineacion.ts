/**
 * LOS TIEMPOS POR LETRA DE UNA VOZ, para que la boca del avatar se mueva a tiempo con lo que suena.
 *
 * ElevenLabs los da con /text-to-speech/{voz}/with-timestamps (server/eleven.ts, hablarEleven con
 * `tiempos`): `normalized_alignment` (el texto como se dijo: cifras en palabras) o `alignment`, con
 * `characters`, `character_start_times_seconds` y `character_end_times_seconds`. /api/tts los manda
 * al teléfono en la cabecera `X-Ultron-Alineacion`, junto al audio de siempre (quien no la lee, no
 * nota nada), y el teléfono los lee con mobile/src/avatar3d/sincronia.ts (leerAlineacion).
 *
 *   1.<letras en base64url>.<comienzos: diferencias en ms, base 36, con comas>.<duraciones en ms, base 36>
 *
 * Las etiquetas de v4 que van en el guion ([warmly], [laughs]…) no se dicen como letras: se quitan de
 * la alineación (lo que suene en ellas, una risa, queda como silencio de boca).
 */

export type AlineacionEleven = {
  characters?: unknown;
  character_start_times_seconds?: unknown;
  character_end_times_seconds?: unknown;
};

/** Más que esto no va en una cabecera (los proxies cortan las largas): sin tiempos, la boca usa su envolvente. */
export const CABECERA_MAX = 7000;

/** Las letras con sus tiempos en ms, sin las etiquetas entre corchetes. null si no sirve. */
export function letrasConTiempos(al: AlineacionEleven | null | undefined): { chars: string[]; desde: number[]; dura: number[] } | null {
  const c = al?.characters;
  const s = al?.character_start_times_seconds;
  const e = al?.character_end_times_seconds;
  if (!Array.isArray(c) || !Array.isArray(s) || !Array.isArray(e)) return null;
  const n = Math.min(c.length, s.length, e.length);
  const chars: string[] = [];
  const desde: number[] = [];
  const dura: number[] = [];
  let enEtiqueta = false;
  for (let i = 0; i < n; i++) {
    const ch = String(c[i] ?? '');
    const a = Number(s[i]);
    const b = Number(e[i]);
    if (ch === '[') enEtiqueta = true;
    const saltar = enEtiqueta;
    if (ch === ']') enEtiqueta = false;
    if (saltar || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    const ms = Math.max(0, Math.round(a * 1000));
    // Un solo punto de código por letra: el teléfono las separa así ([...texto]).
    chars.push([...ch.normalize('NFC')][0] || ' ');
    desde.push(desde.length ? Math.max(desde[desde.length - 1], ms) : ms);
    dura.push(Math.max(0, Math.round((b - a) * 1000)));
  }
  return chars.length ? { chars, desde, dura } : null;
}

/** La cabecera `X-Ultron-Alineacion` (formato 1), o null si no hay tiempos o no cabe. */
export function cabeceraAlineacion(al: AlineacionEleven | null | undefined): string | null {
  const t = letrasConTiempos(al);
  if (!t) return null;
  const letras = Buffer.from(t.chars.join(''), 'utf8').toString('base64url');
  const comienzos = t.desde.map((d, i) => (d - (i ? t.desde[i - 1] : 0)).toString(36)).join(',');
  const duraciones = t.dura.map((d) => d.toString(36)).join(',');
  const cab = `1.${letras}.${comienzos}.${duraciones}`;
  return cab.length <= CABECERA_MAX ? cab : null;
}
