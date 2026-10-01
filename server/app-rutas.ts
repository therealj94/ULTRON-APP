/**
 * LAS RUTAS DE LA APP 5.0 (contrato: mobile/src/nucleo/contrato.ts).
 *
 *   GET  /api/perfil            → { perfil: Perfil | null, disponible, durable } (+ lo público de la
 *                                  plataforma, que la web ya leía de esta misma ruta: acento, nombre, modos)
 *   PUT  /api/perfil  Partial<Perfil>  → { perfil, durable } (503 `perfil_no_disponible` si el guardado
 *                                  no se pudo leer). El teléfono saca el cambio de su cola solo con `durable: true`.
 *   GET  /api/app/acciones      text/event-stream: cada evento `data: {"id","accion"}`
 *                                  (cabecera opcional `x-aura-aparato: <id del teléfono>`); además,
 *                                  durante la conversación, `event: ambiente` + `data: {"sonido","on"}`
 *                                  (el sonido de fondo de una tarea lenta; lib/acciones-app.ts)
 *   POST /api/app/contexto      { pantalla, chatAbierto?, contactos, borrador? }
 *
 * Todo con la sesión de la mesa: el perfil, el canal y el contexto son de un CORREO, y el correo sale
 * de la sesión firmada, nunca del cuerpo.
 */
import type express from 'express';
import { actualizarPerfil, almacenDurable, leerPerfilSeguro, PerfilNoDisponible, validarCambios } from '../lib/perfil-persona';
import { accionesDesde, ambitoApp, aparatoValido, guardarContexto, MAX_CANALES_POR_CUENTA, suscribir, validarContexto } from '../lib/acciones-app';
import type { Sesion } from './seguridad';

/** Teléfonos (o pestañas) escuchando a la vez por cuenta; al pasarlo se desaloja el canal más viejo. */
export { MAX_CANALES_POR_CUENTA };
/** Cada cuánto se manda un latido por el canal (los proxies cortan un stream mudo al minuto). */
export const LATIDO_MS = 20_000;
/**
 * Lo más que vive un canal. Al cumplirse se cierra y el teléfono vuelve solo a los 3 s (`retry`),
 * entrando otra vez con su sesión: un canal no puede quedar abierto para siempre con lo que valía
 * al abrirse.
 */
export const VIDA_CANAL_MS = 30 * 60_000;

type Deps = {
  exigirMesa: express.RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  sesionDe: (req: express.Request) => Sesion | null;
  tokenDe: (req: express.Request) => string;
  /**
   * Lo público de la plataforma (id, acento, modos…): lo que ya devolvía GET /api/perfil. Recibe la
   * petición porque depende de quién pregunta: a un miembro de la comunidad se le describe el cerebro
   * con que habla él (server/nivel.ts), no el de la junta.
   */
  perfilPlataforma: (req: express.Request) => Record<string, unknown>;
  latidoMs?: number;
  vidaMs?: number;
};

const sinSesion = (res: express.Response) => res.status(401).json({ error: 'Entra con tu sesión.', code: 'sesion_requerida', honesto: true });

export function montarRutasApp(app: express.Express, d: Deps) {
  /*
   * GET /api/perfil era (y sigue siendo, para la web) la ficha pública de la plataforma. Ahora además
   * trae el perfil de la persona si viene con sesión. Un token que no vale es un 401 —el teléfono
   * tiene que saber que debe entrar otra vez—; sin token, la ficha pública con `perfil: null`.
   */
  app.get('/api/perfil', d.limitar(60), async (req, res) => {
    const s = d.sesionDe(req);
    if (!s && d.tokenDe(req)) return sinSesion(res);
    // `disponible: false` = no se pudo leer lo guardado (S3 caído): el teléfono no debe tomar ese
    // `perfil: null` como «no tiene perfil». `durable`: si este servicio guarda de verdad (S3 o disco
    // declarado persistente); sin eso, lo que tiene puede perderse en un redespliegue.
    const leido = s ? await leerPerfilSeguro(s.correo) : null;
    const perfil = leido && leido.ok ? leido.perfil : null;
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ...d.perfilPlataforma(req), perfil, ...(s ? { disponible: !!leido?.ok, durable: almacenDurable() } : {}), honesto: true });
  });

  app.put('/api/perfil', d.exigirMesa, d.limitar(30), async (req, res) => {
    const s = d.sesionDe(req);
    if (!s) return sinSesion(res);
    const v = validarCambios(req.body);
    if (v.ok === false) return res.status(400).json({ error: v.error, honesto: true });
    try {
      const { perfil, durable } = await actualizarPerfil(s.correo, v.cambios, { apodo: s.nombre.split(' ')[0] });
      return res.json({ perfil, durable, honesto: true });
    } catch (e) {
      // El guardado no se pudo leer (S3 caído tras un redespliegue): no se pisa lo que no se vio. El
      // teléfono conserva sus cambios y los vuelve a mandar.
      if (e instanceof PerfilNoDisponible) {
        return res.status(503).json({ error: 'Ahora mismo no pude leer tu perfil guardado. Tus cambios siguen en el teléfono; lo intento de nuevo en un momento.', code: 'perfil_no_disponible', honesto: true });
      }
      // Express 4 no atrapa el rechazo de un handler async: sin esto la petición quedaba colgada.
      console.warn('[perfil] no pude guardar', String((e as Error)?.message || e).slice(0, 120));
      return res.status(500).json({ error: 'No pude guardar tu perfil ahora.', honesto: true });
    }
  });

  /**
   * El canal de acciones: la app lo deja abierto y AURA le manda por aquí lo que tiene que hacer. Un
   * canal por teléfono (`x-aura-aparato`): las acciones de un turno van solo al aparato que lo hizo;
   * sin aparato, a todos los de la cuenta. Latido cada 20 s como comentario SSE (`: latido`), que
   * ningún lector confunde con una acción.
   *
   * La sesión se vuelve a mirar en CADA latido: si se cerró (salir, cerrar sesión en todos lados) o
   * la contraseña cambió, el canal se corta ahí (antes seguía recibiendo acciones hasta que el
   * teléfono lo soltara). Y ningún canal pasa de VIDA_CANAL_MS.
   */
  app.get('/api/app/acciones', d.exigirMesa, d.limitar(30, 60_000, 'app-acciones'), (req, res) => {
    const s = d.sesionDe(req);
    if (!s) return sinSesion(res);
    const aparato = aparatoValido(req.headers['x-aura-aparato']);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    req.socket.setNoDelay?.(true);
    req.socket.setTimeout?.(0);
    res.flushHeaders?.();
    const escribir = (t: string) => {
      if (!res.writableEnded && !res.destroyed) res.write(t);
    };
    // Si se corta, el teléfono vuelve a los 3 s (EventSource lo hace solo con `retry`).
    escribir('retry: 3000\n: canal abierto\n\n');
    let cerrado = false;
    let latido: ReturnType<typeof setInterval> | undefined;
    let vida: ReturnType<typeof setTimeout> | undefined;
    let soltar: () => void = () => {};
    // Cierra el canal (una vez). Con motivo, se avisa como comentario SSE antes de cortar.
    const cerrar = (motivo?: 'sesion' | 'renovar' | 'reemplazado') => {
      if (cerrado) return;
      cerrado = true;
      clearInterval(latido);
      clearTimeout(vida);
      soltar();
      if (motivo) escribir(`: fin ${motivo}\n\n`);
      if (!res.writableEnded) res.end();
    };
    // Volvió tras un corte diciendo lo último que recibió: se le repite lo que vino después, si es
    // reciente (el teléfono deduplica por id; lo viejo no se repite). La repetición va ANTES de
    // suscribirse y las dos cosas corren en el mismo tramo síncrono (sin await en medio): ninguna acción
    // nueva puede colarse entre medio, así que el teléfono recibe lo atrasado y después lo nuevo, en orden.
    for (const e of accionesDesde(s.correo, aparato, req.headers['last-event-id'])) escribir(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`);
    soltar = suscribir(
      s.correo,
      (e) => {
        if (cerrado || res.writableEnded || res.destroyed) throw new Error('canal cerrado');
        escribir(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`);
      },
      // El mismo aparato que vuelve reemplaza a su canal viejo; al tope se desaloja el más viejo.
      // `alEvento`: lo que no es acción (el sonido de fondo de la conversación, `event: ambiente`), sin
      // `id` para no mover el Last-Event-ID de las acciones.
      {
        aparato,
        max: MAX_CANALES_POR_CUENTA,
        desalojar: () => cerrar('reemplazado'),
        alEvento: (nombre, datos) => {
          if (cerrado || res.writableEnded || res.destroyed) throw new Error('canal cerrado');
          escribir(`event: ${nombre}\ndata: ${JSON.stringify(datos)}\n\n`);
        },
      }
    );
    latido = setInterval(() => {
      if (!d.sesionDe(req)) return cerrar('sesion');
      escribir(': latido\n\n');
    }, d.latidoMs ?? LATIDO_MS);
    vida = setTimeout(() => cerrar('renovar'), d.vidaMs ?? VIDA_CANAL_MS);
    res.on('close', () => cerrar());
    res.on('error', () => cerrar());
  });

  /** Dónde está la persona y a quién puede escribirle. Se guarda unos minutos, solo en memoria. */
  app.post('/api/app/contexto', d.exigirMesa, d.limitar(120, 60_000, 'app-contexto'), (req, res) => {
    const s = d.sesionDe(req);
    if (!s) return sinSesion(res);
    const v = validarContexto(req.body);
    if (v.ok === false) return res.status(400).json({ error: v.error, honesto: true });
    // Del aparato que lo manda: dos teléfonos de la misma persona no se pisan el contexto.
    guardarContexto(ambitoApp(s.correo, req.headers['x-aura-aparato']), v.contexto);
    return res.json({ ok: true, contactos: v.contexto.contactos.length, honesto: true });
  });
}
