/**
 * HARNESS AGÉNTICO — el contrato de una herramienta.
 *
 * Por qué se rehízo el anterior. `PEDIR_HERRAMIENTA: web <consulta>` era una línea de texto inventada
 * por nosotros: una sola herramienta por turno, argumentos sueltos sin forma, y un idioma que el
 * modelo no conoce. Qwen3 viene entrenado con el formato Hermes (`<tool_call>{…}</tool_call>`), que
 * es el que su propia plantilla de chat usa, y el servidor de Ollama acepta además `tools` nativo y
 * devuelve `message.tool_calls` en array, o sea varias llamadas a la vez.
 *
 * Así que el harness nuevo habla los tres, en este orden: nativo, Hermes, y el viejo por si algún
 * nodo quedó atrás. Hablar el idioma del modelo no es cosmética: un modelo que emite el formato con
 * el que fue entrenado se equivoca muchísimo menos en los argumentos.
 */

import type { Nivel, Plataforma } from '../acceso';
import type { Efecto } from '../cognitivo/politica';

/** Esquema JSON de los argumentos. Es la misma forma que usan OpenAI, Ollama, Hermes y MCP. */
export type EsquemaJson = {
  type: 'object';
  properties: Record<string, { type: string; description: string; enum?: string[]; items?: unknown; default?: unknown }>;
  required?: string[];
};

/** Lo que devuelve una herramienta cuando termina. */
export type ResultadoHerramienta = {
  ok: boolean;
  /**
   * Lo que ve el MODELO. Corto y útil: una o dos frases con el dato, no un volcado de JSON.
   * Un resultado largo se come la ventana de contexto y empeora la respuesta final.
   */
  texto: string;
  /**
   * Lo que ve la INTERFAZ y el modelo no necesita leer: la geometría para pintar en el mapa, las
   * filas de una tabla, el PDF generado. Esto es lo que hace que el mapa se mueva solo cuando Dr
   * Electrum habla, sin que el modelo tenga que escribir coordenadas.
   */
  ui?: Record<string, unknown>;
};

export type Contexto = {
  /** Quién pregunta, ya verificado. Null si no se identificó. */
  quien: string | null;
  /**
   * Qué puede hacer en ESTA plataforma, según el padrón (lib/acceso.ts). Reemplazó a un `mando`
   * booleano: con dos niveles de escritura —alimentar el cerebro y cambiar el sistema— un solo
   * bit ya no alcanzaba, y colapsarlos obligaba a dar mando para permitir subir un expediente.
   */
  nivel: Nivel | null;
  /** En cuál de los dos cerebros corre este turno. Una herramienta de uno no se presta al otro. */
  plataforma: Plataforma;
  /** Canal por el que llegó, para no mandar un PDF a quien no puede recibirlo. */
  canal: 'mesa' | 'telegram';
  /** Pregunta original del turno, por si la herramienta la necesita entera. */
  mensaje: string;
  /** Cómo se sabe quién es: una sesión firmada y un Telegram verificado prueban; un nombre, no. */
  prueba?: 'sesion' | 'telegram' | 'nombre' | null;
  /** Riesgo del turno según el clasificador (0–100). Las reglas lo usan para mandar a revisión. */
  riesgo?: number | null;
};

export function efectoDe(h: Pick<Herramienta, 'efecto' | 'escribe'>): Efecto {
  return h.efecto ?? (h.escribe ? 'escritura' : 'lectura');
}

/** Puede cambiar cosas: alimentar el cerebro o tocar el sistema. `lee` no. */
export function ctxEscribe(ctx: Contexto): boolean {
  return ctx.nivel === 'escribe' || ctx.nivel === 'mando';
}

export type Herramienta = {
  /** En snake_case: es como la nombra el modelo. */
  nombre: string;
  /**
   * Qué hace y —sobre todo— CUÁNDO usarla. La mitad de los errores de un agente salen de
   * descripciones que dicen qué hace la función pero no cuándo conviene llamarla.
   */
  descripcion: string;
  esquema: EsquemaJson;
  /** Cambia algo en el mundo. Exige nivel de escritura y no se llama dos veces con los mismos argumentos. */
  escribe?: boolean;
  /**
   * Qué clase de efecto tiene, para el motor de reglas (lib/cognitivo/politica.ts). Sin declararlo:
   * `escritura` si `escribe`, `lectura` si no. Lo que sale del sistema (`externo`), lo que lo
   * cambia (`sistema`) y lo que mueve valor (`critico`) TIENE que declararlo.
   */
  efecto?: Efecto;
  /** A quién va, en herramientas externas: los canales propios de la junta o un tercero. */
  destino?: (args: Record<string, unknown>) => 'junta' | 'tercero';
  /**
   * En qué cerebros existe esta herramienta. Es lo que impide que se presten entre plataformas por
   * descuido: el catastro y el mapa son de Dr Electrum, el taller y la bóveda son de AU-RA, y solo
   * un puñado —el precio del metal, las cuentas de mina— viven en las dos.
   */
  plataformas: Plataforma[];
  /** Cuánto puede tardar antes de que se la dé por perdida. */
  msMaximo?: number;
  ejecutar(args: Record<string, unknown>, ctx: Contexto): Promise<ResultadoHerramienta>;
};

/** Una llamada pedida por el modelo, ya normalizada venga del formato que venga. */
export type Llamada = {
  nombre: string;
  argumentos: Record<string, unknown>;
  /** Identificador del servidor, si lo trajo. Sirve para responderle a la llamada correcta. */
  id?: string;
  /** De qué formato se sacó, para poder diagnosticar qué habla el nodo. */
  via: 'nativo' | 'hermes' | 'legado';
};

/** El resultado de una llamada, listo para devolvérselo al modelo. */
export type Respuesta = {
  llamada: Llamada;
  resultado: ResultadoHerramienta;
  ms: number;
};
