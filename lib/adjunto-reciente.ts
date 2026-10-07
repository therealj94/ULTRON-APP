/**
 * EL ÚLTIMO ADJUNTO QUE SE LEYÓ EN LA CONVERSACIÓN (para «reenvíale ese PDF a Beto»). Cuando AU-RA lee un adjunto de
 * un correo o un documento de WhatsApp (lib/leer-adjunto.ts), se queda con sus bytes un rato, solo en la memoria de este
 * proceso, por persona y conversación: un borrador de WhatsApp con archivo (server/whatsapp.ts `archivo`) lo toma de
 * aquí y su huella (sha256) entra en lo que la persona aprueba. Nada de esto va al disco ni a S3.
 */
import crypto from 'node:crypto';

export type AdjuntoReciente = { nombre: string; mime: string; datos: Buffer; origen: 'correo' | 'whatsapp'; sha256: string; t: number };

/** Lo más grande que se recuerda (lo mismo que el puente manda). */
export const MAX_ADJUNTO_RECIENTE = 16 * 1024 * 1024;
export const ADJUNTO_RECIENTE_VIVE_MS = 20 * 60_000;
const MAX_CONVERSACIONES = 40;

const RECIENTES = new Map<string, AdjuntoReciente>();
const llave = (quien: string, ambito = '') => `${String(quien || '').trim().toLowerCase()}|${String(ambito || 'general').slice(0, 80)}`;

export function recordarAdjunto(quien: string, ambito: string, a: { nombre: string; mime?: string; datos: Buffer; origen: 'correo' | 'whatsapp' }, ahora = Date.now()): AdjuntoReciente | null {
  if (!quien || !a.datos?.length || a.datos.length > MAX_ADJUNTO_RECIENTE) return null;
  const k = llave(quien, ambito);
  RECIENTES.delete(k);
  while (RECIENTES.size >= MAX_CONVERSACIONES) RECIENTES.delete(RECIENTES.keys().next().value as string);
  const r: AdjuntoReciente = { nombre: a.nombre || 'archivo', mime: a.mime || 'application/octet-stream', datos: a.datos, origen: a.origen, sha256: crypto.createHash('sha256').update(a.datos).digest('hex'), t: ahora };
  RECIENTES.set(k, r);
  return r;
}

export function adjuntoReciente(quien: string, ambito: string, ahora = Date.now()): AdjuntoReciente | null {
  const k = llave(quien, ambito);
  const r = RECIENTES.get(k);
  if (!r) return null;
  if (ahora - r.t > ADJUNTO_RECIENTE_VIVE_MS) {
    RECIENTES.delete(k);
    return null;
  }
  return r;
}

/** Pruebas. */
export function _olvidarAdjuntosRecientes() {
  RECIENTES.clear();
}
