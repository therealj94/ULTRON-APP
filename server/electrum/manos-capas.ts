/**
 * LAS MANOS DEL ÍNDICE DE CAPAS (instrucciones de corrección v1.0, sección 4.2).
 *
 * Diez herramientas con los nombres del documento. Leen el MISMO catálogo que el panel
 * (src-electrum/mapa/catalogo.ts sobre el manifiesto de esta organización) y mueven el mapa con las
 * MISMAS órdenes que el panel ejecuta con sus casillas (`ui.accion = 'indice'`): lo que Electrum
 * enciende queda marcado en el panel, y lo que la persona apaga en el panel le llega a Electrum en
 * el estado del mapa de cada pregunta (`ctx.mapa`).
 *
 * Las descripciones son cortas a propósito: el system tiene que caber en el proxy del nodo.
 */
import type { Contexto, Herramienta, ResultadoHerramienta } from '../../lib/agente/tipos';
import {
  buscarCapas,
  encendibleCat,
  enumerar,
  frase,
  hojasCat,
  id6,
  unidad,
  validarFiltros,
  valoresConColor,
  type EntradaCatalogo,
  type Filtros,
} from '../../src-electrum/mapa/catalogo';
import { contarIndice, manifiestoPara } from './indice-capas';
import type { OrdenMapa } from './dialogo-capas';

const SIN_INDICE = 'No pude leer el índice de capas. Decilo tal cual; no inventes capas.';

async function catalogo(): Promise<EntradaCatalogo[] | null> {
  const m = await manifiestoPara().catch(() => null);
  return m ? (m.capas as unknown as EntradaCatalogo[]) : null;
}

const ordenes = (xs: OrdenMapa[]) => ({ accion: 'indice', ordenes: xs });

function entrada(capas: EntradaCatalogo[], id: unknown): EntradaCatalogo | null {
  const n = Number(String(id ?? '').replace(/\D/g, ''));
  return capas.find((c) => c.id === n) || capas.find((c) => c.id_anterior === n) || null;
}

function linea(e: EntradaCatalogo): string {
  const filtros = (e.filtros || []).map((f) => f.etiqueta || f.campo).join(', ');
  const que = e.tipo === 'grupo' ? 'grupo' : e.tipo === 'documento' ? 'plano (visor)' : e.sin_datos ? 'SIN DATOS' : !encendibleCat(e) ? 'no disponible' : 'capa';
  return `${id6(e.id)} ${e.nombre} · ${que}${e.num_entidades ? ` · ${e.num_entidades} rasgos` : ''}${filtros ? ` · filtra por ${filtros}` : ''}`;
}

/** Los filtros pedidos, solo con campos y valores que existen. Si no queda nada válido, se dice qué hay. */
function filtrosReales(e: EntradaCatalogo, pedidos: unknown): { filtros: Filtros; error?: string } {
  if (!pedidos || typeof pedidos !== 'object') return { filtros: {} };
  const { filtros, rechazados } = validarFiltros(e, pedidos as Record<string, unknown>);
  if (rechazados.length && !Object.keys(filtros).length) {
    const hay = valoresConColor(e)
      .map((f) => `${f.etiqueta}: ${f.valores.map((v) => v.texto).join(', ')}`)
      .join(' | ');
    return { filtros, error: `No existe ${rechazados.join('; ')}. Valores reales → ${hay || 'la capa no tiene filtros'}.` };
  }
  return { filtros };
}

async function conCuenta(e: EntradaCatalogo, f: Filtros): Promise<string> {
  const n = await contarIndice(e.id, f).catch(() => null);
  return n == null ? '' : ` (${unidad(e, n)})`;
}

const FILTROS_ESQUEMA = { type: 'object', description: 'Opcional. {"campo":["valor"]}: varios valores = O, varios campos = Y', additionalProperties: { type: 'array', items: { type: 'string' } } };

async function conCatalogo(f: (capas: EntradaCatalogo[]) => Promise<ResultadoHerramienta>): Promise<ResultadoHerramienta> {
  const capas = await catalogo();
  if (!capas) return { ok: false, texto: SIN_INDICE };
  return f(capas);
}

export const buscar_capas: Herramienta = {
  nombre: 'buscar_capas',
  descripcion: 'Busca capas del mapa por nombre, alias, ID o valor de filtro.',
  esquema: { type: 'object', properties: { texto: { type: 'string', description: 'Nombre, alias, ID o valor' } }, required: ['texto'] },
  plataformas: ['electrum'],
  ejecutar: ({ texto }) =>
    conCatalogo(async (capas) => {
      const xs = buscarCapas(capas, String(texto || ''));
      if (!xs.length) return { ok: true, texto: `No hay ninguna capa ni valor «${texto}» en el índice. No inventes una: decilo y ofrecé buscar en Otros (800000) o listar lo que sí hay.` };
      const lineas = xs.map((c) => `- ${linea(capas.find((e) => e.id === c.id)!)} (por ${c.por}: «${c.frase}»)`);
      return { ok: true, texto: `${xs.length === 1 ? 'Una coincidencia' : `${xs.length} coincidencias: si son varias, preguntá cuál`}:\n${lineas.join('\n')}` };
    }),
};

export const listar_grupo: Herramienta = {
  nombre: 'listar_grupo',
  descripcion: 'Capas de un grupo del índice (ID que termina en 000).',
  esquema: { type: 'object', properties: { id_grupo: { type: 'string', description: 'ID del grupo' } }, required: ['id_grupo'] },
  plataformas: ['electrum'],
  ejecutar: ({ id_grupo }) =>
    conCatalogo(async (capas) => {
      const g = entrada(capas, id_grupo);
      if (!g) return { ok: true, texto: `No hay un grupo ${id_grupo} en el índice.` };
      const hijos = capas.filter((c) => c.padre === g.id).sort((a, b) => a.orden - b.orden);
      if (!hijos.length) return { ok: true, texto: `${linea(g)}: no tiene capas dentro.` };
      return { ok: true, texto: `${id6(g.id)} ${g.nombre}:\n${hijos.slice(0, 120).map((h) => `- ${linea(h)}`).join('\n')}${hijos.length > 120 ? `\n… y ${hijos.length - 120} más` : ''}` };
    }),
};

export const valores_filtro: Herramienta = {
  nombre: 'valores_filtro',
  descripcion: 'Filtros de una capa con sus valores reales y su color.',
  esquema: { type: 'object', properties: { id_capa: { type: 'string', description: 'ID de 6 dígitos' } }, required: ['id_capa'] },
  plataformas: ['electrum'],
  ejecutar: ({ id_capa }) =>
    conCatalogo(async (capas) => {
      const e = entrada(capas, id_capa);
      if (!e) return { ok: true, texto: `No hay una capa ${id_capa} en el índice.` };
      const fs = valoresConColor(e);
      if (!fs.length) return { ok: true, texto: `${id6(e.id)} ${e.nombre} no tiene filtros: se abre entera.` };
      return {
        ok: true,
        texto: `${id6(e.id)} ${e.nombre}. Ofrecé SOLO estos valores:\n${fs.map((f) => `- ${f.campo} (${f.etiqueta}): ${f.valores.map((v) => `${v.texto}${v.color ? ` ${v.color}` : ''}`).join(', ')}`).join('\n')}`,
      };
    }),
};

export const encender_capa: Herramienta = {
  nombre: 'encender_capa',
  descripcion: 'Enciende una capa del índice, con o sin filtro. No apaga las demás.',
  esquema: { type: 'object', properties: { id_capa: { type: 'string', description: 'ID de 6 dígitos' }, filtros: FILTROS_ESQUEMA }, required: ['id_capa'] },
  plataformas: ['electrum'],
  ejecutar: ({ id_capa, filtros }, ctx) =>
    conCatalogo(async (capas) => {
      const e = entrada(capas, id_capa);
      if (!e) return { ok: false, texto: `No hay una capa ${id_capa} en el índice. No digas que la abriste.` };
      if (e.sin_datos) return { ok: false, texto: `${id6(e.id)} ${e.nombre} está en el índice sin datos (no llegó archivo). No se abrió.` };
      const hs = e.tipo === 'grupo' ? hojasCat(capas, e.id) : encendibleCat(e) ? [e] : [];
      if (!hs.length) return { ok: false, texto: `${id6(e.id)} ${e.nombre} no se puede encender${e.tipo === 'documento' ? ' (es un plano: se abre en el visor del índice)' : ''}. No se abrió.` };
      if (hs.length > 1) {
        if (hs.length > 12) return { ok: false, texto: `${e.nombre} tiene ${hs.length} capas: preguntá cuál (listar_grupo ${id6(e.id)}).` };
        const ya = new Set((ctx.mapa?.capas || []).map((c) => c.id));
        return { ok: true, texto: `Encendí ${enumerar(hs.map((h) => h.nombre))}.`, ui: ordenes(hs.filter((h) => !ya.has(h.id)).map((h) => ({ op: 'encender' as const, id: h.id, filtros: {} }))) };
      }
      const x = hs[0];
      const r = filtrosReales(x, filtros);
      if (r.error) return { ok: false, texto: `${r.error} No se abrió nada.` };
      const ya = (ctx.mapa?.capas || []).some((c) => c.id === x.id);
      return {
        ok: true,
        texto: `${ya ? 'Cambié el filtro de' : 'Encendí'} ${frase(x, r.filtros)}${await conCuenta(x, r.filtros)}.`,
        ui: ordenes([ya ? { op: 'filtro', id: x.id, filtros: r.filtros } : { op: 'encender', id: x.id, filtros: r.filtros, encuadrar: !(ctx.mapa?.capas || []).length }]),
      };
    }),
};

export const aplicar_filtro: Herramienta = {
  nombre: 'aplicar_filtro',
  descripcion: 'Cambia el filtro de una capa encendida.',
  esquema: { type: 'object', properties: { id_capa: { type: 'string', description: 'ID de 6 dígitos' }, filtros: FILTROS_ESQUEMA }, required: ['id_capa', 'filtros'] },
  plataformas: ['electrum'],
  ejecutar: ({ id_capa, filtros }) =>
    conCatalogo(async (capas) => {
      const e = entrada(capas, id_capa);
      if (!e || !encendibleCat(e)) return { ok: false, texto: `No hay una capa ${id_capa} que se pueda filtrar.` };
      const r = filtrosReales(e, filtros);
      if (r.error) return { ok: false, texto: `${r.error} No se cambió nada.` };
      return { ok: true, texto: `Ahora ${frase(e, r.filtros)}${await conCuenta(e, r.filtros)}.`, ui: ordenes([{ op: 'filtro', id: e.id, filtros: r.filtros }]) };
    }),
};

export const apagar_capa: Herramienta = {
  nombre: 'apagar_capa',
  descripcion: 'Apaga una capa (o las de un grupo).',
  esquema: { type: 'object', properties: { id_capa: { type: 'string', description: 'ID de 6 dígitos' } }, required: ['id_capa'] },
  plataformas: ['electrum'],
  ejecutar: ({ id_capa }) =>
    conCatalogo(async (capas) => {
      const e = entrada(capas, id_capa);
      if (!e) return { ok: false, texto: `No hay una capa ${id_capa} en el índice.` };
      const ids = (e.tipo === 'grupo' ? hojasCat(capas, e.id) : [e]).map((h) => h.id);
      return { ok: true, texto: `Apagué ${e.nombre}.`, ui: ordenes(ids.map((id) => ({ op: 'apagar' as const, id }))) };
    }),
};

export const estado_mapa: Herramienta = {
  nombre: 'estado_mapa',
  descripcion: 'Capas encendidas ahora y sus filtros.',
  esquema: { type: 'object', properties: {} },
  plataformas: ['electrum'],
  ejecutar: (_args, ctx: Contexto) =>
    conCatalogo(async (capas) => {
      const xs = ctx.mapa?.capas;
      if (!xs) return { ok: true, texto: 'No sé qué hay en pantalla: esta conversación no viene del mapa.' };
      if (!xs.length) return { ok: true, texto: 'No hay capas encendidas: solo el perímetro de Honduras.' };
      const por = new Map(capas.map((c) => [c.id, c]));
      return {
        ok: true,
        texto: `Encendidas (la última es la más reciente):\n${xs
          .map((c) => {
            const e = por.get(c.id);
            const f = Object.entries(c.filtros || {}).filter(([, v]) => v.length);
            return `- ${id6(c.id)} ${e?.nombre || '(ya no está en el índice)'}${f.length ? ` · filtro ${f.map(([k, v]) => `${k}: ${v.join(' o ')}`).join('; ')}` : ' · sin filtro'}`;
          })
          .join('\n')}`,
      };
    }),
};

export const acercar_a: Herramienta = {
  nombre: 'acercar_a',
  descripcion: 'Encuadra el mapa en una capa o en sus rasgos filtrados.',
  esquema: { type: 'object', properties: { id_capa: { type: 'string', description: 'ID de 6 dígitos' }, filtros: FILTROS_ESQUEMA }, required: ['id_capa'] },
  plataformas: ['electrum'],
  ejecutar: ({ id_capa, filtros }) =>
    conCatalogo(async (capas) => {
      const e = entrada(capas, id_capa);
      if (!e) return { ok: false, texto: `No hay una capa ${id_capa} en el índice.` };
      const r = filtrosReales(e, filtros);
      if (r.error) return { ok: false, texto: r.error };
      return { ok: true, texto: `Encuadré el mapa en ${frase(e, r.filtros)}.`, ui: ordenes([{ op: 'acercar', id: e.id, filtros: r.filtros }]) };
    }),
};

export const limpiar_mapa: Herramienta = {
  nombre: 'limpiar_mapa',
  descripcion: 'Apaga todas las capas; queda el perímetro de Honduras.',
  esquema: { type: 'object', properties: {} },
  plataformas: ['electrum'],
  async ejecutar() {
    return { ok: true, texto: 'Dejé solo el perímetro de Honduras.', ui: ordenes([{ op: 'limpiar' }]) };
  },
};

export const contar_entidades: Herramienta = {
  nombre: 'contar_entidades',
  descripcion: 'Cuántos rasgos de una capa cumplen un filtro.',
  esquema: { type: 'object', properties: { id_capa: { type: 'string', description: 'ID de 6 dígitos' }, filtros: FILTROS_ESQUEMA }, required: ['id_capa'] },
  plataformas: ['electrum'],
  ejecutar: ({ id_capa, filtros }) =>
    conCatalogo(async (capas) => {
      const e = entrada(capas, id_capa);
      if (!e) return { ok: false, texto: `No hay una capa ${id_capa} en el índice.` };
      const r = filtrosReales(e, filtros);
      if (r.error) return { ok: false, texto: r.error };
      const n = await contarIndice(e.id, r.filtros).catch(() => null);
      if (n == null) return { ok: true, texto: `${e.nombre} no se puede contar (se sirve por teselas o es una imagen).` };
      return { ok: true, texto: `${unidad(e, n)} en ${frase(e, r.filtros)} (${id6(e.id)}).` };
    }),
};

export const MANOS_CAPAS = { buscar_capas, listar_grupo, valores_filtro, encender_capa, aplicar_filtro, apagar_capa, estado_mapa, acercar_a, limpiar_mapa, contar_entidades };
/** Las que mueven la pantalla: no van por MCP (allí no hay mapa). */
export const CAPAS_PANTALLA = ['encender_capa', 'aplicar_filtro', 'apagar_capa', 'acercar_a', 'limpiar_mapa', 'estado_mapa'];
