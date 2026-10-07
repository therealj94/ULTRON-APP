/**
 * LO PERSONAL VIVE FUERA DEL REPO (auditoría del 7-oct, C-1: el repositorio es PÚBLICO).
 *
 * Correos, nombres de la familia y de la junta, sus roles y sus gustos, los ids de los agentes de ElevenLabs y las
 * direcciones de los nodos estaban escritos en el código. Ahora el código trae marcadores neutros y el dato de verdad
 * llega por variables de entorno de Render, que se leen al usarse (no al arrancar: las pruebas las cambian):
 *
 *   ULTRON_PADRON_BASE       el padrón de arranque (lib/acceso.ts), JSON: [{ id, nombre, correos, apodos, acceso }]
 *   AURA_JUNTA               las cuentas de la junta con su nombre y rol visibles (server/desk.ts), JSON:
 *                            { "correo@casa": { "nombre": "…", "rol": "…" } }
 *   AURA_CORREOS_ALIAS       correos viejos o personales → el correo de la casa (server/desk.ts), JSON: { "viejo": "nuevo" }
 *   AURA_HECHOS_SEMILLA      los hechos de largo plazo con que nace la memoria de la junta (server/hechos.ts), JSON: ["…"]
 *   AURA_PERSONAS_CLAVE      nombres que hacen que un hecho sea «de largo plazo» y que el cerebro busque a la junta,
 *                            separados por comas (server/hechos.ts, lib/perfiles/genesis*.ts)
 *   AURA_NOMBRES_JUNTA(_PUBLICO), AURA_NOMBRES_TEMA_OG  nombres que el cerebro reconoce (lib/perfiles, lib/conversacion.ts)
 *   AURA_CONOCIMIENTO_PERSONAS          el bloque PERSONAS del cerebro de la junta (src/05-cerebro-og/conocimiento.ts)
 *   AURA_CONOCIMIENTO_PERSONAS_PUBLICO  lo mismo para el cerebro de la comunidad (…/conocimiento-publico.ts)
 *   AURA_ORACION_BENDICE     a quién nombra la oración del día (server/voz.ts), JSON: { "es": "…", "en": "…" }
 *   AURA_CANCION_DE          «la de <nombre>» → id del repertorio (server/voz.ts), JSON: { "nombre": "id" }
 *   ELEVENLABS_AGENTE_<AVATAR>_<IDIOMA>  los agentes de la conversación de voz (server/voz-agente.ts)
 *   CUENTAS_APROBADOR, CAMPANA_IMAP_USUARIO  (ya existían; ya no tienen un correo personal por omisión)
 *
 * Si falta una, el servidor NO se cae: sigue con el marcador neutro (lo más cerrado: nadie de más en el padrón, sin
 * nombres en el cerebro) y deja UNA línea clara en el registro por variable. Un JSON roto vale como si faltara.
 */

const avisadas = new Set<string>();

/** Una línea en el registro, una vez por variable y proceso: qué falta y qué pasa mientras tanto. */
export function avisarFaltaEnv(nombre: string, efecto: string) {
  if (avisadas.has(nombre)) return;
  avisadas.add(nombre);
  console.warn(`[AU-RA] ${nombre} sin poner (o ilegible): ${efecto}. Ponla en Render (dato privado, fuera del repo público).`);
}

/** Solo pruebas: que el aviso vuelva a salir. */
export function _olvidarAvisosEnv() {
  avisadas.clear();
}

const cacheJson = new Map<string, { crudo: string; valor: unknown }>();

/**
 * Lee una variable JSON y la valida. Se recuerda por su texto crudo: cambiar la variable (las pruebas lo hacen) se nota
 * sola. Falta o no valida: `omision` y el aviso (salvo `silencio`).
 */
export function jsonDeEnv<T>(nombre: string, validar: (x: unknown) => T | null, omision: T, efecto: string, silencio = false): T {
  const crudo = String(process.env[nombre] ?? '').trim();
  const previo = cacheJson.get(nombre);
  if (previo && previo.crudo === crudo) return previo.valor as T;
  let valor: T = omision;
  if (!crudo) {
    if (!silencio) avisarFaltaEnv(nombre, efecto);
  } else {
    try {
      const v = validar(JSON.parse(crudo));
      if (v === null) throw new Error('forma inesperada');
      valor = v;
    } catch {
      avisarFaltaEnv(nombre, `${efecto} (el JSON no se pudo leer)`);
    }
  }
  cacheJson.set(nombre, { crudo, valor });
  return valor;
}

/** Un texto libre de varias líneas (`\n` literal o saltos reales). Vacío si falta (con aviso, salvo `silencio`). */
export function textoDeEnv(nombre: string, efecto: string, silencio = false): string {
  const crudo = String(process.env[nombre] ?? '').replace(/\\n/g, '\n').trim();
  if (!crudo && !silencio) avisarFaltaEnv(nombre, efecto);
  return crudo;
}

/** Una lista separada por comas (o saltos), en minúsculas y sin vacíos. */
export function listaDeEnv(nombre: string, efecto: string, silencio = false): string[] {
  const crudo = String(process.env[nombre] ?? '').trim();
  if (!crudo) {
    if (!silencio) avisarFaltaEnv(nombre, efecto);
    return [];
  }
  return crudo
    .split(/[,\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * El sinónimo «la junta» de un perfil del cerebro (lib/cerebro.ts hechosCerebro): si la pregunta nombra a alguien de la
 * junta (o dice fundador, cofundador…), se buscan las líneas de esa gente. Los nombres llegan del entorno (`nombres`,
 * ya en minúsculas y sin acentos); `fijos` son los genéricos que siempre van.
 */
export function aliasDePersonas(nombres: string[], fijos: { patron: string[]; palabras: string[] }): [RegExp, string[]] {
  const limpios = nombres.map((n) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '').trim()).filter(Boolean);
  const patron = [...fijos.patron, ...limpios.map((n) => `\\b${n}\\b`)].join('|');
  return [new RegExp(patron), [...fijos.palabras, ...limpios]];
}

/** Un objeto de texto → texto (solo cadenas no vacías), o null si no lo es. */
export function mapaDeTextos(x: unknown): Record<string, string> | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) if (typeof v === 'string' && k.trim() && v.trim()) out[k.trim()] = v.trim();
  return out;
}

/** Un array de cadenas no vacías, o null si no lo es. */
export function listaDeTextos(x: unknown): string[] | null {
  if (!Array.isArray(x)) return null;
  return x.filter((v): v is string => typeof v === 'string' && !!v.trim()).map((v) => v.trim());
}
