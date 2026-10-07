/**
 * LA LISTA DE PULSE2CHAT PARA VERLA SIN RED (auditoría A3: sin conexión se veía «Tus conversaciones aparecerán
 * aquí · Agrega a alguien», como si no tuviera ninguna). Sin nada nativo: lo prueban las pruebas en node.
 *
 * Se guarda lo justo para dibujar las filas: con quién, su nombre y su foto, cuántos sin leer y CUÁNDO fue lo
 * último. El texto de los mensajes NO: el chat es de punta a punta y lo descifrado no se escribe en el teléfono.
 * Es de UNA cuenta (`quien`, el seudónimo de lib/cuenta): otra cuenta no lo lee.
 */
import type { Conversacion } from './relevo';

export type ListaGuardada = { v: 1; quien: string; hora: number; conversaciones: Conversacion[] };

/** Cuántas conversaciones se guardan (las de arriba: las más recientes). */
export const MAX_GUARDADAS = 60;

/** Una fila sin lo que dijo nadie: el último mensaje queda solo con su hora y de quién fue. */
function sinTexto(c: Conversacion): Conversacion {
  return {
    correo: c.correo,
    nombre: c.nombre,
    ...(c.gid ? { gid: c.gid } : {}),
    ...(c.foto ? { foto: c.foto } : {}),
    sinLeer: c.sinLeer > 0 ? c.sinLeer : 0,
    ultimo: c.ultimo ? ({ id: String(c.ultimo.id || ''), de: c.ultimo.de, para: c.ultimo.para, cuando: Number(c.ultimo.cuando) || 0, texto: '', sinTexto: true } as unknown as Conversacion['ultimo']) : null,
  };
}

export function paraGuardarLista(quien: string, conversaciones: Conversacion[] | null, hora = Date.now()): ListaGuardada | null {
  if (!quien || !conversaciones) return null;
  return { v: 1, quien, hora, conversaciones: conversaciones.filter((c) => !c.esGrupo).slice(0, MAX_GUARDADAS).map(sinTexto) };
}

/** Lo guardado, si es de esta cuenta y tiene forma de serlo. */
export function listaGuardadaDe(crudo: unknown, quien: string): ListaGuardada | null {
  const g = crudo as Partial<ListaGuardada> | null;
  if (!quien || !g || typeof g !== 'object' || g.v !== 1 || g.quien !== quien || !Array.isArray(g.conversaciones)) return null;
  const conversaciones = g.conversaciones
    .filter((c: any) => c && typeof c.correo === 'string' && c.correo)
    .slice(0, MAX_GUARDADAS)
    .map((c: any) => sinTexto({ ...c, nombre: String(c.nombre || c.correo.split('@')[0]), sinLeer: Number(c.sinLeer) || 0, ultimo: c.ultimo || null }));
  return { v: 1, quien, hora: Number(g.hora) || 0, conversaciones };
}

/** ¿Este último mensaje viene de lo guardado (sin su texto)? */
export const esDeLoGuardado = (m: unknown) => !!(m && (m as { sinTexto?: boolean }).sinTexto);
