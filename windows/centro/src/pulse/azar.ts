/**
 * EL AZAR DEL CENTRO: `crypto.getRandomValues` de la WebView2 (el mismo generador del sistema que usa
 * Edge). En el teléfono hacía falta un parche (`mobile/src/pulse/azar.ts`) porque Hermes no lo trae;
 * aquí ya está, y @noble lo encuentra solo en `globalThis.crypto`. Nada de `Math.random`, nunca.
 */

/** WebCrypto no da más de 64 KiB por llamada: se llena a trozos. */
const TOPE = 65_536;

export function azar(n: number): Uint8Array {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || typeof c.getRandomValues !== 'function') throw new Error('sin generador de azar del sistema');
  const salida = new Uint8Array(n);
  for (let i = 0; i < n; i += TOPE) c.getRandomValues(salida.subarray(i, Math.min(n, i + TOPE)));
  return salida;
}
