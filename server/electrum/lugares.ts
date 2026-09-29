/**
 * «LLÉVAME A JUTICALPA». Los lugares de Honduras para que el mapa vaya a donde se le dice.
 *
 * El gacetero sale de GeoNames (geonames.org, CC BY 4.0): los 18 departamentos, los 298 municipios,
 * las cabeceras, unas doce mil aldeas y caseríos, y los cerros, ríos, lagunas, islas, valles,
 * aeropuertos y parques con nombre (data/geo/lugares-hn.json, ~19 500 lugares). Vive en el
 * servidor: al navegador solo le llega el lugar que se pidió.
 *
 * Cómo elige cuando hay varios con el mismo nombre (hay decenas de «San José»): primero el que
 * calza con el departamento si se dijo («Concepción, Intibucá»), después el tipo que se quiere decir
 * cuando se nombra un lugar a secas (departamento > capital > cabecera > municipio > aldea) y, entre
 * aldeas, la más poblada. Los demás van como alternativas para ofrecer.
 */
import fs from 'node:fs';
import path from 'node:path';

type Fila = [nombre: string, lon: number, lat: number, codigo: string, depto: string, poblacion: number, alternos?: string[]];

export type Lugar = {
  nombre: string;
  tipo: string;
  departamento: string;
  centro: [number, number];
  /** Zoom de llegada: un departamento se mira de lejos; una aldea, de cerca. */
  zoom: number;
};

const ARCHIVO = path.join(process.cwd(), 'data', 'geo', 'lugares-hn.json');

/** Cuánto pesa cada tipo al elegir entre homónimos, y a qué zoom se llega. */
const PESO: Record<string, [number, number]> = {
  ADM1: [100, 8.2],
  PPLC: [95, 12],
  PPLA: [90, 12.5],
  ADM2: [80, 11],
  PPLA2: [75, 13],
  ISL: [60, 11],
  LK: [55, 12],
  VLC: [55, 12.5],
  MTS: [50, 11],
  AIRP: [50, 13.5],
  PRK: [45, 11],
  RSV: [45, 11],
  VAL: [42, 11.5],
  BAY: [40, 11],
  PPL: [35, 14],
  MT: [30, 13.5],
  HLL: [28, 14],
  PK: [30, 13.5],
  STM: [25, 12],
  RDGE: [22, 13],
};
const pesoDe = (c: string) => PESO[c] || [15, 13.5];

export const fold = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

type Indice = { tipos: Record<string, string>; porNombre: Map<string, Fila[]>; filas: Fila[] };
let indice: Indice | null = null;

function cargar(): Indice {
  if (indice) return indice;
  const crudo = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8')) as { tipos: Record<string, string>; lugares: Fila[] };
  const porNombre = new Map<string, Fila[]>();
  const poner = (k: string, f: Fila) => {
    if (!k) return;
    const l = porNombre.get(k);
    if (l) {
      if (!l.includes(f)) l.push(f);
    } else porNombre.set(k, [f]);
  };
  for (const f of crudo.lugares) {
    poner(fold(f[0]), f);
    for (const a of f[6] || []) poner(fold(a), f);
    // «Río Guayape» también se encuentra como «Guayape»; «Cerro Uyuca», como «Uyuca».
    const sinGenerico = fold(f[0]).replace(/^(rio|quebrada|cerro|cerros|montana|sierra|laguna de|laguna|lago de|lago|isla de|isla|islas de la|islas|volcan|valle de|valle|parque nacional|aeropuerto( internacional)?|municipio de|departamento de) /, '');
    if (sinGenerico !== fold(f[0])) poner(sinGenerico, f);
  }
  indice = { tipos: crudo.tipos, porNombre, filas: crudo.lugares };
  return indice;
}

const DEPTOS = [
  'atlantida', 'choluteca', 'colon', 'comayagua', 'copan', 'cortes', 'el paraiso', 'francisco morazan', 'gracias a dios',
  'intibuca', 'islas de la bahia', 'la paz', 'lempira', 'ocotepeque', 'olancho', 'santa barbara', 'valle', 'yoro',
];

/** «Concepción, Intibucá» o «San José en Copán»: el nombre y el departamento por separado. */
export function separarDepartamento(q: string): { nombre: string; depto: string | null } {
  const t = fold(q);
  for (const d of DEPTOS) {
    const m = t.match(new RegExp(`^(.+?)\\s+(?:en |de |del departamento de )?(?:el departamento de )?${d}$`));
    if (m && m[1].trim() && m[1].trim() !== d) return { nombre: m[1].trim(), depto: d };
  }
  return { nombre: t, depto: null };
}

function aLugar(f: Fila, tipos: Record<string, string>): Lugar {
  return { nombre: f[0], tipo: tipos[f[3]] || 'lugar', departamento: f[4], centro: [f[1], f[2]], zoom: pesoDe(f[3])[1] };
}

// Un caserío sin población registrada pesa menos que un cerro con el mismo nombre («Celaque»).
const puntaje = (f: Fila) => (f[3] === 'PPL' && !f[5] ? 27 : pesoDe(f[3])[0]) * 1e7 + Math.min(f[5] || 0, 9_999_999);

/** El lugar pedido (y hasta 4 alternativas con el mismo nombre), o null. */
export function buscarLugar(q: string): { lugar: Lugar; otros: Lugar[] } | null {
  const ix = cargar();
  const { nombre, depto } = separarDepartamento(q);
  if (!nombre || nombre.length < 2) return null;
  let cands = ix.porNombre.get(nombre) || [];
  // Sin exacto: empieza por lo pedido («santa rosa» → «Santa Rosa de Copán»), solo si es corto el salto.
  if (!cands.length && nombre.length >= 4) {
    const pref: Fila[] = [];
    for (const [k, l] of ix.porNombre) if (k.startsWith(`${nombre} `) && k.length - nombre.length <= 14) pref.push(...l);
    cands = [...new Set(pref)];
  }
  if (!cands.length) return null;
  if (depto) {
    const d = cands.filter((f) => fold(f[4]) === depto);
    if (d.length) cands = d;
  }
  const orden = [...cands].sort((a, b) => puntaje(b) - puntaje(a));
  // «Llévame a Choluteca» es la ciudad, no el departamento entero: si la cabecera se llama igual, va ella.
  if (orden[0][3] === 'ADM1') {
    const ciudad = orden.findIndex((f) => (f[3] === 'PPLA' || f[3] === 'PPLC') && fold(f[0]).replace(/^ciudad /, '') === fold(orden[0][0].replace(/^Departamento de /, '')));
    if (ciudad > 0) orden.unshift(...orden.splice(ciudad, 1));
  }
  return { lugar: aLugar(orden[0], ix.tipos), otros: orden.slice(1, 5).map((f) => aLugar(f, ix.tipos)) };
}

export { pedidoDeLugar } from '../../lib/pedidos-mapa';
