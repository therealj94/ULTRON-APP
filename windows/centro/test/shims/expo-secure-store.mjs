// Imitación de `expo-secure-store` para las pruebas: el llavero del teléfono, en memoria.
// `__llavero` deja a la prueba mirarlo, vaciarlo o hacer que falle (`fallar = true`).
export const __llavero = { datos: new Map(), fallar: false };

export async function getItemAsync(k) {
  if (__llavero.fallar) throw new Error('el llavero no se dejó leer');
  return __llavero.datos.has(k) ? __llavero.datos.get(k) : null;
}
export async function setItemAsync(k, v) {
  if (__llavero.fallar) throw new Error('el llavero no se dejó escribir');
  __llavero.datos.set(k, String(v));
}
export async function deleteItemAsync(k) {
  __llavero.datos.delete(k);
}
