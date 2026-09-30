/**
 * EL CAJÓN DE SECRETOS de PULSE2CHAT en el Centro: la cuenta del chat (`correo`, `llave`) y las llaves
 * privadas de ESTE aparato. No viven en la página (localStorage lo leería cualquiera con acceso al
 * perfil de la WebView): se guardan en AURA (C#) con DPAPI, por el puente `secreto.*`.
 *
 * Las claves siguen la regla del puente: `^[a-z0-9._-]{1,60}$`. Las pruebas cambian el almacén por
 * uno en memoria con `ponerAlmacen`.
 */
import { pedir } from '../puente';

export type Almacen = {
  /** El valor guardado, `null` si no hay nada. LANZA si no se pudo leer (no es lo mismo que «no hay»). */
  leer(clave: string): Promise<string | null>;
  guardar(clave: string, valor: string): Promise<void>;
  borrar(clave: string): Promise<void>;
};

const CLAVE_VALIDA = /^[a-z0-9._-]{1,60}$/;

function comprobar(clave: string) {
  if (!CLAVE_VALIDA.test(clave)) throw new Error('clave de secreto inválida: ' + clave);
}

/** AURA puede devolver el texto tal cual o `{ valor }`: las dos formas valen. */
function valorDe(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'valor' in v) {
    const x = (v as { valor?: unknown }).valor;
    return typeof x === 'string' ? x : null;
  }
  return null;
}

const DEL_PUENTE: Almacen = {
  async leer(clave) {
    comprobar(clave);
    return valorDe(await pedir('secreto.leer', { clave }, 15_000));
  },
  async guardar(clave, valor) {
    comprobar(clave);
    await pedir('secreto.guardar', { clave, valor }, 15_000);
  },
  async borrar(clave) {
    comprobar(clave);
    await pedir('secreto.borrar', { clave }, 15_000);
  },
};

let actual: Almacen = DEL_PUENTE;

export const secretos = (): Almacen => actual;

/** Solo para pruebas: un almacén en memoria (o uno que falla, para probar el «no se pudo leer»). */
export function ponerAlmacen(a: Almacen | null) {
  actual = a ?? DEL_PUENTE;
}

/** Un almacén en memoria, para pruebas y el modo muestra. */
export function almacenEnMemoria(inicial: Record<string, string> = {}): Almacen & { datos: Map<string, string> } {
  const datos = new Map(Object.entries(inicial));
  return {
    datos,
    async leer(clave) {
      comprobar(clave);
      return datos.get(clave) ?? null;
    },
    async guardar(clave, valor) {
      comprobar(clave);
      datos.set(clave, valor);
    },
    async borrar(clave) {
      comprobar(clave);
      datos.delete(clave);
    },
  };
}
