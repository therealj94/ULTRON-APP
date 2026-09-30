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

/* ------------------------------------------------------ las que siguen a la persona */

/**
 * Preferencias que se guardan CON LA PERSONA en el servidor (server/electrum/preferencias.ts), no
 * solo en este navegador: cómo dejó el panel de caras sigue igual en el teléfono y en la
 * computadora. Aquí hay una copia local para que la pantalla arranque ya como se dejó, sin
 * esperar a la red; la del servidor manda cuando llega.
 */
export type PrefsUsuario = { retratosPlegados: boolean; retratosPlegadosRecorrido: boolean };
export const PREFS_USUARIO: PrefsUsuario = { retratosPlegados: true, retratosPlegadosRecorrido: true };

const esPrefs = (v: unknown) => !!v && typeof v === 'object';
let prefs: PrefsUsuario = { ...PREFS_USUARIO, ...sanear(leerPreferencia<unknown>('usuario', {}, esPrefs)) };
const oyentesPrefs = new Set<(p: PrefsUsuario) => void>();

function sanear(v: unknown): Partial<PrefsUsuario> {
  const out: Partial<PrefsUsuario> = {};
  if (!esPrefs(v)) return out;
  for (const k of Object.keys(PREFS_USUARIO) as Array<keyof PrefsUsuario>) {
    const x = (v as Record<string, unknown>)[k];
    if (typeof x === 'boolean') out[k] = x;
  }
  return out;
}

function publicar(nuevas: PrefsUsuario) {
  prefs = nuevas;
  guardarPreferencia('usuario', prefs);
  for (const f of oyentesPrefs) f(prefs);
}

export function prefsUsuario(): PrefsUsuario {
  return prefs;
}

export function escucharPrefsUsuario(f: (p: PrefsUsuario) => void): () => void {
  oyentesPrefs.add(f);
  return () => oyentesPrefs.delete(f);
}

let traidas = false;
/** Trae las del servidor una vez por carga de página. Sin red, se queda con la copia local. */
export async function traerPrefsUsuario(headers: Record<string, string>): Promise<void> {
  if (traidas) return;
  traidas = true;
  try {
    const r = await fetch('/api/electrum/preferencias', { headers });
    if (!r.ok) return;
    const j = await r.json();
    publicar({ ...prefs, ...sanear(j?.preferencias) });
  } catch {
    traidas = false;
  }
}

/** Cambia una y la manda al servidor. La pantalla cambia en el acto; la red va detrás. */
export function cambiarPrefUsuario<K extends keyof PrefsUsuario>(clave: K, valor: PrefsUsuario[K], headers: Record<string, string>) {
  publicar({ ...prefs, [clave]: valor });
  void fetch('/api/electrum/preferencias', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ [clave]: valor }),
  }).catch(() => {});
}
