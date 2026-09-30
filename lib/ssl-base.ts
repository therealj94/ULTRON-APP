/**
 * EL TLS DE LAS BASES DE DATOS, con el certificado VERIFICADO.
 *
 * Antes cada pool declaraba `ssl: { rejectUnauthorized: false }` al ver `sslmode=require`: cifrado sin
 * comprobar a quién se habla (un impostor en medio también cifra). Con pg 8 esa línea ni siquiera
 * mandaba —pg-connection-string la pisa con lo que lee de la URL—, así que lo que decía el código y
 * lo que hacía el driver no coincidían, y el día que cambie el driver (pg 9 trata `require` como
 * libpq: sin verificar) se habría quedado sin verificar.
 *
 * Ahora la configuración la decide esto, de forma explícita, y es la que usa el driver:
 *  · sin `sslmode` (o `disable`): como antes, sin TLS (la base local, el túnel propio);
 *  · `require`, `prefer`, `verify-ca`, `verify-full`: TLS con el certificado y el nombre verificados;
 *    con una CA propia en `BASE_SSL_CA` (el PEM o la ruta a un archivo) o `sslrootcert=` en la URL;
 *  · `no-verify`: sin verificar, SOLO porque la URL lo pide así a propósito (desarrollo). En
 *    producción se avisa en el log.
 * Los parámetros de TLS se quitan de la URL que recibe pg: si no, los vuelve a leer y pisa este objeto.
 */
import fs from 'node:fs';
import type { ConnectionOptions } from 'node:tls';

const PARAMS_TLS = ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl', 'uselibpqcompat'];

function leerCa(valor: string | undefined): string | undefined {
  const v = String(valor || '').trim();
  if (!v) return undefined;
  if (v.includes('BEGIN CERTIFICATE')) return String(valor).replace(/\\n/g, '\n');
  try {
    return fs.readFileSync(v, 'utf8');
  } catch {
    console.warn('[base] no pude leer la CA de', v.slice(0, 80));
    return undefined;
  }
}

export type ConfigTls = { connectionString: string; ssl: ConnectionOptions | undefined };

/** La URL para pg (sin parámetros de TLS) y el TLS que de verdad se usa. */
export function configTls(url: string, env: NodeJS.ProcessEnv = process.env): ConfigTls {
  // Sin parámetros de TLS la URL no se toca (ni se vuelve a escribir): sin TLS, como siempre.
  if (!/[?&](sslmode|sslrootcert|sslcert|sslkey|ssl|uselibpqcompat)=/i.test(url)) return { connectionString: url, ssl: undefined };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    // Una URL que no se entiende se deja como está (pg dará su error): no se inventa TLS.
    return { connectionString: url, ssl: undefined };
  }
  const q = u.searchParams;
  const modo = (q.get('sslmode') || (q.get('ssl') === 'true' || q.get('ssl') === '1' ? 'require' : '')).toLowerCase();
  const caUrl = q.get('sslrootcert') || undefined;
  for (const p of PARAMS_TLS) q.delete(p);
  const connectionString = u.toString();
  if (!modo || modo === 'disable' || modo === 'allow') return { connectionString, ssl: undefined };
  if (modo === 'no-verify') {
    if (env.NODE_ENV === 'production') console.warn('[base] sslmode=no-verify en producción: el TLS no comprueba el certificado de la base.');
    return { connectionString, ssl: { rejectUnauthorized: false } };
  }
  const ca = leerCa(env.BASE_SSL_CA) ?? leerCa(caUrl);
  return { connectionString, ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } };
}
