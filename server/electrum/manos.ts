/**
 * LAS MANOS DE ELECTRUM — lo que de verdad puede hacer, no lo que dice que hace.
 *
 * Cada herramienta devuelve dos cosas distintas y esto es el centro del diseño:
 *
 *  - `texto`: una o dos frases para el MODELO. Corto. Un volcado de JSON se come la ventana de
 *    contexto y empeora la respuesta final.
 *  - `ui`: los datos para la INTERFAZ, que el modelo nunca lee. La geometría, el encuadre, las filas
 *    de la tabla. Por eso el mapa puede volar a una concesión sin que el modelo escriba una sola
 *    coordenada: él pide «mostrame Cerro Partido» y la herramienta le pasa la geometría a la pantalla.
 *
 * Todas fallan hacia afuera: si el catastro no está conectado, lo dicen en una frase que el modelo
 * puede repetir sin inventar. Ninguna lanza una excepción que el usuario tenga que ver.
 */
import { COMPARTIDAS } from '../../lib/manos/compartidas';
import { guardarInforme, informeCartera, informeConcesion, informeConversacion } from './informe';
import type { Herramienta } from '../../lib/agente/tipos';
import { areaHectareas, distanciaKm, encuadre, perimetroKm } from './gis';
import {
  buscarConcesiones,
  buscarEnExpedientes,
  leerSeguido,
  capaGeojson,
  cercaDe,
  concesionEnPunto,
  geometriaDe,
  geometriasDe,
  hayBase,
  coberturaDeFechas,
  consulta,
  contarPorVencer,
  porVencer,
  vencenEnAnio,
  resumenTraslapes,
  traslapes,
  distinguir,
  unicaExacta,
} from './db';
import { personaPorId } from '../../lib/acceso';
import { clasificarDocumento, lecturaEnTexto, type LecturaDocumento } from './documentos-laya';
import { entornoDe, entornoEnTexto } from './entorno';
import { arbol as arbolBiblioteca, listar as listarBiblioteca, resumen as resumenBiblioteca } from './biblioteca';
import { geologiaDe, geologiaEnTexto, type Zona } from './geologia';
import { mapaGeologico, NOMBRE_MAPA, TIPOS_MAPA_GEO, type TipoMapaGeo } from './mapa-geologico';
import { informeGeologico } from './informe-geologico';
import { muestrasDeZonaEnTexto } from './muestras';
import { sateliteEnRenglones } from './satelite';

const nf = (n: number, d = 2) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const SIN_BASE = 'El catastro no está conectado en este momento, así que no puedo consultarlo. Decilo tal cual y ofrecé seguir con lo que sí tenés.';

/** «hace 12 días» / «en 30 días» / «hoy», para no decir «en -968 días». */
function cuandoVence(dias: number): string {
  if (dias === 0) return 'vence hoy';
  if (dias < 0) return `venció hace ${-dias} ${dias === -1 ? 'día' : 'días'}`;
  return `vence en ${dias} ${dias === 1 ? 'día' : 'días'}`;
}

/* ------------------------------------------------------------------ catastro */

const catastro_buscar: Herramienta = {
  nombre: 'catastro_buscar',
  descripcion:
    'Busca concesiones en el catastro por nombre, titular, expediente o municipio. Usala en cuanto alguien nombre una concesión o una empresa: nunca contestes de memoria sobre una concesión concreta.',
  esquema: {
    type: 'object',
    properties: { texto: { type: 'string', description: 'Nombre, titular, expediente o municipio. Tolera errores de tecleo.' } },
    required: ['texto'],
  },
  plataformas: ['electrum'],
  async ejecutar({ texto }) {
    if (!hayBase()) return { ok: false, texto: SIN_BASE };
    const filas = await buscarConcesiones(String(texto), 10);
    if (!filas.length) return { ok: true, texto: `No hay ninguna concesión que coincida con «${texto}» en el catastro cargado.`, ui: { filas: [] } };
    // La que se nombró tal cual gana aunque la búsqueda tolerante traiga parecidas.
    const exacta = unicaExacta(filas, String(texto));
    const uno = exacta || filas[0];
    const cabeza =
      filas.length === 1 || exacta
        ? `${uno.nombre} (id ${uno.id}), expediente ${uno.expediente || 'sin número'}. Titular ${(uno.titular || 'no declarado').replace(/\.$/, '')}. ${uno.tipo ? `Concesión de ${uno.tipo}` : 'Concesión'}${uno.mineral ? ` para ${uno.mineral}` : ''}, ${uno.hectareas != null ? `${nf(uno.hectareas)} hectáreas medidas` : 'sin área'}, estado ${uno.estado || 'no declarado'}${uno.vence ? `, vence el ${uno.vence}` : ''}.`
        : `Coinciden ${filas.length}: ${filas.slice(0, 6).map(distinguir).join('; ')}. Pedí una por su id o su expediente para la ficha.`;
    /*
     * El mapa sigue a la búsqueda, sin esperar a que el modelo se acuerde de `mapa_volar`: con una
     * sola concesión vuela a ella; con varias, las pinta y las encuadra a todas mientras se pregunta
     * cuál. Visto en producción: el doctor decía «ahí la tiene en el mapa» y el mapa no se movía.
     */
    const unica = filas.length === 1 || exacta;
    const mapa = unica
      ? await geometriaDe(uno.id).then((g) => (g ? { accion: 'volar', concesion_id: Number(uno.id), centro: g.centro, encuadre: g.encuadre, geojson: g.geojson, resaltar: true } : {}))
      : await geometriasDe(filas.map((f) => f.id)).then((g) => (g ? { accion: 'candidatas', geojson: g.geojson, encuadre: g.encuadre } : {}));
    return { ok: true, texto: cabeza, ui: { filas, id: unica ? uno.id : null, ...mapa } };
  },
};

/** Días desde hoy (en Honduras) hasta el 31 de diciembre de este año o del que viene. */
export function diasHastaFinDe(periodo: 'este_anio' | 'proximo_anio', ahora = new Date()): number {
  const hoy = new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Tegucigalpa' }));
  const anio = hoy.getFullYear() + (periodo === 'proximo_anio' ? 1 : 0);
  const fin = new Date(anio, 11, 31);
  return Math.max(0, Math.round((fin.getTime() - new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime()) / 86_400_000));
}

const catastro_vencimientos: Herramienta = {
  nombre: 'catastro_vencimientos',
  descripcion:
    'Lista las concesiones que vencen, de la más urgente a la menos. Para «qué se me vence», «qué vence este año» o revisiones de cartera. Para «este año» pasá {"periodo":"este_anio"} y para «el año que viene» {"periodo":"proximo_anio"}: no calcules días a mano. Sin ventana, llamala sin argumentos (365 días); no preguntes.',
  esquema: {
    type: 'object',
    properties: {
      periodo: { type: 'string', enum: ['este_anio', 'proximo_anio'], description: 'Año calendario de Honduras' },
      dias: { type: 'integer', description: 'Ventana en días, si la dieron en días', default: 365 },
    },
  },
  plataformas: ['electrum'],
  async ejecutar({ dias, periodo }) {
    if (!hayBase()) return { ok: false, texto: SIN_BASE };
    const anual = periodo === 'este_anio' || periodo === 'proximo_anio' ? (periodo as 'este_anio' | 'proximo_anio') : null;
    const ventana = anual ? diasHastaFinDe(anual) : Number(dias) || 365;
    const delAnio = anual ? await vencenEnAnio(anual, 25) : null;
    const filas = delAnio ? delAnio.filas : await porVencer(ventana, 25);
    const cuando = anual === 'este_anio' ? 'de aquí al 31 de diciembre' : anual === 'proximo_anio' ? 'el año que viene' : `en los próximos ${ventana} días`;
    if (!filas.length) {
      // Distinguir «no vence ninguna» de «no hay fechas cargadas»: son respuestas opuestas y la
      // vacía las confundía. El catastro nacional de Honduras no trae ni una fecha.
      const { conVence, total } = await coberturaDeFechas();
      if (total && !conVence) {
        return {
          ok: true,
          texto:
            `No puedo decirlo: de las ${total} concesiones cargadas, ninguna trae fecha de vencimiento. ` +
            `El padrón que se subió no incluye esa columna. Con una exportación que la traiga, esto se contesta solo.`,
          ui: { filas: [], sinFechas: true },
        };
      }
      return { ok: true, texto: `Ninguna concesión vence ${cuando}.`, ui: { filas: [] } };
    }
    const lista = filas.slice(0, 6).map((f) => `${f.nombre} ${cuandoVence(Number(f.dias))} (${f.vence})`);
    // Igual que con los traslapes: la lista son las 25 más urgentes, la cifra es el total.
    const total = delAnio ? delAnio.total : await contarPorVencer(ventana);
    const vencidas = await contarPorVencer(-1); // hasta ayer: ya vencidas
    return {
      ok: true,
      texto: `${anual ? `${total} vencen ${cuando}` : `${total} por vencer`}: ${lista.join('; ')}${total > lista.length ? ', y más' : ''}.${vencidas ? ` ${vencidas} ${vencidas === 1 ? 'ya está vencida' : 'ya están vencidas'}.` : ''}`,
      ui: { filas },
    };
  },
};

const catastro_en_punto: Herramienta = {
  nombre: 'catastro_en_punto',
  descripcion:
    'Dice qué concesión cubre unas coordenadas, y qué hay cerca. Para «estoy parado aquí, ¿de quién es esto?» o cuando alguien da una coordenada.',
  esquema: {
    type: 'object',
    properties: {
      lon: { type: 'number', description: 'Longitud en grados decimales (negativa en Honduras)' },
      lat: { type: 'number', description: 'Latitud en grados decimales' },
      radio_km: { type: 'number', description: 'Radio para mirar alrededor', default: 5 },
    },
    required: ['lon', 'lat'],
  },
  plataformas: ['electrum'],
  async ejecutar({ lon, lat, radio_km }) {
    if (!hayBase()) return { ok: false, texto: SIN_BASE };
    const radio = Number(radio_km) > 0 ? Number(radio_km) : 5;
    const dentro = await concesionEnPunto(Number(lon), Number(lat));
    const cerca = await cercaDe(Number(lon), Number(lat), radio, 8);
    const fuera = cerca.filter((c) => !dentro.some((d) => d.id === c.id));
    const partes = dentro.length
      ? [`Ese punto cae dentro de ${dentro.map((d) => `${d.nombre} (${d.titular || 'titular no declarado'})`).join(' y ')}.`]
      : ['Ese punto no cae dentro de ninguna concesión del catastro cargado.'];
    if (fuera.length) partes.push(`A menos de ${nf(radio, radio % 1 ? 1 : 0)} kilómetros: ${fuera.slice(0, 4).map((c) => `${c.nombre} a ${nf(c.km, 1)} km`).join(', ')}.`);
    return { ok: true, texto: partes.join(' '), ui: { punto: [Number(lon), Number(lat)], dentro, cerca: fuera } };
  },
};

/**
 * Lo que una concesión tiene alrededor: municipio, áreas protegidas, microcuencas, ríos, caseríos,
 * carretera, minería informal, ocurrencias y traslapes. Todo cruzado en PostGIS (entorno.ts): el
 * modelo recibe las cifras y las alertas ya redactadas para citarlas, no para calcularlas. Y recibe
 * también qué capas NO están cargadas, para que no se le ocurra decir «no pisa ningún área
 * protegida» cuando lo que pasa es que no hay capa de áreas protegidas.
 */
const concesion_entorno: Herramienta = {
  nombre: 'concesion_entorno',
  descripcion:
    'Cruza una concesión con las capas cargadas: municipio, áreas protegidas y microcuencas que pisa (ha y %), ríos dentro, caseríos y aldeas cerca, carretera, minería informal, ocurrencias y traslapes. Usala antes de opinar sobre dónde está una concesión o qué riesgos tiene; citá sus cifras tal cual.',
  esquema: {
    type: 'object',
    properties: {
      concesion_id: { type: 'integer', description: 'Id de la concesión (de catastro_buscar)' },
      nombre: { type: 'string', description: 'Si no tenés el id, el nombre o expediente' },
    },
  },
  plataformas: ['electrum'],
  msMaximo: 15_000,
  async ejecutar({ concesion_id, nombre }) {
    if (!hayBase()) return { ok: false, texto: SIN_BASE };
    let id = concesion_id != null ? Number(concesion_id) : null;
    if (id == null && nombre) {
      const filas = await buscarConcesiones(String(nombre), 6);
      if (!filas.length) return { ok: false, texto: `No encuentro «${nombre}» en el catastro.` };
      const elegida = filas.length === 1 ? filas[0] : unicaExacta(filas, String(nombre));
      if (!elegida) return { ok: false, texto: `«${nombre}» coincide con varias: ${filas.map(distinguir).join('; ')}. Pedime el entorno de una por su id.` };
      id = elegida.id;
    }
    if (id == null) return { ok: false, texto: 'Decime de qué concesión: por id o por nombre.' };
    const e = await entornoDe(id);
    if (!e) return { ok: false, texto: `La concesión ${id} no está en el catastro o no tiene geometría, así que no hay entorno que cruzar.` };
    // Mientras se cuenta lo que tiene alrededor, el mapa está sobre ella.
    const g = await geometriaDe(id).catch(() => null);
    const mapa = g ? { accion: 'volar', concesion_id: Number(id), centro: g.centro, encuadre: g.encuadre, geojson: g.geojson, resaltar: true } : {};
    return { ok: true, texto: entornoEnTexto(e), ui: { entorno: e, ...mapa } };
  },
};

/* ------------------------------------------------------------------ geología */

/** Cómo se nombra una zona en las herramientas de geología: la concesión, una capa, un municipio o un punto. */
const ESQUEMA_ZONA = {
  concesion_id: { type: 'integer', description: 'Id de una concesión (de catastro_buscar)' },
  nombre: { type: 'string', description: 'Nombre o expediente de una concesión, si no tenés el id' },
  capa: { type: 'string', description: 'Nombre de una capa cargada cuyos polígonos son la zona (p. ej. «Tule», «MINAS DE ORO I»)' },
  municipio: { type: 'string', description: 'Un municipio de Honduras' },
  lon: { type: 'number', description: 'Longitud en grados (negativa en Honduras), si la zona es un punto' },
  lat: { type: 'number', description: 'Latitud en grados, si la zona es un punto' },
  radio_km: { type: 'number', description: 'Radio del entorno que se mira alrededor, en km (1 a 50; 10 por defecto)' },
} as const;

function zonaDe(a: Record<string, unknown>): Zona {
  const num = (v: unknown) => (v == null || v === '' ? undefined : Number(v));
  return {
    concesion: a.concesion_id != null && a.concesion_id !== '' ? Number(a.concesion_id) : a.nombre ? String(a.nombre) : undefined,
    capa: a.capa ? String(a.capa) : undefined,
    municipio: a.municipio ? String(a.municipio) : undefined,
    lon: num(a.lon),
    lat: num(a.lat),
    radioKm: num(a.radio_km),
  };
}

/**
 * La geología de una zona, cruzada en PostGIS (geologia.ts): rocas e intrusivos, fallas y sus
 * rumbos, tectónica, tractos permisivos, yacimientos e indicios con su evidencia. El modelo recibe
 * el texto ya redactado con cifras, fuentes y límites de escala, para citarlo y no para inventarlo.
 */
const geologia_zona: Herramienta = {
  nombre: 'geologia_zona',
  descripcion:
    'Geología de una zona (concesión, capa de proyecto, municipio o punto): unidades de roca con su % de área, intrusivos y contactos, fallas que la cruzan con rumbos y cruces, falla activa más cercana, marco de placas, tractos permisivos del USGS, yacimientos cercanos por mineral, leyes de muestras JICA e INDICIOS de potencial con su evidencia. Usala antes de opinar sobre la geología, las estructuras, los intrusivos o el potencial minero de un lugar; citá sus cifras y sus límites de escala tal cual.',
  esquema: { type: 'object', properties: ESQUEMA_ZONA },
  plataformas: ['electrum'],
  msMaximo: 20_000,
  async ejecutar(args) {
    if (!hayBase()) return { ok: false, texto: SIN_BASE };
    const g = await geologiaDe(zonaDe(args));
    if ('error' in g) return { ok: false, texto: g.error };
    const { zona, ...resto } = g;
    // Lo MEDIDO en la zona (muestras de JICA), después de lo cartografiado. Si falla, la geología igual sale.
    const [leyes, satelite] = await Promise.all([
      muestrasDeZonaEnTexto(zona.geojson, zona.tipo === 'punto' ? 0 : g.radioKm).catch(() => ''),
      // Lo que Sentinel-2 midió dentro de la concesión (pérdida de vegetación, suelo expuesto, anomalías).
      zona.tipo === 'concesión' && zona.id ? sateliteEnRenglones(zona.id).catch(() => [] as string[]) : Promise.resolve([] as string[]),
    ]);
    const extra = [leyes, satelite.length ? `SATÉLITE: ${satelite.join(' ')}` : ''].filter(Boolean).join('\n');
    return { ok: true, texto: geologiaEnTexto(g) + (extra ? `\n${extra}` : ''), ui: { geologia: { ...resto, zona: { ...zona, geojson: undefined } } } };
  },
};

/**
 * Los mapas geológicos en imagen: litológico, estructural (con roseta de rumbos) o geotectónico, o
 * los tres. Se guardan como los informes —con dueño y media hora de vida— y Telegram los manda
 * como foto.
 */
const mapa_geologico: Herramienta = {
  nombre: 'mapa_geologico',
  descripcion:
    'Dibuja mapas geológicos en imagen de una zona: litologico (rocas coloreadas por clase, intrusivos, fallas y yacimientos), estructural (fallas por tipo, cruces y roseta de rumbos), geotectonico (placas, subducción, provincias geológicas y fallas activas de la región) o todos. Usala cuando pidan un mapa geológico, estructural, de fallas, tectónico o de intrusivos.',
  esquema: {
    type: 'object',
    properties: {
      tipo: { type: 'string', enum: [...TIPOS_MAPA_GEO, 'todos'], default: 'litologico', description: 'Qué mapa: litologico, estructural, geotectonico o todos' },
      ...ESQUEMA_ZONA,
    },
  },
  plataformas: ['electrum'],
  msMaximo: 30_000,
  async ejecutar(args, ctx) {
    if (!hayBase()) return { ok: false, texto: SIN_BASE };
    const pedido = String(args.tipo || 'litologico');
    const tipos: TipoMapaGeo[] = pedido === 'todos' ? TIPOS_MAPA_GEO : TIPOS_MAPA_GEO.includes(pedido as TipoMapaGeo) ? [pedido as TipoMapaGeo] : ['litologico'];
    const z = zonaDe(args);
    const hechos: Array<{ id: string; nombre: string; url: string; bytes: number; tipo: 'image/jpeg'; titulo: string }> = [];
    const fallos: string[] = [];
    for (const t of tipos) {
      const m = await mapaGeologico(t, z, { pie: 'Dr Electrum FP' });
      if ('error' in m) {
        // La zona que no existe falla igual para los tres: se dice una vez y no se insiste.
        if (!hechos.length && t === tipos[0]) return { ok: false, texto: m.error };
        fallos.push(`${NOMBRE_MAPA[t]}: ${m.error}`);
        continue;
      }
      const nombre = `${t}-${m.titulo.replace(/^.*— /, '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').toLowerCase().slice(0, 50)}.jpg`;
      const id = guardarInforme({ pdf: m.jpeg, nombre, dicho: m.titulo, tipo: 'image/jpeg' }, ctx.quien);
      hechos.push({ id, nombre, url: `/api/electrum/informe/${id}`, bytes: m.jpeg.length, tipo: 'image/jpeg', titulo: m.titulo });
    }
    return {
      ok: true,
      texto: `${hechos.length === 1 ? `Dibujé el ${hechos[0].titulo.split(' — ')[0].toLowerCase()}` : `Dibujé ${hechos.length} mapas (${hechos.map((h) => h.titulo.split(' — ')[0].toLowerCase()).join(', ')})`}; ya están listos para ver.${fallos.length ? ` No pude: ${fallos.join('; ')}.` : ''} Si hace falta explicarlos, pedí antes geologia_zona y citá sus cifras; el mapa geológico es regional y el pie lo dice.`,
      ui: { informe: hechos[0], informes: hechos },
    };
  },
};

/* ------------------------------------------------------------------ gis */

const gis_traslapes: Herramienta = {
  nombre: 'gis_traslapes',
  descripcion:
    'Lista las concesiones que se pisan entre sí, en hectáreas. Es la revisión más importante de un catastro y la que nadie hace hasta que hay pleito.',
  esquema: { type: 'object', properties: {} },
  plataformas: ['electrum'],
  async ejecutar() {
    if (!hayBase()) return { ok: false, texto: SIN_BASE };
    const t = await traslapes(20);
    // El total se cuenta aparte: la lista trae los 20 mayores y «hay 20» sería falso con 96 cargados.
    const { total, hectareas, ajenos } = await resumenTraslapes();
    if (!t.length) return { ok: true, texto: 'No hay traslapes en el catastro cargado: ninguna concesión se pisa con otra.', ui: { filas: [] } };
    const lista = t.slice(0, 5).map((x) => `${x.a} con ${x.b}, ${nf(x.hectareas)} ha`);
    return {
      ok: true,
      texto:
        `Hay ${total} ${total === 1 ? 'traslape' : 'traslapes'}, ${nf(hectareas)} ha en común` +
        `${ajenos ? ` (${ajenos} entre titulares distintos)` : ''}. ` +
        `${total > 5 ? 'Los mayores' : 'Son'}: ${lista.join('; ')}. Se resuelven por prelación de la solicitud.`,
      ui: { filas: t, total },
    };
  },
};

const gis_medir: Herramienta = {
  nombre: 'gis_medir',
  descripcion:
    'Mide el área y el perímetro de una concesión del catastro, o la distancia entre dos coordenadas. El área sale medida sobre el elipsoide, que es la de verdad.',
  esquema: {
    type: 'object',
    properties: {
      concesion_id: { type: 'integer', description: 'Id de la concesión a medir (de catastro_buscar)' },
      desde: { type: 'string', description: 'Punto «lon,lat» para medir distancia' },
      hasta: { type: 'string', description: 'Punto «lon,lat» de destino' },
    },
  },
  plataformas: ['electrum'],
  async ejecutar({ concesion_id, desde, hasta }) {
    if (desde && hasta) {
      const a = String(desde).split(',').map(Number);
      const b = String(hasta).split(',').map(Number);
      if (a.length !== 2 || b.length !== 2 || a.concat(b).some((n) => !isFinite(n))) {
        return { ok: false, texto: 'Los puntos van como «lon,lat», por ejemplo «-86.58,14.03».' };
      }
      const km = distanciaKm(a as [number, number], b as [number, number]);
      return { ok: true, texto: `Hay ${nf(km, 2)} kilómetros en línea recta.`, ui: { desde: a, hasta: b, km } };
    }
    if (concesion_id == null) return { ok: false, texto: 'Decime qué medir: una concesión por su id, o dos puntos «lon,lat».' };
    if (!hayBase()) return { ok: false, texto: SIN_BASE };
    const g = await geometriaDe(Number(concesion_id));
    if (!g) return { ok: false, texto: `No encuentro la concesión ${concesion_id} en el catastro.` };
    const ha = areaHectareas(g.geojson);
    const km = perimetroKm(g.geojson);
    return {
      ok: true,
      texto: `Mide ${nf(ha)} hectáreas y ${nf(km, 2)} kilómetros de perímetro, medido sobre el elipsoide.`,
      ui: { concesion_id: Number(concesion_id), hectareas: ha, perimetro_km: km, geojson: g.geojson, encuadre: g.encuadre },
    };
  },
};

/* ------------------------------------------------------------------ mapa */

const mapa_volar: Herramienta = {
  nombre: 'mapa_volar',
  descripcion:
    'Mueve el mapa hasta una concesión y la resalta. Usala en cuanto nombres una concesión concreta: que la persona la vea mientras hablás es la mitad de la explicación.',
  esquema: {
    type: 'object',
    properties: {
      concesion_id: { type: 'integer', description: 'Id de la concesión (de catastro_buscar)' },
      nombre: { type: 'string', description: 'Si no tenés el id, el nombre; se busca sola' },
    },
  },
  plataformas: ['electrum'],
  async ejecutar({ concesion_id, nombre }) {
    if (!hayBase()) return { ok: false, texto: SIN_BASE };
    let id = concesion_id != null ? Number(concesion_id) : null;
    let comoSeLlama = String(nombre || '');
    if (id == null && comoSeLlama) {
      const filas = await buscarConcesiones(comoSeLlama, 6);
      if (!filas.length) return { ok: false, texto: `No encuentro «${comoSeLlama}» en el catastro, así que no sé a dónde volar.` };
      const elegida = filas.length === 1 ? filas[0] : unicaExacta(filas, comoSeLlama);
      if (!elegida) {
        return {
          ok: false,
          texto: `«${comoSeLlama}» coincide con varias: ${filas.map(distinguir).join('; ')}. Preguntá cuál y volvé a pedírmelo con su id.`,
        };
      }
      id = elegida.id;
      comoSeLlama = elegida.nombre;
    }
    if (id == null) return { ok: false, texto: 'Decime a qué concesión volar, por id o por nombre.' };
    const g = await geometriaDe(id);
    if (!g) return { ok: false, texto: `No encuentro la concesión ${id}.` };
    return {
      ok: true,
      texto: `Listo, el mapa ya está sobre ${comoSeLlama || `la concesión ${id}`}.`,
      ui: { accion: 'volar', concesion_id: id, centro: g.centro, encuadre: g.encuadre, geojson: g.geojson, resaltar: true },
    };
  },
};

const mapa_capa: Herramienta = {
  nombre: 'mapa_capa',
  descripcion: 'Pinta en el mapa una capa entera de las que se subieron, con todas sus concesiones.',
  esquema: { type: 'object', properties: { capa_id: { type: 'integer', description: 'Id de la capa' } }, required: ['capa_id'] },
  plataformas: ['electrum'],
  async ejecutar({ capa_id }) {
    if (!hayBase()) return { ok: false, texto: SIN_BASE };
    const fc = await capaGeojson(Number(capa_id));
    if (!fc.features.length) return { ok: false, texto: `La capa ${capa_id} no tiene nada que pintar.` };
    return {
      ok: true,
      texto: `Pinté ${fc.features.length} ${fc.features.length === 1 ? 'polígono' : 'polígonos'} en el mapa.`,
      ui: { accion: 'capa', capa_id: Number(capa_id), geojson: fc, encuadre: encuadre(fc) },
    };
  },
};

/* ------------------------------------------------------------------ expedientes */

const expediente_buscar: Herramienta = {
  nombre: 'expediente_buscar',
  descripcion:
    'Busca en los documentos subidos (informes, resoluciones, ensayos, fichas de ocurrencias, presentaciones, hojas de cálculo, los informes de JICA en inglés y sus resúmenes) y devuelve trozos con su página. Usala antes de responder lo que debería estar en un documento. Buscá en español. Si es sobre un documento o carpeta concreta («JICA Fase III», «Minas de Oro 3», «INDEXSA», «FOM»), pasá `documento` con parte de su nombre y en `texto` solo el tema: busca DENTRO de ese documento.',
  esquema: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Qué buscar, en palabras normales (el tema, sin el nombre del documento)' },
      documento: { type: 'string', description: 'Opcional: parte del nombre del documento o de su carpeta, para buscar solo ahí' },
    },
    required: ['texto'],
  },
  plataformas: ['electrum'],
  async ejecutar({ texto, documento }) {
    if (!hayBase()) return { ok: false, texto: SIN_BASE };
    const doc = documento ? String(documento).slice(0, 120) : undefined;
    const hits = await buscarEnExpedientes(String(texto), 5, { documento: doc });
    if (!hits.length) {
      return {
        ok: true,
        texto: doc
          ? `No encontré «${texto}» en documentos que se llamen o estén en una carpeta como «${doc}». Probá sin \`documento\` o con otra parte del nombre.`
          : `No encontré nada sobre «${texto}» en los expedientes cargados.`,
        ui: { hits: [] },
      };
    }
    const cita = hits
      .slice(0, 3)
      .map((h) => `${h.documento}${h.pagina ? `, página ${h.pagina}` : ''}: «${h.texto.replace(/\s+/g, ' ').slice(0, 450)}»`)
      .join(' | ');
    // Los informes de JICA y los 43-101 están en inglés: la persona lee español.
    const ingles = hits.slice(0, 3).some((h) => /\b(the|and|of|with|in the|grade|vein|drill|sample)\b/i.test(h.texto));
    return {
      ok: true,
      texto: `${cita}. Citá el documento y la página al contestar. Son trozos cortos: si la respuesta está en esas páginas (un capítulo, unas conclusiones, una tabla), leelas enteras con expediente_leer antes de contestar.${ingles ? ' Hay fragmentos en inglés: traducilos al español al citarlos (cifras y unidades tal cual) y decí que el original está en inglés.' : ''}`,
      ui: { hits },
    };
  },
};


/**
 * Qué parte de un texto NO está rota. Se cuenta lo roto, no lo bueno, para que una tabla de leyes
 * bien leída (números, TEP20, DDH-07, g/t, «|») no pase por ilegible. Roto es lo que el OCR de una
 * tabla o un plano girado deja y ningún texto real tiene: letras sueltas («L I l»), mayúsculas y
 * minúsculas mezcladas dentro de la palabra («LoLE»), y símbolos o letras metidos entre cifras
 * («vO6£8S!», «6€09», «[S3»). Medido sobre el OCR de los informes JICA: prosa y tablas de ensayes
 * dan más de 0,6; las tablas y planos girados, menos.
 */
export function legibilidad(texto: string): number {
  const fichas = String(texto || '')
    .split(/\s+/)
    .map((w) => w.replace(/^[«"'(¿¡]+|[.,;:)»"'?!]+$/g, ''))
    .filter(Boolean);
  if (!fichas.length) return 1;
  const rota = (w: string) => {
    if (/^[<>≤≥]/.test(w)) return false; // «<5», «<0.2»: bajo el límite de detección, en toda tabla de ensayes
    if (w.length === 1) return !/^[aeoyAEOYNSWG0-9|\-–=+x×]$/.test(w); // y, a, o… y N/S/E/W de las coordenadas
    if (/[a-záéíóúñü][A-ZÁÉÍÓÚÑÜ]/.test(w)) return true; // LoLE, vO6
    if (/[£€¥¢§¤©®¬¦°¿¡]/.test(w) && !/^\d+([.,]\d+)?°$/.test(w)) return true; // 6€09 · ¿685€ (salvo 45°)
    if (/\d/.test(w) && /[A-Za-záéíóúñü]/.test(w)) {
      // Cifras con letras: solo valen los códigos (TEP20, DDH-07, 3C) y las cifras con unidad (12m, 3,5g/t).
      return !(/^[A-Z]{1,6}-?\d{1,6}[A-Z]?$/.test(w) || /^\d{1,6}[A-Z]{1,3}$/.test(w) || /^\d+([.,]\d+)?(m|km|cm|mm|g|kg|t|mt|oz|ha|g\/t|ppm|ppb)$/i.test(w));
    }
    return /[\[\]{}<>$#@*_~^\\]/.test(w); // [S3 · $0
  };
  return 1 - fichas.filter(rota).length / fichas.length;
}

/**
 * Las páginas de una lectura de `leerSeguido` que salieron ilegibles, una por una: seis páginas de
 * prosa no pueden tapar la única que está rota, que suele ser justo la que se pidió.
 */
export function paginasIlegibles(texto: string, umbral = 0.6): number[] {
  const partes = String(texto || '').split(/\[p\. (\d+)(?:, sigue)?\]\n/);
  // Sin marcas de página (un .txt sin saltos): el texto entero cuenta como una página.
  if (partes.length === 1) return legibilidad(texto) < umbral ? [0] : [];
  const malas: number[] = [];
  for (let i = 1; i + 1 < partes.length; i += 2) {
    const n = Number(partes[i]);
    if (partes[i + 1].trim().length >= 40 && legibilidad(partes[i + 1]) < umbral && !malas.includes(n)) malas.push(n);
  }
  return malas;
}

/**
 * Leer seguido. La búsqueda trae trozos de unas líneas; para «qué concluye el capítulo 5» o «dame la
 * tabla de leyes de El Peñón» hay que leer las páginas enteras. Antes Dr Electrum ubicaba el
 * capítulo en el índice y ahí se quedaba: «no me salió completo en la búsqueda».
 */
const expediente_leer: Herramienta = {
  nombre: 'expediente_leer',
  descripcion:
    'Lee seguido un documento desde una página (unas 6 por vez) y dice dónde sigue: para el capítulo, las conclusiones o la tabla que expediente_buscar o el índice ubicaron. Sin página, desde la 1.',
  esquema: {
    type: 'object',
    properties: {
      documento: { type: 'string', description: 'Parte del nombre o carpeta («Fase III»), o su número' },
      pagina: { type: 'number', description: 'Desde qué página' },
      paginas: { type: 'number', description: 'Opcional: cuántas (1 a 12)' },
      trozo: { type: 'number', description: 'Opcional: el trozo donde dijo que sigue' },
    },
    required: ['documento'],
  },
  plataformas: ['electrum'],
  async ejecutar({ documento, pagina, paginas, trozo }) {
    if (!hayBase()) return { ok: false, texto: SIN_BASE };
    const ref = String(documento || '').trim();
    if (!ref) return { ok: false, texto: 'Decime qué documento: parte de su nombre o su número.' };
    const l = await leerSeguido(ref, Number(pagina) || 1, { paginas: Math.min(12, Number(paginas) || 6), trozo: Number(trozo) || 0 });
    const donde = l.ok && l.sigue ? `la página ${l.sigue.pagina}${l.sigue.trozo ? `, a mitad de página (pasá pagina ${l.sigue.pagina} y trozo ${l.sigue.trozo})` : ''}` : '';
    if (!l.ok) return { ok: true, texto: `No hay ningún documento con texto que se llame o esté en una carpeta como «${ref}». Probá con expediente_listar para ver cómo se llama.` };
    if (!l.texto) {
      return {
        ok: true,
        texto: `«${l.documento}» no tiene texto en esas páginas desde la ${l.desde}${l.ultima ? ` (llega hasta la ${l.ultima})` : ''}.${l.sigue ? ` El texto sigue en ${donde}.` : ''}`,
      };
    }
    const rango = l.hasta > l.desde ? `páginas ${l.desde} a ${l.hasta}` : `página ${l.desde}`;
    // Un OCR de tablas o planos girados da letras sueltas y símbolos. Pasa sobre todo cuando se va a
    // la página que dice el índice: el índice cuenta páginas IMPRESAS y el archivo, las del PDF.
    const malas = paginasIlegibles(l.texto);
    const cuales = malas.length && malas[0] !== 0 ? (malas.length === 1 ? `La página ${malas[0]} salió` : `Las páginas ${malas.join(', ')} salieron`) : 'Esto salió';
    const ilegible = malas.length
      ? `[${cuales} casi ilegible${malas.length > 1 ? 's' : ''} en el OCR (tabla o plano girado). Si fuiste por el número del índice, ese número es de la página impresa y no coincide con la del archivo: buscá el título del capítulo con expediente_buscar y documento «${l.documento}».] `
      : '';
    const ingles = /\b(the|and|of|with|grade|vein|drill|sample)\b/i.test(l.texto.slice(0, 3000));
    return {
      ok: true,
      texto:
        `«${l.documento}», ${rango}${l.ultima ? ` de ${l.ultima}` : ''}:\n${l.texto}\n` +
        ilegible +
        (l.sigue ? `[Sigue en ${donde}: leelo con expediente_leer si hace falta.] ` : '[Fin del documento.] ') +
        (l.otros.length ? `[Otros documentos que también casan: ${l.otros.slice(0, 4).join('; ')}.] ` : '') +
        'Citá el documento y la página.' +
        (ingles ? ' El original está en inglés: traducí al español (cifras y unidades tal cual) y decilo.' : ''),
      ui: { documento: l.documento, desde: l.desde, hasta: l.hasta },
    };
  },
};

/**
 * Qué hay cargado. Sin filtro, el panorama por carpeta; con filtro, la lista de documentos y capas
 * de esa carpeta o con ese nombre, con su estado. Es la mano que contesta «¿qué tenés de Minas de
 * Oro?» o «¿qué quedó sin leer?»: buscar por contenido no sirve para saber qué existe.
 */
const ESTADO_TXT: Record<string, string> = {
  ok: 'leído', sin_texto: 'SIN TEXTO (escaneo sin OCR)', cortado: 'CORTADO (hay que releerlo)', poco_texto: 'poco texto', repetido: 'repetido', vacia: 'capa vacía',
};
const expediente_listar: Herramienta = {
  nombre: 'expediente_listar',
  descripcion:
    'Dice qué información tiene cargada Dr Electrum: sin filtro, cuántos documentos y capas hay por carpeta y cuántos necesitan atención; con `filtro` (parte de una carpeta o nombre, p. ej. «Minas de Oro», «INDEXSA», «FOM»), la lista de lo que hay ahí con su estado. Con `solo_atencion` lista lo que está sin texto, cortado o repetido. Usala cuando pregunten qué documentos hay, si algo está cargado o qué falta.',
  esquema: {
    type: 'object',
    properties: {
      filtro: { type: 'string', description: 'Opcional: parte del nombre de una carpeta o de un documento' },
      solo_atencion: { type: 'boolean', description: 'Opcional: solo lo que necesita atención' },
    },
  },
  plataformas: ['electrum'],
  async ejecutar({ filtro, solo_atencion }) {
    if (!hayBase()) return { ok: false, texto: SIN_BASE };
    const f = filtro ? String(filtro).trim().slice(0, 120) : '';
    if (!f && !solo_atencion) {
      const [r, carpetas] = await Promise.all([resumenBiblioteca(), arbolBiblioteca()]);
      const raiz = new Map<string, { n: number; atencion: number }>();
      for (const c of carpetas) {
        const k = (c.carpeta || '(sin carpeta)').split('/')[0];
        const x = raiz.get(k) || { n: 0, atencion: 0 };
        x.n += c.documentos + c.capas;
        x.atencion += c.atencion;
        raiz.set(k, x);
      }
      const lineas = [...raiz.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, x]) => `${k}: ${x.n}${x.atencion ? ` (${x.atencion} necesitan atención)` : ''}`);
      return {
        ok: true,
        texto: `Hay ${r.documentos} documentos y ${r.capas} capas del mapa, ${r.fragmentos} fragmentos indexados. Necesitan atención ${r.atencion}: ${r.porEstado.sin_texto} sin texto, ${r.porEstado.cortado} cortados, ${r.porEstado.poco_texto} con poco texto, ${r.porEstado.repetido} repetidos. Por carpeta: ${lineas.join('; ')}.`,
      };
    }
    // Primero como carpeta; si no casa ninguna, como parte del nombre.
    let r = f ? await listarBiblioteca({ carpeta: f, subcarpetas: true, estado: solo_atencion ? 'atencion' : undefined, orden: 'carpeta', limite: 60 }) : { items: [], total: 0 };
    if (!r.total) r = await listarBiblioteca({ q: f || undefined, estado: solo_atencion ? 'atencion' : undefined, orden: 'carpeta', limite: 60 });
    if (!r.total && f) {
      const carpetas = (await arbolBiblioteca()).map((c) => c.carpeta).filter((c): c is string => !!c && c.toLowerCase().includes(f.toLowerCase()));
      if (carpetas.length) {
        const todos = await Promise.all(carpetas.slice(0, 5).map((c) => listarBiblioteca({ carpeta: c, estado: solo_atencion ? 'atencion' : undefined, limite: 30 })));
        r = { items: todos.flatMap((t) => t.items), total: todos.reduce((n, t) => n + t.total, 0) };
      }
    }
    if (!r.total) return { ok: true, texto: `No hay nada cargado que se llame o esté en una carpeta como «${f}».` };
    const lineas = r.items.map(
      (i) => `${i.clase === 'capa' ? 'capa' : 'doc'} «${i.nombre}» (${i.clase === 'capa' ? `${i.cantidad} geometrías` : `${i.cantidad} pág`}, ${ESTADO_TXT[i.estado] || i.estado})${i.carpeta ? ` en ${i.carpeta}` : ''}`
    );
    return {
      ok: true,
      texto: `${r.total} ${r.total === 1 ? 'pieza' : 'piezas'}${f ? ` para «${f}»` : ''}${solo_atencion ? ' que necesitan atención' : ''}${r.total > r.items.length ? ` (muestro ${r.items.length})` : ''}: ${lineas.join('; ')}.`,
      ui: { hits: r.items.slice(0, 20) },
    };
  },
};

/**
 * Qué es un documento y qué trae (Laya, modelo `documento`): tipo, y si hay coordenadas, fuentes de
 * agua, comunidades, plan de cierre, plazos o firma de autoridad, con la página donde lo vio. Usa la
 * lectura guardada al subirlo; si no la hay (documentos anteriores), la hace ahora y la guarda.
 */
const documento_revisar: Herramienta = {
  nombre: 'documento_revisar',
  descripcion:
    'Revisa un documento del expediente y dice de qué tipo es (resolución, contrato, ambiental, informe técnico, plano, financiero, solicitud) y si trae firma de autoridad, coordenadas, fuentes de agua, comunidades, plan de cierre o plazos, con la página. Usala cuando pregunten qué es un documento o si le falta algo.',
  esquema: {
    type: 'object',
    properties: { documento: { type: 'string', description: 'El nombre del archivo (o parte) o su número' } },
    required: ['documento'],
  },
  plataformas: ['electrum'],
  async ejecutar({ documento }) {
    if (!hayBase()) return { ok: false, texto: SIN_BASE };
    const ref = String(documento || '').trim();
    if (!ref) return { ok: false, texto: 'Decime qué documento: el nombre del archivo o su número.' };
    const porId = /^\d+$/.test(ref);
    const docs = await consulta<{ id: number; nombre: string; meta: any }>(
      porId
        ? `SELECT id, nombre, meta FROM documento WHERE id = $1`
        : `SELECT id, nombre, meta FROM documento WHERE nombre ILIKE $1 ORDER BY subido DESC LIMIT 5`,
      [porId ? Number(ref) : `%${ref.replace(/[\\%_]/g, (c) => `\\${c}`)}%`],
    );
    if (!docs.length) return { ok: true, texto: `No encontré ningún documento que se llame como «${ref}».` };
    if (docs.length > 1 && !docs.some((d) => d.nombre.toLowerCase() === ref.toLowerCase())) {
      return { ok: true, texto: `Hay varios parecidos: ${docs.map((d) => `«${d.nombre}» (#${d.id})`).join(', ')}. ¿Cuál?` };
    }
    const d = docs.find((x) => x.nombre.toLowerCase() === ref.toLowerCase()) || docs[0];
    const lectura: LecturaDocumento | null = d.meta?.laya?.requisitos ? d.meta.laya : await clasificarDocumento(d.id);
    if (!lectura) return { ok: false, texto: `No pude revisar «${d.nombre}» ahora (el lector de documentos no contestó). El documento sigue buscable con expediente_buscar.` };
    return { ok: true, texto: lecturaEnTexto(d.nombre, lectura), ui: { documento_id: d.id, lectura } };
  },
};

/* ------------------------------------------------------------------ informes */

/**
 * El informe en PDF.
 *
 * Fijate en lo que NO recibe: cifras. El modelo elige QUÉ informe y puede aportar un párrafo de
 * lectura; los números salen del catastro y de la geometría, acá adentro. Un PDF se imprime y se
 * lleva a una reunión, así que una cifra inventada con membrete no es una respuesta desafortunada:
 * es un documento falso.
 */
const informe_pdf: Herramienta = {
  nombre: 'informe_pdf',
  descripcion:
    'Arma un informe en PDF descargable: la ficha completa de una concesión (con área medida, traslapes y citas de expediente), el estado de toda la cartera cargada, o lo que se viene conversando (tipo conversacion: una investigación o un análisis, con sus fuentes). Usala cuando pidan «un informe», «un PDF», «algo para imprimir» o «para llevar a la reunión». Si solo piden MAPAS (geológico, estructural, tectónico), usá mapa_geologico, que los manda como imagen.',
  esquema: {
    type: 'object',
    properties: {
      tipo: {
        type: 'string',
        description: 'concesion para una ficha, cartera para el estado de todo, conversacion para poner en PDF lo que se viene hablando (una investigación, un análisis), geologico para el informe geológico de una zona con sus tres mapas (concesión, capa, municipio o punto)',
        enum: ['concesion', 'cartera', 'conversacion', 'geologico'],
        default: 'concesion',
      },
      titulo: { type: 'string', description: 'Solo para conversacion: de qué trata, en pocas palabras (p. ej. «Caliza coralina en Honduras»)' },
      nombre: { type: 'string', description: 'Nombre o expediente de la concesión, si el informe es de una' },
      concesion_id: { type: 'integer', description: 'Id de la concesión, si ya lo tenés de una búsqueda anterior' },
      capa: ESQUEMA_ZONA.capa,
      municipio: ESQUEMA_ZONA.municipio,
      lon: ESQUEMA_ZONA.lon,
      lat: ESQUEMA_ZONA.lat,
      radio_km: ESQUEMA_ZONA.radio_km,
      lectura: {
        type: 'string',
        description:
          'Tu lectura del caso en dos o tres frases, si tenés algo que aportar. Va en una sección aparte rotulada como interpretación. NO pongas cifras acá: las cifras las pone el catastro.',
      },
    },
  },
  plataformas: ['electrum'],
  msMaximo: 25_000,
  async ejecutar(args, ctx) {
    const { tipo, nombre, concesion_id, lectura, titulo } = args;
    const conversacion = String(tipo || '') === 'conversacion';
    if (!conversacion && !hayBase()) return { ok: false, texto: SIN_BASE };
    // El pie del PDF lleva el NOMBRE de quien lo pidió; la propiedad del informe, su id. Antes el
    // pie decía «a petición de jose»: el identificador interno del padrón, impreso con membrete.
    const quien = ctx.quien;
    const opts = { quien: quien ? personaPorId(quien)?.nombre || null : null, lectura: lectura ? String(lectura) : undefined };

    const r = String(tipo || '') === 'geologico'
      ? await informeGeologico(zonaDe(args), opts)
      : conversacion
      ? informeConversacion({ ...opts, titulo: titulo ? String(titulo) : undefined, historial: ctx.historial || [] })
      : String(tipo || 'concesion') === 'cartera'
        ? await informeCartera(opts)
        : await informeConcesion(
            { id: concesion_id != null ? Number(concesion_id) : undefined, nombre: nombre ? String(nombre) : undefined },
            opts
          );

    if ('error' in r) return { ok: false, texto: r.error };
    const id = guardarInforme(r, quien);
    return {
      ok: true,
      texto: `${r.dicho} Ya está listo para descargar; decíselo y no repitas los números uno por uno, que están en el documento.`,
      ui: { informe: { id, nombre: r.nombre, url: `/api/electrum/informe/${id}`, bytes: r.pdf.length } },
    };
  },
};


/* ------------------------------------------------------------------ registro */

/** Las manos de Electrum, por nombre. El panel de especialistas decide cuáles se le ofrecen. */
export const MANOS: Record<string, Herramienta> = {
  catastro_buscar,
  catastro_vencimientos,
  catastro_en_punto,
  concesion_entorno,
  geologia_zona,
  mapa_geologico,
  gis_traslapes,
  gis_medir,
  mapa_volar,
  mapa_capa,
  expediente_buscar,
  expediente_listar,
  expediente_leer,
  documento_revisar,
  informe_pdf,
  // Estas dos no son de Electrum: viven en lib/manos/compartidas.ts porque AU-RA hace las mismas
  // cuentas y pregunta el mismo precio. Se montan acá, no se copian.
  ...COMPARTIDAS,
};

/**
 * Las herramientas que le tocan a este panel. Se le ofrecen SOLO las suyas: un modelo con veinte
 * herramientas delante elige peor que uno con seis, y eso está medido en todos lados.
 */
export function manosDe(nombres: string[]): Herramienta[] {
  const s = new Set(nombres);
  return TODAS.filter((h) => s.has(h.nombre));
}

/**
 * Todas las que Dr Electrum puede usar, para cuando no hay panel convocado.
 *
 * El filtro por plataforma no es ceremonia: es la garantía estructural de que una mano de AU-RA
 * —el taller, la bóveda, el ejecutor— no termine en el panel de Electrum porque alguien la agregó
 * al registro equivocado. Si no declara `electrum`, no existe acá.
 */
export const TODAS = Object.values(MANOS).filter((h) => h.plataformas.includes('electrum'));
