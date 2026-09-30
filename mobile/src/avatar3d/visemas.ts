/**
 * DE LA VOZ A LA FORMA DE LA BOCA (visemas), con lo que de verdad llega al teléfono.
 *
 * Qué da ElevenLabs Conversational al cliente (revisado en el SDK que usa la app, @elevenlabs/client
 * 1.26 bajo @elevenlabs/react-native 1.2):
 *  · el VOLUMEN de la voz del agente (`getOutputVolume`, 0..1), que ya mueve la boca hoy;
 *  · el ESPECTRO de esa voz (`getOutputByteFrequencyData`: bandas de 100 a 8000 Hz que LiveKit calcula
 *    en nativo), que alcanza para distinguir una «s» de una «a» o una «u»;
 *  · la ALINEACIÓN por letra (`onAudioAlignment`: chars, char_start_times_ms, char_durations_ms) SOLO
 *    cuando el audio viaja en eventos `audio`. En React Native la conexión es WebRTC y el audio va por
 *    la pista de LiveKit, así que lo normal es que no llegue; si llega, manda ella.
 *
 * Así que hay tres fuentes, de mejor a peor: alineación (la letra exacta) → espectro (la familia del
 * sonido) → volumen (solo cuánto abre). Todo aquí es puro: se prueba en Node y lo usa también la
 * escena 3D.
 */
import type { Boca, Visema } from './tipos';

/* ── letras → visemas (español; seseo: c/z suenan como s) ─────────────────────────────────── */

const quitarTilde = (c: string) => c.normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * El visema de la letra `i` de `letras`, mirando las vecinas: «ch», «ll», «qu», «gu», «c» antes de
 * e/i. Una «h» sola no suena (se queda con el visema de la anterior: null). Lo que no es letra es
 * silencio.
 */
export function visemaDeLetra(letras: readonly string[], i: number): Visema | null {
  const c = quitarTilde(String(letras[i] || '').toLowerCase());
  const sig = quitarTilde(String(letras[i + 1] || '').toLowerCase());
  const ant = quitarTilde(String(letras[i - 1] || '').toLowerCase());
  if (!c || !/[a-zñü]/.test(c)) return 'sil';
  switch (c) {
    case 'a':
      return 'aa';
    case 'e':
      return 'E';
    case 'i':
      return 'I';
    case 'o':
      return 'O';
    case 'u':
    case 'ü':
    case 'w':
      // La «u» muda de «que/qui/gue/gui» no redondea la boca.
      if ((ant === 'q' || ant === 'g') && (sig === 'e' || sig === 'i')) return null;
      return 'U';
    case 'p':
    case 'b':
    case 'v':
    case 'm':
      return 'PP';
    case 'f':
      return 'FF';
    case 't':
    case 'd':
      return 'DD';
    case 'c':
      if (sig === 'h') return 'CH';
      return sig === 'e' || sig === 'i' ? 'SS' : 'kk';
    case 'k':
    case 'q':
    case 'g':
    case 'j':
    case 'x':
      return 'kk';
    case 'h':
      // Muda sola, y en «ch» ya la contó la «c».
      return null;
    case 's':
    case 'z':
      return 'SS';
    case 'y':
      // «y» sola o al final de palabra es vocal («hoy», «y»); si no, suena como «ll».
      return !/[a-zñ]/.test(sig) ? 'I' : 'CH';
    case 'l':
      if (sig === 'l') return 'CH';
      return ant === 'l' ? null : 'nn';
    case 'n':
    case 'ñ':
      return 'nn';
    case 'r':
      return ant === 'r' ? null : 'RR';
    default:
      return 'sil';
  }
}

/** Los visemas de un texto, una entrada por letra (null = la letra no cambia la boca). */
export function visemasDeTexto(texto: string): (Visema | null)[] {
  const letras = [...String(texto || '')];
  return letras.map((_, i) => visemaDeLetra(letras, i));
}

/* ── la alineación de ElevenLabs → una línea de tiempo ───────────────────────────────────── */

export type Alineacion = { chars: string[]; char_start_times_ms: number[]; char_durations_ms: number[] };

type Tramo = { desde: number; hasta: number; visema: Visema };

/**
 * Los visemas por venir, en hora absoluta (ms). Cada pedazo de audio trae su alineación relativa a
 * su propio comienzo; los pedazos suenan uno detrás del otro, así que cada uno empieza donde terminó
 * el anterior (o ahora, más la demora del audio, si ya no sonaba nada).
 */
export class LineaVisemas {
  private tramos: Tramo[] = [];
  private fin = 0;

  constructor(private demoraMs = 120) {}

  /** Se agrega un pedazo que llegó a la hora `ahora`. Una alineación mal formada no agrega nada. */
  agregar(al: Alineacion, ahora: number) {
    const n = Math.min(al?.chars?.length || 0, al?.char_start_times_ms?.length || 0, al?.char_durations_ms?.length || 0);
    if (!n) return;
    const base = Math.max(ahora + this.demoraMs, this.fin);
    let previo: Visema = 'sil';
    for (let i = 0; i < n; i++) {
      const v: Visema = visemaDeLetra(al.chars, i) ?? previo;
      previo = v;
      const desde = base + Math.max(0, Number(al.char_start_times_ms[i]) || 0);
      const hasta = desde + Math.max(10, Number(al.char_durations_ms[i]) || 0);
      this.tramos.push({ desde, hasta, visema: v });
      if (hasta > this.fin) this.fin = hasta;
    }
    // No se guarda más de un minuto por delante (un servidor que manda de más no llena la memoria).
    if (this.tramos.length > 4000) this.tramos.splice(0, this.tramos.length - 4000);
  }

  /** El visema que suena en `t`, o null si la alineación no cubre ese instante. */
  en(t: number): Visema | null {
    while (this.tramos.length && this.tramos[0].hasta < t - 50) this.tramos.shift();
    for (const tr of this.tramos) {
      if (tr.desde > t) break;
      if (t <= tr.hasta) return tr.visema;
    }
    return null;
  }

  /** Le hablaron encima: lo que faltaba decir ya no suena. */
  cortar() {
    this.tramos = [];
    this.fin = 0;
  }

  activa(t: number): boolean {
    return this.fin > t;
  }
}

/* ── el espectro → la familia del sonido ─────────────────────────────────────────────────── */

/** Las bandas de `getOutputByteFrequencyData` van de 100 a 8000 Hz (MIN/MAX_VOICE_FREQUENCY del SDK). */
export const HZ_MIN = 100;
export const HZ_MAX = 8000;

/**
 * Una forma de boca aproximada con la energía por bandas (0..255 cada una): las fricativas (s, f, ch)
 * tienen la energía arriba de 3,5 kHz; la «i» y la «e», el segundo formante alto (1,8–2,5 kHz); la
 * «o» y la «u», todo abajo; la «a», abajo y en medio. No reemplaza a la alineación, pero la boca deja
 * de ser un «ah» que solo abre y cierra.
 */
export function visemaDeEspectro(bandas: ArrayLike<number>, nivel: number): { visema: Visema; peso: number } {
  if (nivel < 0.04 || !bandas || !bandas.length) return { visema: 'sil', peso: 1 };
  const n = bandas.length;
  const paso = (HZ_MAX - HZ_MIN) / n;
  let bajo = 0;
  let medio = 0;
  let alto = 0;
  for (let i = 0; i < n; i++) {
    const f = HZ_MIN + (i + 0.5) * paso;
    const e = Math.max(0, Number(bandas[i]) || 0);
    if (f < 800) bajo += e;
    else if (f < 2600) medio += e;
    else if (f >= 3500) alto += e;
  }
  const total = bajo + medio + alto;
  if (total <= 0) return { visema: 'aa', peso: 0.3 };
  const b = bajo / total;
  const m = medio / total;
  const a = alto / total;
  if (a > 0.45) return { visema: 'SS', peso: 0.6 };
  if (m > 0.42 && b < 0.42) return { visema: a > 0.2 ? 'I' : 'E', peso: 0.55 };
  if (b > 0.62) return { visema: nivel < 0.35 ? 'U' : 'O', peso: 0.55 };
  return { visema: 'aa', peso: 0.5 };
}

/* ── las tres fuentes juntas ─────────────────────────────────────────────────────────────── */

/**
 * La boca de este instante: el volumen dice cuánto abre; la forma sale de la alineación si cubre
 * este instante, si no del espectro, y si no hay espectro, una «a» suave que solo abre y cierra.
 */
export function componerBoca(nivel: number, o: { alineado?: Visema | null; espectro?: ArrayLike<number> | null } = {}): Boca {
  const n = nivel < 0 ? 0 : nivel > 1 ? 1 : nivel;
  if (o.alineado) return { nivel: o.alineado === 'sil' ? Math.min(n, 0.1) : Math.max(n, 0.25), visema: o.alineado, peso: 1 };
  if (n < 0.04) return { nivel: n, visema: 'sil', peso: 1 };
  if (o.espectro && o.espectro.length) {
    const e = visemaDeEspectro(o.espectro, n);
    return { nivel: n, visema: e.visema, peso: e.peso };
  }
  return { nivel: n, visema: 'aa', peso: 0.4 };
}
