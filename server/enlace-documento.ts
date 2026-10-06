/**
 * EL ENLACE PARA BAJAR UN DOCUMENTO DE OFICINA (revisión 8, MEDIO-2). GET /api/documentos/:id pedía la sesión en una
 * cabecera, y ni la app ni la web tenían cómo abrirlo: AU-RA decía «está listo» y no había forma de bajarlo.
 *
 * Ahora la tarjeta de la tarea (GET /api/trabajos y /api/trabajos/:id) lleva, en cada evidencia de tipo `archivo`, un
 * enlace https firmado para ESE archivo y ESA cuenta, que vence a los ENLACE_VIVE_MS. La app (PanelTrabajos) y la web
 * (Trabajos) ya abren los enlaces https de las evidencias: el navegador lo baja sin cabeceras.
 *
 *  · Lo firma el servidor con el secreto de las sesiones (server/seguridad.ts firmarDato, prefijo propio `doc`): no se
 *    puede presentar como sesión ni al revés, ni cambiarle el id o la cuenta.
 *  · Se emite solo al dueño de la sesión que lee su tarea; se vuelve a emitir en cada lectura (no se guarda).
 *  · Al usarlo, la cuenta tiene que seguir con autoridad (SEC-04): suspendida, 403; sin poder comprobarlo, 503 —salvo
 *    la identidad del entorno, como en el resto de /api—.
 *  · Lo demás de la descarga (la ficha bajo la huella del dueño, el sha256 comprobado, el vencimiento) no cambia.
 */
import { firmarDato, leerDato } from './seguridad';

export const ENLACE_VIVE_MS = 15 * 60_000;
const RE_ID = /^d_[0-9a-f]{24}$/;

/** La raíz pública del servidor (https en Render). Sin ella no hay enlace (la tarjeta queda como antes). */
export function raizPublica(host?: string | null, env: NodeJS.ProcessEnv = process.env): string {
  const fija = String(env.PUBLIC_BASE || env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
  if (fija) return fija;
  const h = String(host || '').trim();
  return /^[a-z0-9.-]+(:\d+)?$/i.test(h) ? `https://${h}` : '';
}

/** El enlace firmado de un archivo para su dueño (o '' si el id no es de un documento o no hay raíz). */
export function enlaceDocumento(dueno: string, id: string, raiz: string, ahora = Date.now()): string {
  const c = String(dueno || '').trim().toLowerCase();
  if (!c || !RE_ID.test(id) || !raiz) return '';
  return `${raiz}/api/documentos/${id}?t=${firmarDato('doc', { c, id, e: ahora + ENLACE_VIVE_MS })}`;
}

/** De quién es el archivo según el enlace, si la firma vale, es para ESE id y no venció; si no, null. */
export function duenoDelEnlace(token: unknown, id: string, ahora = Date.now()): string | null {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const d = leerDato('doc', token);
  if (!d || d.id !== id || typeof d.c !== 'string' || !d.c || typeof d.e !== 'number' || !(d.e > ahora)) return null;
  return d.c;
}

type ConEvidencias = { result?: { evidence: Array<{ tipo: string; ref?: string }> } | null };

/** La tarjeta con el enlace firmado en cada evidencia `archivo` que es un documento (sin tocar el registro). */
export function conEnlacesDeDocumentos<T extends ConEvidencias>(t: T, dueno: string, raiz: string, ahora = Date.now()): T {
  const ev = t.result?.evidence;
  if (!ev?.length || !raiz || !ev.some((e) => e.tipo === 'archivo' && RE_ID.test(String(e.ref || '')))) return t;
  return {
    ...t,
    result: {
      ...t.result!,
      evidence: ev.map((e) => {
        if (e.tipo !== 'archivo' || !RE_ID.test(String(e.ref || ''))) return e;
        const enlace = enlaceDocumento(dueno, e.ref!, raiz, ahora);
        return enlace ? { ...e, ref: enlace } : e;
      }),
    },
  };
}
