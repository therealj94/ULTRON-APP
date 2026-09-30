/**
 * ¿ESTÁ LISTO EL CEREBRO? Sin gastar una inferencia por cada visita.
 *
 * `/api/nodo/listo` es público: la mesa lo pregunta cada pocos segundos mientras el nodo calienta.
 * Antes cada consulta mandaba un chat al nodo (hasta 45 s): una visita durante un arranque lento
 * acumulaba inferencias, y cualquiera podía gastarlas llamando a la ruta. Ahora:
 *  · UNA comprobación en vuelo por proceso: las consultas que llegan mientras tanto esperan esa;
 *  · el resultado se guarda: «listo» un buen rato (LISTO_TTL_MS), «no listo» poco (NO_LISTO_TTL_MS)
 *    para enterarse pronto de cuando termina de calentar;
 *  · la ruta, además, con limitador por IP (server.ts).
 * Cien consultas en un minuto contra un nodo frío = como mucho las comprobaciones que dicten los
 * plazos, no cien inferencias.
 */

export type EstadoListo = { listo: boolean; ms?: number; motivo?: string };

export const LISTO_TTL_MS = 5 * 60_000;
export const NO_LISTO_TTL_MS = 10_000;

export function crearComprobadorListo(comprobar: () => Promise<EstadoListo>, o: { ahora?: () => number; listoTtlMs?: number; noListoTtlMs?: number } = {}) {
  const ahora = o.ahora ?? Date.now;
  const listoTtl = o.listoTtlMs ?? LISTO_TTL_MS;
  const noListoTtl = o.noListoTtlMs ?? NO_LISTO_TTL_MS;
  let ultimo: { e: EstadoListo; t: number } | null = null;
  let enVuelo: Promise<EstadoListo> | null = null;
  let comprobaciones = 0;

  function estado(): Promise<EstadoListo> {
    const t = ahora();
    if (ultimo && t - ultimo.t < (ultimo.e.listo ? listoTtl : noListoTtl)) return Promise.resolve({ ...ultimo.e, cache: true } as EstadoListo);
    if (enVuelo) return enVuelo;
    comprobaciones++;
    enVuelo = comprobar()
      .catch((e: any): EstadoListo => ({ listo: false, motivo: String(e?.message || e).slice(0, 160) }))
      .then((e) => {
        ultimo = { e, t: ahora() };
        return e;
      })
      .finally(() => {
        enVuelo = null;
      });
    return enVuelo;
  }

  return {
    estado,
    /** Cuántas comprobaciones de verdad se hicieron (las pruebas lo miran). */
    comprobaciones: () => comprobaciones,
    /** Olvida lo guardado (p. ej. si el nodo se reinicia). */
    olvidar: () => {
      ultimo = null;
    },
  };
}
