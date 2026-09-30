const { randomBytes } = require('node:crypto');
// Igual que el de verdad: más de 1024 bytes por llamada LANZA (expo-crypto/build/Crypto.js).
exports.getRandomBytes = (n) => {
  if (!(n >= 0 && n <= 1024)) throw new TypeError(`expo-crypto: getRandomBytes(${n}) expected a valid number from range 0...1024`);
  globalThis.__bytesPedidos = (globalThis.__bytesPedidos || 0) + 1;
  return new Uint8Array(randomBytes(n));
};
