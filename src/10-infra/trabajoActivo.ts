/**
 * LO QUE NO SE PUEDE CORTAR CON UNA RECARGA (AUR14; documento maestro, sección 16): la web no aplica una
 * versión nueva en medio de una llamada en vivo, del control de su computadora o de una decisión que la
 * persona está tomando. Cada parte registra aquí cuándo está ocupada; la PWA (10-infra/pwa.ts) pregunta
 * antes de recargar y, si hay algo, espera a que termine (el mismo patrón que la app: lib/barreraOta.ts).
 *
 * Puro (sin DOM): la conversación en vivo (03-voz/enVivo.ts) y la de trabajo (13-trabajo/conversacion.ts)
 * se registran solas; App.tsx no tiene que hacer nada.
 */
const activos = new Map<string, () => boolean>();
const oyentes = new Set<() => void>();

/** Registra una parte que puede estar ocupada. Devuelve cómo quitarla. */
export function registrarTrabajoActivo(nombre: string, ocupado: () => boolean): () => void {
  activos.set(nombre, ocupado);
  return () => {
    if (activos.get(nombre) === ocupado) activos.delete(nombre);
    avisarTrabajoLibre();
  };
}

/** Lo que está ocupado ahora (sus nombres). Una parte que falla al responder cuenta como ocupada: ante la duda, no se recarga. */
export function trabajoActivo(): string[] {
  const out: string[] = [];
  for (const [nombre, ocupado] of activos) {
    try {
      if (ocupado()) out.push(nombre);
    } catch {
      out.push(nombre);
    }
  }
  return out;
}

/** Una parte terminó (colgó, decidió, soltó el control): quien esperaba vuelve a mirar. */
export function avisarTrabajoLibre() {
  for (const f of [...oyentes]) {
    try {
      f();
    } catch {
      /* el que escucha se arregla solo */
    }
  }
}

/** Escuchar cuándo algo termina. Devuelve cómo dejar de escuchar. */
export function alTerminarTrabajo(f: () => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

/** Solo pruebas. */
export function _olvidarTrabajos() {
  activos.clear();
  oyentes.clear();
}
