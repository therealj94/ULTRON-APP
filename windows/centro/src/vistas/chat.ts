/** El chat con AURA en el Centro: el mismo del notch (las respuestas llegan mientras las escribe). */
import { h, botonIcono, vacio, icono } from '../ui';
import { pedir, al } from '../puente';
import { estado, T, NOMBRES } from '../estado';

export function vistaChat(): HTMLElement {
  const lista = h('div', { class: 'chat-lista', role: 'log', 'aria-live': 'polite' });
  const burbujas = new Map<number, HTMLElement>();
  const texto = h('textarea', { rows: 1, placeholder: T('Escríbele a AURA…', 'Type to AURA…'), 'aria-label': T('Mensaje', 'Message'),
    style: 'resize:none;max-height:160px' }) as HTMLTextAreaElement;
  // Las ideas del vacío se tocan: escriben la frase en el compositor (no la mandan solas).
  const sugerir = (t: string) => { texto.value = t; texto.focus(); texto.dispatchEvent(new Event('input')); };
  const ideas = [T('Abre Excel', 'Open Excel'), T('¿Qué hay en mi pantalla?', 'What’s on my screen?'), T('Redáctame un correo', 'Draft an email'), T('¿Cuánto ORIGEN tengo?', 'How much ORIGEN do I have?')];
  const vacioMsg = h('div', { class: 'chat-vacio' },
    h('span', { class: 'foto dorada' }, icono('chat', 24)),
    h('h2', null, T('¿En qué te ayudo?', 'How can I help?')),
    h('p', null, T('Pregúntale lo que quieras, o pídele cosas de tu computadora.', 'Ask anything, or ask for things on your PC.')),
    h('div', { class: 'sugerencias' }, ...ideas.map((t) => h('button', { class: 'sugerencia', type: 'button', on: { click: () => sugerir(t) } }, t))));
  lista.appendChild(vacioMsg);
  const enviar = async () => {
    const t = texto.value.trim();
    if (!t) return;
    texto.value = ''; texto.style.height = 'auto';
    await pedir('chat.enviar', { texto: t });
  };
  texto.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } });
  texto.addEventListener('input', () => { texto.style.height = 'auto'; texto.style.height = Math.min(160, texto.scrollHeight) + 'px'; });

  al<{ id: number; quien: string; texto: string; mio: boolean }>('chat.mensaje', (m) => {
    vacioMsg.remove();
    let b = burbujas.get(m.id);
    if (!b) {
      b = h('div', { class: 'burbuja ' + (m.mio ? 'mia' : 'suya') });
      burbujas.set(m.id, b);
      lista.appendChild(b);
    }
    vacio(b).append(...(m.mio ? [] : [h('small', { class: 'quien' }, m.quien)]), h('div', null, m.texto || h('span', { class: 'escribiendo', role: 'img', 'aria-label': T('Pensando…', 'Thinking…') }, h('i'), h('i'), h('i'))));
    lista.scrollTop = lista.scrollHeight;
  });

  const mic = botonIcono('mic', T('Hablarle (Ctrl+Alt+Espacio)', 'Talk (Ctrl+Alt+Space)'), async () => {
    // Mientras el notch abre el micrófono, el botón lo muestra (ondas).
    mic.classList.add('escuchando');
    try { await pedir('chat.hablar'); await new Promise((r) => setTimeout(r, 2400)); }
    catch { /* el notch dice qué pasó */ }
    finally { mic.classList.remove('escuchando'); }
  }, 'grande');

  return h('div', { class: 'vista chat' },
    h('div', { class: 'cabeza' }, h('div', null, h('h1', null, T('Chat con ', 'Chat with ') + (NOMBRES[estado().avatar] ?? 'AURA')), h('p', null, T('Lo mismo que el chat del notch: con voz o escrito.', 'Same as the notch chat.'))),
      h('div', { class: 'acciones' }, botonIcono('callar', T('Callarla (deja de hablar)', 'Stop talking'), () => pedir('chat.callar')))),
    lista,
    h('div', null,
      h('div', { class: 'compositor' },
        mic,
        texto,
        botonIcono('enviar', T('Enviar (Enter)', 'Send (Enter)'), enviar, 'grande acento')),
      h('p', { class: 'compositor-pista' }, h('kbd', null, 'Enter'), T(' envía · ', ' sends · '), h('kbd', null, 'Shift'), '+', h('kbd', null, 'Enter'), T(' salta línea', ' new line'))));
}
