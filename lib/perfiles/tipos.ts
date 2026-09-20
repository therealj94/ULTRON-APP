/**
 * PERFIL DE CEREBRO — qué cambia entre una plataforma y otra.
 *
 * ULTRON es un cuerpo: cara, voz, emociones, oído, ojos, harness, memoria. Eso no se duplica nunca.
 * Lo que cambia de una plataforma a otra es el CEREBRO: quién dice ser, qué sabe de verdad, con qué
 * palabras se le busca ese saber, qué reglas extra obedece y qué herramientas tiene a mano.
 *
 * Genesis Core (la junta de Orden Global) y el Cerebro de Minas son dos perfiles del mismo binario.
 * Se elige con ULTRON_PERFIL en el entorno, así que son dos servicios de Render sobre el mismo repo:
 * arreglar la voz o la cara arregla las dos plataformas a la vez, y el cerebro de una no puede
 * contaminar el de la otra porque solo se carga el suyo.
 */

/** Herramientas que un perfil puede encender. El cuerpo las tiene todas; el cerebro decide cuáles usa. */
export type Herramienta =
  | 'web' // búsqueda y lectura de páginas
  | 'metales' // spot de oro, plata, cobre
  | 'fx' // tipo de cambio
  | 'pdf' // leer documentos
  | 'vision' // leer imágenes y frames de cámara
  | 'memoria' // recordar por persona
  | 'telegram'
  | 'taller' // estado del sistema, redespliegue, mantenimiento
  | 'canto' // repertorio y oración: el cuerpo puede, pero no toda plataforma lo ofrece
  | 'calculos-mina' // ley, tonelaje, onzas, recuperación, strip ratio, cutoff
  | 'concesiones'; // fichas de concesiones y permisos

export type PerfilCerebro = {
  /** Identificador corto, el valor de ULTRON_PERFIL. */
  id: string;
  /** Nombre del cerebro, el que ULTRON dice ser parte de. */
  cerebro: string;
  /** Nombre de la plataforma, el que se ve en la pantalla de arranque. */
  plataforma: string;
  /** Una línea: para qué existe esta plataforma. */
  proposito: string;
  /** Color de acento de la plataforma (hex). El cuerpo lo usa para la cara y la interfaz. */
  acento: string;
  /** Marca de demo: si es true, la plataforma lo dice en voz alta y no finge estar en producción. */
  demo: boolean;
  /** La frase de identidad del system prompt. `canal` distingue mesa de Telegram. */
  identidad(opts: { nombre: string; canal: 'mesa' | 'telegram' }): string;
  /** El cuerpo de hechos que el cerebro sabe de verdad. Va entero en el system. */
  conocimiento: string;
  /** Cómo se titula ese cuerpo de hechos cuando se le recuerda al modelo. */
  tituloConocimiento: string;
  /** Sinónimos: lo que dice la persona → palabras que aparecen en el conocimiento. */
  alias: Array<[RegExp, string[]]>;
  /** Reglas extra del perfil, una por línea, que se suman a la personalidad común. */
  reglas: string[];
  /** Herramientas encendidas. */
  herramientas: Herramienta[];
  /** Modos de mesa disponibles, en orden. El primero es el de arranque. */
  modos: string[];
};

export function tiene(perfil: PerfilCerebro, h: Herramienta) {
  return perfil.herramientas.includes(h);
}
