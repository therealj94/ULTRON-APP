/**
 * El Centro de AURA para Windows: la ventana grande (WebView2) que se abre desde el notch. Entrada con
 * Genesis ID como la app, y adentro: Inicio, Chat, PULSE2CHAT, Música, Cartera y Ajustes. Al cerrarla
 * AURA sigue en el notch.
 */
import './estilos.css';
import { h, icono, vacio } from './ui';
import { al, pedir } from './puente';
import { cargar, estado, alCambiar, T } from './estado';
import { entrada, alEntrarConPase } from './vistas/entrada';
import { conectarConPase, iniciarPulse } from './pulse';
import './pulseVoz';
import * as RELEVO from './pulse/relevo';
import { autoConectarCartera } from './pulse/pagar';
import { vistaInicio } from './vistas/inicio';
import { vistaChat } from './vistas/chat';
import { vistaMensajeria, mostrarPanel } from './vistas/mensajeria';
import { vistaMusica } from './vistas/musica';
import { vistaCartera } from './vistas/cartera';
import { vistaAjustes } from './vistas/ajustes';
import { abrirRecorrido } from './recorrido/recorrido';

type Seccion = { id: string; es: string; en: string; icono: string; crear: () => HTMLElement };
export const SECCIONES: Seccion[] = [
  { id: 'inicio', es: 'Inicio', en: 'Home', icono: 'inicio', crear: vistaInicio },
  { id: 'chat', es: 'Chat', en: 'Chat', icono: 'chat', crear: vistaChat },
  // PULSE2CHAT y, para la cuenta dueña, su WhatsApp personal: misma sección, se cambia arriba (o deslizando).
  { id: 'pulse', es: 'PULSE2CHAT', en: 'PULSE2CHAT', icono: 'pulse', crear: vistaMensajeria },
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
  // «whatsapp» no es una sección propia: vive en la de PULSE2CHAT (vistas/mensajeria.ts; ver irDesdeAfuera).
  if (id === 'whatsapp') id = 'pulse';
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
  // El recorrido, siempre a la vista: un botón propio en la barra, encima del de volver al notch.
  lateral.appendChild(h('div', { class: 'abajo' },
    h('button', { class: 'nav nav-recorrido', title: T('Ver el recorrido: Claudio y ANT-ONIO te enseñan todo lo que hace AURA', 'Watch the tour: Claudio and ANT-ONIO show you everything AURA does'),
      'aria-label': T('Ver el recorrido', 'Watch the tour'), on: { click: () => window.dispatchEvent(new Event('centro:recorrido')) } }, icono('play', 22)),
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

/**
 * Lo que pide ir a una sección desde afuera (el notch, la voz, una vista): «pulse» trae además PULSE2CHAT al
 * frente (una llamada, un mensaje) y «whatsapp» el WhatsApp. El botón de la barra usa `ir` solo: vuelve a lo
 * último que se eligió arriba.
 */
function irDesdeAfuera(id: string) {
  ir(id);
  if (id === 'pulse' || id === 'whatsapp') mostrarPanel(id);
}
al<string>('ir', (id) => irDesdeAfuera(String(id)));
// Las vistas piden cambiar de sección o marcar una con un punto (PULSE2CHAT: mensaje o llamada nueva).
window.addEventListener('centro:ir', (e) => irDesdeAfuera(String((e as CustomEvent).detail)));
// El recorrido de Windows (Claudio y ANT-ONIO): desde Inicio, Ajustes o al terminar la guía.
export function verRecorrido() {
  const e = estado();
  return abrirRecorrido({ nombre: e.sesion?.nombre ?? '', idioma: e.idioma === 'en' ? 'en' : 'es' });
}
window.addEventListener('centro:recorrido', () => void verRecorrido());
al('recorrido', () => void verRecorrido());
window.addEventListener('centro:marcar', (e) => { const d = (e as CustomEvent).detail ?? {}; marcar(String(d.id), !!d.si); });
// El mismo pase de Genesis abre PULSE2CHAT (una vez) al entrar.
alEntrarConPase.fn = (pase, verificador, nombre, correo) => conectarConPase(pase, verificador, nombre, correo);
al('salio', () => location.reload());

(async () => {
  await cargar();
  const conRecorrido = !estado().sesion || estado().primeraVez ? (await entrada(raiz)) === 'recorrido' : false;
  armazon();
  if (conRecorrido) void verRecorrido();
  // PULSE2CHAT escucha siempre (llamadas y mensajes llegan aunque no estés en su sección).
  iniciarPulse(estado().sesion?.correo).then(() => autoConectarCartera()).catch(() => null);
  // La cartera se conecta sola con la dirección de tu ficha de PULSE2CHAT (la misma cuenta de Veta Wallet).
  RELEVO.escucharCuenta(() => void autoConectarCartera());
  alCambiar(() => { /* las vistas se actualizan solas con sus propios oyentes */ });
})();
