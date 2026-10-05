/**
 * LA GENERACIÓN DE LA CUENTA, sola: el contador y sus oyentes, sin nada más (ni hash ni nativo). Lo abre `fijarCuenta`
 * (lib/cuenta.ts, que lo reexporta); vive aparte para que lo que también compila la web (app/visor.ts) pueda atarse a
 * la cuenta sin arrastrar las dependencias del teléfono. En la web nadie lo abre: queda en 0 y no cambia nada.
 */
let generacion = 0;
const oyentes = new Set<() => void>();

/** Una generación nueva (solo `fijarCuenta`): avisa en el acto a quien tenga algo de la anterior. */
export function abrirGeneracion(): number {
  generacion++;
  for (const f of [...oyentes]) {
    try {
      f();
    } catch {
      /* un oyente roto no deja la cuenta a medias */
    }
  }
  return generacion;
}

/** Avisa cada cambio de generación (salir, entrar otra persona, o la misma de nuevo). Devuelve cómo dejar de oír. */
export function alCambiarCuenta(f: () => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

export function generacionCuenta(): number {
  return generacion;
}

/** ¿Sigue vigente la generación que se capturó al empezar? */
export function sigueVigente(g: number): boolean {
  return g === generacion;
}

/** Solo pruebas (lo usa `_reiniciarCuenta`). */
export function _reiniciarGeneracion() {
  generacion = 0;
}
