/**
 * El avatar 3D de la app (el mismo embed de vendor/aura-avatar-suite) dentro del Centro, en un iframe.
 * Se le habla como en la app: estado (cara y emoción), boca (0..1), entrar, tarea (gesto) y mirar.
 * Si el equipo no tiene WebGL o tarda, se queda la imagen fija del avatar (nunca un hueco).
 */
import { h } from './ui';

export type Avatar3D = { el: HTMLElement; estado(face: string, emocion?: string): void; boca(n: number): void; gesto(t: string): void; cambiar(id: string): void };

const CON_3D = new Set(['aura', 'claudio', 'antonio']);

export function avatar3d(id: string, clase = 'avatar3d'): Avatar3D {
  const cont = h('div', { class: clase, style: 'overflow:hidden' });
  let frame: HTMLIFrameElement | null = null;
  let listo = false;
  let ultimo: any = { tipo: 'estado', face: 'idle', emocion: 'neutral' };
  const mandar = (m: any) => { if (listo) frame?.contentWindow?.postMessage({ aAvatar: m }, '*'); };
  const alMensaje = (e: MessageEvent) => {
    if (e.source !== frame?.contentWindow || !e.data?.avatar3d) return;
    const m = e.data.avatar3d;
    if (m.tipo === 'listo') { listo = true; mandar(ultimo); mandar({ tipo: 'entrar' }); }
    if (m.tipo === 'fallo') respaldo();
  };
  addEventListener('message', alMensaje);
  function respaldo() {
    cont.replaceChildren(h('img', { src: `avatar/${id}.png`, alt: '', style: 'width:100%;height:100%;object-fit:contain' }));
  }
  function montar() {
    listo = false;
    if (!CON_3D.has(id)) { respaldo(); return; }
    frame = h('iframe', { src: `avatar/${id}.html`, title: 'Avatar', style: 'width:100%;height:100%;border:0;background:transparent', allowtransparency: 'true' }) as HTMLIFrameElement;
    cont.replaceChildren(frame);
    setTimeout(() => { if (!listo) respaldo(); }, 12_000);
  }
  montar();
  return {
    el: cont,
    estado(face, emocion = 'neutral') { ultimo = { tipo: 'estado', face, emocion }; mandar(ultimo); },
    boca(n) { mandar({ tipo: 'boca', n: Math.round(n * 100) / 100 }); },
    gesto(t) { mandar({ tipo: 'tarea', tarea: t }); },
    cambiar(nuevo) { if (nuevo !== id) { id = nuevo; montar(); } },
  };
}
