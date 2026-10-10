/**
 * EL ÍNDICE DE CAPAS, sin React: los tipos del manifiesto, el árbol, los estilos por capa, el filtro
 * de MapLibre a partir de lo marcado y lo que se quiere decir cuando alguien pide una capa de palabra.
 *
 * El manifiesto (Índice Maestro de Capas v1.5) vive en el cubo y lo sirve
 * /api/electrum/mapa/indice. Aquí nada está escrito a mano: ni las capas, ni sus nombres de palabra
 * (los `alias` del manifiesto), ni sus colores (su `estilo`).
 */
import { ESTILO_ROL } from './capas';
import { normalizar } from './categorias';
import { buscarCapas, colorPrincipal, hojasCat, type EntradaCatalogo, type Estilo } from './catalogo';

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
  /** Cómo se pinta (correcciones v1.0, 2.3): el mismo estilo en el mapa, la leyenda y Electrum. */
  estilo?: Estilo | null;
  alias?: string[];
  /** En el índice pero sin archivo: gris, «Sin datos». */
  sin_datos?: boolean;
  subgrupo?: string;
  id_anterior?: number;
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
  return e.tipo !== 'grupo' && e.tipo !== 'documento' && !e.sin_datos && !!e.fuentes?.length && e.ruta_web !== null;
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

/** El color de una capa: el de su estilo en el manifiesto; sin estilo, el de su clase o uno estable por su ID. */
export function colorDe(e: EntradaIndice): string {
  if (e.estilo && e.estilo.tipo !== 'imagen') return colorPrincipal(e as EntradaCatalogo);
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

/**
 * El mismo filtro, evaluado en JavaScript: el mapa de Google no entiende expresiones de MapLibre.
 * Solo entiende lo que arma `expresionFiltro` (`in` sobre un campo y `all` de varios).
 */
export function cumpleFiltroIndice(valor: (campo: string) => unknown, filtro: unknown[] | null | undefined): boolean {
  if (!filtro) return true;
  if (filtro[0] === 'all') return (filtro.slice(1) as unknown[][]).every((f) => cumpleFiltroIndice(valor, f));
  if (filtro[0] === 'in') {
    const campo = ((filtro[1] as unknown[])?.[1] as unknown[])?.[1] as string;
    const vals = ((filtro[2] as unknown[])?.[1] as unknown[]) || [];
    const v = valor(campo);
    return v != null && vals.includes(String(v));
  }
  return true;
}

export const hayFiltro = (marcados: Record<string, string[]> | undefined) => Object.values(marcados || {}).some((v) => v.length > 0);

/** Las capas de la base que pesan: más que esto se avisa antes de encender un grupo entero. */
export const CONFIRMAR_GRUPO = 10;

/* ------------------------------------------------------------------ de palabra */

/**
 * Lo pedido de palabra → IDs de capas que se encienden. `todo` para «todas las capas» (solo para
 * apagar). Busca igual que Dr Electrum (catalogo.ts → buscarCapas): por los `alias` del manifiesto,
 * el nombre o el ID. Aquí no hay ninguna lista de capas escrita a mano.
 */
export function resolverIndice(que: string, nodos: Nodo[]): { ids: number[]; todo?: boolean; nombre: string; varias?: string[] } {
  const t = normalizar(que)
    .replace(/^(el|la|los|las|un|una)\s+/, '')
    .replace(/^(capas?|mapas?)\s+(de|del)\s+(la\s+|las\s+|los\s+|el\s+)?/, '')
    .trim();
  const lista: EntradaIndice[] = [];
  const recorrer = (xs: Nodo[]) => xs.forEach((x) => (lista.push(x), recorrer(x.hijos)));
  recorrer(nodos);
  const todas = lista.filter(encendible);
  if (/^(todo|todas|todos|todo lo demas|todas las capas|las capas|capas)$/.test(t)) return { ids: todas.map((x) => x.id), todo: true, nombre: 'todas las capas' };
  const cands = buscarCapas(lista as EntradaCatalogo[], t);
  if (!cands.length) return { ids: [], nombre: que };
  // Varias que empatan: no se adivina, se dice cuáles (la pestaña o Electrum preguntan).
  if (cands.length > 1) return { ids: [], nombre: que, varias: cands.map((c) => c.nombre) };
  const ids = hojasCat(lista as EntradaCatalogo[], cands[0].id).map((x) => x.id);
  return { ids, nombre: cands[0].nombre.replace(/^\d\s+/, '') };
}
