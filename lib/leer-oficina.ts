/**
 * LEER LO QUE LLEGA DE LA OFICINA: Word viejo (.doc), RTF, PowerPoint (.pptx) y Excel (.xlsx).
 *
 * El .docx y el PDF ya se leían. Lo que faltaba es justo lo que traen las carpetas de INHGEOMIN y
 * de los consultores: las 238 Fichas de Ocurrencias Mineras están en .doc de Word 97, algunas en
 * RTF; las presentaciones del sector vienen en .pptx y los resúmenes en .xlsx. Sin esto, una carpeta
 * entera quedaba «formato no reconocido».
 *
 * Cada lector devuelve PÁGINAS, no un texto corrido: en un .pptx la página es la diapositiva y en un
 * .xlsx es la hoja, y así una cita dice «diapositiva 4» u «hoja 2» en vez de un número inventado.
 */
import JSZip from 'jszip';

export type PaginaLeida = { pagina: number; texto: string };

function desescapar(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

function limpio(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Un zip de Office con un tope: un .pptx de 20 MB es normal, uno que se descomprime a 2 GB no. */
async function abrirZip(datos: Buffer): Promise<JSZip> {
  const zip = await JSZip.loadAsync(datos);
  let total = 0;
  zip.forEach((_, f: any) => {
    total += Number(f?._data?.uncompressedSize || 0);
  });
  if (total > 400 * 1024 * 1024) throw new Error('el archivo se descomprime a más de 400 MB');
  return zip;
}

/* --------------------------------------------------------------------------------- .doc */

/**
 * Word 97-2003. Es un formato binario (OLE): se lee con `word-extractor`, que es JavaScript puro y
 * no necesita LibreOffice en el servidor. Cuerpo, notas al pie y encabezados, en ese orden.
 */
export async function paginasDeDoc(datos: Buffer): Promise<PaginaLeida[]> {
  const mod: any = await import('word-extractor');
  const Extractor = mod.default || mod;
  const doc = await new Extractor().extract(datos);
  const partes = [doc.getBody?.(), doc.getFootnotes?.(), doc.getEndnotes?.(), doc.getHeaders?.({ includeFooters: true })]
    .map((t: unknown) => limpio(String(t || '')))
    .filter(Boolean);
  const texto = partes.join('\n\n');
  return texto ? [{ pagina: 1, texto }] : [];
}

/* --------------------------------------------------------------------------------- .rtf */

/**
 * RTF a texto. No hace falta un intérprete entero: se quitan los grupos que no son texto (fuentes,
 * colores, estilos, imágenes incrustadas), se traducen los caracteres escapados (`\'e1` es «á» en
 * la página de códigos 1252, `\u225?` es «á» en Unicode) y los saltos (`\par`, `\line`, `\cell`).
 */
export function textoDeRtf(datos: Buffer): string {
  let s = datos.toString('latin1');
  if (!s.startsWith('{\\rtf')) return '';
  // Grupos que no son texto: se buscan por su palabra de control y se salta el grupo entero,
  // contando llaves (vienen anidados).
  const destinos = /^\{\\(?:\*\\[a-z]+|fonttbl|colortbl|stylesheet|info|pict|object|themedata|colorschememapping|latentstyles|datastore|listtable|listoverridetable|rsidtbl|generator|xmlnstbl|header|footer|headerl|headerr|footerl|footerr|pn[a-z]*\d*)\b/;
  let out = '';
  for (let i = 0; i < s.length; ) {
    if (s[i] === '{' && destinos.test(s.slice(i, i + 40))) {
      let prof = 0;
      for (; i < s.length; i++) {
        if (s[i] === '\\') {
          i++;
          continue;
        }
        if (s[i] === '{') prof++;
        else if (s[i] === '}' && --prof === 0) {
          i++;
          break;
        }
      }
      continue;
    }
    out += s[i++];
  }
  s = out;
  let saltar = 0; // caracteres de reemplazo tras \uN (por defecto 1)
  let uc = 1;
  let texto = '';
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (c === '{' || c === '}') {
      i++;
      continue;
    }
    if (c === '\\') {
      const sig = s[i + 1];
      if (sig === "'") {
        const hex = s.slice(i + 2, i + 4);
        if (saltar > 0) saltar--;
        else texto += Buffer.from([parseInt(hex, 16)]).toString('latin1');
        i += 4;
        continue;
      }
      if (sig === '\\' || sig === '{' || sig === '}') {
        texto += sig;
        i += 2;
        continue;
      }
      if (sig === '~') {
        texto += ' ';
        i += 2;
        continue;
      }
      const m = /^\\([a-z]+)(-?\d+)? ?/i.exec(s.slice(i, i + 40));
      if (!m) {
        i += 2;
        continue;
      }
      const [todo, palabra, num] = m;
      i += todo.length;
      if (palabra === 'u' && num !== undefined) {
        let cp = Number(num);
        if (cp < 0) cp += 65536;
        texto += String.fromCodePoint(cp);
        saltar = uc;
      } else if (palabra === 'uc' && num !== undefined) uc = Number(num);
      else if (palabra === 'par' || palabra === 'line' || palabra === 'sect' || palabra === 'page' || palabra === 'row') texto += '\n';
      else if (palabra === 'tab' || palabra === 'cell') texto += '\t';
      continue;
    }
    if (c === '\r' || c === '\n') {
      i++;
      continue;
    }
    if (saltar > 0) {
      saltar--;
      i++;
      continue;
    }
    texto += c;
    i++;
  }
  // Windows-1252 en los huecos que latin1 no cubre (comillas tipográficas, raya).
  const cp1252: Record<string, string> = { '\u0091': '‘', '\u0092': '’', '\u0093': '“', '\u0094': '”', '\u0096': '–', '\u0097': '—', '\u0085': '…' };
  return limpio(texto.replace(/[\u0085\u0091-\u0097]/g, (x) => cp1252[x] || x));
}

export function paginasDeRtf(datos: Buffer): PaginaLeida[] {
  const texto = textoDeRtf(datos);
  return texto ? [{ pagina: 1, texto }] : [];
}

/* -------------------------------------------------------------------------------- .pptx */

/** Una diapositiva por página, en su orden, con las notas del orador al final de cada una. */
export async function paginasDePptx(datos: Buffer): Promise<PaginaLeida[]> {
  const zip = await abrirZip(datos);
  const num = (n: string) => Number(/(\d+)\.xml$/.exec(n)?.[1] || 0);
  const diapos = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => num(a) - num(b));
  const textoXml = (xml: string) =>
    limpio(
      desescapar(
        xml
          .replace(/<a:p[ >]/g, '\n<a:p ')
          .replace(/<a:br\b[^>]*\/?>/g, '\n')
          .replace(/<\/a:tc>/g, '\t')
          .replace(/<[^>]+>/g, (t) => (t.startsWith('<a:t') || t.startsWith('</a:t') ? '' : ''))
      )
    );
  const out: PaginaLeida[] = [];
  for (const n of diapos) {
    const xml = await zip.file(n)!.async('text');
    let texto = textoXml(xml);
    const nota = zip.file(`ppt/notesSlides/notesSlide${num(n)}.xml`);
    if (nota) {
      const t = textoXml(await nota.async('text')).replace(/^\d+$/m, '').trim();
      if (t) texto += `\n\nNotas: ${t}`;
    }
    out.push({ pagina: num(n), texto: texto.trim() });
  }
  return out.filter((p) => p.texto);
}

/* -------------------------------------------------------------------------------- .xlsx */

function columnaANumero(ref: string): number {
  const letras = /^[A-Z]+/.exec(ref)?.[0] || 'A';
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Una hoja por página. Cada fila sale como una línea con las celdas separadas por « | », y la
 * primera fila (casi siempre los encabezados) se repite como guía cada 40 filas: un trozo del
 * medio de una tabla de ensayos sin sus encabezados no dice qué es cada número.
 */
export async function paginasDeXlsx(datos: Buffer, maxFilas = 5000): Promise<PaginaLeida[]> {
  const zip = await abrirZip(datos);
  const compartidas: string[] = [];
  const ss = zip.file('xl/sharedStrings.xml');
  if (ss) {
    const xml = await ss.async('text');
    for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) || []) {
      compartidas.push(desescapar((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
    }
  }
  // Nombres de las hojas, en el orden del libro.
  const libro = (await zip.file('xl/workbook.xml')?.async('text')) || '';
  const rels = (await zip.file('xl/_rels/workbook.xml.rels')?.async('text')) || '';
  const destino: Record<string, string> = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)) destino[m[1]] = m[2];
  for (const m of rels.matchAll(/<Relationship\b[^>]*\bTarget="([^"]+)"[^>]*\bId="([^"]+)"/g)) destino[m[2]] ??= m[1];
  const hojas: Array<{ nombre: string; ruta: string }> = [];
  for (const m of libro.matchAll(/<sheet\b[^>]*>/g)) {
    const nombre = desescapar(/name="([^"]*)"/.exec(m[0])?.[1] || '');
    const rid = /r:id="([^"]*)"/.exec(m[0])?.[1] || '';
    let ruta = destino[rid] || '';
    if (!ruta) continue;
    ruta = ruta.startsWith('/') ? ruta.slice(1) : `xl/${ruta.replace(/^\.\//, '')}`;
    hojas.push({ nombre, ruta });
  }
  const out: PaginaLeida[] = [];
  let pagina = 0;
  for (const h of hojas) {
    pagina++;
    const f = zip.file(h.ruta);
    if (!f) continue;
    const xml = await f.async('text');
    const filas: string[] = [];
    let encabezado = '';
    for (const fila of xml.match(/<row\b[\s\S]*?<\/row>/g) || []) {
      const celdas: string[] = [];
      for (const c of fila.match(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
        const ref = /\br="([A-Z]+)\d+"/.exec(c)?.[1] || '';
        const tipo = /\bt="([^"]+)"/.exec(c)?.[1] || '';
        let v = /<v>([\s\S]*?)<\/v>/.exec(c)?.[1];
        if (tipo === 'inlineStr') v = (c.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('');
        if (v === undefined) continue;
        let valor = tipo === 's' ? compartidas[Number(v)] ?? '' : desescapar(v);
        if (tipo === 'b') valor = v === '1' ? 'sí' : 'no';
        valor = valor.replace(/\s+/g, ' ').trim();
        if (!valor) continue;
        const col = ref ? columnaANumero(ref) : celdas.length;
        celdas[col] = valor;
      }
      const linea = Array.from(celdas, (x) => x ?? '').join(' | ').replace(/( \| )+$/, '').replace(/^( \| )+/, '');
      if (!linea.trim()) continue;
      if (!encabezado) {
        encabezado = linea;
        continue;
      }
      if (filas.length > 0 && filas.length % 40 === 0) filas.push(`[${encabezado}]`);
      filas.push(linea);
      if (filas.length >= maxFilas) {
        filas.push(`… (la hoja sigue; se leyeron las primeras ${maxFilas} filas)`);
        break;
      }
    }
    const cuerpo = [encabezado, ...filas].filter(Boolean).join('\n');
    if (cuerpo.trim()) out.push({ pagina, texto: `Hoja «${h.nombre}»\n${cuerpo}` });
  }
  return out;
}
