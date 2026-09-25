/**
 * ¿El sistema pide menos movimiento?
 *
 * No es una preferencia estética. Para quien tiene vértigo o sensibilidad vestibular, un mapa que
 * vuela solo durante segundo y medio o un panel que se desliza producen mareo de verdad. El sistema
 * operativo ya lo sabe y el navegador lo cuenta; solo había que preguntárselo.
 *
 * Se consulta en cada uso en vez de guardarse: la preferencia se puede cambiar con la pantalla
 * abierta, y quien la activa es justo quien menos debería tener que recargar para que le haga caso.
 */
export function sinMovimiento(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Una duración de animación que respeta la preferencia. Cero es instantáneo, no roto. */
export function duracion(ms: number): number {
  return sinMovimiento() ? 0 : ms;
}
