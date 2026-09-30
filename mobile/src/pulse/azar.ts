/**
 * EL AZAR DEL TELÉFONO: lo que @noble espera encontrar en `globalThis.crypto` y en Android no está.
 *
 * Copia de `orden-global-app/src/og/azar.js` (PULSE2CHAT). Se pone AL IMPORTAR, no al llamar:
 * @noble mira el global cuando se carga, y si esto llegara después ya habría guardado `undefined`.
 * Por eso `candado.ts` lo importa en su primera línea. Si algún día hay WebCrypto de verdad, se
 * respeta: dos generadores compitiendo son una fuente de fallos rarísimos.
 */
import * as Crypto from 'expo-crypto';

const TROZO = 1024;

export function ponerElAzar(): boolean {
  const g = globalThis as any;
  if (!g.crypto) {
    try {
      g.crypto = {};
    } catch {
      return false;
    }
  }
  if (typeof g.crypto.getRandomValues === 'function') return true;
  try {
    g.crypto.getRandomValues = (arr: ArrayBufferView) => {
      // Cualquier vista tipada, no solo Uint8Array: devolver ceros callados sería el peor fallo posible.
      if (!ArrayBuffer.isView(arr)) throw new TypeError('se esperaba una vista tipada');
      // El tope de WebCrypto (64 KiB por llamada) se respeta igual que en un navegador.
      if (arr.byteLength > 65536) throw new RangeError('getRandomValues: más de 65536 bytes');
      // expo-crypto da como mucho 1024 bytes por llamada (y LANZA si se le piden más): se llena a trozos.
      const destino = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      for (let i = 0; i < destino.length; i += TROZO) destino.set(Crypto.getRandomBytes(Math.min(TROZO, destino.length - i)), i);
      return arr;
    };
    return true;
  } catch {
    return false;
  }
}

ponerElAzar();
