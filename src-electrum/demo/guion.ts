/**
 * EL GUION DEL RECORRIDO: qué mostrar y qué decir, sacado de los datos.
 *
 * Aquí no hay React ni mapa: solo cuentas sobre lo que devolvió el servidor, para poder probarlas
 * con datos de verdad. La zona «con más información» no está escrita a mano: es la que junta más
 * mapas escaneados, y dentro de ella la concesión que se analiza es la de mayor prospectividad.
 */

export type Encuadre = [number, number, number, number];
export type Raster = { clave: string; nombre: string; escala?: string; encuadre: Encuadre };
export type Rasgo = { geometry: any; properties: Record<string, any> };

/** El nombre para decirlo en voz alta: sin notas del padrón como «(GRAVADO CON PRIMERA HIPOTECA)». */
export const nombreParaDecir = (n: string) => String(n || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/[.\s]+$/, '').replace(/\s+/g, ' ').trim();

export const fold = (s: unknown) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export const centroDe = (e: Encuadre): [number, number] => [(e[0] + e[2]) / 2, (e[1] + e[3]) / 2];
const dentro = (p: [number, number], e: Encuadre) => p[0] >= e[0] && p[0] <= e[2] && p[1] >= e[1] && p[1] <= e[3];

/** El rectángulo que envuelve una geometría GeoJSON. */
export function encuadreDe(g: any): Encuadre | null {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const andar = (c: any) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number') {
      x0 = Math.min(x0, c[0]);
      y0 = Math.min(y0, c[1]);
      x1 = Math.max(x1, c[0]);
      y1 = Math.max(y1, c[1]);
    } else c.forEach(andar);
  };
  andar(g?.coordinates);
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
}

/** El orden en que se enseñan los mapas de una zona: geología, estructura, anomalías. */
function pesoMapa(clave: string) {
  const c = fold(clave);
  if (c.includes('geolog')) return 0;
  if (c.includes('estructur')) return 1;
  if (c.includes('cu')) return 2;
  return 3;
}

/**
 * La zona con más información: el encuadre que comparten más mapas escaneados locales (los
 * nacionales, como los de Sentinel-2, no cuentan: cubren todo el país). Null si no hay ninguno.
 */
export function zonaMasRica(rasters: Raster[]): { nombre: string; encuadre: Encuadre; mapas: Raster[] } | null {
  const grupos = new Map<string, Raster[]>();
  for (const r of rasters) {
    const e = r.encuadre;
    if (!Array.isArray(e) || e.length !== 4) continue;
    if (e[2] - e[0] > 3 || e[3] - e[1] > 2.5) continue; // nacional
    const k = e.map((v) => v.toFixed(2)).join(',');
    grupos.set(k, [...(grupos.get(k) || []), r]);
  }
  const mejor = [...grupos.values()].sort((a, b) => b.length - a.length)[0];
  if (!mejor) return null;
  const mapas = [...mejor].sort((a, b) => pesoMapa(a.clave) - pesoMapa(b.clave));
  // «Mapa geológico de Olancho (JICA)» → «Olancho».
  const m = mapas.map((x) => /\bde ([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ ]*?)\s*(\(|$)/.exec(x.nombre)).find(Boolean);
  return { nombre: m ? m[1].trim() : 'esta zona', encuadre: mejor[0].encuadre, mapas };
}

/** Las concesiones cuyo centro cae en el encuadre, de mayor a menor prospectividad. */
export function concesionesEn(catastro: { features: Rasgo[] } | null, e: Encuadre) {
  const lista: Array<{ id: number; nombre: string; ha: number; prosp: number; centro: [number, number] }> = [];
  for (const f of catastro?.features || []) {
    const b = encuadreDe(f.geometry);
    if (!b) continue;
    const c = centroDe(b);
    if (!dentro(c, e)) continue;
    lista.push({ id: Number(f.properties?.id), nombre: String(f.properties?.nombre || ''), ha: Number(f.properties?.hectareas) || 0, prosp: Number(f.properties?.prosp) || 0, centro: c });
  }
  return lista.sort((a, b) => b.prosp - a.prosp || b.ha - a.ha);
}

/**
 * Las muestras de oro: cuántas hay, la más alta (en g/t: vienen en ppb) y dónde mirar. El «dónde»
 * es el centro de las diez más altas que caen a menos de 30 km de la mayor, para que la cámara
 * encuadre el racimo y no un punto suelto.
 */
export function focoDeOro(fc: { features?: Rasgo[] } | null) {
  const conOro = (fc?.features || []).filter((f) => Number.isFinite(Number(f.properties?.au)) && Array.isArray(f.geometry?.coordinates));
  if (!conOro.length) return null;
  const orden = [...conOro].sort((a, b) => Number(b.properties.au) - Number(a.properties.au));
  const top = orden[0].geometry.coordinates as [number, number];
  const cerca = orden.filter((f) => Math.hypot(f.geometry.coordinates[0] - top[0], f.geometry.coordinates[1] - top[1]) < 0.27).slice(0, 10);
  const centro: [number, number] = [cerca.reduce((s, f) => s + f.geometry.coordinates[0], 0) / cerca.length, cerca.reduce((s, f) => s + f.geometry.coordinates[1], 0) / cerca.length];
  return {
    total: (fc?.features || []).length,
    conOro: conOro.length,
    maxGt: Number(orden[0].properties.au) / 1000,
    sobreUnGramo: conOro.filter((f) => Number(f.properties.au) >= 1000).length,
    centro,
  };
}

type Renglones = { estado?: string; renglones?: string[] } | undefined;
const renglones = (r: Renglones) => (r?.estado === 'ok' && Array.isArray(r.renglones) ? r.renglones : []);

/** La primera frase de un renglón que calce, sin listas entre paréntesis ni lo que va tras «:». */
function frase(r: Renglones, re: RegExp, corte = true): string | null {
  const t = renglones(r).find((x) => re.test(x));
  if (!t) return null;
  let s = t.replace(/\s*\([^)]*\)/g, '');
  if (corte) s = s.split(/:\s/)[0];
  s = s.replace(/\s+/g, ' ').trim().replace(/[.;,\s]+$/, '');
  return s ? `${s}.` : null;
}

export type Ficha = {
  id: number;
  nombre: string;
  datos?: Array<[string, string]>;
  encuadre?: Encuadre | null;
  geojson?: any;
  entorno?: Renglones;
  geologia?: Renglones;
  satelite?: Renglones;
  prospectividad?: Renglones & { puntaje?: number; nivel?: string };
};

const dato = (f: Ficha, clave: string) => f.datos?.find(([k]) => fold(k) === fold(clave))?.[1] || null;

/** «1000,81» o «6.6» → número. Las fichas escriben con coma decimal y a veces con punto. */
const numero = (t: string) => {
  const limpio = t.trim();
  // «1.000,81» (miles con punto) o «1000,81» → coma decimal; «6.6» → punto decimal.
  const n = /,\d+$/.test(limpio) ? Number(limpio.replace(/\./g, '').replace(',', '.')) : Number(limpio.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
// Formato de España a propósito: se DICE en voz alta, y «1.001» la voz lo lee como «mil uno».
const nf = (x: number, d = 0) => x.toLocaleString('es-ES', { maximumFractionDigits: d });

/**
 * Lo que se dice de una concesión analizada: quién, cuánto, su potencial, su geología, su gente y
 * su conflicto. Cada frase sale de un renglón de su ficha; lo que la ficha no trae, no se dice.
 */
export function analisisDeFicha(f: Ficha): string[] {
  const nombre = nombreParaDecir(f.nombre);
  const titular = dato(f, 'Titular');
  const areaTxt = dato(f, 'Área medida');
  const area = areaTxt ? numero(areaTxt.replace(/\s*ha$/i, '')) : null;
  const p = f.prospectividad;
  const dichas: string[] = [];
  dichas.push(`Esta es ${nombre}${titular ? `, de ${titular.replace(/\s+$/, '')}` : ''}${area ? `, con ${nf(area)} hectáreas` : ''}.`.replace(/\.\./g, '.'));
  if (typeof p?.puntaje === 'number') dichas.push(`Su prospectividad es de ${p.puntaje} sobre 100${p.nivel ? `, ${p.nivel}` : ''}.`);

  const indicios = frase(f.geologia, /^Indicios/i, false);
  if (indicios) dichas.push(indicios.replace(/^Indicios:\s*/i, 'Los indicios geológicos son de nivel ').replace(/\s—\s/, ': '));
  // «4 yacimiento(s) u ocurrencia(s) en 10 km: Concordia (oro, plata, plomo, zinc, cobre) a 10 m; …»
  const yac = renglones(f.geologia).find((x) => /yacimiento/i.test(x) && /en \d+ km/i.test(x));
  if (yac) {
    const n = /^(\d+)/.exec(yac)?.[1];
    const primero = /:\s*([^;(]+?)\s*\(([^)]+)\)\s*a\s*([\d.,]+\s*k?m)/.exec(yac);
    if (n) {
      const metales = primero ? primero[2].split(/,\s*/) : [];
      const lista = metales.length > 1 ? `${metales.slice(0, -1).join(', ')} y ${metales[metales.length - 1]}` : metales[0];
      dichas.push(
        `Hay ${n === '1' ? 'un yacimiento registrado' : `${n} yacimientos u ocurrencias registrados`} a menos de 10 kilómetros` +
          (primero
            ? `; el más cercano, ${primero[1].trim()}${lista ? `, de ${lista}` : ''}, ${numero(primero[3].replace(/\s*k?m$/, '')) === 0 ? 'está dentro' : `está a ${primero[3].replace(/\s*km$/, ' kilómetros').replace(/\s*m$/, ' metros')}`}.`
            : '.')
      );
    }
  }
  const tracto = frase(f.geologia, /^Tracto permisivo/i);
  if (tracto && !/ninguno/i.test(tracto)) dichas.push('Está dentro de un tracto permisivo para pórfido de cobre del Servicio Geológico de Estados Unidos.');

  const aldeas = /^(\d+) aldeas? dentro/i.exec(renglones(f.entorno).find((x) => /aldeas? dentro/i.test(x)) || '');
  const pob = /Población declarada dentro:\s*([\d.,]+)\s*personas/i.exec(renglones(f.entorno).find((x) => /Población declarada/i.test(x)) || '');
  const personas = pob ? numero(pob[1]) : null;
  if (aldeas || personas) {
    dichas.push(
      `Dentro ${aldeas ? `hay ${aldeas[1] === '1' ? 'una aldea' : `${aldeas[1]} aldeas`}` : ''}${aldeas && personas ? ' y ' : ''}${personas ? `viven ${nf(personas)} personas` : ''}: la parte social se mira desde el primer día.`
    );
  }
  const informal = /(\d+) zonas? de minería informal/i.exec(renglones(f.entorno).find((x) => /minería informal/i.test(x)) || '');
  if (informal) dichas.push(`Se cruza con ${informal[1] === '1' ? 'una zona' : `${informal[1]} zonas`} de minería informal.`);
  const pisa = /^Se pisa con (\d+)/i.exec(renglones(f.entorno).find((x) => /^Se pisa con/i.test(x)) || '');
  if (pisa) dichas.push(`Y se traslapa con ${pisa[1] === '1' ? 'otro derecho minero' : `otros ${pisa[1]} derechos mineros`}.`);
  const arcillas = renglones(f.satelite).find((x) => /arcillas/i.test(x));
  const ha = arcillas ? /arcillas[^:]*:\s*([\d.,]+)\s*ha/i.exec(arcillas) : null;
  const haN = ha ? numero(ha[1]) : null;
  if (haN && haN >= 1) dichas.push(`Desde el satélite veo alteración por arcillas en ${nf(haN, 1)} hectáreas: una guía para ir a campo.`);
  return dichas;
}
