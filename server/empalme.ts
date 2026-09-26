/**
 * El EMPALME de las expresiones: habla de Voicebox + risa grabada + habla → un solo WAV.
 *
 * Todo en PCM de 16 bits, sin ffmpeg (Render no lo trae). Las piezas se ponen una detrás de otra,
 * sin solaparse: el largo del resultado es exactamente la suma de las partes. En cada unión se
 * funden unos milisegundos (baja al final de una pieza, sube al principio de la siguiente) para que
 * el corte no haga «clic».
 *
 * Antes de pegar se comprueba el formato de cada pieza. Voicebox hoy da 24 kHz mono y las
 * grabaciones también, pero si un día cambia, lo que no coincide se convierte (remuestreo lineal y
 * mezcla de canales); y una expresión que no se puede leer se salta: nunca se pega ruido.
 */
import fs from 'fs';
import path from 'path';
import { leerWav, type Pcm } from '../lib/mp3';
import { EXPRESIONES, expresionDe } from '../lib/expresiones';

/** Los WAV de las expresiones. Viajan con el código (no con la web): solo el servidor los empalma. */
export const DIR_EXPRESIONES = path.join(process.cwd(), 'server', 'expresiones');

/** Milisegundos de fundido en cada unión. Con 8 ms no se oye el fundido y tampoco el corte. */
export const FUNDIDO_MS = 8;

const leidas = new Map<string, Pcm | null>();

/** El PCM de una toma grabada (`risa-corta-1`), leído una vez y guardado en memoria. null si no está o no es PCM 16. */
export function pcmDeToma(toma: string, dir = DIR_EXPRESIONES): Pcm | null {
  const clave = `${dir}|${toma}`;
  if (leidas.has(clave)) return leidas.get(clave)!;
  let pcm: Pcm | null = null;
  try {
    pcm = leerWav(fs.readFileSync(path.join(dir, `${toma}.wav`)));
  } catch {
    pcm = null;
  }
  if (!pcm) console.warn('[voz expresiones] no pude leer la toma', toma);
  leidas.set(clave, pcm);
  return pcm;
}

/** Una toma al azar de esa expresión, ya leída. Si la elegida falla, prueba las otras antes de rendirse. */
export function tomaDeExpresion(etiqueta: string, azar: () => number = Math.random, dir = DIR_EXPRESIONES): { toma: string; pcm: Pcm } | null {
  const e = expresionDe(etiqueta);
  const tomas = e ? EXPRESIONES[e] : [];
  if (!tomas.length) return null;
  const primera = Math.min(tomas.length - 1, Math.floor(azar() * tomas.length));
  for (let i = 0; i < tomas.length; i++) {
    const toma = tomas[(primera + i) % tomas.length];
    const pcm = pcmDeToma(toma, dir);
    if (pcm) return { toma, pcm };
  }
  return null;
}

/**
 * Lleva un PCM al formato de destino. Canales: se promedian a mono o se copia el mono a cada canal.
 * Frecuencia: interpolación lineal, suficiente para una risa de un segundo (no es masterizar).
 */
export function adaptarPcm(pcm: Pcm, hz: number, canales: number): Pcm {
  let mono: Int16Array;
  if (pcm.canales === 1) mono = pcm.muestras;
  else {
    const n = Math.floor(pcm.muestras.length / pcm.canales);
    mono = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let c = 0; c < pcm.canales; c++) s += pcm.muestras[i * pcm.canales + c];
      mono[i] = Math.round(s / pcm.canales);
    }
  }
  if (pcm.hz !== hz && mono.length > 1) {
    const n = Math.max(1, Math.round((mono.length * hz) / pcm.hz));
    const paso = (mono.length - 1) / Math.max(1, n - 1);
    const nuevo = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const x = i * paso;
      const a = Math.floor(x);
      const b = Math.min(mono.length - 1, a + 1);
      nuevo[i] = Math.round(mono[a] + (mono[b] - mono[a]) * (x - a));
    }
    mono = nuevo;
  }
  if (canales === 1) return { muestras: mono, canales: 1, hz };
  const multi = new Int16Array(mono.length * canales);
  for (let i = 0; i < mono.length; i++) for (let c = 0; c < canales; c++) multi[i * canales + c] = mono[i];
  return { muestras: multi, canales, hz };
}

/**
 * Pega las piezas en orden. Todas deben venir ya en el mismo formato (`adaptarPcm`); una que no
 * coincide es un error de quien llama y se lanza, en vez de sonar a ardilla.
 */
export function empalmar(piezas: Pcm[], fundidoMs = FUNDIDO_MS): Pcm {
  if (!piezas.length) throw new Error('nada que empalmar');
  const { hz, canales } = piezas[0];
  for (const p of piezas) if (p.hz !== hz || p.canales !== canales) throw new Error(`formato distinto: ${p.hz} Hz/${p.canales} vs ${hz} Hz/${canales}`);
  const total = piezas.reduce((n, p) => n + p.muestras.length, 0);
  const out = new Int16Array(total);
  let o = 0;
  piezas.forEach((p, k) => {
    const tramas = Math.floor(p.muestras.length / canales);
    const f = Math.min(Math.round((hz * fundidoMs) / 1000), Math.floor(tramas / 4));
    for (let i = 0; i < p.muestras.length; i++) {
      const t = Math.floor(i / canales);
      let g = 1;
      // Sin fundido en el principio del todo ni en el final del todo: ahí no hay unión.
      if (k > 0 && t < f) g = t / f;
      if (k < piezas.length - 1 && t >= tramas - f) g = Math.min(g, (tramas - 1 - t) / f);
      out[o + i] = g === 1 ? p.muestras[i] : Math.round(p.muestras[i] * Math.max(0, g));
    }
    o += p.muestras.length;
  });
  return { muestras: out, canales, hz };
}

/** PCM 16 bits → WAV con cabecera de 44 bytes y tamaños de verdad (no los de streaming). */
export function escribirWav(pcm: Pcm): Buffer {
  const datos = Buffer.alloc(pcm.muestras.length * 2);
  for (let i = 0; i < pcm.muestras.length; i++) datos.writeInt16LE(pcm.muestras[i], i * 2);
  const cab = Buffer.alloc(44);
  cab.write('RIFF', 0, 'ascii');
  cab.writeUInt32LE(36 + datos.length, 4);
  cab.write('WAVE', 8, 'ascii');
  cab.write('fmt ', 12, 'ascii');
  cab.writeUInt32LE(16, 16);
  cab.writeUInt16LE(1, 20);
  cab.writeUInt16LE(pcm.canales, 22);
  cab.writeUInt32LE(pcm.hz, 24);
  cab.writeUInt32LE(pcm.hz * pcm.canales * 2, 28);
  cab.writeUInt16LE(pcm.canales * 2, 32);
  cab.writeUInt16LE(16, 34);
  cab.write('data', 36, 'ascii');
  cab.writeUInt32LE(datos.length, 40);
  return Buffer.concat([cab, datos]);
}
