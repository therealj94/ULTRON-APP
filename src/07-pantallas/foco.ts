/**
 * El foco de los diálogos de AU-RA, sin React: qué se puede enfocar, adónde salta Tab en el borde y
 * a quién se le devuelve el foco al cerrar.
 *
 * Antes, Ajustes y Escribir se escondían con transform y `pointer-events-none`: fuera de la vista,
 * pero Tab los seguía visitando y el lector de pantalla recitaba todo el catálogo con el panel
 * cerrado. Ahora un panel cerrado no está en el DOM (Dialogo.tsx), y uno abierto se queda con el
 * foco hasta que se cierra. La lógica vive aquí para probarla sin navegador (tests/aura-web-paneles).
 */

export const SELECTOR_ENFOCABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export type Enfocable = { focus: (o?: { preventScroll?: boolean }) => void };

/** Los enfocables visibles de un contenedor, en orden de documento. */
export function enfocables(contenedor: ParentNode): HTMLElement[] {
  const todos = Array.from(contenedor.querySelectorAll<HTMLElement>(SELECTOR_ENFOCABLE));
  return todos.filter((el) => !el.closest('[inert]') && (el.getClientRects?.().length ?? 1) > 0);
}

/**
 * Tab dentro de un diálogo modal: desde el último vuelve al primero y, con Mayúsculas, desde el
 * primero va al último. Devuelve a quién enfocar, o null si el navegador puede seguir solo.
 */
export function saltoDeTab<T>(lista: readonly T[], activo: T | null, atras: boolean): T | null {
  if (!lista.length) return null;
  const i = activo === null ? -1 : lista.indexOf(activo);
  if (i === -1) return atras ? lista[lista.length - 1] : lista[0];
  if (atras && i === 0) return lista[lista.length - 1];
  if (!atras && i === lista.length - 1) return lista[0];
  return null;
}

/**
 * Recuerda quién tenía el foco al abrir y se lo devuelve al cerrar. Si el disparador ya no está (se
 * desmontó) o no acepta el foco, no se fuerza nada: el navegador lo deja en el cuerpo.
 */
export function recordarDisparador(activo: Enfocable | null) {
  return {
    disparador: activo,
    devolver(estaEnElDocumento: (x: Enfocable) => boolean = () => true) {
      if (activo && estaEnElDocumento(activo)) activo.focus({ preventScroll: true });
    },
  };
}
