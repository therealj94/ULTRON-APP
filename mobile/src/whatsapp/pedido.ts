/**
 * «ABRE ESE CHAT CON ESTE BORRADOR» (auditoría del 7-oct, A-6): el aviso de un WhatsApp importante (push/logica.ts,
 * `mensaje-externo`) trae el chat y una respuesta sugerida. Al tocarlo, push/nativo.ts deja aquí el pedido y abre los
 * chats en WhatsApp; la pantalla de WhatsApp (PantallaWhatsapp.tsx) lo toma en cuanto está vinculada y abre ESE chat con
 * la sugerencia en la caja de texto. Es solo un borrador: no sale nada hasta que la persona toca «Enviar».
 *
 * Un pedido vale un rato (VIDA_PEDIDO_MS) y se toma una sola vez; sin React (lo prueba node).
 */
export type PedidoChatWA = { jid: string; nombre: string; borrador: string; en: number };

/** Lo que vive un pedido sin que lo tome nadie (la app tardó en llegar a la sesión, o WhatsApp no está). */
export const VIDA_PEDIDO_MS = 2 * 60_000;
export const MAX_BORRADOR_PEDIDO = 1000;

let pendiente: PedidoChatWA | null = null;
const oyentes = new Set<() => void>();

/** El pedido validado (null si el chat no es un jid de WhatsApp). Puro. */
export function pedidoValido(p: { jid?: unknown; nombre?: unknown; borrador?: unknown }, ahora = Date.now()): PedidoChatWA | null {
  const jid = String(p?.jid ?? '').trim();
  if (!/^[0-9A-Za-z._:-]{3,120}@[a-z.]{2,40}$/.test(jid)) return null;
  return {
    jid,
    nombre: String(p?.nombre ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
    borrador: String(p?.borrador ?? '').trim().slice(0, MAX_BORRADOR_PEDIDO),
    en: ahora,
  };
}

/** Deja el pedido (reemplaza al anterior) y avisa a quien escuche. */
export function pedirChatWA(p: { jid: string; nombre?: string; borrador?: string }, ahora = Date.now()): boolean {
  const v = pedidoValido(p, ahora);
  if (!v) return false;
  pendiente = v;
  for (const f of oyentes) {
    try {
      f();
    } catch {
      /* un oyente roto no deja sin aviso a los demás */
    }
  }
  return true;
}

/** Toma el pedido (una sola vez): null si no hay o ya venció. */
export function tomarPedidoWA(ahora = Date.now()): PedidoChatWA | null {
  const p = pendiente;
  pendiente = null;
  if (!p || ahora - p.en > VIDA_PEDIDO_MS) return null;
  return p;
}

/** ¿Hay un pedido vigente? (sin tomarlo) */
export function hayPedidoWA(ahora = Date.now()): boolean {
  return !!pendiente && ahora - pendiente.en <= VIDA_PEDIDO_MS;
}

/** Escucha los pedidos nuevos; devuelve cómo dejar de escuchar. */
export function alPedirChatWA(f: () => void): () => void {
  oyentes.add(f);
  return () => void oyentes.delete(f);
}
