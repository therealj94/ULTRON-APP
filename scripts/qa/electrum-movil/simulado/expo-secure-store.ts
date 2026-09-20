const caja = new Map<string, string>();
export async function getItemAsync(k: string) { return caja.get(k) ?? null; }
export async function setItemAsync(k: string, v: string) { caja.set(k, v); }
export async function deleteItemAsync(k: string) { caja.delete(k); }
