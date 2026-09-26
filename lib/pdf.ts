/**
 * ESCRITOR DE DOCUMENTOS PDF — sin dependencias, multipágina, con métricas de fuente reales.
 *
 * Lo que había antes era una página suelta: sesenta líneas como máximo, cortadas a noventa y dos
 * CARACTERES. Helvetica es proporcional, así que una línea de emes se salía del papel y una de íes
 * dejaba medio folio en blanco. Para una nota de junta pasaba; para una ficha de concesión que
 * alguien va a imprimir y llevar a una reunión, no.
 *
 * Así que acá hay tres cosas que el anterior no tenía:
 *
 *  1. **Métricas de Helvetica.** El ancho real de cada carácter, en milésimas de em. Es la
 *     diferencia entre un documento y un volcado de texto. Las vocales acentuadas miden lo mismo
 *     que su letra base en Helvetica, así que se mapean a ella en vez de cargar otra tabla.
 *
 *  2. **Páginas de verdad.** El contenido se derrama: cuando se acaba el folio, empieza otro, con
 *     su numeración y su pie. Una tabla no se parte dejando la cabecera huérfana.
 *
 *  3. **Imágenes JPEG.** Un informe de minería sin el mapa no es un informe. Se eligió JPEG y no
 *     PNG porque los datos de un JPEG se incrustan tal cual con /DCTDecode: PNG exigiría deshacer
 *     su compresión y sus predictores para volver a comprimirla, mucho código para nada. El lienzo
 *     de MapLibre ya nace con `preserveDrawingBuffer`, así que la captura sale de ahí.
 *
 * El texto va sin comprimir a propósito: un PDF de un informe pesa unos kilobytes y poder abrirlo
 * con un editor de texto para ver qué se escribió vale más que esos kilobytes.
 */

/* ------------------------------------------------------------------ métricas */

// Helvetica, milésimas de em. Es la tabla de Adobe, no una aproximación.
const W_REG: Record<string, number> = {};
const W_BOLD: Record<string, number> = {};

function cargar(tabla: Record<string, number>, pares: string) {
  for (const p of pares.split(' ')) {
    const i = p.lastIndexOf(':');
    const chars = p.slice(0, i);
    const w = Number(p.slice(i + 1));
    for (const c of chars) tabla[c] = w;
  }
}

cargar(
  W_REG,
  ' :278 !:278 ":355 #:556 $:556 %:889 &:667 \':191 (:333 ):333 *:389 +:584 ,:278 -:333 .:278 /:278 ' +
    '0123456789:556 ::278 ;:278 <:584 =:584 >:584 ?:556 @:1015 ' +
    'A:667 B:667 C:722 D:722 E:667 F:611 G:778 H:722 I:278 J:500 K:667 L:556 M:833 N:722 O:778 P:667 Q:778 R:722 S:667 T:611 U:722 V:667 W:944 X:667 Y:667 Z:611 ' +
    '[:278 \\:278 ]:278 ^:469 _:556 `:333 ' +
    'a:556 b:556 c:500 d:556 e:556 f:278 g:556 h:556 i:222 j:222 k:500 l:222 m:833 n:556 o:556 p:556 q:556 r:333 s:500 t:278 u:556 v:500 w:722 x:500 y:500 z:500 ' +
    '{:334 |:260 }:334 ~:584 «»:556 ·:278 °:400 –—:556 ‘’:222 “”:333 €:556 ¿:611 ¡:333 ±:584 ×:584'
);
cargar(
  W_BOLD,
  ' :278 !:333 ":474 #:556 $:556 %:889 &:722 \':238 (:333 ):333 *:389 +:584 ,:278 -:333 .:278 /:278 ' +
    '0123456789:556 ::333 ;:333 <:584 =:584 >:584 ?:611 @:975 ' +
    'A:722 B:722 C:722 D:722 E:667 F:611 G:778 H:722 I:278 J:556 K:722 L:611 M:833 N:722 O:778 P:667 Q:778 R:722 S:667 T:611 U:722 V:667 W:944 X:667 Y:667 Z:611 ' +
    '[:333 \\:278 ]:333 ^:584 _:556 `:333 ' +
    'a:556 b:611 c:556 d:611 e:556 f:333 g:611 h:611 i:278 j:278 k:556 l:278 m:889 n:611 o:611 p:611 q:611 r:389 s:556 t:333 u:611 v:556 w:778 x:556 y:556 z:500 ' +
    '{:389 |:280 }:389 ~:584 «»:556 ·:278 °:400 –—:556 ‘’:278 “”:500 €:556 ¿:611 ¡:333 ±:584 ×:584'
);

/** Las acentuadas miden lo mismo que su letra base en Helvetica. Una tabla menos que mantener. */
const BASE: Record<string, string> = {};
for (const [acentos, base] of [
  ['áàâäãå', 'a'], ['éèêë', 'e'], ['íìîï', 'i'], ['óòôöõ', 'o'], ['úùûü', 'u'],
  ['ñ', 'n'], ['ç', 'c'], ['ý', 'y'],
  ['ÁÀÂÄÃÅ', 'A'], ['ÉÈÊË', 'E'], ['ÍÌÎÏ', 'I'], ['ÓÒÔÖÕ', 'O'], ['ÚÙÛÜ', 'U'],
  ['Ñ', 'N'], ['Ç', 'C'],
] as const) {
  for (const c of acentos) BASE[c] = base;
}

export type Fuente = 'reg' | 'bold' | 'ital';

function anchoTexto(texto: string, tam: number, fuente: Fuente): number {
  const tabla = fuente === 'bold' ? W_BOLD : W_REG;
  let m = 0;
  for (const c of texto) m += tabla[c] ?? tabla[BASE[c]] ?? 500;
  return (m * tam) / 1000;
}

/** Parte un texto en líneas que caben en `ancho`. Una palabra más larga que la caja se trocea. */
function partir(texto: string, ancho: number, tam: number, fuente: Fuente): string[] {
  const salida: string[] = [];
  for (const crudo of String(texto).replace(/\r\n/g, '\n').split('\n')) {
    let linea = '';
    for (const palabra of crudo.split(/\s+/)) {
      if (!palabra) continue;
      const cand = linea ? `${linea} ${palabra}` : palabra;
      if (anchoTexto(cand, tam, fuente) <= ancho) {
        linea = cand;
        continue;
      }
      if (linea) salida.push(linea);
      if (anchoTexto(palabra, tam, fuente) <= ancho) {
        linea = palabra;
        continue;
      }
      let trozo = '';
      for (const c of palabra) {
        if (anchoTexto(trozo + c, tam, fuente) > ancho) {
          salida.push(trozo);
          trozo = c;
        } else trozo += c;
      }
      linea = trozo;
    }
    salida.push(linea);
  }
  return salida;
}

/** Recorta a lo que quepa en `ancho`, con puntos suspensivos si sobra. Para celdas de tabla. */
function recortar(texto: string, ancho: number, tam: number, fuente: Fuente): string {
  if (anchoTexto(texto, tam, fuente) <= ancho) return texto;
  let out = '';
  for (const c of texto) {
    if (anchoTexto(`${out}${c}…`, tam, fuente) > ancho) break;
    out += c;
  }
  return `${out}…`;
}

/* ------------------------------------------------------------------ escapes */

/**
 * A WinAnsi, que es lo que declara la fuente. Los caracteres fuera de Latin-1 se sustituyen por su
 * equivalente más cercano en vez de por «?»: un informe con «—» convertido en «-» se lee; uno con
 * interrogantes de relleno parece roto.
 */
const SUSTITUTOS: Record<string, string> = { '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', ' ': ' ', '→': '->' };

function winAnsi(s: string): string {
  let out = '';
  for (const ch of String(s)) {
    const sub = SUSTITUTOS[ch];
    if (sub !== undefined) {
      out += sub;
      continue;
    }
    if (ch === '(' || ch === ')' || ch === '\\') {
      out += `\\${ch}`;
      continue;
    }
    const c = ch.charCodeAt(0);
    if (c === 9) { out += ' '; continue; }
    if (c < 32) continue;
    if (c < 128) { out += ch; continue; }
    if (c < 256) { out += `\\${c.toString(8).padStart(3, '0')}`; continue; }
    const b = BASE[ch];
    out += b ? b : '?';
  }
  return out;
}

/* ------------------------------------------------------------------ bloques */

export type Bloque =
  | { tipo: 'titulo'; texto: string }
  | { tipo: 'seccion'; texto: string }
  | { tipo: 'parrafo'; texto: string }
  /** Etiqueta y valor, como una ficha. La etiqueta va en una columna fija. */
  | { tipo: 'campos'; filas: Array<[string, string]> }
  | { tipo: 'tabla'; cabecera: string[]; filas: string[][]; anchos?: number[] }
  /** Texto de un expediente, con su documento y página. Sangrado y en cursiva. */
  | { tipo: 'cita'; texto: string; fuente: string }
  /** Lo que hay que leer sí o sí: contradicciones, vencimientos, traslapes. */
  | { tipo: 'aviso'; texto: string }
  | { tipo: 'nota'; texto: string }
  | { tipo: 'regla' }
  | { tipo: 'espacio'; alto?: number }
  | { tipo: 'imagen'; jpeg: Buffer; ancho: number; alto: number; pie?: string }
  | { tipo: 'pagina' };

export type Documento = {
  titulo: string;
  subtitulo?: string;
  bloques: Bloque[];
  pie: string;
  /** Color de acento, 0–1. Ámbar de Dr Electrum por defecto. */
  acento?: [number, number, number];
};

const ANCHO_PAG = 612;
const ALTO_PAG = 792;
const MARGEN = 54;
const ANCHO = ANCHO_PAG - MARGEN * 2; // 504
const BASE_LINEA = 0; // y del pie
/** Tope de altura de una imagen: un mapa no debe ocupar el folio entero de un informe. */
const ALTO_IMAGEN = 300;

/** Cuánto mide una imagen ya encajada: nunca más ancha que la caja ni más alta que el tope. */
function encajar(ancho: number, alto: number): { w: number; h: number } {
  const escala = Math.min(1, ANCHO / ancho, ALTO_IMAGEN / alto);
  return { w: ancho * escala, h: alto * escala };
}

type Imagen = { jpeg: Buffer; ancho: number; alto: number; nombre: string };

class Lienzo {
  paginas: string[][] = [];
  ops: string[] = [];
  y = ALTO_PAG - MARGEN;
  imagenes: Imagen[] = [];
  constructor(private acento: [number, number, number]) {}

  nuevaPagina() {
    if (this.ops.length) this.paginas.push(this.ops);
    this.ops = [];
    this.y = ALTO_PAG - MARGEN;
  }

  /** ¿Cabe `alto` en lo que queda del folio? Sin reservar nada. */
  cabe(alto: number): boolean {
    return this.y - alto >= MARGEN + 28;
  }

  /** Reserva `alto` puntos; si no caben, pasa de página. Devuelve la y donde dibujar. */
  sitio(alto: number): number {
    if (!this.cabe(alto)) this.nuevaPagina();
    this.y -= alto;
    return this.y;
  }

  texto(s: string, x: number, y: number, tam: number, fuente: Fuente, gris = 0) {
    const f = fuente === 'bold' ? '/F2' : fuente === 'ital' ? '/F3' : '/F1';
    this.ops.push('BT', `${f} ${tam} Tf`, `${gris} g`, `1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm`, `(${winAnsi(s)}) Tj`, 'ET');
  }

  textoAcento(s: string, x: number, y: number, tam: number, fuente: Fuente) {
    const [r, g, b] = this.acento;
    const f = fuente === 'bold' ? '/F2' : '/F1';
    this.ops.push('BT', `${f} ${tam} Tf`, `${r} ${g} ${b} rg`, `1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm`, `(${winAnsi(s)}) Tj`, 'ET', '0 g');
  }

  linea(x1: number, y1: number, x2: number, y2: number, grosor = 0.6, gris = 0.75) {
    this.ops.push(`${gris} G`, `${grosor} w`, `${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`, '0 G');
  }

  caja(x: number, y: number, ancho: number, alto: number, gris: number) {
    this.ops.push(`${gris} g`, `${x.toFixed(2)} ${y.toFixed(2)} ${ancho.toFixed(2)} ${alto.toFixed(2)} re f`, '0 g');
  }

  barraAcento(x: number, y: number, ancho: number, alto: number) {
    const [r, g, b] = this.acento;
    this.ops.push(`${r} ${g} ${b} rg`, `${x.toFixed(2)} ${y.toFixed(2)} ${ancho.toFixed(2)} ${alto.toFixed(2)} re f`, '0 g');
  }

  imagen(img: Imagen, x: number, y: number, ancho: number, alto: number) {
    this.ops.push('q', `${ancho.toFixed(2)} 0 0 ${alto.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm`, `/${img.nombre} Do`, 'Q');
  }

  cerrar(): string[][] {
    if (this.ops.length) this.paginas.push(this.ops);
    this.ops = [];
    return this.paginas;
  }
}

/* ------------------------------------------------------------------ maquetar */

function dibujarTabla(L: Lienzo, b: Extract<Bloque, { tipo: 'tabla' }>) {
  const cols = b.cabecera.length;
  const pesos = b.anchos && b.anchos.length === cols ? b.anchos : new Array(cols).fill(1);
  const suma = pesos.reduce((a, c) => a + c, 0) || 1;
  const anchos = pesos.map((p) => (p / suma) * ANCHO);
  const xs: number[] = [];
  let acc = MARGEN;
  for (const a of anchos) { xs.push(acc); acc += a; }

  const cabecera = () => {
    const y = L.sitio(20);
    L.caja(MARGEN, y - 4, ANCHO, 18, 0.93);
    b.cabecera.forEach((c, i) => L.texto(recortar(c, anchos[i] - 8, 8.5, 'bold'), xs[i] + 4, y + 2, 8.5, 'bold', 0.15));
  };
  cabecera();

  for (const fila of b.filas) {
    // Una fila se dibuja entera o pasa al folio siguiente: partirla por la mitad es ilegible. Y si
    // pasa, la cabecera se repite arriba, porque una tabla sin cabecera no se puede leer.
    const lineasPorCelda = fila.map((c, i) => partir(String(c ?? ''), anchos[i] - 8, 8.5, 'reg'));
    const alto = Math.max(1, ...lineasPorCelda.map((l) => l.length)) * 11 + 5;
    if (!L.cabe(alto)) {
      L.nuevaPagina();
      cabecera();
    }
    const y = L.sitio(alto);
    lineasPorCelda.forEach((lineas, i) => {
      lineas.forEach((ln, j) => L.texto(ln, xs[i] + 4, y + alto - 11 - j * 11, 8.5, 'reg', 0.1));
    });
    L.linea(MARGEN, y - 2, MARGEN + ANCHO, y - 2, 0.4, 0.85);
  }
  L.sitio(6);
}

/**
 * Cuánto ocupa lo PRIMERO que dibuja un bloque, sin partirlo.
 *
 * Existe por los títulos huérfanos: un «EL MAPA» al pie de un folio con su imagen en el siguiente
 * es de las cosas que un lector nota sin saber qué le molesta. Un título tiene que arrastrar
 * consigo al menos el principio de lo que titula, y para decidirlo hay que saber cuánto mide.
 */
function altoPrimeraUnidad(b: Bloque | undefined): number {
  if (!b) return 0;
  switch (b.tipo) {
    case 'imagen':
      // Una imagen no se parte nunca, así que su primera unidad es toda ella.
      return encajar(b.ancho, b.alto).h + (b.pie ? 14 : 0) + 8;
    case 'tabla':
      return 20 + 16; // la cabecera y una fila
    case 'campos':
      return b.filas.length ? 13.5 : 0;
    case 'parrafo':
      return 27; // dos renglones: una sola línea bajo un título sigue pareciendo huérfana
    case 'cita':
    case 'aviso':
      return 38;
    case 'nota':
      return 23;
    case 'titulo':
    case 'seccion':
      return 24;
    default:
      return 12;
  }
}

function maquetar(doc: Documento, L: Lienzo) {
  // Cabecera de la primera página: barra de acento y título. Es lo que hace que se vea de alguien.
  L.barraAcento(MARGEN, L.sitio(22) + 12, 46, 3);
  const yT = L.sitio(24);
  L.texto(doc.titulo, MARGEN, yT, 19, 'bold', 0.08);
  if (doc.subtitulo) {
    const yS = L.sitio(16);
    L.texto(doc.subtitulo, MARGEN, yS, 10, 'reg', 0.42);
  }
  L.sitio(10);

  for (let i = 0; i < doc.bloques.length; i += 1) {
    const b = doc.bloques[i];

    /*
     * Un título no se queda solo al pie con su contenido en el folio siguiente.
     *
     * El primer intento de esta regla pedía «media página» de acompañamiento y no servía: un mapa
     * de cuatrocientos puntos de alto pasaba el corte de trescientos cuarenta, el título se
     * quedaba, y la imagen se iba igual. La condición buena no es cuánto se pide: es si los dos
     * JUNTOS caben en un folio limpio. Si no caben ni así, romper no arregla nada y solo deja un
     * folio en blanco, de modo que ahí el título se queda donde está.
     */
    if (b.tipo === 'seccion' || b.tipo === 'titulo') {
      const necesita = (b.tipo === 'titulo' ? 26 : 24) + altoPrimeraUnidad(doc.bloques[i + 1]);
      if (!L.cabe(necesita) && necesita <= ALTO_PAG - MARGEN * 2 - 28) L.nuevaPagina();
    }

    switch (b.tipo) {
      case 'pagina':
        L.nuevaPagina();
        break;

      case 'titulo': {
        const y = L.sitio(26);
        L.texto(b.texto, MARGEN, y, 15, 'bold', 0.08);
        break;
      }

      case 'seccion': {
        const y = L.sitio(24);
        L.textoAcento(b.texto.toUpperCase(), MARGEN, y, 9, 'bold');
        L.linea(MARGEN, y - 5, MARGEN + ANCHO, y - 5, 0.6, 0.8);
        L.sitio(4);
        break;
      }

      case 'parrafo':
        for (const ln of partir(b.texto, ANCHO, 10, 'reg')) {
          L.texto(ln, MARGEN, L.sitio(13.5), 10, 'reg', 0.12);
        }
        L.sitio(5);
        break;

      case 'nota':
        for (const ln of partir(b.texto, ANCHO, 8.5, 'ital')) {
          L.texto(ln, MARGEN, L.sitio(11.5), 8.5, 'ital', 0.45);
        }
        L.sitio(4);
        break;

      case 'campos': {
        const etiqueta = 128;
        for (const [k, v] of b.filas) {
          const lineas = partir(String(v ?? ''), ANCHO - etiqueta, 10, 'reg');
          const alto = Math.max(1, lineas.length) * 13.5;
          const y = L.sitio(alto);
          L.texto(recortar(k, etiqueta - 8, 9, 'bold'), MARGEN, y + alto - 12, 9, 'bold', 0.38);
          lineas.forEach((ln, i) => L.texto(ln, MARGEN + etiqueta, y + alto - 12 - i * 13.5, 10, 'reg', 0.1));
        }
        L.sitio(6);
        break;
      }

      case 'tabla':
        dibujarTabla(L, b);
        break;

      case 'cita': {
        const lineas = partir(b.texto, ANCHO - 26, 9.5, 'ital');
        const alto = lineas.length * 12.5 + 14;
        const y = L.sitio(alto);
        L.barraAcento(MARGEN, y + 2, 2, alto - 4);
        lineas.forEach((ln, i) => L.texto(ln, MARGEN + 14, y + alto - 12 - i * 12.5, 9.5, 'ital', 0.2));
        L.texto(b.fuente, MARGEN + 14, y + 2, 8, 'reg', 0.5);
        L.sitio(6);
        break;
      }

      case 'aviso': {
        const lineas = partir(b.texto, ANCHO - 26, 9.5, 'bold');
        const alto = lineas.length * 12.5 + 12;
        const y = L.sitio(alto);
        L.caja(MARGEN, y, ANCHO, alto, 0.95);
        L.barraAcento(MARGEN, y, 3, alto);
        lineas.forEach((ln, i) => L.texto(ln, MARGEN + 14, y + alto - 14 - i * 12.5, 9.5, 'bold', 0.15));
        L.sitio(7);
        break;
      }

      case 'regla': {
        const y = L.sitio(12);
        L.linea(MARGEN, y + 4, MARGEN + ANCHO, y + 4, 0.6, 0.82);
        break;
      }

      case 'espacio':
        L.sitio(b.alto ?? 12);
        break;

      case 'imagen': {
        const { w, h } = encajar(b.ancho, b.alto);
        const altoPie = b.pie ? 14 : 0;
        const y = L.sitio(h + altoPie + 8);
        const img: Imagen = { jpeg: b.jpeg, ancho: b.ancho, alto: b.alto, nombre: `Im${L.imagenes.length + 1}` };
        L.imagenes.push(img);
        L.imagen(img, MARGEN, y + altoPie + 4, w, h);
        L.linea(MARGEN, y + altoPie + 4, MARGEN + w, y + altoPie + 4, 0.5, 0.8);
        if (b.pie) L.texto(b.pie, MARGEN, y + 2, 8, 'ital', 0.45);
        break;
      }
    }
  }
}

/* ------------------------------------------------------------------ escribir */

/** Cabecera SOF de un JPEG: alto y ancho reales y cuántos componentes de color tiene. */
export function medirJpeg(buf: Buffer): { ancho: number; alto: number; componentes: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marca = buf[i + 1];
    if (marca === 0xd8 || marca === 0x01 || (marca >= 0xd0 && marca <= 0xd7)) { i += 2; continue; }
    const largo = buf.readUInt16BE(i + 2);
    // SOF0..SOF15 menos los de tablas (C4 huffman, C8 reservado, CC aritmética)
    if (marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc) {
      return { alto: buf.readUInt16BE(i + 5), ancho: buf.readUInt16BE(i + 7), componentes: buf[i + 9] };
    }
    i += 2 + largo;
  }
  return null;
}

export function documentoPdf(doc: Documento): Buffer {
  const L = new Lienzo(doc.acento || [1, 0.68, 0.23]);
  maquetar(doc, L);
  const paginas = L.cerrar();
  if (!paginas.length) paginas.push([]);

  // Pie y numeración, al final: hasta acá no se sabía cuántas páginas iban a salir.
  const total = paginas.length;
  paginas.forEach((ops, i) => {
    const pie = `${doc.pie}`;
    const num = `${i + 1} / ${total}`;
    ops.push(
      '0.82 G', '0.5 w', `${MARGEN} ${MARGEN + 16} m ${MARGEN + ANCHO} ${MARGEN + 16} l S`, '0 G',
      'BT', '/F1 8 Tf', '0.5 g', `1 0 0 1 ${MARGEN} ${MARGEN + BASE_LINEA + 4} Tm`, `(${winAnsi(pie)}) Tj`, 'ET',
      'BT', '/F1 8 Tf', '0.5 g', `1 0 0 1 ${(MARGEN + ANCHO - anchoTexto(num, 8, 'reg')).toFixed(2)} ${MARGEN + BASE_LINEA + 4} Tm`, `(${winAnsi(num)}) Tj`, 'ET',
      '0 g'
    );
  });

  /* --- objetos --- */
  const objetos: Array<string | Buffer> = [];
  const push = (o: string | Buffer) => objetos.push(o) && objetos.length;

  const idCatalogo = push('PENDIENTE');
  const idPaginas = push('PENDIENTE');
  const idF1 = push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const idF2 = push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const idF3 = push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>');

  const idsImg: number[] = [];
  for (const img of L.imagenes) {
    const medida = medirJpeg(img.jpeg);
    const espacio = medida?.componentes === 1 ? '/DeviceGray' : medida?.componentes === 4 ? '/DeviceCMYK' : '/DeviceRGB';
    const cab = `<< /Type /XObject /Subtype /Image /Width ${medida?.ancho || img.ancho} /Height ${medida?.alto || img.alto} /ColorSpace ${espacio} /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`;
    idsImg.push(push(Buffer.concat([Buffer.from(cab, 'latin1'), img.jpeg, Buffer.from('\nendstream', 'latin1')])));
  }

  const recursos = `<< /Font << /F1 ${idF1} 0 R /F2 ${idF2} 0 R /F3 ${idF3} 0 R >>${
    idsImg.length ? ` /XObject << ${L.imagenes.map((im, i) => `/${im.nombre} ${idsImg[i]} 0 R`).join(' ')} >>` : ''
  } >>`;

  const idsPagina: number[] = [];
  for (const ops of paginas) {
    const flujo = ops.join('\n');
    const idContenido = push(`<< /Length ${Buffer.byteLength(flujo, 'latin1')} >>\nstream\n${flujo}\nendstream`);
    idsPagina.push(
      push(`<< /Type /Page /Parent ${idPaginas} 0 R /MediaBox [0 0 ${ANCHO_PAG} ${ALTO_PAG}] /Contents ${idContenido} 0 R /Resources ${recursos} >>`)
    );
  }

  objetos[idCatalogo - 1] = `<< /Type /Catalog /Pages ${idPaginas} 0 R >>`;
  objetos[idPaginas - 1] = `<< /Type /Pages /Kids [${idsPagina.map((i) => `${i} 0 R`).join(' ')}] /Count ${idsPagina.length} >>`;

  /* --- ensamblar --- */
  const trozos: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let pos = trozos[0].length;
  const offsets: number[] = [0];
  objetos.forEach((o, i) => {
    offsets.push(pos);
    const cuerpo = typeof o === 'string' ? Buffer.from(o, 'latin1') : o;
    const t = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), cuerpo, Buffer.from('\nendobj\n', 'latin1')]);
    trozos.push(t);
    pos += t.length;
  });

  const inicioXref = pos;
  let xref = `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objetos.length; i += 1) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objetos.length + 1} /Root ${idCatalogo} 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
  trozos.push(Buffer.from(xref, 'latin1'));

  return Buffer.concat(trozos);
}

/**
 * Lo de siempre: título, cuerpo y pie en una página. Media docena de sitios de AU-RA la llaman,
 * así que sigue existiendo — ahora sobre el escritor nuevo, o sea que ya parte por ancho real y
 * se derrama a otra página en vez de cortar a las sesenta líneas.
 */
export function textoAPdf(opts: { titulo: string; cuerpo: string; pie?: string }): Buffer {
  return documentoPdf({
    titulo: String(opts.titulo || 'AU-RA').slice(0, 90),
    bloques: [{ tipo: 'parrafo', texto: String(opts.cuerpo || '') }],
    pie: String(opts.pie || `AU-RA FP · ${new Date().toISOString().slice(0, 16)} UTC`),
    acento: [0.13, 0.72, 0.85],
  });
}
