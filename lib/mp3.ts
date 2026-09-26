/**
 * WAV → MP3, en JavaScript puro.
 *
 * Voicebox devuelve WAV (PCM 16 bits, 24 kHz, mono). La web y el teléfono lo reproducen tal cual,
 * pero Telegram no: `sendVoice` solo acepta OGG/Opus, MP3 o M4A, y un WAV llega como archivo suelto
 * en vez de nota de voz. Render no trae ffmpeg, así que la conversión se hace aquí con LAME portado
 * a JS (@breezystack/lamejs). La usan las notas de voz y el script que graba los clips.
 */

export type Pcm = { muestras: Int16Array; canales: number; hz: number };

/** Lee un WAV PCM de 16 bits. `null` si no es RIFF/WAVE o no es PCM de 16 bits. */
export function leerWav(buf: Buffer): Pcm | null {
  if (!buf || buf.length < 44) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let canales = 0;
  let hz = 0;
  let bits = 0;
  let formato = 0;
  let o = 12;
  while (o + 8 <= buf.length) {
    const id = buf.toString('ascii', o, o + 4);
    let largo = buf.readUInt32LE(o + 4);
    const cuerpo = o + 8;
    if (id === 'fmt ') {
      formato = buf.readUInt16LE(cuerpo);
      canales = buf.readUInt16LE(cuerpo + 2);
      hz = buf.readUInt32LE(cuerpo + 4);
      bits = buf.readUInt16LE(cuerpo + 14);
    } else if (id === 'data') {
      // Un WAV en streaming puede declarar un tamaño de datos falso (0 o 0xFFFFFFFF): se lee hasta el final.
      if (!largo || cuerpo + largo > buf.length) largo = buf.length - cuerpo;
      // 1 = PCM; 0xFFFE = WAVE_FORMAT_EXTENSIBLE, que con 16 bits también es PCM entero.
      if ((formato !== 1 && formato !== 0xfffe) || bits !== 16 || !canales || !hz) return null;
      const n = Math.floor(largo / 2);
      const muestras = new Int16Array(n);
      for (let i = 0; i < n; i++) muestras[i] = buf.readInt16LE(cuerpo + i * 2);
      return { muestras, canales, hz };
    }
    o = cuerpo + largo + (largo & 1);
  }
  return null;
}

/** Duración en segundos de un WAV PCM (0 si no se puede leer). */
export function duracionWav(buf: Buffer): number {
  const pcm = leerWav(buf);
  return pcm ? pcm.muestras.length / pcm.canales / pcm.hz : 0;
}

/**
 * Codifica un WAV a MP3. 64 kbps sobra para voz a 24 kHz y deja una nota de 30 s en ~240 KB.
 * `null` si el WAV no se entiende: quien llama decide (Telegram manda el texto sin audio).
 */
export async function wavAMp3(wav: Buffer, kbps = 64): Promise<Buffer | null> {
  const pcm = leerWav(wav);
  if (!pcm || pcm.canales > 2) return null;
  // Import dinámico a propósito: el servidor se empaqueta en CommonJS y el `require` de este paquete
  // devuelve un objeto vacío (su build CJS es un IIFE). `import()` se conserva tal cual y Node carga
  // la versión ESM. De paso, los 470 KB del codificador solo se cargan cuando hay que codificar.
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const enc = new Mp3Encoder(pcm.canales, pcm.hz, kbps);
  const trozos: Uint8Array[] = [];
  const BLOQUE = 1152 * 8;
  if (pcm.canales === 1) {
    for (let i = 0; i < pcm.muestras.length; i += BLOQUE) {
      const t = enc.encodeBuffer(pcm.muestras.subarray(i, i + BLOQUE));
      if (t.length) trozos.push(t);
    }
  } else {
    const n = Math.floor(pcm.muestras.length / 2);
    const izq = new Int16Array(n);
    const der = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      izq[i] = pcm.muestras[i * 2];
      der[i] = pcm.muestras[i * 2 + 1];
    }
    for (let i = 0; i < n; i += BLOQUE) {
      const t = enc.encodeBuffer(izq.subarray(i, i + BLOQUE), der.subarray(i, i + BLOQUE));
      if (t.length) trozos.push(t);
    }
  }
  const cola = enc.flush();
  if (cola.length) trozos.push(cola);
  const mp3 = Buffer.concat(trozos.map((t) => Buffer.from(t.buffer, t.byteOffset, t.length)));
  return mp3.length > 0 ? mp3 : null;
}
