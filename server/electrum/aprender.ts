/**
 * APRENDER — lo que se sube queda sabido.
 *
 * «Listo para aprender todo luego de subir la información»: esto es esa pieza. Un archivo entra por
 * un lado y sale convertido en algo que Dr Electrum puede consultar y citar.
 *
 * Tres caminos, según lo que sea:
 *
 *  - **Geográfico** (.shp, .zip, .kml, .kmz, .geojson, .csv) → motor GIS → PostGIS. Las concesiones
 *    quedan buscables, medibles y cruzables, y el mapa puede volar a ellas.
 *  - **Documento** (.pdf, .docx, .doc, .rtf, .pptx, .xlsx, .txt, .md) → texto → troceado **con su
 *    página** (la diapositiva en un .pptx, la hoja en un .xlsx) → índice de texto completo.
 *    La página no es un adorno: una cita que no se puede ir a comprobar no es una cita.
 *  - **Imagen** (.jpg, .png, .heic) → modelo de visión → el mismo índice. Es la foto que se saca en
 *    la oficina de INHGEOMIN o parado en el lindero: un plano con sellos, una resolución en papel.
 *    Sale por la misma puerta que un PDF a propósito, con su huella y su dedup, porque lo que
 *    importa no es cómo entró sino que después se pueda citar.
 *
 * El troceado es lo que más decide la calidad de las respuestas después. Aquí se corta por párrafos
 * y se respeta el límite de página, con un solapamiento pequeño para que una frase partida entre dos
 * trozos siga encontrándose. Cortar a ciegas cada N caracteres parte tablas y números por la mitad,
 * que en un informe minero es exactamente lo que no se puede partir.
 */
import { carteraDesdeCapa } from './cartera';
import { ES_CAPA_CATASTRO } from './ordenar';
import { leerConDocling } from '../../lib/cognitivo/documentos';
import { clasificarDocumento } from './documentos-laya';
import { indexarPendientes } from './vectores';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import { extraerPdf } from '../../lib/leer-pdf';
import { paginasDeDoc, paginasDePptx, paginasDeRtf, paginasDeXlsx, type PaginaLeida } from '../../lib/leer-oficina';
import { cuerpo, textoPorPaginas } from '../../lib/leer-pdf-pdfjs';
import { consulta, enTransaccion, guardarCapa, hayBase, recalcularTraslapes, traslapesDeCapa } from './db';

const nf = (n: number, d = 2) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);

/**
 * Qué ojo leyó la foto, dicho sin la dirección de la máquina.
 *
 * `verImagen` devuelve en `via` la URL del nodo de visión —«http://10.0.3.7:7860/ver»— y eso iba
 * tal cual al aviso que ve quien subió la foto, llave de demostración incluida. Para creerle a
 * una transcripción basta saber si fue el ojo propio o el de reserva; la IP no le sirve a nadie.
 */
export function ojoQueLeyo(via: string): string {
  const v = String(via || '');
  if (/gemini/i.test(v)) return 'el ojo de reserva (Gemini)';
  if (/^https?:\/\//i.test(v) || /ojo/i.test(v)) return 'el ojo del nodo de visión';
  return 'el ojo de visión';
}
import { ingerir, resumenCapa, resumenTraslapes, revisarZip, type Aviso } from './gis';
import { verImagen, vistaFallida } from '../../lib/vision';
import { asegurarOrganizacion, organizacionParaGuardar, sqlDocumentoVisible } from './organizacion';

export type Aprendido = {
  clase: 'catastro' | 'documento' | 'nada';
  /** Lo que Dr Electrum dice en voz alta al terminar. */
  dicho: string;
  avisos: Aviso[];
  /** Para la interfaz: qué pintar, qué abrir. */
  ui?: Record<string, unknown>;
};

/** Lo que se sabe de un documento sin escribir nada: sirve para el ensayo previo de una carga grande. */
export type Inspeccion = {
  veredicto: 'indexable' | 'escaneo' | 'corto';
  paginas: number;
  fragmentos: number;
  caracteres: number;
  dicho: string;
};

const ES_GEO = /\.(zip|shp|kml|kmz|geojson|json|csv|gpkg|dxf)$/i;
const ES_DOC = /\.(pdf|docx|doc|rtf|pptx|xlsx|xlsm|txt|md|markdown)$/i;
/** Formatos de oficina que ya vienen con sus páginas (diapositivas, hojas). */
const OFICINA: Array<[RegExp, (d: Buffer) => Promise<PaginaLeida[]> | PaginaLeida[], string]> = [
  [/\.doc$/i, paginasDeDoc, '.doc'],
  [/\.rtf$/i, paginasDeRtf, '.rtf'],
  [/\.pptx$/i, paginasDePptx, '.pptx'],
  [/\.xls[xm]$/i, (d) => paginasDeXlsx(d), '.xlsx'],
];
const ES_IMAGEN = /\.(jpe?g|png|webp|heic|heif|bmp|tiff?)$/i;

/** Tipos que un navegador o un teléfono mandan para una foto, por si el nombre no lleva extensión. */
const MIME_IMAGEN: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

/**
 * Lo que se le pide al modelo de visión ante la foto de un papel minero.
 *
 * Está escrito para un expediente hondureño, no para «describe la imagen». La diferencia entre un
 * pie de foto y algo que sirve en el cerebro es que lo segundo **transcribe** —número de
 * resolución, expediente, fechas, titular, coordenadas, lo que diga el sello— en vez de resumir.
 * Un resumen no se puede citar y no se puede buscar; una transcripción sí.
 *
 * Y la última línea es la que más pesa: lo que no se lee se dice que no se lee. Un número de
 * expediente inventado en un registro oficial es peor que una foto sin leer.
 */
const OJO_MINERO = [
  'Es la foto de un documento minero de Honduras: un plano, una resolución, un sello, una ficha de campo o una tabla.',
  'TRANSCRIBÍ lo que se lee, no lo resumas. En este orden y solo lo que aparezca:',
  '1) Título o encabezado, palabra por palabra.',
  '2) Números de resolución, de expediente y de acuerdo, con su formato exacto.',
  '3) Fechas, tal como están escritas.',
  '4) Nombres de concesión, titulares, empresas y personas.',
  '5) Coordenadas, vértices, rumbos, distancias y hectáreas, con sus unidades y su datum si aparece.',
  '6) El texto de CADA sello, firma o timbre, incluso si está girado o encima de otra cosa.',
  '7) Cualquier tabla, fila por fila.',
  'Después, una línea que diga qué clase de documento es.',
  'Lo que esté borroso, cortado o ilegible lo decís así —«ilegible»— y no lo completás. No adivines un número ni un nombre: en un registro oficial un dato inventado es peor que un dato que falta.',
].join('\n');

/** Trozos de ~900 caracteres cortados por párrafo, sin cruzar de página. */
const OBJETIVO = 900;
const SOLAPE = 120;

export function trocear(paginas: Array<{ pagina: number; texto: string }>): Array<{ pagina: number; orden: number; texto: string }> {
  const salida: Array<{ pagina: number; orden: number; texto: string }> = [];
  let orden = 0;

  for (const p of paginas) {
    const parrafos = String(p.texto || '')
      .split(/\n\s*\n+/)
      .map((x) => x.replace(/[ \t]+/g, ' ').trim())
      .filter(Boolean);

    let buffer = '';
    const soltar = () => {
      const t = buffer.trim();
      if (t.length >= 40) salida.push({ pagina: p.pagina, orden: orden++, texto: t });
      // Un poco de cola para que una frase partida entre dos trozos siga encontrándose.
      buffer = t.length > SOLAPE ? t.slice(-SOLAPE) : '';
    };

    for (const parrafo of parrafos) {
      // Una tabla leída por Docling («[TABLA]» + una fila por línea) se parte POR FILAS, y cada trozo
      // repite el encabezado: una fila de «DDH-07 | 3,2 | 12» sin sus columnas no dice nada. Antes
      // una tabla de 200 filas quedaba en un solo trozo de 7 000 caracteres.
      if (parrafo.startsWith('[TABLA]') && parrafo.length > OBJETIVO) {
        // Lo que venía antes se suelta si ya es un trozo; si es corto (un título), sigue esperando.
        if (buffer.trim().length >= 40) soltar();
        const [, encabezado = '', ...filas] = parrafo.split('\n');
        let trozo = '';
        for (const fila of filas) {
          if (trozo && trozo.length + fila.length > OBJETIVO) {
            salida.push({ pagina: p.pagina, orden: orden++, texto: `[TABLA] ${encabezado}\n${trozo}` });
            trozo = '';
          }
          trozo += (trozo ? '\n' : '') + fila.slice(0, OBJETIVO);
        }
        if (trozo) salida.push({ pagina: p.pagina, orden: orden++, texto: `[TABLA] ${encabezado}\n${trozo}` });
        continue;
      }
      // Un párrafo enorme se parte por frases, no a ciegas; y una «frase» sin puntos (una lista
      // pegada, un OCR sin puntuación) se corta a tope fijo para no dejar un trozo gigante.
      if (parrafo.length > OBJETIVO * 2) {
        for (const frase of parrafo.split(/(?<=[.;:])\s+/)) {
          const paso = OBJETIVO - SOLAPE;
          for (let i = 0; i < frase.length; i += paso) {
            const pedazo = frase.slice(i, i + paso);
            if (buffer.length + pedazo.length > OBJETIVO) soltar();
            buffer += (buffer ? ' ' : '') + pedazo;
          }
        }
        continue;
      }
      if (buffer.length + parrafo.length > OBJETIVO) soltar();
      buffer += (buffer ? '\n' : '') + parrafo;
    }
    if (buffer.trim().length >= 40) salida.push({ pagina: p.pagina, orden: orden++, texto: buffer.trim() });
  }
  return salida;
}

/**
 * Lo que llega de un PDF, página por página.
 * `extraerPdf` devuelve el texto entero; se reparte por saltos de página cuando los trae, y si no,
 * queda como una sola página y se dice, en vez de inventar números de página que no existen.
 */
function paginasDePdf(texto: string, paginasDeclaradas: number): Array<{ pagina: number; texto: string }> {
  const partes = texto.split(/\f/);
  if (partes.length > 1) return partes.map((t, i) => ({ pagina: i + 1, texto: t }));
  if (paginasDeclaradas > 1) {
    // Sin saltos de página, se reparte proporcionalmente: aproximado, pero mejor que nada y se avisa.
    const porPagina = Math.ceil(texto.length / paginasDeclaradas);
    const out: Array<{ pagina: number; texto: string }> = [];
    for (let i = 0; i < paginasDeclaradas; i++) out.push({ pagina: i + 1, texto: texto.slice(i * porPagina, (i + 1) * porPagina) });
    return out.filter((p) => p.texto.trim());
  }
  return [{ pagina: 1, texto }];
}

/**
 * Hasta el 27-09-2026 los PDF se indexaban con el tope de 8 000 caracteres del lector de la
 * conversación: 40 de 59 quedaron cortados. Si vuelve a llegar uno de esos, se relee y se
 * reemplazan sus fragmentos en el mismo documento. Null si el que había estaba bien.
 */
async function repararSiTruncado(id: number, paginasViejas: number | null, nombre: string, datos: Buffer) {
  const [h] = await consulta<{ car: number }>(`SELECT coalesce(sum(length(texto)), 0)::int AS car FROM fragmento WHERE documento_id = $1`, [id]);
  const antes = Number(h?.car || 0);
  if (!((paginasViejas || 0) > 3 && antes <= 8200)) return null;
  const leido = await leerDocumento(nombre, datos);
  if (leido.ok === false) return null;
  const ahora = leido.trozos.reduce((n, t) => n + t.texto.length, 0);
  if (ahora < antes * 1.3) return null;
  await reemplazarFragmentos(id, leido.paginas.length, leido.trozos, nombre);
  return {
    clase: 'documento' as const,
    dicho: `«${nombre}» ya estaba, pero cortado (${antes.toLocaleString('es-ES')} caracteres). Lo volví a leer entero: ${leido.paginas.length} páginas, ${leido.trozos.length} fragmentos. Ya lo puedo citar completo.`,
    avisos: leido.avisos,
    ui: { accion: 'documento', documento_id: id, nombre, paginas: leido.paginas.length, fragmentos: leido.trozos.length, reparado: true },
  };
}

/** Cambia los fragmentos de un documento por los de una lectura nueva, todo o nada. */
async function reemplazarFragmentos(id: number, paginas: number, trozos: Array<{ pagina: number; orden: number; texto: string }>, nombre: string) {
  await enTransaccion(async (q) => {
    await q(`DELETE FROM fragmento WHERE documento_id = $1`, [id]);
    for (let i = 0; i < trozos.length; i += 200) {
      const tramo = trozos.slice(i, i + 200);
      const args: unknown[] = [];
      const marcas = tramo.map((t, j) => {
        args.push(id, t.pagina, t.orden, t.texto);
        return `($${j * 4 + 1},$${j * 4 + 2},$${j * 4 + 3},$${j * 4 + 4})`;
      });
      await q(`INSERT INTO fragmento (documento_id, pagina, orden, texto) VALUES ${marcas.join(',')}`, args);
    }
    await q(
      `UPDATE documento SET paginas = $2, meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('fragmentos', $3::int) WHERE id = $1`,
      [id, paginas, trozos.length]
    );
  });
  void indexarPendientes({ documentoId: id }).catch((e) => console.error('[electrum] no pude vectorizar', nombre, String(e?.message || e).slice(0, 120)));
}

/**
 * Volver a leer un documento que ya está, desde su original, con los lectores de hoy.
 *
 * Es lo que hace el botón «Releer» del panel de infraestructura: cuando mejora un lector (el PDF
 * entero con pdf.js, el .doc de Word 97, el OCR), lo que se cargó antes se pone al día sin
 * borrarlo ni duplicarlo. Si la lectura nueva sale PEOR que la que hay —menos texto—, no se toca:
 * releer nunca puede dejar a Dr Electrum sabiendo menos que antes.
 */
export async function releerDocumento(
  id: number,
  nombre: string,
  datos: Buffer
): Promise<{ ok: boolean; dicho: string; antes: number; ahora: number; paginas?: number; fragmentos?: number }> {
  const [h] = await consulta<{ car: number }>(`SELECT coalesce(sum(length(texto)), 0)::int AS car FROM fragmento WHERE documento_id = $1`, [id]);
  const antes = Number(h?.car || 0);
  const leido = await leerDocumento(nombre, datos);
  if (leido.ok === false) return { ok: false, dicho: leido.dicho, antes, ahora: 0 };
  const ahora = leido.trozos.reduce((n, t) => n + t.texto.length, 0);
  if (ahora < antes) {
    return { ok: false, dicho: `La lectura nueva saca menos texto (${ahora.toLocaleString('es-ES')} caracteres) que la que ya hay (${antes.toLocaleString('es-ES')}): lo dejé como estaba.`, antes, ahora };
  }
  await reemplazarFragmentos(id, leido.paginas.length, leido.trozos, nombre);
  return {
    ok: true,
    dicho: ahora === antes ? `Releído: igual que antes (${leido.paginas.length} páginas).` : `Releído: de ${antes.toLocaleString('es-ES')} a ${ahora.toLocaleString('es-ES')} caracteres, ${leido.paginas.length} páginas, ${leido.trozos.length} fragmentos.`,
    antes,
    ahora,
    paginas: leido.paginas.length,
    fragmentos: leido.trozos.length,
  };
}

/**
 * Cargar a un documento que YA está el texto de otra lectura: el OCR de un escaneo que quedó «sin
 * texto», o uno mejor (páginas giradas enderezadas antes de leerlas). El documento conserva su
 * nombre, su carpeta y su original; cambian solo sus fragmentos. Así un escaneo no queda duplicado
 * en «el PDF sin texto» más «el .txt del OCR», y una reimportación no lo vuelve a traer (su original
 * sigue anotado).
 *
 * `nombre` es el del archivo que trae el texto: decide el lector (.txt con \f entre páginas, .pdf
 * con capa de texto, .docx…). Si el texto nuevo trae menos de la mitad que el que ya hay, no se
 * toca salvo `forzar`: probablemente es otro archivo o una lectura peor.
 */
export async function cargarTexto(
  id: number,
  nombre: string,
  datos: Buffer,
  opts: { forzar?: boolean; por?: string | null } = {}
): Promise<{ ok: boolean; dicho: string; antes: number; ahora: number; paginas?: number; fragmentos?: number }> {
  const [d] = await consulta<{ nombre: string; car: number }>(
    `SELECT d.nombre, coalesce((SELECT sum(length(f.texto)) FROM fragmento f WHERE f.documento_id = d.id), 0)::int AS car FROM documento d WHERE d.id = $1`,
    [id]
  );
  if (!d) return { ok: false, dicho: 'Ese documento ya no existe.', antes: 0, ahora: 0 };
  const antes = Number(d.car || 0);
  const leido = await leerDocumento(nombre, datos);
  if (leido.ok === false) return { ok: false, dicho: leido.dicho, antes, ahora: 0 };
  const ahora = leido.trozos.reduce((n, t) => n + t.texto.length, 0);
  if (!ahora) return { ok: false, dicho: 'El archivo no trae texto que se pueda indexar.', antes, ahora };
  if (!opts.forzar && antes > 0 && ahora < antes * 0.5) {
    return {
      ok: false,
      dicho: `El texto nuevo trae ${ahora.toLocaleString('es-ES')} caracteres, menos de la mitad de los ${antes.toLocaleString('es-ES')} que ya tiene: parece otro archivo o una lectura peor. Si es a propósito, cargalo con «forzar».`,
      antes,
      ahora,
    };
  }
  await reemplazarFragmentos(id, leido.paginas.length, leido.trozos, d.nombre);
  // Deja de estar pendiente de OCR, y queda dicho de dónde salió el texto.
  await consulta(
    `UPDATE documento SET meta = (meta - 'pendiente') || jsonb_build_object('texto_de', $2::text, 'texto_cargado', now()::text, 'texto_por', $3::text) WHERE id = $1`,
    [id, nombre.slice(0, 200), opts.por || null]
  );
  return {
    ok: true,
    dicho: `Texto cargado en «${d.nombre}»: de ${antes.toLocaleString('es-ES')} a ${ahora.toLocaleString('es-ES')} caracteres, ${leido.paginas.length} páginas, ${leido.trozos.length} fragmentos.`,
    antes,
    ahora,
    paginas: leido.paginas.length,
    fragmentos: leido.trozos.length,
  };
}

/** Huella del contenido, no del nombre: el mismo expediente llega con veinte nombres distintos. */
export function huellaDe(datos: Buffer): string {
  return crypto.createHash('md5').update(datos).digest('hex');
}

type Leido =
  | { ok: true; texto: string; paginas: Array<{ pagina: number; texto: string }>; trozos: ReturnType<typeof trocear>; avisos: Aviso[] }
  | { ok: false; motivo: 'escaneo' | 'corto'; dicho: string; avisos: Aviso[]; paginas?: number };

/**
 * Lee un documento hasta dejarlo troceado, sin tocar la base.
 *
 * Está separado de `aprender` para que el ensayo previo (`--seco`) pase por exactamente el mismo
 * código que la carga real. Antes el ensayo se limitaba a decir el tamaño en KB —«se indexaría como
 * documento»— y eso, en una carga de mil expedientes, esconde justo lo que hay que saber antes de
 * empezar: cuántos son escaneos sin texto y no van a entrar. Un ensayo que no puede contradecir a la
 * carga real no sirve para decidir nada.
 */
/**
 * Saca el texto de un .docx.
 *
 * Un .docx es un zip con `word/document.xml` dentro, y el texto vive en las etiquetas `w:t`. Se
 * extrae a mano en vez de traer una biblioteca entera: son veinte líneas y ahorra una dependencia
 * con su propia superficie de fallos para leer, al final, un XML.
 *
 * El párrafo importa: sin respetar `w:p`, un formulario de veinte campos sale como una sola línea
 * corrida y el troceado —que corta por párrafos— se queda sin por dónde cortar. Los saltos de línea
 * (`w:br`) y las celdas de tabla también separan, por lo mismo.
 */
async function textoDeDocx(datos: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(datos);
  revisarZip(zip);
  const doc = zip.file('word/document.xml');
  if (!doc) return '';
  const xml = await doc.async('text');
  return xml
    .replace(/<w:p[ >]/g, '\n<w:p ')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<[^>]+>/g, (t) => (t.startsWith('<w:t') || t.startsWith('</w:t') ? '' : ' '))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * ¿Lo que se extrajo parece prosa, o es ruido con forma de texto?
 *
 * Un PDF puede tener capa de texto y aun así no poder leerse. Dos casos aparecieron en las leyes
 * mineras de Honduras:
 *
 *  · **Letras sueltas.** El extractor devuelve «e x p l o t a c i ó n»: se lee con el ojo, pero
 *    buscar «explotación» no encuentra nada, porque en el índice no existe esa palabra. Tres de
 *    los documentos más importantes —la Ley General de Minería, su Reglamento y la Ley de
 *    Procedimiento Administrativo— salen así, al 80 % de fichas de un solo carácter.
 *  · **Codificación propia.** La fuente no trae tabla a Unicode y sale desplazado:
 *    «IUDJPHQWDGRV» por «FRAGMENTADOS».
 *
 * Reconstruirlo exigiría adivinar dónde acaba cada palabra, y adivinar dentro de un texto legal es
 * justo lo que no se puede hacer: una cita inventada de la ley minera es peor que no tener la ley.
 * Se detecta, se dice, y se manda a reconocimiento óptico como a un escaneo cualquiera.
 *
 * La medida es la proporción de palabras funcionales —de, la, el, en, que…—. La prosa española
 * ronda el 20 %; por debajo del 8 % no es prosa. Se exige un mínimo de palabras para no juzgar un
 * formulario de tres líneas, que legítimamente no tiene ninguna.
 */
const COMUNES_ES = /(^|[^\p{L}])(de|la|el|en|que|los|las|por|con|para|del|se|un|una|al|es|no|su|sus)($|[^\p{L}])/giu;
/**
 * Lo mismo en inglés. Buena parte de lo técnico que llega está en inglés —informes 43-101, los
 * estudios de JICA— y sin esto un informe bien leído se rechazaba como ilegible: su proporción de
 * palabras funcionales españolas no llega al 8 %. Vale la que dé más de las dos.
 */
const COMUNES_EN = /(^|[^\p{L}])(the|of|and|in|to|is|are|was|were|with|for|by|on|as|at|from|which|this|that|an|be)($|[^\p{L}])/giu;

export function pareceProsa(texto: string): boolean {
  const palabras = texto.match(/\p{L}{2,}/gu) || [];
  if (palabras.length < 150) return true; // demasiado corto para juzgarlo
  const es = (texto.match(COMUNES_ES) || []).length;
  const en = (texto.match(COMUNES_EN) || []).length;
  return Math.max(es, en) / palabras.length >= 0.08;
}

/**
 * El PDF que no se pudo leer como texto, por reconocimiento óptico (Docling en la T4). Null si no
 * hay servicio o no salió nada: quien llama lo rechaza diciendo por qué, como siempre.
 */
async function conOcr(nombre: string, datos: Buffer): Promise<Leido | null> {
  const r = await leerConDocling(nombre, datos);
  if (!r) return null;
  const trozos = trocear(r.paginas);
  if (!trozos.length) return null;
  return {
    ok: true,
    texto: r.paginas.map((p) => p.texto).join('\n\n'),
    paginas: r.paginas,
    trozos,
    avisos: [{ nivel: 'ojo', texto: 'Leído con reconocimiento óptico (Docling). Las cifras de un escaneo pueden tener errores de lectura: compruébalas contra el original antes de citarlas en un informe.' }],
  };
}

async function leerDocumento(nombre: string, datos: Buffer): Promise<Leido> {
  const avisos: Aviso[] = [];
  let texto = '';
  let nPaginas = 1;

  // Por la extensión, no por un mime inventado: pasarle 'application/pdf' a esPdfNombre hacía
  // que TODO pareciera PDF, y un .txt terminaba rechazado como «escaneo sin texto».
  if (/\.pdf$/i.test(nombre)) {
    /*
     * Primero pdf.js: trae las páginas reales (las citas salen con su número de verdad) y lee lo que
     * el lector propio no entiende. El lector propio queda de respaldo, SIN tope de texto: con el tope
     * de 8 000 caracteres que tiene para la conversación, todo informe de más de tres páginas se
     * indexaba cortado (el SIR 2010-5090-I del USGS quedó en 8 000 de 330 000 caracteres).
     */
    /*
     * Y si pdf.js abrió el PDF y no encontró NI UNA letra, es un escaneo: el lector propio no se
     * corre. Con un escaneo de 57 páginas tardaba 82 s en decodificar las imágenes y terminaba
     * leyendo el archivo entero como si fuera texto (1,3 millones de caracteres de basura); en la
     * máquina de un trabajo de importación eran minutos por archivo, y una carpeta de estudios
     * escaneados no terminaba nunca.
     */
    const pdfjs = await textoPorPaginas(datos);
    const totalPdfjs = pdfjs ? pdfjs.paginas.reduce((n, p) => n + cuerpo(p), 0) : 0;
    if (pdfjs && totalPdfjs === 0) {
      nPaginas = Math.max(1, pdfjs.total);
    } else {
      const leido = extraerPdf(datos, { maxTexto: Infinity });
      texto = leido.texto || '';
      nPaginas = Math.max(1, Number((leido as any).paginas) || 1);
      if (pdfjs && totalPdfjs >= 40 && totalPdfjs >= cuerpo(texto) * 0.8) {
        texto = pdfjs.paginas.join('\f');
        nPaginas = Math.max(1, pdfjs.total);
      }
    }
    if (!texto.trim()) {
      const ocr = await conOcr(nombre, datos);
      if (ocr) return ocr;
      return {
        ok: false,
        motivo: 'escaneo',
        dicho: 'Ese PDF no trae texto: es un escaneo de imágenes. Para poder citarlo necesito una versión con texto, o pasarlo por reconocimiento óptico.',
        avisos: [{ nivel: 'error', texto: 'PDF sin capa de texto' }],
        paginas: nPaginas,
      };
    }
  } else if (/\.docx$/i.test(nombre)) {
    texto = await textoDeDocx(datos);
    if (!texto.trim()) {
      return {
        ok: false,
        motivo: 'corto',
        dicho: 'Ese .docx no tiene texto dentro: puede ser solo imágenes o un archivo en blanco.',
        avisos: [{ nivel: 'error', texto: 'docx sin texto' }],
      };
    }
  } else if (OFICINA.some(([re]) => re.test(nombre))) {
    const [, leer, formato] = OFICINA.find(([re]) => re.test(nombre))!;
    let paginasOficina: PaginaLeida[] = [];
    try {
      paginasOficina = await leer(datos);
    } catch (e: any) {
      return {
        ok: false,
        motivo: 'corto',
        dicho: `No pude abrir ese ${formato}: ${String(e?.message || e).slice(0, 120)}.`,
        avisos: [{ nivel: 'error', texto: `${formato} ilegible` }],
      };
    }
    if (!paginasOficina.some((p) => p.texto.trim())) {
      return {
        ok: false,
        motivo: 'corto',
        dicho: `Ese ${formato} no tiene texto dentro: puede ser solo imágenes o un archivo en blanco.`,
        avisos: [{ nivel: 'error', texto: `${formato} sin texto` }],
      };
    }
    // Ya vienen con su estructura (tablas, diapositivas): no pasan por el juez de prosa, que es para
    // capas de texto de PDF mal codificadas. Una hoja de coordenadas no tiene «de, la, el» y es buena.
    const paginas = paginasOficina.map((p, i) => ({ pagina: i + 1, texto: p.texto }));
    const trozos = trocear(paginas);
    if (!trozos.length) return { ok: false, motivo: 'corto', dicho: 'El archivo tiene texto pero demasiado corto para indexarlo.', avisos };
    return { ok: true, texto: paginas.map((p) => p.texto).join('\n\n'), paginas, trozos, avisos };
  } else {
    texto = datos.toString('utf8');
  }

  if (!pareceProsa(texto)) {
    if (/\.pdf$/i.test(nombre)) {
      const ocr = await conOcr(nombre, datos);
      if (ocr) return ocr;
    }
    return {
      ok: false,
      motivo: 'escaneo',
      dicho:
        'Ese archivo tiene capa de texto, pero lo que sale no se puede usar: las letras vienen ' +
        'sueltas o con una codificación propia, así que buscar una palabra dentro no encontraría ' +
        'nada. Hay que pasarlo por reconocimiento óptico, igual que un escaneo.',
      avisos: [{ nivel: 'error', texto: 'texto ilegible: letras sueltas o codificación propia' }],
    };
  }

  const paginas = paginasDePdf(texto, nPaginas);
  if (paginas.length === 1 && nPaginas > 1) {
    avisos.push({ nivel: 'ojo', texto: 'El PDF no trae marcas de página, así que las páginas de las citas son aproximadas.' });
  }

  const trozos = trocear(paginas);
  if (!trozos.length) {
    return { ok: false, motivo: 'corto', dicho: 'El archivo tiene texto pero demasiado corto para indexarlo.', avisos };
  }
  return { ok: true, texto, paginas, trozos, avisos };
}

/** Qué pasaría con este documento si se cargara, sin cargarlo. */
export async function inspeccionar(nombre: string, datos: Buffer): Promise<Inspeccion> {
  const leido = await leerDocumento(nombre, datos);
  if (leido.ok === false) return { veredicto: leido.motivo, paginas: 0, fragmentos: 0, caracteres: 0, dicho: leido.dicho };
  return {
    veredicto: 'indexable',
    paginas: leido.paginas.length,
    fragmentos: leido.trozos.length,
    caracteres: leido.trozos.reduce((n, t) => n + t.texto.length, 0),
    dicho: `${leido.paginas.length} ${leido.paginas.length === 1 ? 'página' : 'páginas'}, ${leido.trozos.length} fragmentos`,
  };
}

/**
 * Aprende un archivo. Nunca lanza: los problemas salen como avisos, porque quien sube un archivo
 * necesita saber qué pasó con él.
 */
export async function aprender(
  nombreArchivo: string,
  datos: Buffer,
  opts: {
    subidoPor?: string;
    concesionId?: number;
    tipoDoc?: string;
    sinTraslapes?: boolean;
    mime?: string;
    /** Carpeta del panel de infraestructura («INDEXSA 2026/Minas de Oro»). */
    carpeta?: string | null;
    /** Dónde quedó el original («s3://cubo/clave»): con él se puede volver a leer. */
    archivo?: string | null;
  } = {}
): Promise<Aprendido> {
  const nombre = String(nombreArchivo || 'archivo');
  const carpeta = opts.carpeta ? String(opts.carpeta) : null;
  const archivo = opts.archivo ? String(opts.archivo) : null;

  if (!hayBase()) {
    return {
      clase: 'nada',
      dicho: 'Leí el archivo pero el catastro no está conectado, así que no puedo guardarlo todavía.',
      avisos: [{ nivel: 'error', texto: 'sin ELECTRUM_DB_URL' }],
    };
  }

  // ---------------------------------------------------------------- geográfico
  if (ES_GEO.test(nombre)) {
    const { capa, avisos } = await ingerir(nombre, datos);
    if (!capa) return { clase: 'nada', dicho: avisos.map((a) => a.texto).join(' ') || 'No pude leer ese archivo.', avisos };

    const guardado = await guardarCapa(capa, { subidoPor: opts.subidoPor, avisos, archivo: archivo || undefined });
    if (carpeta && guardado.capaId) await consulta(`UPDATE capa SET carpeta = $2 WHERE id = $1`, [guardado.capaId, carpeta]).catch(() => {});

    /*
     * Una cartera que llegó en otro datum (las zonas de una empresa en NAD27 cuando el catastro se
     * cargó en WGS84): el polígono es el mismo pero la huella no, y entraba como concesiones nuevas,
     * duplicando el catastro. Si la capa no se llama como una capa del catastro y casi todo lo suyo
     * cae dentro de concesiones que ya estaban, es una cartera.
     */
    // La misma regla de nombres de capa del catastro que usa ordenar (revisión de Codex en #78):
    // «SOLICITUD PARA EXPLORAR» o «ARTESANAL … DELIMITADA» son catastro, nunca una cartera.
    if (guardado.concesiones >= 2 && guardado.capaId && !ES_CAPA_CATASTRO.test(capa.nombre)) {
      const [x] = await consulta<{ dentro: number }>(
        `SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM concesion o WHERE o.capa_id <> c.capa_id AND o.geom && c.geom
                  AND ST_Intersects(o.geom, c.geom) AND ST_Area(ST_Intersection(o.geom, c.geom)) >= 0.8 * ST_Area(c.geom)))::int AS dentro
           FROM concesion c WHERE c.capa_id = $1`,
        [guardado.capaId]
      ).catch(() => [{ dentro: 0 }]);
      if (x && x.dentro >= 0.8 * guardado.concesiones) {
        const c = await carteraDesdeCapa(guardado.capaId, { quien: opts.subidoPor || null }).catch(() => null);
        if (c?.ok && c.enlazadas === guardado.concesiones) {
          if (!opts.sinTraslapes) await recalcularTraslapes();
          return {
            clase: 'catastro',
            dicho: `«${capa.nombre}» es una cartera: sus ${c.total} polígonos son concesiones que ya están en el catastro (en otro datum o con otra digitalización), así que no las dupliqué. ${c.dicho} Pedime «analizá la cartera» para ver restricciones y prioridades.`,
            avisos,
            ui: { accion: 'capa', capa_id: null, concesiones: 0, repetidas: c.total, traslapes: 0, cartera: { nombre: capa.nombre, concesiones: c.enlazadas } },
          };
        }
      }
    }

    /*
     * Los traslapes se recalculan cruzando TODAS las concesiones contra todas. Hacerlo después de
     * cada archivo está bien cuando alguien sube uno por la web; en una carga de cien capas es
     * cuadrático y no termina: medido en una carga real, a la séptima capa y cuatro mil concesiones
     * ya tardaba más de un minuto por archivo, y quedaban noventa y siete. El cargador lo pide una
     * sola vez al final, cuando ya está todo dentro; el resultado es idéntico y el coste, uno.
     */
    const traslapesNuevos = opts.sinTraslapes ? 0 : await recalcularTraslapes();

    // Un archivo entero repetido merece una frase clara, no el resumen de siempre seguido de un
    // «las salté». Quien vuelve a subir algo casi siempre es porque duda de si lo subió.
    const nadaNuevo = !guardado.concesiones && !guardado.entidades && guardado.repetidas > 0;
    if (nadaNuevo && guardado.cartera) {
      const n = guardado.cartera.concesiones;
      return {
        clase: 'catastro',
        dicho: `«${guardado.cartera.nombre}» es una cartera: sus ${n} ${n === 1 ? 'concesión ya está' : 'concesiones ya están'} en el catastro con el mismo polígono, así que no dupliqué nada. La registré como cartera; pedime «analizá la cartera ${guardado.cartera.nombre}» para ver restricciones, traslapes y prioridades de cada una.`,
        avisos,
        ui: { accion: 'capa', capa_id: null, concesiones: 0, repetidas: guardado.repetidas, traslapes: 0, cartera: guardado.cartera },
      };
    }
    if (nadaNuevo) {
      return {
        clase: 'catastro',
        dicho: `Ese archivo ya estaba cargado: las ${guardado.repetidas} geometrías son las mismas que ya tengo, así que no metí nada y no dupliqué la capa.`,
        avisos,
        ui: { accion: 'capa', capa_id: null, concesiones: 0, repetidas: guardado.repetidas, traslapes: 0 },
      };
    }

    const partes = [resumenCapa(capa, avisos)];
    if (guardado.concesiones) {
      partes.push(
        guardado.concesiones === 1
          ? 'Quedó 1 concesión en el catastro, ya buscable y medible.'
          : `Quedaron ${guardado.concesiones} en el catastro, ya buscables y medibles.`
      );
    }
    if (guardado.repetidas) {
      partes.push(
        `${guardado.repetidas} ${guardado.repetidas === 1 ? 'ya estaba cargada y la salté' : 'ya estaban cargadas y las salté'}: la misma geometría no entra dos veces.`
      );
    }
    if (guardado.cartera) {
      partes.push(`Las que ya estaban forman la cartera «${guardado.cartera.nombre}» (${guardado.cartera.concesiones}): se puede analizar entera.`);
    }
    if (guardado.reparadas) {
      const n = guardado.reparadas;
      const aviso = `${n} ${n === 1 ? 'polígono venía con el lindero cruzado sobre sí mismo' : 'polígonos venían con el lindero cruzado sobre sí mismo'}: ${n === 1 ? 'lo reparé' : 'los reparé'} al guardar y el área es la de lo reparado. Conviene revisar ese plano.`;
      avisos.push({ nivel: 'ojo', texto: aviso });
      partes.push(aviso);
    }
    if (guardado.vacias) {
      const aviso = `${guardado.vacias} ${guardado.vacias === 1 ? 'polígono no tenía superficie' : 'polígonos no tenían superficie'} una vez reparados y no ${guardado.vacias === 1 ? 'entró' : 'entraron'}.`;
      avisos.push({ nivel: 'ojo', texto: aviso });
      partes.push(aviso);
    }
    if (guardado.entidades) {
      const n = guardado.entidades;
      partes.push(
        guardado.concesiones
          ? `Y ${n} ${n === 1 ? 'entidad geográfica más' : 'entidades geográficas más'}.`
          : `${n === 1 ? 'Entró como entidad geográfica' : `Entraron como ${n} entidades geográficas`} (bocaminas, ríos, poblados…), no como concesiones: no traen titular.`
      );
    }
    if (traslapesNuevos > 0 && guardado.concesiones && guardado.capaId) {
      /*
       * Los traslapes que se cuentan son los de la BASE, contra todo el padrón: una concesión nueva
       * no se pisa solo con las de su mismo archivo. Mirar solo dentro de la capa le decía «no se
       * pisa ninguno» a quien acababa de subir una que se come media de la vecina.
       */
      const suyos = await traslapesDeCapa(guardado.capaId).catch(() => null);
      if (suyos === null) partes.push(resumenTraslapes(capa));
      else if (!suyos.length) partes.push('No se pisa con nada de lo cargado, ni dentro del archivo ni con el resto del padrón.');
      else {
        const lista = suyos.slice(0, 5).map((x) => `${x.a} con ${x.b}, ${nf(x.hectareas)} ha`);
        partes.push(
          `${suyos.length === 1 ? 'Encontré 1 traslape' : `Encontré ${suyos.length} traslapes`} contando el resto del padrón: ${lista.join('; ')}${suyos.length > 5 ? ', y más' : ''}. Eso es superposición de derechos y se resuelve por prelación de la solicitud, no en el mapa.`
        );
      }
    }
    if (opts.sinTraslapes && guardado.concesiones) partes.push('Los traslapes se calculan al final, de una vez.');

    return {
      clase: 'catastro',
      dicho: partes.join(' '),
      avisos,
      ui: { accion: 'capa', capa_id: guardado.capaId, concesiones: guardado.concesiones, repetidas: guardado.repetidas, traslapes: traslapesNuevos },
    };
  }

  // ------------------------------------------------------- documento y foto de documento
  /*
   * Una foto entra por aquí y no por una ruta propia. Tiene que quedar con su huella, su dedup y su
   * fragmento citable igual que un PDF: para quien después pregunta «¿qué dice la resolución de
   * Quebrada Seca?», que el papel haya llegado escaneado o fotografiado con el teléfono no es una
   * diferencia que le importe.
   */
  const imagen = ES_IMAGEN.test(nombre) || !!MIME_IMAGEN[String(opts.mime || '').split(';')[0].trim()];
  if (ES_DOC.test(nombre) || imagen) {
    // La huella se mira ANTES de extraer el texto, y es lo que hace reanudable una carga grande:
    // al relanzar una carpeta de miles de expedientes, los ya cargados se saltan en un md5 en vez
    // de volver a parsear el PDF entero para acabar descubriendo que ya estaba.
    await asegurarOrganizacion();
    const huella = huellaDe(datos);
    const [previo] = await consulta<{ id: number; paginas: number | null; meta: Record<string, any> | null; n: number }>(
      `SELECT d.id, d.paginas, d.meta, (SELECT count(*)::int FROM fragmento f WHERE f.documento_id = d.id) AS n
         FROM documento d
        WHERE d.huella = $1 AND COALESCE(d.concesion_id, -1) = COALESCE($2::bigint, -1)${sqlDocumentoVisible('d')} LIMIT 1`,
      [huella, opts.concesionId ?? null]
    );
    /*
     * La huella dice «este archivo ya entró», no «entró entero» (auditoría H03). Si le faltan
     * fragmentos —una carga de antes que se cortó a la mitad—, se borra y se vuelve a cargar entera
     * en vez de contestar «ya estaba». Se compara con los fragmentos que se guardaron como esperados;
     * lo cargado antes de guardarlos cuenta como entero si tiene al menos uno.
     */
    const esperados = Number(previo?.meta?.fragmentos);
    const incompleto = !!previo && (Number.isFinite(esperados) && esperados > 0 ? previo.n < esperados : previo.n === 0);
    if (previo && incompleto) {
      console.warn(`[electrum] «${nombre}» estaba a medias (${previo.n}${esperados ? ` de ${esperados}` : ''} fragmentos): lo vuelvo a cargar entero`);
      // Se repara en su lugar —mismo documento, fragmentos nuevos en una transacción— para no perder
      // su id ni lo que lo referencia. Una foto se vuelve a transcribir desde cero.
      const leido = imagen ? null : await leerDocumento(nombre, datos);
      if (leido && leido.ok !== false) {
        await reemplazarFragmentos(previo.id, leido.paginas.length, leido.trozos, nombre);
        return {
          clase: 'documento',
          dicho: `«${nombre}» había quedado a medias (${previo.n} fragmentos). Lo volví a leer entero: ${leido.paginas.length} páginas, ${leido.trozos.length} fragmentos.`,
          avisos: leido.avisos,
          ui: { accion: 'documento', documento_id: previo.id, nombre, paginas: leido.paginas.length, fragmentos: leido.trozos.length, reparado: true },
        };
      }
      await consulta(`DELETE FROM documento WHERE id = $1`, [previo.id]);
    }
    const ya = previo && !incompleto ? previo : null;
    if (ya) {
      // Lo que ya estaba y no tenía carpeta ni original, los adopta: volver a importar una carpeta
      // ordena lo viejo en vez de dejarlo suelto. Lo que ya tenía carpeta no se mueve solo.
      if (carpeta || archivo) {
        await consulta(
          `UPDATE documento SET carpeta = COALESCE(carpeta, $2), archivo = COALESCE(archivo, $3) WHERE id = $1`,
          [ya.id, carpeta, archivo]
        ).catch(() => {});
      }
      // Un PDF indexado con el tope viejo de 8 000 caracteres se reconoce por la firma (varias
      // páginas y como mucho ~8 000 caracteres en total). Volver a subirlo lo repara en su lugar:
      // mismo documento, fragmentos nuevos. Lo que estaba bien se sigue saltando.
      const reparado = /\.pdf$/i.test(nombre) ? await repararSiTruncado(ya.id, ya.paginas, nombre, datos) : null;
      if (reparado) return reparado;
      return {
        clase: 'documento',
        dicho: `«${nombre}» ya estaba en el cerebro, con el mismo contenido: no lo dupliqué.`,
        // Los avisos de la primera lectura (foto transcrita, páginas aproximadas) siguen valiendo:
        // repetir la carga no la vuelve perfecta (auditoría H12).
        avisos: Array.isArray(ya.meta?.avisos) ? (ya.meta!.avisos as Aviso[]) : [],
        ui: { accion: 'documento', documento_id: ya.id, nombre, paginas: ya.paginas ?? 0, fragmentos: 0, repetido: true },
      };
    }

    let paginas: Array<{ pagina: number; texto: string }>;
    let trozos: Array<{ pagina: number; orden: number; texto: string }>;
    let avisos: Aviso[];
    let tipoPorDefecto: string;

    if (imagen) {
      const ext = ES_IMAGEN.test(nombre)
        ? nombre.split('.').pop()!.toLowerCase()
        : MIME_IMAGEN[String(opts.mime || '').split(';')[0].trim()] || 'jpg';
      const visto = await verImagen(`data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${datos.toString('base64')}`, OJO_MINERO);

      // Sin ojo configurado no se guarda un documento vacío que después parezca cargado: se dice.
      if (vistaFallida(visto) || visto.texto.length < 20) {
        return {
          clase: 'nada',
          // Qué pieza falló (y con qué variable se arregla) queda en el registro de `verImagen`.
          dicho: vistaFallida(visto)
            ? 'No pude leer esa foto ahora mismo. Volvé a mandármela en un rato.'
            : 'Miré la foto y no saqué texto de ella. Si es un plano, acercate al recuadro con los datos y volvé a mandármela.',
          avisos: [{ nivel: 'error', texto: vistaFallida(visto) ? 'visión: no respondió' : 'visión: sin texto legible' }],
        };
      }

      paginas = [{ pagina: 1, texto: visto.texto }];
      trozos = trocear(paginas);
      avisos = [{ nivel: 'ojo', texto: `Leído con ${ojoQueLeyo(visto.via)}. Es una transcripción de una foto, no el documento original.` }];
      tipoPorDefecto = clasificarDoc(nombre, visto.texto);
    } else {
      const leido = await leerDocumento(nombre, datos);
      // `escaneo` va en la ui para quien importa una carpeta: lo deja anotado en el panel como
      // «sin texto», con su original, en vez de que desaparezca sin rastro.
      if (leido.ok === false) return { clase: 'nada', dicho: leido.dicho, avisos: leido.avisos, ui: leido.motivo === 'escaneo' ? { escaneo: true, paginas: leido.paginas ?? null } : undefined };
      paginas = leido.paginas;
      trozos = leido.trozos;
      avisos = leido.avisos;
      tipoPorDefecto = clasificarDoc(nombre, leido.texto);
    }

    // Lo cargado ANTES de que existiera la huella tiene la columna vacía, así que la consulta de
    // arriba no lo encuentra y la primera recarga lo duplicaría entero. Se adopta aquí: mismo
    // nombre, mismas páginas y —lo que decide— mismo primer fragmento palabra por palabra. El
    // nombre y el número de páginas solos no bastan: dos resoluciones distintas se llaman igual y
    // tienen una página. Comparar el texto es lo que distingue «es el mismo papel» de «se llama
    // igual». Adoptada una fila, queda con huella y ya no vuelve a pasar por aquí.
    // La adopción de filas antiguas es cosa de documentos: las fotos son todas posteriores a la
    // huella, así que no hay nada viejo que adoptar y buscarlo solo costaría una consulta.
    const [viejo] = imagen
      ? []
      : await consulta<{ id: number; texto: string }>(
      `SELECT d.id, f.texto FROM documento d
         JOIN fragmento f ON f.documento_id = d.id AND f.orden = 0 AND f.pagina = $3
        WHERE d.huella IS NULL AND d.nombre = $1 AND d.paginas = $2
          AND COALESCE(d.concesion_id, -1) = COALESCE($4::bigint, -1)${sqlDocumentoVisible('d')}
        LIMIT 1`,
      [nombre, paginas.length, trozos[0].pagina, opts.concesionId ?? null]
    );
    if (viejo && viejo.texto === trozos[0].texto) {
      await consulta(`UPDATE documento SET huella = $1 WHERE id = $2 AND huella IS NULL`, [huella, viejo.id]);
      return {
        clase: 'documento',
        dicho: `«${nombre}» ya estaba cargado de antes: le puse la huella y no lo dupliqué.`,
        avisos,
        ui: { accion: 'documento', documento_id: viejo.id, nombre, paginas: paginas.length, fragmentos: 0, repetido: true },
      };
    }

    /*
     * TODO O NADA (auditoría H03): el documento y todos sus fragmentos en una transacción. Antes
     * eran consultas sueltas; si la carga se caía en el segundo lote quedaba un documento a medias
     * que, por la huella, después se daba por cargado. En `meta` quedan los fragmentos esperados (lo
     * que permite detectar uno incompleto), los avisos de la lectura y de dónde salió el texto: una
     * foto transcrita no es el documento original y queda sin revisar (H11).
     */
    const meta = {
      fragmentos: trozos.length,
      avisos,
      origen: imagen ? 'foto_transcrita' : 'documento',
      ...(imagen ? { revisado: false } : {}),
    };
    const doc = await enTransaccion(async (q) => {
      const [fila] = await q(
        `INSERT INTO documento (nombre, tipo, concesion_id, paginas, subido_por, huella, carpeta, archivo, meta, organizacion)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT DO NOTHING RETURNING id`,
        // De la organización de quien lo sube (auditoría H14); lo de la casa queda como siempre.
        [nombre, opts.tipoDoc || tipoPorDefecto, opts.concesionId ?? null, paginas.length, opts.subidoPor || null, huella, carpeta, archivo, JSON.stringify(meta), organizacionParaGuardar()]
      );
      if (!fila) return null;
      // Inserción en bloque: un informe de 43-101 son miles de trozos y uno por uno tarda minutos.
      for (let i = 0; i < trozos.length; i += 200) {
        const args: unknown[] = [];
        const marcas = trozos.slice(i, i + 200).map((t, j) => {
          args.push(fila.id, t.pagina, t.orden, t.texto);
          return `($${j * 4 + 1},$${j * 4 + 2},$${j * 4 + 3},$${j * 4 + 4})`;
        });
        await q(`INSERT INTO fragmento (documento_id, pagina, orden, texto) VALUES ${marcas.join(',')}`, args);
      }
      return { id: Number(fila.id) };
    });
    // Sin fila devuelta, otra carga en paralelo lo metió entre el SELECT y el INSERT. No es un
    // error: es justo lo que el índice único tiene que impedir, y aquí se nota en vez de reventar.
    if (!doc) {
      return {
        clase: 'documento',
        dicho: `«${nombre}» acaba de entrar por otra carga que iba en paralelo: no lo dupliqué.`,
        avisos,
        ui: { accion: 'documento', nombre, paginas: paginas.length, fragmentos: 0, repetido: true },
      };
    }


    // Los vectores (búsqueda por significado) se calculan después, sin hacer esperar a quien subió
    // el documento: el texto completo ya lo hace buscable desde este momento.
    void indexarPendientes({ documentoId: doc.id })
      .then((n) => n && console.log(`[electrum] ${n} fragmentos de «${nombre}» con vector`))
      .catch((e) => console.error('[electrum] no pude vectorizar', nombre, String(e?.message || e).slice(0, 120)));
    // Qué es y qué trae (Laya), también sin hacer esperar: si el lector no está, el documento ya
    // quedó guardado y buscable, y documento_revisar lo lee cuando se lo pidan.
    void clasificarDocumento(doc.id, { tipoFijado: !!opts.tipoDoc })
      .then((l) => l && console.log(`[electrum] «${nombre}»: ${l.tipo} (${Math.round(l.pTipo * 100)} %)`))
      .catch((e) => console.error('[electrum] no pude clasificar', nombre, String(e?.message || e).slice(0, 120)));

    return {
      clase: 'documento',
      dicho: imagen
        ? `Leí la foto y saqué ${paginas[0].texto.length} caracteres: ${trozos.length} ${trozos.length === 1 ? 'fragmento indexado' : 'fragmentos indexados'} y ya queda en el expediente, buscable. Es lo que se lee en la imagen; lo que salía borroso lo dejé marcado como ilegible en vez de completarlo.`
        : `Leí ${nombre}: ${paginas.length} ${paginas.length === 1 ? 'página' : 'páginas'}, ${trozos.length} ${trozos.length === 1 ? 'fragmento indexado' : 'fragmentos indexados'}. Ya lo puedo citar con página.`,
      avisos,
      ui: { accion: 'documento', documento_id: doc.id, nombre, paginas: paginas.length, fragmentos: trozos.length, foto: imagen || undefined },
    };
  }

  return {
    clase: 'nada',
    dicho: `No sé qué hacer con «${nombre}». Mandame shapefile, KML, KMZ, GeoJSON o CSV para el mapa; PDF, Word, RTF, PowerPoint, Excel o texto para los expedientes; o la foto de un papel, que también la leo.`,
    avisos: [{ nivel: 'error', texto: 'formato no reconocido' }],
  };
}

/** De qué tipo es el documento, por su nombre y por cómo empieza. Solo para ordenar, no para decidir. */
function clasificarDoc(nombre: string, texto: string): string {
  const s = `${nombre} ${texto.slice(0, 1200)}`.toLowerCase();
  if (/43-?101|technical report|informe t[eé]cnico/.test(s)) return '43-101';
  if (/resoluci[oó]n|acuerdo ministerial|inhgeomin/.test(s)) return 'resolución';
  if (/ensayo|assay|certificado de an[aá]lisis|laboratorio/.test(s)) return 'ensayo';
  if (/plan de labores|programa de trabajo/.test(s)) return 'plan de labores';
  if (/estudio de impacto|ambiental/.test(s)) return 'ambiental';
  return 'otro';
}
