/**
 * MAPAS GEOLÓGICOS — litológico, estructural y geotectónico, dibujados en el servidor.
 *
 * Mismo lienzo, misma tipografía y mismo paso a JPEG que el plano de situación (plano.ts), para que
 * se lean como una misma serie en la ficha y lleguen por Telegram como imagen:
 *
 *  · litológico: las unidades de roca coloreadas por clase (intrusivas en rojo, volcánicas en
 *    naranja, sedimentarias en verde, metamórficas en violeta, ultramáficas en verde oscuro,
 *    aluvión en amarillo), con su código, las fallas encima y los yacimientos por mineral.
 *  · estructural: las fallas por cinemática (normal, inversa, de rumbo, desconocida; las activas en
 *    rojo grueso), los cruces de fallas y la roseta de rumbos, con la roca en tono apagado debajo.
 *  · geotectónico: la región, de la fosa Mesoamericana a la del Caimán: placas y sus límites (los
 *    de subducción con dientes hacia la placa que monta), provincias geológicas, fallas activas,
 *    tractos permisivos y la zona marcada.
 *
 * Los dos primeros van en metros UTM 16N, como el plano; el geotectónico cubre ~1900 km y va en
 * una equirrectangular centrada a 14,5° N, con retícula de grados y la escala marcada como
 * aproximada. Todos dicen la escala de la fuente: dibujar fino un mapa de 1:2 500 000 no lo hace
 * más preciso, y el pie lo recuerda.
 */
import type { Geometry, Position } from 'geojson';
import { conTextoReparado, consulta as consultaBase, hayBase, type RolCapa } from './db';
import { capasPorRol, nombreDe } from './entorno';
import { claseDeRoca, resolverZona, roseta, rumboTexto, type ClaseRoca, type Geologia, type Zona } from './geologia';
import { paisesRegion } from './geologia-datos';
import {
  ALTO, AMBAR, AMBAR_OSCURO, ANCHO, FUENTE, MARCO, PANEL, anchoTexto, chocan, esc, jpegDeSvg, miles, puntos, redondo,
  renglones, rotulo, trazado, transformador, vacia, type Caja,
} from './plano';

const consulta = <T = any>(sql: string, params: unknown[] = []) => consultaBase<T>(sql, params).then(conTextoReparado);

export type TipoMapaGeo = 'litologico' | 'estructural' | 'geotectonico';
export const TIPOS_MAPA_GEO: TipoMapaGeo[] = ['litologico', 'estructural', 'geotectonico'];
export const NOMBRE_MAPA: Record<TipoMapaGeo, string> = {
  litologico: 'Mapa litológico',
  estructural: 'Mapa estructural',
  geotectonico: 'Mapa geotectónico',
};

type UnidadMapa = { unidad: string; descripcion: string; clase: ClaseRoca; geom: Geometry; etiqueta?: [number, number]; areaM2: number };
type FallaMapa = { nombre: string; tipo: string; activa: boolean; certeza: string; geom: Geometry };
type YacMapa = { nombre: string; mineral: string; geom: Geometry };
type PlacaMapa = { nombre: string; tipo: string; hundida: string | null; geom: Geometry };
type AreaMapa = { nombre: string; geom: Geometry; etiqueta?: [number, number] };

export type DatosMapaGeo = {
  tipo: TipoMapaGeo;
  titulo: string;
  subtitulo?: string;
  proyeccion: 'utm16' | 'geo';
  vista: [number, number, number, number];
  /** `rotular: false` para un círculo alrededor de un punto: se ve solo, y su nombre es largo. */
  zona: { nombre: string; geom: Geometry; etiqueta?: [number, number]; rotular?: boolean };
  unidades: UnidadMapa[];
  fallas: FallaMapa[];
  yacimientos: YacMapa[];
  cruces: Position[];
  tractos: AreaMapa[];
  placas: PlacaMapa[];
  provincias: AreaMapa[];
  paises: AreaMapa[];
  rumbos?: Geologia['fallas']['rumbos'];
  escalaFuente?: string | null;
  faltan?: string[];
  pie?: string;
};

/* ------------------------------------------------------------------ colores */

const PALETAS: Record<ClaseRoca, string[]> = {
  intrusiva: ['#e8505b', '#f07a8a', '#c93a4a', '#f29fb0'],
  volcanica: ['#f6a04d', '#f4b76e', '#e98a2e', '#f8c98f', '#eea060'],
  sedimentaria: ['#8fc98f', '#b5dba0', '#6fb37a', '#cfe8b8', '#9fd3c7', '#c6e2a8', '#a8d08d'],
  metamorfica: ['#a58bd6', '#c3aee6', '#8a6cc7'],
  ultramafica: ['#2f7d4f', '#4a9a68'],
  aluvial: ['#fff2a8', '#fbe78a'],
  otra: ['#d0d0d0'],
};
const NOMBRE_CLASE: Record<ClaseRoca, string> = {
  intrusiva: 'intrusiva', volcanica: 'volcánica', sedimentaria: 'sedimentaria', metamorfica: 'metamórfica', ultramafica: 'ultramáfica', aluvial: 'aluvión', otra: 'otra',
};
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
export const colorUnidad = (u: { unidad: string; clase: ClaseRoca }) => {
  const p = PALETAS[u.clase];
  return p[hash(u.unidad) % p.length];
};

const MINERALES: Array<[RegExp, string, string]> = [
  [/oro|gold|\bau\b/i, 'oro', '#d4a017'],
  [/cobre|copper|\bcu\b/i, 'cobre', '#b35a1f'],
  [/plata|silver|\bag\b/i, 'plata', '#8e8e8e'],
  [/zinc|plomo|lead|\bzn\b|\bpb\b/i, 'plomo y zinc', '#3f51b5'],
  [/antimon|\bsb\b/i, 'antimonio', '#00897b'],
  [/hierro|iron|\bfe\b|mangan/i, 'hierro o manganeso', '#5d4037'],
];
function mineralPrincipal(m: string): [string, string] {
  for (const [re, nombre, color] of MINERALES) if (re.test(m)) return [nombre, color];
  return ['otro o sin dato', '#7b1fa2'];
}

type EstiloFalla = { etiqueta: string; color: string; ancho: number };
function estiloFalla(f: FallaMapa, estructural: boolean): EstiloFalla {
  if (f.activa) return { etiqueta: 'Falla activa (GEM)', color: '#d50000', ancho: estructural ? 6 : 4.5 };
  if (!estructural) return { etiqueta: 'Falla', color: '#1b1b1b', ancho: 3 };
  const t = f.tipo.toLowerCase();
  if (/inversa|cabalg/.test(t)) return { etiqueta: 'Falla inversa o de cabalgamiento', color: '#ad1457', ancho: 4 };
  if (/rumbo|sinestral|dextral|transform/.test(t)) return { etiqueta: 'Falla de rumbo', color: '#6a1b9a', ancho: 4 };
  if (/normal|hundido/.test(t)) return { etiqueta: 'Falla normal o de bloque hundido', color: '#1565c0', ancho: 4 };
  return { etiqueta: 'Falla de desplazamiento desconocido', color: '#212121', ancho: 3.2 };
}
const trazoIncierto = (f: FallaMapa) => /aproximad|inferid|especulativ/i.test(f.certeza);

/* ------------------------------------------------------------------ el SVG */

type Leyenda = { tipo: 'area' | 'linea' | 'rombo' | 'circulo' | 'estrella' | 'dientes'; color: string; texto: string; borde?: string; guiones?: boolean; ancho?: number; grupo: string };

/**
 * El mapa en SVG. Función pura: los datos entran proyectados (metros UTM, o metros de la
 * equirrectangular del geotectónico) y sale texto; se prueba sin base y sin rasterizar.
 */
export function svgMapaGeologico(d: DatosMapaGeo): string {
  const t = transformador(d.vista);
  const [x1, y1, x2, y2] = d.vista;
  const estructural = d.tipo === 'estructural';
  const geotectonico = d.tipo === 'geotectonico';
  const partes: string[] = [];
  const leyenda: Leyenda[] = [];
  const usar = (l: Leyenda) => {
    if (!leyenda.some((x) => x.texto === l.texto && x.grupo === l.grupo)) leyenda.push(l);
  };

  /* --- fondo --- */
  if (geotectonico) {
    partes.push(`<rect x="${MARCO.x}" y="${MARCO.y}" width="${MARCO.w}" height="${MARCO.h}" fill="#dcebf5"/>`);
    const tierra = d.paises.map((p) => trazado(p.geom, t)).join('');
    if (tierra) partes.push(`<path d="${tierra}" fill="#f4f1ea" stroke="#9a9185" stroke-width="1.6" fill-rule="evenodd"/>`);
    d.provincias.forEach((p, i) => {
      const c = ['#e9dcc2', '#dfe8cf', '#e6d5e6', '#d6e4ea', '#efe2cf', '#dde3d0'][i % 6];
      partes.push(`<path d="${trazado(p.geom, t)}" fill="${c}" fill-opacity="0.55" stroke="#8d7f6a" stroke-width="1.2" stroke-dasharray="6 4" fill-rule="evenodd"/>`);
    });
    if (d.provincias.length) usar({ tipo: 'area', color: '#e9dcc2', borde: '#8d7f6a', guiones: true, texto: 'Provincia geológica (USGS)', grupo: 'Contexto' });
  }

  /* --- unidades de roca --- */
  const unidadesLeyenda = new Map<string, UnidadMapa>();
  for (const u of d.unidades) {
    const dd = trazado(u.geom, t);
    if (!dd) continue;
    const color = colorUnidad(u);
    partes.push(`<path d="${dd}" fill="${color}" fill-opacity="${estructural ? 0.3 : 0.85}" stroke="#ffffff" stroke-opacity="0.7" stroke-width="1" fill-rule="evenodd"/>`);
    if (!unidadesLeyenda.has(u.unidad)) unidadesLeyenda.set(u.unidad, u);
  }

  /* --- tractos permisivos --- */
  // Solo el contorno: un rayado encima de la roca la tapa, y el tracto es contexto, no la noticia.
  for (const tr of d.tractos) {
    partes.push(`<path d="${trazado(tr.geom, t)}" fill="none" stroke="#8e24aa" stroke-width="3" stroke-dasharray="16 6"/>`);
    usar({ tipo: 'linea', color: '#8e24aa', ancho: 3, guiones: true, texto: 'Borde de tracto permisivo pórfido de cobre (USGS)', grupo: 'Recursos' });
  }

  /* --- la zona: relleno debajo de las fallas, lindero encima de todo --- */
  const dZona = trazado(d.zona.geom, t);
  if (!geotectonico && dZona) partes.push(`<path d="${dZona}" fill="${AMBAR}" fill-opacity="0.18" stroke="none" fill-rule="evenodd"/>`);

  /* --- placas --- */
  for (const p of d.placas) {
    const dd = trazado(p.geom, t);
    if (!dd) continue;
    const sub = /subducc/i.test(p.tipo);
    const div = /divergent/i.test(p.tipo);
    if (div) {
      partes.push(`<path d="${dd}" fill="none" stroke="#c62828" stroke-width="7"/><path d="${dd}" fill="none" stroke="#ffffff" stroke-width="2.5"/>`);
      usar({ tipo: 'linea', color: '#c62828', ancho: 7, texto: 'Límite divergente (dorsal)', grupo: 'Tectónica' });
    } else {
      partes.push(`<path d="${dd}" fill="none" stroke="#b71c1c" stroke-width="${sub ? 4 : 4.5}" ${sub ? '' : 'stroke-dasharray="22 6 4 6"'}/>`);
      if (sub) {
        partes.push(dientes(p, t));
        usar({ tipo: 'dientes', color: '#b71c1c', texto: 'Subducción (dientes hacia la placa que monta)', grupo: 'Tectónica' });
      } else usar({ tipo: 'linea', color: '#b71c1c', ancho: 4.5, guiones: true, texto: 'Límite transformante u otro', grupo: 'Tectónica' });
    }
  }

  /* --- fallas --- */
  for (const f of d.fallas) {
    const dd = trazado(f.geom, t);
    if (!dd) continue;
    const e = estiloFalla(f, estructural || geotectonico);
    partes.push(`<path d="${dd}" fill="none" stroke="${e.color}" stroke-width="${geotectonico ? Math.min(e.ancho, 3) : e.ancho}" stroke-linecap="round" ${trazoIncierto(f) ? 'stroke-dasharray="10 7"' : ''}/>`);
    usar({ tipo: 'linea', color: e.color, ancho: e.ancho, texto: e.etiqueta, grupo: 'Estructuras' });
  }
  if (d.fallas.some(trazoIncierto)) usar({ tipo: 'linea', color: '#555', ancho: 3, guiones: true, texto: 'Traza aproximada o inferida', grupo: 'Estructuras' });
  for (const c of d.cruces) {
    partes.push(`<circle cx="${t.px(c[0]).toFixed(1)}" cy="${t.py(c[1]).toFixed(1)}" r="11" fill="none" stroke="#000" stroke-width="3"/>`);
    usar({ tipo: 'circulo', color: '#000', texto: 'Cruce de fallas', grupo: 'Estructuras' });
  }

  if (!geotectonico && dZona) partes.push(`<path d="${dZona}" fill="none" stroke="${AMBAR_OSCURO}" stroke-width="5" stroke-linejoin="round" fill-rule="evenodd"/>`);

  /* --- yacimientos --- */
  for (const y of d.yacimientos) {
    const [nombre, color] = mineralPrincipal(y.mineral);
    for (const p of puntos(y.geom)) {
      const x = t.px(p[0]);
      const yy = t.py(p[1]);
      const r = geotectonico ? 5 : 9;
      partes.push(`<path d="M${x.toFixed(1)} ${(yy - r).toFixed(1)}L${(x + r).toFixed(1)} ${yy.toFixed(1)}L${x.toFixed(1)} ${(yy + r).toFixed(1)}L${(x - r).toFixed(1)} ${yy.toFixed(1)}Z" fill="${color}" stroke="#ffffff" stroke-width="2"/>`);
    }
    usar({ tipo: 'rombo', color, texto: `Yacimiento: ${nombre}`, grupo: 'Recursos' });
  }

  /* --- la zona en el geotectónico: una estrella --- */
  if (geotectonico) {
    const c = d.zona.etiqueta;
    if (c) {
      partes.push(estrella(t.px(c[0]), t.py(c[1]), 20));
      usar({ tipo: 'estrella', color: AMBAR, texto: 'La zona consultada', grupo: 'Contexto' });
    }
  }

  /* --- rótulos sin encimarse --- */
  const ocupadas: Caja[] = [];
  const poner = (x: number, y: number, texto: string, tam: number, color: string, peso = 400, ancla = 'start'): boolean => {
    const w = anchoTexto(texto, tam, peso > 500);
    const x0 = ancla === 'middle' ? x - w / 2 : ancla === 'end' ? x - w : x;
    const caja: Caja = [x0 - 3, y - tam, x0 + w + 3, y + tam * 0.3];
    if (caja[0] < MARCO.x + 4 || caja[2] > MARCO.x + MARCO.w - 4 || caja[1] < MARCO.y + 4 || caja[3] > MARCO.y + MARCO.h - 90) return false;
    if (ocupadas.some((o) => chocan(o, caja))) return false;
    ocupadas.push(caja);
    partes.push(rotulo(x, y, texto, tam, color, peso, ancla));
    return true;
  };
  if (!geotectonico && d.zona.etiqueta && d.zona.rotular !== false) poner(t.px(d.zona.etiqueta[0]), t.py(d.zona.etiqueta[1]), d.zona.nombre, 26, '#5a3300', 700, 'middle');
  if (geotectonico) {
    // Las placas primero: son el contexto fijo del mapa y no deben perder su sitio.
    for (const [nombre, lon, lat] of PLACAS_ROTULO) {
      const [x, y] = proyGeo([lon, lat]);
      if (x > x1 && x < x2 && y > y1 && y < y2) poner(t.px(x), t.py(y), `Placa de ${nombre}`, 30, '#6d1b1b', 700, 'middle');
    }
    if (d.zona.etiqueta) {
      const n = d.zona.nombre.length > 30 ? `${d.zona.nombre.slice(0, 28).trim()}…` : d.zona.nombre;
      const [zx, zy] = [t.px(d.zona.etiqueta[0]), t.py(d.zona.etiqueta[1])];
      void (poner(zx + 26, zy + 8, n, 22, '#5a3300', 700) || poner(zx - 26, zy + 8, n, 22, '#5a3300', 700, 'end') || poner(zx, zy - 26, n, 22, '#5a3300', 700, 'middle'));
    }
    for (const p of d.provincias.slice(0, 12)) if (p.etiqueta) poner(t.px(p.etiqueta[0]), t.py(p.etiqueta[1]), p.nombre, 17, '#5d4b33', 400, 'middle');
    for (const p of d.paises) if (p.etiqueta) poner(t.px(p.etiqueta[0]), t.py(p.etiqueta[1]), p.nombre, 19, '#6f665a', 400, 'middle');
  }
  // Los códigos de unidad, en las manchas que caben (al menos ~60 × 40 px).
  if (!geotectonico) {
    for (const u of [...d.unidades].sort((a, b) => b.areaM2 - a.areaM2)) {
      if (!u.etiqueta || u.areaM2 * t.s * t.s < 2400) continue;
      poner(t.px(u.etiqueta[0]), t.py(u.etiqueta[1]) + 7, u.unidad, 20, '#1a1a1a', 700, 'middle');
    }
  }
  // Los nombres de fallas que tienen nombre, en el medio de su tramo más largo.
  const conNombre = new Set<string>();
  for (const f of d.fallas) {
    if (!f.nombre || /sin nombre/i.test(f.nombre) || conNombre.has(f.nombre) || conNombre.size >= (geotectonico ? 10 : 8)) continue;
    const m = medio(f.geom);
    if (m && poner(t.px(m[0]), t.py(m[1]) - 8, f.nombre, geotectonico ? 16 : 18, f.activa ? '#b00000' : '#222', 400, 'middle')) conNombre.add(f.nombre);
  }
  if (!geotectonico) {
    for (const y of d.yacimientos.slice(0, 25)) {
      const [p] = puntos(y.geom);
      if (!p || !y.nombre || y.nombre === 'sin nombre') continue;
      const x = t.px(p[0]);
      const yy = t.py(p[1]);
      void (poner(x + 13, yy + 6, y.nombre, 17, '#3b2a00') || poner(x - 13, yy + 6, y.nombre, 17, '#3b2a00', 400, 'end'));
    }
  }

  /* --- cuadrícula: UTM en metros, o retícula de grados en el geotectónico --- */
  const lineasCuadricula: string[] = [];
  const etiquetas: string[] = [];
  if (geotectonico) {
    for (let lon = Math.ceil(invGeo([x1, y1])[0] / 2) * 2; lon <= invGeo([x2, y1])[0]; lon += 2) {
      const X = t.px(proyGeo([lon, 0])[0]);
      if (X < MARCO.x + 1 || X > MARCO.x + MARCO.w - 1) continue;
      lineasCuadricula.push(`M${X.toFixed(1)} ${MARCO.y}L${X.toFixed(1)} ${MARCO.y + MARCO.h}`);
      if (X > MARCO.x + 40 && X < MARCO.x + MARCO.w - 40) etiquetas.push(texto(X, MARCO.y + MARCO.h + 32, `${Math.abs(lon)}° O`, 20, '#333', 'middle'));
    }
    for (let lat = Math.ceil(invGeo([x1, y1])[1] / 2) * 2; lat <= invGeo([x1, y2])[1]; lat += 2) {
      const Y = t.py(proyGeo([0, lat])[1]);
      if (Y < MARCO.y + 1 || Y > MARCO.y + MARCO.h - 1) continue;
      lineasCuadricula.push(`M${MARCO.x} ${Y.toFixed(1)}L${MARCO.x + MARCO.w} ${Y.toFixed(1)}`);
      if (Y > MARCO.y + 40 && Y < MARCO.y + MARCO.h - 40) etiquetas.push(`<text x="${MARCO.x - 14}" y="${Y.toFixed(1)}" font-family="${FUENTE}" font-size="20" text-anchor="middle" fill="#333" transform="rotate(-90 ${MARCO.x - 14} ${Y.toFixed(1)})">${lat}° N</text>`);
    }
  } else {
    const paso = redondo((x2 - x1) / 6);
    for (let x = Math.ceil(x1 / paso) * paso; x <= x2; x += paso) {
      const X = t.px(x);
      if (X < MARCO.x + 1 || X > MARCO.x + MARCO.w - 1) continue;
      lineasCuadricula.push(`M${X.toFixed(1)} ${MARCO.y}L${X.toFixed(1)} ${MARCO.y + MARCO.h}`);
      if (X > MARCO.x + 60 && X < MARCO.x + MARCO.w - 60) etiquetas.push(texto(X, MARCO.y + MARCO.h + 32, `${miles(x)} E`, 20, '#333', 'middle'));
    }
    for (let y = Math.ceil(y1 / paso) * paso; y <= y2; y += paso) {
      const Y = t.py(y);
      if (Y < MARCO.y + 1 || Y > MARCO.y + MARCO.h - 1) continue;
      lineasCuadricula.push(`M${MARCO.x} ${Y.toFixed(1)}L${MARCO.x + MARCO.w} ${Y.toFixed(1)}`);
      if (Y > MARCO.y + 75 && Y < MARCO.y + MARCO.h - 75) {
        etiquetas.push(`<text x="${MARCO.x - 14}" y="${Y.toFixed(1)}" font-family="${FUENTE}" font-size="20" text-anchor="middle" fill="#333" transform="rotate(-90 ${MARCO.x - 14} ${Y.toFixed(1)})">${miles(y)} N</text>`);
      }
    }
  }

  /* --- barra de escala --- */
  const anchoVistaM = MARCO.w / t.s;
  const largoM = redondo(anchoVistaM / 5);
  const largoPx = largoM * t.s;
  const bx = MARCO.x + 30;
  const by = MARCO.y + MARCO.h - 44;
  let escala = `<rect x="${bx - 16}" y="${by - 46}" width="${largoPx + 110}" height="78" fill="#ffffff" fill-opacity="0.88" stroke="#999" stroke-width="1"/>`;
  for (let i = 0; i < 4; i++) {
    escala += `<rect x="${(bx + (i * largoPx) / 4).toFixed(1)}" y="${by}" width="${(largoPx / 4).toFixed(1)}" height="12" fill="${i % 2 ? '#ffffff' : '#111111'}" stroke="#111" stroke-width="1.5"/>`;
  }
  const kmTexto = (m: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(m / 1000);
  escala += texto(bx, by - 10, '0', 19, '#111', 'middle') + texto(bx + largoPx / 2, by - 10, kmTexto(largoM / 2), 19, '#111', 'middle') + texto(bx + largoPx, by - 10, kmTexto(largoM), 19, '#111', 'middle');
  escala += texto(bx + largoPx + 12, by + 12, geotectonico ? 'km (aprox.)' : 'km', 19, '#111', 'start');

  /* --- panel: norte, roseta, leyenda --- */
  const panel: string[] = [];
  const cx = PANEL.x + PANEL.w / 2;
  panel.push(
    `<path d="M${cx} 176L${cx + 24} 262L${cx} 245L${cx - 24} 262Z" fill="#111" stroke="#111" stroke-width="2" stroke-linejoin="round"/>`,
    `<path d="M${cx} 176L${cx - 24} 262L${cx} 245Z" fill="#fff" stroke="#111" stroke-width="2" stroke-linejoin="round"/>`,
    texto(cx, 168, 'N', 32, '#111', 'middle', 700)
  );
  let ly = 300;
  if (estructural && d.rumbos && d.rumbos.kmMedidos > 0) {
    panel.push(rosetaSvg(d.rumbos, cx, 440, 118));
    ly = 600;
    panel.push(texto(PANEL.x, ly, `Rumbo dominante ${d.rumbos.dominante}`, 19, '#111', 'start', 700));
    ly += 24;
    panel.push(texto(PANEL.x, ly, `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(d.rumbos.kmMedidos)} km de falla medidos`, 16, '#555'));
    ly += 34;
  }
  panel.push(texto(PANEL.x, ly, 'Leyenda', 22, '#111', 'start', 700), `<path d="M${PANEL.x} ${ly + 12}L${PANEL.x + PANEL.w} ${ly + 12}" stroke="${AMBAR}" stroke-width="3"/>`);
  ly += 44;
  const limite = MARCO.y + MARCO.h + 40;
  const fila = (muestra: string, etiqueta: string, tam = 17) => {
    if (ly > limite) return;
    panel.push(muestra);
    const rs = renglones(etiqueta, PANEL.w - 64, tam);
    rs.slice(0, 2).forEach((r, i) => panel.push(texto(PANEL.x + 62, ly + 6 + i * (tam + 3), r, tam, '#111')));
    ly += Math.max(30, Math.min(2, rs.length) * (tam + 3) + 10);
  };
  if (!geotectonico) {
    fila(`<rect x="${PANEL.x}" y="${ly - 12}" width="48" height="24" fill="${AMBAR}" fill-opacity="0.25" stroke="${AMBAR_OSCURO}" stroke-width="4"/>`, d.zona.nombre.length > 40 ? 'Zona consultada' : d.zona.nombre, 17);
    const us = [...unidadesLeyenda.values()].sort((a, b) => CLASES_ORDEN.indexOf(a.clase) - CLASES_ORDEN.indexOf(b.clase) || a.unidad.localeCompare(b.unidad));
    for (const u of us.slice(0, estructural ? 6 : 14)) {
      fila(`<rect x="${PANEL.x}" y="${ly - 12}" width="48" height="24" fill="${colorUnidad(u)}" fill-opacity="${estructural ? 0.4 : 0.9}" stroke="#777" stroke-width="1"/>`, `${u.unidad} · ${u.descripcion}`, 15);
    }
    if (us.length > (estructural ? 6 : 14)) fila('', `… y ${us.length - (estructural ? 6 : 14)} unidades más`, 15);
  }
  for (const grupo of ['Estructuras', 'Tectónica', 'Recursos', 'Contexto']) {
    for (const l of leyenda.filter((x) => x.grupo === grupo)) fila(muestraLeyenda(l, PANEL.x, ly), l.texto, 16);
  }
  if (d.faltan?.length) {
    ly += 8;
    for (const r of renglones(`No cargado (no se dibuja): ${d.faltan.join(', ')}.`, PANEL.w, 15)) {
      if (ly > limite) break;
      panel.push(texto(PANEL.x, ly, r, 15, '#8a4b00'));
      ly += 19;
    }
  }

  const titulo = texto(60, 64, d.titulo, 38, '#141414', 'start', 700);
  const subtitulo = d.subtitulo ? texto(60, 102, d.subtitulo, 22, '#5c5c5c') : '';
  const base = geotectonico ? 'WGS 84, equirrectangular centrada a 14,5° N' : 'WGS 84 / UTM zona 16N (EPSG:32616) · coordenadas en metros';
  const pie = texto(60, ALTO - 36, `${base}${d.escalaFuente ? ` · geología a escala ${d.escalaFuente}: regional, no para decidir dentro de una concesión` : ''}${d.pie ? ` · ${d.pie}` : ''}`, 17, '#555');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ANCHO}" height="${ALTO}" viewBox="0 0 ${ANCHO} ${ALTO}">`,
    '<defs>',
    `<clipPath id="marco"><rect x="${MARCO.x}" y="${MARCO.y}" width="${MARCO.w}" height="${MARCO.h}"/></clipPath>`,
    '</defs>',
    `<rect width="${ANCHO}" height="${ALTO}" fill="#ffffff"/>`,
    `<rect x="${MARCO.x}" y="${MARCO.y}" width="${MARCO.w}" height="${MARCO.h}" fill="#fbfaf6"/>`,
    `<path d="M0 120L${ANCHO} 120" stroke="${AMBAR}" stroke-width="4"/>`,
    titulo,
    subtitulo,
    '<g clip-path="url(#marco)">',
    ...partes.slice(0, geotectonico ? 1 : 0),
    `<path d="${lineasCuadricula.join('')}" stroke="${geotectonico ? '#9fb6c6' : '#b9b9b9'}" stroke-width="1.2" fill="none"/>`,
    ...partes.slice(geotectonico ? 1 : 0),
    escala,
    '</g>',
    `<rect x="${MARCO.x}" y="${MARCO.y}" width="${MARCO.w}" height="${MARCO.h}" fill="none" stroke="#222" stroke-width="2.5"/>`,
    ...etiquetas,
    ...panel,
    pie,
    '</svg>',
  ].join('\n');
}

const CLASES_ORDEN: ClaseRoca[] = ['intrusiva', 'volcanica', 'ultramafica', 'metamorfica', 'sedimentaria', 'aluvial', 'otra'];

function texto(x: number, y: number, s: string, tam: number, color: string, ancla = 'start', peso = 400): string {
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${FUENTE}" font-size="${tam}" font-weight="${peso}" text-anchor="${ancla}" fill="${color}">${esc(s)}</text>`;
}

function muestraLeyenda(l: Leyenda, x: number, y: number): string {
  switch (l.tipo) {
    case 'area':
      return `<rect x="${x}" y="${y - 12}" width="48" height="24" fill="${l.color}" fill-opacity="0.6" stroke="${l.borde || '#555'}" stroke-width="2" ${l.guiones ? 'stroke-dasharray="8 4"' : ''}/>`;
    case 'linea':
      return `<path d="M${x} ${y}L${x + 48} ${y}" stroke="${l.color}" stroke-width="${Math.min(6, l.ancho || 3)}" ${l.guiones ? 'stroke-dasharray="10 6"' : ''}/>`;
    case 'dientes':
      return `<path d="M${x} ${y + 4}L${x + 48} ${y + 4}" stroke="${l.color}" stroke-width="4"/><path d="M${x + 8} ${y + 4}L${x + 14} ${y - 8}L${x + 20} ${y + 4}ZM${x + 28} ${y + 4}L${x + 34} ${y - 8}L${x + 40} ${y + 4}Z" fill="${l.color}"/>`;
    case 'rombo':
      return `<path d="M${x + 24} ${y - 10}L${x + 34} ${y}L${x + 24} ${y + 10}L${x + 14} ${y}Z" fill="${l.color}" stroke="#fff" stroke-width="2"/>`;
    case 'circulo':
      return `<circle cx="${x + 24}" cy="${y}" r="10" fill="none" stroke="${l.color}" stroke-width="3"/>`;
    case 'estrella':
      return estrella(x + 24, y, 13);
  }
}

function estrella(x: number, y: number, r: number): string {
  const p: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    p.push(`${(x + rr * Math.cos(a)).toFixed(1)} ${(y + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `<path d="M${p.join('L')}Z" fill="${AMBAR}" stroke="${AMBAR_OSCURO}" stroke-width="2.5"/>`;
}

/** La roseta: 36 pétalos (los 18 rumbos y sus opuestos), largo proporcional a los km de falla. */
function rosetaSvg(r: Geologia['fallas']['rumbos'], cx: number, cy: number, radio: number): string {
  const max = Math.max(...r.bins, 1e-9);
  const out: string[] = [
    `<circle cx="${cx}" cy="${cy}" r="${radio}" fill="#fafafa" stroke="#999" stroke-width="1.5"/>`,
    `<circle cx="${cx}" cy="${cy}" r="${radio / 2}" fill="none" stroke="#ccc" stroke-width="1" stroke-dasharray="4 4"/>`,
    `<path d="M${cx} ${cy - radio}L${cx} ${cy + radio}M${cx - radio} ${cy}L${cx + radio} ${cy}" stroke="#ddd" stroke-width="1"/>`,
  ];
  const punto = (az: number, l: number) => [cx + l * Math.sin(az * (Math.PI / 180)), cy - l * Math.cos(az * (Math.PI / 180))];
  for (let i = 0; i < 18; i++) {
    const l = (r.bins[i] / max) * radio;
    if (l <= 0.5) continue;
    for (const base of [i * 10, i * 10 + 180]) {
      const [ax, ay] = punto(base, l);
      const [bx, by] = punto(base + 10, l);
      out.push(`<path d="M${cx} ${cy}L${ax.toFixed(1)} ${ay.toFixed(1)}A${l.toFixed(1)} ${l.toFixed(1)} 0 0 1 ${bx.toFixed(1)} ${by.toFixed(1)}Z" fill="#6a1b9a" fill-opacity="0.75" stroke="#fff" stroke-width="1"/>`);
    }
  }
  out.push(texto(cx, cy - radio - 8, 'N', 18, '#333', 'middle', 700), texto(cx + radio + 8, cy + 6, 'E', 16, '#555'), texto(cx - radio - 8, cy + 6, 'W', 16, '#555', 'end'));
  out.push(texto(cx, cy + radio + 26, 'Roseta de rumbos de falla', 17, '#333', 'middle'));
  return out.join('');
}

/** Dientes de subducción cada ~90 px, del lado de la placa que monta. */
function dientes(p: PlacaMapa, t: ReturnType<typeof transformador>): string {
  const monta = p.hundida && /–/.test(p.nombre) ? p.nombre.replace(/^Límite /, '').split('–').find((x) => x !== p.hundida) : null;
  const ref = monta ? REF_PLACA[monta] : null;
  if (!ref) return '';
  const [rx, ry] = proyGeo(ref);
  const RX = t.px(rx);
  const RY = t.py(ry);
  const out: string[] = [];
  for (const l of lineasDe(p.geom)) {
    let acum = 0;
    for (let i = 1; i < l.length; i++) {
      const ax = t.px(l[i - 1][0]), ay = t.py(l[i - 1][1]), bx = t.px(l[i][0]), by = t.py(l[i][1]);
      const seg = Math.hypot(bx - ax, by - ay);
      if (seg < 0.5) continue;
      acum += seg;
      if (acum < 90) continue;
      acum = 0;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      let nx = -(by - ay) / seg, ny = (bx - ax) / seg;
      if ((RX - mx) * nx + (RY - my) * ny < 0) { nx = -nx; ny = -ny; }
      const ux = (bx - ax) / seg, uy = (by - ay) / seg;
      out.push(`M${(mx - ux * 9).toFixed(1)} ${(my - uy * 9).toFixed(1)}L${(mx + nx * 15).toFixed(1)} ${(my + ny * 15).toFixed(1)}L${(mx + ux * 9).toFixed(1)} ${(my + uy * 9).toFixed(1)}Z`);
    }
  }
  return out.length ? `<path d="${out.join('')}" fill="#b71c1c"/>` : '';
}

function lineasDe(g: Geometry): Position[][] {
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(lineasDe);
  return [];
}
function medio(g: Geometry): Position | null {
  const ls = lineasDe(g).sort((a, b) => b.length - a.length);
  return ls[0]?.length ? ls[0][Math.floor(ls[0].length / 2)] : null;
}

/* ------------------------------------------------------------------ proyección del geotectónico */

const FI0 = 14.5 * (Math.PI / 180);
export const proyGeo = (p: Position): [number, number] => [p[0] * 111320 * Math.cos(FI0), p[1] * 110574];
const invGeo = (p: [number, number]): [number, number] => [p[0] / (111320 * Math.cos(FI0)), p[1] / 110574];
function proyectar(g: Geometry): Geometry {
  const pc = (c: any): any => (typeof c[0] === 'number' ? proyGeo(c) : c.map(pc));
  if (g.type === 'GeometryCollection') return { type: 'GeometryCollection', geometries: g.geometries.map(proyectar) };
  return { ...g, coordinates: pc((g as any).coordinates) } as Geometry;
}
/** Dónde se rotula cada placa y hacia dónde apuntan los dientes de la que monta. */
const PLACAS_ROTULO: Array<[string, number, number]> = [
  ['Norteamérica', -89.5, 19.6], ['Caribe', -80.5, 14.2], ['Cocos', -93.0, 10.2], ['Nazca', -84.5, 5.5],
];
const REF_PLACA: Record<string, [number, number]> = {
  Caribe: [-80, 15], Norteamérica: [-92, 20], Cocos: [-94, 9], Nazca: [-85, 2], Sudamérica: [-65, 6], Panamá: [-80, 8.5], 'Andes del Norte': [-74, 7],
};

/* ------------------------------------------------------------------ desde la base */

type Fila = { nombre: string | null; g: string };

export async function datosMapaGeologico(tipo: TipoMapaGeo, z: Zona, opts: { pie?: string } = {}): Promise<DatosMapaGeo | { error: string }> {
  if (!hayBase()) return { error: 'El catastro no está conectado.' };
  const zona = await resolverZona(z);
  if ('error' in zona) return zona;
  const capas = await capasPorRol();
  const de = (rol: RolCapa) => capas.filter((x) => x.rol === rol).map((x) => x.id);
  const faltanRol = (roles: RolCapa[]) => roles.filter((r) => !de(r).length).map((r) => ({ litologia: 'mapa geológico', falla: 'fallas', placa: 'límites de placa', provincia_geologica: 'provincias geológicas', tracto_permisivo: 'tractos permisivos', ocurrencia: 'yacimientos' } as Record<string, string>)[r] || r);
  const G = JSON.stringify(zona.geojson);

  if (tipo === 'geotectonico') {
    // Honduras en el centro, de la fosa Mesoamericana a la del Caimán: ~1900 km de ancho.
    const [cxm, cym] = proyGeo([-86.5, 14.4]);
    const w = 1900e3;
    const h = (w * MARCO.h) / MARCO.w;
    const vista: [number, number, number, number] = [cxm - w / 2, cym - h / 2, cxm + w / 2, cym + h / 2];
    const [lo1, la1] = invGeo([vista[0], vista[1]]);
    const [lo2, la2] = invGeo([vista[2], vista[3]]);
    const env = [lo1, la1, lo2, la2];
    const ENV = `ST_MakeEnvelope($1, $2, $3, $4, 4326)`;
    const capa = (rol: RolCapa, extra = '', tol = 0.02) =>
      de(rol).length
        ? consulta<Fila & { a: Record<string, string>; ex: number | null; ey: number | null }>(
            `SELECT e.nombre, e.atributos AS a, ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_ClipByBox2D(e.geom, ${ENV}::box2d), ${tol}), 4) AS g,
                    ST_X(ST_PointOnSurface(ST_ClipByBox2D(e.geom, ${ENV}::box2d))) ex, ST_Y(ST_PointOnSurface(ST_ClipByBox2D(e.geom, ${ENV}::box2d))) ey
               FROM entidad_geo e WHERE e.capa_id = ANY($5) AND e.geom && ${ENV} ${extra}`,
            [...env, de(rol)]
          )
        : Promise.resolve([]);
    const [placas, provincias, activas] = await Promise.all([
      capa('placa'), capa('provincia_geologica'), capa('falla', `AND e.atributos->>'ACTIVA' = 'sí'`, 0.005),
    ]);
    const geo = (g: string) => proyectar(JSON.parse(g) as Geometry);
    const et = (f: { ex: number | null; ey: number | null }) => (f.ex != null && f.ey != null ? proyGeo([f.ex, f.ey]) : undefined);
    const paises = paisesRegion().features
      .filter((f) => f.geometry)
      .map((f) => ({ nombre: String(f.properties?.NOMBRE || ''), geom: proyectar(f.geometry), etiqueta: undefined as [number, number] | undefined }));
    // Solo los países que tocan la vista, rotulados en su centro aproximado.
    for (const p of paises) {
      const pts = lineasDe(p.geom as any).flat().concat(poligonos(p.geom).flat(2) as any);
      if (!pts.length) continue;
      const xs = pts.map((q: any) => q[0]), ys = pts.map((q: any) => q[1]);
      p.etiqueta = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    }
    return {
      tipo, titulo: `${NOMBRE_MAPA[tipo]} — ${zona.nombre}`, subtitulo: 'Placas, límites, provincias geológicas y fallas activas de la región', proyeccion: 'geo', vista,
      zona: { nombre: zona.nombre, geom: proyectar(zona.geojson), etiqueta: proyGeo([zona.lon, zona.lat]) },
      unidades: [], yacimientos: [], cruces: [],
      fallas: activas.filter((f) => f.g).map((f) => ({ nombre: f.nombre || '', tipo: f.a?.TIPO || '', activa: true, certeza: '', geom: geo(f.g) })),
      placas: placas.filter((f) => f.g).map((f) => {
        const hund = /se hunde ([^)]+)\)/.exec(f.a?.TIPO || '');
        return { nombre: f.nombre || '', tipo: f.a?.TIPO || '', hundida: hund ? hund[1] : null, geom: geo(f.g) };
      }),
      provincias: provincias.filter((f) => f.g).map((f) => ({ nombre: f.nombre || '', geom: geo(f.g), etiqueta: et(f) })),
      // Los tractos no van aquí: recortados a Honduras y llenos de huecos, a esta escala son ruido.
      tractos: [],
      paises,
      faltan: faltanRol(['placa', 'provincia_geologica', 'falla']),
      pie: opts.pie,
    };
  }

  // Litológico y estructural: la zona con su entorno, en UTM 16N y con la proporción del marco.
  const radioKm = Math.max(1, Math.min(50, z.radioKm ?? 10));
  const [c] = await consulta<{ x1: number; y1: number; x2: number; y2: number; ex: number; ey: number; g: string }>(
    `SELECT ST_XMin(u) x1, ST_YMin(u) y1, ST_XMax(u) x2, ST_YMax(u) y2, ST_X(ST_PointOnSurface(u)) ex, ST_Y(ST_PointOnSurface(u)) ey, ST_AsGeoJSON(u, 1) g
       FROM (SELECT ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), 32616) u) t`,
    [G]
  );
  const aire = Math.max(radioKm * 1000 * 0.6, 0.35 * Math.max(c.x2 - c.x1, c.y2 - c.y1));
  let w = c.x2 - c.x1 + 2 * aire;
  let h = c.y2 - c.y1 + 2 * aire;
  if (w / h < MARCO.w / MARCO.h) w = (h * MARCO.w) / MARCO.h;
  else h = (w * MARCO.h) / MARCO.w;
  const mx = (c.x1 + c.x2) / 2, my = (c.y1 + c.y2) / 2;
  const vista: [number, number, number, number] = [mx - w / 2, my - h / 2, mx + w / 2, my + h / 2];
  const tol = (w / MARCO.w) * 0.5;
  const V = `v AS (SELECT ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 32616), 4326) AS env)`;
  const recorte = (col: string) => `ST_Transform(ST_ClipByBox2D(${col}, v.env::box2d), 32616)`;
  const [unidades, fallas, yac, tractos] = await Promise.all([
    de('litologia').length
      ? consulta<{ u: string; d: string; cl: string; g: string; ex: number; ey: number; area: number }>(
          `WITH ${V}
           SELECT coalesce(nullif(e.atributos->>'UNIDAD', ''), e.nombre, '?') u, coalesce(nullif(e.atributos->>'DESCRIPCION', ''), e.nombre, '') d,
                  coalesce(e.atributos->>'CLASE_ROCA', '') cl, ST_AsGeoJSON(ST_SimplifyPreserveTopology(r, ${tol}), 1) g,
                  ST_X(ST_PointOnSurface(r)) ex, ST_Y(ST_PointOnSurface(r)) ey, ST_Area(r)::float8 area
             FROM (SELECT e.*, ${recorte('e.geom')} AS r FROM entidad_geo e, v WHERE e.capa_id = ANY($5) AND e.geom && v.env) e
            WHERE NOT ST_IsEmpty(r) LIMIT 3000`,
          [...vista, de('litologia')]
        )
      : Promise.resolve([]),
    de('falla').length
      ? consulta<Fila & { tipo: string; activa: string; certeza: string }>(
          `WITH ${V}
           SELECT ${nombreDe('falla')} AS nombre, coalesce(e.atributos->>'TIPO', '') tipo, coalesce(e.atributos->>'ACTIVA', '') activa,
                  coalesce(e.atributos->>'CERTEZA', '') certeza, ST_AsGeoJSON(ST_SimplifyPreserveTopology(${recorte('e.geom')}, ${tol}), 1) g
             FROM entidad_geo e, v WHERE e.capa_id = ANY($5) AND e.geom && v.env LIMIT 3000`,
          [...vista, de('falla')]
        )
      : Promise.resolve([]),
    de('ocurrencia').length
      ? consulta<Fila & { mineral: string | null }>(
          `WITH ${V}
           SELECT ${nombreDe('ocurrencia')} AS nombre,
                  (SELECT trim(a.v) FROM jsonb_each_text(e.atributos) AS a(k, v) WHERE a.k ~* '^(mineral|comm|sustanc)' AND a.v ~ '[A-Za-z]' LIMIT 1) AS mineral,
                  ST_AsGeoJSON(${recorte('e.geom')}, 1) g
             FROM entidad_geo e, v WHERE e.capa_id = ANY($5) AND e.geom && v.env LIMIT 800`,
          [...vista, de('ocurrencia')]
        )
      : Promise.resolve([]),
    de('tracto_permisivo').length
      ? consulta<Fila>(
          `WITH ${V} SELECT e.nombre, ST_AsGeoJSON(ST_SimplifyPreserveTopology(${recorte('e.geom')}, ${tol}), 1) g
             FROM entidad_geo e, v WHERE e.capa_id = ANY($5) AND e.geom && v.env`,
          [...vista, de('tracto_permisivo')]
        )
      : Promise.resolve([]),
  ]);
  const parse = (g: string | null) => (g ? (JSON.parse(g) as Geometry) : null);
  const ok = <T extends { geom: Geometry | null }>(x: T): x is T & { geom: Geometry } => !!x.geom && !vacia(x.geom);

  let rumbos: Geologia['fallas']['rumbos'] | undefined;
  let cruces: Position[] = [];
  if (tipo === 'estructural') {
    // La roseta y los cruces, del mismo entorno que el análisis: el mapa y el texto dicen lo mismo.
    const { geologiaDe } = await import('./geologia');
    const geo = await geologiaDe({ ...z, radioKm });
    if (!('error' in geo)) {
      rumbos = geo.fallas.rumbos;
      const puntosUtm = geo.fallas.intersecciones.length
        ? await consulta<{ x: number; y: number }>(
            `SELECT ST_X(p) x, ST_Y(p) y FROM (SELECT ST_Transform(ST_SetSRID(ST_MakePoint(lon, lat), 4326), 32616) p FROM unnest($1::float8[], $2::float8[]) AS t(lon, lat)) s`,
            [geo.fallas.intersecciones.map((q) => q[0]), geo.fallas.intersecciones.map((q) => q[1])]
          )
        : [];
      cruces = puntosUtm.map((q) => [q.x, q.y]);
    } else rumbos = roseta([]);
  }
  const [escala] = de('litologia').length
    ? await consulta<{ e: string | null }>(`SELECT (SELECT atributos->>'ESCALA' FROM entidad_geo WHERE capa_id = ANY($1) AND atributos ? 'ESCALA' LIMIT 1) e`, [de('litologia')])
    : [{ e: null }];

  return {
    tipo,
    titulo: `${NOMBRE_MAPA[tipo]} — ${zona.nombre}`,
    subtitulo: tipo === 'litologico' ? `Unidades de roca, fallas y yacimientos · entorno de ${radioKm} km` : `Fallas por cinemática, cruces y rumbos · entorno de ${radioKm} km`,
    proyeccion: 'utm16',
    vista,
    zona: { nombre: zona.nombre, geom: JSON.parse(c.g), etiqueta: [c.ex, c.ey], rotular: zona.tipo !== 'punto' },
    unidades: unidades
      .map((u) => ({ unidad: u.u, descripcion: u.d, clase: (PALETAS[u.cl as ClaseRoca] ? u.cl : claseDeRoca(`${u.d} ${u.u}`)) as ClaseRoca, geom: parse(u.g), etiqueta: [u.ex, u.ey] as [number, number], areaM2: u.area }))
      .filter(ok),
    fallas: fallas.map((f) => ({ nombre: f.nombre || '', tipo: f.tipo, activa: f.activa === 'sí', certeza: f.certeza, geom: parse(f.g) })).filter(ok),
    yacimientos: yac.map((y) => ({ nombre: y.nombre || 'sin nombre', mineral: y.mineral || '', geom: parse(y.g) })).filter(ok),
    cruces,
    tractos: tractos.map((x) => ({ nombre: x.nombre || '', geom: parse(x.g) })).filter(ok),
    placas: [], provincias: [], paises: [],
    rumbos,
    escalaFuente: escala?.e ? `1:${String(Number(String(escala.e).replace(/^1:/, ''))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}` : null,
    faltan: faltanRol(tipo === 'litologico' ? ['litologia', 'falla', 'ocurrencia'] : ['falla', 'litologia']),
    pie: opts.pie,
  };
}

function poligonos(g: Geometry): Position[][][] {
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(poligonos);
  return [];
}

/** El mapa en JPEG, listo para el PDF o para mandarlo por Telegram. */
export async function mapaGeologico(
  tipo: TipoMapaGeo,
  z: Zona,
  opts: { pie?: string } = {}
): Promise<{ jpeg: Buffer; svg: string; ancho: number; alto: number; titulo: string } | { error: string }> {
  const d = await datosMapaGeologico(tipo, z, opts);
  if ('error' in d) return d;
  const svg = svgMapaGeologico(d);
  return { jpeg: await jpegDeSvg(svg), svg, ancho: ANCHO, alto: ALTO, titulo: d.titulo };
}

export { rumboTexto };
