/**
 * ¿Puede este aparato pintar la sala? Vive aparte de sala.ts a propósito: App.tsx lo pregunta al
 * arrancar, y si lo importara de sala.ts arrastraría three.js (medio mega) al paquete inicial.
 */
export function hayWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
