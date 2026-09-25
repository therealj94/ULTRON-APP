/**
 * LAS MANOS DE LA MEMORIA ESTRUCTURADA — buscar, leer y alimentar las fichas.
 *
 * Existen en las dos plataformas, pero cada una lee y escribe SOLO su memoria: la plataforma sale
 * del contexto del turno, nunca de un argumento que el modelo pueda inventar.
 *
 * Leer es libre. Escribir (registrar, relacionar, anotar un evento) es `escritura`: pasa por el motor
 * de reglas como todo lo demás, así que quien tiene acceso de consulta no alimenta la memoria, y con
 * riesgo alto va a revisión.
 */
import type { Herramienta } from '../agente/tipos';
import { buscarEntidades, ficha, fichaEnTexto, registrarEntidad, registrarEvento, relacionar } from '../cognitivo/entidades';

const entidad_buscar: Herramienta = {
  nombre: 'entidad_buscar',
  descripcion:
    'Busca en la memoria estructurada fichas de empresas, personas, proyectos, concesiones, documentos o wallets por nombre. Úsala antes de afirmar algo sobre una entidad concreta: lo que está en la ficha es lo que se sabe con certeza.',
  esquema: {
    type: 'object',
    properties: {
      nombre: { type: 'string', description: 'Nombre o parte del nombre' },
      tipo: { type: 'string', description: 'Opcional: empresa, persona, proyecto, concesion, documento, wallet…' },
    },
    required: ['nombre'],
  },
  plataformas: ['ultron', 'electrum'],
  async ejecutar(a, ctx) {
    const es = await buscarEntidades(ctx.plataforma, String(a.nombre), { tipo: a.tipo ? String(a.tipo) : undefined, limite: 8 });
    if (!es.length) return { ok: true, texto: `No hay fichas que coincidan con «${a.nombre}». No inventes datos sobre esa entidad.` };
    return { ok: true, texto: es.map((e) => `#${e.id} ${e.tipo}: ${e.nombre}${e.estado ? ` · ${e.estado}` : ''}${e.riesgo ? ` · riesgo ${e.riesgo}` : ''}`).join('\n') };
  },
};

const entidad_ficha: Herramienta = {
  nombre: 'entidad_ficha',
  descripcion: 'Trae la ficha completa de una entidad (atributos, estado, riesgo, relaciones y últimos eventos) por su número. Primero búscala con entidad_buscar.',
  esquema: { type: 'object', properties: { id: { type: 'number', description: 'Número de la ficha (#)' } }, required: ['id'] },
  plataformas: ['ultron', 'electrum'],
  async ejecutar(a, ctx) {
    const f = await ficha(ctx.plataforma, Number(a.id));
    return f ? { ok: true, texto: fichaEnTexto(f) } : { ok: false, texto: `No existe la ficha #${a.id}.` };
  },
};

const entidad_registrar: Herramienta = {
  nombre: 'entidad_registrar',
  descripcion:
    'Crea o actualiza la ficha de una entidad. Úsala solo cuando la persona te pide registrar o actualizar algo, o te da un dato nuevo y verificable. Los atributos se suman a los que ya tenía.',
  esquema: {
    type: 'object',
    properties: {
      tipo: { type: 'string', description: 'empresa, persona, proyecto, concesion, documento, wallet…' },
      nombre: { type: 'string', description: 'Nombre de la entidad' },
      atributos: { type: 'object', description: 'Datos clave/valor, por ejemplo {"jurisdiccion":"Honduras","sector":"minería"}' },
      estado: { type: 'string', description: 'Opcional: estado actual (p. ej. revisión documental)' },
      riesgo: { type: 'string', description: 'Opcional: bajo, medio o alto', enum: ['bajo', 'medio', 'alto'] },
    },
    required: ['tipo', 'nombre'],
  },
  escribe: true,
  efecto: 'escritura',
  plataformas: ['ultron', 'electrum'],
  async ejecutar(a, ctx) {
    const e = await registrarEntidad({
      plataforma: ctx.plataforma,
      tipo: String(a.tipo),
      nombre: String(a.nombre),
      atributos: a.atributos && typeof a.atributos === 'object' ? (a.atributos as Record<string, unknown>) : {},
      estado: a.estado ? String(a.estado) : null,
      riesgo: a.riesgo ? String(a.riesgo) : null,
      quien: ctx.quien,
    });
    return { ok: true, texto: `Ficha #${e.id} (${e.tipo}) «${e.nombre}» registrada.` };
  },
};

const entidad_relacionar: Herramienta = {
  nombre: 'entidad_relacionar',
  descripcion: 'Relaciona dos fichas existentes, por ejemplo «#3 es titular de #7» (tipo: titular_de). Úsala solo con fichas ya encontradas.',
  esquema: {
    type: 'object',
    properties: {
      desde: { type: 'number', description: 'Ficha de origen (#)' },
      hasta: { type: 'number', description: 'Ficha de destino (#)' },
      tipo: { type: 'string', description: 'Tipo de relación en snake_case: titular_de, representante_de, socio_de, respalda…' },
    },
    required: ['desde', 'hasta', 'tipo'],
  },
  escribe: true,
  efecto: 'escritura',
  plataformas: ['ultron', 'electrum'],
  async ejecutar(a, ctx) {
    const r = await relacionar({ plataforma: ctx.plataforma, desde: Number(a.desde), hasta: Number(a.hasta), tipo: String(a.tipo), quien: ctx.quien });
    return { ok: true, texto: `Relación guardada: #${r.desde} ${r.tipo} #${r.hasta}.` };
  },
};

const entidad_evento: Herramienta = {
  nombre: 'entidad_evento',
  descripcion: 'Anota un hecho con fecha en la ficha de una entidad (una reunión, un documento recibido, un cambio de estado), con su fuente.',
  esquema: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Ficha (#)' },
      tipo: { type: 'string', description: 'reunion, documento, cambio_estado, nota…' },
      detalle: { type: 'string', description: 'Qué pasó' },
      fuente: { type: 'string', description: 'De dónde sale (documento, persona, enlace)' },
    },
    required: ['id', 'tipo', 'detalle'],
  },
  escribe: true,
  efecto: 'escritura',
  plataformas: ['ultron', 'electrum'],
  async ejecutar(a, ctx) {
    const ev = await registrarEvento({ plataforma: ctx.plataforma, entidad: Number(a.id), tipo: String(a.tipo), detalle: String(a.detalle), fuente: a.fuente ? String(a.fuente) : null, quien: ctx.quien });
    return { ok: true, texto: `Anotado en #${ev.entidad}: ${ev.tipo} (${ev.t.slice(0, 10)}).` };
  },
};

export const MEMORIA_ESTRUCTURADA: Herramienta[] = [entidad_buscar, entidad_ficha, entidad_registrar, entidad_relacionar, entidad_evento];
