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

/**
 * JSON COMO LO ESCRIBE UN MODELO.
 *
 * Visto en producción (27-09): «¿qué concesiones vencen este año?» → el modelo pidió
 * `catastro_vencimientos` con los días calculados a mano (`"dias": 365 - 270`), el JSON no se pudo
 * leer, se le rechazó la llamada y terminó preguntándole a José cuántos días. Los errores son
 * siempre los mismos: comentarios, comas de más, comillas simples, claves sin comillas, una cuenta
 * en lugar de un número, bloques de código alrededor. Se reparan esos, y nada más: lo que siga
 * roto se sigue rechazando con su motivo.
 */
/**
 * Suma, resta, multiplica y divide números, con precedencia. Nada más: no evalúa código. Si la
 * cuenta no da un número finito (división por cero, algo que no se entiende), lanza: mejor
 * rechazar la llamada con su motivo que pasarle a la herramienta un cero inventado.
 */
function cuenta(expr: string): number {
  // Números sin signo y operadores aparte: «365-270» es una resta, no 365 seguido de −270.
  const fichas = expr.replace(/\s+/g, '').match(/\d+(?:\.\d+)?|[-+*/]/g) || [];
  let i = 0;
  const numero = (): number => {
    let signo = 1;
    while (fichas[i] === '-' || fichas[i] === '+') signo *= fichas[i++] === '-' ? -1 : 1;
    const n = Number(fichas[i++]);
    if (!Number.isFinite(n)) throw new Error('cuenta ilegible');
    return signo * n;
  };
  const terminos: number[] = [];
  const signos: string[] = [];
  let actual = numero();
  while (i < fichas.length) {
    const op = fichas[i++];
    const n = numero();
    if (op === '*') actual *= n;
    else if (op === '/') actual /= n;
    else {
      terminos.push(actual);
      signos.push(op);
      actual = n;
    }
  }
  terminos.push(actual);
  const v = terminos.reduce((acc, t, k) => (k === 0 ? t : signos[k - 1] === '-' ? acc - t : acc + t), 0);
  if (!Number.isFinite(v)) throw new Error('la cuenta no da un número');
  return v;
}

export function jsonTolerante(texto: string): any {
  const crudo = String(texto ?? '').trim();
  try {
    return JSON.parse(crudo);
  } catch {
    /* se intenta reparar */
  }
  let t = crudo
    .replace(/^```(?:json)?\s*|\s*```$/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1')
    .replace(/'([^'"\\]*)'/g, '"$1"')
    .replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*:/g, '$1"$2":')
    .replace(/:\s*(-?\d+(?:\.\d+)?(?:\s*[-+*/]\s*-?\d+(?:\.\d+)?)+)(?=\s*[,}\]])/g, (_m, expr: string) => {
      return `: ${Math.round(cuenta(expr) * 1000) / 1000}`;
    })
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
  // Llaves de más o de menos al final, lo típico de un corte.
  const abiertas = (t.match(/{/g) || []).length - (t.match(/}/g) || []).length;
  if (abiertas > 0) t += '}'.repeat(abiertas);
  else if (abiertas < 0) t = t.replace(new RegExp(`}{${-abiertas}}\\s*$`), '');
  return JSON.parse(t);
}

/** Acepta argumentos como objeto o como cadena JSON, que es como los manda cada servidor. */
function comoObjeto(x: unknown): Record<string, unknown> {
  if (x && typeof x === 'object' && !Array.isArray(x)) return x as Record<string, unknown>;
  if (typeof x === 'string') {
    try {
      const j = jsonTolerante(x);
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

/**
 * EL FORMATO XML DE QWEN 3.5 EN ADELANTE.
 *
 * Desde Qwen3-Coder, y en Qwen 3.5/3.6/3.8, la plantilla oficial ya no pide JSON: el modelo escribe
 * `<tool_call><function=catastro_buscar><parameter=texto>Clavo Rico</parameter></function></tool_call>`
 * (vLLM tiene un parser aparte para esto). Aunque le pidamos Hermes, a veces vuelve a su formato de
 * entrenamiento; antes esa llamada caía como «JSON que no se puede leer» y se perdía una ronda.
 * Los valores llegan como texto: lo que parece número, booleano, lista u objeto se lee como tal.
 */
const RE_FUNCION = /<function=([A-Za-z0-9_.-]+)\s*>([\s\S]*?)(?:<\/function>|$)/;
const RE_PARAMETRO = /<parameter=([A-Za-z0-9_.-]+)\s*>([\s\S]*?)(?:<\/parameter>|(?=<parameter=)|(?=<\/function>)|$)/g;

function valorXml(bruto: string): unknown {
  const v = bruto.trim();
  if (/^-?\d+(\.\d+)?$/.test(v) || /^(true|false|null)$/.test(v) || /^[[{]/.test(v)) {
    try {
      return JSON.parse(v);
    } catch {
      /* no era JSON: queda como texto */
    }
  }
  return v;
}

/** `<function=…><parameter=…>…` → nombre y argumentos; null si el cuerpo no es de esa forma. */
export function llamadaXml(cuerpo: string): { nombre: string; argumentos: Record<string, unknown> } | null {
  const f = String(cuerpo || '').match(RE_FUNCION);
  if (!f) return null;
  const argumentos: Record<string, unknown> = {};
  for (const p of f[2].matchAll(RE_PARAMETRO)) argumentos[p[1]] = valorXml(p[2]);
  return { nombre: f[1].trim(), argumentos };
}

/** Lo que hay dentro de una etiqueta: JSON (Hermes) o XML (Qwen 3.5+). Lanza si no es ninguno. */
function cuerpoDeLlamada(cuerpo: string): { nombre: string; argumentos: Record<string, unknown> } {
  const x = llamadaXml(cuerpo);
  if (x) return x;
  const j = jsonTolerante(cuerpo);
  return { nombre: String(j?.name || j?.tool || '').trim(), argumentos: comoObjeto(j?.arguments ?? j?.parameters ?? j?.args) };
}

/** Llamadas escritas por el modelo en el texto, formato Hermes (o su variante XML). */
export function deHermes(texto: string): Llamada[] {
  const salida: Llamada[] = [];
  for (const m of String(texto || '').matchAll(RE_HERMES)) {
    const cuerpo = m[1]?.trim();
    if (!cuerpo) continue;
    try {
      const { nombre, argumentos } = cuerpoDeLlamada(cuerpo);
      if (nombre) salida.push({ nombre, argumentos, via: 'hermes' });
    } catch {
      // JSON roto dentro de la etiqueta: se ignora esa llamada, no se tumba el turno.
    }
  }
  // La variante XML suelta, sin la etiqueta <tool_call> alrededor.
  if (!salida.length && !/<tool_call>/i.test(String(texto || ''))) {
    for (const m of String(texto || '').matchAll(new RegExp(RE_FUNCION.source, 'g'))) {
      const x = llamadaXml(m[0]);
      if (x?.nombre) salida.push({ ...x, via: 'hermes' });
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

/**
 * Lo que el modelo intentó pedir y no se pudo usar: una herramienta que no tiene delante, una
 * llamada sin nombre o una etiqueta con JSON roto.
 *
 * Antes se descartaba en silencio y la etiqueta se borraba del texto: el turno terminaba vacío
 * («No me salió ninguna respuesta») sin que nadie supiera por qué. Pasó en producción al pedir un
 * PDF por Telegram. Ahora el motivo vuelve al modelo, que corrige o dice que no puede.
 */
export function pedidosRechazados(mensaje: any, texto: string, herramientas: Herramienta[]): string[] {
  const nombres = new Set(herramientas.map((h) => h.nombre));
  const motivos: string[] = [];
  for (const l of deNativo(mensaje)) if (!nombres.has(l.nombre)) motivos.push(`«${l.nombre}» no es una de tus herramientas`);
  for (const m of String(texto || '').matchAll(RE_HERMES)) {
    const cuerpo = m[1]?.trim();
    if (!cuerpo) {
      motivos.push('una etiqueta <tool_call> vacía');
      continue;
    }
    try {
      const { nombre } = cuerpoDeLlamada(cuerpo);
      if (!nombre) motivos.push('una llamada sin nombre de herramienta');
      else if (!nombres.has(nombre)) motivos.push(`«${nombre}» no es una de tus herramientas`);
    } catch {
      motivos.push('una llamada cuyo JSON no se puede leer');
    }
  }
  return [...new Set(motivos)];
}

/** Quita las etiquetas de llamada del texto, para que no se lean en voz alta. */
export function limpiarTexto(texto: string): string {
  return String(texto || '')
    .replace(RE_HERMES, '')
    .replace(new RegExp(RE_FUNCION.source, 'g'), '')
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
    // Un objeto se queda objeto (antes salía «[object Object]» y los filtros {"mineral":["Oro"]} de las
    // herramientas del índice de capas llegaban rotos: revisión de Codex en #171). Si vino como texto
    // JSON, se lee; si no es un objeto, se dice.
    if (def.type === 'object') {
      let o: unknown = v;
      if (typeof o === 'string') {
        try {
          o = JSON.parse(o);
        } catch {
          return { ok: false, error: `El campo «${k}» tiene que ser un objeto JSON y llegó «${String(v).slice(0, 80)}».` };
        }
      }
      if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, error: `El campo «${k}» tiene que ser un objeto.` };
      salida[k] = o;
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
