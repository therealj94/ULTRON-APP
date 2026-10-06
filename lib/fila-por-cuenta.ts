/**
 * UN CAMBIO A LA VEZ POR CUENTA (leer → cambiar → guardar) y LECTURAS QUE NO PISAN UN CAMBIO MÁS NUEVO.
 *
 * Revisión del 6-oct (voces): `guardar()` ponía en fila solo las escrituras, no el «leer → cambiar →
 * guardar» completo. «Olvida la voz de Ana» y «aprende la voz de Bruno» en el mismo momento leían el mismo
 * cajón (con Ana); si el alta guardaba última, Ana volvía. Lo mismo que ya se arregló para las caras
 * (lib/caras-miembro.ts `unoALaVez`), en un solo lugar.
 *
 * Y la otra mitad de la misma carrera: una LECTURA que fue a S3 (caché vacía tras un reinicio) y tardó
 * puede volver con el cajón de ANTES de un cambio que se guardó mientras tanto; si esa lectura se pone en
 * la caché (y en el disco), el siguiente cambio parte de lo viejo y lo borrado reaparece. `Generaciones`
 * cuenta los cambios por cuenta: una lectura que empezó antes de un cambio no se guarda en la caché.
 */
export function filaPorCuenta() {
  const candados = new Map<string, Promise<unknown>>();
  return function unoALaVez<T>(clave: string, fn: () => Promise<T>): Promise<T> {
    const previo = candados.get(clave) || Promise.resolve();
    const paso = previo.then(fn);
    const cola = paso.catch(() => undefined);
    candados.set(clave, cola);
    void cola.then(() => {
      if (candados.get(clave) === cola) candados.delete(clave);
    });
    return paso;
  };
}

export class Generaciones {
  private m = new Map<string, number>();
  /** La generación de ahora (antes de ir a leer lo lento). */
  de(clave: string): number {
    return this.m.get(clave) || 0;
  }
  /** Se guardó (o se está guardando) un cambio de esta cuenta. */
  cambio(clave: string) {
    this.m.set(clave, this.de(clave) + 1);
  }
  /** ¿Hubo un cambio desde `g`? Entonces lo leído es viejo y no va a la caché ni al disco. */
  cambioDesde(clave: string, g: number): boolean {
    return this.de(clave) !== g;
  }
}
