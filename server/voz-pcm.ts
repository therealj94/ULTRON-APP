/**
 * /api/tts/pcm — LA VOZ EN STREAMING DEL TELÉFONO (docs/adr/ADR-voz-en-streaming.md).
 *
 * El teléfono (mobile/modules/aura-voz, AudioTrack en MODE_STREAM) empieza a sonar con los primeros ~150 ms de audio
 * en vez de esperar el archivo entero de cada frase. Aquí:
 *
 *  · la MISMA locución que /api/tts (server/voz.ts `abrirVozPcm`: misma voz, modelo, guion, vecinos y tono), pedida a
 *    ElevenLabs en PCM por /stream y reenviada TAL CUAL llega (chunked, sin juntar ni recodificar);
 *  · las MISMAS puertas que /api/tts/stream: `exigirMesaOClip` (sin sesión, solo lo ya guardado: `res.locals.soloClip`;
 *    lo que no está contesta 401), el cupo de voz compartido (`limitar(60, 60_000, 'voz')`) y los minutos de ElevenLabs
 *    del miembro (sin minutos: Voicebox, pasado a PCM, y `X-Ultron-Tope-Voz`);
 *  · caché propia (la clave lleva el formato), que solo guarda lo que llegó ENTERO; un audio cortado no se guarda y la
 *    conexión se rompe (no se cierra bien): un PCM crudo no tiene largo, y un final limpio lo haría pasar por entero;
 *  · el tiempo para la boca: `X-Ultron-Pcm-Hz` (y canales/bits). El teléfono calcula la posición con los cuadros que
 *    de verdad sonaron (bytes / 2 / hz), no con lo que bajó;
 *  · UN corte desde la primera línea (11-oct, VOZ-03): el teléfono que cuelga, el plazo del primer audio
 *    (ESPERA_PRIMER_AUDIO_MS) y la cancelación de la generación cortan S3, ElevenLabs, Voicebox y la lectura; sin
 *    nadie esperando no hay respaldo ni escrituras tarde.
 *
 * Lo que no puede ir en PCM (un servidor sin voz) contesta 503 con JSON: el teléfono dice esa frase por el camino de
 * siempre (/api/tts, expo-av) sin perderla. Lo mismo si ElevenLabs termina limpio SIN un solo byte de audio: las
 * cabeceras esperan al primer audio (`primerAudio`), así que todavía se puede contestar 503; antes salía un 200 vacío,
 * el teléfono lo tomaba por «no es PCM» y apagaba el camino nuevo hasta reabrir la app. Ese 503 (y el de «sin voz»)
 * devuelve el lugar del cupo `voz` (`devolver`): el teléfono la pide por /api/tts, que cobra el suyo; no cuenta doble.
 */
import type express from 'express';
import { abrirVozPcm, pasarVozEnVivo, TIPO_PCM } from './voz';
import type { Emocion } from '../lib/emocion';
import type { AvatarVoz, Idioma } from './eleven';

/** Lo que la ruta lee del pedido: lo mismo que /api/tts (server.ts `leerPeticionVoz`). */
export type PeticionVozPcm = {
  texto: string;
  emocion: Emocion;
  performance: 'speak' | 'sing';
  avatar: AvatarVoz;
  idioma: Idioma;
  privado: boolean;
  previo?: string;
  siguiente?: string;
  /** Dr Electrum (/api/electrum/voz/pcm): su plataforma, la voz del personaje que habla y si es la primera frase. */
  plataforma?: 'ultron' | 'electrum';
  vozPropia?: string;
  primera?: boolean;
  /** La cuenta de la sesión: el hilo de la voz entre frases es solo suyo (server/voz.ts turnoDe). */
  dueno?: string;
};

export type DepsVozPcm = {
  /** Dónde se monta: por omisión /api/tts/pcm (AU-RA); Dr Electrum, /api/electrum/voz/pcm. GET y POST, siempre. */
  ruta?: string;
  exigir: express.RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  leer: (req: express.Request) => PeticionVozPcm;
  /** A nombre de quién se cuentan los minutos de ElevenLabs (un miembro), o null (la junta: sin tope). */
  cuentaMiembro: (req: express.Request) => string | null;
  restanteMs: (cuenta: string) => number;
  anotar: (cuenta: string, ms: number) => void;
  msDeHabla: (texto: string) => number;
  /**
   * Devuelve el lugar que `limitar` cobró a este pedido (server/seguridad.ts `devolverLimite`): la frase no salió por aquí
   * (503) y el teléfono la pide por /api/tts, que cobra el suyo. Sin él, cada respaldo gastaba dos lugares.
   */
  devolver?: (res: express.Response) => void;
  /**
   * La cancelación de la generación de este pedido (la persona interrumpió o empezó otro turno), si quien monta la
   * ruta la conoce. Se junta con el cierre de la conexión y el plazo del primer audio en UN corte (VOZ-03).
   */
  cancelado?: (req: express.Request) => AbortSignal | undefined;
  /** El plazo del primer audio (antes de las cabeceras); por omisión ESPERA_PRIMER_AUDIO_MS. Las pruebas lo acortan. */
  esperaMs?: number;
};

/**
 * Lo que el teléfono espera las cabeceras (Reproductor.kt, `readTimeout` de 15 s): pasado esto ya nadie oye la frase, y
 * seguir pidiéndola a ElevenLabs (o arrancar Voicebox) es gastar para nadie. Solo vale ANTES de las cabeceras: después,
 * el audio ya está sonando y lo cortan el cierre de la conexión o la cancelación.
 */
export const ESPERA_PRIMER_AUDIO_MS = 15_000;

/** Lo mínimo que es audio: una muestra de 16 bits (el reproductor tampoco suena menos, Reproductor.kt `vacia`). */
const MINIMO_AUDIO = 2;

/**
 * Espera el primer audio de ElevenLabs ANTES de comprometer las cabeceras. Devuelve un cuerpo equivalente (lo leído va
 * delante, y cancelarlo cancela a ElevenLabs) o null si terminó, o se cortó, sin `MINIMO_AUDIO` bytes: así todavía se
 * puede contestar 503 en vez de un 200 vacío.
 */
export async function primerAudio(cuerpo: ReadableStream<Uint8Array>, senal?: AbortSignal): Promise<ReadableStream<Uint8Array> | null> {
  const lector = cuerpo.getReader();
  const leidos: Uint8Array[] = [];
  let bytes = 0;
  // El teléfono se fue mientras se esperaba: se deja de pedirle audio a ElevenLabs (la lectura pendiente termina).
  const soltar = () => void lector.cancel().catch(() => undefined);
  senal?.addEventListener('abort', soltar, { once: true });
  try {
    while (bytes < MINIMO_AUDIO) {
      const { done, value } = await lector.read();
      if (done) break;
      if (value?.length) {
        leidos.push(value);
        bytes += value.length;
      }
    }
  } catch {
    bytes = 0;
  }
  senal?.removeEventListener('abort', soltar);
  if (bytes < MINIMO_AUDIO || senal?.aborted) {
    lector.cancel().catch(() => undefined);
    return null;
  }
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const b of leidos) c.enqueue(b);
    },
    async pull(c) {
      try {
        const { done, value } = await lector.read();
        if (done) c.close();
        else if (value) c.enqueue(value);
      } catch (e) {
        c.error(e);
      }
    },
    cancel(motivo) {
      return lector.cancel(motivo);
    },
  });
}

export const RUTA_VOZ_PCM = '/api/tts/pcm';

export function montarVozPcm(app: express.Express, d: DepsVozPcm) {
  app.all(d.ruta || RUTA_VOZ_PCM, d.exigir, d.limitar(60, 60_000, 'voz'), async (req, res) => {
    const p = d.leer(req);
    if (!p.texto) return res.status(400).json({ error: 'text vacío', honesto: true });
    // Sin sesión (server/seguridad.ts exigirMesaOClip): solo lo ya guardado; lo privado nunca lo está.
    const soloCache = res.locals?.soloClip === true;
    const sinSesion = () => res.status(401).json({ error: 'Para que hable algo nuevo, entra con tu cuenta.', code: 'sesion_requerida', honesto: true });
    if (soloCache && p.privado) return sinSesion();
    const cuenta = d.cuentaMiembro(req);
    const sinEleven = !!cuenta && d.restanteMs(cuenta) <= 0;
    /*
     * EL CORTE, ANTES DE LA PRIMERA ESPERA (auditoría del 11-oct, VOZ-03). Antes se escuchaba el cierre recién después de
     * `abrirVozPcm` (caché, S3, ElevenLabs): si el teléfono colgaba mientras ElevenLabs tardaba en dar las cabeceras, el
     * pedido seguía hasta su propio tope (cupo gastado) y, si fallaba, se arrancaba Voicebox para nadie. Ahora un solo
     * corte junta el cierre de la conexión, el plazo del primer audio y la cancelación de la generación, y llega a S3,
     * ElevenLabs, Voicebox y la lectura del audio. Al final se sueltan todos los oyentes.
     */
    const corte = new AbortController();
    let porPlazo = false;
    const alCerrar = () => {
      if (!res.writableEnded) corte.abort(new DOMException('El teléfono colgó.', 'AbortError'));
    };
    res.on('close', alCerrar);
    const generacion = d.cancelado?.(req);
    const alCancelar = () => corte.abort(new DOMException('Se canceló la generación.', 'AbortError'));
    if (generacion?.aborted) alCancelar();
    else generacion?.addEventListener('abort', alCancelar, { once: true });
    let plazo: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      porPlazo = true;
      corte.abort(new DOMException('Se acabó el plazo del primer audio.', 'TimeoutError'));
    }, d.esperaMs ?? ESPERA_PRIMER_AUDIO_MS);
    const soltarPlazo = () => {
      if (plazo) clearTimeout(plazo);
      plazo = undefined;
    };
    /** El teléfono sigue ahí (solo se acabó el plazo o se canceló): 503, y el lugar del cupo vuelve. */
    const contestarCortado = () => {
      if (res.headersSent || res.writableEnded || res.destroyed || !(porPlazo || generacion?.aborted)) return;
      d.devolver?.(res);
      res.status(503).json({ error: 'Voz no disponible', honesto: true });
    };
    try {
      let voz: Awaited<ReturnType<typeof abrirVozPcm>> = null;
      try {
        voz = await abrirVozPcm({ ...p, sinEleven, senal: corte.signal, ...(soloCache ? { soloCache: true } : {}) });
      } catch (e: any) {
        if (!corte.signal.aborted) console.warn('[voz pcm]', String(e?.message || e).slice(0, 160));
      }
      if (corte.signal.aborted) {
        // Llegó tarde: nadie la espera. Se suelta ElevenLabs y no se escribe nada (salvo el 503 si el teléfono sigue).
        if (voz?.tipo === 'vivo') voz.cuerpo.cancel().catch(() => undefined);
        return contestarCortado();
      }
      if (!voz && soloCache) return sinSesion();
      // Un audio vacío (caché o Voicebox) no es una frase: 503, como sin voz.
      if (voz && voz.tipo !== 'vivo' && voz.pcm.length < MINIMO_AUDIO) voz = null;
      // En vivo: las cabeceras esperan al primer audio; si ElevenLabs no dio ni un byte, todavía se contesta 503.
      const cuerpo = voz?.tipo === 'vivo' ? await primerAudio(voz.cuerpo, corte.signal) : null;
      if (corte.signal.aborted) return contestarCortado();
      soltarPlazo();
      if (!voz || (voz.tipo === 'vivo' && !cuerpo)) {
        if (voz) console.warn('[voz pcm] ElevenLabs terminó sin audio: 503 (el teléfono usa el camino de siempre)');
        d.devolver?.(res);
        return res.status(503).json({ error: 'Voz no disponible', honesto: true });
      }
      res.setHeader('Content-Type', TIPO_PCM);
      res.setHeader('X-Ultron-Pcm-Hz', String(voz.hz));
      res.setHeader('X-Ultron-Pcm-Canales', '1');
      res.setHeader('X-Ultron-Pcm-Bits', '16');
      res.setHeader('X-Ultron-TTS', voz.motor);
      // Ni el navegador ni un proxy lo guardan: la caché es la del servidor (y la frase puede ser privada).
      res.setHeader('Cache-Control', 'no-store');
      if (sinEleven) res.setHeader('X-Ultron-Tope-Voz', '1');
      if (voz.tipo !== 'vivo') return res.end(voz.pcm);
      if (cuenta) d.anotar(cuenta, d.msDeHabla(p.texto));
      res.setHeader('X-Ultron-Vivo', '1');
      // Las cabeceras salen ya: el teléfono sabe la frecuencia antes del primer trozo.
      res.flushHeaders();
      // Desde aquí el plazo ya no corre (el audio suena); el cierre y la cancelación siguen cortando la lectura.
      await pasarVozEnVivo({ cuerpo: cuerpo!, guardar: voz.guardar }, res, '[voz pcm]', { romperSiFalla: true, senal: corte.signal });
    } finally {
      soltarPlazo();
      res.off('close', alCerrar);
      generacion?.removeEventListener('abort', alCancelar);
    }
  });
}
