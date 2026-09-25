/**
 * LAS MANOS QUE SÍ SE COMPARTEN.
 *
 * AU-RA FP y Dr Electrum FP tienen cerebros independientes y casi nada en común de lo que hacen:
 * el catastro, el mapa y los expedientes son de Electrum; el taller, la bóveda, la memoria de la
 * junta y el ejecutor son de AU-RA. Prestarse esas sería deshacer la separación que se pidió.
 *
 * Estas dos son la excepción, y por una razón concreta en cada caso:
 *
 *  · `metales_spot`  — el oro es el mismo oro. Estaba escrito dos veces, y la copia de Electrum no
 *                      tenía caché: las dos plataformas salen por la misma IP de Render, así que la
 *                      demostración minera le gastaba el cupo de gold-api a la mesa de la junta.
 *  · `calculo_mina`  — la aritmética de mina no cambia según quién pregunte. Ya llamaban las dos al
 *                      mismo `lib/minas/calculos.ts`; lo que faltaba era que fuera la MISMA mano y
 *                      no dos envoltorios que se pueden desincronizar.
 *
 * Cualquier cosa que se agregue aquí tiene que pasar esa prueba: ¿es literalmente el mismo hecho
 * del mundo para los dos cerebros? Si la respuesta depende de la plataforma, no va aquí.
 */
import { resolverCalculoMina } from '../minas/calculos';
import { simboloDe, spotMetal } from '../mercado';
import { buscarWeb, leerPagina } from '../../src/06-manos/web';
import { urlPublica } from '../../server/seguridad';
import type { Herramienta } from '../agente/tipos';

const nf = (n: number, d = 2) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);

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
  plataformas: ['ultron', 'electrum'],
  async ejecutar({ enunciado, precio_onza }) {
    const c = resolverCalculoMina(String(enunciado), { precioOnza: precio_onza != null ? Number(precio_onza) : undefined });
    if (!c) return { ok: false, texto: `De «${enunciado}» no saco una cuenta. Necesito tonelaje y ley, o los datos de la ley de corte.` };
    return { ok: true, texto: `${c.texto} (fórmula: ${c.formula})`, ui: { tipo: c.tipo, valores: c.valores, formula: c.formula } };
  },
};

const metales_spot: Herramienta = {
  nombre: 'metales_spot',
  descripcion: 'Precio del oro o la plata ahora mismo, en dólares por onza troy, con su fuente.',
  esquema: {
    type: 'object',
    properties: { metal: { type: 'string', description: 'oro o plata', enum: ['oro', 'plata'], default: 'oro' } },
  },
  plataformas: ['ultron', 'electrum'],
  msMaximo: 10_000,
  async ejecutar({ metal }) {
    try {
      const s = await spotMetal(simboloDe(metal));
      return {
        ok: true,
        texto: `El ${s.metal} está en ${nf(s.usd)} dólares la onza, según ${s.fuente}.`,
        ui: { metal: s.metal, usd: s.usd, fuente: s.fuente },
      };
    } catch {
      return { ok: false, texto: `No pude traer el precio del ${simboloDe(metal) === 'XAG' ? 'la plata' : 'oro'} ahora mismo. No inventes uno.` };
    }
  },
};

/*
 * Internet. Estas dos existen ahora porque NO existían: cinco de los ocho especialistas de Dr
 * Electrum declaraban `web_buscar` y `web_leer` en su lista de herramientas, y ninguna de las dos
 * estaba escrita. `manosDe` las filtraba en silencio, así que el modelo leía en su prompt que podía
 * buscar en internet y no podía. Un modelo al que se le promete una herramienta que no tiene no se
 * queda callado: se la inventa.
 *
 * Se comparten porque internet es internet. Lo que no se comparte es el criterio de qué buscar, y
 * eso vive en el cerebro de cada plataforma.
 */
const web_buscar: Herramienta = {
  nombre: 'web_buscar',
  descripcion:
    'Busca en internet y devuelve títulos, enlaces y un extracto. Usala para cualquier cosa de fuera de tu cerebro y del catastro: normativa reciente, precios, noticias, datos de una empresa. Si contestás con esto, citá la fuente.',
  esquema: {
    type: 'object',
    properties: { consulta: { type: 'string', description: 'Qué buscar, en palabras normales' } },
    required: ['consulta'],
  },
  plataformas: ['ultron', 'electrum'],
  msMaximo: 15_000,
  async ejecutar({ consulta }) {
    const q = String(consulta || '').trim();
    if (!q) return { ok: false, texto: 'Consulta vacía. No busqué nada.' };
    const hits = await buscarWeb(q, 5).catch(() => []);
    if (!hits.length) return { ok: false, texto: `No saqué resultados de «${q}». Decilo; no te inventes una fuente.` };
    const texto = hits
      .slice(0, 4)
      .map((h) => `${h.title} (${h.url}): ${h.snippet.replace(/\s+/g, ' ').slice(0, 220)}`)
      .join(' | ');
    return { ok: true, texto, ui: { hits } };
  },
};

const web_leer: Herramienta = {
  nombre: 'web_leer',
  descripcion: 'Abre una página y te devuelve su texto. Usala cuando te pasen un enlace, o después de buscar, para leer la fuente antes de citarla.',
  esquema: {
    type: 'object',
    properties: { url: { type: 'string', description: 'La dirección completa, con https://' } },
    required: ['url'],
  },
  plataformas: ['ultron', 'electrum'],
  msMaximo: 15_000,
  async ejecutar({ url }) {
    // La misma comprobación que usa AU-RA: sin esto, una URL en un expediente puede hacer que el
    // servidor se pida a sí mismo, o al metadata de AWS. Una herramienta que abre lo que le digan
    // es una puerta al interior de la red.
    const pub = await urlPublica(String(url || ''));
    if (pub.ok === false) return { ok: false, texto: `No abrí esa dirección: ${pub.error}.` };
    const texto = await leerPagina(pub.url, 2200).catch(() => '');
    if (!texto) return { ok: false, texto: `Abrí ${pub.url} pero no saqué texto. Puede que no sea HTML. No inventes su contenido.` };
    return { ok: true, texto: `De ${pub.url}: ${texto}`, ui: { url: pub.url } };
  },
};

export const COMPARTIDAS: Record<string, Herramienta> = { calculo_mina, metales_spot, web_buscar, web_leer };
