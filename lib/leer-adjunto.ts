/**
 * LEER UN ADJUNTO (auditoría del 7-oct, A-5: «AU-RA solo ve el nombre de los adjuntos»). Lo que llega por correo
 * (server/correo.ts, `correo adjunto <n>`) o por WhatsApp (server/whatsapp.ts, `whatsapp documento <n>`) pasa por los
 * MISMOS lectores que ya leen lo que se sube: PDF (pdf.js, lib/leer-pdf-pdfjs.ts, con el lector propio de respaldo,
 * lib/leer-pdf.ts), Word (.docx y el .doc viejo), RTF, PowerPoint y Excel (lib/leer-oficina.ts), texto, y, si el
 * servidor tiene ojos, el reconocimiento óptico (Docling, lib/cognitivo/documentos.ts, para un PDF escaneado) o la
 * visión (lib/vision.ts, para la foto de un documento).
 *
 * Devuelve el texto en TROZOS para la voz (como un correo: se lee uno y se pregunta si sigue). Honesto: lo que no se
 * pudo leer vuelve `ok: false` con el motivo; nunca un texto inventado. El tipo sale de los BYTES (la firma del
 * archivo), no del nombre: un «.pdf» que no es PDF no se lee como PDF.
 *
 * Topes: MAX_ADJUNTO_BYTES (10 MB) por archivo y MAX_TEXTO_ADJUNTO (60 000 letras) de texto; un zip de Office que se
 * descomprime a más de 400 MB lo corta lib/leer-oficina.ts.
 */
import { textoPorPaginas } from './leer-pdf-pdfjs';
import { extraerPdf, dataUrlDeImagen } from './leer-pdf';
import { paginasDeDoc, paginasDeDocx, paginasDePptx, paginasDeRtf, paginasDeXlsx, type PaginaLeida } from './leer-oficina';
import { enTrozos, htmlATexto } from './correo/buzon';

export const MAX_ADJUNTO_BYTES = 10 * 1024 * 1024;
export const MAX_TEXTO_ADJUNTO = 60_000;
/** Lo que mide cada trozo (lo mismo que un correo leído en voz alta). */
export const TROZO_ADJUNTO = 600;

export type Adjunto = { nombre: string; mime?: string; datos: Buffer };
export type TipoAdjunto = 'pdf' | 'word' | 'excel' | 'powerpoint' | 'rtf' | 'texto' | 'imagen' | 'desconocido';

export type AdjuntoLeido =
  | {
      ok: true;
      tipo: TipoAdjunto;
      paginas: PaginaLeida[];
      texto: string;
      trozos: string[];
      /** Con qué se leyó («pdf.js», «docx», «docling», «vision:…»). */
      via: string;
      /** Lo que hay que decir con el texto (leído con OCR, recortado…). */
      avisos: string[];
      recortado: boolean;
    }
  | { ok: false; tipo: TipoAdjunto; motivo: 'grande' | 'vacio' | 'formato' | 'escaneo' | 'ilegible' | 'sin-ojos'; detalle: string };

/** Los ojos opcionales (las pruebas ponen otros): OCR de un PDF sin texto y visión para la foto de un documento. */
export type OjosAdjunto = {
  ocr?: ((nombre: string, datos: Buffer) => Promise<{ paginas: PaginaLeida[]; via?: string } | null>) | null;
  vision?: ((dataUrl: string, prompt: string) => Promise<{ texto: string; via: string } | null>) | null;
};

const PROMPT_DOCUMENTO =
  'Es la foto o captura de un documento que le mandaron a la persona. TRANSCRIBE el texto que se lee, en orden, con sus números, fechas y montos tal cual. Si es una tabla, fila por fila. Lo borroso o cortado dilo «ilegible»; no completes ni inventes nada. Al final, una línea que diga qué clase de documento parece.';

const ext = (nombre: string) => (String(nombre || '').toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1] || '');

/** Qué es, por la firma de los bytes (y, si es un zip de Office, por lo que lleva dentro o su extensión). */
export function tipoDeAdjunto(a: Pick<Adjunto, 'nombre' | 'mime' | 'datos'>): TipoAdjunto {
  const b = a.datos;
  const e = ext(a.nombre);
  const mime = String(a.mime || '').toLowerCase();
  if (!b?.length) return 'desconocido';
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'imagen';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'imagen';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'imagen';
  if (b.subarray(0, 5).toString('latin1') === '{\\rtf') return 'rtf';
  if (b[0] === 0x50 && b[1] === 0x4b) {
    // Un zip: los de Office llevan su parte principal con un nombre conocido (se mira en los primeros KB).
    const cabeza = b.subarray(0, Math.min(b.length, 64 * 1024)).toString('latin1');
    if (/word\/document\.xml/.test(cabeza) || e === 'docx') return 'word';
    if (/xl\/workbook\.xml/.test(cabeza) || /^xls[xm]$/.test(e)) return 'excel';
    if (/ppt\/presentation\.xml/.test(cabeza) || e === 'pptx') return 'powerpoint';
    return 'desconocido';
  }
  // OLE (Word 97-2003): solo el .doc (el .xls y el .ppt viejos no tienen lector).
  if (b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return e === 'doc' || /msword/.test(mime) ? 'word' : 'desconocido';
  // WordPerfect con extensión .doc (lib/leer-oficina.ts lo reconoce por su firma).
  if (e === 'doc' && b[0] === 0xff && b.subarray(1, 4).toString('latin1') === 'WPC') return 'word';
  if (/^text\//.test(mime) || /^(txt|csv|tsv|md|markdown|json|xml|html?|log|ics|vcf)$/.test(e)) return 'texto';
  // Sin firma ni extensión conocida: texto solo si de verdad parece texto (sin bytes de control raros).
  const muestra = b.subarray(0, Math.min(b.length, 4096));
  const raros = [...muestra].filter((x) => x < 9 || (x > 13 && x < 32)).length;
  return raros === 0 ? 'texto' : 'desconocido';
}

function deTexto(datos: Buffer, nombre: string): string {
  let t: string;
  try {
    t = new TextDecoder('utf-8', { fatal: true }).decode(datos);
  } catch {
    // Sin UTF-8 válido: latin1, que es como llegan los CSV que guarda Excel en español.
    t = datos.toString('latin1');
  }
  if (/\.html?$/i.test(nombre) || /^\s*<(!doctype|html)/i.test(t)) t = htmlATexto(t);
  return t.replace(/^﻿/, '');
}

/** Los ojos de verdad (si el servidor los tiene); se cargan al usarlos. */
async function ojosPorOmision(): Promise<Required<OjosAdjunto>> {
  const { doclingConfigurado, leerConDocling } = await import('./cognitivo/documentos');
  const { verImagen } = await import('./vision');
  return {
    ocr: doclingConfigurado() ? (nombre, datos) => leerConDocling(nombre, datos) : null,
    vision: async (dataUrl, prompt) => {
      const v = await verImagen(dataUrl, prompt);
      return v && v.texto && !/^(ninguno|tope|tiempo)$/.test(v.via) ? { texto: v.texto, via: v.via } : null;
    },
  };
}

const caracteres = (ps: PaginaLeida[]) => ps.reduce((n, p) => n + String(p.texto || '').replace(/\s+/g, ' ').trim().length, 0);

/** Las páginas en un solo texto, con su número si hay varias («[Página 2]», «[Hoja 1]», «[Diapositiva 3]»). */
function unir(paginas: PaginaLeida[], tipo: TipoAdjunto): string {
  const nombre = tipo === 'excel' ? 'Hoja' : tipo === 'powerpoint' ? 'Diapositiva' : 'Página';
  const utiles = paginas.filter((p) => String(p.texto || '').trim());
  if (utiles.length <= 1) return String(utiles[0]?.texto || '').trim();
  return utiles.map((p) => `[${nombre} ${p.pagina}]\n${String(p.texto).trim()}`).join('\n\n');
}

/**
 * Lee un adjunto. Nunca lanza: lo que no se pudo vuelve `ok: false` con el motivo, dicho para la persona.
 * `topeMs`: lo más que se espera a pdf.js (un PDF enorme no detiene el turno).
 */
export async function leerAdjunto(a: Adjunto, o: { ojos?: OjosAdjunto; topeMs?: number } = {}): Promise<AdjuntoLeido> {
  const nombre = String(a.nombre || 'adjunto');
  const datos = a.datos || Buffer.alloc(0);
  const tipo = tipoDeAdjunto({ nombre, mime: a.mime, datos });
  if (!datos.length) return { ok: false, tipo, motivo: 'vacio', detalle: `«${nombre}» viene vacío.` };
  if (datos.length > MAX_ADJUNTO_BYTES) return { ok: false, tipo, motivo: 'grande', detalle: `«${nombre}» pesa ${Math.round(datos.length / 1048576)} MB; leo hasta ${MAX_ADJUNTO_BYTES / 1048576} MB.` };
  const avisos: string[] = [];
  let paginas: PaginaLeida[] = [];
  let via = '';
  try {
    switch (tipo) {
      case 'pdf': {
        const pdfjs = await textoPorPaginas(datos, o.topeMs ?? 20_000);
        if (pdfjs && caracteres(pdfjs.paginas.map((t, i) => ({ pagina: i + 1, texto: t }))) >= 40) {
          paginas = pdfjs.paginas.map((t, i) => ({ pagina: i + 1, texto: t }));
          via = 'pdf.js';
        } else {
          const propio = extraerPdf(datos, { maxTexto: MAX_TEXTO_ADJUNTO });
          if (propio.texto.trim().length >= 40) {
            paginas = [{ pagina: 1, texto: propio.texto }];
            via = 'pdf';
          }
        }
        if (!paginas.length) {
          // Un escaneo (sin capa de texto): el OCR, si el servidor lo tiene.
          const ojos = o.ojos ?? (await ojosPorOmision());
          const ocr = ojos.ocr ? await ojos.ocr(nombre, datos).catch(() => null) : null;
          if (ocr?.paginas?.length && caracteres(ocr.paginas) > 0) {
            paginas = ocr.paginas;
            via = ocr.via || 'ocr';
            avisos.push('Leído con reconocimiento óptico (es un escaneo): las cifras pueden tener errores de lectura; dilo si citas números.');
          } else {
            return { ok: false, tipo, motivo: 'escaneo', detalle: `«${nombre}» es un PDF escaneado (sin texto) y ${ojos.ocr ? 'el reconocimiento óptico no sacó nada' : 'este servidor no tiene reconocimiento óptico'}. No sé qué dice.` };
          }
        }
        break;
      }
      case 'word':
        paginas = ext(nombre) === 'docx' || datos[0] === 0x50 ? await paginasDeDocx(datos) : await paginasDeDoc(datos);
        via = 'word';
        break;
      case 'excel':
        paginas = await paginasDeXlsx(datos, 2000);
        via = 'xlsx';
        break;
      case 'powerpoint':
        paginas = await paginasDePptx(datos);
        via = 'pptx';
        break;
      case 'rtf':
        paginas = paginasDeRtf(datos);
        via = 'rtf';
        break;
      case 'texto':
        paginas = [{ pagina: 1, texto: deTexto(datos, nombre) }];
        via = 'texto';
        break;
      case 'imagen': {
        const ojos = o.ojos ?? (await ojosPorOmision());
        if (!ojos.vision) return { ok: false, tipo, motivo: 'sin-ojos', detalle: `«${nombre}» es una imagen y ahora mismo no tengo cómo verla.` };
        const v = await ojos.vision(dataUrlDeImagen(datos), PROMPT_DOCUMENTO).catch(() => null);
        if (!v?.texto?.trim()) return { ok: false, tipo, motivo: 'sin-ojos', detalle: `No pude ver la imagen «${nombre}» ahora mismo. No sé qué dice.` };
        paginas = [{ pagina: 1, texto: v.texto }];
        via = `vision:${v.via}`;
        avisos.push('Es una imagen: lo que sigue es lo que se vio en ella (transcrito por la visión); lo ilegible va marcado así.');
        break;
      }
      default:
        return { ok: false, tipo, motivo: 'formato', detalle: `«${nombre}» no es un formato que sepa leer (leo PDF, Word, Excel, PowerPoint, RTF, texto y fotos de documentos).` };
    }
  } catch (e: any) {
    return { ok: false, tipo, motivo: 'ilegible', detalle: `No pude leer «${nombre}» (${String(e?.message || e).slice(0, 100)}). No sé qué dice.` };
  }
  let texto = unir(paginas, tipo);
  if (!texto.trim()) return { ok: false, tipo, motivo: 'vacio', detalle: `«${nombre}» se abrió pero no trae texto.` };
  const recortado = texto.length > MAX_TEXTO_ADJUNTO;
  if (recortado) {
    texto = `${texto.slice(0, MAX_TEXTO_ADJUNTO).replace(/\s+\S*$/, '')}…`;
    avisos.push(`Es largo: tengo las primeras ${MAX_TEXTO_ADJUNTO.toLocaleString('es')} letras; lo demás no lo leí (dilo si preguntan por el final).`);
  }
  return { ok: true, tipo, paginas, texto, trozos: enTrozos(texto, TROZO_ADJUNTO), via, avisos, recortado };
}

/** Cómo se dice el tipo («un PDF», «un Excel»…). */
export function tipoEnPalabras(t: TipoAdjunto): string {
  return { pdf: 'PDF', word: 'Word', excel: 'Excel', powerpoint: 'PowerPoint', rtf: 'RTF', texto: 'texto', imagen: 'imagen', desconocido: 'archivo' }[t];
}
