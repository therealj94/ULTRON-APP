/**
 * Las llamadas de la pestaña Correos al servidor (server/correo.ts). Conectar y quitar cuentas sigue en
 * ajustes/Correos.tsx (GET/POST/DELETE /api/correo/cuentas): aquí solo se ve, se abre y se contesta.
 */
import { api } from '../lib/api';
import { normalizarBandeja, normalizarMensaje, type BandejaCorreo, type MensajeCorreo } from './logica';

/** Lo último de la bandeja de todas sus cuentas (o de una), o lo que coincide con `buscar`. */
export const bandejaCorreo = (o: { buscar?: string; cuenta?: string; n?: number } = {}): Promise<BandejaCorreo> => {
  const q = [o.buscar ? `buscar=${encodeURIComponent(o.buscar)}` : '', o.cuenta ? `cuenta=${encodeURIComponent(o.cuenta)}` : '', `n=${o.n ?? 30}`].filter(Boolean).join('&');
  // Cada cuenta es una conexión IMAP: con varias puede tardar.
  return api(`/api/correo/bandeja?${q}`, { method: 'GET' }, 45_000).then(normalizarBandeja);
};

/** El correo completo (queda leído en el buzón, como al abrirlo en cualquier programa). */
export const abrirCorreo = (ref: string): Promise<MensajeCorreo> =>
  api<{ mensaje: unknown }>(`/api/correo/mensaje?ref=${encodeURIComponent(ref)}`, { method: 'GET' }, 40_000).then((r) => {
    const m = normalizarMensaje(r?.mensaje);
    if (!m) throw Object.assign(new Error('Ese correo vino vacío.'), { status: 502 });
    return m;
  });

export type EnvioCorreo = { cuentaId: string; para: string[]; cc: string[]; asunto: string; texto: string; enRespuestaA?: string; referencias?: string[] };

/**
 * Lo manda. SOLO se llama desde el «Mandar» del aviso de confirmación (correo/RedactarCorreo.tsx):
 * `confirmado: true` es ese toque; el servidor no manda nada sin él.
 */
export const mandarCorreoConfirmado = (e: EnvioCorreo) =>
  api<{ ok: boolean; desde: string; aceptados: string[]; rechazados: string[]; guardadoEnEnviados: boolean }>('/api/correo/enviar', { method: 'POST', body: JSON.stringify({ ...e, confirmado: true }) }, 60_000);
