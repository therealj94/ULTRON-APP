/**
 * EL OÍDO SIEMPRE ABIERTO de Dr Electrum en la web.
 *
 * El micrófono queda escuchando: cuando alguien habla, se graba SOLO esa frase (desde que empieza
 * hasta que hay ~0,9 s de silencio), se pasa a texto en el servidor (ElevenLabs Scribe, Whisper de
 * respaldo) y se entrega a `enrutarDicho`: un comando («acércate», «siguiente») se ejecuta en el
 * acto; lo demás es una pregunta para Dr Electrum.
 *
 * Tres cuidados para que no sea un micrófono torpe:
 *  · No se escucha a sí mismo: mientras Dr Electrum habla (y medio segundo después) no graba.
 *    Además va con cancelación de eco del navegador.
 *  · El umbral se adapta al ruido del lugar: una oficina no es un cerro con viento.
 *  · Una frase de menos de medio segundo (un golpe, una tos) no se manda.
 *
 * El modo «tocar para hablar» apaga esto y deja el botón de dictado de siempre.
 */
import { headersElectrum } from '../acceso';

export type EstadoOido = 'apagado' | 'pidiendo' | 'escuchando' | 'oyendo' | 'pasando' | 'sin-permiso' | 'sin-soporte';

type Opciones = {
  /** Se llama con cada frase oída, ya en texto. */
  alTexto: (texto: string) => void;
  alEstado: (e: EstadoOido) => void;
  /** ¿Está hablando Dr Electrum ahora? Mientras sí, no se graba (salvo que lo interrumpan). */
  hablandoAhora: () => boolean;
  /**
   * Alguien le habla ENCIMA, fuerte y sostenido: como en una conversación de verdad, el doctor se
   * calla y escucha. Quien llama corta la voz; el oído empieza a grabar en el acto.
   */
  alInterrumpir?: () => void;
};

const TICK_MS = 50;
const SILENCIO_FIN_MS = 900;
const MIN_VOZ_MS = 450;
const MAX_FRASE_MS = 15_000;
const COLA_ECO_MS = 400;
/** Interrumpir exige voz fuerte (el eco del parlante, tras la cancelación, queda muy por debajo)… */
const RMS_INTERRUMPIR = 0.08;
/** …y sostenida: ~400 ms. Un golpe o una tos no cortan al doctor. */
const TICKS_INTERRUMPIR = 8;

export function crearOido(op: Opciones) {
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let analizador: AnalyserNode | null = null;
  let reloj: number | undefined;
  let rec: MediaRecorder | null = null;
  let trozos: BlobPart[] = [];
  let descartar = false;
  let inicioFrase = 0;
  let ultimaVoz = 0;
  let vozAcumulada = 0;
  let sobreUmbral = 0;
  let ruido = 0.008;
  let ignorarHasta = 0;
  let nivelActual = 0;
  let encima = 0;
  let estado: EstadoOido = 'apagado';
  const poner = (e: EstadoOido) => {
    if (e !== estado) {
      estado = e;
      op.alEstado(e);
    }
  };

  const mime = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) || '';

  async function mandar(blob: Blob) {
    poner('pasando');
    try {
      const base64 = await new Promise<string>((res) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.readAsDataURL(blob);
      });
      const r = await fetch('/api/electrum/oir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersElectrum() },
        body: JSON.stringify({ audio: base64, mime: blob.type }),
      });
      const j = await r.json().catch(() => ({}) as any);
      const texto = String(j?.texto || '').trim();
      if (texto) op.alTexto(texto);
    } catch {
      /* sin red: esa frase se pierde, el oído sigue */
    } finally {
      if (stream) poner('escuchando');
    }
  }

  function empezarFrase() {
    if (!stream) return;
    const m = mime();
    try {
      rec = new MediaRecorder(stream, m ? { mimeType: m } : undefined);
    } catch {
      rec = null;
      return;
    }
    trozos = [];
    descartar = false;
    inicioFrase = Date.now();
    ultimaVoz = inicioFrase;
    vozAcumulada = 0;
    const este = rec;
    este.ondataavailable = (e) => e.data.size && trozos.push(e.data);
    este.onstop = () => {
      const blob = new Blob(trozos, { type: este.mimeType || m || 'audio/webm' });
      const valida = !descartar && vozAcumulada >= MIN_VOZ_MS && blob.size > 800;
      rec = null;
      trozos = [];
      if (valida) void mandar(blob);
      else if (stream) poner('escuchando');
    };
    este.start(250);
    poner('oyendo');
  }

  function terminarFrase(tirar: boolean) {
    if (!rec) return;
    descartar = tirar;
    try {
      if (rec.state !== 'inactive') rec.stop();
    } catch {
      rec = null;
    }
  }

  function tick() {
    if (!analizador) return;
    const datos = new Float32Array(analizador.fftSize);
    analizador.getFloatTimeDomainData(datos);
    let suma = 0;
    for (let k = 0; k < datos.length; k++) suma += datos[k] * datos[k];
    const rms = Math.sqrt(suma / datos.length);
    nivelActual = rms;
    const ahora = Date.now();

    // Dr Electrum hablando: nada de grabar (y se tira lo que se estuviera grabando).
    if (op.hablandoAhora()) {
      ignorarHasta = ahora + COLA_ECO_MS;
      if (rec) terminarFrase(true);
      sobreUmbral = 0;
      encima = op.alInterrumpir && rms > Math.max(RMS_INTERRUMPIR, ruido * 10) ? encima + 1 : 0;
      if (encima >= TICKS_INTERRUMPIR) {
        encima = 0;
        ignorarHasta = 0;
        op.alInterrumpir!();
        empezarFrase();
      }
      return;
    }
    encima = 0;
    if (ahora < ignorarHasta) return;

    const umbral = Math.max(0.012, ruido * 3.2);
    if (!rec) {
      // Aprender el ruido del lugar mientras no se habla.
      if (rms < umbral) ruido = ruido * 0.97 + rms * 0.03;
      sobreUmbral = rms > umbral ? sobreUmbral + 1 : 0;
      if (sobreUmbral >= 2 && estado !== 'pasando') empezarFrase();
      return;
    }
    if (rms > umbral * 0.8) {
      ultimaVoz = ahora;
      vozAcumulada += TICK_MS;
    }
    if (ahora - ultimaVoz > SILENCIO_FIN_MS || ahora - inicioFrase > MAX_FRASE_MS) terminarFrase(false);
  }

  return {
    /** Pide el micrófono (el navegador pregunta la primera vez) y empieza a escuchar. */
    async iniciar(): Promise<boolean> {
      if (stream) return true;
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
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
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) {
        poner('sin-soporte');
        return false;
      }
      ctx = new AC() as AudioContext;
      const fuente = ctx.createMediaStreamSource(stream);
      analizador = ctx.createAnalyser();
      analizador.fftSize = 1024;
      fuente.connect(analizador);
      void ctx.resume().catch(() => {});
      reloj = window.setInterval(tick, TICK_MS);
      poner('escuchando');
      return true;
    },
    /** Un toque de la persona: el navegador deja arrancar el audio que estaba en pausa. */
    reanudar() {
      if (ctx?.state === 'suspended') void ctx.resume().catch(() => {});
    },
    detener() {
      if (reloj) clearInterval(reloj);
      reloj = undefined;
      terminarFrase(true);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      void ctx?.close().catch(() => {});
      ctx = null;
      analizador = null;
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
