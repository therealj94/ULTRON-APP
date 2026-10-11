/**
 * LA VOZ EN STREAMING, lo puro (sin React Native ni red: se prueba en Node). docs/adr/ADR-voz-en-streaming.md.
 *
 * El reproductor nativo (modules/aura-voz, AudioTrack en MODE_STREAM) baja el PCM de /api/tts/pcm y empieza a sonar
 * con los primeros `PREBUFFER_MS`, en vez de esperar el archivo entero de cada frase (lib/tts.ts, expo-av). Aquí:
 *
 *  · qué camino toma la voz (`elegirVoz`): el nuevo solo con todo a favor; si no, el de siempre y el motivo;
 *  · lo que llega del nativo, revisado (`eventoVozValido`): nada raro entra a la mesa;
 *  · la boca (`nivelDeRms`): el nativo mide el volumen REAL del audio en la posición que suena (bloques de 20 ms) y aquí
 *    se pasa a la apertura de la boca; la posición sale de los cuadros que sonaron (`msDeBytes`), no de lo bajado;
 *  · cuándo un fallo apaga el camino nuevo en la sesión (`falloDeSesion`) y el interruptor remoto (`configVozValida`).
 */
import type { TextosGuardia } from './camaraNativa';

export const VOZ_VIVO = {
  /** Lo que se junta antes de mandar a sonar: lo justo para que la red no la entrecorte (~150 ms). */
  prebufferMs: 150,
  /** Avisos de posición por segundo (la boca va a 30 Hz, avatar3d/sincronia.ts PASO_BOCA_MS). */
  posicionHz: 30,
  /** Fallos seguidos ANTES de sonar (red, 5xx) que apagan el camino nuevo hasta reabrir la app. */
  fallosSeguidosMax: 2,
} as const;

/** Bytes de PCM de 16 bits mono para `ms` a `hz`. */
export function bytesDeMs(ms: number, hz: number): number {
  return Math.max(0, Math.round((ms * hz) / 1000)) * 2;
}

/** Milisegundos que suenan `bytes` de PCM de 16 bits mono a `hz` (el byte suelto de una muestra a medias no cuenta). */
export function msDeBytes(bytes: number, hz: number): number {
  if (!(hz > 0) || !(bytes > 0)) return 0;
  return (Math.floor(bytes / 2) * 1000) / hz;
}

/**
 * La apertura de la boca (0..1) para un volumen RMS (0..1 de fondo de escala). En dB: de −50 dBFS (silencio de sala)
 * a −12 dBFS (voz plena) abre de 0 a 1. La voz de ElevenLabs ronda −20 dBFS: la boca abre ~3/4 al hablar y se cierra en
 * las pausas de verdad, no con una envolvente inventada.
 */
export function nivelDeRms(rms: number): number {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(Math.min(1, rms));
  return Math.max(0, Math.min(1, (db + 50) / 38));
}

/**
 * `vacio`: el servidor contestó PCM pero sin un solo byte de audio (un ElevenLabs que terminó sin voz): un fallo suelto.
 * `foco`: el sistema no dio el foco de audio (una llamada, otra app) o lo quitó antes de que sonara (motivo
 * foco-denegado / foco-perdido / foco-pausado, Reproductor.kt PoliticaFoco): esa frase va por TEXTO, no por el camino
 * de siempre (expo-av tampoco tiene foco), y no es un fallo del camino nuevo.
 */
export type CodigoFallo = 'red' | 'http' | 'formato' | 'vacio' | 'pista' | 'interno' | 'puente' | 'foco';

export type EventoVoz =
  /** Juntó el prebúfer (o bajó entera si era más corta): lo que la traza llama «audio» (lib/trazaTurno.ts). */
  | { tipo: 'listo'; id: string; hz: number }
  /** La pista avanzó dentro de esta frase: SUENA (el comienzo real, no el play pedido). */
  | { tipo: 'sonando'; id: string }
  /** Dónde va (ms desde su comienzo, por los cuadros que sonaron) y el volumen ahí (RMS 0..1). */
  | { tipo: 'posicion'; id: string; ms: number; nivel: number }
  /** Terminó de bajar: dura `ms`. */
  | { tipo: 'bajado'; id: string; ms: number }
  /** Sonó toda (o la cortaron: `cortada`; o la red se cortó a media frase y sonó lo que llegó: `truncada`). */
  | { tipo: 'termino'; id: string; ms: number; cortada?: boolean; truncada?: boolean }
  /** Falló ANTES de sonar (nada de ella llegó a la pista): quien la pidió la dice por el camino de siempre (`foco`: por texto). */
  | { tipo: 'error'; id: string; codigo: CodigoFallo; status?: number; motivo: string };

const CODIGOS: readonly CodigoFallo[] = ['red', 'http', 'formato', 'vacio', 'pista', 'interno', 'puente', 'foco'];
/** Lo que dice el nativo de antes (APK sin `vacio`, con este JS por aire) cuando la frase llegó sin audio. */
const SIN_AUDIO_VIEJO = /sin audio/i;
const num = (x: unknown, min: number, max: number): number | null => (typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max ? x : null);

/** Lo que manda AuraVozModule (`onVoz`), revisado: basura → null. */
export function eventoVozValido(e: unknown): EventoVoz | null {
  const o = e as any;
  if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !o.id || o.id.length > 80) return null;
  const id: string = o.id;
  switch (o.tipo) {
    case 'listo': {
      const hz = num(o.hz, 8000, 48000);
      return hz ? { tipo: 'listo', id, hz } : null;
    }
    case 'sonando':
      return { tipo: 'sonando', id };
    case 'posicion': {
      const ms = num(o.ms, 0, 3_600_000);
      if (ms === null) return null;
      return { tipo: 'posicion', id, ms, nivel: num(o.nivel, 0, 1) ?? 0 };
    }
    case 'bajado': {
      const ms = num(o.ms, 0, 3_600_000);
      return ms === null ? null : { tipo: 'bajado', id, ms };
    }
    case 'termino': {
      const ms = num(o.ms, 0, 3_600_000) ?? 0;
      return { tipo: 'termino', id, ms, ...(o.cortada === true ? { cortada: true } : {}), ...(o.truncada === true ? { truncada: true } : {}) };
    }
    case 'error': {
      let codigo: CodigoFallo = CODIGOS.includes(o.codigo) ? o.codigo : 'interno';
      // El nativo de antes la marcaba «formato» («llegó sin audio»): es la misma frase vacía, no un servidor sin PCM.
      if (codigo === 'formato' && SIN_AUDIO_VIEJO.test(String(o.motivo || ''))) codigo = 'vacio';
      const status = num(o.status, 100, 599);
      return { tipo: 'error', id, codigo, ...(status ? { status } : {}), motivo: String(o.motivo || codigo).slice(0, 160) };
    }
    default:
      return null;
  }
}

/**
 * ¿Este fallo antes de sonar apaga el camino nuevo hasta reabrir la app? Sí si el módulo truena (la pista no abre, un
 * error interno o del puente), si el servidor no tiene la ruta (404/405: uno viejo) o no manda PCM; o si van
 * `fallosSeguidosMax` frases seguidas que no sonaron (red, 5xx o sin audio). Una sola caída de red no: esa frase va por
 * el camino de siempre y la siguiente lo vuelve a intentar. Una frase que llegó SIN audio (`vacio`) tampoco: es esa
 * frase (ElevenLabs no la dio), no el servidor ni el teléfono. Sin foco de audio (`foco`) nunca: el teléfono está
 * ocupado (una llamada), el camino nuevo no falló.
 */
export function falloDeSesion(f: { codigo: CodigoFallo; status?: number }, seguidos: number): boolean {
  if (f.codigo === 'foco') return false;
  if (f.codigo === 'pista' || f.codigo === 'interno' || f.codigo === 'puente' || f.codigo === 'formato') return true;
  // Un 401 suelto es un token vencido (la voz pide sesión desde el 7-oct): el respaldo lo renueva y la siguiente frase
  // vuelve por aquí. Dos seguidos, abajo, sí apagan el camino nuevo.
  if (f.codigo === 'http' && (f.status === 404 || f.status === 405 || f.status === 403)) return true;
  return seguidos >= VOZ_VIVO.fallosSeguidosMax;
}

export type MotivoVoz = 'vivo' | 'no-android' | 'sin-modulo' | 'sin-decidir' | 'remoto' | 'ajuste' | 'bloqueada' | 'fallo';

/**
 * El camino nuevo solo si: Android, el binario trae el módulo (una APK vieja que recibe este JS por aire no lo trae),
 * ya se leyó lo guardado (hasta entonces, el de siempre), el servidor no lo apagó (AURA_VOZ_STREAM=0), la persona no lo
 * apagó en Ajustes (encendido por omisión), la guardia no lo bloqueó en este teléfono y no falló en esta sesión.
 */
export function elegirVoz(o: { android: boolean; modulo: boolean; decidido: boolean; ajuste?: boolean; remoto?: boolean; bloqueada: boolean; falloEnSesion?: boolean }): { usar: 'vivo' | 'archivo'; motivo: MotivoVoz } {
  if (!o.android) return { usar: 'archivo', motivo: 'no-android' };
  if (!o.modulo) return { usar: 'archivo', motivo: 'sin-modulo' };
  if (!o.decidido) return { usar: 'archivo', motivo: 'sin-decidir' };
  if (o.remoto === false) return { usar: 'archivo', motivo: 'remoto' };
  if (o.ajuste === false) return { usar: 'archivo', motivo: 'ajuste' };
  if (o.bloqueada) return { usar: 'archivo', motivo: 'bloqueada' };
  if (o.falloEnSesion) return { usar: 'archivo', motivo: 'fallo' };
  return { usar: 'vivo', motivo: 'vivo' };
}

export type ConfigVozRemota = { activa: boolean };

/** Lo que dice GET /api/movil/config de la voz en streaming, revisado. Sin dato (servidor viejo, sin red): encendida. */
export function configVozValida(v: unknown): ConfigVozRemota {
  const o = (v as any)?.vozStream ?? null;
  if (!o || typeof o !== 'object') return { activa: true };
  return { activa: o.activa !== false };
}

/** Las palabras de la guardia contra cierres para la voz (camaraNativa.ts guardiaAlArrancar). */
export const TEXTOS_GUARDIA_VOZ: TextosGuardia = { nombre: 'voz en vivo', montar: 'al arrancar la voz en vivo', montando: 'arrancándola' };

/** Las cabeceras que lleva cada frase al nativo: las de sesión (lib/api.ts sessionHeaders) y que se quiere PCM. */
export function cabecerasVoz(sesion: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = { Accept: 'audio/pcm' };
  for (const [k, v] of Object.entries(sesion || {})) if (typeof v === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(k) && !/[\r\n]/.test(v)) out[k] = v;
  return out;
}
