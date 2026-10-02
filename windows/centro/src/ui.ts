/**
 * Piezas de interfaz del Centro, sin framework: `h()` arma elementos, y las piezas de abajo son las
 * mismas en todas las vistas (tarjeta, botón, interruptor con su explicación, lista, aviso). Cada
 * botón lleva su texto o, si es solo un ícono, su `title` y `aria-label`: nada queda sin decir qué es.
 */

type Hijo = Node | string | number | null | undefined | false | Hijo[];
type Props = Record<string, any> & { class?: string; style?: string; on?: Record<string, (e: any) => void> };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...hijos: Hijo[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'on') for (const [ev, f] of Object.entries(v as Record<string, any>)) el.addEventListener(ev, f);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (k in el && typeof v !== 'string') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  agregar(el, hijos);
  return el;
}

function agregar(el: Node, hijos: Hijo[]) {
  for (const c of hijos) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) agregar(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Íconos de trazo (24×24), los mismos del notch. */
const TRAZOS: Record<string, string> = {
  inicio: 'M3 11 12 4l9 7v9h-6v-6H9v6H3Z',
  apagar: 'M12 3v9 M6.3 6.3a8 8 0 1 0 11.4 0',
  chat: 'M4 5h16v11h-9l-5 4v-4H4Z',
  pulse: 'M3 12h4l2-5 4 10 2-5h6',
  musica: 'M9 18V5l11-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  cartera: 'M3 7h18v12H3Z M3 7l3-3h12l3 3 M16 13h2',
  ajustes: 'M12 9a3 3 0 1 0 .01 0Z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M4.9 19.1l2.1-2.1 M17 7l2.1-2.1',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z M6 11a6 6 0 0 0 12 0 M12 17v4 M9 21h6',
  enviar: 'M12 19V5 M6 11l6-6 6 6',
  telefono: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z',
  video: 'M3 7h12v10H3Z M15 10l6-3v10l-6-3',
  colgar: 'M3 14c5-5 13-5 18 0l-3 3-3-2v-3a9 9 0 0 0-6 0v3l-3 2Z',
  buscar: 'M10 4a6 6 0 1 0 .01 0Z M14.5 14.5 20 20',
  play: 'M7 5 19 12 7 19Z', pausa: 'M8 5v14 M16 5v14',
  siguiente: 'M6 5 15 12 6 19Z M18 5v14', anterior: 'M18 5 9 12 18 19Z M6 5v14',
  cerrar: 'M6 6 18 18 M18 6 6 18', ok: 'M5 12l5 5 9-10', atras: 'M15 5 8 12l7 7',
  notch: 'M4 6h16 M8 6v3a4 4 0 0 0 8 0V6',
  campana: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4Z M10 20a2 2 0 0 0 4 0',
  persona: 'M12 4a4 4 0 1 0 .01 0Z M4 21a8 8 0 0 1 16 0',
  candado: 'M6 11h12v9H6Z M8 11V8a4 4 0 0 1 8 0v3',
  enlace: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1 M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
  actualizar: 'M20 11a8 8 0 1 0-2 5 M20 4v7h-7',
  mas: 'M12 5v14 M5 12h14',
  callar: 'M4 9h4l5-4v14l-5-4H4Z M16 9l5 6 M21 9l-5 6',
  volumen: 'M4 9h4l5-4v14l-5-4H4Z M16.5 8.5a5 5 0 0 1 0 7 M19 6a8.5 8.5 0 0 1 0 12',
  flecha: 'M9 6l6 6-6 6',
  info: 'M12 3a9 9 0 1 0 .01 0Z M12 11v6 M12 7.5v.5',
  alerta: 'M12 3a9 9 0 1 0 .01 0Z M12 7v6 M12 16.5v.5',
};

export function icono(nombre: keyof typeof TRAZOS | string, tam = 18): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', String(tam)); svg.setAttribute('height', String(tam));
  svg.setAttribute('aria-hidden', 'true'); svg.classList.add('ico');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', TRAZOS[nombre] ?? TRAZOS.mas);
  svg.appendChild(p);
  return svg;
}

export function boton(texto: string, alClic: (e: MouseEvent) => void, o: { tipo?: 'acento' | 'suave' | 'peligro' | 'fantasma'; icono?: string; titulo?: string; deshabilitado?: boolean } = {}) {
  return h('button', { class: `btn ${o.tipo ?? 'suave'}`, title: o.titulo ?? null, disabled: o.deshabilitado ?? false, on: { click: alClic } },
    o.icono ? icono(o.icono, 16) : null, texto ? h('span', null, texto) : null);
}

/** Botón de solo ícono: SIEMPRE con su descripción (title + aria-label). */
export function botonIcono(nombre: string, descripcion: string, alClic: (e: MouseEvent) => void, clase = '') {
  return h('button', { class: `btn-ico ${clase}`, title: descripcion, 'aria-label': descripcion, on: { click: alClic } }, icono(nombre, 18));
}

export function tarjeta(titulo: string | null, ...contenido: Hijo[]) {
  return h('section', { class: 'tarjeta' }, titulo ? h('h3', null, titulo) : null, ...contenido);
}

/** Un interruptor con su explicación debajo: qué hace, en palabras de persona. */
export function interruptor(titulo: string, explicacion: string, valor: boolean, cambiar: (v: boolean) => void) {
  const input = h('input', { type: 'checkbox', checked: valor, on: { change: (e: Event) => cambiar((e.target as HTMLInputElement).checked) } });
  return h('label', { class: 'opcion' },
    h('div', { class: 'opcion-texto' }, h('strong', null, titulo), h('small', null, explicacion)),
    h('span', { class: 'interruptor' }, input, h('span', { class: 'bola' })));
}

/** Opción de varias (pastillas), con explicación de cada una en su `title` y debajo la de la elegida. */
export function eleccion<T extends string>(titulo: string, opciones: { valor: T; texto: string; explica: string }[], valor: T, cambiar: (v: T) => void) {
  const explica = h('small', { class: 'explica' }, opciones.find((o) => o.valor === valor)?.explica ?? '');
  const fila = h('div', { class: 'pastillas', role: 'radiogroup', 'aria-label': titulo });
  for (const o of opciones) {
    const b = h('button', { class: 'pastilla' + (o.valor === valor ? ' activa' : ''), role: 'radio', 'aria-checked': String(o.valor === valor), title: o.explica,
      on: { click: () => { fila.querySelectorAll('.pastilla').forEach((x) => { x.classList.remove('activa'); x.setAttribute('aria-checked', 'false'); }); b.classList.add('activa'); b.setAttribute('aria-checked', 'true'); explica.textContent = o.explica; cambiar(o.valor); } } }, o.texto);
    fila.appendChild(b);
  }
  return h('div', { class: 'eleccion' }, h('strong', null, titulo), fila, explica);
}

let zonaAvisos: HTMLElement | null = null;
const ICONO_AVISO = { ok: 'ok', mal: 'alerta', info: 'info' } as const;
/**
 * Un aviso breve abajo a la derecha (lo que en el notch sería una isla): ícono según el tipo, una línea
 * fina que se consume mientras dura, y se quita antes con un clic.
 */
export function avisar(texto: string, tipo: 'ok' | 'mal' | 'info' = 'info', ms = 4200) {
  zonaAvisos ??= document.body.appendChild(h('div', { class: 'avisos', role: 'status', 'aria-live': 'polite' }));
  let fuera = false;
  const quitar = () => {
    if (fuera) return;
    fuera = true;
    a.classList.add('sale');
    setTimeout(() => a.remove(), 260);
  };
  const a = h('div', { class: `aviso ${tipo}`, style: `--ms:${ms}ms`, on: { click: quitar } },
    h('span', { class: 'aviso-ico' }, icono(ICONO_AVISO[tipo], 16)),
    h('span', { class: 'aviso-texto' }, texto),
    h('i', { class: 'aviso-tiempo', 'aria-hidden': 'true' }));
  zonaAvisos.appendChild(a);
  setTimeout(quitar, ms);
}

export function vacio(el: HTMLElement) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
