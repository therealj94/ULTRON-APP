/**
 * APRENDER — lo que se sube queda sabido.
 *
 * «Listo para aprender todo luego de subir la información»: esto es esa pieza. Un archivo entra por
 * un lado y sale convertido en algo que Dr Electrum puede consultar y citar.
 *
 * Dos caminos, según lo que sea:
 *
 *  - **Geográfico** (.shp, .zip, .kml, .kmz, .geojson, .csv) → motor GIS → PostGIS. Las concesiones
 *    quedan buscables, medibles y cruzables, y el mapa puede volar a ellas.
 *  - **Documento** (.pdf, .txt, .md) → texto → troceado **con su página** → índice de texto completo.
 *    La página no es un adorno: una cita que no se puede ir a comprobar no es una cita.
 *
 * El troceado es lo que más decide la calidad de las respuestas después. Aquí se corta por párrafos
 * y se respeta el límite de página, con un solapamiento pequeño para que una frase partida entre dos
 * trozos siga encontrándose. Cortar a ciegas cada N caracteres parte tablas y números por la mitad,
 * que en un informe minero es exactamente lo que no se puede partir.
 */
import { extraerPdf, esPdfNombre } from '../../lib/leer-pdf';
import { consulta, guardarCapa, hayBase, recalcularTraslapes } from './db';
import { ingerir, resumenCapa, resumenTraslapes, type Aviso } from './gis';

export type Aprendido = {
  clase: 'catastro' | 'documento' | 'nada';
  /** Lo que Dr Electrum dice en voz alta al terminar. */
  dicho: string;
  avisos: Aviso[];
  /** Para la interfaz: qué pintar, qué abrir. */
  ui?: Record<string, unknown>;
};

const ES_GEO = /\.(zip|shp|kml|kmz|geojson|json|csv|gpkg|dxf)$/i;
const ES_DOC = /\.(pdf|txt|md|markdown)$/i;

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
      // Un párrafo enorme (una tabla, normalmente) se parte por frases, no a ciegas.
      if (parrafo.length > OBJETIVO * 2) {
        for (const frase of parrafo.split(/(?<=[.;:])\s+/)) {
          if (buffer.length + frase.length > OBJETIVO) soltar();
          buffer += (buffer ? ' ' : '') + frase;
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
 * Aprende un archivo. Nunca lanza: los problemas salen como avisos, porque quien sube un archivo
 * necesita saber qué pasó con él.
 */
export async function aprender(
  nombreArchivo: string,
  datos: Buffer,
  opts: { subidoPor?: string; concesionId?: number; tipoDoc?: string } = {}
): Promise<Aprendido> {
  const nombre = String(nombreArchivo || 'archivo');

  if (!hayBase()) {
    return {
      clase: 'nada',
      dicho: 'Leí el archivo pero el catastro no está conectado, así que no puedo guardarlo todavía. Decilo tal cual.',
      avisos: [{ nivel: 'error', texto: 'sin ELECTRUM_DB_URL' }],
    };
  }

  // ---------------------------------------------------------------- geográfico
  if (ES_GEO.test(nombre)) {
    const { capa, avisos } = await ingerir(nombre, datos);
    if (!capa) return { clase: 'nada', dicho: avisos.map((a) => a.texto).join(' ') || 'No pude leer ese archivo.', avisos };

    const guardado = await guardarCapa(capa, { subidoPor: opts.subidoPor, avisos });
    const traslapesNuevos = await recalcularTraslapes();

    const partes = [resumenCapa(capa, avisos)];
    if (guardado.concesiones) partes.push(`Quedaron ${guardado.concesiones} en el catastro, ya buscables y medibles.`);
    if (guardado.entidades) partes.push(`Y ${guardado.entidades} entidades geográficas más.`);
    if (traslapesNuevos > 0) partes.push(resumenTraslapes(capa));

    return {
      clase: 'catastro',
      dicho: partes.join(' '),
      avisos,
      ui: { accion: 'capa', capa_id: guardado.capaId, concesiones: guardado.concesiones, traslapes: traslapesNuevos },
    };
  }

  // ---------------------------------------------------------------- documento
  if (ES_DOC.test(nombre)) {
    const avisos: Aviso[] = [];
    let texto = '';
    let nPaginas = 1;

    if (esPdfNombre(nombre, 'application/pdf')) {
      const leido = extraerPdf(datos);
      texto = leido.texto || '';
      nPaginas = Math.max(1, Number((leido as any).paginas) || 1);
      if (!texto.trim()) {
        return {
          clase: 'nada',
          dicho: 'Ese PDF no trae texto: es un escaneo de imágenes. Para poder citarlo necesito una versión con texto, o pasarlo por reconocimiento óptico. Dilo así.',
          avisos: [{ nivel: 'error', texto: 'PDF sin capa de texto' }],
        };
      }
    } else {
      texto = datos.toString('utf8');
    }

    const paginas = paginasDePdf(texto, nPaginas);
    if (paginas.length === 1 && nPaginas > 1) {
      avisos.push({ nivel: 'ojo', texto: 'El PDF no trae marcas de página, así que las páginas de las citas son aproximadas.' });
    }

    const trozos = trocear(paginas);
    if (!trozos.length) {
      return { clase: 'nada', dicho: 'El archivo tiene texto pero demasiado corto para indexarlo.', avisos };
    }

    const [doc] = await consulta<{ id: number }>(
      `INSERT INTO documento (nombre, tipo, concesion_id, paginas, subido_por)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [nombre, opts.tipoDoc || clasificarDoc(nombre, texto), opts.concesionId ?? null, paginas.length, opts.subidoPor || null]
    );

    // Inserción en bloque: un informe de 43-101 son miles de trozos y uno por uno tarda minutos.
    const valores: unknown[] = [];
    const marcas = trozos.map((t, i) => {
      valores.push(doc.id, t.pagina, t.orden, t.texto);
      return `($${i * 4 + 1},$${i * 4 + 2},$${i * 4 + 3},$${i * 4 + 4})`;
    });
    for (let i = 0; i < marcas.length; i += 200) {
      const tramo = marcas.slice(i, i + 200);
      const args = valores.slice(i * 4, (i + 200) * 4);
      const renumerado = tramo.map((_, j) => `($${j * 4 + 1},$${j * 4 + 2},$${j * 4 + 3},$${j * 4 + 4})`).join(',');
      await consulta(`INSERT INTO fragmento (documento_id, pagina, orden, texto) VALUES ${renumerado}`, args);
    }

    return {
      clase: 'documento',
      dicho: `Leí ${nombre}: ${paginas.length} ${paginas.length === 1 ? 'página' : 'páginas'}, ${trozos.length} fragmentos indexados. Ya lo puedo citar con página.`,
      avisos,
      ui: { accion: 'documento', documento_id: doc.id, nombre, paginas: paginas.length, fragmentos: trozos.length },
    };
  }

  return {
    clase: 'nada',
    dicho: `No sé qué hacer con «${nombre}». Mandame shapefile, KML, KMZ, GeoJSON o CSV para el mapa, o PDF y texto para los expedientes.`,
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
