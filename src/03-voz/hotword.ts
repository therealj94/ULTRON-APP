/**
 * Loop tipo Jarvis en la mesa web.
 * Mic continuo solo con cerebro listo. Hotword → 20 s de turno. Barge-in.
 */

export type FaseMic = 'frio' | 'hotword' | 'turno';

export const SKIP_HOTWORD_MS = 20_000;
export const SILENCE_MS = 400;

const HOT_RE = /^(oye |hey |ok |okay )?ultron\b/i;

export function foldHot(s: string) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hayHotword(texto: string): boolean {
  const q = foldHot(texto);
  return HOT_RE.test(q) || /\b(oye ultron|hey ultron|ok ultron|okay ultron)\b/.test(q);
}

export function quitarHotword(texto: string): string {
  return String(texto || '')
    .replace(/^(oye |hey |ok |okay )?ultron\s*[,:]?\s*/i, '')
    .trim();
}

/** 1–2 sílabas y el fantasma «la hora». No cortes «Orden Global». */
export function esBasuraStt(texto: string): boolean {
  const q = foldHot(texto);
  if (!q) return true;
  if (/orden global/.test(q)) return false;
  if (/^(la hora|hora|ah|eh|mm+|uhm+|este|ok|okay|ya|si)$/.test(q)) return true;
  const pal = q.split(' ').filter(Boolean);
  if (pal.length <= 1 && q.length <= 5 && !/\bultron\b/.test(q)) return true;
  return false;
}

export class LoopJarvis {
  fase: FaseMic = 'frio';
  skipUntil = 0;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private pending = '';

  constructor(
    private readonly onTurno: (texto: string) => void,
    private readonly onFase?: (fase: FaseMic) => void
  ) {}

  setListo(listo: boolean) {
    this.fase = listo ? (Date.now() < this.skipUntil ? 'turno' : 'hotword') : 'frio';
    this.onFase?.(this.fase);
  }

  barge() {
    if (this.fase === 'frio') return;
    this.skipUntil = Date.now() + SKIP_HOTWORD_MS;
    this.fase = 'turno';
    this.onFase?.(this.fase);
  }

  onFinal(texto: string) {
    const t = String(texto || '').trim();
    if (this.fase === 'frio') return;
    if (esBasuraStt(t)) return;
    const abierto = Date.now() < this.skipUntil || this.fase === 'turno';
    if (!abierto && !hayHotword(t)) return;
    const cmd = hayHotword(t) ? quitarHotword(t) : t;
    this.pending = cmd;
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      const out = this.pending.trim();
      this.pending = '';
      if (!out) {
        this.skipUntil = Date.now() + SKIP_HOTWORD_MS;
        this.fase = 'turno';
        this.onFase?.(this.fase);
        return;
      }
      this.skipUntil = Date.now() + SKIP_HOTWORD_MS;
      this.fase = 'turno';
      this.onFase?.(this.fase);
      this.onTurno(out);
    }, SILENCE_MS);
  }

  tick() {
    if (this.fase === 'frio') return;
    if (this.fase === 'turno' && Date.now() >= this.skipUntil && !this.pending) {
      this.fase = 'hotword';
      this.onFase?.(this.fase);
    }
  }

  dispose() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
  }
}
