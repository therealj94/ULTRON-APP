/**
 * La generación del reconocimiento (CAM-C, master §25.5): un resultado del motor de caras se aplica solo si, al
 * volver del await, sigue siendo de la misma generación (misma cámara, misma cuenta, reconocimiento todavía activo,
 * nada olvidado en medio) y su cámara sigue vigente. Antes useCaras votaba con lo que volviera, aunque en medio se
 * hubiera cambiado de cámara, apagado el reconocimiento o dicho «olvida a Ana».
 */
export class GeneracionCaras {
  private n = 0;

  /** Algo cambió (cámara, cuenta, activación, borrado): lo pedido antes ya no se aplica. */
  subir() {
    this.n += 1;
  }

  sello(): number {
    return this.n;
  }

  vigente(s: number): boolean {
    return s === this.n;
  }
}

/** Corre `trabajo` y devuelve su resultado solo si `vigente()` sigue siendo cierto al terminar (si no, null). */
export async function analizarVigente<T>(trabajo: () => Promise<T | null | undefined> | undefined, vigente: () => boolean): Promise<T | null> {
  const r = await trabajo();
  if (r === null || r === undefined) return null;
  return vigente() ? r : null;
}
