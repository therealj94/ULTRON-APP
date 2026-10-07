// El servidor de mentira del banco de su computadora: `api()` con el mismo contrato que mobile/src/lib/api.ts (devuelve
// el JSON o lanza un Error con el `error` del servidor y su `status`), contestado por la escena que monta main.tsx.
export type Respuesta = { json?: unknown; status?: number; error?: string; demora?: number } | null;
type Responder = (ruta: string, init?: RequestInit) => Respuesta;

const g = globalThis as unknown as { __PC_RESPONDER?: Responder; __PC_LLAMADAS?: { ruta: string; metodo: string; cuerpo?: string }[] };

export function responder(f: Responder) {
  g.__PC_RESPONDER = f;
  g.__PC_LLAMADAS = [];
}

export async function api<T = any>(ruta: string, init?: RequestInit, _timeoutMs = 30_000): Promise<T> {
  g.__PC_LLAMADAS?.push({ ruta, metodo: init?.method || 'GET', cuerpo: typeof init?.body === 'string' ? init.body : undefined });
  const r = g.__PC_RESPONDER?.(ruta, init) ?? { status: 502, error: 'La computadora no contestó (simulado).' };
  await new Promise((ok) => setTimeout(ok, r.demora ?? 30));
  if (r.error || (r.status && r.status >= 400)) {
    const e = new Error(r.error || `HTTP ${r.status}`) as Error & { status?: number; data?: unknown };
    e.status = r.status ?? 502;
    e.data = { error: r.error };
    throw e;
  }
  return r.json as T;
}
