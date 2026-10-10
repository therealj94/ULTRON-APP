/**
 * «ABRE ESTE OBJETIVO» DESDE AFUERA DE LA MESA (Fase 2): el aviso «Necesito tu decisión» tocado pide la hoja del objetivo
 * antes de que la mesa esté montada (la intro tarda). Como trabajos/abrirPanel.ts: el pedido queda guardado hasta que la
 * mesa lo toma (`tomarPedidoObjetivo` al montarse) o, si ya está, le llega al instante (`escucharPedidoObjetivo`).
 * Sin dependencias de Expo: es solo un recado entre piezas.
 */
let pedido: string | null = null;
const oyentes = new Set<(id: string) => void>();

/** Pide la hoja de ESE objetivo (una vez). */
export function pedirObjetivo(id: string): void {
  if (!/^ob_[a-z0-9]{8,40}$/.test(String(id || ''))) return;
  pedido = id;
  for (const f of [...oyentes]) {
    try {
      f(id);
    } catch {
      /* un oyente roto no tumba a los demás */
    }
  }
}

/** ¿Había un pedido? Lo consume (la hoja se abre una sola vez por pedido). */
export function tomarPedidoObjetivo(): string | null {
  const p = pedido;
  pedido = null;
  return p;
}

/** Escucha los pedidos nuevos; devuelve cómo dejar de escuchar. */
export function escucharPedidoObjetivo(f: (id: string) => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}
