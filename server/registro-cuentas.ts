/**
 * «CREAR CUENTA» EN AU-RA, CON EL CORREO PROBADO ANTES DE ENTRAR (José, 10-oct; revisión de seguridad del PR #176).
 *
 * Hasta el 10-oct la gente normal no podía entrar: el camino principal pedía la app Orden Global o un Genesis ID y
 * «Crear cuenta» solo dejaba una solicitud para José. La primera versión de esta ruta abría la sesión en el acto…
 * y eso dejaba a cualquiera registrar el correo de OTRA persona (un miembro de la comunidad sin fila en
 * `cuentas.cuenta`, p. ej. uno que entra por Genesis o por el cerebro remoto) y quedarse con una sesión a nombre de
 * ese correo: memoria, hilos y objetivos van por correo. Recuperar la clave después no deshacía ese acceso. Ahora:
 *
 *   POST /api/ultron/cuentas/crear      { nombre, correo, clave }        → la cuenta SIN confirmar y el código al
 *                                                                          correo. NUNCA una sesión.
 *   POST /api/ultron/cuentas/confirmar  { correo, clave, codigo }        → con el código del buzón Y la clave de la
 *                                                                          cuenta: la sesión de miembro.
 *   POST /api/ultron/cuentas/reenviar   { correo, clave }                → otro código (con la clave).
 *
 * y la puerta (/api/ultron/entrar) contesta CORREO_SIN_CONFIRMAR, sin sesión, a una cuenta propia sin confirmar con
 * la clave buena (y le manda el código: server.ts usa `mandarCodigo` de aquí).
 *
 * Por qué el código Y la clave: si alguien registra primero el correo de otra persona con SU clave y el dueño luego
 * confirma con el código de su buzón, la cuenta no puede quedar con la clave del intruso. Registrarse de nuevo con
 * una cuenta propia sin confirmar le pone la clave nueva (cuentas.crearCuentaPropia → 'reabierta'); confirmar exige
 * que la clave coincida con la que está puesta. El dueño, además, puede siempre «olvidé mi contraseña» (el enlace le
 * llega a él) o entrar con Genesis ID, y la clave puesta por otro deja de valer (cuentas.reclamarCuentaSinConfirmar).
 *
 * El código: 6 cifras, 30 minutos, un uso, guardado como huella SHA-256 atada al correo (la comparación es de huellas
 * en la base: no depende de cuántas cifras acierte). Intentos: el freno de la entrada por correo y por conexión
 * (seguridad.esperaEntrada con «confirmar:<correo>») más el tope por conexión de la ruta.
 *
 * El correo sale por Amazon SES (lib/correo-ses.ts `enviarCorreo`), el MISMO remitente que «olvidé mi contraseña».
 * Sin con qué mandar correo no hay cuenta nueva (503 SIN_ENVIO); si el envío falla, la cuenta recién abierta se
 * deshace y se dice (502 CODIGO_NO_ENVIADO): nunca se cae a una sesión sin correo probado.
 *
 * Qué se abre al confirmar: una sesión de MIEMBRO de la comunidad (la marca `comunidad`, seguridad.esDeComunidad), el
 * mismo nivel que quien entra con Genesis ID sin estar en el padrón. Nunca junta: los niveles altos siguen saliendo
 * SOLO del padrón, y la cola de José queda para quien pide más acceso (/api/ultron/cuentas/solicitar).
 *
 * Sin pistas de quién tiene cuenta: «crear» contesta LO MISMO (200, «te mandamos un código») para un correo nuevo,
 * uno con cuenta, uno del padrón o uno de la junta. A quien ya tenía cuenta (no del padrón) le llega un aviso en vez
 * del código. Solo AU-RA: en Dr Electrum estas rutas contestan 404.
 */
import type { Express, RequestHandler } from 'express';
import type { Plataforma } from '../lib/acceso';
import type { Correo, EnvioCorreo } from '../lib/correo-ses';
import { correoValido } from '../lib/correo-ses';
import { anotarDetalle, montarVigilancia } from './registro-entrada';
import { anotarExitoEntrada, anotarFalloEntrada, emitirSesion, esDeComunidad, esperaEntrada } from './seguridad';
import { problemaDeClave } from './cuentas';
import { plantilla, producto } from './cuentas-rutas';

/** Lo que vive en la base (server/cuentas.ts en producción; uno en memoria en las pruebas). */
export type AlmacenRegistro = {
  disponible: () => boolean;
  crearCuenta: (correo: string, nombre: string, clave: string) => Promise<'creada' | 'reabierta' | 'existe'>;
  /** Deshace una cuenta propia sin confirmar (el código no salió). */
  borrarSinConfirmar: (correo: string) => Promise<unknown>;
  /** La clave contra la cuenta (cuentas.entrarConCuenta): 'sin_confirmar' = cuenta propia sin confirmar y clave buena. */
  comprobarClave: (correo: string, clave: string) => Promise<'ok' | 'mal' | 'suspendida' | 'sin_clave' | 'sin_confirmar'>;
  /** Un código nuevo de 6 cifras, o null si se mandó uno hace muy poco. */
  crearCodigo: (correo: string) => Promise<string | null>;
  /** Gasta el código y deja el correo confirmado. */
  usarCodigo: (correo: string, codigo: string) => Promise<boolean>;
  /** El nombre con que se registró (para saludar). */
  nombreDe?: (correo: string) => Promise<string | undefined>;
};

export type DepsRegistro = {
  plataforma: Plataforma;
  normalizarCorreo: (c: unknown) => string;
  nombreYRol: (correo: string, nombre?: string) => { nombre: string; rol: string };
  almacen: AlmacenRegistro;
  enviarCorreo: (c: Correo) => Promise<EnvioCorreo>;
  /** ¿Hay con qué mandar correo? Sin eso no se crean cuentas (el correo no se puede probar). */
  correoListo: () => boolean;
  limitar: (n: number, ventanaMs?: number, grupo?: string) => RequestHandler;
  /** ¿Este correo es de la junta (AURA_JUNTA o padrón)? Esos no se registran aquí: entran con su clave. */
  esJunta?: (correo: string) => boolean;
};

/** Cuentas nuevas por conexión cada hora. */
export const MAX_CREAR = 6;
/** Lo que vale un código. */
export const MINUTOS_CODIGO = 30;

export const MENSAJE_ENVIADO = 'Te mandamos un código de 6 cifras a tu correo. Escríbelo aquí para entrar. Revisa también la carpeta de spam.';
export const MENSAJE_SIN_ENVIO = 'No pudimos enviar el código a tu correo. Entra con Veta Wallet u Orden Global, o inténtalo más tarde.';
export const MENSAJE_CODIGO_MALO = 'El código no es válido o ya venció, o la contraseña no es la de esta cuenta. Revisa el último correo o pide otro.';
export const MENSAJE_SIN_CONFIRMAR = 'Confirma tu correo para entrar: te mandamos un código de 6 cifras.';

export type EnvioCodigo = 'enviado' | 'sin_correo' | 'espera' | 'fallo';

/** El nombre como se va a saludar: una línea, sin caracteres de control. */
export function nombreLimpio(n: unknown): string {
  return String(n ?? '')
    .replace(/[\u0000-\u001f\u007f<>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Qué tiene de malo lo que mandó el formulario, o null si sirve (las mismas reglas que la app). */
export function problemaDeRegistro(nombre: string, correo: string, clave: unknown): { codigo: string; error: string } | null {
  if (nombre.length < 2 || nombre.length > 80) return { codigo: 'NOMBRE', error: 'Escribe tu nombre (entre 2 y 80 letras).' };
  if (!correoValido(correo)) return { codigo: 'CORREO', error: 'Escribe un correo válido.' };
  const p = problemaDeClave(clave, correo);
  if (p) return { codigo: 'CLAVE_DEBIL', error: p };
  return null;
}

export function montarRutasRegistro(app: Express, d: DepsRegistro): { mandarCodigo: (correo: string, nombre: string) => Promise<EnvioCodigo> } {
  const prod = producto(d.plataforma);
  const soloAura = d.plataforma !== 'electrum';
  montarVigilancia(app, ['/api/ultron/cuentas/crear', '/api/ultron/cuentas/confirmar', '/api/ultron/cuentas/reenviar']);
  const enviado = (correo: string) => ({ ok: true, confirmacion: 'enviado', correo, message: MENSAJE_ENVIADO });

  /** Manda el código: 'enviado', 'sin_correo' (no hay con qué), 'espera' (se mandó uno hace muy poco) o 'fallo'. */
  async function mandarCodigo(correo: string, nombre: string): Promise<EnvioCodigo> {
    if (!d.correoListo()) {
      console.error('[registro] no hay con qué mandar el código (faltan AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)');
      return 'sin_correo';
    }
    const codigo = await d.almacen.crearCodigo(correo);
    if (!codigo) return 'espera';
    const c = plantilla({
      plataforma: d.plataforma,
      saludo: `Hola, ${nombre}:`,
      parrafos: [
        `Tu código para entrar a ${prod} es: ${codigo}`,
        `Escríbelo en la app junto con tu contraseña. Vale ${MINUTOS_CODIGO} minutos y sirve una sola vez.`,
        'Si no creaste una cuenta, ignora este mensaje: nadie puede entrar con tu correo sin este código.',
      ],
    });
    const envio = await d.enviarCorreo({ para: correo, asunto: `${prod}: tu código es ${codigo}`, ...c });
    if (!envio.ok) console.error('[registro] no salió el correo con el código:', String(envio.detalle || '').slice(0, 160));
    return envio.ok ? 'enviado' : 'fallo';
  }

  /** Aviso a quien YA tenía cuenta: alguien quiso crear otra con su correo. Si falla, no se dice (sin pistas). */
  async function avisarYaTiene(correo: string) {
    const c = plantilla({
      plataforma: d.plataforma,
      saludo: 'Hola:',
      parrafos: [
        `Alguien quiso crear una cuenta de ${prod} con este correo, pero ya tienes una.`,
        'Si fuiste tú, entra con tu contraseña o usa «¿Olvidaste tu contraseña?». Si no, ignora este mensaje: no cambió nada.',
      ],
    });
    const envio = await d.enviarCorreo({ para: correo, asunto: `${prod}: ya tienes una cuenta`, ...c }).catch(() => ({ ok: false, detalle: 'excepción' }));
    if (!envio.ok) console.error('[registro] no salió el aviso de cuenta existente:', String(envio.detalle || '').slice(0, 160));
  }

  app.post('/api/ultron/cuentas/crear', d.limitar(MAX_CREAR, 60 * 60_000, 'cuentas-crear'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!soloAura) return res.status(404).json({ ok: false, codigo: 'SOLO_AURA', error: 'Las cuentas de la comunidad son de AU-RA.' });
    if (!d.almacen.disponible()) {
      anotarDetalle(res, 'sin base de cuentas');
      return res.status(503).json({ ok: false, codigo: 'SIN_BASE', error: 'Ahora mismo no se pueden crear cuentas. Intenta en un momento.' });
    }
    const nombre = nombreLimpio(req.body?.nombre);
    const correo = d.normalizarCorreo(req.body?.correo);
    const clave = typeof req.body?.clave === 'string' ? req.body.clave : '';
    res.locals.quienEntrada = correo;
    const problema = problemaDeRegistro(nombre, correo, clave);
    if (problema) return res.status(400).json({ ok: false, ...problema });
    // Sin correo no hay cómo probar el buzón: no hay cuenta nueva (y nunca una sesión sin probarlo).
    if (!d.correoListo()) {
      anotarDetalle(res, 'sin envío de correo configurado');
      console.error('[registro] crear cuenta sin envío de correo configurado: se rechaza');
      return res.status(503).json({ ok: false, codigo: 'SIN_ENVIO', error: MENSAJE_SIN_ENVIO });
    }
    // La junta, el padrón y los códigos temporales no se registran: tienen su puerta y su nivel. Misma respuesta.
    if (!esDeComunidad(correo, d.plataforma) || d.esJunta?.(correo)) {
      anotarDetalle(res, 'correo de la junta o del padrón');
      return res.json(enviado(correo));
    }
    let r: 'creada' | 'reabierta' | 'existe';
    try {
      r = await d.almacen.crearCuenta(correo, nombre, clave);
    } catch (e: any) {
      console.error('[registro] no pude crear la cuenta:', String(e?.message || e).slice(0, 160));
      anotarDetalle(res, 'la base falló');
      return res.status(503).json({ ok: false, codigo: 'SIN_BASE', error: 'No pude crear tu cuenta ahora. Intenta en un momento.' });
    }
    if (r === 'existe') {
      anotarDetalle(res, 'ya tenía cuenta: aviso');
      await avisarYaTiene(correo);
      return res.json(enviado(correo));
    }
    const envio = await mandarCodigo(correo, nombre).catch(() => 'fallo' as const);
    anotarDetalle(res, `cuenta ${r}; código ${envio}`);
    if (envio === 'enviado' || envio === 'espera') return res.json(enviado(correo));
    // El código no salió: la cuenta recién abierta se deshace (el correo queda libre para reintentar) y se dice.
    if (r === 'creada') await Promise.resolve(d.almacen.borrarSinConfirmar(correo)).catch(() => {});
    return res.status(envio === 'sin_correo' ? 503 : 502).json({ ok: false, codigo: envio === 'sin_correo' ? 'SIN_ENVIO' : 'CODIGO_NO_ENVIADO', error: MENSAJE_SIN_ENVIO });
  });

  /** El freno de los códigos y las claves de estas rutas: por correo y por conexión. */
  const frenado = (correo: string, ip: string) => esperaEntrada(`confirmar:${correo}`, ip) > 0;

  app.post('/api/ultron/cuentas/confirmar', d.limitar(20, 15 * 60_000, 'cuentas-confirmar'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!soloAura) return res.status(404).json({ ok: false, codigo: 'SOLO_AURA', error: 'Las cuentas de la comunidad son de AU-RA.' });
    if (!d.almacen.disponible()) return res.status(503).json({ ok: false, codigo: 'SIN_BASE', error: 'Ahora no puedo confirmar tu correo. Intenta en un momento.' });
    const correo = d.normalizarCorreo(req.body?.correo);
    const clave = typeof req.body?.clave === 'string' ? req.body.clave : '';
    const codigo = String(req.body?.codigo ?? '').replace(/\D/g, '');
    res.locals.quienEntrada = correo;
    const ip = String(req.ip || req.socket.remoteAddress || 'x');
    if (!correoValido(correo) || !clave) return res.status(400).json({ ok: false, codigo: 'FALTAN_DATOS', error: 'Faltan tu correo y tu contraseña.' });
    if (frenado(correo, ip)) return res.status(429).json({ ok: false, codigo: 'LIMITE', error: 'Demasiados intentos. Espera unos minutos y pide un código nuevo.' });
    if (codigo.length !== 6) return res.status(400).json({ ok: false, codigo: 'CODIGO_FORMATO', error: 'El código tiene 6 cifras.' });
    const fallo = (detalle: string) => {
      anotarFalloEntrada(`confirmar:${correo}`, ip);
      anotarDetalle(res, detalle);
      return res.status(401).json({ ok: false, codigo: 'CODIGO_INVALIDO', error: MENSAJE_CODIGO_MALO });
    };
    try {
      // Primero la clave (sin gastar el código si no es la de la cuenta), después el código.
      const k = await d.almacen.comprobarClave(correo, clave);
      if (k === 'suspendida') return res.status(403).json({ ok: false, codigo: 'SUSPENDIDA', error: 'Esta cuenta está suspendida.' });
      if (k === 'ok') return res.status(409).json({ ok: false, codigo: 'YA_CONFIRMADO', error: 'Tu correo ya está confirmado: entra con tu contraseña.' });
      if (k !== 'sin_confirmar') return fallo('clave que no es la de una cuenta sin confirmar');
      if (!(await d.almacen.usarCodigo(correo, codigo))) return fallo('código malo o vencido');
    } catch (e: any) {
      console.error('[registro] no pude comprobar el código:', String(e?.message || e).slice(0, 160));
      return res.status(503).json({ ok: false, codigo: 'SIN_BASE', error: 'Ahora no puedo confirmar tu correo. Intenta en un momento.' });
    }
    anotarExitoEntrada(`confirmar:${correo}`, ip);
    // Probado el buzón: la sesión de miembro (nunca junta; el padrón o la junta no llegan aquí).
    if (!esDeComunidad(correo, d.plataforma) || d.esJunta?.(correo)) return res.status(403).json({ ok: false, codigo: 'SIN_ACCESO', error: 'Esta cuenta entra por su propia puerta.' });
    const { nombre, rol } = d.nombreYRol(correo, (await Promise.resolve(d.almacen.nombreDe?.(correo)).catch(() => undefined)) || undefined);
    const s = emitirSesion({ correo, nombre, rol }, { comunidad: true });
    anotarDetalle(res, 'correo confirmado: sesión de miembro');
    return res.json({
      ok: true,
      token: s.token,
      miembro: { nombre, correo, rol, gid: '' },
      // Solo informa a la pantalla: el servidor recalcula el nivel en cada petición (server/nivel.ts).
      nivel: 'miembro',
      correoConfirmado: true,
      por: 'cuenta',
      message: `Bienvenido a ${prod}, ${nombre}`,
    });
  });

  app.post('/api/ultron/cuentas/reenviar', d.limitar(6, 15 * 60_000, 'cuentas-reenviar'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!soloAura) return res.status(404).json({ ok: false, codigo: 'SOLO_AURA', error: 'Las cuentas de la comunidad son de AU-RA.' });
    if (!d.almacen.disponible()) return res.status(503).json({ ok: false, codigo: 'SIN_BASE', error: 'Ahora no puedo mandar el código. Intenta en un momento.' });
    const correo = d.normalizarCorreo(req.body?.correo);
    const clave = typeof req.body?.clave === 'string' ? req.body.clave : '';
    res.locals.quienEntrada = correo;
    const ip = String(req.ip || req.socket.remoteAddress || 'x');
    if (!correoValido(correo) || !clave) return res.status(400).json({ ok: false, codigo: 'FALTAN_DATOS', error: 'Faltan tu correo y tu contraseña.' });
    if (frenado(correo, ip)) return res.status(429).json({ ok: false, codigo: 'LIMITE', error: 'Demasiados intentos. Espera unos minutos.' });
    try {
      const k = await d.almacen.comprobarClave(correo, clave);
      if (k === 'ok') return res.status(409).json({ ok: false, codigo: 'YA_CONFIRMADO', error: 'Tu correo ya está confirmado: entra con tu contraseña.' });
      if (k !== 'sin_confirmar') {
        anotarFalloEntrada(`confirmar:${correo}`, ip);
        return res.status(401).json({ ok: false, codigo: 'NO_ENTRA', error: 'Correo o contraseña incorrectos.' });
      }
      const r = await mandarCodigo(correo, d.nombreYRol(correo, (await d.almacen.nombreDe?.(correo)) || undefined).nombre);
      anotarDetalle(res, `código ${r}`);
      if (r === 'espera') return res.status(429).json({ ok: false, codigo: 'ESPERA', error: 'Ya te mandamos un código hace un momento. Espera un minuto antes de pedir otro.' });
      if (r !== 'enviado') return res.status(r === 'sin_correo' ? 503 : 502).json({ ok: false, codigo: r === 'sin_correo' ? 'SIN_ENVIO' : 'CODIGO_NO_ENVIADO', error: MENSAJE_SIN_ENVIO });
      return res.json(enviado(correo));
    } catch (e: any) {
      console.error('[registro] no pude reenviar el código:', String(e?.message || e).slice(0, 160));
      return res.status(503).json({ ok: false, codigo: 'SIN_BASE', error: 'Ahora no puedo mandar el código. Intenta en un momento.' });
    }
  });

  return { mandarCodigo };
}
