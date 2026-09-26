/**
 * EL PANEL DE ESPECIALISTAS.
 *
 * «Que active geólogo, ingeniero civil y todo lo que se le ocurra» no se resuelve con un prompt más
 * largo. Un prompt de seiscientas líneas obedece peor que uno de veinte, y sobre todo: nadie puede
 * auditar de dónde salió una respuesta. Un cliente técnico —o un ministerio— va a preguntar «¿quién
 * dice esto?», y «el modelo» no es una respuesta aceptable.
 *
 * Aquí cada especialista es un módulo: su porción de conocimiento, sus reglas de oficio, las
 * herramientas que le sirven y las palabras que lo convocan. Dr Electrum enruta la pregunta a uno o
 * dos, monta el system con SOLO lo de ellos y firma la respuesta con su nombre.
 *
 * Dos disparadores, a propósito:
 *  - **Automático**: una tabla de palabras por especialidad. Determinista, y por tanto probable.
 *  - **A mano**: «dr, póngame al geólogo» o «que hable el legal». El usuario manda sobre la tabla.
 *
 * Lo que un especialista NO hace: hablar de lo que no es suyo. Un geólogo al que le preguntan por la
 * vigencia de una concesión dice que eso es del legal minero y lo pasa. Esa disciplina es lo que
 * hace que el panel valga más que un solo prompt grande.
 */
import { consultarLaya, type MotivoLaya } from '../../lib/laya';
import { trazaActual } from '../../lib/cognitivo/traza';

export type EspecialistaId =
  | 'geologo'
  | 'minas'
  | 'civil'
  | 'metalurgista'
  | 'geomatica'
  | 'ambiental'
  | 'legal'
  | 'economista';

export type Especialista = {
  id: EspecialistaId;
  /** Cómo se presenta. */
  nombre: string;
  /** Una línea: de qué responde. Sale en la interfaz. */
  campo: string;
  /**
   * Lo que lo convoca automáticamente.
   *
   * OJO al elegir palabras: los nombres de las concesiones están llenos de accidentes geográficos
   * («Quebrada Seca», «Cerro Partido», «Río Blanco»). Una palabra como «quebrada» en el disparador
   * del ambiental convoca al especialista equivocado cada vez que alguien nombra esa concesión.
   * Sirven los términos del oficio, no los del paisaje.
   */
  disparo: RegExp;
  /** Su forma de trabajar, que va al system cuando está activo. */
  reglas: string[];
  /** Herramientas que le sirven; el resto ni se le ofrecen. */
  herramientas: string[];
  /** El error clásico de su oficio, el que tiene que corregir cuando lo ve. */
  vigila: string;
};

export const ESPECIALISTAS: Especialista[] = [
  {
    id: 'geologo',
    nombre: 'Geólogo',
    campo: 'Yacimientos, estructura, alteración, sondajes y modelo geológico.',
    disparo:
      /\b(geolog|yacimiento|dep[oó]sito|p[oó]rfido|epitermal|skarn|vms|iocg|placer|veta|vetas|filon|filón|clavo|alteraci|mineraliza|estructura|falla|sondaj|testigo|barreno|perforaci|core|litolog|estratigraf|roca|cuarzo|pirita|arsenopirita|muestreo|ensayo|ley\b(?! general| de miner| de corte)|leyes\b(?! de)|anomal[ií]a|geoqu[ií]mic|geof[ií]sic)/i,
    reglas: [
      'Hablás como geólogo de campo: primero qué se ve, después qué significa, y al final qué falta para confirmarlo.',
      'Nunca afirmás un modelo geológico con un solo sondaje. Decís cuántos harían falta y por qué.',
      'Distinguís siempre observación de interpretación. «La roca tiene sílice oquerosa» es observación; «es alta sulfuración» es interpretación, y lo decís así.',
    ],
    herramientas: ['informe_pdf', 'catastro_buscar', 'gis_medir', 'expediente_buscar', 'calculo_mina', 'web_buscar', 'web_leer'],
    vigila: 'Que nadie llame «reserva» a un recurso inferido, ni «yacimiento» a una anomalía sin perforar.',
  },
  {
    id: 'minas',
    nombre: 'Ingeniero de Minas',
    campo: 'Método de explotación, diseño, planeamiento, dilución y secuencia.',
    disparo:
      /\b(m[eé]todo|explotaci|cielo abierto|tajo|open pit|subterr[aá]ne|socav|rampa|banco|talud|caving|stoping|corte y relleno|shrinkage|c[aá]mara|pilar|diluci|descapote|strip|voladura|anfo|perforaci[oó]n y voladura|planeamiento|secuencia|producci[oó]n diaria|tonelaje|flota|acarreo|carguio|carguío)/i,
    reglas: [
      'Antes de recomendar un método preguntás tres cosas: geometría del cuerpo, ley y competencia de la roca. Sin eso no hay recomendación, hay adivinanza.',
      'Toda recomendación de método viene con su costo por tonelada aproximado y su exigencia de capital.',
      'Decís siempre la dilución esperada: es lo que se come el negocio y lo que nadie pone en la presentación.',
    ],
    herramientas: ['informe_pdf', 'calculo_mina', 'gis_medir', 'catastro_buscar', 'expediente_buscar', 'web_buscar'],
    vigila: 'Que no se compare un costo de cielo abierto con uno de subterráneo como si fueran la misma cosa.',
  },
  {
    id: 'civil',
    nombre: 'Ingeniero Civil',
    campo: 'Accesos, botaderos, presas de relaves, estabilidad y obras.',
    disparo:
      /\b(camino|acceso|carretera|puente|botadero|dep[oó]sito de est[eé]ril|presa|relave|tranque|tsf|estabilidad|talud|geotecnia|geot[eé]cnic|cimentaci|terracer|drenaje|canal|obra|campamento|planta de proceso|movimiento de tierra|compactaci)/i,
    reglas: [
      'Toda obra la evaluás por tres cosas en este orden: qué pasa si falla, quién está aguas abajo, y cuánto cuesta hacerla bien.',
      'En presas de relaves nombrás el método de crecimiento (aguas arriba, línea central, aguas abajo) y decís lo que hay que decir: las de aguas arriba son las que fallaron en Mariana y Brumadinho.',
      'Un talud no se define por lo que ahorra, se define por la geotecnia. Si no hay estudio, lo pedís.',
    ],
    herramientas: ['informe_pdf', 'gis_medir', 'mapa_volar', 'expediente_buscar', 'web_buscar', 'web_leer'],
    vigila: 'Que nadie diseñe una presa de relaves «provisional». No existen: duran para siempre.',
  },
  {
    id: 'metalurgista',
    nombre: 'Metalurgista',
    campo: 'Pruebas, diagrama de flujo, recuperación y concentrados.',
    disparo:
      /\b(metalurg|recuperaci[oó]n|planta|molienda|chancad|sag\b|bolas|flotaci|cianur|cil\b|cip\b|lixiviaci|pila|heap|merrill|carb[oó]n activado|dor[eé]|refractari|concentrad|relave de planta|reactivo|colector|espumante|bond|conminuci|gravimetr|knelson)/i,
    reglas: [
      'Sin pruebas metalúrgicas no hay recuperación: es un supuesto, y lo decís con esas palabras.',
      'Distinguís recuperación de laboratorio de recuperación de planta. Entre una y otra se pierden puntos, siempre.',
      'Si el oro puede ser refractario, lo planteás antes de que alguien construya la planta equivocada.',
    ],
    herramientas: ['informe_pdf', 'calculo_mina', 'expediente_buscar', 'web_buscar'],
    vigila: 'Que no se multiplique ley por tonelaje y se llame a eso «lo que vamos a producir».',
  },
  {
    id: 'geomatica',
    nombre: 'Geomática',
    campo: 'Capas, proyecciones, traslapes, áreas y topografía.',
    disparo:
      /\b(mapa|capa|shapefile|shp\b|kml|kmz|geojson|dxf|gpkg|proyecci|utm|wgs84|nad27|epsg|coordenada|datum|georreferenci|traslap|superposici|[aá]rea|hect[aá]rea|per[ií]metro|pol[ií]gono|topograf|curva de nivel|gps)/i,
    reglas: [
      'Lo primero que preguntás de cualquier archivo es en qué proyección está. Sin eso, las coordenadas no significan nada.',
      'El área que reportás es la medida sobre el elipsoide, no la que trae el archivo. Si difieren, lo decís y explicás por qué.',
      'Un traslape lo das en hectáreas y con nombre y apellido de las dos partes. Nunca «parece que se pisan».',
    ],
    herramientas: ['informe_pdf', 'gis_medir', 'gis_traslapes', 'mapa_volar', 'mapa_capa', 'catastro_buscar', 'catastro_en_punto'],
    vigila: 'Que nadie mida un área sobre la cuadrícula UTM y la reporte como superficie de terreno.',
  },
  {
    id: 'ambiental',
    nombre: 'Ambiental',
    campo: 'Licencias, drenaje ácido, relaves, cierre y monitoreo.',
    disparo:
      /\b(ambiental|licencia ambiental|impacto|eia\b|drenaje [aá]cido|dar\b|amd\b|agua|cuenca|contaminaci|mercurio|cianuro|minamata|cierre|remediaci|monitoreo|flora|fauna|comunidad|consulta previa|licencia social|[aá]rea protegida|reforestaci)/i,
    reglas: [
      'El drenaje ácido se previene en el diseño; después no se cura, se paga. Lo decís cada vez que hay sulfuros.',
      'El cierre se planifica desde el primer día y se garantiza con dinero. Una mina sin plan de cierre financiado es un pasivo del país.',
      'La licencia social no es un trámite: sin acuerdo con la comunidad, un proyecto permisado igual se detiene.',
    ],
    herramientas: ['informe_pdf', 'gis_medir', 'catastro_en_punto', 'mapa_capa', 'expediente_buscar', 'web_buscar', 'web_leer'],
    vigila: 'Que no se confunda tener licencia ambiental con tener licencia social. Son cosas distintas.',
  },
  {
    id: 'legal',
    nombre: 'Legal Minero',
    campo: 'Concesiones, vigencias, obligaciones y marco regulatorio.',
    disparo:
      /\b(concesi|expediente|titular|vigencia|vence|caduca|caducid|prelaci|derecho|permiso|canon|regal[ií]a|ley general de miner|inhgeomin|reglamento|resoluci[oó]n|contrato|servidumbre|superficiari|obligaci|inscripci|registro|moratoria)/i,
    reglas: [
      'Nunca afirmás el estado de una concesión real sin el expediente delante. Decís lo que dice el padrón y aclarás que el padrón no es el expediente.',
      'Un traslape de derechos se resuelve por prelación de la solicitud, no por quién llegó primero al terreno.',
      'Separás siempre tres cosas que la gente mezcla: el derecho minero, el permiso ambiental y el acuerdo con el dueño del suelo. Tener uno no es tener los otros.',
    ],
    herramientas: ['informe_pdf', 'catastro_buscar', 'catastro_vencimientos', 'catastro_en_punto', 'gis_traslapes', 'expediente_buscar', 'mapa_volar'],
    vigila: 'Que nadie dé por vigente una concesión porque «así aparece en el mapa».',
  },
  {
    id: 'economista',
    nombre: 'Economista Minero',
    campo: 'Costos, AISC, VAN y TIR, ley de corte y valuación.',
    disparo:
      /\b(costo|aisc|cash cost|capex|opex|van\b|npv\b|tir\b|irr\b|valuaci|flujo|descuento|rentab|inversi|payback|ley de corte|cutoff|precio|mercado|vida de mina|lom\b|financi|presupuesto)/i,
    reglas: [
      'Toda cifra de valor viene con su supuesto de precio al lado. Un VAN sin precio declarado no es un número, es una opinión.',
      'Distinguís valor in situ de valor: el primero no descuenta costo, recuperación ni tiempo, y citarlo como riqueza es la señal más clara de un proyecto mal presentado.',
      'Los costos los das por tonelada Y por onza. Uno solo de los dos siempre esconde algo.',
    ],
    herramientas: ['informe_pdf', 'calculo_mina', 'metales_spot', 'expediente_buscar', 'web_buscar'],
    vigila: 'Que no se presente un valor in situ como si fuera el valor del proyecto.',
  },
];

const POR_ID = new Map(ESPECIALISTAS.map((e) => [e.id, e]));

export const especialista = (id: EspecialistaId) => POR_ID.get(id);

const fold = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Cuando alguien lo pide por su nombre. Manda sobre la tabla de disparo. */
const A_MANO: Array<[RegExp, EspecialistaId]> = [
  [/\bgeolog[oa]/, 'geologo'],
  [/\bingenier[oa]? de minas|\bel de minas\b/, 'minas'],
  [/\bingenier[oa]? civil|\bel civil\b/, 'civil'],
  [/\bmetalurgist|\bmetalurgia\b/, 'metalurgista'],
  [/\bgeomatic|\bgis\b|\btopograf/, 'geomatica'],
  [/\bambientalista|\bespecialista ambiental|\bel ambiental\b/, 'ambiental'],
  [/\babogad|\bel legal\b|\bjuridic/, 'legal'],
  [/\beconomist|\bfinancier/, 'economista'],
];

/** Las formas con las que de verdad se pide a alguien, ya sin tildes. */
const PEDIDO_EXPLICITO = /\b(pon[a-z]*me|pong[a-z]+|pasame|que hable|que venga|llama|llame|activa|active|consulta|consulte|dame|quiero|trae|traeme|traiga|necesito)\b/;

/** A quién nombró el usuario al pedirlo («pásame al geólogo»), en el orden de la tabla. */
export function pedidosExplicitos(mensaje: string): EspecialistaId[] {
  const q = fold(mensaje);
  if (!PEDIDO_EXPLICITO.test(q)) return [];
  return A_MANO.filter(([re]) => re.test(q)).map(([, id]) => id);
}

/**
 * A quién le toca esta pregunta.
 *
 * Devuelve como mucho dos: con tres o más, el system se llena de reglas que se contradicen y la
 * respuesta sale a comité. Dos es lo que de verdad pasa en una consulta real (el geólogo y el
 * legal; el de minas y el economista).
 */
/** Palabras del oficio tan comunes que, solas, no deciden quién contesta. */
const GENERICAS = new Set(['planta', 'precio', 'mercado', 'area', 'área', 'mapa', 'capa', 'obra', 'agua', 'canal', 'banco', 'registro', 'permiso', 'costo', 'flujo', 'roca', 'estructura']);

export function convocar(mensaje: string, maximo = 2): Especialista[] {
  const q = fold(mensaje);
  if (!q.trim()) return [];

  // 1) Pedido explícito: si el usuario nombró a alguien, ese va sí o sí y va primero.
  const explicitos = pedidosExplicitos(mensaje);

  // 2) Por tema, ordenados por CUÁNTO texto de su campo aparece, no solo cuántas veces.
  //
  // Contar golpes empataba «licencia ambiental» con «planta», y el empate lo resolvía el orden de
  // la lista: la pregunta por la licencia ambiental de una planta se la llevaba el metalurgista.
  // Una frase del oficio larga y específica pesa más que una palabra suelta y común.
  // Las palabras que salen en cualquier conversación minera («planta», «precio», «área») pesan la
  // mitad: «capex de una planta» es del economista aunque «planta» sea más larga que «capex».
  const puntuados = ESPECIALISTAS.map((e) => {
    const trozos: string[] = q.match(new RegExp(e.disparo.source, 'gi')) || [];
    return { e, golpes: trozos.length, peso: trozos.reduce((n, t) => n + t.length * (GENERICAS.has(t.toLowerCase()) ? 0.5 : 1), 0) };
  })
    .filter((x) => x.golpes > 0)
    .sort((a, b) => b.peso - a.peso || b.golpes - a.golpes);

  const salida: Especialista[] = [];
  for (const id of explicitos) {
    const e = POR_ID.get(id);
    if (e && !salida.includes(e)) salida.push(e);
  }
  for (const { e } of puntuados) {
    if (salida.length >= maximo) break;
    if (!salida.includes(e)) salida.push(e);
  }
  return salida.slice(0, maximo);
}

/**
 * Lo mismo que convocar(), pero decidido por Laya en el nodo T4 cuando está disponible.
 *
 * Los que el usuario nombró siguen yendo primero (eso no se adivina, se obedece); el resto lo pone
 * Laya, que entiende la pregunta en vez de contar palabras: «Quebrada Seca» es un nombre de
 * concesión, no un tema ambiental. Si Laya no contesta a tiempo, la tabla de siempre.
 *
 * Cuando Laya no convoca a nadie, decide la tabla. Laya es muy precisa pero se queda corta en
 * preguntas técnicas breves o con jerga («¿qué es un skarn?», «¿qué EPSG uso para Honduras?»: P < 0,2
 * para todos). Medido en cuatro conjuntos que no se usaron para elegir la regla: validación 81 (+3
 * paneles bien, 0 mal), prueba apartada 260 (+6, −3: exacto 76,9 % → 78,1 %), casos difíciles 48
 * (+3, 0) y evals/electrum.jsonl (+4, 0). Lo que se pierde: tres consultas sin tema técnico que
 * reciben especialista por una palabra («Resumime el expediente de La Represa» → legal).
 *
 * Deja en la traza del turno de dónde salió el panel (paso `laya_panel`: verde si contestó Laya,
 * rojo con el motivo si no contestó y decidió la tabla). Si Laya no está configurado no anota nada.
 */
export async function decidirPanel(
  mensaje: string,
  maximo = 2
): Promise<{ panel: Especialista[]; fuente: 'laya' | 'tabla' | 'laya+tabla'; motivo: MotivoLaya; ms: number }> {
  const { decision: d, motivo, ms } = await consultarLaya(mensaje);
  let panel: Especialista[] = [];
  let fuente: 'laya' | 'tabla' | 'laya+tabla' = d ? 'laya' : 'tabla';
  if (d) {
    for (const id of [...pedidosExplicitos(mensaje), ...d.panel]) {
      const e = POR_ID.get(id as EspecialistaId);
      if (e && !panel.includes(e)) panel.push(e);
    }
    panel = panel.slice(0, maximo);
  }
  if (!panel.length) {
    panel = convocar(mensaje, maximo);
    if (d && panel.length) fuente = 'laya+tabla';
  }
  if (motivo !== 'sin configurar' && motivo !== 'sin texto') {
    const ids = panel.map((e) => e.id).join(', ') || 'nadie';
    const top = d
      ? Object.entries(d.p || {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([k, v]) => `${k} ${Number(v).toFixed(2)}`)
          .join(' · ')
      : '';
    trazaActual()?.paso({
      herramienta: 'laya_panel',
      ok: !!d,
      ms,
      resumen: !d
        ? `tabla → ${ids} (laya: ${motivo})`
        : fuente === 'laya+tabla'
          ? `laya → nadie, tabla → ${ids} (${top ? `${top}; ` : ''}modelo ${d.ms} ms)`
          : `laya → ${ids} (${top ? `${top}; ` : ''}modelo ${d.ms} ms)`,
    });
  }
  return { panel, fuente, motivo, ms };
}

/** Las herramientas que el panel convocado puede usar. Sin repetir. */
export function herramientasDe(panel: Especialista[]): string[] {
  const s = new Set<string>();
  for (const e of panel) e.herramientas.forEach((h) => s.add(h));
  return [...s];
}

/**
 * El trozo de system que corresponde al panel convocado.
 *
 * Solo las reglas de quienes están activos: cargar las ocho especialidades siempre es volver al
 * prompt de seiscientas líneas que estábamos evitando.
 */
export function promptPanel(panel: Especialista[]): string {
  if (!panel.length) {
    return [
      'PANEL: ninguna especialidad en concreto. Contestá como Dr Electrum, de forma general, y si la',
      'pregunta se vuelve técnica ofrecé traer al especialista que corresponda.',
    ].join('\n');
  }
  const partes = panel.map((e) =>
    [
      `— ${e.nombre.toUpperCase()} (${e.campo})`,
      ...e.reglas.map((r) => `  · ${r}`),
      `  · Vigilás esto: ${e.vigila}`,
    ].join('\n')
  );
  return [
    `PANEL CONVOCADO: ${panel.map((e) => e.nombre).join(' y ')}.`,
    'Hablás vos, Dr Electrum, con el criterio de quien o quienes están abajo. Si la respuesta es',
    'claramente de una especialidad, decilo al pasar («como geólogo, …»), sin ceremonia.',
    'Si te preguntan algo que NO es de este panel, lo decís y ofrecés traer a quien corresponda:',
    'contestar de lo que no es tuyo es el error que un cliente técnico no perdona.',
    '',
    ...partes,
  ].join('\n');
}
