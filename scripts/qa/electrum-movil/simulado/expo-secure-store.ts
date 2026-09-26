// El almacén seguro, en memoria. `?sesion=` y `?llave=` lo siembran, como si el teléfono ya
// tuviera una credencial guardada de antes (para probar el arranque con sesión caducada).
const caja = new Map<string, string>();
const q = new URLSearchParams(globalThis.location?.search || '');
if (q.get('sesion')) caja.set('ultron_sesion_token', q.get('sesion')!);
if (q.get('llave')) caja.set('electrum_llave', q.get('llave')!);
export async function getItemAsync(k: string) { return caja.get(k) ?? null; }
export async function setItemAsync(k: string, v: string) { caja.set(k, v); }
export async function deleteItemAsync(k: string) { caja.delete(k); }
