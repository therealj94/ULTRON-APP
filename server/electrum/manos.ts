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
import { resolverCalculoMina } from '../../lib/minas/calculos';
import type { Herramienta } from '../../lib/agente/tipos';
import { areaHectareas, distanciaKm, encuadre, perimetroKm } from './gis';
import {
  buscarConcesiones,
  buscarEnExpedientes,
  capaGeojson,
  cercaDe,
  concesionEnPunto,
  geometriaDe,
  hayBase,
  porVencer,
  traslapes,
} from './db';

const nf = (n: number, d = 2) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const SIN_BASE = 'El catastro no está conectado en este momento, así que no puedo consultarlo. Decilo tal cual y ofrecé seguir con lo que sí tenés.';

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
  async ejecutar({ texto }) {
    if (!hayBase()) return { ok: false, texto: SIN_BASE };
    const filas = await buscarConcesiones(String(texto), 10);
    if (!filas.length) return { ok: true, texto: `No hay ninguna concesión que coincida con «${texto}» en el catastro cargado.`, ui: { filas: [] } };
    const uno = filas[0];
    const cabeza =
      filas.length === 1
        ? `${uno.nombre}, expediente ${uno.expediente || 'sin número'}. Titular ${(uno.titular || 'no declarado').replace(/\.$/, '')}. ${uno.tipo ? `Concesión de ${uno.tipo}` : 'Concesión'}${uno.mineral ? ` para ${uno.mineral}` : ''}, ${uno.hectareas != null ? `${nf(uno.hectareas)} hectáreas medidas` : 'sin área'}, estado ${uno.estado || 'no declarado'}${uno.vence ? `, vence el ${uno.vence}` : ''}.`
        : `Coinciden ${filas.length}: ${filas.slice(0, 6).map((f) => f.nombre).join(', ')}. Pedí una por su nombre para la ficha.`;
    return { ok: true, texto: cabeza, ui: { filas, id: filas.length === 1 ? uno.id : null } };
  },
};

const catastro_vencimientos: Herramienta = {
  nombre: 'catastro_vencimientos',
  descripcion: 'Lista las concesiones que vencen dentro de los próximos N días, de la más urgente a la menos. Para «qué se me vence» o revisiones de cartera.',
  esquema: { type: 'object', properties: { dias: { type: 'integer', description: 'Ventana en días', default: 365 } } },
  async ejecutar({ dias }) {
    if (!hayBase()) return { ok: false, texto: SIN_BASE };
    const filas = await porVencer(Number(dias) || 365, 25);
    if (!filas.length) return { ok: true, texto: `Ninguna concesión vence en los próximos ${dias} días.`, ui: { filas: [] } };
    const lista = filas.slice(0, 6).map((f) => `${f.nombre} en ${f.dias} días (${f.vence})`);
    const vencidas = filas.filter((f) => f.dias < 0).length;
    return {
      ok: true,
      texto: `${filas.length} por vencer: ${lista.join('; ')}${filas.length > 6 ? ', y más' : ''}.${vencidas ? ` ${vencidas} ya están vencidas.` : ''}`,
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
  async ejecutar({ lon, lat, radio_km }) {
    if (!hayBase()) return { ok: false, texto: SIN_BASE };
    const dentro = await concesionEnPunto(Number(lon), Number(lat));
    const cerca = await cercaDe(Number(lon), Number(lat), Number(radio_km) || 5, 8);
    const fuera = cerca.filter((c) => !dentro.some((d) => d.id === c.id));
    const partes = dentro.length
      ? [`Ese punto cae dentro de ${dentro.map((d) => `${d.nombre} (${d.titular || 'titular no declarado'})`).join(' y ')}.`]
      : ['Ese punto no cae dentro de ninguna concesión del catastro cargado.'];
    if (fuera.length) partes.push(`A menos de ${radio_km} kilómetros: ${fuera.slice(0, 4).map((c) => `${c.nombre} a ${nf(c.km, 1)} km`).join(', ')}.`);
    return { ok: true, texto: partes.join(' '), ui: { punto: [Number(lon), Number(lat)], dentro, cerca: fuera } };
  },
};

/* ------------------------------------------------------------------ gis */

const gis_traslapes: Herramienta = {
  nombre: 'gis_traslapes',
  descripcion:
    'Lista las concesiones que se pisan entre sí, en hectáreas. Es la revisión más importante de un catastro y la que nadie hace hasta que hay pleito.',
  esquema: { type: 'object', properties: {} },
  async ejecutar() {
    if (!hayBase()) return { ok: false, texto: SIN_BASE };
    const t = await traslapes(20);
    if (!t.length) return { ok: true, texto: 'No hay traslapes en el catastro cargado: ninguna concesión se pisa con otra.', ui: { filas: [] } };
    const lista = t.slice(0, 5).map((x) => `${x.a} con ${x.b}, ${nf(x.hectareas)} ha`);
    return {
      ok: true,
      texto: `Hay ${t.length} ${t.length === 1 ? 'traslape' : 'traslapes'}: ${lista.join('; ')}${t.length > 5 ? ', y más' : ''}. Se resuelven por prelación de la solicitud.`,
      ui: { filas: t },
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
  async ejecutar({ concesion_id, nombre }) {
    if (!hayBase()) return { ok: false, texto: SIN_BASE };
    let id = concesion_id != null ? Number(concesion_id) : null;
    let comoSeLlama = String(nombre || '');
    if (id == null && comoSeLlama) {
      const filas = await buscarConcesiones(comoSeLlama, 2);
      if (!filas.length) return { ok: false, texto: `No encuentro «${comoSeLlama}» en el catastro, así que no sé a dónde volar.` };
      if (filas.length > 1) return { ok: false, texto: `«${comoSeLlama}» coincide con varias: ${filas.map((f) => f.nombre).join(', ')}. Decime cuál.` };
      id = filas[0].id;
      comoSeLlama = filas[0].nombre;
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
    'Busca en los documentos subidos (informes, resoluciones, ensayos, planes de labores) y devuelve el texto con su página. Usala antes de responder cualquier cosa que debería estar en un documento.',
  esquema: {
    type: 'object',
    properties: { texto: { type: 'string', description: 'Qué buscar, en palabras normales' } },
    required: ['texto'],
  },
  async ejecutar({ texto }) {
    if (!hayBase()) return { ok: false, texto: SIN_BASE };
    const hits = await buscarEnExpedientes(String(texto), 5);
    if (!hits.length) return { ok: true, texto: `No encontré nada sobre «${texto}» en los expedientes cargados.`, ui: { hits: [] } };
    const cita = hits
      .slice(0, 3)
      .map((h) => `${h.documento}${h.pagina ? `, página ${h.pagina}` : ''}: «${h.texto.replace(/\s+/g, ' ').slice(0, 220)}»`)
      .join(' | ');
    return { ok: true, texto: `${cita}. Citá el documento y la página al contestar.`, ui: { hits } };
  },
};

/* ------------------------------------------------------------------ cálculo y mercado */

const calculo_mina: Herramienta = {
  nombre: 'calculo_mina',
  descripcion:
    'Hace las cuentas de mina: onzas contenidas y recuperables, ley de corte, relación de descapote, dilución y conversiones. Usala SIEMPRE que haya un número que calcular: vos no calculás de cabeza.',
  esquema: {
    type: 'object',
    properties: {
      enunciado: { type: 'string', description: 'La cuenta en palabras, por ejemplo «250.000 toneladas a 3,4 g/t con 90% de recuperación»' },
      precio_onza: { type: 'number', description: 'Precio del oro por onza, si hace falta para el valor' },
    },
    required: ['enunciado'],
  },
  async ejecutar({ enunciado, precio_onza }) {
    const c = resolverCalculoMina(String(enunciado), { precioOnza: precio_onza != null ? Number(precio_onza) : undefined });
    if (!c) return { ok: false, texto: `De «${enunciado}» no saco una cuenta. Necesito tonelaje y ley, o los datos de la ley de corte.` };
    return { ok: true, texto: `${c.texto} (fórmula: ${c.formula})`, ui: { tipo: c.tipo, valores: c.valores, formula: c.formula } };
  },
};

const metales_spot: Herramienta = {
  nombre: 'metales_spot',
  descripcion: 'Precio del oro o la plata ahora mismo, en dólares por onza, con su fuente.',
  esquema: {
    type: 'object',
    properties: { metal: { type: 'string', description: 'oro o plata', enum: ['oro', 'plata'], default: 'oro' } },
  },
  msMaximo: 10_000,
  async ejecutar({ metal }) {
    const sym = String(metal) === 'plata' ? 'XAG' : 'XAU';
    try {
      const r = await fetch(`https://api.gold-api.com/price/${sym}`, { signal: AbortSignal.timeout(8000) });
      const j: any = await r.json();
      const usd = Number(j.price || j.bid || j.ask);
      if (!isFinite(usd)) throw new Error('sin precio');
      return { ok: true, texto: `El ${metal} está en ${nf(usd, 2)} dólares la onza, según gold-api.com.`, ui: { metal, usd, fuente: 'gold-api.com' } };
    } catch (e: any) {
      return { ok: false, texto: `No pude traer el precio del ${metal} ahora mismo. No inventes uno.` };
    }
  },
};

/* ------------------------------------------------------------------ registro */

/** Las manos de Electrum, por nombre. El panel de especialistas decide cuáles se le ofrecen. */
export const MANOS: Record<string, Herramienta> = {
  catastro_buscar,
  catastro_vencimientos,
  catastro_en_punto,
  gis_traslapes,
  gis_medir,
  mapa_volar,
  mapa_capa,
  expediente_buscar,
  calculo_mina,
  metales_spot,
};

/**
 * Las herramientas que le tocan a este panel. Se le ofrecen SOLO las suyas: un modelo con veinte
 * herramientas delante elige peor que uno con seis, y eso está medido en todos lados.
 */
export function manosDe(nombres: string[]): Herramienta[] {
  const s = new Set(nombres);
  return Object.values(MANOS).filter((h) => s.has(h.nombre));
}

/** Todas, para cuando no hay panel convocado. */
export const TODAS = Object.values(MANOS);
