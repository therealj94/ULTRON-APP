/**
 * EL OÍDO TURBO DE LA WEB (José, 2-oct: «¿y la web?»). El mismo motor que el teléfono
 * (mobile/src/lib/turboMotor.ts: guarda lo de antes de la voz, la manda EN VIVO a Scribe v2 Realtime
 * Turbo con un token de un solo uso, parciales mientras se habla, cierre según el silencio y lo que ya
 * entendió, dinero confirmado con Scribe v2, y la frase entera por /api/stt si el en vivo falla). Aquí
 * solo cambia de dónde sale el audio: el micrófono del navegador a 16 kHz, con la cancelación de eco
 * del navegador (la web no se calla el micrófono mientras habla AU-RA: así se le puede hablar encima).
 *
 * Antes la web oía con el reconocimiento del navegador (Google en Chrome; nada en Firefox). Ese queda
 * de respaldo en useOido.ts si este micrófono no abre.
 */
import { MotorTurbo, oidoDelServidor, type CallbacksTurbo, type DepsTurbo, type OidoServidor, type TrozoAudio, type WsTurbo } from '../../mobile/src/lib/turboMotor';
import { aBase64 } from '../../mobile/src/lib/turboLogica';
import { headersMesa } from '../10-infra/sesionCliente';

const FRECUENCIA = 16000;
const MUESTRAS_TROZO = 1600; // 0,1 s

/** ¿Este navegador puede oír con Turbo? (micrófono, audio crudo y WebSocket). */
export function turboWebPosible(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof WebSocket === 'function' &&
    !!((window as any).AudioContext || (window as any).webkitAudioContext)
  );
}

/** El micrófono no se pudo abrir porque la persona (o el navegador) no dio permiso. */
export class SinPermisoMicrofono extends Error {}

/**
 * Lo que corre en el hilo de audio: junta las muestras en trozos de 0,1 s y los pasa al hilo principal.
 * Va como texto porque un AudioWorklet se carga desde una URL (aquí, un Blob).
 */
const PROCESADOR = `
class Trozos extends AudioWorkletProcessor {
  constructor() { super(); this.b = new Float32Array(${MUESTRAS_TROZO}); this.n = 0; }
  process(entradas) {
    const c = entradas[0] && entradas[0][0];
    if (!c) return true;
    for (let i = 0; i < c.length; i++) {
      this.b[this.n++] = c[i];
      if (this.n === this.b.length) { this.port.postMessage(this.b.slice(0)); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('trozos-aura', Trozos);
`;

/** Float32 [-1, 1] → PCM 16 bits en base64, y su volumen en dBFS. */
export function trozoDeMuestras(f: Float32Array): TrozoAudio {
  const bytes = new Uint8Array(f.length * 2);
  let suma = 0;
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]));
    const v = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    suma += v * v;
    bytes[i * 2] = v & 0xff;
    bytes[i * 2 + 1] = (v >> 8) & 0xff;
  }
  const rms = Math.sqrt(suma / Math.max(1, f.length));
  return { audio: aBase64(bytes), db: rms < 1 ? -100 : 20 * Math.log10(rms / 32768) };
}

async function abrirMicWeb(alTrozo: (t: TrozoAudio) => void, alFallo: (motivo: string) => void): Promise<(() => void) | null> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  } catch (e: any) {
    if (/NotAllowed|Permission|Security/i.test(String(e?.name || e?.message || e))) throw new SinPermisoMicrofono(String(e?.message || e));
    return null;
  }
  const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
  let ctx: AudioContext;
  try {
    // A 16 kHz: el navegador baja la frecuencia del micrófono solo (Chrome, Edge, Firefox, Safari 14.1+).
    ctx = new Ctx({ sampleRate: FRECUENCIA });
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    return null;
  }
  if (ctx.sampleRate !== FRECUENCIA) {
    // Un navegador que no deja elegir la frecuencia: Turbo recibiría audio a otra velocidad. Mejor el respaldo.
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
    return null;
  }
  const fuente = ctx.createMediaStreamSource(stream);
  let nodo: AudioNode | null = null;
  const pistaTerminada = () => alFallo('el micrófono se desconectó');
  stream.getAudioTracks().forEach((t) => t.addEventListener('ended', pistaTerminada));
  try {
    if (ctx.audioWorklet) {
      const url = URL.createObjectURL(new Blob([PROCESADOR], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const w = new AudioWorkletNode(ctx, 'trozos-aura');
      w.port.onmessage = (e) => alTrozo(trozoDeMuestras(e.data as Float32Array));
      fuente.connect(w);
      nodo = w;
    } else {
      // Navegadores viejos: ScriptProcessor (obsoleto, pero sigue andando).
      const sp = ctx.createScriptProcessor(2048, 1, 1);
      let b = new Float32Array(MUESTRAS_TROZO);
      let n = 0;
      sp.onaudioprocess = (e) => {
        const c = e.inputBuffer.getChannelData(0);
        for (let i = 0; i < c.length; i++) {
          b[n++] = c[i];
          if (n === b.length) {
            alTrozo(trozoDeMuestras(b));
            b = new Float32Array(MUESTRAS_TROZO);
            n = 0;
          }
        }
      };
      fuente.connect(sp);
      sp.connect(ctx.destination);
      nodo = sp;
    }
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
    return null;
  }
  return () => {
    stream.getAudioTracks().forEach((t) => t.removeEventListener('ended', pistaTerminada));
    try {
      fuente.disconnect();
      nodo?.disconnect();
    } catch {
      /* */
    }
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
  };
}

async function permisoWeb(): Promise<{ url: string } | null> {
  try {
    const r = await fetch('/api/stt/turbo/permiso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headersMesa() },
      body: JSON.stringify({ language: 'es' }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return typeof j?.url === 'string' && j.url.startsWith('wss://') ? { url: j.url } : null;
  } catch {
    return null;
  }
}

/** VOZ-02: con la marca de verificación del servidor; el motor (turboMotor.ts) marca lo que no se pudo corroborar. */
async function transcribirWavWeb(wav: string, confirmar: boolean): Promise<OidoServidor> {
  const r = await fetch('/api/stt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headersMesa() },
    body: JSON.stringify({ audioBase64: `data:audio/wav;base64,${wav}`, mimeType: 'audio/wav', language: 'es', ...(confirmar ? { confirmar: true } : {}) }),
    signal: AbortSignal.timeout(16_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json().catch(() => ({}));
  return oidoDelServidor(j);
}

/**
 * De dónde saca el oído su permiso y su respaldo. Por omisión, los de AU-RA (/api/stt/turbo/permiso y /api/stt);
 * Dr Electrum pasa los suyos (src-electrum/panel/oidoTurbo.ts), con sus pistas del oficio y su puerta.
 */
export type RutasOidoTurbo = Pick<DepsTurbo, 'permiso' | 'transcribirWav' | 'crearWs'>;

/** Un oído Turbo para la web. `alSinPermiso`: el navegador negó el micrófono (no hay respaldo que valga). */
export function crearOidoTurboWeb(cb: CallbacksTurbo & { alSinPermiso?: () => void }, rutas: Partial<RutasOidoTurbo> = {}) {
  const motor = new MotorTurbo({
    abrirMic: async (alTrozo, alFallo) => {
      try {
        return await abrirMicWeb(alTrozo, alFallo);
      } catch (e) {
        if (e instanceof SinPermisoMicrofono) {
          cb.alSinPermiso?.();
          motor.silenciar();
        }
        return null;
      }
    },
    permiso: rutas.permiso || permisoWeb,
    transcribirWav: rutas.transcribirWav || transcribirWavWeb,
    crearWs: rutas.crearWs || ((url) => new WebSocket(url) as unknown as WsTurbo),
  });
  motor.setCallbacks(cb);
  return motor;
}
