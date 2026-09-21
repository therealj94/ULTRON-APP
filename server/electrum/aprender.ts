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
import crypto from 'node:crypto';
import { extraerPdf } from '../../lib/leer-pdf';
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

/** Lo que se sabe de un documento sin escribir nada: sirve para el ensayo previo de una carga grande. */
export type Inspeccion = {
  veredicto: 'indexable' | 'escaneo' | 'corto';
  paginas: number;
  fragmentos: number;
  caracteres: number;
  dicho: string;
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

/** Huella del contenido, no del nombre: el mismo expediente llega con veinte nombres distintos. */
export function huellaDe(datos: Buffer): string {
  return crypto.createHash('md5').update(datos).digest('hex');
}

type Leido =
  | { ok: true; texto: string; paginas: Array<{ pagina: number; texto: string }>; trozos: ReturnType<typeof trocear>; avisos: Aviso[] }
  | { ok: false; motivo: 'escaneo' | 'corto'; dicho: string; avisos: Aviso[] };

/**
 * Lee un documento hasta dejarlo troceado, sin tocar la base.
 *
 * Está separado de `aprender` para que el ensayo previo (`--seco`) pase por exactamente el mismo
 * código que la carga real. Antes el ensayo se limitaba a decir el tamaño en KB —«se indexaría como
 * documento»— y eso, en una carga de mil expedientes, esconde justo lo que hay que saber antes de
 * empezar: cuántos son escaneos sin texto y no van a entrar. Un ensayo que no puede contradecir a la
 * carga real no sirve para decidir nada.
 */
function leerDocumento(nombre: string, datos: Buffer): Leido {
  const avisos: Aviso[] = [];
  let texto = '';
  let nPaginas = 1;

  // Por la extensión, no por un mime inventado: pasarle 'application/pdf' a esPdfNombre hacía
  // que TODO pareciera PDF, y un .txt terminaba rechazado como «escaneo sin texto».
  if (/\.pdf$/i.test(nombre)) {
    const leido = extraerPdf(datos);
    texto = leido.texto || '';
    nPaginas = Math.max(1, Number((leido as any).paginas) || 1);
    if (!texto.trim()) {
      return {
        ok: false,
        motivo: 'escaneo',
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
    return { ok: false, motivo: 'corto', dicho: 'El archivo tiene texto pero demasiado corto para indexarlo.', avisos };
  }
  return { ok: true, texto, paginas, trozos, avisos };
}

/** Qué pasaría con este documento si se cargara, sin cargarlo. */
export function inspeccionar(nombre: string, datos: Buffer): Inspeccion {
  const leido = leerDocumento(nombre, datos);
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
  opts: { subidoPor?: string; concesionId?: number; tipoDoc?: string; sinTraslapes?: boolean } = {}
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
    if (nadaNuevo) {
      return {
        clase: 'catastro',
        dicho: `Ese catastro ya estaba cargado: las ${guardado.repetidas} geometrías son las mismas que ya tengo, así que no metí nada y no dupliqué la capa.`,
        avisos,
        ui: { accion: 'capa', capa_id: null, concesiones: 0, repetidas: guardado.repetidas, traslapes: 0 },
      };
    }

    const partes = [resumenCapa(capa, avisos)];
    if (guardado.concesiones) partes.push(`Quedaron ${guardado.concesiones} en el catastro, ya buscables y medibles.`);
    if (guardado.repetidas) {
      partes.push(
        `${guardado.repetidas} ${guardado.repetidas === 1 ? 'ya estaba cargada y la salté' : 'ya estaban cargadas y las salté'}: la misma geometría no entra dos veces.`
      );
    }
    if (guardado.entidades) partes.push(`Y ${guardado.entidades} entidades geográficas más.`);
    if (traslapesNuevos > 0 && guardado.concesiones) partes.push(resumenTraslapes(capa));
    if (opts.sinTraslapes && guardado.concesiones) partes.push('Los traslapes se calculan al final, de una vez.');

    return {
      clase: 'catastro',
      dicho: partes.join(' '),
      avisos,
      ui: { accion: 'capa', capa_id: guardado.capaId, concesiones: guardado.concesiones, repetidas: guardado.repetidas, traslapes: traslapesNuevos },
    };
  }

  // ---------------------------------------------------------------- documento
  if (ES_DOC.test(nombre)) {
    // La huella se mira ANTES de extraer el texto, y es lo que hace reanudable una carga grande:
    // al relanzar una carpeta de miles de expedientes, los ya cargados se saltan en un md5 en vez
    // de volver a parsear el PDF entero para acabar descubriendo que ya estaba.
    const huella = huellaDe(datos);
    const [ya] = await consulta<{ id: number; paginas: number | null }>(
      `SELECT id, paginas FROM documento
        WHERE huella = $1 AND COALESCE(concesion_id, -1) = COALESCE($2::bigint, -1) LIMIT 1`,
      [huella, opts.concesionId ?? null]
    );
    if (ya) {
      return {
        clase: 'documento',
        dicho: `«${nombre}» ya estaba en el cerebro, con el mismo contenido: no lo dupliqué.`,
        avisos: [],
        ui: { accion: 'documento', documento_id: ya.id, nombre, paginas: ya.paginas ?? 0, fragmentos: 0, repetido: true },
      };
    }

    const leido = leerDocumento(nombre, datos);
    if (leido.ok === false) return { clase: 'nada', dicho: leido.dicho, avisos: leido.avisos };
    const { paginas, trozos, avisos } = leido;

    // Lo cargado ANTES de que existiera la huella tiene la columna vacía, así que la consulta de
    // arriba no lo encuentra y la primera recarga lo duplicaría entero. Se adopta aquí: mismo
    // nombre, mismas páginas y —lo que decide— mismo primer fragmento palabra por palabra. El
    // nombre y el número de páginas solos no bastan: dos resoluciones distintas se llaman igual y
    // tienen una página. Comparar el texto es lo que distingue «es el mismo papel» de «se llama
    // igual». Adoptada una fila, queda con huella y ya no vuelve a pasar por aquí.
    const [viejo] = await consulta<{ id: number; texto: string }>(
      `SELECT d.id, f.texto FROM documento d
         JOIN fragmento f ON f.documento_id = d.id AND f.orden = 0 AND f.pagina = $3
        WHERE d.huella IS NULL AND d.nombre = $1 AND d.paginas = $2
          AND COALESCE(d.concesion_id, -1) = COALESCE($4::bigint, -1)
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

    const [doc] = await consulta<{ id: number }>(
      `INSERT INTO documento (nombre, tipo, concesion_id, paginas, subido_por, huella)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT DO NOTHING RETURNING id`,
      [nombre, opts.tipoDoc || clasificarDoc(nombre, leido.texto), opts.concesionId ?? null, paginas.length, opts.subidoPor || null, huella]
    );
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
