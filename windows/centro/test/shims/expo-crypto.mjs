// Imitación de `expo-crypto`: los bytes al azar salen del generador del sistema de Node.
import { randomBytes } from 'node:crypto';

export function getRandomBytes(n) {
  if (n > 1024) throw new RangeError('expo-crypto da como mucho 1024 bytes por llamada');
  return new Uint8Array(randomBytes(n));
}
