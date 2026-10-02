/**
 * LA VOZ DEL RECORRIDO: cada anfitrión con la suya de ElevenLabs. La página no sale a la red: le pide
 * el audio a AURA (C#) con `voz.decir` (PUENTE.md), que lo pide a /api/tts del servidor con el avatar
 * (`claudio` o `antonio`) y el idioma, igual que el notch. La frase que sigue se prepara mientras suena
 * la de ahora, para que la conversación no tenga huecos.
 *
 * Sin el .exe (modo muestra) o sin red, `hablar` contesta false y el recorrido sigue en modo lectura
 * (los subtítulos con su tiempo de lectura). El nivel de la voz (0..1) mueve el brillo del que habla.
 */
import { pedir } from '../puente';
import type { Anfitrion } from './guion';

export type Narrador = {
  /** Dice el texto. Resuelve true al terminar de sonar; false si no pudo sonar (sin voz, se lee). */
  hablar(texto: string, quien: Anfitrion, emocion: string, al: { sono?: (duracionMs: number) => void; nivel?: (n: number) => void }): Promise<boolean>;
  preparar(texto: string, quien: Anfitrion, emocion: string): void;
  callar(): void;
  soltar(): void;
};

type Pedido = (texto: string, quien: Anfitrion, emocion: string) => Promise<{ base64: string; mime: string } | null>;

const pedirVoz: Pedido = (texto, quien, emocion) => pedir<{ base64: string; mime: string } | null>('voz.decir', { texto, avatar: quien, emocion }, 30_000);

export function narradorAura(pedido: Pedido = pedirVoz): Narrador {
  const cache = new Map<string, Promise<string | null>>();
  let actual: { audio: HTMLAudioElement; fin: (sono: boolean) => void } | null = null;
  let ctx: AudioContext | null = null;
  let raf = 0;

  const llave = (t: string, q: string, e: string) => `${q}|${e}|${t}`;
  function obtener(texto: string, quien: Anfitrion, emocion: string): Promise<string | null> {
    const k = llave(texto, quien, emocion);
    let p = cache.get(k);
    if (!p) {
      p = pedido(texto, quien, emocion)
        .then((r) => {
          if (!r?.base64) return null;
          const bin = atob(r.base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return URL.createObjectURL(new Blob([bytes], { type: r.mime || 'audio/mpeg' }));
        })
        .catch(() => null);
      // Un fallo no se queda guardado: la próxima vez se vuelve a intentar.
      p.then((u) => { if (!u) cache.delete(k); });
      cache.set(k, p);
    }
    return p;
  }

  function medir(audio: HTMLAudioElement, nivel?: (n: number) => void) {
    if (!nivel) return;
    try {
      ctx ??= new AudioContext();
      // Un contexto suspendido (sin permiso de sonar) dejaría la voz MUDA si se le conecta el audio:
      // en ese caso suena directo, sin medir, y se intenta despertar para la próxima frase.
      if (ctx.state !== 'running') { void ctx.resume().catch(() => {}); return; }
      const fuente = ctx.createMediaElementSource(audio);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      fuente.connect(an);
      an.connect(ctx.destination);
      const datos = new Uint8Array(an.fftSize);
      const paso = () => {
        if (actual?.audio !== audio) return;
        an.getByteTimeDomainData(datos);
        let s = 0;
        for (const d of datos) s += ((d - 128) / 128) ** 2;
        nivel(Math.min(1, Math.sqrt(s / datos.length) * 4));
        raf = requestAnimationFrame(paso);
      };
      raf = requestAnimationFrame(paso);
    } catch {
      /* sin análisis: el brillo late solo, sin seguir la voz */
    }
  }

  return {
    async hablar(texto, quien, emocion, al) {
      this.callar();
      const url = await obtener(texto, quien, emocion);
      if (!url) return false;
      return new Promise<boolean>((resolver) => {
        const audio = new Audio(url);
        let hecho = false;
        const fin = (sono: boolean) => {
          if (hecho) return;
          hecho = true;
          cancelAnimationFrame(raf);
          al.nivel?.(0);
          if (actual?.audio === audio) actual = null;
          resolver(sono);
        };
        actual = { audio, fin };
        audio.addEventListener('playing', () => al.sono?.(Number.isFinite(audio.duration) ? audio.duration * 1000 : 0), { once: true });
        audio.addEventListener('ended', () => fin(true));
        audio.addEventListener('error', () => fin(false));
        medir(audio, al.nivel);
        audio.play().catch(() => fin(false));
      });
    },
    preparar(texto, quien, emocion) {
      void obtener(texto, quien, emocion);
    },
    callar() {
      const a = actual;
      actual = null;
      if (!a) return;
      a.audio.pause();
      // Callado a propósito: la línea no «terminó de sonar» (el motor no avanza por esto).
      a.fin(false);
    },
    soltar() {
      this.callar();
      for (const p of cache.values()) void p.then((u) => u && URL.revokeObjectURL(u));
      cache.clear();
      void ctx?.close().catch(() => {});
      ctx = null;
    },
  };
}
