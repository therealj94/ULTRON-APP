/**
 * EL PLANO DE SITUACIÓN — dibujado en el servidor, sin navegador y sin teselas.
 *
 * El mapa de la ficha era una captura del lienzo de MapLibre: solo existía si el informe lo pedía
 * un navegador con el mapa abierto. Por Telegram —que es por donde más se piden— el PDF salía sin
 * mapa, y una ficha minera sin plano es media ficha. Además esa captura es una vista, no un plano:
 * sin cuadrícula, sin escala y sin norte no sirve para ubicar nada en el terreno.
 *
 * Esto dibuja un plano técnico con lo que hay en la base: la concesión resaltada, las vecinas, los
 * traslapes, ríos, áreas protegidas, microcuencas, caseríos y carretera, sobre cuadrícula UTM zona
 * 16N con sus coordenadas, barra de escala, flecha de norte, leyenda y título. Todo en metros UTM
 * (EPSG:32616), que es como se leen los planos del catastro hondureño: así la cuadrícula es recta y
 * la escala es la misma en todo el dibujo.
 *
 * Se arma como SVG (texto, auditable, se puede probar sin rasterizar) y se pasa a JPEG, que es lo
 * que el escritor de PDF incrusta tal cual (lib/pdf.ts, /DCTDecode).
 *
 * El rasterizador es @resvg/resvg-js y no sharp, por tres razones:
 *  · La tipografía se le da EXPLÍCITA (`fontFiles`, sin fuentes del sistema). sharp dibuja el texto
 *    con librsvg + fontconfig, que busca fuentes en el sistema: en un contenedor de Render sin
 *    fuentes, las etiquetas salen como cajas vacías o no salen, y eso no se ve hasta el PDF impreso.
 *  · Trae binarios precompilados por plataforma (linux-x64-gnu entre ellos) como dependencias
 *    opcionales: `npm ci` baja el que toca y no compila nada.
 *  · Pesa unos 5 MB frente a los ~30 de libvips, para una sola cosa que hace.
 * resvg da píxeles, no JPEG: la compresión la hace jpeg-js, JavaScript puro y sin binarios.
 *
 * La tipografía es Liberation Sans (SIL OFL 1.1, server/electrum/fuentes/), métricamente igual a la
 * Helvetica del PDF: el plano y el texto de la ficha se leen como un mismo documento.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Geometry, Position } from 'geojson';
import { conTextoReparado, consulta as consultaBase, hayBase } from './db';
import { mapearGeometria, utmWgsANad27, type Datum } from './datum';

/** Los rótulos, con los acentos de las capas reparados: el plano y la ficha dicen lo mismo. */
const consulta = <T = any>(sql: string, params: unknown[] = []) => consultaBase<T>(sql, params).then(conTextoReparado);
import { capasPorRol, nombreDe, NOMBRE_ROL, RADIO_POBLADOS_M } from './entorno';
import { relieveUtm } from './relieve';
import type { RolCapa } from './db';

/* ------------------------------------------------------------------ datos */

export type Rasgo = { nombre?: string | null; geom: Geometry };
export type PobladoPlano = Rasgo & { tipo: 'caserío' | 'aldea' | 'poblado' };

/** Todo en metros UTM 16N (EPSG:32616). */
export type DatosPlano = {
  titulo: string;
  subtitulo?: string;
  /** Lo que se ve: [xmin, ymin, xmax, ymax] en metros UTM. */
  vista: [number, number, number, number];
  /** Grados entre el norte de cuadrícula y el verdadero en el centro del plano (+ = el verdadero al oeste). */
  convergencia?: number;
  concesion: Rasgo & { etiqueta?: [number, number] };
  vecinas: Array<Rasgo & { etiqueta?: [number, number] }>;
  traslapes: Geometry[];
  rios: Rasgo[];
  areasProtegidas: Rasgo[];
  microcuencas: Rasgo[];
  forestal: Rasgo[];
  carretera: Rasgo[];
  municipios: Rasgo[];
  zonasInformales: Rasgo[];
  ocurrencias: Rasgo[];
  poblados: PobladoPlano[];
  /** Capas que no están cargadas: el plano lo dice en vez de dejar un hueco mudo. */
  faltan?: string[];
  /** Línea de pie: fecha, fuente. */
  pie?: string;
  /** Relieve sombreado del marco (`data:image/jpeg;base64,…`, de relieve.ts), debajo de todo. */
  relieve?: string | null;
  /** Dónde está, en lon/lat: el recuadro de ubicación en Honduras. */
  ubicacion?: [number, number];
  /** El cajetín: titular, expediente, estado, área… en pares [rótulo, valor]. */
  cajetin?: Array<[string, string]>;
  /** Rótulo de la leyenda para el polígono principal («Concesión» si no se dice). */
  etiquetaPrincipal?: string;
  /** En qué datum van las coordenadas del plano (WGS84 si no se dice). */
  datum?: Datum;
  /**
   * Plano para presentar (solicitud o requerimiento): el cajetín lleva la casilla de firma y sello
   * del ingeniero responsable, como la pide INHGEOMIN.
   */
  firma?: boolean;
  /** A quién se presenta («INHGEOMIN», «ICF», «SERNA»): va en el cajetín junto a la firma. */
  presentadoA?: string;
};

/* ------------------------------------------------------------------ lienzo */

export const ANCHO = 1600;
/** Con el cajetín debajo del marco (antes 1400). */
export const ALTO = 1580;
/** El cajetín: franja con los datos de la concesión, debajo de las coordenadas del marco. */
export const CAJETIN = { x: 60, y: 1340, w: ANCHO - 120, h: 170 };
/** El recuadro de ubicación, en la esquina inferior derecha del marco. */
export const UBICACION = { w: 240, h: 170 };
/** El marco del mapa. A la derecha va la columna de norte, escala y leyenda. */
export const MARCO = { x: 110, y: 150, w: 1060, h: 1130 };
export const PANEL = { x: 1210, w: 350 };
/** A qué ancho se imprime: la ficha lo pone a ancho de página (504 pt = 177,8 mm). */
const MM_IMPRESO = (504 * 25.4) / 72;

export const AMBAR = '#ffad3b';
export const AMBAR_OSCURO = '#a65f00';
export const FUENTE = 'Liberation Sans';

export const esc = (s: string) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/** Miles con espacio, como se escriben las coordenadas en un plano: «512 000». */
export const miles = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** El número «redondo» (1, 2, 2,5 o 5 por potencia de diez) más cercano por arriba. */
export function redondo(x: number): number {
  const p = 10 ** Math.floor(Math.log10(x));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= x) return m * p;
  return 10 * p;
}

/**
 * Cómo pasar de metros UTM a píxeles del marco. La escala es LA MISMA en los dos ejes —un plano
 * estirado miente sobre las formas y las distancias— y la vista se centra en el marco.
 */
export function transformador(vista: DatosPlano['vista']) {
  const [x1, y1, x2, y2] = vista;
  const s = Math.min(MARCO.w / (x2 - x1), MARCO.h / (y2 - y1));
  const ox = MARCO.x + (MARCO.w - (x2 - x1) * s) / 2;
  const oy = MARCO.y + (MARCO.h - (y2 - y1) * s) / 2;
  return {
    s,
    px: (x: number) => ox + (x - x1) * s,
    py: (y: number) => oy + (y2 - y) * s,
  };
}

type T = ReturnType<typeof transformador>;

function anillo(r: Position[], t: T, cerrar: boolean): string {
  let d = '';
  let ux = NaN;
  let uy = NaN;
  r.forEach((p, i) => {
    const x = t.px(p[0]);
    const y = t.py(p[1]);
    // Dos vértices en el mismo píxel no dibujan nada y engordan el SVG: se salta.
    if (i && Math.abs(x - ux) < 0.4 && Math.abs(y - uy) < 0.4) return;
    d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    ux = x;
    uy = y;
  });
  return cerrar ? `${d}Z` : d;
}

/** El trazado SVG de una geometría (sin los puntos, que se dibujan como símbolos). */
export function trazado(g: Geometry | null | undefined, t: T): string {
  if (!g) return '';
  switch (g.type) {
    case 'Polygon':
      return g.coordinates.map((r) => anillo(r, t, true)).join('');
    case 'MultiPolygon':
      return g.coordinates.map((p) => p.map((r) => anillo(r, t, true)).join('')).join('');
    case 'LineString':
      return anillo(g.coordinates, t, false);
    case 'MultiLineString':
      return g.coordinates.map((l) => anillo(l, t, false)).join('');
    case 'GeometryCollection':
      return g.geometries.map((x) => trazado(x, t)).join('');
    default:
      return '';
  }
}

/** Los puntos de una geometría, sea Point, MultiPoint o una colección. */
export function puntos(g: Geometry | null | undefined): Position[] {
  if (!g) return [];
  if (g.type === 'Point') return [g.coordinates];
  if (g.type === 'MultiPoint') return g.coordinates;
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(puntos);
  return [];
}

const esPoligono = (g: Geometry) => /Polygon/.test(g.type) || (g.type === 'GeometryCollection' && g.geometries.some(esPoligono));
const esLinea = (g: Geometry) => /LineString/.test(g.type);
const esPunto = (g: Geometry) => /Point/.test(g.type);

/** Texto con halo blanco, para que se lea encima de rayados y ríos. Dos pasadas: halo y letra. */
export function rotulo(x: number, y: number, texto: string, tam: number, color = '#1a1a1a', peso = 400, ancla = 'start'): string {
  const a = `x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${FUENTE}" font-size="${tam}" font-weight="${peso}" text-anchor="${ancla}"`;
  return (
    `<text ${a} fill="none" stroke="#ffffff" stroke-width="${Math.max(3, tam / 5)}" stroke-linejoin="round">${esc(texto)}</text>` +
    `<text ${a} fill="${color}">${esc(texto)}</text>`
  );
}

/** Ancho aproximado de un texto en Liberation Sans, para no encimar rótulos. */
export const anchoTexto = (s: string, tam: number, negrita = false) => s.length * tam * (negrita ? 0.58 : 0.53);

export type Caja = [number, number, number, number];
export const chocan = (a: Caja, b: Caja) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const dentroDelMarco = (x: number, y: number) => x >= MARCO.x && x <= MARCO.x + MARCO.w && y >= MARCO.y && y <= MARCO.y + MARCO.h;

/** Parte un texto en renglones de hasta `ancho` px. */
export function renglones(texto: string, ancho: number, tam: number): string[] {
  const out: string[] = [];
  let l = '';
  for (const w of texto.split(/\s+/)) {
    const c = l ? `${l} ${w}` : w;
    if (anchoTexto(c, tam) > ancho && l) {
      out.push(l);
      l = w;
    } else l = c;
  }
  if (l) out.push(l);
  return out;
}

/* ------------------------------------------------------------------ estilos */

type Estilo = { etiqueta: string; muestra: 'area' | 'linea' | 'punto' | 'cuadro' | 'rombo' | 'cruz'; atrs: string };

const ESTILOS = {
  concesion: { etiqueta: 'Concesión', muestra: 'area', atrs: `fill="${AMBAR}" fill-opacity="0.32" stroke="${AMBAR_OSCURO}" stroke-width="5" stroke-linejoin="round"` },
  vecinas: { etiqueta: 'Otras concesiones', muestra: 'area', atrs: 'fill="#9aa3ad" fill-opacity="0.14" stroke="#6b7580" stroke-width="2"' },
  traslapes: { etiqueta: 'Traslape con otro derecho', muestra: 'area', atrs: 'fill="url(#rayado-rojo)" stroke="#c62828" stroke-width="2.5"' },
  areasProtegidas: { etiqueta: 'Área protegida', muestra: 'area', atrs: 'fill="url(#rayado-verde)" stroke="#2e7d32" stroke-width="3"' },
  microcuencas: { etiqueta: 'Microcuenca declarada', muestra: 'area', atrs: 'fill="#26a69a" fill-opacity="0.12" stroke="#00796b" stroke-width="3" stroke-dasharray="14 7"' },
  forestal: { etiqueta: 'Patrimonio forestal', muestra: 'area', atrs: 'fill="url(#punteado-verde)" stroke="#7cb342" stroke-width="2" stroke-dasharray="3 5"' },
  carreteraFranja: { etiqueta: 'Carretera (franja de la capa)', muestra: 'area', atrs: 'fill="#c8a97e" fill-opacity="0.55" stroke="#8d6e46" stroke-width="1.5"' },
  carreteraEje: { etiqueta: 'Carretera', muestra: 'linea', atrs: 'fill="none" stroke="#8d4a1f" stroke-width="5" stroke-linecap="round"' },
  rios: { etiqueta: 'Río o quebrada', muestra: 'linea', atrs: 'fill="none" stroke="#1e88e5" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"' },
  municipios: { etiqueta: 'Límite municipal', muestra: 'linea', atrs: 'fill="none" stroke="#5f5f5f" stroke-width="2" stroke-dasharray="18 6 3 6"' },
  zonasInformales: { etiqueta: 'Zona de minería informal', muestra: 'area', atrs: 'fill="#fb8c00" fill-opacity="0.14" stroke="#e65100" stroke-width="2.5" stroke-dasharray="8 5"' },
  zonasInformalesPunto: { etiqueta: 'Zona de minería informal', muestra: 'cruz', atrs: 'stroke="#e65100" stroke-width="4"' },
  ocurrencias: { etiqueta: 'Yacimiento u ocurrencia', muestra: 'rombo', atrs: 'fill="#7b1fa2" stroke="#ffffff" stroke-width="2"' },
  caserio: { etiqueta: 'Caserío', muestra: 'punto', atrs: 'fill="#111111" stroke="#ffffff" stroke-width="2"' },
  aldea: { etiqueta: 'Aldea', muestra: 'cuadro', atrs: 'fill="#111111" stroke="#ffffff" stroke-width="2"' },
} satisfies Record<string, Estilo>;

function simbolo(tipo: Estilo['muestra'], x: number, y: number, atrs: string, r = 7): string {
  switch (tipo) {
    case 'cuadro':
      return `<rect x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}" width="${2 * r}" height="${2 * r}" ${atrs}/>`;
    case 'rombo':
      return `<path d="M${x.toFixed(1)} ${(y - r - 3).toFixed(1)}L${(x + r + 3).toFixed(1)} ${y.toFixed(1)}L${x.toFixed(1)} ${(y + r + 3).toFixed(1)}L${(x - r - 3).toFixed(1)} ${y.toFixed(1)}Z" ${atrs}/>`;
    case 'cruz':
      return `<path d="M${x - r} ${y - r}L${x + r} ${y + r}M${x - r} ${y + r}L${x + r} ${y - r}" ${atrs}/>`;
    default:
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r - 1}" ${atrs}/>`;
  }
}

function muestraLeyenda(e: Estilo, x: number, y: number): string {
  if (e.muestra === 'area') return `<rect x="${x}" y="${y - 14}" width="54" height="28" ${e.atrs}/>`;
  if (e.muestra === 'linea') return `<path d="M${x} ${y}L${x + 54} ${y}" ${e.atrs}/>`;
  return simbolo(e.muestra, x + 27, y, e.atrs);
}

/* ------------------------------------------------------------------ el SVG */

/**
 * Intervalo de cuadrícula: entre tres y seis líneas en el ancho del plano, y SIEMPRE múltiplo de
 * 100 m, para que cada línea caiga en una coordenada que termina en 00 (así los pide INHGEOMIN, y
 * así se leen los mapas 1:50 000). Antes, en una concesión chica, salía cada 50 o cada 25 m.
 */
export function intervaloCuadricula(anchoM: number): number {
  const r = redondo(anchoM / 6);
  return r <= 100 ? 100 : Math.round(r / 100) * 100;
}

/**
 * El plano pasado a NAD27 / UTM 16N. Llega en WGS84 / UTM 16N (así lo arma la base) y se corren
 * TODAS las coordenadas —vista, geometrías, puntos de rótulo— con el cambio de datum de
 * Centroamérica. En un plano de unos kilómetros el corrimiento es casi una traslación (unos 200 m
 * al sur), así que el relieve sombreado, que acompaña a la vista, sigue calzando.
 */
export function aNad27(d: DatosPlano): DatosPlano {
  if (d.datum === 'NAD27') return d;
  const g = (x: Geometry) => (x ? mapearGeometria(x, utmWgsANad27) : x);
  const r = <R extends Rasgo>(x: R): R => ({ ...x, geom: g(x.geom) });
  const et = (e?: [number, number]) => (e ? (utmWgsANad27(e) as [number, number]) : e);
  const [x1, y1, x2, y2] = d.vista;
  const a = utmWgsANad27([x1, y1]);
  const b = utmWgsANad27([x2, y2]);
  return {
    ...d,
    datum: 'NAD27',
    vista: [a[0], a[1], b[0], b[1]],
    concesion: { ...r(d.concesion), etiqueta: et(d.concesion.etiqueta) },
    vecinas: d.vecinas.map((v) => ({ ...r(v), etiqueta: et(v.etiqueta) })),
    traslapes: d.traslapes.map(g),
    rios: d.rios.map(r),
    areasProtegidas: d.areasProtegidas.map(r),
    microcuencas: d.microcuencas.map(r),
    forestal: d.forestal.map(r),
    carretera: d.carretera.map(r),
    municipios: d.municipios.map(r),
    zonasInformales: d.zonasInformales.map(r),
    ocurrencias: d.ocurrencias.map(r),
    poblados: d.poblados.map(r),
  };
}

/**
 * El plano en SVG. Función pura: los datos entran ya en metros UTM y sale texto, así que se puede
 * probar sin base, sin rasterizar y sin red.
 */
export function svgPlano(d: DatosPlano): string {
  const t = transformador(d.vista);
  const [x1, y1, x2, y2] = d.vista;
  const partes: string[] = [];
  const leyenda: Estilo[] = [];
  const usar = (e: Estilo) => {
    if (!leyenda.some((l) => l.etiqueta === e.etiqueta)) leyenda.push(e);
  };
  const capa = (rasgos: Rasgo[], e: Estilo, filtro: (g: Geometry) => boolean = () => true) => {
    const ds = rasgos.filter((r) => r.geom && filtro(r.geom)).map((r) => trazado(r.geom, t)).filter(Boolean);
    if (!ds.length) return;
    usar(e);
    // Un trazado por rasgo: juntos en uno solo con «evenodd», dos rasgos que se superponen (dos
    // traslapes sobre la misma franja, por ejemplo) se anulaban y la zona quedaba sin relleno.
    partes.push(`<g ${e.atrs}>${ds.map((x) => `<path d="${x}" fill-rule="evenodd"/>`).join('')}</g>`);
  };

  /* --- fondo y geografía, de abajo arriba --- */
  capa(d.municipios, ESTILOS.municipios);
  capa(d.forestal, ESTILOS.forestal, esPoligono);
  capa(d.areasProtegidas, ESTILOS.areasProtegidas, esPoligono);
  capa(d.microcuencas, ESTILOS.microcuencas, esPoligono);
  capa(d.carretera, ESTILOS.carreteraFranja, esPoligono);
  capa(d.vecinas, ESTILOS.vecinas, esPoligono);
  /*
   * La concesión en dos pasadas: el relleno por DEBAJO de ríos y carreteras —si no, el cauce que la
   * cruza, que es justo lo que hay que ver, sale lavado por el ámbar— y el lindero por encima de todo.
   */
  const dConcesion = trazado(d.concesion.geom, t);
  usar(d.etiquetaPrincipal ? { ...ESTILOS.concesion, etiqueta: d.etiquetaPrincipal } : ESTILOS.concesion);
  partes.push(`<path d="${dConcesion}" fill-rule="evenodd" fill="${AMBAR}" fill-opacity="0.30" stroke="none"/>`);
  capa(d.zonasInformales, ESTILOS.zonasInformales, esPoligono);
  capa(d.carretera, ESTILOS.carreteraEje, esLinea);
  capa(d.rios, ESTILOS.rios, esLinea);
  capa(d.traslapes.map((g) => ({ geom: g })), ESTILOS.traslapes);
  partes.push(`<path d="${dConcesion}" fill-rule="evenodd" fill="none" stroke="${AMBAR_OSCURO}" stroke-width="5" stroke-linejoin="round"/>`);

  /* --- símbolos puntuales --- */
  const zPuntos = d.zonasInformales.flatMap((z) => puntos(z.geom));
  if (zPuntos.length) {
    usar(ESTILOS.zonasInformalesPunto);
    for (const p of zPuntos) partes.push(simbolo('cruz', t.px(p[0]), t.py(p[1]), ESTILOS.zonasInformalesPunto.atrs, 9));
  }
  const oPuntos = d.ocurrencias.flatMap((o) => puntos(o.geom));
  if (oPuntos.length) {
    usar(ESTILOS.ocurrencias);
    for (const p of oPuntos) partes.push(simbolo('rombo', t.px(p[0]), t.py(p[1]), ESTILOS.ocurrencias.atrs, 7));
  }
  for (const p of d.poblados) {
    const e = p.tipo === 'aldea' ? ESTILOS.aldea : ESTILOS.caserio;
    for (const q of puntos(p.geom)) {
      usar(e);
      partes.push(simbolo(e.muestra, t.px(q[0]), t.py(q[1]), e.atrs, p.tipo === 'aldea' ? 8 : 7));
    }
  }

  /* --- barra de escala, abajo a la izquierda dentro del marco --- */
  const anchoVistaM = MARCO.w / t.s;
  const largoM = redondo(anchoVistaM / 5);
  const largoPx = largoM * t.s;
  const km = largoM >= 1000;
  // 2,5 km partido en cuatro da 1,25 en el medio: con decimales, no redondeado a «1».
  const unidad = (m: number) => (km ? new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(m / 1000) : miles(m));
  const bx = MARCO.x + 30;
  const by = MARCO.y + MARCO.h - 44;
  const tramos = 4;
  let escala = `<rect x="${bx - 16}" y="${by - 46}" width="${largoPx + 90}" height="78" fill="#ffffff" fill-opacity="0.85" stroke="#999" stroke-width="1"/>`;
  for (let i = 0; i < tramos; i++) {
    escala += `<rect x="${(bx + (i * largoPx) / tramos).toFixed(1)}" y="${by}" width="${(largoPx / tramos).toFixed(1)}" height="12" fill="${i % 2 ? '#ffffff' : '#111111'}" stroke="#111" stroke-width="1.5"/>`;
  }
  const etqEscala = (m: number, x: number) =>
    `<text x="${x.toFixed(1)}" y="${by - 10}" font-family="${FUENTE}" font-size="19" text-anchor="middle" fill="#111">${esc(unidad(m))}</text>`;
  escala += etqEscala(0, bx) + etqEscala(largoM / 2, bx + largoPx / 2) + etqEscala(largoM, bx + largoPx);
  escala += `<text x="${(bx + largoPx + 12).toFixed(1)}" y="${by + 12}" font-family="${FUENTE}" font-size="19" fill="#111">${km ? 'km' : 'm'}</text>`;
  // Escala numérica al ancho al que se imprime en la ficha: con dos cifras significativas basta.
  const denominador = (anchoVistaM * 1000) / (MM_IMPRESO * (MARCO.w / ANCHO));
  const p10 = 10 ** Math.max(0, Math.floor(Math.log10(denominador)) - 1);
  const escalaNumerica = `1:${miles(Math.round(denominador / p10) * p10)}`;

  /* --- rótulos, sin encimarse: primero la concesión, después lo demás por importancia --- */
  // La caja de la escala se reserva de entrada: un rótulo encima de la barra no se lee, y la barra tampoco.
  const ocupadas: Caja[] = [[bx - 16, by - 46, bx + largoPx + 74, by + 32]];
  // Ningún rótulo encima del recuadro de ubicación.
  if (d.ubicacion) ocupadas.push([MARCO.x + MARCO.w - UBICACION.w - 20, MARCO.y + MARCO.h - UBICACION.h - 20, MARCO.x + MARCO.w, MARCO.y + MARCO.h]);
  const poner = (x: number, y: number, texto: string, tam: number, color: string, peso = 400, ancla = 'start'): boolean => {
    const w = anchoTexto(texto, tam, peso > 500);
    const x0 = ancla === 'middle' ? x - w / 2 : ancla === 'end' ? x - w : x;
    const caja: Caja = [x0 - 3, y - tam, x0 + w + 3, y + tam * 0.3];
    if (caja[0] < MARCO.x + 4 || caja[2] > MARCO.x + MARCO.w - 4 || caja[1] < MARCO.y + 4 || caja[3] > MARCO.y + MARCO.h - 4) return false;
    if (ocupadas.some((o) => chocan(o, caja))) return false;
    ocupadas.push(caja);
    partes.push(rotulo(x, y, texto, tam, color, peso, ancla));
    return true;
  };
  if (d.concesion.etiqueta && d.concesion.nombre) {
    poner(t.px(d.concesion.etiqueta[0]), t.py(d.concesion.etiqueta[1]), d.concesion.nombre, 28, '#5a3300', 700, 'middle');
  }
  // Un caserío se rotula a la derecha; si ahí choca o se sale del marco, a la izquierda, arriba o abajo.
  for (const p of d.poblados.slice(0, 60)) {
    const [q] = puntos(p.geom);
    if (!q || !p.nombre) continue;
    const x = t.px(q[0]);
    const y = t.py(q[1]);
    void (
      poner(x + 11, y + 7, p.nombre, 19, '#111111') ||
      poner(x - 11, y + 7, p.nombre, 19, '#111111', 400, 'end') ||
      poner(x, y - 12, p.nombre, 19, '#111111', 400, 'middle') ||
      poner(x, y + 27, p.nombre, 19, '#111111', 400, 'middle')
    );
  }
  for (const v of d.vecinas.slice(0, 20)) {
    if (!v.etiqueta || !v.nombre) continue;
    const x = t.px(v.etiqueta[0]);
    const y = t.py(v.etiqueta[1]);
    if (dentroDelMarco(x, y)) poner(x, y, v.nombre, 18, '#4f5963', 400, 'middle');
  }
  // Los cauces con nombre, en el punto medio de su tramo más largo visible.
  const rotulados = new Set<string>();
  for (const r of [...d.rios].sort((a, b) => largo(b.geom) - largo(a.geom))) {
    if (!r.nombre || rotulados.has(r.nombre) || rotulados.size >= 5) continue;
    const m = medio(r.geom);
    if (m && poner(t.px(m[0]), t.py(m[1]) - 8, r.nombre, 18, '#0d5aa7', 400, 'middle')) rotulados.add(r.nombre);
  }

  /* --- cuadrícula UTM --- */
  const paso = intervaloCuadricula(x2 - x1);
  const cuadricula: string[] = [];
  const etiquetas: string[] = [];
  for (let x = Math.ceil(x1 / paso) * paso; x <= x2; x += paso) {
    const X = t.px(x);
    if (X < MARCO.x + 1 || X > MARCO.x + MARCO.w - 1) continue;
    cuadricula.push(`M${X.toFixed(1)} ${MARCO.y}L${X.toFixed(1)} ${MARCO.y + MARCO.h}`);
    // Pegado a una esquina, el rótulo se sale del marco y pisa al del otro eje: esa línea va sin rótulo.
    if (X < MARCO.x + 60 || X > MARCO.x + MARCO.w - 60) continue;
    etiquetas.push(`<text x="${X.toFixed(1)}" y="${MARCO.y + MARCO.h + 32}" font-family="${FUENTE}" font-size="20" text-anchor="middle" fill="#333">${miles(x)} E</text>`);
    etiquetas.push(`<text x="${X.toFixed(1)}" y="${MARCO.y - 12}" font-family="${FUENTE}" font-size="16" text-anchor="middle" fill="#777">${miles(x)}</text>`);
  }
  for (let y = Math.ceil(y1 / paso) * paso; y <= y2; y += paso) {
    const Y = t.py(y);
    if (Y < MARCO.y + 1 || Y > MARCO.y + MARCO.h - 1) continue;
    cuadricula.push(`M${MARCO.x} ${Y.toFixed(1)}L${MARCO.x + MARCO.w} ${Y.toFixed(1)}`);
    if (Y < MARCO.y + 75 || Y > MARCO.y + MARCO.h - 75) continue;
    etiquetas.push(
      `<text x="${MARCO.x - 14}" y="${Y.toFixed(1)}" font-family="${FUENTE}" font-size="20" text-anchor="middle" fill="#333" transform="rotate(-90 ${MARCO.x - 14} ${Y.toFixed(1)})">${miles(y)} N</text>`
    );
  }

  /* --- columna derecha: norte, escala, leyenda, notas --- */
  const panel: string[] = [];
  const cx = PANEL.x + PANEL.w / 2;
  panel.push(
    `<path d="M${cx} 180L${cx + 30} 290L${cx} 268L${cx - 30} 290Z" fill="#111" stroke="#111" stroke-width="2" stroke-linejoin="round"/>`,
    `<path d="M${cx} 180L${cx - 30} 290L${cx} 268Z" fill="#ffffff" stroke="#111" stroke-width="2" stroke-linejoin="round"/>`,
    `<text x="${cx}" y="170" font-family="${FUENTE}" font-size="36" font-weight="700" text-anchor="middle" fill="#111">N</text>`,
    `<text x="${cx}" y="322" font-family="${FUENTE}" font-size="18" text-anchor="middle" fill="#444">norte de cuadrícula</text>`
  );
  if (d.convergencia != null && isFinite(d.convergencia)) {
    const g = Math.abs(d.convergencia).toFixed(2).replace('.', ',');
    panel.push(
      `<text x="${cx}" y="346" font-family="${FUENTE}" font-size="16" text-anchor="middle" fill="#666">el verdadero, ${g}° al ${d.convergencia >= 0 ? 'oeste' : 'este'}</text>`
    );
  }
  panel.push(
    `<text x="${PANEL.x}" y="404" font-family="${FUENTE}" font-size="20" font-weight="700" fill="#111">Escala ${escalaNumerica}</text>`,
    `<text x="${PANEL.x}" y="428" font-family="${FUENTE}" font-size="16" fill="#666">impreso a ancho de página</text>`,
    `<text x="${PANEL.x}" y="452" font-family="${FUENTE}" font-size="16" fill="#666">cuadrícula cada ${miles(paso)} m</text>`,
    `<text x="${PANEL.x}" y="506" font-family="${FUENTE}" font-size="22" font-weight="700" fill="#111">Leyenda</text>`,
    `<path d="M${PANEL.x} 518L${PANEL.x + PANEL.w} 518" stroke="${AMBAR}" stroke-width="3"/>`
  );
  let ly = 556;
  // En el orden de ESTILOS (la concesión primero), no en el orden en que se dibujó cada capa.
  const orden = Object.values(ESTILOS) as Estilo[];
  leyenda.sort((a, b) => orden.indexOf(a) - orden.indexOf(b));
  for (const e of leyenda) {
    panel.push(muestraLeyenda(e, PANEL.x, ly));
    panel.push(`<text x="${PANEL.x + 70}" y="${ly + 7}" font-family="${FUENTE}" font-size="20" fill="#111">${esc(e.etiqueta)}</text>`);
    ly += 44;
  }
  if (d.faltan?.length) {
    ly += 16;
    const nota = `Capas no cargadas (no se dibujan): ${d.faltan.join(', ')}.`;
    for (const r of renglones(nota, PANEL.w, 17)) {
      if (ly > MARCO.y + MARCO.h) break;
      panel.push(`<text x="${PANEL.x}" y="${ly}" font-family="${FUENTE}" font-size="17" fill="#8a4b00">${esc(r)}</text>`);
      ly += 22;
    }
  }

  const titulo = `<text x="60" y="64" font-family="${FUENTE}" font-size="40" font-weight="700" fill="#141414">${esc(d.titulo)}</text>`;
  const subtitulo = d.subtitulo
    ? `<text x="60" y="104" font-family="${FUENTE}" font-size="24" fill="#5c5c5c">${esc(d.subtitulo)}</text>`
    : '';
  const pie = `<text x="60" y="${ALTO - 36}" font-family="${FUENTE}" font-size="19" fill="#555">${esc(
    `${d.datum === 'NAD27' ? 'NAD27 / UTM zona 16N (EPSG:26716), cambio de datum de Centroamérica' : 'WGS 84 / UTM zona 16N (EPSG:32616)'} · coordenadas en metros${d.pie ? ` · ${d.pie}` : ''}`
  )}</text>`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ANCHO}" height="${ALTO}" viewBox="0 0 ${ANCHO} ${ALTO}">`,
    '<defs>',
    '<pattern id="rayado-verde" patternUnits="userSpaceOnUse" width="14" height="14" patternTransform="rotate(45)"><rect width="14" height="14" fill="#2e7d32" fill-opacity="0.08"/><path d="M0 0L0 14" stroke="#2e7d32" stroke-width="3" stroke-opacity="0.55"/></pattern>',
    '<pattern id="rayado-rojo" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(-45)"><rect width="10" height="10" fill="#e53935" fill-opacity="0.18"/><path d="M0 0L0 10" stroke="#c62828" stroke-width="3"/></pattern>',
    '<pattern id="punteado-verde" patternUnits="userSpaceOnUse" width="16" height="16"><circle cx="8" cy="8" r="2.2" fill="#7cb342" fill-opacity="0.7"/></pattern>',
    `<clipPath id="marco"><rect x="${MARCO.x}" y="${MARCO.y}" width="${MARCO.w}" height="${MARCO.h}"/></clipPath>`,
    '</defs>',
    `<rect width="${ANCHO}" height="${ALTO}" fill="#ffffff"/>`,
    `<rect x="${MARCO.x}" y="${MARCO.y}" width="${MARCO.w}" height="${MARCO.h}" fill="#fbfaf6"/>`,
    `<path d="M0 120L${ANCHO} 120" stroke="${AMBAR}" stroke-width="4"/>`,
    titulo,
    subtitulo,
    `<g clip-path="url(#marco)">`,
    d.relieve ? `<image href="${d.relieve}" x="${MARCO.x}" y="${MARCO.y}" width="${MARCO.w}" height="${MARCO.h}" preserveAspectRatio="none" opacity="0.85"/>` : '',
    `<path d="${cuadricula.join('')}" stroke="#b9b9b9" stroke-width="1.2" fill="none"/>`,
    ...partes,
    escala,
    '</g>',
    `<rect x="${MARCO.x}" y="${MARCO.y}" width="${MARCO.w}" height="${MARCO.h}" fill="none" stroke="#222" stroke-width="2.5"/>`,
    ...etiquetas,
    ...panel,
    d.ubicacion ? svgUbicacion(d.ubicacion[0], d.ubicacion[1]) : '',
    d.cajetin?.length || d.firma ? svgCajetin(d.cajetin || [], d.firma ? { presentadoA: d.presentadoA, datum: d.datum } : null) : '',
    pie,
    '</svg>',
  ].join('\n');
}

function largo(g: Geometry): number {
  const l = (c: Position[]) => c.reduce((n, p, i) => (i ? n + Math.hypot(p[0] - c[i - 1][0], p[1] - c[i - 1][1]) : 0), 0);
  if (g.type === 'LineString') return l(g.coordinates);
  if (g.type === 'MultiLineString') return Math.max(0, ...g.coordinates.map(l));
  return 0;
}

function medio(g: Geometry): Position | null {
  const c = g.type === 'LineString' ? g.coordinates : g.type === 'MultiLineString' ? [...g.coordinates].sort((a, b) => b.length - a.length)[0] : null;
  return c && c.length ? c[Math.floor(c.length / 2)] : null;
}

/* ------------------------------------------------------------------ a JPEG */

const DIR_FUENTES = path.join(process.cwd(), 'server', 'electrum', 'fuentes');

/** Honduras (Natural Earth, dominio público, simplificado a ~1 km) para el recuadro de ubicación. */
let contorno: number[][][] | null = null;
function contornoHonduras(): number[][][] {
  if (!contorno) {
    try {
      contorno = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'server', 'electrum', 'honduras-contorno.json'), 'utf8')).anillos;
    } catch {
      contorno = [];
    }
  }
  return contorno!;
}

/** El recuadro: Honduras entera con una marca donde está la concesión. */
function svgUbicacion(lon: number, lat: number): string {
  // Esquina inferior DERECHA: la izquierda es de la barra de escala.
  const x0 = MARCO.x + MARCO.w - UBICACION.w - 14;
  const y0 = MARCO.y + MARCO.h - UBICACION.h - 14;
  const [w, h] = [UBICACION.w, UBICACION.h];
  const bb = [-89.45, 12.9, -83.05, 16.55];
  const k = Math.cos((14.7 * Math.PI) / 180);
  const esc = Math.min((w - 20) / ((bb[2] - bb[0]) * k), (h - 34) / (bb[3] - bb[1]));
  const X = (l: number) => x0 + 10 + (l - bb[0]) * k * esc;
  const Y = (f: number) => y0 + 24 + (bb[3] - f) * esc;
  const tierra = contornoHonduras()
    .map((a) => `M${a.map(([l, f]) => `${X(l).toFixed(1)} ${Y(f).toFixed(1)}`).join('L')}Z`)
    .join('');
  return [
    `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#ffffff" fill-opacity="0.92" stroke="#222" stroke-width="1.5"/>`,
    `<text x="${x0 + 10}" y="${y0 + 18}" font-family="${FUENTE}" font-size="15" font-weight="700" fill="#333">Ubicación en Honduras</text>`,
    tierra ? `<path d="${tierra}" fill="#e9e4d6" stroke="#7a7466" stroke-width="1"/>` : '',
    `<circle cx="${X(lon).toFixed(1)}" cy="${Y(lat).toFixed(1)}" r="9" fill="none" stroke="#c62828" stroke-width="3"/>`,
    `<circle cx="${X(lon).toFixed(1)}" cy="${Y(lat).toFixed(1)}" r="3" fill="#c62828"/>`,
  ].join('');
}

/** El cajetín: los datos de la concesión en celdas, como el rótulo de un plano de ingeniería. */
function svgCajetin(pares: Array<[string, string]>, firma: { presentadoA?: string; datum?: Datum } | null = null): string {
  const { x, y, h } = CAJETIN;
  // Con firma, la casilla del ingeniero ocupa la punta derecha y los datos se reparten en el resto.
  const anchoFirma = firma ? 380 : 0;
  const w = CAJETIN.w - anchoFirma;
  const cols = firma ? 3 : 4;
  const filas = Math.max(1, Math.ceil(pares.length / cols));
  const cw = w / cols;
  const fh = h / filas;
  const celdas = pares.map(([k, v], i) => {
    const cx = x + (i % cols) * cw;
    const cy = y + Math.floor(i / cols) * fh;
    const valor = v.length > 38 ? `${v.slice(0, 37)}…` : v;
    return (
      `<text x="${cx + 14}" y="${cy + 26}" font-family="${FUENTE}" font-size="15" fill="#777">${esc(k.toUpperCase())}</text>` +
      `<text x="${cx + 14}" y="${cy + 56}" font-family="${FUENTE}" font-size="21" font-weight="700" fill="#1a1a1a">${esc(valor)}</text>`
    );
  });
  const lineas: string[] = [];
  for (let c = 1; c < cols; c++) lineas.push(`M${x + c * cw} ${y}L${x + c * cw} ${y + h}`);
  for (let f = 1; f < filas; f++) lineas.push(`M${x} ${y + f * fh}L${x + w} ${y + f * fh}`);
  const casilla: string[] = [];
  if (firma) {
    const fx = x + w;
    casilla.push(
      `<rect x="${fx}" y="${y}" width="${anchoFirma}" height="${h}" fill="#ffffff" stroke="#222" stroke-width="2.5"/>`,
      `<text x="${fx + 14}" y="${y + 24}" font-family="${FUENTE}" font-size="15" font-weight="700" fill="#1a1a1a">FIRMA Y SELLO DEL INGENIERO RESPONSABLE</text>`,
      // El recuadro del sello y la raya de la firma: en blanco, para llenar a mano.
      `<rect x="${fx + anchoFirma - 118}" y="${y + 36}" width="104" height="104" fill="none" stroke="#999" stroke-width="1.5" stroke-dasharray="6 5"/>`,
      `<text x="${fx + anchoFirma - 66}" y="${y + 94}" font-family="${FUENTE}" font-size="13" text-anchor="middle" fill="#aaa">SELLO</text>`,
      `<path d="M${fx + 14} ${y + 96}L${fx + anchoFirma - 132} ${y + 96}" stroke="#555" stroke-width="1.2"/>`,
      `<text x="${fx + 14}" y="${y + 114}" font-family="${FUENTE}" font-size="13" fill="#777">Nombre y firma</text>`,
      `<text x="${fx + 14}" y="${y + 138}" font-family="${FUENTE}" font-size="13" fill="#777">N.º de colegiado: ____________</text>`,
      `<text x="${fx + 14}" y="${y + 160}" font-family="${FUENTE}" font-size="13" fill="#777">${esc(
        `${firma.presentadoA ? `Para ${firma.presentadoA} · ` : ''}${firma.datum === 'NAD27' ? 'NAD27 UTM 16N' : 'WGS84 UTM 16N'}`
      )}</text>`
    );
  }
  return [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff" stroke="#222" stroke-width="2.5"/>`,
    `<path d="${lineas.join('')}" stroke="#bbb" stroke-width="1.2"/>`,
    `<path d="M${x} ${y}L${x + CAJETIN.w} ${y}" stroke="${AMBAR}" stroke-width="5"/>`,
    ...celdas,
    ...casilla,
  ].join('');
}
export const FUENTES = ['LiberationSans-Regular.ttf', 'LiberationSans-Bold.ttf'].map((f) => path.join(DIR_FUENTES, f));

/**
 * SVG → JPEG. La tipografía se carga explícita y SIN las del sistema: así el plano sale igual en
 * esta máquina, en CI y en Render, tenga o no fuentes instaladas. Si alguien borra las fuentes del
 * repo, se cae a las del sistema y se avisa: un plano con rótulos en otra letra es mejor que ninguno.
 *
 * resvg se carga a demanda: si su binario no está para esta plataforma, falla el plano —y la ficha
 * sale sin él, diciéndolo—, no el arranque del servidor entero.
 */
export async function jpegDeSvg(svg: string, calidad = 88): Promise<Buffer> {
  const { Resvg } = await import('@resvg/resvg-js');
  const jpeg = (await import('jpeg-js')).default;
  const hay = FUENTES.every((f) => fs.existsSync(f));
  if (!hay) console.warn('[electrum] faltan las fuentes del plano en', DIR_FUENTES, '— uso las del sistema');
  const r = new Resvg(svg, {
    background: '#ffffff',
    fitTo: { mode: 'original' },
    font: hay ? { fontFiles: FUENTES, loadSystemFonts: false, defaultFontFamily: FUENTE } : { loadSystemFonts: true },
  });
  const img = r.render();
  // Fondo blanco opaco: todos los alfa son 255 y los píxeles RGBA van tal cual al codificador.
  return jpeg.encode({ data: img.pixels, width: img.width, height: img.height }, calidad).data;
}

/* ------------------------------------------------------------------ desde la base */

/**
 * Lo que hace falta para el plano de una concesión, sacado de PostGIS ya en metros UTM.
 *
 * La vista es la caja de la concesión con aire alrededor (un 35 % de su lado mayor, y nunca menos de
 * los 2 km en que la ficha cuenta caseríos), ajustada a la proporción del marco. Cada capa
 * se recorta a esa vista ANTES de reproyectar —pasar un departamento entero a UTM para quedarse con
 * un cuadrito es trabajo tirado— y se simplifica a medio píxel: más detalle no se ve.
 */
/** Un área que no está en el catastro (dibujada en el mapa para pedirla): su polígono y su nombre. */
export type AreaPlano = { geojson: Geometry; nombre: string; ubicacion?: string };

export async function datosPlano(
  objetivo: number | AreaPlano,
  opts: { subtitulo?: string; pie?: string; relieve?: boolean } = {}
): Promise<DatosPlano | null> {
  if (!hayBase()) return null;
  // Un id puede llegar como texto: pg devuelve los bigint así. Solo un objeto es un área dibujada.
  const area = objetivo && typeof objetivo === 'object' ? objetivo : null;
  const id = area ? -1 : Number(objetivo);
  if (!area && !(Number.isSafeInteger(id) && id > 0)) return null;
  const COLUMNAS = `ST_AsGeoJSON(u, 1) AS g, ST_XMin(u) x1, ST_YMin(u) y1, ST_XMax(u) x2, ST_YMax(u) y2,
            ST_X(ST_PointOnSurface(u)) ex, ST_Y(ST_PointOnSurface(u)) ey,
            ST_X(ST_Centroid(geom)) lon, ST_Y(ST_Centroid(geom)) lat, ST_IsEmpty(geom) vacia`;
  const [c] = await consulta<{
    nombre: string; g: string; x1: number; y1: number; x2: number; y2: number; ex: number; ey: number; lon: number; lat: number; vacia: boolean;
    titular: string | null; expediente: string | null; estado: string | null; ha: number | null; vence: string | null; municipio: string | null; departamento: string | null;
  }>(
    area
      ? `SELECT $2::text AS nombre, NULL::text AS titular, NULL::text AS expediente, NULL::text AS estado, (ST_Area(geom::geography) / 10000.0)::float8 AS ha,
                NULL::text AS vence, NULL::text AS municipio, NULL::text AS departamento, ${COLUMNAS}
           FROM (SELECT geom, ST_Transform(geom, 32616) AS u FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS geom) s) t`
      : `SELECT nombre, titular, expediente, estado, hectareas::float8 AS ha, to_char(vence, 'DD/MM/YYYY') AS vence, municipio, departamento, ${COLUMNAS}
           FROM (SELECT nombre, titular, expediente, estado, hectareas, vence, municipio, departamento, geom, ST_Transform(geom, 32616) AS u
                   FROM concesion WHERE id = $1) t`,
    area ? [JSON.stringify(area.geojson), area.nombre] : [id]
  );
  if (!c || c.vacia) return null;

  // La vista, con la proporción del marco.
  const dx = c.x2 - c.x1;
  const dy = c.y2 - c.y1;
  // Al menos el radio de los caseríos que cuenta la ficha: un caserío «a 1 km» que no sale en el
  // plano hace dudar de los dos.
  const aire = Math.max(0.35 * Math.max(dx, dy), RADIO_POBLADOS_M);
  let w = dx + 2 * aire;
  let h = dy + 2 * aire;
  const prop = MARCO.w / MARCO.h;
  if (w / h < prop) w = h * prop;
  else h = w / prop;
  const mx = (c.x1 + c.x2) / 2;
  const my = (c.y1 + c.y2) / 2;
  const vista: DatosPlano['vista'] = [mx - w / 2, my - h / 2, mx + w / 2, my + h / 2];
  const tol = (w / MARCO.w) * 0.5;

  const capas = await capasPorRol();
  const de = (rol: RolCapa) => capas.filter((x) => x.rol === rol).map((x) => x.id);
  const tipoPoblado = new Map(
    capas.filter((x) => x.rol === 'poblado').map((x) => {
      const n = x.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      return [x.id, (/caserio/.test(n) ? 'caserío' : /aldea/.test(n) ? 'aldea' : 'poblado') as PobladoPlano['tipo']];
    })
  );

  const V = `v AS (SELECT ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 32616), 4326) AS env)`;
  const params = [...vista];
  const recorte = (col: string) =>
    `ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_Transform(ST_ClipByBox2D(${col}, v.env::box2d), 32616), ${tol}), 1)`;

  /** Una capa de geografía dentro de la vista. */
  const enVista = async (rol: RolCapa, limite: number, soloBorde = false) => {
    const ids = de(rol);
    if (!ids.length) return [] as Array<{ nombre: string | null; g: string; capa_id: string }>;
    // El nombre, con la misma regla que la ficha: el rótulo del plano y la tabla dicen lo mismo.
    return consulta<{ nombre: string | null; g: string; capa_id: string }>(
      `WITH ${V}
       SELECT ${nombreDe(rol)} AS nombre, ${recorte(soloBorde ? 'ST_Boundary(e.geom)' : 'e.geom')} AS g, e.capa_id::text
         FROM entidad_geo e, v
        WHERE e.capa_id = ANY($5) AND e.geom && v.env
        LIMIT ${limite}`,
      [...params, ids]
    );
  };
  const aRasgos = (filas: Array<{ nombre: string | null; g: string }>): Rasgo[] =>
    filas.map((f) => ({ nombre: f.nombre, geom: JSON.parse(f.g) as Geometry })).filter((r) => r.geom && !vacia(r.geom));

  const [vecinas, traslapes, rios, ap, micro, forestal, carretera, municipios, zonas, ocurrencias, poblados] = await Promise.all([
    consulta<{ nombre: string; g: string; ex: number; ey: number }>(
      `WITH ${V}
       SELECT c.nombre, ${recorte('c.geom')} AS g,
              ST_X(ST_Transform(ST_PointOnSurface(c.geom), 32616)) ex, ST_Y(ST_Transform(ST_PointOnSurface(c.geom), 32616)) ey
         FROM concesion c, v
        WHERE c.id <> $5 AND c.geom && v.env AND NOT ST_IsEmpty(c.geom)
        LIMIT 300`,
      [...params, id]
    ),
    area
      ? // Un área que se piensa pedir: lo que pisa de cada concesión vigente, calculado ahora.
        consulta<{ g: string }>(
          `WITH ${V}, a AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($5), 4326) AS g)
           SELECT ${recorte('ST_Intersection(c.geom, a.g)')} AS g FROM concesion c, v, a
            WHERE c.geom && a.g AND ST_Intersects(c.geom, a.g)
            LIMIT 200`,
          [...params, JSON.stringify(area.geojson)]
        )
      : consulta<{ g: string }>(
          `WITH ${V}
           SELECT ${recorte('t.geom')} AS g FROM traslape t, v
            WHERE (t.a_id = $5 OR t.b_id = $5) AND t.geom IS NOT NULL AND t.geom && v.env`,
          [...params, id]
        ),
    enVista('rio', 4000),
    enVista('area_protegida', 200),
    enVista('microcuenca', 200),
    enVista('forestal', 400),
    enVista('carretera', 800),
    // De un municipio se dibuja el LÍMITE: recortado a la vista, un polígono que la cubre entera deja
    // sus bordes sobre el marco, y la leyenda anunciaría un límite que no se ve.
    enVista('municipio', 50, true),
    enVista('zona_informal', 300),
    enVista('ocurrencia', 500),
    enVista('poblado', 800),
  ]);

  // Convergencia de meridianos en el centro: γ = atan(tan(λ − λ0) · sen φ), con λ0 = −87° (zona 16).
  const rad = Math.PI / 180;
  const gamma = Math.atan(Math.tan((c.lon + 87) * rad) * Math.sin(c.lat * rad)) / rad;

  const faltan = (['rio', 'area_protegida', 'microcuenca', 'poblado', 'carretera'] as RolCapa[]).filter((r) => !de(r).length).map((r) => NOMBRE_ROL[r]);

  // El relieve es fondo: si el modelo de elevación no contesta a tiempo, el plano sale sin él.
  const relieve = opts.relieve === false ? null : await relieveUtm(vista, Math.round(MARCO.w / 2), Math.round(MARCO.h / 2)).catch(() => null);
  const lugar = area?.ubicacion || [c.municipio, c.departamento].filter(Boolean).join(', ');
  const hoy = new Date().toLocaleDateString('es-HN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Tegucigalpa' });
  const nfHa = (x: number) => `${new Intl.NumberFormat('es-HN', { maximumFractionDigits: 2 }).format(x)} ha`;
  const cajetin: Array<[string, string]> = area
    ? [
        ['Solicitante', '—'],
        ['Expediente', 'sin presentar'],
        ['Estado', 'Área propuesta'],
        ['Área medida', c.ha != null ? nfHa(c.ha) : '—'],
        ['Ubicación', lugar || '—'],
        ['Traslapes', traslapes.length ? `${traslapes.length} con concesiones` : 'ninguno'],
        ['Datum', 'WGS 84 / UTM 16N'],
        ['Elaborado', `Dr Electrum FP · ${hoy}`],
      ]
    : [
    ['Titular', c.titular || '—'],
    ['Expediente', c.expediente || '—'],
    ['Estado', c.estado || '—'],
    ['Área (catastro)', c.ha != null ? `${new Intl.NumberFormat('es-HN', { maximumFractionDigits: 2 }).format(c.ha)} ha` : '—'],
    ['Ubicación', lugar || '—'],
    ['Vence', c.vence || '—'],
    ['Datum', 'WGS 84 / UTM 16N'],
    ['Elaborado', `Dr Electrum FP · ${hoy}`],
      ];

  return {
    titulo: area ? `Área solicitada — ${c.nombre}` : `Plano de situación — ${c.nombre}`,
    etiquetaPrincipal: area ? 'Área solicitada' : undefined,
    subtitulo: opts.subtitulo,
    vista,
    convergencia: gamma,
    concesion: { nombre: c.nombre, geom: JSON.parse(c.g), etiqueta: [c.ex, c.ey] },
    vecinas: vecinas
      .map((v) => ({ nombre: v.nombre, geom: JSON.parse(v.g) as Geometry, etiqueta: [v.ex, v.ey] as [number, number] }))
      .filter((v) => !vacia(v.geom)),
    traslapes: traslapes.map((x) => JSON.parse(x.g) as Geometry).filter((g) => !vacia(g)),
    rios: aRasgos(rios),
    areasProtegidas: aRasgos(ap),
    microcuencas: aRasgos(micro),
    forestal: aRasgos(forestal),
    carretera: aRasgos(carretera),
    municipios: aRasgos(municipios),
    zonasInformales: aRasgos(zonas),
    ocurrencias: aRasgos(ocurrencias),
    poblados: poblados
      .map((p) => ({ nombre: p.nombre, geom: JSON.parse(p.g) as Geometry, tipo: tipoPoblado.get(Number(p.capa_id)) || ('poblado' as const) }))
      .filter((p) => !vacia(p.geom) && esPunto(p.geom)),
    faltan,
    pie: opts.pie,
    relieve,
    ubicacion: [c.lon, c.lat],
    cajetin,
  };
}

export function vacia(g: Geometry): boolean {
  if (!g) return true;
  if (g.type === 'GeometryCollection') return !g.geometries.length;
  return !(g as { coordinates: unknown[] }).coordinates?.length;
}

/** El plano de una concesión en JPEG, listo para el PDF. null si no hay geometría. */
export async function planoConcesion(
  id: number,
  opts: { subtitulo?: string; pie?: string; datum?: Datum; firma?: boolean; presentadoA?: string } = {}
): Promise<{ jpeg: Buffer; ancho: number; alto: number; svg: string } | null> {
  const base = await datosPlano(id, opts);
  if (!base) return null;
  const conFirma = { ...base, firma: opts.firma, presentadoA: opts.presentadoA };
  const d = opts.datum === 'NAD27' ? aNad27(conFirma) : conFirma;
  const svg = svgPlano(d);
  return { jpeg: await jpegDeSvg(svg), ancho: ANCHO, alto: ALTO, svg };
}
