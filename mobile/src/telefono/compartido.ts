/**
 * «COMPARTIR → AU-RA» (APK 5.7.1): un texto, un enlace o una foto que otra app le manda a AU-RA (el filtro ACTION_SEND de
 * MainActivity, plugins/asistente-digital.js; TelefonoAura.kt `tomarCompartido`). Se vuelve un turno NUEVO en la mesa con
 * eso como contexto («Me compartieron esto: …»), en el chat principal.
 *
 * Aquí lo puro: el mensaje del turno y un buzón de uno (lo compartido puede llegar antes de que la mesa esté montada, al
 * abrir la app desde «Compartir»; la mesa lo toma al montarse). El hook que lo lee del módulo está en telefono/useTelefono.ts.
 */

export type Compartido = { tipo?: string; texto?: string; asunto?: string; imagen?: string };
export type PedidoCompartido = { mensaje: string; imagen?: string };

export const MAX_TEXTO_COMPARTIDO = 2000;

const limpio = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, max);

/**
 * El mensaje del turno para lo compartido (null si no trae nada). Lo de afuera va entre comillas y marcado como lo que
 * compartió: es contexto, no una orden para AU-RA.
 */
export function pedidoDeCompartido(c: Compartido | null | undefined, tr: (es: string, en: string) => string = (es) => es): PedidoCompartido | null {
  if (!c) return null;
  const texto = limpio(c.texto, MAX_TEXTO_COMPARTIDO);
  const asunto = limpio(c.asunto, 200);
  const imagen = typeof c.imagen === 'string' && /^(file|content):\/\//.test(c.imagen) ? c.imagen : undefined;
  if (!texto && !imagen) return null;
  const esEnlace = /^https?:\/\/\S+$/i.test(texto);
  const cuerpo = [asunto && asunto !== texto ? asunto : '', texto].filter(Boolean).join(' — ');
  const mensaje = imagen
    ? cuerpo
      ? tr(`Te comparto esta imagen desde otra app, con este texto: «${cuerpo}». ¿Qué ves?`, `I'm sharing this image from another app, with this text: «${cuerpo}». What do you see?`)
      : tr('Te comparto esta imagen desde otra app. ¿Qué ves?', "I'm sharing this image from another app. What do you see?")
    : esEnlace
      ? tr(`Te comparto este enlace desde otra app: ${texto} ¿De qué se trata?`, `I'm sharing this link from another app: ${texto} What is it about?`)
      : tr(`Te comparto esto desde otra app: «${cuerpo}». ¿Qué me dices?`, `I'm sharing this from another app: «${cuerpo}». What do you think?`);
  return { mensaje, ...(imagen ? { imagen } : {}) };
}

/** El buzón de uno: lo último compartido, hasta que la mesa lo tome. */
let pendiente: { p: PedidoCompartido; en: number } | null = null;
const oyentes = new Set<(p: PedidoCompartido) => void>();
export const VIDA_COMPARTIDO_MS = 5 * 60_000;

export function guardarCompartido(p: PedidoCompartido, ahora = Date.now()): void {
  pendiente = { p, en: ahora };
  for (const f of [...oyentes]) f(p);
}

/** Lo compartido que espera (una vez), si no es viejo. */
export function tomarCompartido(ahora = Date.now()): PedidoCompartido | null {
  const x = pendiente;
  pendiente = null;
  return x && ahora - x.en <= VIDA_COMPARTIDO_MS ? x.p : null;
}

/** La mesa escucha lo que llega con ella montada (y toma lo que esperaba al montarse con tomarCompartido). */
export function escucharCompartido(f: (p: PedidoCompartido) => void): () => void {
  oyentes.add(f);
  return () => oyentes.delete(f);
}
