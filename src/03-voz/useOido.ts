/**
 * Oído continuo con barge-in. Envuelve initSpeechRecognizer en un hook estable.
 * Cuando el jefe empieza a hablar, corta la voz de AU-RA (fade) y avisa.
 */
import { useEffect, useRef } from 'react';
import { initSpeechRecognizer, type SpeechRecognizerHandle } from './speech';

export function useOido(opts: {
  activo: boolean;
  onFinal: (texto: string) => void;
  onParcial: (texto: string) => void;
  onBargeIn: () => void;
  onSinPermiso: () => void;
  onNoSoportado: () => void;
}) {
  const ref = useRef<SpeechRecognizerHandle | null>(null);
  const cb = useRef(opts);
  cb.current = opts;

  useEffect(() => {
    if (!opts.activo) {
      ref.current?.stop();
      ref.current = null;
      return;
    }
    const rec = initSpeechRecognizer(
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
    ref.current = rec;
    rec.start();
    return () => {
      rec.stop();
      if (ref.current === rec) ref.current = null;
    };
  }, [opts.activo]);

  return {
    reiniciar: () => ref.current?.start(),
  };
}
