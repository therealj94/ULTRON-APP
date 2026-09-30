/**
 * A quién le puede escribir AURA: nombres y correos de la gente del chat, nunca sus mensajes.
 *
 * Si el relevo ya trae `contactosConocidos()` (lo agrega el frente del chat de la 5.0) se usa esa;
 * mientras tanto se arma con lo que hay hoy: las conversaciones 1 a 1 y los amigos del círculo. De
 * cada una se toman SOLO `correo` y `nombre` (depurarContactos descarta todo lo demás, incluido el
 * último mensaje que trae cada conversación).
 */
import * as RELEVO from '../pulse/relevo';
import { depurarContactos, type Contacto } from './acciones';

type ConContactos = { contactosConocidos?: () => Promise<unknown[]> };

export async function contactosParaAura(): Promise<Contacto[]> {
  const nuevo = (RELEVO as unknown as ConContactos).contactosConocidos;
  if (typeof nuevo === 'function') return depurarContactos(await nuevo().catch(() => []));
  if (!RELEVO.quien()) return [];
  const [hilos, circulo] = await Promise.all([RELEVO.conversaciones().catch(() => [] as unknown[]), RELEVO.circulo().catch(() => ({ amigos: [] as unknown[] }))]);
  const deHilos = (hilos as { esGrupo?: boolean; correo?: string; nombre?: string }[]).filter((h) => !h?.esGrupo).map((h) => ({ correo: h?.correo, nombre: h?.nombre }));
  const amigos = ((circulo as { amigos?: { correo?: string; nombre?: string }[] }).amigos || []).map((a) => ({ correo: a?.correo, nombre: a?.nombre }));
  return depurarContactos([...deHilos, ...amigos]);
}
