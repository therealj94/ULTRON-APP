/**
 * /api/tts/pcm — LA VOZ EN STREAMING DEL TELÉFONO (docs/adr/ADR-voz-en-streaming.md).
 *
 * El teléfono (mobile/modules/aura-voz, AudioTrack en MODE_STREAM) empieza a sonar con los primeros ~150 ms de audio
 * en vez de esperar el archivo entero de cada frase. Aquí:
 *
 *  · la MISMA locución que /api/tts (server/voz.ts `abrirVozPcm`: misma voz, modelo, guion, vecinos y tono), pedida a
 *    ElevenLabs en PCM por /stream y reenviada TAL CUAL llega (chunked, sin juntar ni recodificar);
 *  · las MISMAS puertas que /api/tts/stream: `exigirMesaODesk`, el cupo de voz compartido (`limitar(60, 60_000,
 *    'voz')`) y los minutos de ElevenLabs del miembro (sin minutos: Voicebox, pasado a PCM, y `X-Ultron-Tope-Voz`);
 *  · caché propia (la clave lleva el formato), que solo guarda lo que llegó ENTERO; un audio cortado no se guarda y la
 *    conexión se rompe (no se cierra bien): un PCM crudo no tiene largo, y un final limpio lo haría pasar por entero;
 *  · el tiempo para la boca: `X-Ultron-Pcm-Hz` (y canales/bits). El teléfono calcula la posición con los cuadros que
 *    de verdad sonaron (bytes / 2 / hz), no con lo que bajó.
 *
 * Lo que no puede ir en PCM (un servidor sin voz) contesta 503 con JSON: el teléfono dice esa frase por el camino de
 * siempre (/api/tts, expo-av) sin perderla.
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
};

export type DepsVozPcm = {
  exigir: express.RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  leer: (req: express.Request) => PeticionVozPcm;
  /** A nombre de quién se cuentan los minutos de ElevenLabs (un miembro), o null (la junta: sin tope). */
  cuentaMiembro: (req: express.Request) => string | null;
  restanteMs: (cuenta: string) => number;
  anotar: (cuenta: string, ms: number) => void;
  msDeHabla: (texto: string) => number;
};

export const RUTA_VOZ_PCM = '/api/tts/pcm';

export function montarVozPcm(app: express.Express, d: DepsVozPcm) {
  app.all(RUTA_VOZ_PCM, d.exigir, d.limitar(60, 60_000, 'voz'), async (req, res) => {
    const p = d.leer(req);
    if (!p.texto) return res.status(400).json({ error: 'text vacío', honesto: true });
    const cuenta = d.cuentaMiembro(req);
    const sinEleven = !!cuenta && d.restanteMs(cuenta) <= 0;
    let voz: Awaited<ReturnType<typeof abrirVozPcm>> = null;
    try {
      voz = await abrirVozPcm({ ...p, sinEleven });
    } catch (e: any) {
      console.warn('[voz pcm]', String(e?.message || e).slice(0, 160));
    }
    if (!voz) return res.status(503).json({ error: 'Voz no disponible', honesto: true });
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
    await pasarVozEnVivo(voz, res, '[voz pcm]', { romperSiFalla: true });
  });
}
