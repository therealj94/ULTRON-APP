/**
 * EL OÍDO SIEMPRE ABIERTO de Dr Electrum en la web.
 *
 * El micrófono queda escuchando: cuando alguien habla, se graba SOLO esa frase (desde un poco ANTES
 * de que empiece hasta que hay ~0,85 s de silencio), se pasa a texto en el servidor (ElevenLabs
 * Scribe, Whisper de respaldo) y se entrega a `enrutarDicho`: un comando («acércate», «siguiente»)
 * se ejecuta en el acto; lo demás es una pregunta para la mesa.
 *
 * Para que una conversación no falle:
 *  · No se come la primera sílaba: se guarda siempre el último medio segundo, y la frase empieza
 *    con él (con MediaRecorder la grabación arrancaba tarde: «acércate» llegaba como «cércate»).
 *  · No pierde frases: mientras una se pasa a texto, la siguiente ya se está grabando, y los textos
 *    se entregan en el orden en que se dijeron. Si la red falla, se reintenta una vez.
 *  · No se escucha a sí mismo: mientras suena una voz de la mesa (y un momento después) no graba,
 *    con cancelación de eco del navegador además. Hablarle encima fuerte y sostenido lo interrumpe.
 *  · El umbral se adapta al ruido del lugar: una oficina no es un cerro con viento.
 *  · Una frase de menos de un tercio de segundo (un golpe, una tos) no se manda.
 *  · Si el micrófono se desconecta (audífonos que se quitan), se vuelve a abrir solo.
 *
 * El modo «tocar para hablar» apaga esto y deja el botón de dictado de siempre.
 */
import { headersElectrum } from '../acceso';

export type EstadoOido = 'apagado' | 'pidiendo' | 'escuchando' | 'oyendo' | 'pasando' | 'sin-permiso' | 'sin-soporte';

type Opciones = {
  /** Se llama con cada frase oída, ya en texto, en el orden en que se dijeron. */
  alTexto: (texto: string) => void;
  alEstado: (e: EstadoOido) => void;
  /** ¿Está sonando una voz de la mesa ahora? Mientras sí, no se graba (salvo que la interrumpan). */
  hablandoAhora: () => boolean;
  /**
   * Alguien le habla ENCIMA, fuerte y sostenido: como en una conversación de verdad, el doctor se
   * calla y escucha. Quien llama corta la voz; el oído empieza a grabar en el acto.
   */
  alInterrumpir?: () => void;
};

const PREVIO_MS = 450;
const SILENCIO_FIN_MS = 850;
/** Lo que se deja de silencio al final de la frase (el resto no se sube). */
const COLA_SILENCIO_MS = 250;
const MIN_VOZ_MS = 330;
const MAX_FRASE_MS = 30_000;
const ARRANQUE_MS = 90;
const COLA_ECO_MS = 400;
/** Interrumpir exige voz fuerte (el eco del parlante, tras la cancelación, queda muy por debajo)… */
const RMS_INTERRUMPIR = 0.08;
/** …y sostenida. Un golpe o una tos no cortan al doctor. */
const INTERRUMPIR_MS = 400;
/** Lo que se sube: 16 kHz, 16 bits, mono. Es lo que usan los modelos de voz a texto. */
const TASA_SALIDA = 16_000;

/** El procesador de audio del hilo de sonido: junta trozos de ~40 ms y los pasa al hilo principal. */
const OREJA = `class Oreja extends AudioWorkletProcessor {
  constructor() { super(); this.b = new Float32Array(2048); this.n = 0; }
  process(entradas) {
    const c = entradas[0] && entradas[0][0];
    if (c) for (let i = 0; i < c.length; i++) {
      this.b[this.n++] = c[i];
      if (this.n === this.b.length) { this.port.postMessage(this.b); this.b = new Float32Array(2048); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('oreja-electrum', Oreja);`;

/** Muestras en coma flotante → WAV de 16 bits a 16 kHz (promediando al bajar la tasa). */
export function aWav(trozos: Float32Array[], tasa: number): Blob {
  const total = trozos.reduce((n, t) => n + t.length, 0);
  const datos = new Float32Array(total);
  let o = 0;
  for (const t of trozos) {
    datos.set(t, o);
    o += t.length;
  }
  const salida = Math.min(TASA_SALIDA, Math.round(tasa));
  const razon = tasa / salida;
  const n = Math.floor(total / razon);
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const ini = Math.floor(i * razon);
    const fin = Math.max(ini + 1, Math.min(total, Math.floor((i + 1) * razon)));
    let s = 0;
    for (let k = ini; k < fin; k++) s += datos[k];
    s = Math.max(-1, Math.min(1, s / (fin - ini)));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const cab = new DataView(new ArrayBuffer(44));
  const txt = (p: number, t: string) => [...t].forEach((c, k) => cab.setUint8(p + k, c.charCodeAt(0)));
  txt(0, 'RIFF');
  cab.setUint32(4, 36 + pcm.byteLength, true);
  txt(8, 'WAVE');
  txt(12, 'fmt ');
  cab.setUint32(16, 16, true);
  cab.setUint16(20, 1, true);
  cab.setUint16(22, 1, true);
  cab.setUint32(24, salida, true);
  cab.setUint32(28, salida * 2, true);
  cab.setUint16(32, 2, true);
  cab.setUint16(34, 16, true);
  txt(36, 'data');
  cab.setUint32(40, pcm.byteLength, true);
  return new Blob([cab.buffer, pcm.buffer], { type: 'audio/wav' });
}

const rmsDe = (t: Float32Array) => {
  let s = 0;
  for (let k = 0; k < t.length; k++) s += t[k] * t[k];
  return Math.sqrt(s / (t.length || 1));
};

export function crearOido(op: Opciones) {
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let nodo: AudioNode | null = null;
  let activo = false;
  // Lo que quiere la persona (encendido o no): una reconexión automática no enciende lo que apagó.
  let querido = false;
  let abriendo: Promise<boolean> | null = null;
  let tasa = 48_000;
  // El último medio segundo, siempre: la frase empieza con él.
  let previo: Float32Array[] = [];
  let previoMs = 0;
  let frase: Float32Array[] | null = null;
  let fraseMs = 0;
  let vozMs = 0;
  let desdeVozMs = 0;
  let sobreMs = 0;
  let encimaMs = 0;
  let ecoMs = 0;
  let ruido = 0.008;
  let nivelActual = 0;
  let pendientes = 0;
  // Los textos salen en el orden en que se dijeron, aunque el servidor conteste desordenado.
  let cadena: Promise<void> = Promise.resolve();
  let estado: EstadoOido = 'apagado';
  const poner = (e: EstadoOido) => {
    if (e !== estado) {
      estado = e;
      op.alEstado(e);
    }
  };
  const reposo = () => poner(frase ? 'oyendo' : pendientes ? 'pasando' : 'escuchando');

  async function transcribir(wav: Blob): Promise<string> {
    const base64 = await new Promise<string>((res) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.readAsDataURL(wav);
    });
    for (let intento = 0; intento < 2; intento++) {
      try {
        const r = await fetch('/api/electrum/oir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headersElectrum() },
          body: JSON.stringify({ audio: base64, mime: 'audio/wav' }),
          signal: AbortSignal.timeout(20_000),
        });
        // Un 5xx o la red caída se reintentan una vez; un 4xx no (el audio no sirve).
        if (r.status >= 500 && intento === 0) {
          await new Promise((ok) => setTimeout(ok, 400));
          continue;
        }
        const j = await r.json().catch(() => ({}) as any);
        return String(j?.texto || '').trim();
      } catch {
        if (intento === 0) await new Promise((ok) => setTimeout(ok, 400));
      }
    }
    return '';
  }

  function mandar(trozos: Float32Array[]) {
    pendientes++;
    reposo();
    const texto = transcribir(aWav(trozos, tasa));
    cadena = cadena.then(async () => {
      try {
        const t = await texto;
        if (t && activo) op.alTexto(t);
      } finally {
        pendientes--;
        if (activo) reposo();
      }
    });
  }

  function empezarFrase() {
    frase = previo;
    fraseMs = previoMs;
    vozMs = sobreMs;
    desdeVozMs = 0;
    previo = [];
    previoMs = 0;
    poner('oyendo');
  }

  function terminarFrase(tirar: boolean) {
    const trozos = frase;
    frase = null;
    if (!trozos) return;
    if (!tirar && vozMs >= MIN_VOZ_MS) {
      // El silencio del final no se sube (menos bytes, menos espera), salvo una colita.
      let sobra = Math.max(0, ((desdeVozMs - COLA_SILENCIO_MS) * tasa) / 1000);
      while (sobra > 0 && trozos.length > 1 && trozos[trozos.length - 1].length <= sobra) sobra -= trozos.pop()!.length;
      mandar(trozos);
    }
    reposo();
  }

  function guardarPrevio(t: Float32Array, ms: number) {
    previo.push(t);
    previoMs += ms;
    while (previo.length > 1 && previoMs - (previo[0].length / tasa) * 1000 >= PREVIO_MS) {
      previoMs -= (previo.shift()!.length / tasa) * 1000;
    }
  }

  /** Cada ~40 ms de audio: decide si alguien empezó a hablar, sigue o terminó. */
  function oir(t: Float32Array) {
    if (!activo) return;
    const ms = (t.length / tasa) * 1000;
    const rms = rmsDe(t);
    nivelActual = rms;

    // Suena la mesa: nada de grabar (y se tira lo que se estuviera grabando), salvo que le hablen encima.
    if (op.hablandoAhora()) {
      /*
       * La persona YA estaba hablando cuando arrancó una voz de la mesa (la respuesta llegó en
       * mitad de su frase): tiene prioridad, como en una conversación. La voz se calla y su frase
       * se sigue grabando; antes se tiraba entera.
       */
      if (frase && vozMs >= 250 && op.alInterrumpir) {
        op.alInterrumpir();
        frase.push(t);
        fraseMs += ms;
        return;
      }
      ecoMs = COLA_ECO_MS;
      if (frase) terminarFrase(true);
      sobreMs = 0;
      encimaMs = op.alInterrumpir && rms > Math.max(RMS_INTERRUMPIR, ruido * 10) ? encimaMs + ms : 0;
      guardarPrevio(t, ms);
      if (encimaMs >= INTERRUMPIR_MS) {
        encimaMs = 0;
        ecoMs = 0;
        op.alInterrumpir!();
        sobreMs = INTERRUMPIR_MS;
        empezarFrase();
      }
      return;
    }
    encimaMs = 0;
    if (ecoMs > 0) {
      // La cola del eco no entra ni en el «previo».
      ecoMs -= ms;
      previo = [];
      previoMs = 0;
      return;
    }

    const umbral = Math.max(0.012, ruido * 3.2);
    if (!frase) {
      // Aprender el ruido del lugar mientras nadie habla.
      if (rms < umbral) ruido = ruido * 0.97 + rms * 0.03;
      sobreMs = rms > umbral ? sobreMs + ms : 0;
      guardarPrevio(t, ms);
      if (sobreMs >= ARRANQUE_MS) empezarFrase();
      return;
    }
    frase.push(t);
    fraseMs += ms;
    if (rms > umbral * 0.8) {
      desdeVozMs = 0;
      vozMs += ms;
    } else desdeVozMs += ms;
    if (desdeVozMs > SILENCIO_FIN_MS || fraseMs > MAX_FRASE_MS) terminarFrase(false);
  }

  async function conectar(c: AudioContext, fuente: MediaStreamAudioSourceNode): Promise<AudioNode> {
    // Sin salida audible, pero conectado: si no llega al destino, el navegador no lo procesa.
    const mudo = c.createGain();
    mudo.gain.value = 0;
    mudo.connect(c.destination);
    if (c.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      try {
        const url = URL.createObjectURL(new Blob([OREJA], { type: 'application/javascript' }));
        await c.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        const w = new AudioWorkletNode(c, 'oreja-electrum', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
        w.port.onmessage = (e) => oir(e.data as Float32Array);
        fuente.connect(w);
        w.connect(mudo);
        return w;
      } catch {
        /* sin worklet (navegador viejo o política): el procesador clásico */
      }
    }
    const sp = c.createScriptProcessor(2048, 1, 1);
    sp.onaudioprocess = (e) => oir(new Float32Array(e.inputBuffer.getChannelData(0)));
    fuente.connect(sp);
    sp.connect(mudo);
    return sp;
  }

  function soltar() {
    activo = false;
    frase = null;
    previo = [];
    previoMs = 0;
    try {
      nodo?.disconnect();
    } catch {
      /* ya estaba suelto */
    }
    nodo = null;
    stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    stream = null;
    void ctx?.close().catch(() => {});
    ctx = null;
  }

  function iniciar(): Promise<boolean> {
    querido = true;
    if (stream) return Promise.resolve(true);
    if (!abriendo) abriendo = abrir().finally(() => (abriendo = null));
    return abriendo;
  }

  async function abrir(): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) {
      poner('sin-soporte');
      return false;
    }
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) {
      poner('sin-soporte');
      return false;
    }
    poner('pidiendo');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch {
      poner('sin-permiso');
      return false;
    }
    // La apagaron mientras el navegador preguntaba.
    if (!querido) {
      soltar();
      poner('apagado');
      return false;
    }
    try {
      ctx = new AC() as AudioContext;
      tasa = ctx.sampleRate;
      const fuente = ctx.createMediaStreamSource(stream);
      activo = true;
      nodo = await conectar(ctx, fuente);
      void ctx.resume().catch(() => {});
    } catch {
      soltar();
      poner('sin-soporte');
      return false;
    }
    // Se desconectó el micrófono (audífonos, Bluetooth): se vuelve a abrir solo.
    const propio = stream;
    stream.getAudioTracks().forEach((t) => {
      t.onended = () => {
        if (stream !== propio) return;
        soltar();
        poner('pidiendo');
        window.setTimeout(() => {
          if (querido) void iniciar();
        }, 700);
      };
    });
    poner('escuchando');
    return true;
  }

  return {
    /** Pide el micrófono (el navegador pregunta la primera vez) y empieza a escuchar. */
    iniciar,
    /** Un toque de la persona: el navegador deja arrancar el audio que estaba en pausa. */
    reanudar() {
      if (ctx?.state === 'suspended') void ctx.resume().catch(() => {});
    },
    detener() {
      querido = false;
      soltar();
      poner('apagado');
    },
    /** 0..1 aproximado, para el medidor del botón. */
    nivel: () => Math.min(1, nivelActual * 12),
    estado: () => estado,
  };
}

/* ---------------------------------------------------------------- a dónde va lo dicho */

type Captura = (texto: string) => boolean | void;
let captura: Captura | null = null;

/**
 * Mientras alguien tiene la palabra (el cierre del recorrido preguntando «¿alguna pregunta?»), lo
 * que se diga le llega a él primero. Devuelve cómo soltarla.
 */
export function capturarDicho(fn: Captura): () => void {
  captura = fn;
  return () => {
    if (captura === fn) captura = null;
  };
}

/** La captura activa, si la hay (el enrutador de la app la consulta antes de preguntarle al cerebro). */
export function capturaActiva(): Captura | null {
  return captura;
}
