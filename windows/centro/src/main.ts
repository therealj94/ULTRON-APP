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
import { cerrarAura } from './cerrar';
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
let indicador: HTMLElement;
let actual = '';
const botones = new Map<string, HTMLButtonElement>();
const vistas = new Map<string, HTMLElement>();

/**
 * La placa del menú: una sola pieza que se desliza (solo `transform`) hasta la sección activa, con su
 * filo dorado. `sinAnimar` la pone en su sitio sin viaje (al abrir, o si cambia el tamaño de la ventana).
 */
function moverIndicador(sinAnimar = false) {
  const b = botones.get(actual);
  if (!b || !indicador) return;
  indicador.classList.toggle('quieto', sinAnimar);
  indicador.style.transform = `translate(${b.offsetLeft}px, ${b.offsetTop}px)`;
  indicador.style.opacity = '1';
  if (sinAnimar) requestAnimationFrame(() => requestAnimationFrame(() => indicador.classList.remove('quieto')));
}

/** Ir a una sección. Las vistas se crean una vez y se conservan (PULSE2CHAT no pierde la llamada al cambiar). */
export function ir(id: string) {
  // «whatsapp» no es una sección propia: vive en la de PULSE2CHAT (vistas/mensajeria.ts; ver irDesdeAfuera).
  if (id === 'whatsapp') id = 'pulse';
  const s = SECCIONES.find((x) => x.id === id) ?? SECCIONES[0];
  if (actual === s.id) return;
  const antes = SECCIONES.findIndex((x) => x.id === actual);
  const primera = !actual;
  actual = s.id;
  botones.forEach((b, k) => {
    b.classList.toggle('activo', k === s.id);
    if (k === s.id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  moverIndicador(primera);
  // La vista nueva entra desde el lado hacia el que se movió el menú (abajo → sube; arriba → baja).
  contenido.style.setProperty('--dir', antes < 0 || SECCIONES.indexOf(s) >= antes ? '1' : '-1');
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

/** Un botón de la barra que es solo ícono: su nombre (y para qué sirve) sale en una etiqueta al lado. */
function botonUtil(clase: string, nombre: string, explica: string, ico: string, alClic: () => void) {
  return h('button', { class: `nav util ${clase}`, 'aria-label': nombre, on: { click: alClic } }, icono(ico, 20),
    h('span', { class: 'tip', 'aria-hidden': 'true' }, h('strong', null, nombre), explica ? h('small', null, explica) : null));
}

function armazon() {
  indicador = h('span', { class: 'indicador', 'aria-hidden': 'true' });
  const lateral = h('nav', { class: 'lateral', 'aria-label': T('Secciones', 'Sections') },
    h('div', { class: 'marca', role: 'img', 'aria-label': 'AURA' }, h('span', null, 'A')), indicador);
  for (const s of SECCIONES) {
    const b = h('button', { class: 'nav', 'aria-label': T(s.es, s.en), on: { click: () => ir(s.id) } },
      icono(s.icono, 21), h('span', { class: 'nav-texto' + (T(s.es, s.en).length > 8 ? ' largo' : '') }, T(s.es, s.en))) as HTMLButtonElement;
    botones.set(s.id, b);
    lateral.appendChild(b);
  }
  // El recorrido, siempre a la vista: un botón propio en la barra, encima del de volver al notch.
  lateral.appendChild(h('div', { class: 'abajo' },
    botonUtil('nav-recorrido', T('Ver el recorrido', 'Watch the tour'), T('Claudio y ANT-ONIO te enseñan todo lo que hace AURA', 'Claudio and ANT-ONIO show you everything AURA does'),
      'play', () => window.dispatchEvent(new Event('centro:recorrido'))),
    botonUtil('', T('Volver al notch', 'Back to the notch'), T('AURA sigue contigo arriba', 'AURA stays with you up top'), 'notch', () => void recoger()),
    // Cerrar AURA del todo (notch, Centro, voz y bandeja): antes solo estaba escondido en el menú de la bandeja.
    botonUtil('nav-apagar', T('Cerrar AURA por completo', 'Quit AURA completely'), T('Notch, voz y bandeja', 'Notch, voice and tray'), 'apagar', () => void cerrarAura())));
  contenido = h('main', { class: 'contenido' });
  vacio(raiz).appendChild(h('div', { class: 'app' }, lateral, contenido));
  let inicial = 'inicio';
  try { inicial = localStorage.getItem('centro.seccion') || 'inicio'; } catch { /* nada */ }
  ir(inicial);
  addEventListener('resize', () => moverIndicador(true));
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
