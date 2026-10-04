/** El chat con AURA en el Centro: el mismo del notch (las respuestas llegan mientras las escribe). */
import { h, botonIcono, vacio, icono } from '../ui';
import { pedir, al } from '../puente';
import { estado, T, NOMBRES } from '../estado';
import { punzonTinta } from '../marca';

export function vistaChat(): HTMLElement {
  const lista = h('div', { class: 'chat-lista', role: 'log', 'aria-live': 'polite' });
  const burbujas = new Map<number, HTMLElement>();
  const texto = h('textarea', { rows: 1, placeholder: T('Escríbele a AURA…', 'Type to AURA…'), 'aria-label': T('Mensaje', 'Message'),
    style: 'resize:none;max-height:160px' }) as HTMLTextAreaElement;
  // Las ideas del vacío se tocan: escriben la frase en el compositor (no la mandan solas).
  const sugerir = (t: string) => { texto.value = t; texto.focus(); texto.dispatchEvent(new Event('input')); };
  const ideas = [T('¿Cuánto ORIGEN tengo?', 'How much ORIGEN do I have?'), T('Abre Excel', 'Open Excel'), T('¿Qué hay en mi pantalla?', 'What’s on my screen?'), T('Redáctame un correo para la junta', 'Draft an email to the board')];
  const vacioMsg = h('div', { class: 'chat-vacio' },
    punzonTinta(40),
    h('h2', null, T('Pídele algo concreto.', 'Ask for something specific.')),
    h('p', null, T('Lo que pasa en tu computadora, tus saldos, tus chats, tu música. Toca una idea para escribirla abajo.', 'Your computer, balances, chats, music. Tap an idea to write it below.')),
    h('div', { class: 'sugerencias' }, ...ideas.map((t) => h('button', { class: 'sugerencia', type: 'button', on: { click: () => sugerir(t) } }, icono('avanzar', 16), t))));
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
    vacio(b).append(...(m.mio ? [] : [h('small', { class: 'quien' }, m.quien)]), h('div', null, m.texto || pensando()));
    lista.scrollTop = lista.scrollHeight;
  });

  const mic = botonIcono('mic', T('Hablarle (Ctrl+Alt+Espacio)', 'Talk (Ctrl+Alt+Space)'), async () => {
    // Mientras el notch abre el micrófono, el botón toma la pátina (te escucho).
    mic.classList.add('escuchando');
    try { await pedir('chat.hablar'); await new Promise((r) => setTimeout(r, 2400)); }
    catch { /* el notch dice qué pasó */ }
    finally { mic.classList.remove('escuchando'); }
  }, 'grande');

  return h('div', { class: 'vista chat' },
    h('div', { class: 'cabeza' }, h('div', null, h('h1', null, T('Chat', 'Chat')), h('p', null, T(`Con ${NOMBRES[estado().avatar] ?? 'AURA'}: lo mismo que el chat del notch, con voz o escrito.`, `With ${NOMBRES[estado().avatar] ?? 'AURA'}: same as the notch chat, by voice or text.`))),
      h('div', { class: 'acciones' }, botonIcono('callar', T('Callarla (deja de hablar)', 'Stop talking'), () => pedir('chat.callar')))),
    lista,
    h('div', null,
      h('div', { class: 'compositor' },
        mic,
        texto,
        botonIcono('enviar', T('Enviar (Enter)', 'Send (Enter)'), enviar, 'grande acento')),
      h('p', { class: 'compositor-pista' }, h('kbd', null, 'Enter'), T(' envía · ', ' sends · '), h('kbd', null, 'Shift'), ' ', h('kbd', null, 'Enter'), T(' salta línea', ' new line'))));
}

/** Pensando: el canto estriado de una moneda que se desplaza (en vez de tres puntitos). */
function pensando() {
  return h('span', { class: 'pensando', role: 'img', 'aria-label': T('Pensando…', 'Thinking…') },
    h('span', { class: 'estriado', 'aria-hidden': 'true' }), h('span', { 'aria-hidden': 'true' }, T('pensando', 'thinking')));
}
