/**
 * PROTOCOLO — leer las llamadas a herramientas venga el modelo como venga.
 *
 * Tres formatos, en orden de preferencia:
 *
 *  1. **Nativo.** El servidor (Ollama, vLLM, cualquier API compatible con OpenAI) ya parseó la
 *     llamada y devuelve `message.tool_calls: [{function:{name, arguments}}]`. Puede traer varias.
 *     Es el mejor caso: el parseo lo hizo quien conoce la plantilla exacta del modelo.
 *
 *  2. **Hermes.** El modelo escribe `<tool_call>{"name":…,"arguments":{…}}</tool_call>` dentro del
 *     texto. Es el formato con el que Qwen3 fue entrenado y el que emite cuando el servidor no
 *     activó el parser nativo. Puede aparecer varias veces en una misma respuesta.
 *
 *  3. **Legado.** `PEDIR_HERRAMIENTA: web <consulta>`, la línea que inventamos nosotros. Se mantiene
 *     porque hay nodos desplegados que la conocen; se irá cuando no quede ninguno.
 *
 * Todo sale normalizado como `Llamada[]`. El resto del harness no sabe ni le importa de dónde vino.
 */
import type { EsquemaJson, Herramienta, Llamada } from './tipos';

/* ------------------------------------------------------------------ hacia el modelo */

/** Las herramientas en el formato que esperan Ollama, vLLM y cualquier API tipo OpenAI. */
export function herramientasNativas(hs: Herramienta[]) {
  return hs.map((h) => ({
    type: 'function',
    function: { name: h.nombre, description: h.descripcion, parameters: h.esquema },
  }));
}

/**
 * El bloque de instrucciones para cuando el servidor NO acepta `tools` y hay que pedírselo por
 * prompt. Se escribe en el formato Hermes exacto, que es el que el modelo ya sabe emitir.
 */
export function instruccionHermes(hs: Herramienta[]): string {
  if (!hs.length) return '';
  const firmas = hs.map((h) => JSON.stringify({ name: h.nombre, description: h.descripcion, parameters: h.esquema }));
  return [
    'Tenés herramientas. Cuando necesites una, emití la llamada y NADA más; el resultado te llega y después contestás.',
    'Formato exacto, una etiqueta por llamada (podés emitir varias seguidas si son independientes):',
    '<tool_call>{"name": "nombre_de_la_herramienta", "arguments": {"campo": "valor"}}</tool_call>',
    '',
    'Herramientas disponibles:',
    '<tools>',
    ...firmas,
    '</tools>',
    '',
    'Reglas: no inventes herramientas que no estén en la lista; no inventes el resultado de una llamada;',
    'si te falta un dato para llamar, preguntalo en vez de suponerlo.',
  ].join('\n');
}

/* ------------------------------------------------------------------ desde el modelo */

/** Acepta argumentos como objeto o como cadena JSON, que es como los manda cada servidor. */
function comoObjeto(x: unknown): Record<string, unknown> {
  if (x && typeof x === 'object' && !Array.isArray(x)) return x as Record<string, unknown>;
  if (typeof x === 'string') {
    try {
      const j = JSON.parse(x);
      return j && typeof j === 'object' ? j : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** Llamadas que ya venían parseadas por el servidor. */
export function deNativo(mensaje: any): Llamada[] {
  const bruto = mensaje?.tool_calls;
  if (!Array.isArray(bruto)) return [];
  return bruto
    .map((t: any) => {
      const f = t?.function || t;
      const nombre = String(f?.name || '').trim();
      if (!nombre) return null;
      return { nombre, argumentos: comoObjeto(f?.arguments ?? f?.parameters), id: t?.id ? String(t.id) : undefined, via: 'nativo' as const };
    })
    .filter(Boolean) as Llamada[];
}

// Tolerante a propósito: algunos modelos cierran con </tool_call> y otros se olvidan al final.
const RE_HERMES = /<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/gi;

/** Llamadas escritas por el modelo en el texto, formato Hermes. */
export function deHermes(texto: string): Llamada[] {
  const salida: Llamada[] = [];
  for (const m of String(texto || '').matchAll(RE_HERMES)) {
    const cuerpo = m[1]?.trim();
    if (!cuerpo) continue;
    try {
      const j = JSON.parse(cuerpo);
      const nombre = String(j?.name || j?.tool || '').trim();
      if (nombre) salida.push({ nombre, argumentos: comoObjeto(j?.arguments ?? j?.parameters ?? j?.args), via: 'hermes' });
    } catch {
      // JSON roto dentro de la etiqueta: se ignora esa llamada, no se tumba el turno.
    }
  }
  return salida;
}

const RE_LEGADO = /^\s*PEDIR_HERRAMIENTA:\s*([a-z_]+)\s*(.*)$/gim;

/** El formato viejo de una línea. Se mantiene mientras queden nodos que lo conozcan. */
export function deLegado(texto: string, nombres: Set<string>): Llamada[] {
  const salida: Llamada[] = [];
  for (const m of String(texto || '').matchAll(RE_LEGADO)) {
    const nombre = m[1].toLowerCase();
    if (!nombres.has(nombre)) continue;
    const arg = (m[2] || '').trim();
    salida.push({ nombre, argumentos: arg ? { consulta: arg } : {}, via: 'legado' });
  }
  return salida;
}

/** Todas las llamadas de una respuesta, en el orden en que el modelo las pidió y sin repetidas. */
export function leerLlamadas(mensaje: any, texto: string, herramientas: Herramienta[]): Llamada[] {
  const nombres = new Set(herramientas.map((h) => h.nombre));
  const todas = [...deNativo(mensaje), ...deHermes(texto), ...deLegado(texto, nombres)];
  const vistas = new Set<string>();
  const salida: Llamada[] = [];
  for (const l of todas) {
    if (!nombres.has(l.nombre)) continue; // herramienta inventada: se descarta
    const huella = `${l.nombre}:${JSON.stringify(l.argumentos)}`;
    if (vistas.has(huella)) continue; // la misma llamada dos veces en una respuesta
    vistas.add(huella);
    salida.push(l);
  }
  return salida;
}

/** Quita las etiquetas de llamada del texto, para que no se lean en voz alta. */
export function limpiarTexto(texto: string): string {
  return String(texto || '')
    .replace(RE_HERMES, '')
    .replace(/^\s*PEDIR_HERRAMIENTA:.*$/gim, '')
    .replace(/<\/?tools>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ------------------------------------------------------------------ validación */

/**
 * Comprueba los argumentos contra el esquema y rellena los que tengan valor por defecto.
 * Devuelve el error como texto para podérselo DEVOLVER AL MODELO: un agente que recibe
 * «falta el campo x» corrige y reintenta; uno que recibe un fallo mudo, inventa.
 */
export function validar(esquema: EsquemaJson, args: Record<string, unknown>): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  const salida: Record<string, unknown> = {};
  const props = esquema.properties || {};

  for (const [k, def] of Object.entries(props)) {
    let v = args[k];
    if (v === undefined && def.default !== undefined) v = def.default;
    if (v === undefined || v === null || v === '') continue;

    if (def.type === 'number' || def.type === 'integer') {
      const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
      if (!isFinite(n)) return { ok: false, error: `El campo «${k}» tiene que ser un número y llegó «${String(v)}».` };
      salida[k] = def.type === 'integer' ? Math.round(n) : n;
      continue;
    }
    if (def.type === 'boolean') {
      salida[k] = typeof v === 'boolean' ? v : /^(true|1|si|sí)$/i.test(String(v));
      continue;
    }
    if (def.type === 'array') {
      salida[k] = Array.isArray(v) ? v : [v];
      continue;
    }
    const s = String(v);
    if (def.enum && !def.enum.includes(s)) {
      return { ok: false, error: `El campo «${k}» solo admite: ${def.enum.join(', ')}. Llegó «${s}».` };
    }
    salida[k] = s;
  }

  for (const req of esquema.required || []) {
    if (salida[req] === undefined) {
      return { ok: false, error: `Falta el campo «${req}». Es obligatorio: ${props[req]?.description || 'sin descripción'}.` };
    }
  }
  return { ok: true, args: salida };
}
