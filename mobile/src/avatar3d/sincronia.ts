/**
 * LA BOCA A TIEMPO CON LA VOZ: lo que hace falta para que la boca de cualquier cuerpo (la figurita
 * 2D, las fotos de Claudio y ANT-ONIO, el modelo 3D) se mueva cuando SUENA la voz, no antes ni
 * después. Todo puro: lo usa lib/tts.ts (la voz de la mesa), ModoConversacion (la conversación fluida)
 * y lo prueba en Node pruebas/sincronia.prueba.mjs, que mide el desfase boca-audio.
 *
 * Tres piezas:
 *  · la ALINEACIÓN que manda el servidor con cada audio de /api/tts (cabecera `X-Ultron-Alineacion`,
 *    la arma lib/alineacion.ts del servidor con los tiempos por letra de ElevenLabs): cada letra con
 *    su comienzo y su duración, relativos al comienzo del audio;
 *  · el RELOJ de la reproducción: expo-av avisa la posición del audio cada 50–250 ms; entre aviso y
 *    aviso se interpola con el reloj del teléfono (la posición real del audio manda, no la hora);
 *  · la ENVOLVENTE: abre rápido (ataque ~12 ms) y cierra suave (~70 ms), y se corta en seco cuando
 *    la voz se interrumpe.
 */
import { visemaDeLetra } from './visemas';
import type { Visema } from './tipos';

/* ── la alineación de un audio ───────────────────────────────────────────────────────────── */

/** Tiempos por letra de UN audio (ms, desde su comienzo). */
export type AlineacionAudio = { chars: string[]; desde: number[]; dura: number[] };

/**
 * Lee la cabecera `X-Ultron-Alineacion` (formato 1, lib/alineacion.ts del servidor):
 *   `1.<letras en base64url>.<comienzos: diferencias en ms, base 36, con comas>.<duraciones, igual>`
 * Algo mal formado es null (la boca sigue con la envolvente de siempre).
 */
export function leerAlineacion(cabecera: unknown): AlineacionAudio | null {
  const t = typeof cabecera === 'string' ? cabecera.trim() : '';
  const partes = t.split('.');
  if (partes.length !== 4 || partes[0] !== '1') return null;
  try {
    const chars = [...decodificarB64url(partes[1])];
    const desde: number[] = [];
    let acum = 0;
    for (const d of partes[2].split(',')) {
      const n = parseInt(d, 36);
      if (!Number.isFinite(n) || n < 0) return null;
      acum += n;
      desde.push(acum);
    }
    const dura = partes[3].split(',').map((d) => parseInt(d, 36));
    if (!chars.length || chars.length !== desde.length || chars.length !== dura.length || dura.some((n) => !Number.isFinite(n) || n < 0)) return null;
    return { chars, desde, dura };
  } catch {
    return null;
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url → texto UTF-8, sin depender de atob/Buffer (Hermes y Node por igual). */
function decodificarB64url(s: string): string {
  const bytes: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const c of s) {
    const v = B64.indexOf(c);
    if (v < 0) throw new Error('base64url');
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buf >> bits) & 0xff);
    }
  }
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    const n = b < 0x80 ? 1 : b < 0xe0 ? 2 : b < 0xf0 ? 3 : 4;
    let cp = n === 1 ? b : b & (0xff >> (n + 1));
    for (let k = 1; k < n; k++) cp = (cp << 6) | ((bytes[i + k] ?? 0) & 0x3f);
    out += String.fromCodePoint(cp);
    i += n;
  }
  return out;
}

/**
 * Cuánto abre cada visema (0..1): las vocales abren (la «a» más, la «u» menos), P/B/M cierran del
 * todo, las demás consonantes quedan a medias. Es lo que hace que la boca se cierre en «mamá» en vez
 * de quedarse en una «a» larga.
 */
export const APERTURA: Record<Visema, number> = {
  sil: 0,
  PP: 0.04,
  FF: 0.22,
  TH: 0.3,
  DD: 0.34,
  kk: 0.4,
  CH: 0.32,
  SS: 0.26,
  nn: 0.3,
  RR: 0.38,
  aa: 0.92,
  E: 0.72,
  I: 0.56,
  O: 0.8,
  U: 0.5,
};

type Tramo = { desde: number; hasta: number; visema: Visema };

/** La boca de un audio con alineación: qué visema y cuánto abre en cada milisegundo del audio. */
export class BocaAlineada {
  private tramos: Tramo[] = [];
  readonly fin: number;

  constructor(al: AlineacionAudio) {
    let previo: Visema = 'sil';
    for (let i = 0; i < al.chars.length; i++) {
      const v: Visema = visemaDeLetra(al.chars, i) ?? previo;
      previo = v;
      this.tramos.push({ desde: al.desde[i], hasta: al.desde[i] + Math.max(10, al.dura[i]), visema: v });
    }
    this.fin = this.tramos.length ? this.tramos[this.tramos.length - 1].hasta : 0;
  }

  /** El tramo de `pos` (búsqueda binaria: se pregunta 30 veces por segundo). */
  private tramo(pos: number): Tramo | null {
    let a = 0;
    let b = this.tramos.length - 1;
    while (a <= b) {
      const m = (a + b) >> 1;
      const t = this.tramos[m];
      if (pos < t.desde) b = m - 1;
      else if (pos >= t.hasta) a = m + 1;
      else return t;
    }
    return null;
  }

  en(pos: number): { visema: Visema; nivel: number } {
    const t = this.tramo(pos);
    if (!t) return { visema: 'sil', nivel: 0 };
    return { visema: t.visema, nivel: APERTURA[t.visema] };
  }
}

/* ── el reloj de la reproducción ─────────────────────────────────────────────────────────── */

/**
 * La posición del audio que suena AHORA: la última que dijo el reproductor más lo que pasó desde
 * entonces (si está sonando). Si el reproductor corrige hacia atrás un poco (su reloj y el nuestro
 * no van iguales), se acepta; nunca se inventa más allá de un segundo sin aviso.
 */
export class RelojReproduccion {
  private pos = 0;
  private en = 0;
  private sonando = false;

  aviso(posMs: number, ahora: number, sonando: boolean) {
    this.pos = Math.max(0, posMs || 0);
    this.en = ahora;
    this.sonando = sonando;
  }

  posicion(ahora: number): number {
    if (!this.sonando) return this.pos;
    return this.pos + Math.min(1000, Math.max(0, ahora - this.en));
  }

  get activo() {
    return this.sonando;
  }
}

/* ── la envolvente: abre rápido, cierra suave, se corta en seco ──────────────────────────── */

export const ATAQUE_MS = 12;
export const CAIDA_MS = 70;

export class Envolvente {
  private v = 0;
  constructor(
    private ataqueMs = ATAQUE_MS,
    private caidaMs = CAIDA_MS
  ) {}

  /** Un paso hacia `objetivo` después de `dtMs`. */
  seguir(objetivo: number, dtMs: number): number {
    const o = objetivo < 0 ? 0 : objetivo > 1 ? 1 : objetivo;
    const tau = o > this.v ? this.ataqueMs : this.caidaMs;
    this.v += (o - this.v) * (1 - Math.exp(-Math.max(0, dtMs) / tau));
    if (this.v < 0.005) this.v = 0;
    return this.v;
  }

  /** La voz se cortó (interrupción, stop): cerrada ya, sin caída. */
  cortar() {
    this.v = 0;
  }

  get valor() {
    return this.v;
  }
}

/**
 * Cuánto se adelanta la boca a la posición que dice el reproductor: lo que tarda en llegar a la
 * pantalla (el puente a la WebView, un cuadro y el suavizado de la escena). Medido en la prueba de
 * sincronía (pruebas/sincronia.prueba.mjs).
 */
export const ADELANTO_MS = 55;

/** Cada cuánto se calcula la boca mientras suena la voz (≈ un cuadro a 30 fps). */
export const PASO_BOCA_MS = 33;
