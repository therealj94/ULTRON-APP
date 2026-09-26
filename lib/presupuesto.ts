/**
 * EL PRESUPUESTO DE TIEMPO DE UNA PETICIÓN.
 *
 * Cada proveedor tenía su propio reloj y nadie miraba el total. El oído llegó a probar cuatro
 * proveedores de 12 a 20 s cada uno: más de un minuto, cuando el teléfono corta a los 16 s. Todo
 * lo que pasaba después de ese corte era gasto puro — llamadas cuya respuesta ya no esperaba
 * nadie, y que encima ocupaban el cupo del siguiente audio.
 *
 * Esto es un reloj por petición: se arma con lo que el cliente está dispuesto a esperar y cada
 * proveedor pide su señal de corte acá, así que ninguno puede pasarse de lo que queda. Cuando lo
 * que queda ya no alcanza para una llamada útil, la cadena se corta y se contesta con honestidad.
 */

export type Presupuesto = {
  /** Milisegundos que quedan (nunca negativo). */
  queda(): number;
  /** ¿Alcanza para intentar algo que necesita al menos `minimoMs`? */
  alcanza(minimoMs?: number): boolean;
  /** Señal de corte para una llamada: su propio tope o lo que quede, lo que llegue antes. */
  senal(topeMs?: number): AbortSignal;
  /** El tope de esa llamada en ms, con la misma regla que `senal` (para registrarlo o pasarlo). */
  tope(topeMs?: number): number;
};

/** Por debajo de esto no se empieza una llamada: no le da tiempo a contestar y se paga igual. */
export const MINIMO_UTIL_MS = 1500;

/**
 * Lo que espera cada cliente, sacado de mobile/src/lib/api.ts (`transcribe` corta a 16 s,
 * `describeImage` a 35 s). Se deja un margen para la subida del audio o la foto y la vuelta de la
 * respuesta: si el servidor contesta justo en el segundo 16, el teléfono ya no la ve.
 */
export const PRESUPUESTO_OIDO_MS = 15_000;
export const PRESUPUESTO_VISION_MS = 33_000;

/** Reloj inyectable: las pruebas no pueden esperar quince segundos de verdad. */
export function presupuesto(ms: number, reloj: () => number = Date.now): Presupuesto {
  const fin = reloj() + Math.max(0, Number(ms) || 0);
  const queda = () => Math.max(0, fin - reloj());
  const tope = (topeMs?: number) => Math.min(queda(), topeMs && topeMs > 0 ? topeMs : Infinity);
  return {
    queda,
    alcanza: (minimoMs = MINIMO_UTIL_MS) => queda() >= minimoMs,
    tope,
    senal: (topeMs?: number) => {
      const ms = tope(topeMs);
      // Sin tiempo, la señal nace cortada: la llamada ni sale.
      if (ms <= 0) return AbortSignal.abort(new DOMException('Se acabó el tiempo de la petición.', 'TimeoutError'));
      return AbortSignal.timeout(ms);
    },
  };
}
