/**
 * EL CONTADOR DE RECURSOS DE LA VOZ (AUR10): oyentes, timers, pistas y conexiones que una sesión tiene
 * vivos. Al colgar todo vuelve a cero; si algo queda, `lista()` dice qué (la miga lo lleva al servidor).
 *
 * Es instrumentación, no control: quien toma un recurso guarda el `soltar` que devuelve `tomar` y lo llama
 * al liberarlo (las veces que sea: soltar dos veces no descuenta dos). Las pruebas lo usan con dobles del
 * SDK y del reloj para demostrar que colgar en cualquier fase no deja nada vivo
 * (tests/voz-recursos-movil.test.ts). Sin React Native.
 */
export type TipoRecurso = 'oyente' | 'timer' | 'pista' | 'conexion';

export class ContadorRecursos {
  private vivos = new Map<number, { tipo: TipoRecurso; etiqueta: string }>();
  private n = 0;

  /** Anota un recurso vivo; devuelve cómo soltarlo (idempotente). */
  tomar(tipo: TipoRecurso, etiqueta: string): () => void {
    const id = ++this.n;
    this.vivos.set(id, { tipo, etiqueta });
    return () => {
      this.vivos.delete(id);
    };
  }

  /** Cuántos quedan vivos (de un tipo, o todos). */
  cuenta(tipo?: TipoRecurso): number {
    if (!tipo) return this.vivos.size;
    let c = 0;
    for (const v of this.vivos.values()) if (v.tipo === tipo) c++;
    return c;
  }

  /** Lo que queda vivo, «tipo:etiqueta», en el orden en que se tomó. */
  lista(): string[] {
    return [...this.vivos.values()].map((v) => `${v.tipo}:${v.etiqueta}`);
  }
}
