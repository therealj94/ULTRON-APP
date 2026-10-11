/**
 * UNA LÍNEA POR INTENTO DE ENTRAR (José, 10-oct).
 *
 * Gente real no podía entrar a AU-RA y en los registros de Render no había NADA de ninguna ruta de entrada
 * en siete días: las rutas de Genesis, de Veta Wallet, de «entrar» y de «crear cuenta» no escribían una sola
 * línea cuando algo salía mal, así que cada fallo era invisible. Desde ahora cada intento deja una línea al
 * terminar, con:
 *
 *   [entrada] ruta=/api/genesis/entrar status=401 resultado=PASE_INVALIDO detalle="sin destino aura" ms=231 quien=j***@dominio.com
 *
 *   · `resultado`: el código que se le contestó a la app (`codigo`/`code` del cuerpo), o OK / LIMITE / HTTP_<n>;
 *   · `detalle`: lo que la ruta quiera contar de puertas adentro (res.locals.detalleEntrada), p. ej. por qué
 *     Genesis rechazó el pase. Nunca un token, un pase ni una contraseña;
 *   · `quien`: el correo ENMASCARADO (primera letra y dominio). Una identidad de Veta Wallet (`veta:0x…`) va
 *     como huella corta. Nunca el correo entero.
 *
 * Se monta como middleware delante de cada ruta de entrada (vigilarEntradas) y escribe al terminar la
 * respuesta, con lo que esa respuesta llevaba: así no se olvida ningún camino de salida de una ruta.
 */
import crypto from 'node:crypto';
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';

/** «josé@dominio.com» → «j***@dominio.com»; una identidad de la wallet → «veta:#<huella>». Sin correo, «-». */
export function enmascararCorreo(c: unknown): string {
  const s = String(c ?? '').trim().toLowerCase();
  if (!s) return '-';
  if (s.startsWith('veta:')) return `veta:#${crypto.createHash('sha256').update(s).digest('hex').slice(0, 10)}`;
  const i = s.lastIndexOf('@');
  if (i < 1) return `#${crypto.createHash('sha256').update(s).digest('hex').slice(0, 10)}`;
  const dominio = s.slice(i + 1).replace(/[^a-z0-9.-]/g, '').slice(0, 60);
  return `${s.charAt(0).replace(/[^a-z0-9]/, '*')}***@${dominio}`;
}

/** El texto de un detalle, en una línea, sin comillas que rompan el formato y sin nada largo. */
function limpio(t: unknown): string {
  return String(t ?? '')
    .replace(/[\u0000-\u001f\u007f"]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export type LineaEntrada = { ruta: string; status: number; resultado: string; detalle?: string; ms: number; quien?: string };

/** La línea tal cual sale al registro (separada para probarla). */
export function lineaEntrada(l: LineaEntrada): string {
  const partes = [`ruta=${l.ruta}`, `status=${l.status}`, `resultado=${limpio(l.resultado).replace(/\s/g, '_') || '-'}`];
  if (l.detalle) partes.push(`detalle="${limpio(l.detalle)}"`);
  partes.push(`ms=${Math.max(0, Math.round(l.ms))}`);
  partes.push(`quien=${l.quien || '-'}`);
  return `[entrada] ${partes.join(' ')}`;
}

/** El código que se le contestó a la app. */
export function resultadoDe(status: number, cuerpo: any): string {
  const c = cuerpo && typeof cuerpo === 'object' ? cuerpo.codigo || cuerpo.code : '';
  if (typeof c === 'string' && c) return c;
  if (status === 429) return 'LIMITE';
  if (status < 400 && cuerpo?.ok !== false) return 'OK';
  return `HTTP_${status}`;
}

/** Lo que una ruta quiere que vaya en `detalle` (de puertas adentro: la app no lo ve). */
export function anotarDetalle(res: Response, detalle: unknown) {
  if (res.locals) res.locals.detalleEntrada = limpio(detalle);
}

/**
 * El middleware: anota cuándo empezó y, al terminar la respuesta, escribe la línea. Solo POST (los GET de
 * estas rutas no son intentos). La espera de la web (`/api/genesis/web/recoger` con `pendiente`) no se
 * escribe: pregunta cada pocos segundos y taparía lo importante.
 */
export function vigilarEntradas(escribir: (linea: string) => void = (t) => console.log(t)): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'POST') return next();
    const inicio = Date.now();
    const ruta = (req.baseUrl || '') + (req.path === '/' ? '' : req.path) || req.originalUrl.split('?')[0];
    let cuerpo: any = null;
    const json = res.json.bind(res);
    res.json = ((b: any) => {
      cuerpo = b;
      return json(b);
    }) as Response['json'];
    res.once('finish', () => {
      if (cuerpo?.estado === 'pendiente') return;
      try {
        // El correo se lee al final (el cuerpo ya pasó por express.json); de él solo sale la máscara.
        const quien = enmascararCorreo(res.locals?.quienEntrada ?? (req.body && typeof req.body === 'object' ? req.body.correo : ''));
        escribir(lineaEntrada({ ruta, status: res.statusCode, resultado: resultadoDe(res.statusCode, cuerpo), detalle: res.locals?.detalleEntrada, ms: Date.now() - inicio, quien }));
      } catch {
        /* el registro nunca tumba una respuesta */
      }
    });
    next();
  };
}

/** Pone el middleware delante de estas rutas (antes de montarlas: Express respeta el orden). */
export function montarVigilancia(app: Express, rutas: string[], escribir?: (linea: string) => void) {
  for (const r of rutas) app.use(r, vigilarEntradas(escribir));
}
