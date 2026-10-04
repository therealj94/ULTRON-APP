/**
 * Un S3 de mentira CON escrituras condicionales (para lib/durable.ts y server/turno-unico.ts). Intercepta
 * `fetch` hacia *.amazonaws.com como tests/correo-cuentas-recibo.test.ts, y además:
 *   · `If-None-Match: *` → 412 si el objeto ya existe;
 *   · `If-Match: <ETag>` → 412 si no existe o su ETag cambió;
 *   · cada objeto tiene ETag (cambia en cada escritura) y GET lo devuelve.
 * Nada sale de la máquina. `lee`/`escribe` en false simulan S3 caído (503).
 */
export type S3Falso = {
  objetos: Map<string, { cuerpo: string; etag: string }>;
  lee: { ok: boolean };
  escribe: { ok: boolean };
  /** Fallos por objeto (P5/A7): devuelve true para que ESA clave conteste 503 al escribir o al leer. */
  fallaEscritura: { si: ((clave: string) => boolean) | null };
  fallaLectura: { si: ((clave: string) => boolean) | null };
  /** Cuántos PUT llegaron (con y sin condición) y cuántos devolvieron 412. */
  puts: () => number;
  rechazos412: () => number;
  restaurar: () => void;
};

export function instalarS3Falso(): S3Falso {
  const original = globalThis.fetch;
  const objetos = new Map<string, { cuerpo: string; etag: string }>();
  const lee = { ok: true };
  const escribe = { ok: true };
  const fallaEscritura: S3Falso['fallaEscritura'] = { si: null };
  const fallaLectura: S3Falso['fallaLectura'] = { si: null };
  let puts = 0;
  let rechazos = 0;
  let serie = 0;
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const u = new URL(String(url));
    if (!u.hostname.endsWith('.amazonaws.com')) return original(url, init);
    const clave = decodeURIComponent(u.pathname);
    const h = Object.fromEntries(Object.entries((init.headers || {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), String(v)]));
    if (init.method === 'PUT') {
      puts++;
      if (!escribe.ok || fallaEscritura.si?.(clave)) return new Response('fuera', { status: 503 });
      const actual = objetos.get(clave);
      if (h['if-none-match'] === '*' && actual) {
        rechazos++;
        return new Response('<Error><Code>PreconditionFailed</Code></Error>', { status: 412 });
      }
      if (h['if-match'] !== undefined && (!actual || actual.etag !== h['if-match'])) {
        rechazos++;
        return new Response('<Error><Code>PreconditionFailed</Code></Error>', { status: 412 });
      }
      const etag = `"e${++serie}"`;
      objetos.set(clave, { cuerpo: Buffer.from(init.body).toString('utf8'), etag });
      return new Response('', { status: 200, headers: { etag } });
    }
    if (!lee.ok || fallaLectura.si?.(clave)) return new Response('fuera', { status: 503 });
    const v = objetos.get(clave);
    return v === undefined ? new Response('no', { status: 404 }) : new Response(v.cuerpo, { status: 200, headers: { etag: v.etag } });
  }) as typeof fetch;
  const antes = { b: process.env.ULTRON_MEMORIA_BUCKET, a: process.env.AWS_ACCESS_KEY_ID, s: process.env.AWS_SECRET_ACCESS_KEY };
  Object.assign(process.env, { ULTRON_MEMORIA_BUCKET: 'cubo-prueba', AWS_ACCESS_KEY_ID: 'AKIAPRUEBA', AWS_SECRET_ACCESS_KEY: 'secreto-prueba' });
  return {
    objetos,
    lee,
    escribe,
    fallaEscritura,
    fallaLectura,
    puts: () => puts,
    rechazos412: () => rechazos,
    restaurar: () => {
      globalThis.fetch = original;
      Object.assign(process.env, { ULTRON_MEMORIA_BUCKET: antes.b || '', AWS_ACCESS_KEY_ID: antes.a || '', AWS_SECRET_ACCESS_KEY: antes.s || '' });
    },
  };
}

/** Corre `f` con el S3 falso puesto y lo quita al terminar (aunque falle). */
export async function conS3Falso(f: (s3: S3Falso) => Promise<void>) {
  const s3 = instalarS3Falso();
  try {
    await f(s3);
  } finally {
    s3.restaurar();
  }
}
