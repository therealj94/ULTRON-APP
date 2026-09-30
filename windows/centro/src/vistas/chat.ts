/** El chat con AURA en el Centro: el mismo del notch (las respuestas llegan mientras las escribe). */
import { h, botonIcono, vacio } from '../ui';
import { pedir, al } from '../puente';
import { estado, T, NOMBRES } from '../estado';

export function vistaChat(): HTMLElement {
  const lista = h('div', { class: 'chat-lista', role: 'log', 'aria-live': 'polite' });
  const burbujas = new Map<number, HTMLElement>();
  const vacioMsg = h('div', { class: 'tenue', style: 'text-align:center;margin:60px 0' },
    h('p', null, T('Pregúntale lo que quieras, o pídele cosas de tu computadora:', 'Ask anything, or ask for things on your PC:')),
    h('p', null, T('«Abre Excel» · «¿Qué hay en mi pantalla?» · «Redáctame un correo» · «¿Cuánto ORIGEN tengo?»', '“Open Excel” · “What’s on my screen?” · “Draft an email”')));
  lista.appendChild(vacioMsg);
  const texto = h('textarea', { rows: 1, placeholder: T('Escríbele a AURA… (Enter envía, Shift+Enter salta línea)', 'Type to AURA… (Enter sends)'), 'aria-label': T('Mensaje', 'Message'),
    style: 'resize:none;max-height:160px' }) as HTMLTextAreaElement;
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
    vacio(b).append(...(m.mio ? [] : [h('small', { class: 'quien' }, m.quien)]), h('div', null, m.texto || h('span', { class: 'cargando' })));
    lista.scrollTop = lista.scrollHeight;
  });

  return h('div', { class: 'vista chat' },
    h('div', { class: 'cabeza' }, h('div', null, h('h1', null, T('Chat con ', 'Chat with ') + (NOMBRES[estado().avatar] ?? 'AURA')), h('p', null, T('Lo mismo que el chat del notch: con voz o escrito.', 'Same as the notch chat.'))),
      h('div', { class: 'acciones' }, botonIcono('cerrar', T('Callarla (deja de hablar)', 'Stop talking'), () => pedir('chat.callar')))),
    lista,
    h('div', { class: 'compositor' },
      botonIcono('mic', T('Hablarle (Ctrl+Alt+Espacio)', 'Talk (Ctrl+Alt+Space)'), () => pedir('chat.hablar'), 'grande'),
      texto,
      botonIcono('enviar', T('Enviar (Enter)', 'Send (Enter)'), enviar, 'grande acento')));
}
