/**
 * LAS RUTAS DE LOS AVISOS AL TELÉFONO (Firebase Cloud Messaging; la lógica vive en lib/push.ts).
 *
 *   POST /api/push/registrar {token, aparato?, plataforma: 'android', app: 'aura'} → { ok, dispositivos, configurado }
 *   POST /api/push/quitar    {token?, aparato?}                                    → { ok, quitados }
 *   POST /api/push/probar                                                          → { ok, enviados, fallidos }
 *        (un `mensaje` de prueba a los teléfonos de la propia sesión; solo la junta)
 *   GET  /api/push/estado                                                          → { configurado, dispositivos, web }
 *   GET  /api/push/web/clave                                   → { publica } (la llave VAPID; null sin configurar)
 *   POST /api/push/web/suscribir {suscripcion, aparato?}       → { ok, suscripciones }   (la web instalada: iPhone)
 *   POST /api/push/web/quitar    {endpoint?, aparato?}         → { ok, quitados }
 *
 * La persona sale SIEMPRE de la sesión firmada (sesionDe), nunca del cuerpo: nadie registra su teléfono
 * en la cuenta de otro, ni quita, ni prueba, ni cuenta los teléfonos ajenos. Los tokens no vuelven en
 * ninguna respuesta ni se escriben en un log.
 *
 * Los atajos para el resto del servidor (iniciativa, círculo, computadora) se re-exportan de aquí:
 * llamarPorPush, avisarPush, proponerPorPush, recordarPorPush, avisarComputadoraPorPush, enviarPush.
 */
import type express from 'express';
import { exigirMesa as exigirMesaSeguridad, limitar as limitarSeguridad, sesionDe as sesionDeSeguridad } from './seguridad';
import { nivelDeCorreo } from './nivel';
import { aparatoValido } from '../lib/acciones-app';
import { avisarPush, claveRelevoValida, correoDeRef, dispositivosDe, enviarPush, PushNoDisponible, pushConfigurado, quitarToken, refRelevo, registrarToken, tokenValido } from '../lib/push';
import { desuscribirWeb, pushWebConfigurado, PushWebNoDisponible, suscribirWeb, suscripcionesDe, vapid } from '../lib/push-web';

export {
  avisarComputadoraPorPush,
  avisarConAura,
  avisarPush,
  enviarPush,
  llamarConAura,
  llamarPorPush,
  proponerPorPush,
  pushConfigurado,
  recordarPorPush,
  type DatosPush,
  type ResultadoPush,
} from '../lib/push';

export type DepsPush = {
  exigirMesa: express.RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  sesionDe: (req: express.Request) => { correo: string; nombre?: string } | null;
  /** Junta o miembro (server/nivel.ts). Pruebas: otro. */
  nivelDe?: (correo: string) => 'junta' | 'miembro';
};

const sinSesion = (res: express.Response) => res.status(401).json({ error: 'Entra con tu sesión.', code: 'sesion_requerida', honesto: true });
const noDisponible = (res: express.Response) =>
  res.status(503).json({ error: 'Ahora mismo no pude leer tus teléfonos guardados; no cambié nada. Prueba en un momento.', code: 'push_no_disponible', honesto: true });

function correoDe(d: DepsPush, req: express.Request): string {
  return String(d.sesionDe(req)?.correo || '').trim().toLowerCase();
}

export function montarRutasPush(app: express.Express, deps: Partial<DepsPush> = {}) {
  const d: DepsPush = {
    exigirMesa: deps.exigirMesa || exigirMesaSeguridad,
    limitar: deps.limitar || limitarSeguridad,
    sesionDe: deps.sesionDe || sesionDeSeguridad,
    nivelDe: deps.nivelDe || ((c) => nivelDeCorreo(c)),
  };

  app.post('/api/push/registrar', d.exigirMesa, d.limitar(20, 60_000, 'push-registrar'), async (req, res) => {
    const correo = correoDe(d, req);
    if (!correo) return sinSesion(res);
    const b = (req.body || {}) as Record<string, unknown>;
    const token = tokenValido(b.token);
    if (!token) return res.status(400).json({ error: 'Falta el token de avisos del teléfono.', honesto: true });
    const aparato = aparatoValido(b.aparato) || aparatoValido(req.headers['x-aura-aparato']) || '';
    try {
      const r = await registrarToken(correo, { token, aparato, plataforma: String(b.plataforma || 'android'), app: String(b.app || 'aura') });
      return res.json({ ok: true, dispositivos: r.dispositivos, durable: r.durable, configurado: pushConfigurado(), honesto: true });
    } catch (e) {
      if (e instanceof PushNoDisponible) return noDisponible(res);
      console.warn('[push] no pude registrar el teléfono', String((e as Error)?.message || e).slice(0, 80));
      return res.status(500).json({ error: 'No pude registrar este teléfono para avisos.', honesto: true });
    }
  });

  app.post('/api/push/quitar', d.exigirMesa, d.limitar(20, 60_000, 'push-quitar'), async (req, res) => {
    const correo = correoDe(d, req);
    if (!correo) return sinSesion(res);
    const b = (req.body || {}) as Record<string, unknown>;
    const token = tokenValido(b.token) || '';
    const aparato = aparatoValido(b.aparato) || (token ? '' : aparatoValido(req.headers['x-aura-aparato']) || '');
    if (!token && !aparato) return res.status(400).json({ error: 'Falta el token o el aparato que quitar.', honesto: true });
    try {
      const r = await quitarToken(correo, { token, aparato });
      return res.json({ ok: true, quitados: r.quitados, durable: r.durable, honesto: true });
    } catch (e) {
      if (e instanceof PushNoDisponible) return noDisponible(res);
      return res.status(500).json({ error: 'No pude quitar este teléfono de los avisos.', honesto: true });
    }
  });

  app.post('/api/push/probar', d.exigirMesa, d.limitar(5, 60_000, 'push-probar'), async (req, res) => {
    const correo = correoDe(d, req);
    if (!correo) return sinSesion(res);
    if (d.nivelDe!(correo) !== 'junta') return res.status(403).json({ error: 'La prueba de avisos es de la junta directiva.', code: 'solo_junta', honesto: true });
    if (!pushConfigurado() && !pushWebConfigurado()) return res.status(503).json({ error: 'Los avisos no están configurados en el servidor (falta FIREBASE_SERVICE_ACCOUNT o el par VAPID).', code: 'push_sin_configurar', honesto: true });
    const r = await enviarPush(correo, { tipo: 'mensaje', titulo: 'AURA', texto: 'Prueba de avisos: si ves esto con la app cerrada, ya te puedo alcanzar.' });
    return res.status(r.enviados ? 200 : 502).json({ ok: r.enviados > 0, enviados: r.enviados, fallidos: r.fallidos, quitados: r.quitados, ...(r.detalle ? { detalle: r.detalle } : {}), honesto: true });
  });

  /*
   * PULSE2CHAT: la referencia que la app apunta en el relevo del chat (con su sesión del chat) para que,
   * cuando le llegue un mensaje, el relevo nos avise y le mandemos el aviso a sus teléfonos.
   */
  app.get('/api/push/relevo/ref', d.exigirMesa, d.limitar(20, 60_000, 'push-relevo-ref'), (req, res) => {
    const correo = correoDe(d, req);
    if (!correo) return sinSesion(res);
    const ref = refRelevo(correo);
    if (!ref) return res.status(503).json({ error: 'Los avisos del chat no están configurados en el servidor.', code: 'relevo_sin_configurar', honesto: true });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ref, honesto: true });
  });

  /*
   * El relevo del chat nos avisa: «a esta referencia le llegó algo». Sin sesión (es otro servidor), con la
   * clave compartida. Ni una palabra del mensaje viaja. 410 si esa persona ya no tiene teléfonos
   * registrados (el relevo poda la suscripción; la app la vuelve a poner al entrar). Un mensaje por
   * persona cada 8 s como mucho: una ráfaga en un grupo no son veinte avisos.
   */
  const ultimoAvisoChat = new Map<string, number>();
  app.post('/api/push/relevo', d.limitar(240, 60_000, 'push-relevo'), async (req, res) => {
    if (!claveRelevoValida(req.headers.authorization)) return res.status(401).json({ error: 'clave incorrecta' });
    const correo = correoDeRef(req.body?.ref);
    if (!correo) return res.status(404).json({ error: 'referencia desconocida' });
    const llamada = req.body?.tipo === 'llamada';
    const ahora = Date.now();
    if (!llamada && ahora - (ultimoAvisoChat.get(correo) || 0) < 8_000) return res.json({ ok: true, agrupado: true });
    ultimoAvisoChat.set(correo, ahora);
    if (ultimoAvisoChat.size > 5000) ultimoAvisoChat.delete(ultimoAvisoChat.keys().next().value as string);
    const [tel, web] = await Promise.all([dispositivosDe(correo), suscripcionesDe(correo)]);
    if (tel.ok && !tel.dispositivos.length && web.ok && !web.suscripciones.length) return res.status(410).json({ error: 'sin teléfonos' });
    const r = await avisarPush(correo, {
      titulo: 'PULSE2CHAT',
      texto: llamada ? 'Te están llamando en PULSE2CHAT' : 'Tienes un mensaje nuevo en PULSE2CHAT',
      abrir: 'chats',
    });
    return res.json({ ok: r.enviados > 0, enviados: r.enviados });
  });

  app.get('/api/push/estado', d.exigirMesa, d.limitar(30, 60_000, 'push-estado'), async (req, res) => {
    const correo = correoDe(d, req);
    if (!correo) return sinSesion(res);
    res.setHeader('Cache-Control', 'no-store');
    const [r, w] = await Promise.all([dispositivosDe(correo), suscripcionesDe(correo)]);
    return res.json({
      configurado: pushConfigurado(),
      dispositivos: r.ok ? r.dispositivos.length : null,
      disponible: r.ok,
      web: { configurado: pushWebConfigurado(), suscripciones: w.ok ? w.suscripciones.length : null },
      honesto: true,
    });
  });

  /*
   * AVISOS EN LA WEB INSTALADA (el iPhone: iOS 16.4+ con AU-RA en la pantalla de inicio). La llave pública
   * VAPID no es secreta (el navegador la necesita para suscribirse); la suscripción se guarda por el correo
   * de la SESIÓN y solo si es de un servicio de avisos conocido (lib/push-web.ts).
   */
  app.get('/api/push/web/clave', d.limitar(30, 60_000, 'push-web-clave'), (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ publica: vapid()?.publica || null, honesto: true });
  });

  app.post('/api/push/web/suscribir', d.exigirMesa, d.limitar(20, 60_000, 'push-web-suscribir'), async (req, res) => {
    const correo = correoDe(d, req);
    if (!correo) return sinSesion(res);
    if (!pushWebConfigurado()) return res.status(503).json({ error: 'Los avisos en la web no están configurados en el servidor.', code: 'push_web_sin_configurar', honesto: true });
    const aparato = aparatoValido(req.body?.aparato) || aparatoValido(req.headers['x-aura-aparato']) || '';
    try {
      const r = await suscribirWeb(correo, req.body?.suscripcion, aparato);
      return res.json({ ok: true, suscripciones: r.suscripciones, durable: r.durable, honesto: true });
    } catch (e) {
      if (e instanceof PushWebNoDisponible) return noDisponible(res);
      return res.status(400).json({ error: String((e as Error)?.message || 'No pude guardar la suscripción.').slice(0, 160), honesto: true });
    }
  });

  app.post('/api/push/web/quitar', d.exigirMesa, d.limitar(20, 60_000, 'push-web-quitar'), async (req, res) => {
    const correo = correoDe(d, req);
    if (!correo) return sinSesion(res);
    const aparato = aparatoValido(req.body?.aparato) || '';
    const endpoint = String(req.body?.endpoint || '');
    if (!endpoint && !aparato) return res.status(400).json({ error: 'Falta qué navegador quitar.', honesto: true });
    try {
      const r = await desuscribirWeb(correo, { endpoint, aparato });
      return res.json({ ok: true, quitados: r.quitados, durable: r.durable, honesto: true });
    } catch (e) {
      if (e instanceof PushWebNoDisponible) return noDisponible(res);
      return res.status(500).json({ error: 'No pude quitar este navegador de los avisos.', honesto: true });
    }
  });
}
