/**
 * EL MANIFIESTO DEL BUILD Y LO QUE LLEGÓ A CADA APARATO.
 *
 *   GET /api/build  (sesión de mesa)  → el manifiesto de la entrega (lib/build.ts manifiestoEntrega), la salud del
 *       almacén durable y, para la cuenta de la sesión, `clientes`: qué build corre cada aparato suyo que abrió la app
 *       (lib/recepcion-clientes.ts), con `esperado` y `recibido` (sí | no | desconocido). Cada cuenta ve SOLO lo suyo:
 *       la clave de mesa sin sesión no es una cuenta y recibe `clientes: []` con `recepcion.cuenta: false`.
 *       En el teléfono, lo esperado sale de la ficha de la OTA publicada (lib/ota-publicada.ts: `ota-aura.json` del
 *       Release «aura-ota», que sube .github/workflows/ota.yml), con `motivo` y `explicacion`; solo las publicaciones del
 *       producto de este despliegue (PLATAFORMA: `ultron` en AU-RA, `electrum` en Dr Electrum). La ficha se guarda 10 min
 *       y nunca frena la respuesta: si no se pudo leer, `recepcion.otaFuente: 'no-disponible'` (y, sin ninguna lectura
 *       buena, el teléfono en «desconocido»). Todo `clientes` es evidencia DECLARADA por el cliente, sin firma
 *       (`evidencia: 'declarada'`): diagnóstico de los aparatos propios, no prueba.
 *
 *   Cualquier /api con la cabecera `x-aura-cliente` y una sesión: se anota el build de esa instalación en la cuenta de
 *       la sesión, sin esperar (la petición sigue igual pase lo que pase). Sin cabecera o sin sesión: nada.
 *
 * Se movió aquí desde server.ts para probar la ruta con una app de Express de mentira (tests/recepcion-clientes.test.ts).
 */
import type express from 'express';
import type { ManifiestoEntrega, SaludAlmacen } from '../lib/build';
import { CABECERA_CLIENTE, clientesDe, publicacionesDe, registrarCliente, vistaClientes, type EsperadoRecepcion } from '../lib/recepcion-clientes';
import type { AlmacenDurable } from '../lib/durable';
import { fuenteOtaDelProceso, type AppOta, type EstadoOta } from '../lib/ota-publicada';
import { PLATAFORMA } from '../lib/plataforma';

type Deps = {
  exigirMesa: express.RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  /** La cuenta de la sesión (correo), o null. Nunca la que diga el cliente. */
  cuentaDe: (req: express.Request) => string | null;
  manifiesto: () => Promise<ManifiestoEntrega>;
  almacenSalud: () => Promise<SaludAlmacen>;
  /** Solo pruebas: el almacén del registro (si no, el durable del proceso). */
  almacen?: AlmacenDurable;
  /** Solo pruebas: lo que se espera en cada plataforma (si no, sale del manifiesto y de la ficha de la OTA). */
  esperado?: (m: ManifiestoEntrega, ota: EstadoOta) => EsperadoRecepcion;
  /** La ficha de la OTA publicada (si no, la del proceso: AURA_OTA_MANIFIESTO_URL o el Release «aura-ota»). */
  ota?: { obtener: () => Promise<EstadoOta> };
  /** Solo pruebas: el producto de este despliegue (si no, el del proceso: PLATAFORMA, lib/plataforma.ts). */
  producto?: AppOta;
};

/**
 * Lo esperado: el SHA web que se sirve y las OTA de la ficha DE ESTE PRODUCTO (null si nunca se pudo leer:
 * «desconocido»). La ficha trae `ultron` y `electrum`: AU-RA solo se mide con las de `ultron` y Dr Electrum con las de
 * `electrum`, aunque coincidan sus runtimes (revisión del 5-oct). compararCliente vuelve a filtrar por producto.
 */
export function esperadoDe(m: ManifiestoEntrega, ota?: EstadoOta, producto: AppOta = PLATAFORMA): EsperadoRecepcion {
  return { webSha: m.web.sha, producto, ota: ota?.manifiesto ? publicacionesDe(ota.manifiesto.publicaciones, producto) : null };
}

const EVIDENCIA =
  'declarada: cada aparato dice qué build corre (cabecera x-aura-cliente) y no va firmado; sirve para diagnosticar los aparatos propios, no prueba nada ante terceros';

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
    // La ficha de la OTA nunca lanza ni espera de más (lo guardado; la primera vez, como mucho ESPERA_RUTA_MS).
    const ota = (d.ota ?? fuenteOtaDelProceso()).obtener().catch((): EstadoOta => ({ fuente: 'no-disponible', manifiesto: null, leido: null, detalle: 'error' }));
    const [m, almacen, registro, estadoOta] = await Promise.all([d.manifiesto(), d.almacenSalud(), cuenta ? clientesDe(cuenta, d.almacen) : Promise.resolve(null), ota]);
    const esperado = d.esperado ? d.esperado(m, estadoOta) : esperadoDe(m, estadoOta, d.producto ?? PLATAFORMA);
    const clientes = registro && registro.ok ? vistaClientes(registro.clientes, esperado) : [];
    const recepcion = {
      cuenta: !!cuenta,
      almacen: registro === null ? 'sin-cuenta' : registro.ok ? 'ok' : 'fallo',
      ...(registro && registro.ok === false ? { detalle: registro.detalle } : {}),
      esperado: {
        web: esperado.webSha || 'desconocido',
        ota: esperado.ota
          ? esperado.ota.map((p) => ({ plataforma: p.plataforma, canal: p.canal, runtimeVersion: p.runtimeVersion, tipo: p.tipo, androidUpdateId: p.androidUpdateId, iosUpdateId: p.iosUpdateId, commit: p.commit, publicado: p.publicado }))
          : 'desconocido',
      },
      otaFuente: estadoOta.fuente,
      otaLeida: estadoOta.leido,
      ...(estadoOta.fuente === 'no-disponible' && estadoOta.detalle ? { otaDetalle: estadoOta.detalle } : {}),
      evidencia: EVIDENCIA,
    };
    return res.json({ ...m, almacen, clientes, recepcion, honesto: true });
  });
}
