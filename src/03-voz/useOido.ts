/**
 * Oído continuo con barge-in. Primero el oído Turbo (oidoTurbo.ts: Scribe v2 Realtime Turbo en vivo,
 * desde el 2-oct); si el micrófono crudo no abre en este navegador, el reconocimiento del navegador de
 * antes (speech.ts). Cuando el jefe empieza a hablar, corta la voz de AU-RA (fade) y avisa.
 *
 * Como ChatGPT con voz (José, 3-oct): mientras AU-RA habla, su propio eco y los «ajá», «sí», «ok» de
 * quien escucha no la cortan ni se mandan como pedido; un «espera», «oye» o dos palabras suyas sí
 * (mobile/src/lib/interrupcion.ts, lo mismo que el teléfono).
 */
import { useEffect, useRef } from 'react';
import { crearOidoTurboWeb, turboWebPosible } from './oidoTurbo';
import { initSpeechRecognizer, type SpeechRecognizerHandle } from './speech';
import { esInterrupcionReal, quitarEco, soloEcoOMuletilla } from '../../mobile/src/lib/interrupcion';

/** ¿Lo que entendió Turbo cuenta como «le están hablando encima»? (sin saber qué dice AU-RA). */
export function esInterrupcion(parcial: string, dichos: readonly string[] = []): boolean {
  return esInterrupcionReal(parcial, dichos);
}

export function useOido(opts: {
  activo: boolean;
  onFinal: (texto: string) => void;
  onParcial: (texto: string) => void;
  onBargeIn: () => void;
  onSinPermiso: () => void;
  onNoSoportado: () => void;
  /** Lo que AU-RA dice ahora (y lo de hace un momento): para no tomar su eco por la persona. */
  dichos?: () => string[];
  /** ¿Está sonando la voz de AU-RA? */
  hablando?: () => boolean;
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

    // Turbo: una interrupción por frase. Con AU-RA hablando, lo que es su eco o un «ajá» no se enseña,
    // no la corta y no se manda; lo que la corta se limpia del eco con que pudo empezar.
    let interrumpio = false;
    let ecoAlCortar: string[] | null = null;
    const dichos = () => cb.current.dichos?.() || [];
    const hablando = () => !!cb.current.hablando?.();
    const motor = crearOidoTurboWeb({
      onSpeechStart: () => {
        interrumpio = false;
        ecoAlCortar = null;
      },
      onPartial: (t) => {
        if (!t) return;
        if (!interrumpio && hablando()) {
          const d = dichos();
          if (!esInterrupcionReal(t, d)) return;
          interrumpio = true;
          ecoAlCortar = d;
          cb.current.onBargeIn();
        }
        cb.current.onParcial(ecoAlCortar ? quitarEco(t, ecoAlCortar) : t);
      },
      onFinal: (t) => {
        const eco = ecoAlCortar;
        const corto = interrumpio;
        interrumpio = false;
        ecoAlCortar = null;
        let texto = t.trim();
        if (!corto && hablando()) {
          // Con su voz sonando y sin haberla cortado: su eco o un «ajá» no son un pedido. Si la frase
          // entera sí alcanza para cortarla (los parciales no alcanzaron), se corta ahora.
          const d = dichos();
          if (soloEcoOMuletilla(texto, d) || !esInterrupcionReal(texto, d)) return;
          cb.current.onBargeIn();
          texto = quitarEco(texto, d);
        } else if (eco) texto = quitarEco(texto, eco);
        if (texto) cb.current.onFinal(texto);
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
