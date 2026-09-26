/**
 * CORTACIRCUITOS — si un servicio de la T4 no contesta, no se le vuelve a esperar en cada turno.
 *
 * Medido antes de esto: con la T4 aceptando conexiones pero sin contestar, cada turno pagaba
 * ~0.8 s de Laya + 8 s de embeddings + 12 s del modelo chico. Casi 21 s de espera para acabar
 * haciendo lo de siempre. Ahora, tras un fallo de red o un 5xx, ese servicio se salta durante
 * `INTERRUPTOR_MS` (60 s) y el turno sigue por el camino de siempre al instante. Pasado el plazo se
 * prueba una vez; si contesta, se cierra el circuito.
 *
 * Un 4xx NO abre el circuito: es un problema de ESA petición (texto raro, argumento mal), no del
 * servicio.
 */
export type Servicio = 'laya' | 'embeddings' | 'modelo_chico' | 'docling';

const abiertoHasta = new Map<Servicio, number>();

function plazo() {
  return Number(process.env.INTERRUPTOR_MS || 60_000);
}

export function disponible(s: Servicio): boolean {
  const t = abiertoHasta.get(s);
  return !t || Date.now() >= t;
}

export function anotarFallo(s: Servicio) {
  abiertoHasta.set(s, Date.now() + plazo());
}

export function anotarExito(s: Servicio) {
  abiertoHasta.delete(s);
}

/** Estado para la pestaña Control: qué servicios se están saltando y hasta cuándo. */
export function circuitosAbiertos(): Array<{ servicio: Servicio; hasta: string }> {
  const ahora = Date.now();
  return [...abiertoHasta.entries()].filter(([, t]) => t > ahora).map(([servicio, t]) => ({ servicio, hasta: new Date(t).toISOString() }));
}

export function resetInterruptoresTest() {
  abiertoHasta.clear();
}
