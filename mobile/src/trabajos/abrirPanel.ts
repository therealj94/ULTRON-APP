/**
 * «ABRE MIS TAREAS» DESDE AFUERA DE LA MESA: un aviso tocado («Terminé de investigar», server/investigar.ts)
 * pide el panel de tareas antes de que la mesa esté montada (la intro tarda). El pedido queda guardado hasta
 * que la mesa lo toma (`tomarPedidoPanel` al montarse) o, si ya está, le llega al instante (`escucharPedidoPanel`).
 * Sin dependencias de Expo: es solo un recado entre piezas.
 */
let pedido = false;
const oyentes = new Set<() => void>();

/** Pide el panel de tareas (una vez). */
export function pedirPanelTrabajos(): void {
  pedido = true;
  for (const f of [...oyentes]) {
    try {
      f();
    } catch {
      /* un oyente roto no tumba a los demás */
    }
  }
}

/** ¿Había un pedido? Lo consume (el panel se abre una sola vez por pedido). */
export function tomarPedidoPanel(): boolean {
  const p = pedido;
  pedido = false;
  return p;
}

/** Escucha los pedidos nuevos; devuelve cómo dejar de escuchar. */
export function escucharPedidoPanel(f: () => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}
