/**
 * EL AZAR DEL TELÉFONO: lo que @noble espera encontrar en `globalThis.crypto` y en Android no está.
 *
 * Copia de `orden-global-app/src/og/azar.js` (PULSE2CHAT). Se pone AL IMPORTAR, no al llamar:
 * @noble mira el global cuando se carga, y si esto llegara después ya habría guardado `undefined`.
 * Por eso `candado.ts` lo importa en su primera línea. Si algún día hay WebCrypto de verdad, se
 * respeta: dos generadores compitiendo son una fuente de fallos rarísimos.
 */
import * as Crypto from 'expo-crypto';

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
      const bytes = Crypto.getRandomBytes(arr.byteLength);
      new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength).set(bytes);
      return arr;
    };
    return true;
  } catch {
    return false;
  }
}

ponerElAzar();
