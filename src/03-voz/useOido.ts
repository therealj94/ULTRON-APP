/**
 * Oído continuo con barge-in. Primero el oído Turbo (oidoTurbo.ts: Scribe v2 Realtime Turbo en vivo,
 * desde el 2-oct); si el micrófono crudo no abre en este navegador, el reconocimiento del navegador de
 * antes (speech.ts). Cuando el jefe empieza a hablar, corta la voz de AU-RA (fade) y avisa.
 */
import { useEffect, useRef } from 'react';
import { crearOidoTurboWeb, turboWebPosible } from './oidoTurbo';
import { initSpeechRecognizer, type SpeechRecognizerHandle } from './speech';

/** Palabras que tiene que haber entendido Turbo para que cuente como «le están hablando encima». */
export function esInterrupcion(parcial: string): boolean {
  return parcial.trim().split(/\s+/).filter((p) => p.replace(/[^\p{L}\p{N}]/gu, '').length > 0).length >= 2;
}

export function useOido(opts: {
  activo: boolean;
  onFinal: (texto: string) => void;
  onParcial: (texto: string) => void;
  onBargeIn: () => void;
  onSinPermiso: () => void;
  onNoSoportado: () => void;
}) {
  const ref = useRef<{ reiniciar: () => void; parar: () => void } | null>(null);
  const cb = useRef(opts);
  cb.current = opts;

  useEffect(() => {
    if (!opts.activo) {
      ref.current?.parar();
      ref.current = null;
      return;
    }
    let vivo = true;

    const conNavegador = () => {
      const rec: SpeechRecognizerHandle | null = initSpeechRecognizer(
        (texto, isFinal) => {
          if (!texto.trim()) return;
          if (isFinal) cb.current.onFinal(texto.trim());
          else cb.current.onParcial(texto);
        },
        () => cb.current.onBargeIn(),
        () => {},
        (err) => {
          const msg = String((err as any)?.error || (err as any)?.message || err);
          if (/not-allowed|mic-denied|denied/i.test(msg)) cb.current.onSinPermiso();
        }
      );
      if (!rec) {
        cb.current.onNoSoportado();
        return;
      }
      ref.current = { reiniciar: () => rec.start(), parar: () => rec.stop() };
      rec.start();
    };

    if (!turboWebPosible()) {
      conNavegador();
      return () => {
        vivo = false;
        ref.current?.parar();
        ref.current = null;
      };
    }

    // Turbo: una interrupción por frase (la primera vez que entiende dos palabras mientras se habla).
    let interrumpio = false;
    const motor = crearOidoTurboWeb({
      onSpeechStart: () => {
        interrumpio = false;
      },
      onPartial: (t) => {
        if (!t) return;
        cb.current.onParcial(t);
        if (!interrumpio && esInterrupcion(t)) {
          interrumpio = true;
          cb.current.onBargeIn();
        }
      },
      onFinal: (t) => {
        interrumpio = false;
        if (t.trim()) cb.current.onFinal(t.trim());
      },
      alSinPermiso: () => cb.current.onSinPermiso(),
      // El micrófono crudo no abre en este navegador: el reconocimiento del navegador de siempre.
      onUnavailable: () => {
        if (!vivo) return;
        motor.destruir();
        conNavegador();
      },
    });
    ref.current = { reiniciar: () => motor.reiniciar(), parar: () => motor.destruir() };
    motor.activar();
    return () => {
      vivo = false;
      ref.current?.parar();
      ref.current = null;
    };
  }, [opts.activo]);

  return {
    reiniciar: () => ref.current?.reiniciar(),
  };
}
