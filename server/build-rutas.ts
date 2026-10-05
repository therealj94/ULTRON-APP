/**
 * EL MANIFIESTO DEL BUILD Y LO QUE LLEGÓ A CADA APARATO.
 *
 *   GET /api/build  (sesión de mesa)  → el manifiesto de la entrega (lib/build.ts manifiestoEntrega), la salud del
 *       almacén durable y, para la cuenta de la sesión, `clientes`: qué build corre cada aparato suyo que abrió la app
 *       (lib/recepcion-clientes.ts), con `esperado` y `recibido` (sí | no | desconocido). Cada cuenta ve SOLO lo suyo:
 *       la clave de mesa sin sesión no es una cuenta y recibe `clientes: []` con `recepcion.cuenta: false`.
 *
 *   Cualquier /api con la cabecera `x-aura-cliente` y una sesión: se anota el build de esa instalación en la cuenta de
 *       la sesión, sin esperar (la petición sigue igual pase lo que pase). Sin cabecera o sin sesión: nada.
 *
 * Se movió aquí desde server.ts para probar la ruta con una app de Express de mentira (tests/recepcion-clientes.test.ts).
 */
import type express from 'express';
import type { ManifiestoEntrega, SaludAlmacen } from '../lib/build';
import { CABECERA_CLIENTE, clientesDe, registrarCliente, vistaClientes, type EsperadoRecepcion } from '../lib/recepcion-clientes';
import type { AlmacenDurable } from '../lib/durable';

type Deps = {
  exigirMesa: express.RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  /** La cuenta de la sesión (correo), o null. Nunca la que diga el cliente. */
  cuentaDe: (req: express.Request) => string | null;
  manifiesto: () => Promise<ManifiestoEntrega>;
  almacenSalud: () => Promise<SaludAlmacen>;
  /** Solo pruebas: el almacén del registro (si no, el durable del proceso). */
  almacen?: AlmacenDurable;
  /** Solo pruebas: lo que se espera en cada plataforma (si no, sale del manifiesto). */
  esperado?: (m: ManifiestoEntrega) => EsperadoRecepcion;
};

/** Lo esperado según el manifiesto: el SHA web que se sirve. La OTA publicada no la sabe el servidor (desconocido). */
export function esperadoDe(m: ManifiestoEntrega): EsperadoRecepcion {
  return { webSha: m.web.sha };
}

/** La anotación de `x-aura-cliente`: va antes de las rutas, no espera a nada y nunca corta la petición. */
export function montarRecepcion(app: express.Express, d: Pick<Deps, 'cuentaDe' | 'almacen'>) {
  app.use('/api', (req, _res, next) => {
    const h = req.headers[CABECERA_CLIENTE];
    if (h) {
      let cuenta: string | null = null;
      try {
        cuenta = d.cuentaDe(req);
      } catch {
        cuenta = null;
      }
      if (cuenta) void registrarCliente(cuenta, h, d.almacen ? { almacen: d.almacen } : {}).catch(() => undefined);
    }
    next();
  });
}

export function montarRutaBuild(app: express.Express, d: Deps) {
  app.get('/api/build', d.exigirMesa, d.limitar(30), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const cuenta = d.cuentaDe(req);
    const [m, almacen, registro] = await Promise.all([d.manifiesto(), d.almacenSalud(), cuenta ? clientesDe(cuenta, d.almacen) : Promise.resolve(null)]);
    const esperado = (d.esperado ?? esperadoDe)(m);
    const clientes = registro && registro.ok ? vistaClientes(registro.clientes, esperado) : [];
    const recepcion = {
      cuenta: !!cuenta,
      almacen: registro === null ? 'sin-cuenta' : registro.ok ? 'ok' : 'fallo',
      ...(registro && registro.ok === false ? { detalle: registro.detalle } : {}),
      esperado: { web: esperado.webSha || 'desconocido', ota: esperado.ota && Object.keys(esperado.ota).length ? esperado.ota : 'desconocido' },
    };
    return res.json({ ...m, almacen, clientes, recepcion, honesto: true });
  });
}
