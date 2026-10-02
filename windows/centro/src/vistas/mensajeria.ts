/**
 * La sección de mensajes del Centro: PULSE2CHAT y, para la cuenta dueña, su WhatsApp personal. José (2-oct):
 * «una opción aparte de PULSE2CHAT, slide y cambia».
 *
 *   · Arriba, el cambio [PULSE2CHAT | WhatsApp] (pestañas: clic, o ← → con el foco en ellas; Inicio/Fin).
 *   · Deslizar de lado también cambia: dos dedos en el panel táctil (rueda horizontal) o el dedo en una
 *     pantalla táctil. El panel nuevo entra deslizándose desde ese lado.
 *   · El cambio solo aparece si `whatsapp.estado` dice permitido: para cualquier otra cuenta (o sin servidor)
 *     la sección es PULSE2CHAT sola, como siempre.
 *
 * Los dos paneles se crean una vez y se conservan (PULSE2CHAT no pierde la llamada ni WhatsApp el borrador);
 * el escondido queda con `hidden`, así su IntersectionObserver lo ve fuera y deja de sondear. La sección sigue
 * siendo «pulse» para el resto (el notch abre «pulse»); «whatsapp» lleva aquí con WhatsApp al frente.
 */
import '../whatsapp/whatsapp.css';
import { h } from '../ui';
import { T, alCambiar, estado } from '../estado';
import { vistaPulse } from './pulse';
import { consultarEstado, vistaWhatsApp, type PanelWA } from './whatsapp';
import * as F from '../whatsapp/formato';

export type Panel = 'pulse' | 'whatsapp';
const PANELES: Panel[] = ['pulse', 'whatsapp'];
const CLAVE = 'centro.mensajeria';

let unica: HTMLElement | null = null;

/** ¿El gesto empezó en algo que ya se mueve de lado (un campo, una tira con desplazamiento horizontal)? Entonces no cambia. */
function seDesplazaDeLado(t: EventTarget | null): boolean {
  for (let el = t instanceof Element ? (t as HTMLElement) : null; el && el !== document.body; el = el.parentElement) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable) return true;
    if (el.scrollWidth > el.clientWidth + 2) {
      const o = getComputedStyle(el).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
  }
  return false;
}

/** Para main.ts: «ir a WhatsApp» (sección pulse con WhatsApp al frente, si está permitido). */
export function mostrarPanel(p: Panel) {
  window.dispatchEvent(new CustomEvent('centro:mensajeria', { detail: p }));
}

export function vistaMensajeria(): HTMLElement {
  if (unica) return unica;
  const raiz = h('div', { class: 'vista mx-vista' });
  unica = raiz;

  const pulse = vistaPulse();
  let wa: PanelWA | null = null;
  let actual: Panel = 'pulse';
  let quiere: Panel = leer();
  let ultimaConsulta = 0;
  let consultando = false;

  const insigniaWA = h('span', { class: 'mx-n' });
  insigniaWA.hidden = true;
  const pestanas = new Map<Panel, HTMLButtonElement>();
  const barra = h('div', { class: 'mx-barra', role: 'tablist', 'aria-label': T('Mensajería', 'Messaging') });
  for (const p of PANELES) {
    const b = h(
      'button',
      {
        type: 'button',
        role: 'tab',
        id: `mx-tab-${p}`,
        class: 'mx-tab ' + p,
        'aria-controls': `mx-panel-${p}`,
        title: p === 'pulse' ? T('PULSE2CHAT: tu chat cifrado de Orden Global', 'PULSE2CHAT: your encrypted Orden Global chat') : T('WhatsApp: tu WhatsApp personal', 'WhatsApp: your personal WhatsApp'),
        on: { click: () => cambiar(p, true), keydown: teclas },
      },
      h('i', { class: 'mx-punto', 'aria-hidden': 'true' }),
      p === 'pulse' ? 'PULSE2CHAT' : 'WhatsApp',
      p === 'whatsapp' ? insigniaWA : null,
    ) as HTMLButtonElement;
    pestanas.set(p, b);
    barra.append(b);
  }
  // La pastilla que se desliza bajo la pestaña elegida («slide y cambia»).
  const indicador = h('i', { class: 'mx-indicador', 'aria-hidden': 'true' });
  barra.prepend(indicador);
  barra.append(h('span', { class: 'mx-pista tenue', 'aria-hidden': 'true' }, T('desliza o usa ← →', 'swipe or use ← →')));
  const moverIndicador = () => {
    const b = pestanas.get(actual);
    if (!b || barra.hidden) return;
    indicador.style.width = b.offsetWidth + 'px';
    indicador.style.transform = `translateX(${b.offsetLeft - 4}px)`;
  };
  barra.hidden = true;

  pulse.id = 'mx-panel-pulse';
  pulse.setAttribute('role', 'tabpanel');
  pulse.setAttribute('aria-labelledby', 'mx-tab-pulse');
  raiz.append(barra, pulse);

  function leer(): Panel {
    try {
      return localStorage.getItem(CLAVE) === 'whatsapp' ? 'whatsapp' : 'pulse';
    } catch {
      return 'pulse';
    }
  }

  const hayWA = () => !!wa && wa.fase.get() !== 'oculto';

  /** Cambia de panel. `desdePersona`: lo pidió alguien (se recuerda para la próxima vez). */
  function cambiar(p: Panel, desdePersona = false, foco = false) {
    if (p === 'whatsapp' && !hayWA()) p = 'pulse';
    if (desdePersona) {
      quiere = p;
      try {
        localStorage.setItem(CLAVE, p);
      } catch {
        /* sin almacenamiento: da igual */
      }
    }
    pestanas.forEach((b, k) => {
      b.classList.toggle('activa', k === p);
      b.setAttribute('aria-selected', String(k === p));
      b.tabIndex = k === p ? 0 : -1;
    });
    if (foco) pestanas.get(p)?.focus();
    barra.classList.toggle('en-whatsapp', p === 'whatsapp');
    requestAnimationFrame(moverIndicador);
    if (p === actual && (p === 'pulse' ? !pulse.hidden : wa && !wa.el.hidden)) return;
    const haciaLaDerecha = PANELES.indexOf(p) > PANELES.indexOf(actual);
    actual = p;
    const entra = p === 'pulse' ? pulse : wa!.el;
    const sale = p === 'pulse' ? wa?.el : pulse;
    if (sale) sale.hidden = true;
    entra.hidden = false;
    entra.classList.remove('mx-entra-der', 'mx-entra-izq');
    void entra.offsetWidth; // reinicia la animación
    entra.classList.add(haciaLaDerecha ? 'mx-entra-der' : 'mx-entra-izq');
    raiz.classList.toggle('en-whatsapp', p === 'whatsapp');
  }

  function siguiente(paso: 1 | -1) {
    if (!hayWA()) return;
    const i = PANELES.indexOf(actual) + paso;
    if (i < 0 || i >= PANELES.length) return;
    cambiar(PANELES[i], true);
  }

  function teclas(e: KeyboardEvent) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const i = PANELES.indexOf(actual) + (e.key === 'ArrowRight' ? 1 : -1);
      if (i >= 0 && i < PANELES.length) cambiar(PANELES[i], true, true);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      cambiar(e.key === 'Home' ? 'pulse' : 'whatsapp', true, true);
    }
  }

  /* ── deslizar ── */
  // Panel táctil: dos dedos de lado (rueda horizontal). Se junta el desplazamiento y, pasado el umbral, cambia
  // una vez (con una pausa para no saltar dos). Dentro de algo que ya se desplaza de lado o de un campo, no.
  let acumulado = 0;
  let ultimoGiro = 0;
  let relojAcumulado: ReturnType<typeof setTimeout> | null = null;
  raiz.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      if (!hayWA() || Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.5 || seDesplazaDeLado(e.target)) return;
      acumulado += e.deltaX;
      if (relojAcumulado) clearTimeout(relojAcumulado);
      relojAcumulado = setTimeout(() => (acumulado = 0), 250);
      if (Math.abs(acumulado) > 140 && Date.now() - ultimoGiro > 700) {
        ultimoGiro = Date.now();
        siguiente(acumulado > 0 ? 1 : -1);
        acumulado = 0;
      }
    },
    { passive: true },
  );
  // Pantalla táctil o lápiz: un trazo de lado de más de 80 px (y no tanto hacia arriba o abajo).
  let toque: { x: number; y: number; t: number } | null = null;
  raiz.addEventListener('pointerdown', (e: PointerEvent) => {
    toque = e.pointerType !== 'mouse' && hayWA() && !seDesplazaDeLado(e.target) ? { x: e.clientX, y: e.clientY, t: Date.now() } : null;
  });
  raiz.addEventListener('pointerup', (e: PointerEvent) => {
    if (!toque) return;
    const dx = e.clientX - toque.x;
    const dy = e.clientY - toque.y;
    const rapido = Date.now() - toque.t < 800;
    toque = null;
    if (rapido && Math.abs(dx) > 80 && Math.abs(dy) < 60) siguiente(dx < 0 ? 1 : -1);
  });
  raiz.addEventListener('pointercancel', () => (toque = null));

  /* ── ¿hay WhatsApp para esta cuenta? ── */
  async function consultar() {
    if (consultando || !estado()?.sesion) return;
    consultando = true;
    ultimaConsulta = Date.now();
    const e = await consultarEstado();
    consultando = false;
    if (!e || F.fase(e) === 'oculto') {
      if (wa) wa.aplicar(e ?? { permitido: false });
      return;
    }
    if (!wa) crearWA(e);
    else wa.aplicar(e);
  }

  function crearWA(e: F.EstadoWA) {
    wa = vistaWhatsApp(e);
    wa.el.id = 'mx-panel-whatsapp';
    wa.el.setAttribute('role', 'tabpanel');
    wa.el.setAttribute('aria-labelledby', 'mx-tab-whatsapp');
    wa.el.hidden = true;
    raiz.append(wa.el);
    wa.noLeidos.sub((n) => {
      insigniaWA.textContent = F.insignia(n);
      insigniaWA.hidden = !n;
      requestAnimationFrame(moverIndicador);
    });
    wa.fase.sub(pintarBarra);
    pintarBarra();
    if (quiere === 'whatsapp') cambiar('whatsapp');
  }

  function pintarBarra() {
    const si = hayWA();
    barra.hidden = !si;
    raiz.classList.toggle('con-barra', si);
    if (!si && actual === 'whatsapp') cambiar('pulse');
    requestAnimationFrame(moverIndicador);
  }
  window.addEventListener('resize', () => requestAnimationFrame(moverIndicador));

  window.addEventListener('centro:mensajeria', (e) => {
    const p = (e as CustomEvent).detail === 'whatsapp' ? 'whatsapp' : 'pulse';
    if (p === 'whatsapp' && !wa) {
      quiere = 'whatsapp';
      void consultar();
    } else cambiar(p); // pedido desde afuera (una llamada, el notch): no cambia lo que eligió la persona
  });
  // Al volver a la sección, si no había WhatsApp se vuelve a mirar (como mucho cada 2 minutos).
  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver((es) => {
      if (es.some((x) => x.isIntersecting) && !hayWA() && Date.now() - ultimaConsulta > 120_000) void consultar();
    }).observe(raiz);
  }
  // Entró o salió la sesión: se vuelve a mirar.
  let conSesion = !!estado()?.sesion;
  alCambiar((e) => {
    if (!!e.sesion === conSesion) return;
    conSesion = !!e.sesion;
    void consultar();
  });

  cambiar('pulse');
  void consultar();
  return raiz;
}
