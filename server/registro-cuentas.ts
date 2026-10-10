/**
 * «CREAR CUENTA» EN AU-RA, Y ENTRAR YA (José, 10-oct).
 *
 * Hasta hoy la gente normal no podía entrar: el camino principal pedía la app Orden Global o un Genesis ID, el
 * de la wallet fallaba con «pase no válido» y «Crear cuenta» solo dejaba una SOLICITUD que José tenía que
 * aprobar a mano. José: «login y registro que simplemente funcionen, sin abrir ninguna otra app».
 *
 *   POST /api/ultron/cuentas/crear      { nombre, correo, clave }  → la cuenta y la sesión, en el acto
 *   POST /api/ultron/cuentas/confirmar  (sesión) { codigo }        → el correo queda confirmado
 *   POST /api/ultron/cuentas/reenviar   (sesión)                   → otro código al correo
 *
 * Qué se abre: una cuenta PROPIA (server/cuentas.ts, `aprobada_por = 'registro'`) sin acceso en el padrón, y
 * una sesión de MIEMBRO de la comunidad (la marca `comunidad` firmada, seguridad.esDeComunidad): el mismo nivel
 * y los mismos límites que quien entra con Genesis ID sin estar en el padrón (server/nivel.ts). Nunca junta: los
 * niveles altos siguen saliendo SOLO del padrón, y la cola de José queda para quien pide más acceso
 * (/api/ultron/cuentas/solicitar).
 *
 * El correo se confirma DESPUÉS, con un código de 6 cifras por el mismo remitente que los enlaces de contraseña
 * (lib/correo-ses.ts). No bloquea: sin correo configurado se entra igual y la cuenta queda sin confirmar.
 * Quien se adelante a registrar el correo de otro no se queda con él: si el dueño entra con Genesis ID (que
 * prueba el correo) o pide «olvidé mi contraseña» (el enlace le llega a él), la clave de la cuenta sin
 * confirmar deja de valer y sus sesiones se cierran (cuentas.reclamarCuentaSinConfirmar / restablecer).
 *
 * Solo AU-RA: en Dr Electrum estas rutas contestan 404 y una cuenta de aquí no le abre nada (su puerta mira
 * el padrón: seguridad.esDeComunidad es false allí).
 *
 * Errores: un correo que ya tiene cuenta, que es de la junta o del padrón contesta lo MISMO
 * (`CORREO_NO_DISPONIBLE`), sin decir cuál de las tres; las demás respuestas dicen qué arreglar.
 */
import type { Express, RequestHandler } from 'express';
import type { Plataforma } from '../lib/acceso';
import type { Correo, EnvioCorreo } from '../lib/correo-ses';
import { correoValido } from '../lib/correo-ses';
import { anotarDetalle, montarVigilancia } from './registro-entrada';
import { anotarExitoEntrada, anotarFalloEntrada, emitirSesion, esDeComunidad, esperaEntrada, exigirSesion } from './seguridad';
import { problemaDeClave } from './cuentas';
import { plantilla, producto } from './cuentas-rutas';

/** Lo que vive en la base (server/cuentas.ts en producción; uno en memoria en las pruebas). */
export type AlmacenRegistro = {
  disponible: () => boolean;
  crearCuenta: (correo: string, nombre: string, clave: string) => Promise<'creada' | 'existe'>;
  /** Un código nuevo de 6 cifras, o null si se mandó uno hace muy poco. */
  crearCodigo: (correo: string) => Promise<string | null>;
  usarCodigo: (correo: string, codigo: string) => Promise<boolean>;
  correoConfirmado: (correo: string) => Promise<boolean>;
};

export type DepsRegistro = {
  plataforma: Plataforma;
  normalizarCorreo: (c: unknown) => string;
  nombreYRol: (correo: string, nombre?: string) => { nombre: string; rol: string };
  almacen: AlmacenRegistro;
  enviarCorreo: (c: Correo) => Promise<EnvioCorreo>;
  /** ¿Hay con qué mandar correo? Sin eso se entra igual y el código no se pide. */
  correoListo: () => boolean;
  limitar: (n: number, ventanaMs?: number, grupo?: string) => RequestHandler;
  /** ¿Este correo es de la junta (AURA_JUNTA o padrón)? Esos no se registran aquí: entran con su clave. */
  esJunta?: (correo: string) => boolean;
};

/** Cuentas nuevas por conexión cada hora. */
export const MAX_CREAR = 6;
/** Lo que vale un código. */
export const MINUTOS_CODIGO = 30;

export const MENSAJE_NO_DISPONIBLE =
  'No se puede crear una cuenta nueva con ese correo. Si ya tienes cuenta, entra con tu contraseña o usa «¿Olvidaste tu contraseña?».';

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

export function montarRutasRegistro(app: Express, d: DepsRegistro) {
  const prod = producto(d.plataforma);
  const soloAura = d.plataforma !== 'electrum';
  montarVigilancia(app, ['/api/ultron/cuentas/crear', '/api/ultron/cuentas/confirmar', '/api/ultron/cuentas/reenviar']);

  /** Manda el código. 'enviado', 'sin_correo' (no hay con qué) o 'espera' (se mandó uno hace muy poco). */
  async function mandarCodigo(correo: string, nombre: string): Promise<'enviado' | 'sin_correo' | 'espera' | 'fallo'> {
    if (!d.correoListo()) return 'sin_correo';
    const codigo = await d.almacen.crearCodigo(correo);
    if (!codigo) return 'espera';
    const c = plantilla({
      plataforma: d.plataforma,
      saludo: `Hola, ${nombre}:`,
      parrafos: [
        `Tu código para confirmar tu correo en ${prod} es: ${codigo}`,
        `Escríbelo en la app. Vale ${MINUTOS_CODIGO} minutos y sirve una sola vez.`,
        'Si no creaste una cuenta, ignora este mensaje: nadie puede confirmarla sin este código.',
      ],
    });
    const envio = await d.enviarCorreo({ para: correo, asunto: `${prod}: tu código es ${codigo}`, ...c });
    if (!envio.ok) console.error('[registro] no salió el correo con el código:', String(envio.detalle || '').slice(0, 160));
    return envio.ok ? 'enviado' : 'fallo';
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
    // La junta, el padrón y los códigos temporales no se registran: tienen su puerta y su nivel.
    if (!esDeComunidad(correo, d.plataforma) || d.esJunta?.(correo)) {
      anotarDetalle(res, 'correo de la junta o del padrón');
      return res.status(409).json({ ok: false, codigo: 'CORREO_NO_DISPONIBLE', error: MENSAJE_NO_DISPONIBLE });
    }
    let r: 'creada' | 'existe';
    try {
      r = await d.almacen.crearCuenta(correo, nombre, clave);
    } catch (e: any) {
      console.error('[registro] no pude crear la cuenta:', String(e?.message || e).slice(0, 160));
      anotarDetalle(res, 'la base falló');
      return res.status(503).json({ ok: false, codigo: 'SIN_BASE', error: 'No pude crear tu cuenta ahora. Intenta en un momento.' });
    }
    if (r === 'existe') {
      anotarDetalle(res, 'ya tenía cuenta');
      return res.status(409).json({ ok: false, codigo: 'CORREO_NO_DISPONIBLE', error: MENSAJE_NO_DISPONIBLE });
    }
    const { rol } = d.nombreYRol(correo, nombre);
    const s = emitirSesion({ correo, nombre, rol }, { comunidad: true });
    const confirmacion = await mandarCodigo(correo, nombre).catch(() => 'fallo' as const);
    anotarDetalle(res, `cuenta nueva; código ${confirmacion}`);
    console.log(`[registro] cuenta nueva de miembro en ${prod}`);
    return res.json({
      ok: true,
      token: s.token,
      miembro: { nombre, correo, rol, gid: '' },
      // Solo informa a la pantalla: el servidor recalcula el nivel en cada petición (server/nivel.ts).
      nivel: 'miembro',
      correoConfirmado: false,
      // 'enviado': la app pide el código. Si no salió ('sin_correo', 'fallo'), entra igual y lo pide después.
      confirmacion,
      por: 'cuenta',
      message: `Bienvenido a ${prod}, ${nombre}`,
    });
  });

  app.post('/api/ultron/cuentas/confirmar', exigirSesion, d.limitar(20, 15 * 60_000, 'cuentas-confirmar'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!soloAura) return res.status(404).json({ ok: false, codigo: 'SOLO_AURA', error: 'Las cuentas de la comunidad son de AU-RA.' });
    if (!d.almacen.disponible()) return res.status(503).json({ ok: false, codigo: 'SIN_BASE', error: 'Ahora no puedo confirmar tu correo. Intenta en un momento.' });
    const s = (req as any).sesion as { correo: string };
    const correo = d.normalizarCorreo(s.correo);
    res.locals.quienEntrada = correo;
    const ip = String(req.ip || req.socket.remoteAddress || 'x');
    // El freno de la entrada con la cuenta como «confirmar:<correo>»: probar códigos al azar se frena.
    const clave = `confirmar:${correo}`;
    if (esperaEntrada(clave, ip) > 0) return res.status(429).json({ ok: false, codigo: 'LIMITE', error: 'Demasiados intentos. Pide un código nuevo en unos minutos.' });
    const codigo = String(req.body?.codigo ?? '').replace(/\D/g, '');
    if (codigo.length !== 6) return res.status(400).json({ ok: false, codigo: 'CODIGO_FORMATO', error: 'El código tiene 6 cifras.' });
    let ok = false;
    try {
      ok = await d.almacen.usarCodigo(correo, codigo);
    } catch (e: any) {
      console.error('[registro] no pude comprobar el código:', String(e?.message || e).slice(0, 160));
      return res.status(503).json({ ok: false, codigo: 'SIN_BASE', error: 'Ahora no puedo confirmar tu correo. Intenta en un momento.' });
    }
    if (!ok) {
      anotarFalloEntrada(clave, ip);
      return res.status(400).json({ ok: false, codigo: 'CODIGO_INVALIDO', error: 'Ese código no es válido o ya venció. Revisa el último correo o pide otro.' });
    }
    anotarExitoEntrada(clave, ip);
    return res.json({ ok: true, correoConfirmado: true, message: 'Listo: tu correo quedó confirmado.' });
  });

  app.post('/api/ultron/cuentas/reenviar', exigirSesion, d.limitar(6, 15 * 60_000, 'cuentas-reenviar'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!soloAura) return res.status(404).json({ ok: false, codigo: 'SOLO_AURA', error: 'Las cuentas de la comunidad son de AU-RA.' });
    if (!d.almacen.disponible()) return res.status(503).json({ ok: false, codigo: 'SIN_BASE', error: 'Ahora no puedo mandar el código. Intenta en un momento.' });
    const s = (req as any).sesion as { correo: string; nombre: string };
    const correo = d.normalizarCorreo(s.correo);
    res.locals.quienEntrada = correo;
    if (!correo.includes('@')) return res.status(400).json({ ok: false, codigo: 'SIN_CORREO', error: 'Esta sesión no tiene un correo que confirmar.' });
    try {
      if (await d.almacen.correoConfirmado(correo)) return res.json({ ok: true, correoConfirmado: true, message: 'Tu correo ya está confirmado.' });
      const r = await mandarCodigo(correo, s.nombre || correo.split('@')[0]);
      anotarDetalle(res, `código ${r}`);
      if (r === 'espera') return res.status(429).json({ ok: false, codigo: 'ESPERA', error: 'Ya te mandamos un código hace un momento. Espera un minuto antes de pedir otro.' });
      if (r === 'sin_correo') return res.status(503).json({ ok: false, codigo: 'SIN_CORREO', error: 'Ahora no podemos mandar correos. Puedes confirmar después.' });
      if (r === 'fallo') return res.status(502).json({ ok: false, codigo: 'CORREO_FALLO', error: 'El correo no salió. Intenta de nuevo en un momento.' });
      return res.json({ ok: true, confirmacion: 'enviado', message: 'Te mandamos un código nuevo.' });
    } catch (e: any) {
      console.error('[registro] no pude reenviar el código:', String(e?.message || e).slice(0, 160));
      return res.status(503).json({ ok: false, codigo: 'SIN_BASE', error: 'Ahora no puedo mandar el código. Intenta en un momento.' });
    }
  });
}
