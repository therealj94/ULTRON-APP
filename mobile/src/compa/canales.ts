/**
 * Canales pequeños entre la voz, la mesa y la compañera, sin pasar por React.
 *
 * Lo que cambia muchas veces por segundo (el volumen de la voz de la persona) o lo que la mesa quiere
 * contarle a la compañera («estoy hablando contenta», «estoy pensando») no debe re-renderizar nada:
 * quien escucha mueve un valor de Reanimated o anota en una ref.
 *
 * Sin React Native: las pruebas lo usan en Node.
 */
import type { Emocion } from '../lib/emocion';

export type Canal<T> = {
  emitir: (v: T) => void;
  escuchar: (f: (v: T) => void) => () => void;
  ultimo: () => T;
};

export function canal<T>(inicial: T): Canal<T> {
  let ultimo = inicial;
  const oyentes = new Set<(v: T) => void>();
  return {
    emitir(v) {
      ultimo = v;
      for (const f of [...oyentes]) {
        try {
          f(v);
        } catch {
          /* un oyente roto no rompe el canal */
        }
      }
    },
    escuchar(f) {
      oyentes.add(f);
      return () => {
        oyentes.delete(f);
      };
    },
    ultimo: () => ultimo,
  };
}

/**
 * Volumen de la voz de la PERSONA (0..1, ~20 Hz): el anillo que late al oír. Lo emite quien tenga el
 * micrófono: la conversación fluida o, con la mesa tapada, el oído del teléfono que atiende la compañera.
 */
export const nivelOido = canal(0);

/**
 * ¿El oído del teléfono está escuchando DE VERDAD para AURA fuera de la conversación en vivo? (un
 * reconocedor vivo, no solo pedido). La compañera pone cara de escuchar y dice «te escucho» solo así.
 */
export const oidoTelefono = canal(false);


/** Lo que hace la mesa con su propia voz (fuera de la conversación fluida), para que la compañera lo refleje. */
export type EcoMesa = {
  /** Suena la voz de la mesa. */
  hablando: boolean;
  /** Esperando al cerebro. */
  pensando: boolean;
  emocion: Emocion;
  /** Lo último que dijo (para leer, sin expresiones). */
  texto: string;
  /** Cuándo cambió, para ordenar con los mensajes de la conversación. */
  en: number;
};

export const ecoMesa = canal<EcoMesa>({ hablando: false, pensando: false, emocion: 'neutral', texto: '', en: 0 });

/** La mesa avisa solo lo que cambió. */
export function avisarMesa(cambio: Partial<Omit<EcoMesa, 'en'>>) {
  ecoMesa.emitir({ ...ecoMesa.ultimo(), ...cambio, en: Date.now() });
}

/** Una frase terminada de la conversación fluida: la tuya o la de AURA (con la emoción que se le nota). */
export type MensajeVoz = { rol: 'usuario' | 'ultron'; texto: string; emocion: Emocion; en: number };
export const mensajeVoz = canal<MensajeVoz | null>(null);

/** Le hablaron encima mientras hablaba: se calló (el número cambia con cada interrupción). */
export const interrupcionVoz = canal(0);

/**
 * Lo que la compañera no debe tapar abajo, en px (la barra de escribir de la pantalla visible, los
 * botones de la mesa). Cada pantalla lo fija; el teclado se suma aparte.
 */
export const sueloCompa = canal(88);
