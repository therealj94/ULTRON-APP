/**
 * EL ÍNDICE DE CAPAS, sin React: los tipos del manifiesto, el árbol, los estilos por capa, el filtro
 * de MapLibre a partir de lo marcado y lo que se quiere decir cuando alguien pide una capa de palabra.
 *
 * El manifiesto (Índice Maestro de Capas v1.4) vive en el cubo y lo sirve
 * /api/electrum/mapa/indice. Aquí nada está escrito a mano salvo los nombres con que la gente pide
 * las cosas («los ríos», «la geología», «el catastro»).
 */
import { ESTILO_ROL } from './capas';
import { normalizar } from './categorias';

export type FiltroIndice = { campo: string; etiqueta?: string; valores: string[] };
export type FuenteIndice = {
  base?: boolean;
  propiedades?: Record<string, string>;
  cartera?: string;
  catastro?: boolean;
  perimetro?: boolean;
  muestras?: boolean;
  tesela?: string;
  caja?: [number, number, number, number];
  plano?: string;
  documento?: number | null;
};
export type EntradaIndice = {
  id: number;
  nombre: string;
  tipo: 'grupo' | 'vector' | 'raster' | 'kml' | 'documento';
  padre: number | null;
  orden: number;
  geometria?: string | null;
  num_entidades?: number | null;
  ruta_web?: string | null;
  filtros?: FiltroIndice[];
  fuentes?: FuenteIndice[];
  caja?: [number, number, number, number] | null;
  notas?: string;
  visible_por_defecto?: boolean;
};

export type Nodo = EntradaIndice & { hijos: Nodo[] };

/** El árbol, ordenado por `orden` en cada nivel. La capa base (000001) no va: no se apaga. */
export function arbolDe(capas: EntradaIndice[]): Nodo[] {
  const nodos = new Map<number, Nodo>(capas.map((c) => [c.id, { ...c, hijos: [] }]));
  const raices: Nodo[] = [];
  for (const n of nodos.values()) {
    if (n.id === 1) continue;
    const p = n.padre != null ? nodos.get(n.padre) : null;
    if (p) p.hijos.push(n);
    else raices.push(n);
  }
  const ordenar = (xs: Nodo[]) => {
    xs.sort((a, b) => a.orden - b.orden || a.id - b.id);
    xs.forEach((x) => ordenar(x.hijos));
  };
  ordenar(raices);
  // La cuarentena no se carga al mapa: no va en el árbol.
  return raices.filter((r) => r.id !== 900000);
}

/** Las hojas (capas que se encienden) bajo un nodo. */
export function hojasDe(n: Nodo): Nodo[] {
  return n.tipo === 'grupo' ? n.hijos.flatMap(hojasDe) : [n];
}

/** ¿Se puede encender? Las faltantes (sin fuente) y los grupos no. */
export function encendible(e: EntradaIndice): boolean {
  return e.tipo !== 'grupo' && e.tipo !== 'documento' && !!e.fuentes?.length && e.ruta_web !== null;
}

/** De qué sale una capa: la base (vía /indice/capa/:id), el catastro, teselas, muestras o un plano. */
export function claseDeFuente(e: EntradaIndice): 'base' | 'catastro' | 'tesela' | 'muestras' | 'plano' | 'perimetro' | null {
  const f = e.fuentes || [];
  if (f.some((x) => x.catastro)) return 'catastro';
  if (f.some((x) => x.perimetro)) return 'perimetro';
  if (f.some((x) => x.muestras)) return 'muestras';
  if (f.some((x) => x.tesela)) return 'tesela';
  if (f.some((x) => x.plano)) return 'plano';
  if (f.some((x) => x.base || x.cartera)) return 'base';
  return null;
}

/** La clase de estilo de una capa del índice, para reusar los estilos del mapa. */
export function rolDe(e: EntradaIndice): string {
  const c = Math.floor(e.id / 1000);
  const g = (e.geometria || '').toLowerCase();
  if (c === 101) return 'area_protegida';
  if (c === 108) return 'microcuenca';
  if (c === 109) return 'forestal';
  if (c === 110) return 'ocurrencia';
  if (c === 111) return 'zona_informal';
  if (e.id === 105001) return 'departamento';
  if (e.id === 105002) return 'municipio';
  if (c >= 201 && c <= 209 && g.includes('line')) return 'falla';
  if (c === 401) return 'historico';
  return 'proyecto';
}

const PALETA = ['#FFB020', '#5CC8FF', '#B891FF', '#7CFFB2', '#FF7A45', '#F2D16B', '#4DA3FF', '#FF4FD8', '#C9A0FF', '#2ECC71', '#E9D18B', '#FF6B6B'];

/** El color de una capa: el de su clase si la tiene propia; si no, uno estable por su ID. */
export function colorDe(e: EntradaIndice): string {
  const rol = rolDe(e);
  if (rol !== 'proyecto' && ESTILO_ROL[rol]) return ESTILO_ROL[rol].color;
  return PALETA[e.id % PALETA.length];
}

/** Lo marcado en los filtros de una capa → una expresión de MapLibre. Nada marcado: null (todo). */
export function expresionFiltro(marcados: Record<string, string[]> | undefined): unknown[] | null {
  const partes = Object.entries(marcados || {})
    .filter(([, vs]) => vs.length)
    .map(([campo, vs]) => ['in', ['to-string', ['get', campo]], ['literal', vs]]);
  if (!partes.length) return null;
  return partes.length === 1 ? partes[0] : ['all', ...partes];
}

export const hayFiltro = (marcados: Record<string, string[]> | undefined) => Object.values(marcados || {}).some((v) => v.length > 0);

/** Las capas de la base que pesan: más que esto se avisa antes de encender un grupo entero. */
export const CONFIRMAR_GRUPO = 10;

/* ------------------------------------------------------------------ de palabra */

/** Cómo se piden las cosas, contra IDs del índice (un grupo enciende sus capas). */
const ALIAS: Array<[RegExp, number[]]> = [
  [/\b(mapa politico|politicos?|politicas?|division politica|limites?)\b/, [105001, 105002]],
  [/\bdepartamentos?\b/, [105001]],
  [/\bmunicipios?\b/, [105002]],
  [/\b(caserios?|poblados?|comunidades)\b/, [105003]],
  [/\baldeas?\b/, [105004]],
  [/\b(rios?|red hidrica|quebradas?|hidrografia)\b/, [105005]],
  [/\b(curvas( de nivel)?)\b/, [103001]],
  [/\b(areas? protegidas?|protegidas?|parques?( nacionales)?|reservas?)\b/, [101001]],
  [/\b(carreteras?|vias?|caminos principales)\b/, [102001]],
  [/\b(catastro|derechos mineros|concesiones mineras|el catastro)\b/, [104001]],
  [/\b(hojas?( cartograficas?)?|cartograficas?|topograficos?)\b/, [106000]],
  [/\b(concesiones indexa|indexa|concesiones de indexa)\b/, [107000]],
  [/\btargets?|blancos\b/, [107007]],
  [/\b(micro ?cuencas?|cuencas?)\b/, [108001]],
  [/\b(forestal|bosques?|patrimonio forestal)\b/, [109001]],
  [/\b(depositos?( minerales)?)\b/, [110001]],
  [/\bfichas?( seleccionadas| de ocurrencia)?\b/, [110002, 110003]],
  [/\b(yacimientos?|ocurrencias?|recursos mineros|recursos)\b/, [110000]],
  [/\b(zonas? informales?|mineria informal|informal|artesanal)\b/, [111001]],
  [/\b(geologia|geologicas?|geologicos?|informacion geologica)\b/, [200000]],
  [/\bestructurales?\b/, [201001, 202001, 206001]],
  [/\bfallas?\b/, [203001]],
  [/\bgeotectonico\b/, [207001]],
  [/\bmetalogenetico\b/, [208001]],
  [/\bsuelos?( simmons)?\b/, [210001]],
  [/\b(proyectos?( indexa)?( propios)?)\b/, [300000]],
  [/\b(historia|historicos?|historicas?|jica)\b/, [401000]],
  [/\bmuestras?( geoquimicas)?\b/, [401005]],
  [/\b(sentinel|satelitales?|alteracion|arcillas?|oxidos?|vegetacion)\b/, []],
];

const VACIAS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'en', 'mapa', 'mapas', 'capa', 'capas', 'honduras', 'todo', 'todos', 'todas', 'por', 'favor']);

/**
 * Lo pedido → IDs de capas que se encienden. `todo` para «todas las capas» (solo para apagar).
 * Primero los nombres que la gente usa; si no, el nombre de la capa en el índice («Pantaleona»,
 * «Suelos Simmons», «105002»).
 */
export function resolverIndice(que: string, nodos: Nodo[]): { ids: number[]; todo?: boolean; nombre: string } {
  const t = normalizar(que)
    .replace(/^(el|la|los|las|un|una)\s+/, '')
    .replace(/^(capas?|mapas?)\s+(de|del)\s+(la\s+|las\s+|los\s+|el\s+)?/, '')
    .trim();
  const todas = nodos.flatMap(hojasDe).filter(encendible);
  if (/^(todo|todas|todos|todo lo demas|todas las capas|las capas|capas)$/.test(t)) return { ids: todas.map((x) => x.id), todo: true, nombre: 'todas las capas' };
  const porId = new Map<number, Nodo>();
  const recorrer = (xs: Nodo[]) => xs.forEach((x) => (porId.set(x.id, x), recorrer(x.hijos)));
  recorrer(nodos);
  const expandir = (ids: number[]) => ids.flatMap((i) => (porId.get(i) ? hojasDe(porId.get(i)!) : [])).filter(encendible).map((x) => x.id);

  const id = t.match(/\b(\d{6})\b/);
  if (id && porId.get(Number(id[1]))) return { ids: expandir([Number(id[1])]), nombre: porId.get(Number(id[1]))!.nombre };

  const sat = /\b(sentinel|satelitales?|alteracion|arcillas?|oxidos?|vegetacion)\b/.test(t);
  if (sat) {
    const xs = todas.filter((x) => (x.fuentes || []).some((f) => f.tesela && /^s2-/.test(f.tesela)) && (/(sentinel|satelital)/.test(t) || normalizar(x.nombre).split(' ').some((w) => w.length > 4 && t.includes(w.slice(0, -1)))));
    if (xs.length) return { ids: xs.map((x) => x.id), nombre: xs.length === 1 ? xs[0].nombre : 'las capas de Sentinel-2' };
  }
  const deAlias = ALIAS.filter(([re, ids]) => ids.length && re.test(t)).flatMap(([, ids]) => ids);
  if (deAlias.length) {
    const ids = [...new Set(expandir(deAlias))];
    const uno = deAlias.length === 1 ? porId.get(deAlias[0]) : null;
    return { ids, nombre: uno ? uno.nombre.replace(/^\d\s+/, '') : `${ids.length} capas` };
  }
  const palabras = t.split(' ').filter((p) => p.length >= 4 && !VACIAS.has(p));
  if (!palabras.length) return { ids: [], nombre: que };
  const xs = [...porId.values()].filter((x) => palabras.every((p) => normalizar(x.nombre).includes(p.replace(/s$/, ''))));
  // Si casa un grupo, el grupo entero; si no, las capas que casan.
  const grupo = xs.find((x) => x.tipo === 'grupo');
  const ids = grupo ? expandir([grupo.id]) : xs.filter(encendible).map((x) => x.id);
  return { ids: [...new Set(ids)], nombre: grupo ? grupo.nombre : xs.length === 1 ? xs[0].nombre : `${ids.length} capas` };
}
