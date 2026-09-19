/**
 * Lectura honesta de PDF: texto de los streams + imágenes embebidas (JPEG y RGB/gris).
 * Sin pdf.js. Si el archivo no trae texto ni imagen usable, se dice.
 */

import zlib from 'node:zlib';

export type PdfLeido = {
  texto: string;
  imagenes: Buffer[];
  paginas: number;
  bytes: number;
  detalle: string;
};

const MAX_TEXTO = 8000;
const MAX_IMAGENES = 4;
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_LADO = 2400;

function esPdf(buf: Buffer) {
  return buf.length > 8 && buf.subarray(0, 5).toString('latin1') === '%PDF-';
}

function unescapePdf(s: string) {
  return s
    .replace(/\\(\d{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8) & 255))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\t/g, ' ')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

function hexATexto(hex: string) {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length < 4 || clean.length % 2) return '';
  const b = Buffer.from(clean, 'hex');
  let i = 0;
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) i = 2;
  let out = '';
  for (; i + 1 < b.length; i += 2) out += String.fromCharCode((b[i] << 8) | b[i + 1]);
  return out;
}

export function textoDeContenidoPdf(contenido: string): string {
  const bits: string[] = [];
  const tj = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = tj.exec(contenido))) bits.push(unescapePdf(m[1]));
  const tjArr = /\[(.*?)\]\s*TJ/gs;
  while ((m = tjArr.exec(contenido))) {
    const inner = m[1];
    const str = /\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f\s]+)>/g;
    let s: RegExpExecArray | null;
    while ((s = str.exec(inner))) {
      if (s[1] !== undefined) bits.push(unescapePdf(s[1]));
      else if (s[2]) bits.push(hexATexto(s[2]));
    }
  }
  const hexTj = /<([0-9A-Fa-f\s]+)>\s*Tj/g;
  while ((m = hexTj.exec(contenido))) bits.push(hexATexto(m[1]));
  return bits
    .join(' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function inflar(bytes: Buffer): Buffer | null {
  try {
    return zlib.inflateSync(bytes);
  } catch {
    try {
      return zlib.inflateRawSync(bytes);
    } catch {
      return null;
    }
  }
}

function dictAntes(raw: Buffer, streamAt: number): string {
  const slice = raw.subarray(Math.max(0, streamAt - 1600), streamAt).toString('latin1');
  const i = slice.lastIndexOf('<<');
  return i >= 0 ? slice.slice(i) : slice;
}

function numDe(dict: string, key: string): number {
  const m = dict.match(new RegExp(`/${key}\\s+(\\d+)`));
  return m ? Number(m[1]) : 0;
}

function crc32(buf: Buffer): number {
  let c = ~0 >>> 0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (~c >>> 0);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

export function pngDePixeles(width: number, height: number, channels: 1 | 3, raw: Buffer): Buffer | null {
  if (width < 1 || height < 1 || width > MAX_LADO || height > MAX_LADO) return null;
  const stride = width * channels;
  if (raw.length < stride * height) return null;
  const lines: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    lines.push(Buffer.from([0]));
    lines.push(raw.subarray(y * stride, y * stride + stride));
  }
  const idat = zlib.deflateSync(Buffer.concat(lines));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 3 ? 2 : 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function deshacerPredictor(data: Buffer, width: number, channels: number, predictor: number): Buffer | null {
  const stride = width * channels;
  if (predictor <= 1) return data;
  if (predictor === 2) {
    const rows = Math.floor(data.length / stride);
    if (rows < 1) return null;
    const out = Buffer.from(data.subarray(0, rows * stride));
    for (let y = 0; y < rows; y++) {
      const row = y * stride;
      for (let i = channels; i < stride; i++) out[row + i] = (out[row + i] + out[row + i - channels]) & 255;
    }
    return out;
  }
  if (predictor < 10 || predictor > 15) return data;
  const rowLen = stride + 1;
  const rows = Math.floor(data.length / rowLen);
  if (rows < 1) return null;
  const out = Buffer.alloc(rows * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < rows; y++) {
    const f = data[y * rowLen];
    const src = data.subarray(y * rowLen + 1, y * rowLen + 1 + stride);
    const dst = out.subarray(y * stride, y * stride + stride);
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? dst[i - channels] : 0;
      const up = prev[i];
      const upLeft = i >= channels ? prev[i - channels] : 0;
      const x = src[i];
      if (f === 1) dst[i] = (x + left) & 255;
      else if (f === 2) dst[i] = (x + up) & 255;
      else if (f === 3) dst[i] = (x + ((left + up) >> 1)) & 255;
      else if (f === 4) dst[i] = (x + paeth(left, up, upLeft)) & 255;
      else dst[i] = x;
    }
    prev = Buffer.from(dst);
  }
  return out;
}

function canalesDe(dict: string): 1 | 3 | 0 {
  if (/\/DeviceGray\b/.test(dict) || /\/ColorSpace\s*\/G\b/.test(dict)) return 1;
  if (/\/DeviceRGB\b/.test(dict) || /\/ColorSpace\s*\/RGB\b/.test(dict)) return 3;
  return 0;
}

function esImagenDict(dict: string): boolean {
  return /\/Subtype\s*\/Image\b/.test(dict) || (/\/Width\s+\d+/.test(dict) && /\/Height\s+\d+/.test(dict) && /\/BitsPerComponent\s+\d+/.test(dict));
}

function extraerStreams(raw: Buffer): { dict: string; bytes: Buffer }[] {
  const out: { dict: string; bytes: Buffer }[] = [];
  const latin = raw.toString('latin1');
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin))) {
    const start = m.index + m[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) break;
    const dict = dictAntes(raw, m.index);
    let bytes = raw.subarray(start, end);
    if (bytes.length && bytes[bytes.length - 1] === 13) bytes = bytes.subarray(0, bytes.length - 1);
    out.push({ dict, bytes });
    re.lastIndex = end + 9;
  }
  return out;
}

function jpegDeStream(bytes: Buffer): Buffer | null {
  let i = 0;
  while (i < bytes.length && (bytes[i] === 0x00 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x20)) i++;
  if (i + 2 >= bytes.length || bytes[i] !== 0xff || bytes[i + 1] !== 0xd8) return null;
  const jpeg = i ? bytes.subarray(i) : bytes;
  return jpeg.length > 200 ? jpeg : null;
}

function imagenDeStream(dict: string, bytes: Buffer): Buffer | null {
  const jpeg = jpegDeStream(bytes);
  if (jpeg) return jpeg;
  const w = numDe(dict, 'Width');
  const h = numDe(dict, 'Height');
  const bpc = numDe(dict, 'BitsPerComponent') || 8;
  const ch = canalesDe(dict);
  if (!w || !h || bpc !== 8 || !ch) return null;
  let raw = bytes;
  if (/flatedecode/i.test(dict)) {
    const inf = inflar(bytes);
    if (!inf) return null;
    raw = inf;
  }
  const pred = numDe(dict, 'Predictor') || 1;
  const und = deshacerPredictor(raw, w, ch, pred);
  const png = und ? pngDePixeles(w, h, ch, und) : null;
  if (png) return png;
  if (pred > 1) return pngDePixeles(w, h, ch, raw);
  return null;
}

export function extraerPdf(input: Buffer): PdfLeido {
  const buf = input?.length ? input : Buffer.alloc(0);
  if (buf.length < 8) return { texto: '', imagenes: [], paginas: 0, bytes: buf.length, detalle: 'Archivo vacío. No leí nada.' };
  if (buf.length > MAX_BYTES) {
    return { texto: '', imagenes: [], paginas: 0, bytes: buf.length, detalle: `PDF de ${buf.length} bytes. Máximo 12 MB. No lo abrí.` };
  }
  if (!esPdf(buf)) {
    return { texto: '', imagenes: [], paginas: 0, bytes: buf.length, detalle: 'No es un PDF (%PDF-). No lo leí como documento.' };
  }
  const paginas = (buf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) || []).length;
  const textos: string[] = [];
  const imagenes: Buffer[] = [];
  for (const st of extraerStreams(buf)) {
    const f = st.dict.toLowerCase();
    const jpeg = jpegDeStream(st.bytes);
    const imagen = esImagenDict(st.dict) || /dctdecode/.test(f) || jpeg;
    if (imagen) {
      if (imagenes.length < MAX_IMAGENES) {
        const img = imagenDeStream(st.dict, st.bytes);
        if (img) imagenes.push(img);
      }
      continue;
    }
    let contenido = st.bytes;
    if (/flatedecode/.test(f)) {
      const inf = inflar(st.bytes);
      if (!inf) continue;
      contenido = inf;
    }
    const t = textoDeContenidoPdf(contenido.toString('latin1'));
    if (t) textos.push(t);
  }
  if (!textos.length) {
    const t = textoDeContenidoPdf(buf.toString('latin1'));
    if (t) textos.push(t);
  }
  const texto = textos.join('\n').slice(0, MAX_TEXTO);
  const detalle = texto
    ? `Leí ${texto.length} caracteres de texto` + (imagenes.length ? ` y ${imagenes.length} imagen(es) embebida(s).` : '.')
    : imagenes.length
      ? `Sin texto seleccionable. Hay ${imagenes.length} imagen(es) embebida(s); las mando a visión.`
      : 'PDF sin texto extraíble ni imagen JPEG/RGB embebida. Puede estar escaneado en otro formato. No invento el contenido.';
  return { texto, imagenes, paginas: paginas || (texto ? 1 : 0), bytes: buf.length, detalle };
}

export function dataUrlDeImagen(buf: Buffer) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return `data:image/png;base64,${buf.toString('base64')}`;
  }
  if (buf.length > 6 && buf.toString('ascii', 0, 6) === 'GIF87a') return `data:image/gif;base64,${buf.toString('base64')}`;
  if (buf.length > 6 && buf.toString('ascii', 0, 6) === 'GIF89a') return `data:image/gif;base64,${buf.toString('base64')}`;
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return `data:image/webp;base64,${buf.toString('base64')}`;
  }
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

export function dataUrlDeJpeg(buf: Buffer) {
  return dataUrlDeImagen(buf);
}

export function esImagenNombre(nombre: string, mime: string) {
  const n = String(nombre || '').toLowerCase();
  const m = String(mime || '').toLowerCase();
  return /^image\//.test(m) || /\.(jpe?g|png|webp|gif)$/.test(n);
}

export function esPdfNombre(nombre: string, mime: string) {
  const n = String(nombre || '').toLowerCase();
  const m = String(mime || '').toLowerCase();
  return m === 'application/pdf' || n.endsWith('.pdf');
}

export function bufferDeCualquier(raw: unknown): Buffer | null {
  if (!raw) return null;
  if (Buffer.isBuffer(raw)) return raw.length > 80 ? raw : null;
  if (raw instanceof Uint8Array) return raw.length > 80 ? Buffer.from(raw) : null;
  if (typeof raw === 'string' && raw.length > 80) {
    const m = raw.match(/^data:([^;]+);base64,(.*)$/);
    const b = Buffer.from(m ? m[2] : raw, 'base64');
    return b.length > 80 ? b : null;
  }
  if (typeof raw === 'object' && Array.isArray((raw as any).data)) {
    const b = Buffer.from((raw as any).data);
    return b.length > 80 ? b : null;
  }
  return null;
}
