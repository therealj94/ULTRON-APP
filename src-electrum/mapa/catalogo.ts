/**
 * EL CATÁLOGO DE CAPAS, el mismo para el panel y para Dr Electrum.
 *
 * Instrucciones de corrección v1.0, sección 4.1: «no debe haber dos caminos». Este módulo no sabe
 * de React ni de la base: recibe las entradas del manifiesto (Índice Maestro v1.5, con `alias`,
 * `filtros` y `estilo`) y contesta qué capa es la que se pidió, qué valores de filtro tiene de
 * verdad, de qué color es cada uno y qué hay encendido. Lo importan el panel (src-electrum) y el
 * servidor (server/electrum/dialogo-capas.ts, las herramientas de manos.ts): las dos puntas buscan
 * igual, filtran igual y pintan igual.
 */
import { normalizar } from './categorias';

export type Categoria = { valor: string; color: string; icono?: string; grupo?: string; etiqueta?: string };
export type Estilo = {
  /** De dónde salió: el KML/KMZ, un archivo de estilo, un campo de color de la tabla o la paleta estándar. */
  fuente: 'kml' | 'archivo' | 'campo' | 'paleta' | 'imagen';
  /** `original`: cada rasgo con su propio relleno/borde/ícono del KML. `categorizado`: un color por valor de `campo`. */
  tipo: 'original' | 'categorizado' | 'unico' | 'graduado' | 'imagen';
  campo?: string;
  color?: string;
  /** El color de lo que no está en las categorías. */
  otro?: string;
  categorias?: Categoria[];
  /** Color de cada ícono del KMZ (los puntos de Google Earth se pintan con un ícono, no con un color). */
  iconos?: Record<string, string>;
  nota?: string;
};
export type FiltroCat = { campo: string; etiqueta?: string; valores: Array<string | number> };
export type EntradaCatalogo = {
  id: number;
  nombre: string;
  tipo: 'grupo' | 'vector' | 'raster' | 'kml' | 'documento';
  padre: number | null;
  orden: number;
  alias?: string[];
  filtros?: FiltroCat[];
  estilo?: Estilo | null;
  geometria?: string | null;
  num_entidades?: number | null;
  ruta_web?: string | null;
  fuentes?: Array<Record<string, unknown>>;
  caja?: [number, number, number, number] | null;
  sin_datos?: boolean;
  subgrupo?: string;
  id_anterior?: number;
};
/** Formato de filtros de las instrucciones: `{ "MINERAL": ["Oro"] }`. Varios valores = O; varios campos = Y. */
export type Filtros = Record<string, string[]>;
/** Lo que hay encendido, de lo más viejo a lo más nuevo (la última es «la última capa abierta»). */
export type EstadoMapa = { capas: Array<{ id: number; filtros: Filtros }> };

export const id6 = (id: number) => String(id).padStart(6, '0');

/** ¿Se puede encender? Los grupos, los planos y lo que no tiene datos, no. */
export function encendibleCat(e: EntradaCatalogo | undefined | null): boolean {
  return !!e && e.tipo !== 'grupo' && e.tipo !== 'documento' && !e.sin_datos && !!e.fuentes?.length && e.ruta_web !== null;
}

export function porIdDe(capas: EntradaCatalogo[]): Map<number, EntradaCatalogo> {
  return new Map(capas.map((c) => [c.id, c]));
}

/** Las capas que se encienden bajo una entrada (ella misma si es una capa). */
export function hojasCat(capas: EntradaCatalogo[], id: number): EntradaCatalogo[] {
  const hijos = new Map<number, EntradaCatalogo[]>();
  for (const c of capas) if (c.padre != null) hijos.set(c.padre, [...(hijos.get(c.padre) || []), c]);
  const out: EntradaCatalogo[] = [];
  const ir = (x: EntradaCatalogo) => {
    if (x.tipo === 'grupo') (hijos.get(x.id) || []).sort((a, b) => a.orden - b.orden).forEach(ir);
    else if (encendibleCat(x)) out.push(x);
  };
  const e = capas.find((c) => c.id === id);
  if (e) ir(e);
  return out;
}

/* ------------------------------------------------------------------ colores */

const SIN_COLOR = '#999999';

/** El color de un valor de un campo, según el estilo de la capa. Null si ese campo no da el color. */
export function colorDeValor(e: EntradaCatalogo, campo: string, valor: string): string | null {
  const s = e.estilo;
  if (!s || s.campo !== campo || !s.categorias) return null;
  return s.categorias.find((c) => c.valor === String(valor))?.color || s.otro || null;
}

/** El color «de la capa» para una muestra chica (panel, leyenda colapsada): el primero de su estilo. */
export function colorPrincipal(e: EntradaCatalogo): string {
  const s = e.estilo;
  return s?.color || s?.categorias?.[0]?.color || SIN_COLOR;
}

/** La leyenda de una capa: un renglón por color, sin repetir (en «Oro/Plata» manda el oro). */
export function leyendaDe(e: EntradaCatalogo, filtros?: Filtros): Array<{ texto: string; color: string }> {
  const s = e.estilo;
  if (!s) return [];
  if (s.tipo === 'unico' || !s.categorias?.length) return s.color ? [{ texto: e.nombre, color: s.color }] : [];
  const marcados = s.campo ? filtros?.[s.campo] : undefined;
  const vistos = new Map<string, { texto: string; color: string }>();
  for (const c of s.categorias) {
    if (marcados?.length && !marcados.includes(c.valor)) continue;
    const texto = c.grupo || c.etiqueta || c.valor;
    const k = `${c.color}|${normalizar(texto)}`;
    if (!vistos.has(k)) vistos.set(k, { texto, color: c.color });
  }
  return [...vistos.values()];
}

/** Los filtros de una capa con sus valores reales y el color de cada uno (valores_filtro). */
export function valoresConColor(e: EntradaCatalogo): Array<{ campo: string; etiqueta: string; valores: Array<{ valor: string; texto: string; color: string | null }> }> {
  return (e.filtros || []).map((f) => ({
    campo: f.campo,
    etiqueta: f.etiqueta || f.campo,
    valores: f.valores.map((v) => {
      const valor = String(v);
      const cat = e.estilo?.campo === f.campo ? e.estilo.categorias?.find((c) => c.valor === valor) : undefined;
      return { valor, texto: cat?.etiqueta || valor, color: colorDeValor(e, f.campo, valor) };
    }),
  }));
}

/** El color de un rasgo, en JavaScript (el mapa de Google no entiende expresiones de MapLibre). */
export function colorDeRasgo(estilo: Estilo | null | undefined, valor: (campo: string) => unknown, geometria: string, porDefecto: string): { relleno: string; borde: string; opacidadRelleno: number | null } {
  if (!estilo) return { relleno: porDefecto, borde: porDefecto, opacidadRelleno: null };
  if (estilo.tipo === 'categorizado' && estilo.campo) {
    const v = valor(estilo.campo);
    const c = estilo.categorias?.find((x) => x.valor === String(v ?? ''))?.color || estilo.otro || porDefecto;
    return { relleno: c, borde: c, opacidadRelleno: null };
  }
  if (estilo.tipo === 'original') {
    const color = (k: string) => {
      const v = valor(k);
      return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : null;
    };
    const g = geometria.toLowerCase();
    if (g.includes('point')) {
      const ico = valor('icon');
      const base = typeof ico === 'string' ? ico.split('/').pop() || '' : '';
      const c = (base && estilo.iconos?.[base]) || color('icon-color') || estilo.color || porDefecto;
      return { relleno: c, borde: c, opacidadRelleno: null };
    }
    const fo = Number(valor('fill-opacity'));
    const borde = color('stroke') || color('fill') || estilo.color || porDefecto;
    return { relleno: color('fill') || borde, borde, opacidadRelleno: Number.isFinite(fo) ? fo : null };
  }
  const c = estilo.color || porDefecto;
  return { relleno: c, borde: c, opacidadRelleno: null };
}

/** Los campos que un rasgo tiene que traer para poder pintarse con su estilo. */
export function camposDeEstilo(estilo: Estilo | null | undefined): string[] {
  if (!estilo) return [];
  if (estilo.tipo === 'original') return ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'icon', 'icon-color'];
  return estilo.campo ? [estilo.campo] : [];
}

/* ------------------------------------------------------------------ cumplir un filtro */

/** ¿Cumple el rasgo los filtros? Varios valores = O; varios campos = Y. Sin filtros, todo. */
export function cumpleFiltros(valor: (campo: string) => unknown, filtros: Filtros | null | undefined): boolean {
  return Object.entries(filtros || {}).every(([campo, vs]) => !vs.length || vs.includes(String(valor(campo) ?? '')));
}

/** Solo lo que existe: campos de la capa y valores reales. Lo demás se cae (y se dice cuál). */
export function validarFiltros(e: EntradaCatalogo, filtros: Record<string, unknown> | null | undefined): { filtros: Filtros; rechazados: string[] } {
  const out: Filtros = {};
  const rechazados: string[] = [];
  for (const [campo0, vs0] of Object.entries(filtros || {})) {
    const f = (e.filtros || []).find((x) => x.campo === campo0) || (e.filtros || []).find((x) => normalizar(x.campo) === normalizar(campo0) || normalizar(x.etiqueta || '') === normalizar(campo0));
    const vs = (Array.isArray(vs0) ? vs0 : [vs0]).map(String);
    if (!f) {
      rechazados.push(`${campo0} (la capa no tiene ese campo)`);
      continue;
    }
    const reales = f.valores.map(String);
    const ok: string[] = [];
    for (const v of vs) {
      const exacto = reales.find((x) => x === v) || reales.find((x) => normalizar(x) === normalizar(v));
      const hits = exacto ? [exacto] : valoresPorPalabra(e, f.campo, v);
      if (hits.length) ok.push(...hits);
      else rechazados.push(`${v} (no hay ese valor en ${f.etiqueta || f.campo})`);
    }
    if (ok.length) out[f.campo] = [...new Set(ok)];
  }
  return { filtros: out, rechazados };
}

/* ------------------------------------------------------------------ entender lo que se pide */

/** Símbolos y formas cortas de los minerales: «Au» es oro, «las de oro» también. */
const SINONIMOS: Record<string, string> = {
  au: 'oro', ag: 'plata', cu: 'cobre', pb: 'plomo', zn: 'zinc', fe: 'hierro', sb: 'antimonio', mn: 'manganeso', ni: 'niquel', hg: 'mercurio',
  polimetalicos: 'polimetalico', polimetalica: 'polimetalico', polimetalicas: 'polimetalico', 'oro y plata': 'oro',
};
const VACIAS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'en', 'a', 'al', 'con', 'mapa', 'mapas', 'capa', 'capas', 'honduras', 'por', 'favor', 'me', 'mi', 'mis', 'que', 'tambien', 'ademas', 'ahora', 'un', 'una', 'unos', 'unas', 'solo', 'solamente', 'nada', 'mas', 'lo', 'le']);

/** Una palabra en su forma de comparar: sin tildes, en singular y con los símbolos traducidos. */
function forma(p: string): string {
  const t = normalizar(p);
  if (SINONIMOS[t]) return SINONIMOS[t];
  if (t.length <= 3) return t;
  // El plural en -es va tras consonante («minerales»); si no, solo la -s («puentes» → «puente»).
  return /[lrndzj]es$/.test(t) ? t.slice(0, -2) : t.replace(/s$/, '');
}
const palabras = (t: string) => normalizar(t).split(' ').filter(Boolean).map(forma);

/** ¿Está la frase `a` dentro de `t`, palabra por palabra y en orden? */
function contiene(t: string[], a: string[]): boolean {
  if (!a.length || a.length > t.length) return false;
  for (let i = 0; i + a.length <= t.length; i++) if (a.every((w, j) => t[i + j] === w)) return true;
  return false;
}

/** Los valores reales de un campo que nombra esta palabra («oro» → Oro, Oro/Plata, Oro y Plata). */
export function valoresPorPalabra(e: EntradaCatalogo, campo: string, palabra: string): string[] {
  const f = (e.filtros || []).find((x) => x.campo === campo);
  if (!f) return [];
  const p = palabras(palabra).filter((w) => !VACIAS.has(w));
  if (!p.length) return [];
  const cats = e.estilo?.campo === campo ? e.estilo.categorias || [] : [];
  return f.valores.map(String).filter((v) => {
    const cat = cats.find((c) => c.valor === v);
    // El grupo es el primer mineral: «oro» trae Oro, Oro/Plata y Oro y Plata.
    if (cat?.grupo && contiene(p, palabras(cat.grupo))) return true;
    const pv = palabras(cat?.etiqueta || v);
    return pv.length > 0 && contiene(p, pv);
  });
}

/** Los filtros que se nombran en el texto («las de oro», «solicitadas»), con valores reales. */
export function filtrosEnTexto(e: EntradaCatalogo, texto: string): Filtros | null {
  const t = palabras(texto).filter((w) => !VACIAS.has(w));
  if (!t.length) return null;
  const out: Filtros = {};
  for (const f of e.filtros || []) {
    const cats = e.estilo?.campo === f.campo ? e.estilo.categorias || [] : [];
    const xs = f.valores.map(String).filter((v) => {
      const cat = cats.find((c) => c.valor === v);
      if (cat?.grupo && contiene(t, palabras(cat.grupo))) return true;
      const pv = palabras(cat?.etiqueta || v).filter((w) => !VACIAS.has(w));
      // Un valor de una sola letra o un número suelto no se adivina en una frase.
      return pv.length > 0 && pv.join('').length > 2 && contiene(t, pv);
    });
    if (xs.length) out[f.campo] = xs;
  }
  return Object.keys(out).length ? out : null;
}

export type Candidato = { id: number; nombre: string; tipo: EntradaCatalogo['tipo']; por: 'id' | 'alias' | 'nombre' | 'valor'; frase: string; puntos: number };

/**
 * buscar_capas: el texto contra el catálogo, por ID, alias, nombre o valor de filtro. Devuelve las
 * mejores (si empatan, hay que preguntar). Un grupo con una sola capa es esa capa.
 */
export function buscarCapas(capas: EntradaCatalogo[], texto: string): Candidato[] {
  const t = palabras(texto);
  if (!t.length) return [];
  const sig = t.filter((w) => !VACIAS.has(w));
  const por = porIdDe(capas);
  const hojaUnica = (e: EntradaCatalogo): EntradaCatalogo => {
    if (e.tipo !== 'grupo') return e;
    const hs = hojasCat(capas, e.id);
    const hijos = capas.filter((c) => c.padre === e.id);
    return hs.length === 1 && hijos.length === 1 ? hs[0] : e;
  };
  const mejor = new Map<number, Candidato>();
  const anotar = (e0: EntradaCatalogo, por_: Candidato['por'], frase: string, puntos: number) => {
    if (e0.id === 900000 || e0.padre === 900000) return;
    const e = hojaUnica(e0);
    const prev = mejor.get(e.id);
    if (!prev || prev.puntos < puntos) mejor.set(e.id, { id: e.id, nombre: e.nombre, tipo: e.tipo, por: por_, frase, puntos });
  };
  const id = normalizar(texto).match(/\b(\d{6})\b/);
  if (id) {
    const n = Number(id[1]);
    const e = por.get(n) || capas.find((c) => c.id_anterior === n);
    if (e) anotar(e, 'id', id[1], 1000);
  }
  for (const e of capas) {
    const nombre = normalizar(e.nombre).replace(/^\d\s+/, '');
    for (const a of e.alias || []) {
      const pa = palabras(a).filter((w) => !VACIAS.has(w));
      if (!pa.length) continue;
      // Exacto vale más que contenido; más palabras, más que menos (curado o nombre, igual).
      if (pa.join(' ') === sig.join(' ')) anotar(e, 'alias', a, 500 + pa.length);
      else if (contiene(sig, pa)) anotar(e, 'alias', a, 100 + pa.length * 10);
    }
    const pn = palabras(nombre).filter((w) => !VACIAS.has(w));
    if (pn.length && pn.join(' ') === sig.join(' ')) anotar(e, 'nombre', e.nombre, 500 + pn.length);
    else if (pn.length && contiene(sig, pn)) anotar(e, 'nombre', e.nombre, 90 + pn.length * 10);
  }
  let xs = [...mejor.values()];
  if (!xs.length) {
    // Nada por nombre: ¿lo que nombra es un valor de filtro de alguna capa? («lo de antimonio»)
    for (const e of capas) {
      if (!encendibleCat(e)) continue;
      const f = filtrosEnTexto(e, texto);
      if (f) anotar(e, 'valor', Object.values(f).flat().join(', '), 10);
    }
    xs = [...mejor.values()];
  }
  if (!xs.length) return [];
  const tope = Math.max(...xs.map((x) => x.puntos));
  // Un grupo y una capa suya con los mismos puntos: la capa (es más precisa).
  let ganan = xs.filter((x) => x.puntos === tope);
  ganan = ganan.filter((x) => !ganan.some((y) => y.id !== x.id && esAncestro(por, x.id, y.id)));
  // Una categoría del índice (bloques 1 y 2) le gana a un archivo suelto de un proyecto u Otros que
  // solo se llama igual («catastro», «Ríos»): ese empate no es una duda de verdad.
  if (ganan.some((x) => x.id < 300000)) ganan = ganan.filter((x) => x.id < 300000 || x.por !== 'nombre');
  return ganan.sort((a, b) => a.id - b.id);
}

function esAncestro(por: Map<number, EntradaCatalogo>, a: number, b: number): boolean {
  let p = por.get(b)?.padre;
  while (p != null) {
    if (p === a) return true;
    p = por.get(p)?.padre;
  }
  return false;
}

/* ------------------------------------------------------------------ hablar de una capa */

const NOMBRE_COLOR: Record<string, string> = {
  '#FFD700': 'amarillo', '#C0C0C0': 'gris plata', '#B87333': 'color cobre', '#5B6770': 'gris azulado', '#7A9CC6': 'azul acero',
  '#8B2E16': 'rojo óxido', '#8E44AD': 'violeta', '#4B0082': 'morado oscuro', '#2E8B57': 'verde', '#C2A878': 'marrón claro',
  '#FF8C00': 'naranja', '#999999': 'gris', '#DC143C': 'carmesí', '#9ACD32': 'verde amarillo',
};
export function nombreDeColor(hex: string | null | undefined): string | null {
  return hex ? NOMBRE_COLOR[hex.toUpperCase()] || null : null;
}

/** «puntos», «áreas» o «líneas», según la geometría (o «rasgos» si no se sabe). */
export function unidad(e: EntradaCatalogo, n: number): string {
  const g = (e.geometria || '').toLowerCase();
  const [uno, varios] = g.includes('point') ? ['punto', 'puntos'] : g.includes('line') ? ['línea', 'líneas'] : g.includes('polygon') ? ['área', 'áreas'] : ['rasgo', 'rasgos'];
  return `${n.toLocaleString('es-HN')} ${n === 1 ? uno : varios}`;
}

/** «oro, plata y cobre». */
export function enumerar(xs: string[], y = 'y'): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} ${y} ${xs[xs.length - 1]}`;
}

/** «las fichas de oro», «las Áreas protegidas»: cómo se nombra una capa encendida en una frase. */
export function frase(e: EntradaCatalogo, filtros?: Filtros): string {
  const corto = nombreCorto(e);
  const vs = Object.values(filtros || {}).flat();
  return vs.length ? `${corto} de ${enumerar(vs.map((v) => v.toLowerCase()), 'o')}` : corto;
}

/** El nombre como se dice: «las fichas» para las fichas, el nombre del índice para lo demás. */
export function nombreCorto(e: EntradaCatalogo): string {
  if (e.id === 110002 || e.id === 110003) return 'las fichas';
  if (e.id === 110001) return 'los depósitos';
  if (e.id === 104001) return 'los derechos mineros';
  return `«${e.nombre}»`;
}
