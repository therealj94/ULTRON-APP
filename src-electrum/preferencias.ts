/**
 * LO QUE LA PANTALLA RECUERDA DE VOS.
 *
 * Alto del panel y si la cara está plegada. No es información sensible —no hay nombres de
 * concesionarios en «el panel mide 62 %»— así que vive en `localStorage` y sobrevive a cerrar la
 * pestaña, que es justo lo que se espera de una preferencia: ponerla una vez.
 *
 * Todo entre `try`: hay navegadores donde el almacenamiento lanza, y una preferencia que no se
 * puede guardar no puede impedir que la plataforma abra.
 */
export function leerPreferencia<T>(clave: string, porDefecto: T, valido: (v: unknown) => boolean): T {
  try {
    const crudo = localStorage.getItem(`electrum.${clave}`);
    if (crudo == null) return porDefecto;
    const v = JSON.parse(crudo);
    return valido(v) ? (v as T) : porDefecto;
  } catch {
    return porDefecto;
  }
}

export function guardarPreferencia(clave: string, valor: unknown) {
  try {
    localStorage.setItem(`electrum.${clave}`, JSON.stringify(valor));
  } catch {
    /* sin almacenamiento la preferencia dura lo que dure la pestaña */
  }
}

/**
 * Las tres alturas del panel, como fracción de la pantalla.
 *
 * Tres y no un continuo porque en un teléfono no se arrastra con precisión, y porque los tres
 * momentos de uso son distintos de verdad: mirar el mapa después de un «mostrame Cerro Partido»,
 * leer una lista de traslapes, o la ida y vuelta normal.
 */
export const ALTURAS = { mapa: 0.16, dividido: 0.42, lectura: 0.76 } as const;
export type Reparto = keyof typeof ALTURAS;

/** El reparto cuyo alto está más cerca del actual. Para nombrar lo que se ve tras arrastrar. */
export function repartoDe(alto: number): Reparto {
  let mejor: Reparto = 'dividido';
  for (const k of Object.keys(ALTURAS) as Reparto[]) {
    if (Math.abs(ALTURAS[k] - alto) < Math.abs(ALTURAS[mejor] - alto)) mejor = k;
  }
  return mejor;
}

/** El siguiente en la rueda. Tocar el asa sin arrastrar cambia de estado, que es lo que se espera. */
export function siguienteReparto(alto: number): number {
  const orden: Reparto[] = ['mapa', 'dividido', 'lectura'];
  const i = orden.indexOf(repartoDe(alto));
  return ALTURAS[orden[(i + 1) % orden.length]];
}

export const ALTO_MIN = 0.12;
export const ALTO_MAX = 0.86;
