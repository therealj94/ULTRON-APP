/**
 * QUÉ ES CADA DOCUMENTO Y QUÉ TRAE — el modelo `documento` de Laya sobre los fragmentos de un
 * expediente (scripts/nodo-t4/laya/modelos/documento, ESPEC.md).
 *
 * Hasta ahora el tipo salía de buscar palabras en el nombre y en los primeros 1.200 caracteres
 * (`clasificarDoc` en aprender.ts): una solicitud que cita «Resolución No. …» quedaba como
 * resolución, y de lo que trae el documento —coordenadas, fuentes de agua, plan de cierre, plazos—
 * no se sabía nada sin leerlo entero. Laya contesta esas preguntas sobre cada fragmento en una sola
 * ida y vuelta, y lo que encuentra queda en `documento.meta.laya` con la página donde lo vio.
 *
 * Es una lectura automática para ordenar y avisar, no un dictamen: quien lo usa lo dice así, con la
 * página para ir a comprobarlo. Si Laya no está, no pasa nada: el documento ya quedó guardado y
 * buscable; simplemente no se clasifica.
 */
import { consultarModeloLote, type RespuestaModelo } from '../../lib/laya';
import { consulta, hayBase } from './db';

export const TIPO_LEGIBLE: Record<string, string> = {
  doc_resolucion: 'resolución',
  doc_contrato: 'contrato',
  doc_ambiental: 'ambiental',
  doc_tecnico: 'informe técnico',
  doc_plano: 'plano',
  doc_financiero: 'financiero',
  doc_solicitud: 'solicitud',
  doc_otro: 'otro',
};

export const REQUISITO_LEGIBLE: Record<string, string> = {
  req_firma_autoridad: 'firma o sello de autoridad',
  req_coordenadas: 'coordenadas o linderos',
  req_agua: 'fuentes de agua',
  req_comunidad: 'comunidades o consulta comunitaria',
  req_cierre: 'plan de cierre',
  req_plazo: 'plazos o vigencia',
};

/** Tipos más finos que las reglas ya saben poner y que Laya no distingue (los tres son técnicos). */
const TECNICOS_FINOS = new Set(['43-101', 'ensayo', 'plan de labores']);

/** Por debajo de esto, el tipo de Laya se guarda como lectura pero no pisa el de las reglas. */
const CONFIANZA_TIPO = 0.6;
/** Fragmentos por documento: el primero (el encabezado dice qué es) y el resto repartidos. */
const MUESTRA = 32;

export type LecturaDocumento = {
  tipo: string;
  tipoId: string;
  pTipo: number;
  requisitos: Record<string, { p: number; pagina: number | null; presente: boolean }>;
  fragmentos: number;
  de: number;
  t: string;
};

type Frag = { pagina: number | null; orden: number; texto: string };

/** El primero, y los demás repartidos a lo largo del documento, hasta `n`. */
export function muestrear<T>(todos: T[], n = MUESTRA): T[] {
  if (todos.length <= n) return todos;
  const salida = [todos[0]];
  const paso = (todos.length - 1) / (n - 1);
  for (let i = 1; i < n; i++) salida.push(todos[Math.round(i * paso)]);
  return [...new Set(salida)];
}

/**
 * Junta las respuestas de cada fragmento en una lectura del documento. El tipo lo dice el primer
 * fragmento si está seguro (es el encabezado); si duda, gana el tipo con más probabilidad sumada. Un
 * requisito está si algún fragmento pasa su umbral, y se guarda la página del más claro.
 */
export function juntar(frags: Frag[], rs: RespuestaModelo[], total = frags.length): LecturaDocumento {
  const tipos = Object.keys(TIPO_LEGIBLE);
  const primero = rs[0];
  let tipoId = primero?.grupos?.tipo;
  let pTipo = tipoId ? primero.p[tipoId] ?? 0 : 0;
  if (!tipoId || pTipo < CONFIANZA_TIPO) {
    const suma = Object.fromEntries(tipos.map((t) => [t, rs.reduce((a, r) => a + (r.p[t] ?? 0), 0)]));
    tipoId = tipos.reduce((a, b) => (suma[b] > suma[a] ? b : a));
    pTipo = suma[tipoId] / Math.max(1, rs.length);
  }
  const requisitos: LecturaDocumento['requisitos'] = {};
  for (const req of Object.keys(REQUISITO_LEGIBLE)) {
    let mejor = -1;
    rs.forEach((r, i) => {
      if (mejor < 0 || (r.p[req] ?? 0) > (rs[mejor].p[req] ?? 0)) mejor = i;
    });
    const r = rs[mejor];
    const p = r?.p[req] ?? 0;
    const umbral = r?.umbrales?.[req] ?? 0.5;
    requisitos[req] = { p: Math.round(p * 1000) / 1000, pagina: frags[mejor]?.pagina ?? null, presente: p >= umbral };
  }
  return {
    tipo: TIPO_LEGIBLE[tipoId] || 'otro',
    tipoId,
    pTipo: Math.round(pTipo * 1000) / 1000,
    requisitos,
    fragmentos: rs.length,
    de: total,
    t: new Date().toISOString(),
  };
}

/** Lee el documento con Laya. null si no hay base, no hay fragmentos o Laya no contestó. */
export async function leerDocumento(documentoId: number, esperaMs = 20_000): Promise<LecturaDocumento | null> {
  if (!hayBase()) return null;
  const todos = await consulta<Frag>(`SELECT pagina, orden, texto FROM fragmento WHERE documento_id = $1 ORDER BY orden`, [documentoId]);
  if (!todos.length) return null;
  const frags = muestrear(todos);
  const { resultados } = await consultarModeloLote('documento', frags.map((f) => f.texto), { esperaMs });
  if (!resultados || resultados.length !== frags.length) return null;
  return juntar(frags, resultados, todos.length);
}

/**
 * Clasifica y guarda. El tipo de Laya solo reemplaza al de las reglas cuando las reglas no supieron
 * («otro» o nada), Laya está segura y nadie lo fijó a mano al subirlo; si las reglas dijeron algo
 * más fino dentro de lo técnico (43-101, ensayo, plan de labores) se queda eso. La lectura completa
 * se guarda siempre en meta.laya.
 */
export async function clasificarDocumento(documentoId: number, opts: { tipoFijado?: boolean } = {}): Promise<LecturaDocumento | null> {
  const l = await leerDocumento(documentoId);
  if (!l) return null;
  const [d] = await consulta<{ tipo: string | null }>(`SELECT tipo FROM documento WHERE id = $1`, [documentoId]);
  if (!d) return null;
  const pisar = !opts.tipoFijado && l.pTipo >= CONFIANZA_TIPO && (!d.tipo || d.tipo === 'otro') && !(l.tipoId === 'doc_tecnico' && TECNICOS_FINOS.has(String(d.tipo)));
  await consulta(
    `UPDATE documento SET meta = meta || jsonb_build_object('laya', $2::jsonb), tipo = CASE WHEN $3 THEN $4 ELSE tipo END WHERE id = $1`,
    [documentoId, JSON.stringify(l), pisar, l.tipo],
  );
  return l;
}

/** La lectura dicha para el doctor y para quien pregunta, con páginas y sin vender certeza. */
export function lecturaEnTexto(nombre: string, l: LecturaDocumento): string {
  const hay = Object.entries(l.requisitos).filter(([, r]) => r.presente);
  const no = Object.entries(l.requisitos).filter(([, r]) => !r.presente);
  const pag = (r: { pagina: number | null }) => (r.pagina ? ` (página ${r.pagina})` : '');
  const partes = [
    `«${nombre}» parece ${l.tipo === 'otro' ? 'un documento que no encaja en los tipos de expediente' : `de tipo ${l.tipo}`} (${Math.round(l.pTipo * 100)} % de confianza).`,
    hay.length ? `Trae: ${hay.map(([k, r]) => `${REQUISITO_LEGIBLE[k]}${pag(r)}`).join('; ')}.` : 'No encontré ninguno de los puntos que reviso.',
    no.length ? `No lo vi: ${no.map(([k]) => REQUISITO_LEGIBLE[k]).join(', ')}.` : '',
    l.fragmentos < l.de ? `Revisé ${l.fragmentos} de ${l.de} fragmentos repartidos por todo el documento.` : '',
    'Es una lectura automática: confirmalo en la página citada antes de afirmarlo.',
  ];
  return partes.filter(Boolean).join(' ');
}

/**
 * Los documentos que todavía no tienen lectura (los que se subieron antes de esto, o cuando el
 * lector no estaba), o todos si se reentrenó el modelo. Uno por uno: la GPU es compartida con la voz
 * y un expediente de cien documentos no tiene prisa.
 */
export async function clasificarPendientes(opts: { todos?: boolean; limite?: number } = {}) {
  if (!hayBase()) return { revisados: 0, clasificados: 0, fallidos: 0 };
  const docs = await consulta<{ id: number }>(
    `SELECT id FROM documento ${opts.todos ? '' : "WHERE NOT (meta ? 'laya')"} ORDER BY id LIMIT $1`,
    [Math.max(1, Math.min(opts.limite ?? 500, 5000))],
  );
  let clasificados = 0;
  let fallidos = 0;
  for (const d of docs) {
    const l = await clasificarDocumento(d.id).catch(() => null);
    if (l) clasificados++;
    else fallidos++;
    // Si el lector se cayó a mitad, no se insiste documento tras documento contra la pausa.
    if (fallidos >= 3 && !clasificados) break;
  }
  return { revisados: clasificados + fallidos, clasificados, fallidos };
}
