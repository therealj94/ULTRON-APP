/**
 * Lip-sync sin metering.
 *
 * expo-av no expone nivel de audio durante la REPRODUCCIÓN (el `metering` de AVPlaybackStatus solo
 * existe al grabar), ni en Android ni en iOS. Así que la boca se mueve con una envolvente sincronizada a
 * `positionMillis`:
 *   - Con texto conocido (frases TTS, clips del banco): sílabas reales del texto repartidas sobre la duración
 *     real del audio, con pausas en la puntuación. Si el ritmo resultante no es humano (texto aproximado de
 *     un clip largo), se usa la envolvente sin texto.
 *   - Sin texto (canciones, oración, clips largos): pulsos pseudoaleatorios deterministas por posición
 *     (≈ 3–4,5 sílabas/s con silencios), así la boca nunca se queda cerrada mientras suena algo.
 * Todo es puro: no toca Animated ni expo-av (se puede probar en Node).
 */

export type EnvelopeKind = 'speak' | 'sing' | 'pray';

const DEFAULT_RATE: Record<EnvelopeKind, number> = { speak: 4.5, sing: 3.2, pray: 3.8 };

/** Hash determinista 0..1 por índice (para que el mismo instante dé siempre la misma apertura). */
function noise(i: number, seed = 0) {
  let x = (i + 1) * 374761393 + seed * 668265263;
  x = (x ^ (x >>> 13)) * 1274126177;
  x = x ^ (x >>> 16);
  return ((x >>> 0) % 10000) / 10000;
}

/** Sílabas aproximadas de una palabra en español (grupos vocálicos; diptongos cuentan uno). */
export function contarSilabas(palabra: string): number {
  const w = palabra
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zñ]/g, '');
  if (!w) return 0;
  const grupos = w.match(/[aeiou]+/g);
  if (!grupos) return 1;
  let n = 0;
  for (const g of grupos) {
    // hiatos fuertes (ae, ao, ea, eo, oa, oe) cuentan dos; el resto del grupo, uno
    n += 1 + (g.match(/(?:[aeo][aeo])/g)?.length || 0);
  }
  return Math.max(1, n);
}

type Slot = { amp: number };

/** Ranuras (sílabas y pausas) de un texto, en orden. amp=0 es silencio. */
function slotsDeTexto(text: string): Slot[] {
  const out: Slot[] = [];
  const words = text.split(/\s+/).filter(Boolean);
  words.forEach((w, wi) => {
    const s = contarSilabas(w);
    for (let k = 0; k < s; k++) {
      // vocales abiertas (a, e, o) abren más la boca que i/u
      const openness = /[aeo]/.test(w) ? 1 : 0.7;
      out.push({ amp: (0.55 + 0.45 * noise(wi * 7 + k)) * openness });
    }
    if (/[.!?…]$/.test(w)) out.push({ amp: 0 }, { amp: 0 });
    else if (/[,;:—-]$/.test(w)) out.push({ amp: 0 });
  });
  return out;
}

function shape(phase: number, amp: number) {
  // pulso suave con un segundo armónico ligero: abre rápido, cierra un poco más lento
  const p = Math.max(0, Math.min(1, phase));
  const base = Math.sin(Math.PI * p);
  return Math.max(0, Math.min(1, amp * Math.pow(base, 0.8) * (0.85 + 0.15 * Math.sin(3 * Math.PI * p))));
}

/** Envolvente sin texto: pulsos deterministas con silencios. */
export function envolventeLibre(kind: EnvelopeKind = 'speak', seed = 0): (posMs: number) => number {
  const rate = DEFAULT_RATE[kind];
  const slotMs = 1000 / rate;
  return (posMs: number) => {
    if (posMs < 0) return 0;
    const i = Math.floor(posMs / slotMs);
    const h = noise(i, seed);
    const rest = kind === 'sing' ? 0.16 : 0.12;
    if (h < rest) return 0;
    // en canto las notas largas se sostienen (dos ranuras con la misma apertura)
    const amp = 0.45 + 0.55 * noise(i * 3 + 1, seed);
    const phase = (posMs - i * slotMs) / slotMs;
    if (kind === 'sing' && noise(i + 99, seed) > 0.72) return Math.max(0.35, amp * 0.9);
    return shape(phase, amp);
  };
}

/**
 * Envolvente para un audio de `durationMs` que dice `text`. Si el texto no cuadra con la duración
 * (ritmo < 2,2 o > 8 sílabas/s) se ignora y se usa la libre.
 */
export function envolventeDeTexto(text: string | null | undefined, durationMs: number, kind: EnvelopeKind = 'speak'): (posMs: number) => number {
  const clean = String(text || '').trim();
  if (!clean || !durationMs || durationMs < 200) return envolventeLibre(kind, clean.length);
  const slots = slotsDeTexto(clean);
  const spoken = slots.filter((s) => s.amp > 0).length;
  const rate = (spoken * 1000) / durationMs;
  if (spoken < 1 || rate < 2.2 || rate > 8) return envolventeLibre(kind, clean.length);
  // el TTS deja ~120 ms de silencio al inicio y algo al final
  const lead = Math.min(140, durationMs * 0.06);
  const usable = durationMs - lead - Math.min(160, durationMs * 0.08);
  const slotMs = usable / slots.length;
  return (posMs: number) => {
    const t = posMs - lead;
    if (t < 0 || t > usable) return 0;
    const i = Math.min(slots.length - 1, Math.floor(t / slotMs));
    const s = slots[i];
    if (s.amp <= 0) return 0;
    return shape((t - i * slotMs) / slotMs, s.amp);
  };
}
