/**
 * LAS RUTAS DE LA APP 5.0 (contrato: mobile/src/nucleo/contrato.ts).
 *
 *   GET  /api/perfil            → { perfil: Perfil | null, disponible, durable, supresiones } (+ lo público de la
 *                                  plataforma, que la web ya leía de esta misma ruta: acento, nombre, modos)
 *   PUT  /api/perfil  Partial<Perfil> & { hechoEn?: {campo: hora} } → { perfil, durable, suprimidos,
 *                                  supresiones } (503 `perfil_no_disponible` si el guardado no se pudo leer).
 *                                  El teléfono saca el cambio de su cola solo con `durable: true`.
 *   GET  /api/app/acciones      text/event-stream: cada evento `data: {"id","accion"}`
 *                                  (cabecera opcional `x-aura-aparato: <id del teléfono>`); además,
 *                                  durante la conversación, `event: ambiente` + `data: {"sonido","on"}`
 *                                  (el sonido de fondo de una tarea lenta; lib/acciones-app.ts)
 *   POST /api/app/contexto      { pantalla, chatAbierto?, contactos, borrador? }
 *   POST /api/app/recibo        { id, ok, detalle? }: lo que hizo el teléfono con una acción (lib/recibos-aparato.ts)
 *   POST /api/app/aparato       el latido del aparato: tipo, versión, habilidades y permisos (lib/aparatos.ts)
 *
 * Todo con la sesión de la mesa: el perfil, el canal y el contexto son de un CORREO, y el correo sale
 * de la sesión firmada, nunca del cuerpo.
 */
import type express from 'express';
import { almacenDurable, leerPerfilSeguro, PerfilNoDisponible, validarCambios } from '../lib/perfil-persona';
import { guardarPerfilGobernado, hechoEnValido, supresionesPerfil } from '../lib/olvido';
import { accionesDesde, ambitoApp, aparatoValido, guardarContexto, MAX_CANALES_POR_CUENTA, suscribir, validarContexto } from '../lib/acciones-app';
import type { Sesion } from './seguridad';
import { recibirRecibo } from '../lib/recibos-aparato';
import { anotarEfectoReal } from '../lib/honestidad';
import { anotarLatido, latidoValido } from '../lib/aparatos';

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

/**
 * El interruptor del service worker de la web (IOS02): encendido salvo AURA_SW=0/false/no/apagado. La web
 * lo mira al arrancar; apagado, da de baja su worker y borra sus cachés (src/10-infra/pwa.ts).
 */
export const swEncendido = () => !/^(0|false|no|apagado)$/i.test(String(process.env.AURA_SW ?? '').trim());

export function montarRutasApp(app: express.Express, d: Deps) {
  app.get('/api/pwa', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ sw: swEncendido(), honesto: true });
  });

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
    // `supresiones`: cada respuesta borrada con la hora de su marca (AUR11): el teléfono suelta su copia vieja
    // en vez de reenviarla.
    const supresiones = s ? await supresionesPerfil(s.correo) : undefined;
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ...d.perfilPlataforma(req), perfil, ...(s ? { disponible: !!leido?.ok, durable: almacenDurable(), supresiones } : {}), honesto: true });
  });

  app.put('/api/perfil', d.exigirMesa, d.limitar(30), async (req, res) => {
    const s = d.sesionDe(req);
    if (!s) return sinSesion(res);
    const v = validarCambios(req.body);
    if (v.ok === false) return res.status(400).json({ error: v.error, honesto: true });
    try {
      // Con las marcas de supresión de por medio (lib/olvido.ts): una copia vieja no resucita lo borrado
      // (`suprimidos`), vaciar una respuesta la borra en todos lados y cambiarla la corrige en todos lados.
      // `hechoEn`: cuándo cambió el teléfono cada campo (lo que llega sin hora es una copia vieja).
      const { perfil, durable, suprimidos, supresiones } = await guardarPerfilGobernado(s.correo, v.cambios, { apodo: s.nombre.split(' ')[0], hechoEn: hechoEnValido(req.body?.hechoEn) });
      return res.json({ perfil, durable, suprimidos, supresiones, honesto: true });
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

  /**
   * EL RECIBO DEL APARATO (F02; lib/recibos-aparato.ts): lo que hizo el teléfono con una acción que le mandó AU-RA. Solo
   * con su sesión, del mismo aparato al que salió, por el id de esa acción; el primero manda (idempotente). Con `ok`, el
   * efecto queda en el registro de la cuenta (lib/honestidad.ts): solo así AU-RA puede decir que quedó.
   */
  app.post('/api/app/recibo', d.exigirMesa, d.limitar(120, 60_000, 'app-recibo'), (req, res) => {
    const s = d.sesionDe(req);
    if (!s) return sinSesion(res);
    const r = recibirRecibo(s.correo, req.body || {}, aparatoValido(req.headers['x-aura-aparato']));
    if (r.estado === 'aceptado') {
      if (r.efecto) anotarEfectoReal(s.correo, r.efecto);
      console.log(`[recibos] ${r.tipo}: ${r.ok ? 'hecho' : `falló${r.detalle ? ` (${r.detalle.slice(0, 60)})` : ''}`}`);
      return res.json({ ok: true, estado: r.estado, honesto: true });
    }
    if (r.estado === 'repetido') return res.json({ ok: true, estado: r.estado, honesto: true });
    // Un id que no salió para esta cuenta (o ya venció, o de otro aparato): no se inventa ninguna confirmación.
    return res.status(409).json({ ok: false, estado: r.estado, error: 'Ese recibo no es de una acción que esté esperando.', honesto: true });
  });

  /**
   * EL LATIDO DEL APARATO (lib/aparatos.ts): qué es, qué sabe hacer, qué permisos tiene y su versión. Queda en el registro
   * durable de la cuenta (sobrevive a un despliegue) y el turno lleva una línea con los aparatos en línea.
   */
  app.post('/api/app/aparato', d.exigirMesa, d.limitar(30, 60_000, 'app-aparato'), async (req, res) => {
    const s = d.sesionDe(req);
    if (!s) return sinSesion(res);
    const a = latidoValido(aparatoValido(req.headers['x-aura-aparato']), req.body);
    if (!a) return res.status(400).json({ error: 'Falta el aparato o su forma no vale.', honesto: true });
    const r = await anotarLatido(s.correo, a);
    return res.json({ ok: true, durable: r.guardado, honesto: true });
  });
}
