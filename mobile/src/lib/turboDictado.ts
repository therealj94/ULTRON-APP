/**
 * DICTADO TURBO — apretar, hablar, soltar (el dictado de campo de Dr Electrum; José, 2-oct: «Dr Electrum
 * ya puedes conectarlo Turbo»).
 *
 * No es el oído continuo de AU-RA: aquí no hay que adivinar cuándo empieza ni cuándo termina la frase,
 * lo dice el dedo. Desde que se toca el micrófono, cada trozo de 0,1 s va EN VIVO a Scribe v2 Realtime
 * Turbo (con las pistas del oficio y el idioma automático) y lo que va entendiendo cae en la caja
 * mientras se habla. Al soltar, se cierra la frase y Turbo devuelve el texto final en ~0,05 s.
 *
 * Cifras y dinero (coordenadas, números de concesión, montos) se vuelven a oír con Scribe v2 antes de
 * dejarlos en la caja. Si el en vivo falla (sin token, sin WebSocket, sin respuesta), la grabación
 * entera va por /api/electrum/oir: el texto llega igual, un poco después.
 *
 * Sin dependencias de React Native: el micrófono, la red y el WebSocket se inyectan.
 */
import { SILENCIO_COMMIT_B64, esFraseDeDinero, limpiarFinal, wavDeTrozos } from './turboLogica';
import type { TrozoAudio, WsTurbo } from './turboMotor';

export type DepsDictado = {
  abrirMic(alTrozo: (t: TrozoAudio) => void, alFallo: (motivo: string) => void): Promise<(() => void) | null>;
  permiso(): Promise<{ url: string } | null>;
  crearWs(url: string): WsTurbo;
  /** El WAV entero al servidor; `confirmar`: directo con Scribe v2 (sin Turbo). */
  transcribirWav(wavB64: string, confirmar: boolean): Promise<string>;
  esperaFinalMs?: number;
  confirmarMs?: number;
};

export type CallbacksDictado = {
  onParcial?: (texto: string) => void;
  onFinal?: (texto: string) => void;
  onFin?: () => void;
  onError?: (motivo: string) => void;
};

/** Menos que esto no es una frase (y Turbo no acepta cerrar menos de 0,3 s de audio). */
const MINIMO_TROZOS = 4;
const ABIERTO = 1;

export type ControlDictado = { parar: () => void; cancelar: () => void };

/**
 * Empieza a oír. null si el micrófono crudo no abre (quien llama usa el reconocedor del teléfono).
 */
export async function dictarTurbo(deps: DepsDictado, cb: CallbacksDictado): Promise<ControlDictado | null> {
  const trozos: string[] = [];
  const cola: string[] = [];
  let ws: WsTurbo | null = null;
  let abierto = false;
  let vivo = true; // el en vivo sigue sirviendo
  let parcial = '';
  let terminado = false;
  let soltado = false;
  let alCommit: ((texto: string | null) => void) | null = null;

  const enviar = (b64: string, commit: boolean) => {
    if (!vivo) return;
    const msg = JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: b64, commit, sample_rate: 16000 });
    if (abierto && ws && ws.readyState === ABIERTO) {
      try {
        ws.send(msg);
      } catch {
        caerVivo();
      }
    } else cola.push(msg);
  };

  const cerrarWs = () => {
    const w = ws;
    ws = null;
    abierto = false;
    if (!w) return;
    w.onopen = w.onmessage = w.onerror = w.onclose = null;
    try {
      w.close();
    } catch {
      /* */
    }
  };

  /** El en vivo dejó de servir: lo que falte sale de la grabación entera por el servidor. */
  const caerVivo = () => {
    if (!vivo) return;
    vivo = false;
    cola.length = 0;
    cerrarWs();
    alCommit?.(null);
  };

  const cerrarMic = await deps
    .abrirMic(
      (t) => {
        if (soltado) return;
        trozos.push(t.audio);
        enviar(t.audio, false);
      },
      (m) => {
        cb.onError?.(m);
        if (!soltado) parar();
      }
    )
    .catch(() => null);
  if (!cerrarMic) return null;

  // El WebSocket se abre mientras ya se está grabando: lo dicho antes de que conecte espera en la cola.
  void (async () => {
    const p = await deps.permiso().catch(() => null);
    if (!p?.url || !vivo || terminado) return caerVivo();
    let w: WsTurbo;
    try {
      w = deps.crearWs(p.url);
    } catch {
      return caerVivo();
    }
    ws = w;
    w.onopen = () => {
      if (w !== ws) return;
      abierto = true;
      try {
        for (const m of cola.splice(0)) w.send(m);
      } catch {
        caerVivo();
      }
    };
    w.onmessage = (e) => {
      if (w !== ws) return;
      let j: any;
      try {
        j = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      const tipo = String(j?.message_type || '');
      if (tipo === 'partial_transcript') {
        const t = String(j.text || '').trim();
        if (t && t !== parcial && !soltado) {
          parcial = t;
          cb.onParcial?.(t);
        }
      } else if (tipo === 'committed_transcript' || tipo === 'committed_transcript_with_timestamps') {
        alCommit?.(String(j.text || '').trim());
      } else if (/error|exceeded|limited|throttl/i.test(tipo)) {
        caerVivo();
      }
    };
    w.onerror = () => w === ws && caerVivo();
    w.onclose = () => w === ws && caerVivo();
  })();

  const conTope = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
    new Promise((r) => {
      const t = setTimeout(() => r(null), ms);
      p.then(
        (v) => (clearTimeout(t), r(v)),
        () => (clearTimeout(t), r(null))
      );
    });

  const terminar = (texto: string) => {
    if (terminado) return;
    terminado = true;
    cerrarWs();
    if (texto) cb.onFinal?.(texto);
    cb.onFin?.();
  };

  const finalDe = async () => {
    if (trozos.length < MINIMO_TROZOS) return terminar('');
    let texto: string | null = null;
    if (vivo) {
      texto = await new Promise<string | null>((resolver) => {
        const t = setTimeout(() => resolver(null), deps.esperaFinalMs ?? 2_500);
        alCommit = (x) => {
          clearTimeout(t);
          alCommit = null;
          resolver(x);
        };
        enviar(SILENCIO_COMMIT_B64, true);
      });
    }
    let limpio = limpiarFinal(texto || '');
    const wav = () => wavDeTrozos(trozos);
    if (!limpio) {
      // Turbo no contestó (o no había conexión): la grabación entera por el servidor.
      limpio = limpiarFinal((await conTope(deps.transcribirWav(wav(), false), 20_000)) || '');
    } else if (esFraseDeDinero(limpio)) {
      const conf = limpiarFinal((await conTope(deps.transcribirWav(wav(), true), deps.confirmarMs ?? 6_000)) || '');
      if (conf) limpio = conf;
    }
    terminar(limpio);
  };

  function parar() {
    if (soltado) return;
    soltado = true;
    try {
      cerrarMic!();
    } catch {
      /* */
    }
    void finalDe();
  }

  return {
    parar,
    cancelar: () => {
      if (terminado) return;
      soltado = true;
      try {
        cerrarMic!();
      } catch {
        /* */
      }
      vivo = false;
      terminar('');
    },
  };
}
