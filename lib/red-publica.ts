/**
 * ABRIR UNA URL DE INTERNET SIN ABRIR LA RED INTERNA.
 *
 * `web_leer` abre lo que le digan: un enlace del usuario, de un expediente, o de una página que el
 * modelo acaba de leer. Tres trampas conocidas, las tres comprobadas contra la versión anterior:
 *
 *  1. IPv6 que esconde una IPv4: `http://[::ffff:127.0.0.1]` el propio `URL` lo reescribe como
 *     `[::ffff:7f00:1]`, y el filtro solo reconocía la forma con puntos.
 *  2. Redirecciones: una página pública que contesta 302 hacia `169.254.169.254` (el metadata de
 *     AWS) pasaba, porque `fetch` seguía el salto sin volver a mirar.
 *  3. DNS rebinding: se comprobaba el nombre, y al conectar se resolvía OTRA vez. Un DNS hostil
 *     contesta pública la primera y privada la segunda.
 *
 * Aquí se resuelve una sola vez, se comprueba esa IP, y el socket se conecta a ESA IP (la `lookup`
 * del propio socket). Cada salto de redirección vuelve a pasar por lo mismo. El cuerpo tiene tope.
 */
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

function v4Privada(n: string): boolean {
  if (n.startsWith('127.') || n.startsWith('10.') || n.startsWith('192.168.') || n.startsWith('169.254.') || n.startsWith('0.')) return true;
  if (n === '255.255.255.255' || /^(22[4-9]|23\d|24\d|25[0-5])\./.test(n)) return true; // multicast y reservadas
  const m = n.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  const cg = n.match(/^100\.(\d+)\./);
  if (cg && Number(cg[1]) >= 64 && Number(cg[1]) <= 127) return true; // CGNAT
  if (/^198\.1[89]\./.test(n)) return true; // pruebas de red
  return false;
}

/** La IPv4 que va dentro de una IPv6 mapeada o compatible (`::ffff:a.b.c.d`, `::ffff:7f00:1`, `::7f00:1`). */
function v4Dentro(v6: string): string | null {
  const n = v6.toLowerCase();
  const puntos = n.match(/^::(?:ffff:(?:0:)?)?(\d+\.\d+\.\d+\.\d+)$/);
  if (puntos) return puntos[1];
  const hex = n.match(/^::(?:ffff:(?:0:)?)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const a = parseInt(hex[1], 16);
    const b = parseInt(hex[2], 16);
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  return null;
}

export function ipPrivada(ip: string): boolean {
  const tipo = net.isIP(ip);
  if (!tipo) return true;
  if (tipo === 4) return v4Privada(ip);
  const n = ip.toLowerCase();
  if (n === '::' || n === '::1') return true;
  const v4 = v4Dentro(n);
  if (v4) return v4Privada(v4);
  if (/^f[cd][0-9a-f]{2}:/.test(n) || /^fe[89ab][0-9a-f]:/.test(n) || n.startsWith('ff')) return true; // ULA, link-local, multicast
  // NAT64 (64:ff9b::a.b.c.d) apunta a una IPv4: se juzga esa.
  const nat = n.match(/^64:ff9b::(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/);
  if (nat) return v4Privada(nat[1] || `${parseInt(nat[2], 16) >> 8}.${parseInt(nat[2], 16) & 255}.${parseInt(nat[3], 16) >> 8}.${parseInt(nat[3], 16) & 255}`);
  return false;
}

/** `lookup` para el socket: resuelve y RECHAZA si la dirección es privada. La conexión va a esa IP. */
function lookupPublico(host: string, opts: any, cb: (err: Error | null, address?: any, family?: number) => void) {
  dns.lookup(host, { all: true }, (err, recs) => {
    if (err) return cb(err);
    const lista = (recs || []) as dns.LookupAddress[];
    if (!lista.length || lista.some((r) => ipPrivada(r.address))) return cb(Object.assign(new Error('resuelve a red privada'), { code: 'EPRIVADA' }));
    if (opts?.all) return cb(null, lista);
    cb(null, lista[0].address, lista[0].family);
  });
}

export type Pagina = { status: number; tipo: string; texto: string; url: string };

/**
 * GET a una URL pública. Lanza si la URL, o cualquier salto de redirección, apunta a la red interna.
 */
export async function pedirPublico(raw: string, o: { ms?: number; maxBytes?: number; saltos?: number; headers?: Record<string, string> } = {}): Promise<Pagina> {
  const ms = o.ms ?? 7000;
  const maxBytes = o.maxBytes ?? 2_000_000;
  let url = raw;
  const fin = Date.now() + ms;
  for (let salto = 0; salto <= (o.saltos ?? 4); salto++) {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('solo http(s)');
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('host privado bloqueado');
    if (net.isIP(host) && ipPrivada(host)) throw new Error('host privado bloqueado');
    const r = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; cuerpo: Buffer }>((ok, no) => {
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.get(u, { headers: o.headers, lookup: lookupPublico as any, timeout: Math.max(500, fin - Date.now()) }, (res) => {
        const partes: Buffer[] = [];
        let n = 0;
        res.on('data', (c: Buffer) => {
          n += c.length;
          if (n > maxBytes) {
            req.destroy();
            return ok({ status: res.statusCode || 0, headers: res.headers, cuerpo: Buffer.concat(partes) });
          }
          partes.push(c);
        });
        res.on('end', () => ok({ status: res.statusCode || 0, headers: res.headers, cuerpo: Buffer.concat(partes) }));
        res.on('error', no);
      });
      req.on('timeout', () => req.destroy(new Error('tardó demasiado')));
      req.on('error', no);
    });
    if (r.status >= 300 && r.status < 400 && r.headers.location) {
      url = new URL(String(r.headers.location), u).toString();
      continue;
    }
    return { status: r.status, tipo: String(r.headers['content-type'] || ''), texto: r.cuerpo.toString('utf8'), url: u.toString() };
  }
  throw new Error('demasiadas redirecciones');
}

/**
 * A dónde lleva de verdad una URL pública, siguiendo las redirecciones desde AQUÍ (cada salto
 * comprobado). Es lo que se le pasa al ojo: su navegador ya no recibe un enlace que rebote a
 * `169.254.169.254` ni a la red del nodo.
 */
export async function destinoPublico(raw: string, ms = 8000): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const r = await pedirPublico(raw, { ms, maxBytes: 64_000, headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AU-RA-FP/3.0', Accept: 'text/html,*/*' } });
    return { ok: true, url: r.url };
  } catch (e: any) {
    return { ok: false, error: `no la abro (${String(e?.message || e).slice(0, 80)})` };
  }
}
