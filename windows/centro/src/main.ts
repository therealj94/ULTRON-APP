/**
 * El Centro de AURA para Windows: la ventana grande (WebView2) que se abre desde el notch. Entrada con
 * Genesis ID como la app, y adentro: Inicio, Chat, PULSE2CHAT, Música, Cartera y Ajustes. Al cerrarla
 * AURA sigue en el notch.
 */
import './estilos.css';
import { h, icono, vacio } from './ui';
import { al, pedir } from './puente';
import { cargar, estado, alCambiar, T } from './estado';
import { entrada } from './vistas/entrada';
import { vistaInicio } from './vistas/inicio';
import { vistaChat } from './vistas/chat';
import { vistaPulse } from './vistas/pulse';
import { vistaMusica } from './vistas/musica';
import { vistaCartera } from './vistas/cartera';
import { vistaAjustes } from './vistas/ajustes';

type Seccion = { id: string; es: string; en: string; icono: string; crear: () => HTMLElement };
export const SECCIONES: Seccion[] = [
  { id: 'inicio', es: 'Inicio', en: 'Home', icono: 'inicio', crear: vistaInicio },
  { id: 'chat', es: 'Chat', en: 'Chat', icono: 'chat', crear: vistaChat },
  { id: 'pulse', es: 'PULSE2CHAT', en: 'PULSE2CHAT', icono: 'pulse', crear: vistaPulse },
  { id: 'musica', es: 'Música', en: 'Music', icono: 'musica', crear: vistaMusica },
  { id: 'cartera', es: 'Cartera', en: 'Wallet', icono: 'cartera', crear: vistaCartera },
  { id: 'ajustes', es: 'Ajustes', en: 'Settings', icono: 'ajustes', crear: vistaAjustes },
];

const raiz = document.getElementById('app')!;
let contenido: HTMLElement;
let actual = '';
const botones = new Map<string, HTMLButtonElement>();
const vistas = new Map<string, HTMLElement>();

/** Ir a una sección. Las vistas se crean una vez y se conservan (PULSE2CHAT no pierde la llamada al cambiar). */
export function ir(id: string) {
  const s = SECCIONES.find((x) => x.id === id) ?? SECCIONES[0];
  if (actual === s.id) return;
  actual = s.id;
  botones.forEach((b, k) => b.classList.toggle('activo', k === s.id));
  if (!vistas.has(s.id)) vistas.set(s.id, s.crear());
  vacio(contenido).appendChild(vistas.get(s.id)!);
  contenido.scrollTop = 0;
  try { localStorage.setItem('centro.seccion', s.id); } catch { /* sin almacenamiento: da igual */ }
}

/** Marca una sección con un punto (algo nuevo: un mensaje, una llamada perdida). */
export function marcar(id: string, si: boolean) {
  const b = botones.get(id);
  if (!b) return;
  b.querySelector('.punto')?.remove();
  if (si) b.appendChild(h('span', { class: 'punto' }));
}

function armazon() {
  const lateral = h('nav', { class: 'lateral', 'aria-label': 'Secciones' }, h('div', { class: 'marca', title: 'AURA' }));
  for (const s of SECCIONES) {
    const b = h('button', { class: 'nav', title: T(s.es, s.en), 'aria-label': T(s.es, s.en), on: { click: () => ir(s.id) } }, icono(s.icono, 22)) as HTMLButtonElement;
    botones.set(s.id, b);
    lateral.appendChild(b);
  }
  lateral.appendChild(h('div', { class: 'abajo' },
    h('button', { class: 'nav', title: T('Volver al notch (AURA sigue contigo arriba)', 'Back to the notch'), 'aria-label': T('Volver al notch', 'Back to the notch'),
      on: { click: () => recoger() } }, icono('notch', 22))));
  contenido = h('main', { class: 'contenido' });
  vacio(raiz).appendChild(h('div', { class: 'app' }, lateral, contenido));
  let inicial = 'inicio';
  try { inicial = localStorage.getItem('centro.seccion') || 'inicio'; } catch { /* nada */ }
  ir(inicial);
}

/** Se encoge hacia el notch y le pide a AURA ocultar la ventana. */
export async function recoger() {
  raiz.classList.add('encoger');
  await new Promise((r) => setTimeout(r, 520));
  await pedir('ventana.recoger').catch(() => {});
  raiz.classList.remove('encoger');
}

al<string>('ir', (id) => ir(id));
al('salio', () => location.reload());

(async () => {
  await cargar();
  if (!estado().sesion || estado().primeraVez) await entrada(raiz);
  armazon();
  alCambiar(() => { /* las vistas se actualizan solas con sus propios oyentes */ });
})();
