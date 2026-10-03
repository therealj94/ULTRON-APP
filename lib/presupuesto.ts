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
  /**
   * La señal de `senal(topeMs)` sumada a otra (la persona que se fue o interrumpió): se corta con la que
   * llegue primero. Así cada llamada de un turno respeta el mismo reloj, además del suyo.
   */
  senalCon(otra: AbortSignal | undefined, topeMs?: number): AbortSignal;
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
/**
 * Un turno de AU-RA entero (auditoría 3-oct, EXEC04): el teléfono corta el turno a los 70 s. Antes cada
 * pieza tenía su tope (Bedrock, cada llamada a Qwen de 60 s, la herramienta, la vuelta) y nadie miraba el
 * total: con dos vueltas el turno podía seguir minutos para nadie y empezar efectos que ya nadie esperaba.
 */
export const PRESUPUESTO_TURNO_MS = 68_000;

/** Reloj inyectable: las pruebas no pueden esperar quince segundos de verdad. */
export function presupuesto(ms: number, reloj: () => number = Date.now): Presupuesto {
  const fin = reloj() + Math.max(0, Number(ms) || 0);
  const queda = () => Math.max(0, fin - reloj());
  const tope = (topeMs?: number) => Math.min(queda(), topeMs && topeMs > 0 ? topeMs : Infinity);
  const senal = (topeMs?: number) => {
    const ms = tope(topeMs);
    // Sin tiempo, la señal nace cortada: la llamada ni sale.
    if (ms <= 0) return AbortSignal.abort(new DOMException('Se acabó el tiempo de la petición.', 'TimeoutError'));
    return AbortSignal.timeout(ms);
  };
  return {
    queda,
    alcanza: (minimoMs = MINIMO_UTIL_MS) => queda() >= minimoMs,
    tope,
    senal,
    senalCon: (otra, topeMs) => (otra ? AbortSignal.any([otra, senal(topeMs)]) : senal(topeMs)),
  };
}
