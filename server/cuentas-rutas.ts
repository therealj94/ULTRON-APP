/**
 * LAS RUTAS DE CUENTAS, IGUALES EN AU-RA FP Y EN DR ELECTRUM.
 *
 *   POST /api/ultron/clave/olvide              { correo }            → manda un enlace para poner clave nueva
 *   GET  /api/ultron/clave/enlace?token=        —                    → ¿el enlace sirve todavía?
 *   POST /api/ultron/clave/restablecer         { token, clave }      → pone la clave con el enlace
 *   POST /api/ultron/clave/cambiar  (sesión)   { actual, nueva }     → cambia la clave sabiendo la actual
 *   POST /api/ultron/cuentas/solicitar         { nombre, correo, motivo } → pide acceso
 *   GET  /api/ultron/cuentas/solicitudes        (aprobador)          → la lista para aprobar
 *   POST /api/ultron/cuentas/solicitudes/:id    (aprobador) { decision, nivel } → aprueba o rechaza
 *
 * Dos reglas atraviesan todo:
 *  · Las respuestas públicas no delatan quién tiene cuenta: «olvidé» y «solicitar» contestan lo mismo
 *    exista o no el correo.
 *  · Los enlaces apuntan SIEMPRE a la dirección pública de la plataforma, nunca a la que dice la
 *    cabecera Host de la petición (si no, cualquiera podría pedir un enlace que apunte a su sitio).
 */
import type { Express, Request, Response } from 'express';
import { enviarCorreo, correoValido } from '../lib/correo-ses';
import { identificar, personaPorCorreoExacto, puedeEntrar, type Nivel, type Plataforma } from '../lib/acceso';
import { anotarExitoEntrada, anotarFalloEntrada, emitirSesion, esperaEntrada, exigirSesion, limitar, sesionDe } from './seguridad';
import {
  NIVELES,
  crearEnlace,
  crearSolicitud,
  cuentaDe,
  cuentasDisponibles,
  decidirSolicitud,
  enlaceVigente,
  entrarConCuenta,
  fijarClave,
  listarSolicitudes,
  problemaDeClave,
  puedeRecuperar,
  solicitudesPendientes,
  usarEnlace,
} from './cuentas';

export type DepsCuentas = {
  plataforma: Plataforma;
  normalizarCorreo: (c: unknown) => string;
  /** La clave contra el cerebro remoto: true si abre, false si no, null si no se pudo preguntar. */
  claveRemotaAbre: (correo: string, clave: string) => Promise<boolean | null>;
  nombreYRol: (correo: string, nombreCuenta?: string) => { nombre: string; rol: string };
};

export const NOMBRE_NIVEL: Record<Nivel, string> = { lee: 'Consulta', escribe: 'Trabajo', mando: 'Mando' };

export function producto(p: Plataforma) {
  return p === 'electrum' ? 'Dr Electrum FP' : 'AU-RA FP';
}

/** La dirección pública de la plataforma, para los enlaces de los correos. */
export function origenPublico(p: Plataforma): string {
  const env = String(process.env.CUENTAS_ORIGEN || (p === 'electrum' ? process.env.PUBLIC_BASE : '') || '').trim();
  const base = env || (p === 'electrum' ? 'https://ultron-looi-desk.onrender.com' : 'https://aura-fp.onrender.com');
  return base.replace(/\/+$/, '');
}

/** Quién aprueba las cuentas. Por defecto José; `CUENTAS_APROBADOR` acepta varios, separados por comas. */
export function aprobadores(): string[] {
  const raw = String(process.env.CUENTAS_APROBADOR || 'j.ordonez@ordenglobal.org');
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Un correo sencillo: texto plano y la misma cosa en HTML con un botón. */
export function plantilla(o: { plataforma: Plataforma; saludo: string; parrafos: string[]; boton?: { texto: string; url: string }; pie?: string }) {
  const prod = producto(o.plataforma);
  const texto = [o.saludo, '', ...o.parrafos.flatMap((p) => [p, '']), ...(o.boton ? [`${o.boton.texto}: ${o.boton.url}`, ''] : []), o.pie || `— ${prod} · Orden Global`].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f4f1ea;font-family:Arial,Helvetica,sans-serif;color:#1c2730">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;border:1px solid #e6e1d6">
<tr><td style="padding:26px 28px 8px"><div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#b8740c;font-weight:bold">${esc(prod)}</div></td></tr>
<tr><td style="padding:6px 28px 4px;font-size:16px;line-height:1.55">
<p style="margin:0 0 14px">${esc(o.saludo)}</p>
${o.parrafos.map((p) => `<p style="margin:0 0 14px">${esc(p)}</p>`).join('\n')}
${o.boton ? `<p style="margin:22px 0"><a href="${esc(o.boton.url)}" style="display:inline-block;background:#1c2730;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold">${esc(o.boton.texto)}</a></p>
<p style="margin:0 0 14px;font-size:12px;color:#6b7780">Si el botón no abre, copiá esta dirección en el navegador:<br><span style="word-break:break-all">${esc(o.boton.url)}</span></p>` : ''}
</td></tr>
<tr><td style="padding:10px 28px 24px;font-size:12px;color:#8a949b">${esc(o.pie || `${prod} · Orden Global`)}</td></tr>
</table></td></tr></table></body></html>`;
  return { texto, html };
}

function sinBase(res: Response) {
  return res.status(503).json({ ok: false, error: 'Las cuentas no están disponibles en este momento (sin base de datos).', code: 'cuentas_no_disponibles' });
}

const RESPUESTA_OLVIDE =
  'Si ese correo tiene acceso, te llegará en unos minutos un enlace para poner una contraseña nueva. Revisá también la carpeta de spam. El enlace vale 30 minutos.';
const RESPUESTA_SOLICITUD = 'Recibimos tu solicitud. Cuando sea revisada te escribiremos a ese correo.';

export function montarRutasCuentas(app: Express, d: DepsCuentas) {
  const prod = producto(d.plataforma);
  const origen = () => origenPublico(d.plataforma);

  function esAprobador(req: Request): string | null {
    const s = sesionDe(req);
    if (!s) return null;
    const correo = d.normalizarCorreo(s.correo);
    return aprobadores().includes(correo) ? correo : null;
  }

  /* ---------------------------------------------------------------- olvidé mi contraseña */
  app.post('/api/ultron/clave/olvide', limitar(5, 15 * 60_000, 'clave-olvide'), async (req, res) => {
    if (!cuentasDisponibles()) return sinBase(res);
    const correo = d.normalizarCorreo(req.body?.correo);
    if (!correoValido(correo)) return res.status(400).json({ ok: false, error: 'Escribí un correo válido.' });
    try {
      if (await puedeRecuperar(correo)) {
        const token = await crearEnlace(correo, 'restablecer', 30);
        if (token) {
          const { nombre } = d.nombreYRol(correo, (await cuentaDe(correo))?.nombre);
          const url = `${origen()}/?restablecer=${token}`;
          const c = plantilla({
            plataforma: d.plataforma,
            saludo: `Hola, ${nombre}:`,
            parrafos: [
              `Alguien pidió poner una contraseña nueva para entrar a ${prod} con este correo.`,
              'Si fuiste vos, tocá el botón. El enlace sirve una sola vez y vence en 30 minutos.',
              'Si no fuiste vos, ignorá este mensaje: tu contraseña actual sigue igual.',
            ],
            boton: { texto: 'Poner contraseña nueva', url },
          });
          const envio = await enviarCorreo({ para: correo, asunto: `${prod}: contraseña nueva`, ...c });
          if (!envio.ok) console.error('[cuentas] no salió el correo de clave:', envio.detalle);
        }
      }
    } catch (e: any) {
      console.error('[cuentas] olvidé:', String(e?.message || e).slice(0, 200));
    }
    return res.json({ ok: true, message: RESPUESTA_OLVIDE });
  });

  /* ---------------------------------------------------------------- el enlace */
  app.get('/api/ultron/clave/enlace', limitar(30), async (req, res) => {
    if (!cuentasDisponibles()) return sinBase(res);
    const e = await enlaceVigente(String(req.query.token || '')).catch(() => null);
    if (!e) return res.status(410).json({ ok: false, error: 'El enlace ya se usó o venció. Pedí uno nuevo desde «¿Olvidaste tu contraseña?».', code: 'enlace_vencido' });
    return res.json({ ok: true, correo: e.correo, tipo: e.tipo });
  });

  app.post('/api/ultron/clave/restablecer', limitar(10, 15 * 60_000, 'clave-restablecer'), async (req, res) => {
    if (!cuentasDisponibles()) return sinBase(res);
    const clave = String(req.body?.clave ?? '');
    // Se valida la clave ANTES de gastar el enlace: una clave corta no puede quemar el enlace.
    const previo = await enlaceVigente(String(req.body?.token || '')).catch(() => null);
    if (!previo) return res.status(410).json({ ok: false, error: 'El enlace ya se usó o venció. Pedí uno nuevo desde «¿Olvidaste tu contraseña?».', code: 'enlace_vencido' });
    const problema = problemaDeClave(clave, previo.correo);
    if (problema) return res.status(400).json({ ok: false, error: problema, code: 'clave_debil' });
    const e = await usarEnlace(String(req.body?.token || ''));
    if (!e) return res.status(410).json({ ok: false, error: 'El enlace ya se usó o venció.', code: 'enlace_vencido' });
    const { nombre, rol } = d.nombreYRol(e.correo, (await cuentaDe(e.correo))?.nombre);
    await fijarClave(e.correo, clave, nombre);
    // La clave queda guardada igual, pero la sesión solo se abre si esta plataforma le corresponde.
    const s = puedeEntrar(identificar({ correo: e.correo }), d.plataforma) ? emitirSesion({ correo: e.correo, nombre, rol }) : null;
    const aviso = plantilla({
      plataforma: d.plataforma,
      saludo: `Hola, ${nombre}:`,
      parrafos: [
        `Tu contraseña de ${prod} se cambió recién. Las sesiones que tenías abiertas en otros aparatos se cerraron.`,
        'Si no fuiste vos, avisá de inmediato a la administración de Orden Global.',
      ],
    });
    void enviarCorreo({ para: e.correo, asunto: `${prod}: tu contraseña cambió`, ...aviso });
    if (!s) return res.json({ ok: true, token: null, message: `Tu contraseña quedó guardada, pero tu cuenta no tiene acceso a ${prod}.` });
    return res.json({ ok: true, token: s.token, miembro: { nombre, correo: e.correo, rol }, message: 'Listo: tu contraseña quedó guardada.' });
  });

  /* ---------------------------------------------------------------- cambiar sabiendo la actual */
  app.post('/api/ultron/clave/cambiar', exigirSesion, limitar(8, 15 * 60_000, 'clave-cambiar'), async (req, res) => {
    if (!cuentasDisponibles()) return sinBase(res);
    const s = (req as any).sesion as { correo: string; nombre: string; rol: string };
    const correo = d.normalizarCorreo(s.correo);
    const actual = String(req.body?.actual ?? '');
    const nueva = String(req.body?.nueva ?? '');
    const ip = String(req.ip || req.socket.remoteAddress || 'x');
    const espera = esperaEntrada(correo, ip);
    if (espera > 0) return res.status(429).json({ ok: false, error: 'Demasiados intentos. Probá de nuevo en unos minutos.', code: 'demasiados_intentos' });
    const problema = problemaDeClave(nueva, correo);
    if (problema) return res.status(400).json({ ok: false, error: problema, code: 'clave_debil' });
    if (nueva === actual) return res.status(400).json({ ok: false, error: 'La contraseña nueva tiene que ser distinta de la actual.', code: 'clave_igual' });
    let abre: boolean | null;
    const local = await entrarConCuenta(correo, actual);
    if (local === 'sin_clave') abre = await d.claveRemotaAbre(correo, actual);
    else abre = local === 'ok';
    if (abre === null) return res.status(502).json({ ok: false, error: 'No pude comprobar tu contraseña actual ahora mismo. Probá en un momento.' });
    if (!abre) {
      anotarFalloEntrada(correo, ip);
      return res.status(401).json({ ok: false, error: 'La contraseña actual no es correcta.', code: 'clave_actual_mal' });
    }
    anotarExitoEntrada(correo, ip);
    await fijarClave(correo, nueva, s.nombre);
    // La sesión con la que se hizo el cambio se renueva: las demás quedan cerradas.
    const nuevaSesion = emitirSesion({ correo: s.correo, nombre: s.nombre, rol: s.rol });
    const aviso = plantilla({
      plataforma: d.plataforma,
      saludo: `Hola, ${s.nombre}:`,
      parrafos: [
        `Tu contraseña de ${prod} se cambió desde tu sesión. Las sesiones abiertas en otros aparatos se cerraron.`,
        'Si no fuiste vos, avisá de inmediato a la administración de Orden Global.',
      ],
    });
    void enviarCorreo({ para: correo, asunto: `${prod}: tu contraseña cambió`, ...aviso });
    return res.json({ ok: true, token: nuevaSesion.token, message: 'Contraseña cambiada. Tus otras sesiones se cerraron.' });
  });

  /* ---------------------------------------------------------------- pedir acceso */
  app.post('/api/ultron/cuentas/solicitar', limitar(5, 30 * 60_000, 'cuentas-solicitar'), async (req, res) => {
    if (!cuentasDisponibles()) return sinBase(res);
    const nombre = String(req.body?.nombre || '').replace(/\s+/g, ' ').trim();
    // Con los mismos alias que la entrada: si no, la clave quedaría guardada bajo un correo que la
    // entrada nunca va a buscar.
    const correo = d.normalizarCorreo(req.body?.correo);
    const motivo = String(req.body?.motivo || '').trim().slice(0, 600);
    if (nombre.length < 3 || nombre.length > 80) return res.status(400).json({ ok: false, error: 'Escribí tu nombre completo.' });
    if (!correoValido(correo)) return res.status(400).json({ ok: false, error: 'Escribí un correo válido.' });
    if (motivo.length < 5) return res.status(400).json({ ok: false, error: 'Contanos en una línea para qué necesitás el acceso.' });
    try {
      const s = await crearSolicitud({ nombre, correo, motivo, plataforma: d.plataforma });
      if (s) {
        const url = `${origen()}/?solicitudes=1`;
        for (const para of aprobadores()) {
          const c = plantilla({
            plataforma: d.plataforma,
            saludo: 'Hola:',
            parrafos: [
              `${nombre} (${correo}) pidió acceso a ${prod}.`,
              `Motivo: ${motivo}`,
              'Entrá con tu sesión para aprobarla con el nivel que corresponda, o rechazarla. Nadie entra hasta que decidas.',
            ],
            boton: { texto: 'Revisar la solicitud', url },
          });
          const envio = await enviarCorreo({ para, asunto: `${prod}: ${nombre} pide acceso`, responderA: correo, ...c });
          if (!envio.ok) console.error('[cuentas] no salió el aviso al aprobador:', envio.detalle);
        }
        const acuse = plantilla({
          plataforma: d.plataforma,
          saludo: `Hola, ${nombre}:`,
          parrafos: [
            `Recibimos tu solicitud de acceso a ${prod}.`,
            'La administración de Orden Global la va a revisar. Si la aprueba, te llegará otro correo con un enlace para crear tu contraseña.',
          ],
        });
        void enviarCorreo({ para: correo, asunto: `${prod}: recibimos tu solicitud`, ...acuse });
      }
    } catch (e: any) {
      console.error('[cuentas] solicitar:', String(e?.message || e).slice(0, 200));
      return res.status(500).json({ ok: false, error: 'No pude guardar la solicitud. Probá en un momento.' });
    }
    return res.json({ ok: true, message: RESPUESTA_SOLICITUD });
  });

  /* ---------------------------------------------------------------- aprobar */
  app.get('/api/ultron/cuentas/solicitudes', limitar(60), async (req, res) => {
    if (!cuentasDisponibles()) return sinBase(res);
    if (!sesionDe(req)) return res.status(401).json({ ok: false, error: 'sesión requerida', code: 'sesion_requerida' });
    if (!esAprobador(req)) return res.status(403).json({ ok: false, error: 'Las solicitudes las revisa solo el aprobador de cuentas.', code: 'no_aprobador' });
    const [lista, pendientes] = await Promise.all([listarSolicitudes(d.plataforma), solicitudesPendientes(d.plataforma)]);
    const conAviso = lista.map((s) => {
      const persona = personaPorCorreoExacto(s.correo);
      return { ...s, yaEsDe: persona ? persona.nombre || persona.id : null };
    });
    return res.json({ ok: true, pendientes, solicitudes: conAviso, niveles: NIVELES.map((n) => ({ id: n, nombre: NOMBRE_NIVEL[n] })) });
  });

  app.post('/api/ultron/cuentas/solicitudes/:id', limitar(30), async (req, res) => {
    if (!cuentasDisponibles()) return sinBase(res);
    if (!sesionDe(req)) return res.status(401).json({ ok: false, error: 'sesión requerida', code: 'sesion_requerida' });
    const por = esAprobador(req);
    if (!por) return res.status(403).json({ ok: false, error: 'Las solicitudes las decide solo el aprobador de cuentas.', code: 'no_aprobador' });
    const id = Number(req.params.id);
    const decision = req.body?.decision === 'aprobar' ? 'aprobar' : req.body?.decision === 'rechazar' ? 'rechazar' : null;
    const nivel = NIVELES.includes(req.body?.nivel) ? (req.body.nivel as Nivel) : undefined;
    if (!Number.isInteger(id) || id <= 0 || !decision) return res.status(400).json({ ok: false, error: 'Falta la decisión (aprobar o rechazar).' });
    if (decision === 'aprobar' && !nivel) return res.status(400).json({ ok: false, error: 'Elegí el nivel de acceso.' });
    const r = await decidirSolicitud(id, decision, { nivel, por, nota: String(req.body?.nota || '').slice(0, 300) });
    if (!r) return res.status(409).json({ ok: false, error: 'Esa solicitud ya estaba decidida.', code: 'ya_decidida' });
    const { solicitud } = r;
    let correoEnviado = true;
    if (decision === 'aprobar') {
      const c = r.enlace
        ? plantilla({
            plataforma: d.plataforma,
            saludo: `Hola, ${solicitud.nombre}:`,
            parrafos: [
              `Tu acceso a ${prod} fue aprobado, con nivel ${NOMBRE_NIVEL[nivel!]}.`,
              'Para entrar, creá tu contraseña con el botón. El enlace sirve una sola vez y vence en 72 horas.',
            ],
            boton: { texto: 'Crear mi contraseña', url: `${origen()}/?activar=${r.enlace}` },
          })
        : plantilla({
            plataforma: d.plataforma,
            saludo: `Hola, ${solicitud.nombre}:`,
            parrafos: [
              `Tu acceso a ${prod} fue aprobado, con nivel ${NOMBRE_NIVEL[nivel!]}.`,
              'Ya podés entrar con tu correo y la contraseña que usás en Orden Global.',
            ],
            boton: { texto: `Abrir ${prod}`, url: origen() },
          });
      const envio = await enviarCorreo({ para: solicitud.correo, asunto: `${prod}: acceso aprobado`, ...c });
      correoEnviado = envio.ok;
      if (!envio.ok) console.error('[cuentas] no salió el correo de aprobación:', envio.detalle);
    } else {
      const c = plantilla({
        plataforma: d.plataforma,
        saludo: `Hola, ${solicitud.nombre}:`,
        parrafos: [`Revisamos tu solicitud de acceso a ${prod} y por ahora no fue aprobada.`, 'Si creés que es un error, respondé a este correo.'],
      });
      const envio = await enviarCorreo({ para: solicitud.correo, asunto: `${prod}: sobre tu solicitud`, responderA: aprobadores()[0], ...c });
      correoEnviado = envio.ok;
    }
    return res.json({
      ok: true,
      solicitud,
      correoEnviado,
      message:
        decision === 'aprobar'
          ? correoEnviado
            ? `Aprobada. ${solicitud.nombre} recibirá un correo para ${r.enlace ? 'crear su contraseña' : 'entrar'}.`
            : 'Aprobada, pero el correo no salió: avisale por otro medio que pida «¿Olvidaste tu contraseña?».'
          : 'Rechazada. Se le avisó por correo.',
    });
  });
}
