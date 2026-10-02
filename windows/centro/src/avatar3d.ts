/**
 * El avatar 3D de la app (el mismo embed de vendor/aura-avatar-suite) dentro del Centro, en un iframe.
 * Se le habla como en la app: estado (cara y emoción), boca (0..1), entrar, tarea (gesto) y mirar.
 * AU-RA ya no es un modelo 3D: es su orbe de partículas (src/14-orbe/orbe.html, aprobado por José; build.mjs lo
 * copia a avatar/orbe.html), que habla el mismo idioma (estado, boca) sin el envoltorio del embed.
 * Si el equipo no tiene WebGL o tarda, se queda la imagen fija del avatar o el orbe quieto (nunca un hueco).
 */
import { h } from './ui';

export type Avatar3D = { el: HTMLElement; estado(face: string, emocion?: string): void; boca(n: number): void; gesto(t: string): void; cambiar(id: string): void };

const CON_3D = new Set(['aura', 'claudio', 'antonio']);

/** La página del orbe en el Centro: sin panel de prueba, sin voz propia (la voz es de AURA) y los efectos según Ajustes. */
export function urlOrbe(sonidos: boolean): string {
  return `avatar/orbe.html?clean&tts=0&silent${sonidos ? '' : '&sfx=0'}`;
}

export function avatar3d(id: string, clase = 'avatar3d', opciones: { sonidos?: boolean } = {}): Avatar3D {
  const cont = h('div', { class: clase, style: 'overflow:hidden' });
  let frame: HTMLIFrameElement | null = null;
  let listo = false;
  let ultimo: any = { tipo: 'estado', face: 'idle', emocion: 'neutral' };
  // El orbe recibe y manda los mensajes tal cual; los embeds de la app, envueltos (el puente de build.mjs).
  const esOrbe = () => id === 'aura';
  const mandar = (m: any) => { if (listo) frame?.contentWindow?.postMessage(esOrbe() ? m : { aAvatar: m }, '*'); };
  const alMensaje = (e: MessageEvent) => {
    if (!frame || e.source !== frame.contentWindow) return;
    const m = esOrbe() ? e.data : e.data?.avatar3d;
    if (!m || typeof m !== 'object') return;
    if (m.tipo === 'listo') { listo = true; mandar(ultimo); if (!esOrbe()) mandar({ tipo: 'entrar' }); }
    // El orbe avisa «aura-fallo» si pierde el contexto WebGL; los embeds, «fallo».
    if (m.tipo === 'fallo' || m.type === 'aura-fallo') respaldo();
  };
  addEventListener('message', alMensaje);
  function respaldo() {
    listo = false;
    frame = null;
    // Sin WebGL o si la sala tarda: el orbe quieto (AU-RA), la hoja del avatar del notch (primer cuadro) o los ojos del Guardián.
    if (id === 'aura') { cont.replaceChildren(h('div', { class: 'orbe-quieto', role: 'img', 'aria-label': 'AU-RA' })); return; }
    if (id === 'ojos') { cont.replaceChildren(h('div', { class: 'ojos' }, h('i'), h('i'))); return; }
    cont.replaceChildren(h('div', { class: 'avatar-hoja', role: 'img', 'aria-label': id, style: `background-image:url(avatar/${id}-idle.png)` }));
  }
  function montar() {
    listo = false;
    if (!CON_3D.has(id)) { respaldo(); return; }
    const src = esOrbe() ? urlOrbe(opciones.sonidos !== false) : `avatar/${id}.html`;
    const este = h('iframe', { src, title: esOrbe() ? 'AU-RA' : 'Avatar', style: 'width:100%;height:100%;border:0;background:transparent', allowtransparency: 'true' }) as HTMLIFrameElement;
    frame = este;
    cont.replaceChildren(este);
    // 12 s para decir «listo» (si para entonces ya cambiaron de avatar, el reloj es de otro iframe y no hace nada).
    setTimeout(() => { if (!listo && frame === este) respaldo(); }, 12_000);
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
