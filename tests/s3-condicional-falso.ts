/**
 * Un S3 de mentira CON escrituras condicionales (para lib/durable.ts y server/turno-unico.ts). Intercepta
 * `fetch` hacia *.amazonaws.com como tests/correo-cuentas-recibo.test.ts, y además:
 *   · `If-None-Match: *` → 412 si el objeto ya existe;
 *   · `If-Match: <ETag>` → 412 si no existe o su ETag cambió;
 *   · cada objeto tiene ETag (cambia en cada escritura) y GET lo devuelve;
 *   · ListObjectsV2 (`?list-type=2`, A7): `prefix`, `delimiter=/`, `start-after`, `max-keys` y `continuation-token`, en
 *     orden de clave como S3. `fallaListado.si` lo hace contestar 503 (un prefijo concreto o todos).
 * Nada sale de la máquina. `lee`/`escribe` en false simulan S3 caído (503).
 */
export type S3Falso = {
  objetos: Map<string, { cuerpo: string; etag: string }>;
  lee: { ok: boolean };
  escribe: { ok: boolean };
  /** Fallos por objeto (P5/A7): devuelve true para que ESA clave conteste 503 al escribir o al leer. */
  fallaEscritura: { si: ((clave: string) => boolean) | null };
  fallaLectura: { si: ((clave: string) => boolean) | null };
  /** A7: devuelve true para que el LISTADO de ese prefijo conteste 503 (permiso de ListBucket ausente, S3 caído). */
  fallaListado: { si: ((prefijo: string) => boolean) | null };
  /** A7: se llama al atender cada listado (antes de contestar): para meter una escritura concurrente en medio. */
  alListar: { f: ((prefijo: string) => Promise<void> | void) | null };
  /** Cuántos listados llegaron. */
  listados: () => number;
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
  const fallaListado: S3Falso['fallaListado'] = { si: null };
  const alListar: S3Falso['alListar'] = { f: null };
  let listados = 0;
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
    if (u.searchParams.get('list-type') === '2') {
      listados++;
      const prefijo = u.searchParams.get('prefix') || '';
      if (alListar.f) await alListar.f(prefijo);
      if (!lee.ok || fallaListado.si?.(prefijo)) return new Response('fuera', { status: 503 });
      return listar(objetos, u.searchParams);
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
    fallaListado,
    alListar,
    listados: () => listados,
    puts: () => puts,
    rechazos412: () => rechazos,
    restaurar: () => {
      globalThis.fetch = original;
      Object.assign(process.env, { ULTRON_MEMORIA_BUCKET: antes.b || '', AWS_ACCESS_KEY_ID: antes.a || '', AWS_SECRET_ACCESS_KEY: antes.s || '' });
    },
  };
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** ListObjectsV2 sobre el mapa (las claves del mapa empiezan con «/»; las de S3, no). */
function listar(objetos: Map<string, { cuerpo: string }>, q: URLSearchParams): Response {
  const prefijo = q.get('prefix') || '';
  const delim = q.get('delimiter') || '';
  const max = Math.max(1, Math.min(1000, Number(q.get('max-keys') || 1000)));
  const token = q.get('continuation-token');
  const desde = token ? Buffer.from(token, 'base64url').toString('utf8') : q.get('start-after') || '';
  const claves = [...objetos.keys()]
    .map((k) => k.replace(/^\//, ''))
    .filter((k) => k.startsWith(prefijo) && k > desde && !(delim && k.slice(prefijo.length).includes(delim)))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const pagina = claves.slice(0, max);
  const truncado = claves.length > max;
  const cuerpo =
    `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Prefix>${xml(prefijo)}</Prefix><KeyCount>${pagina.length}</KeyCount><MaxKeys>${max}</MaxKeys>` +
    `<IsTruncated>${truncado}</IsTruncated>` +
    pagina.map((k) => `<Contents><Key>${xml(k)}</Key><Size>${objetos.get(`/${k}`)?.cuerpo.length ?? 0}</Size></Contents>`).join('') +
    (truncado ? `<NextContinuationToken>${Buffer.from(pagina[pagina.length - 1]).toString('base64url')}</NextContinuationToken>` : '') +
    `</ListBucketResult>`;
  return new Response(cuerpo, { status: 200, headers: { 'content-type': 'application/xml' } });
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
