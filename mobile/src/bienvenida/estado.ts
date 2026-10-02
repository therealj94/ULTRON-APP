/**
 * LA VENTANA DE BIENVENIDA, como dato: qué está abierto (la oferta del recorrido o las preguntas para
 * conocerle) y quién la pidió. La dibuja la mesa (VentanaBienvenida.tsx); cualquiera la puede abrir:
 *
 *   abrirBienvenida('primera')  la mesa, la primera vez (tutorial/pasos.ts tocaOfrecerRecorrido)
 *   abrirBienvenida('menu')     Más → «Qué puedo hacer»; también sirve para una fila de Ajustes
 *                               («Repetir recorrido» / «Volver a presentarme»)
 *   abrirPreguntas()            directo a las preguntas que quedaron sin contestar
 *
 * Sin React Native: un dato de módulo con oyentes (useSyncExternalStore en la vista), como app/hojas.ts.
 */
export type VentanaBienvenida = 'oferta' | 'preguntas';
export type MotivoBienvenida = 'primera' | 'menu';
export type EstadoBienvenida = { abierta: VentanaBienvenida | null; motivo: MotivoBienvenida };

let estado: EstadoBienvenida = { abierta: null, motivo: 'menu' };
const oyentes = new Set<() => void>();

function fijar(e: EstadoBienvenida) {
  estado = e;
  for (const f of [...oyentes]) {
    try {
      f();
    } catch {
      /* un oyente roto no rompe nada */
    }
  }
}

/** La oferta: «Empezar» el recorrido, «Contarte de mí» o «Después». */
export function abrirBienvenida(motivo: MotivoBienvenida = 'menu') {
  fijar({ abierta: 'oferta', motivo });
}

/** Las preguntas para conocerle (las que faltan; si no falta ninguna, todas para revisarlas). */
export function abrirPreguntas() {
  fijar({ ...estado, abierta: 'preguntas' });
}

export function cerrarBienvenida() {
  if (estado.abierta) fijar({ ...estado, abierta: null });
}

export function bienvenidaAhora(): EstadoBienvenida {
  return estado;
}

export function suscribirBienvenida(f: () => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}
