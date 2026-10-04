/**
 * A QUÉ PANTALLA LLEVA UN AVISO (push web). El service worker (scripts/pwa/sw-plantilla.js) abre una ventana
 * nueva en `/?abrir=<x>` o, si ya hay una abierta, le manda `{ tipo: 'aura-abrir', abrir }` en vez de
 * navegarla (una recarga cortaría la conversación en vivo). Aquí se traduce a lo que la mesa web sabe
 * mostrar; lo que no tiene pantalla en la web deja la mesa como está.
 */
export type DestinoAviso = 'conversar' | 'trabajar' | 'tareas';

export function destinoDeAviso(abrir: unknown): DestinoAviso | null {
  switch (String(abrir || '')) {
    case 'computadora':
    case 'misiones':
      return 'trabajar';
    // «Terminé de investigar» (server/investigar.ts): abre el panel de Tareas, donde está el resultado (Codex, PR 142).
    case 'tareas':
      return 'tareas';
    case 'mesa':
      return 'conversar';
    default:
      return null;
  }
}

/**
 * Escucha los avisos tocados: el `?abrir=` con que se abrió esta ventana (y lo quita de la barra) y los
 * mensajes del service worker mientras sigue abierta. Devuelve cómo dejar de escuchar.
 */
export function escucharAvisosTocados(ir: (d: DestinoAviso) => void, w: (Window & typeof globalThis) | undefined = typeof window === 'undefined' ? undefined : window): () => void {
  if (!w) return () => undefined;
  try {
    const url = new URL(w.location.href);
    const inicial = destinoDeAviso(url.searchParams.get('abrir'));
    if (url.searchParams.has('abrir')) {
      url.searchParams.delete('abrir');
      w.history.replaceState(w.history.state, '', url.pathname + url.search + url.hash);
    }
    if (inicial) ir(inicial);
  } catch {
    /* una URL rara no impide abrir la mesa */
  }
  const sw = w.navigator?.serviceWorker;
  if (!sw) return () => undefined;
  const oir = (e: MessageEvent) => {
    if (e?.data?.tipo !== 'aura-abrir') return;
    const d = destinoDeAviso(e.data.abrir);
    if (d) ir(d);
  };
  sw.addEventListener('message', oir);
  return () => sw.removeEventListener('message', oir);
}
