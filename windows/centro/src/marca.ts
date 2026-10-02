/**
 * La marca «Contraste» (windows/marca): el punzón de lingote con «AU» calado, el wordmark «AU·RA FP» y la
 * firma. La geometría es la de `windows/marca/geometria.txt`, tal cual. Se arma con el DOM (nada de
 * innerHTML) y cada copia lleva sus propios id de degradado, para que dos marcas en la misma página no se pisen.
 */
import { h } from './ui';

export const GEOMETRIA = {
  punzon: 'M100 20H412L492 100V412L412 492H100L20 412V100Z',
  biselInterior: 'M108 44H404L468 108V404L404 468H108L44 404V108Z',
  a: 'M84 376L160 136H214L290 376H238L224 332H150L136 376ZM162 292H212L187 210Z',
  u: 'M310 136H358V290Q358 334 380 334Q402 334 402 290V136H450V292Q450 382 380 382Q310 382 310 292Z',
};

const NS = 'http://www.w3.org/2000/svg';
let serie = 0;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...hijos: SVGElement[]): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  for (const c of hijos) e.appendChild(c);
  return e;
}

function degradado(id: string, paradas: [number, string][], vertical = false) {
  return el('linearGradient', { id, x1: 0, y1: 0, x2: vertical ? 0 : 1, y2: 1 },
    ...paradas.map(([o, c]) => el('stop', { offset: o, 'stop-color': c })));
}

/** Los colores del oro del punzón: los de marca.svg (son de la marca, no de la interfaz). */
const ORO: [number, string][] = [[0, '#EDD596'], [0.38, '#C99D48'], [0.72, '#9A7230'], [1, '#D6B262']];
const HUECO: [number, string][] = [[0, '#0E0B07'], [1, '#2A2114']];

/**
 * El punzón a todo color. `chica`: la versión para ≤ 32 px (sin el bisel, letras un poco más gruesas).
 * `escena`: agrega las piezas que anima la entrada (el canto estriado, el relleno de las letras antes del
 * golpe y el destello), con la caja ampliada para que quepa el canto.
 */
export function punzon(tam: number, o: { chica?: boolean; escena?: boolean; etiqueta?: string } = {}): SVGSVGElement {
  const n = ++serie;
  const idOro = `au-oro-${n}`, idHueco = `au-hueco-${n}`;
  const caja = o.escena ? '-56 -56 624 624' : '0 0 512 512';
  const svg = el('svg', { viewBox: caja, width: tam, height: tam, class: 'punzon' + (o.escena ? ' punzon-escena' : '') });
  if (o.etiqueta) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', o.etiqueta); } else svg.setAttribute('aria-hidden', 'true');
  svg.appendChild(el('defs', {}, degradado(idOro, ORO), degradado(idHueco, HUECO, true)));
  if (o.escena) {
    // El canto: un anillo de estrías finas (un trazo grueso punteado = rayitas radiales, como el canto de una moneda).
    svg.appendChild(el('g', { class: 'canto' },
      el('circle', { cx: 256, cy: 256, r: 292, fill: 'none', stroke: '#B8913F', 'stroke-width': 14, 'stroke-dasharray': '2 5.2', opacity: 0.85 }),
      el('circle', { cx: 256, cy: 256, r: 282, fill: 'none', stroke: '#B8913F', 'stroke-width': 1, opacity: 0.5 }),
      el('circle', { cx: 256, cy: 256, r: 302, fill: 'none', stroke: '#B8913F', 'stroke-width': 1, opacity: 0.5 })));
  }
  const cara = el('g', { class: 'cara' }, el('path', { d: GEOMETRIA.punzon, fill: `url(#${idOro})` }));
  if (!o.chica) cara.appendChild(el('path', { d: GEOMETRIA.biselInterior, fill: 'none', stroke: '#3B2C12', 'stroke-opacity': 0.55, 'stroke-width': 4 }));
  const letras = el('g', { fill: o.chica ? '#120E08' : `url(#${idHueco})`, class: 'calado' },
    el('path', { d: GEOMETRIA.a }), el('path', { d: GEOMETRIA.u }));
  if (o.chica) letras.setAttribute('transform', 'translate(256 256) scale(1.06) translate(-256 -256)');
  cara.appendChild(letras);
  if (o.escena) {
    // Antes del golpe la cara está lisa: las letras «rellenas» de oro se apagan en el golpe y queda el calado.
    cara.appendChild(el('g', { class: 'relleno', fill: `url(#${idOro})` }, el('path', { d: GEOMETRIA.a }), el('path', { d: GEOMETRIA.u })));
    cara.appendChild(el('path', { class: 'destello', d: GEOMETRIA.punzon, fill: '#E3C77E' }));
  }
  svg.appendChild(cara);
  return svg;
}

/** El punzón a una tinta (currentColor), para usos pequeños y de sello. */
export function punzonTinta(tam: number): SVGSVGElement {
  const svg = el('svg', { viewBox: '0 0 512 512', width: tam, height: tam, class: 'punzon-tinta', 'aria-hidden': 'true' });
  svg.appendChild(el('path', { 'fill-rule': 'evenodd', fill: 'currentColor', d: `${GEOMETRIA.punzon} ${GEOMETRIA.a} ${GEOMETRIA.u}` }));
  return svg;
}

/**
 * «AU·RA» en Plex Sans Condensed SemiBold y «FP» en Plex Mono al 45 %. `letras`: cada carácter en su
 * propio span (la entrada cierra el tracking moviéndolos, solo con transform).
 */
export function wordmark(o: { letras?: boolean; fp?: boolean } = {}): HTMLElement {
  const partes = ['A', 'U', '·', 'R', 'A'];
  const centro = (partes.length - 1) / 2;
  const cuerpo = o.letras
    ? partes.map((c, i) => h('span', { class: c === '·' ? 'wm-punto' : 'wm-l', style: `--d:${(i - centro).toFixed(1)}` }, c))
    : [h('span', null, 'AU'), h('span', { class: 'wm-punto' }, '·'), h('span', null, 'RA')];
  return h('span', { class: 'wordmark', role: 'img', 'aria-label': 'AU·RA FP' },
    h('span', { class: 'wm-nombre', 'aria-hidden': 'true' }, ...cuerpo),
    o.fp === false ? null : h('span', { class: 'wm-fp', 'aria-hidden': 'true' }, 'FP'));
}

/** «POWERED BY ORDEN GLOBAL»: Plex Mono 11, tracking +18 %, ceniza. */
export function firma(): HTMLElement {
  return h('p', { class: 'firma' }, 'POWERED BY ORDEN GLOBAL');
}
