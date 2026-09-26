/**
 * El escritor de PDF.
 *
 * Un PDF no se prueba mirando su texto: se prueba comprobando que la ESTRUCTURA es la que un lector
 * espera encontrar, porque si el xref miente ningún visor lo abre y no hay error que lo avise. Lo
 * que no se puede afirmar acá —que se vea bien— se comprueba renderizándolo:
 * `scripts/qa/ver-pdf.mjs`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { documentoPdf, medirJpeg, textoAPdf, type Bloque } from '../lib/pdf';

function leer(pdf: Buffer) {
  const s = pdf.toString('latin1');
  return {
    s,
    paginas: (s.match(/\/Type \/Page[^s]/g) || []).length,
    objetos: (s.match(/^\d+ 0 obj$/gm) || []).length,
  };
}

/** Comprueba que cada offset del xref cae justo donde empieza su objeto. */
function xrefCoherente(pdf: Buffer): boolean {
  const s = pdf.toString('latin1');
  const i = s.lastIndexOf('xref\n');
  if (i < 0) return false;
  const lineas = s.slice(i).split('\n');
  const [, total] = lineas[1].split(' ').map(Number);
  for (let n = 1; n < total; n += 1) {
    const off = Number(lineas[1 + n + 1].slice(0, 10));
    if (!s.startsWith(`${n} 0 obj`, off)) return false;
  }
  return true;
}

test('escritor de PDF', async (t) => {
  await t.test('un documento mínimo es un PDF válido y coherente', () => {
    const pdf = documentoPdf({ titulo: 'Prueba', bloques: [{ tipo: 'parrafo', texto: 'Hola.' }], pie: 'pie' });
    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.ok(pdf.toString('latin1').trimEnd().endsWith('%%EOF'));
    assert.equal(leer(pdf).paginas, 1);
    assert.ok(xrefCoherente(pdf), 'el xref apunta a donde empieza cada objeto');
  });

  await t.test('el texto se derrama a más páginas en vez de cortarse', () => {
    // El escritor viejo cortaba a las sesenta líneas y tiraba el resto sin decir nada.
    // Sin acentos a propósito: dentro del PDF la «ó» va como \363 y buscar la cadena tal cual
    // fallaría por la codificación, no por el contenido.
    const largo = Array.from({ length: 400 }, (_, i) => `Renglon numero ${i} del informe.`).join('\n');
    const pdf = documentoPdf({ titulo: 'Largo', bloques: [{ tipo: 'parrafo', texto: largo }], pie: 'pie' });
    const { s, paginas } = leer(pdf);
    assert.ok(paginas >= 6, `esperaba varias páginas, salieron ${paginas}`);
    assert.ok(s.includes('Renglon numero 399'), 'la última línea tiene que estar en el documento');
    assert.ok(xrefCoherente(pdf));
  });

  await t.test('parte por ancho real, no por número de caracteres', () => {
    // Una eme mide 833 milésimas y una i 222: casi cuatro veces. Cortar a un número fijo de
    // caracteres hacía que una línea de emes se saliera del papel y una de íes dejara medio folio.
    const emes = documentoPdf({ titulo: 'M', bloques: [{ tipo: 'parrafo', texto: 'M'.repeat(300) }], pie: 'p' });
    const ies = documentoPdf({ titulo: 'i', bloques: [{ tipo: 'parrafo', texto: 'i'.repeat(300) }], pie: 'p' });
    // Se cuentan los renglones dibujados descontando los fijos (título y las dos líneas de pie),
    // que si no se comparan peras con manzanas.
    const cuerpo = (b: Buffer) => (b.toString('latin1').match(/\) Tj/g) || []).length - 3;
    assert.ok(cuerpo(emes) >= cuerpo(ies) * 2, `emes ${cuerpo(emes)} renglones, íes ${cuerpo(ies)}: la eme mide 833 milésimas y la i 222`);
  });

  await t.test('los acentos van en WinAnsi, no en interrogantes', () => {
    const pdf = documentoPdf({ titulo: 'Ñandú', bloques: [{ tipo: 'parrafo', texto: 'José, María, ácido, «citas»' }], pie: 'p' });
    const s = pdf.toString('latin1');
    assert.ok(s.includes('/WinAnsiEncoding'), 'la fuente declara la codificación');
    assert.ok(s.includes('\\321andu'.replace('andu', '')) || s.includes('\\321'), 'la Ñ va como octal 321');
    assert.ok(s.includes('\\351'), 'la é va como octal 351');
    assert.ok(!/\?andu/.test(s), 'nada de interrogantes de relleno');
  });

  await t.test('los paréntesis del texto no rompen el flujo', () => {
    // Un paréntesis sin escapar cierra el literal antes de tiempo y el visor deja de entender la
    // página entera. Es el clásico fallo de escribir PDF a mano.
    const pdf = documentoPdf({ titulo: 'x', bloques: [{ tipo: 'parrafo', texto: 'Ley de corte (marginal) al 90 % \\ prueba' }], pie: 'p' });
    const s = pdf.toString('latin1');
    assert.ok(s.includes('\\(marginal\\)'));
    assert.ok(xrefCoherente(pdf));
  });

  await t.test('un título no se queda solo al pie de la página', () => {
    // Se llena la página casi entera y se pone una sección con una imagen grande detrás: los dos
    // tienen que acabar en el mismo folio.
    const relleno = Array.from({ length: 44 }, (_, i) => `Línea de relleno ${i}.`).join('\n');
    const bloques: Bloque[] = [
      { tipo: 'parrafo', texto: relleno },
      { tipo: 'seccion', texto: 'EL MAPA' },
      { tipo: 'imagen', jpeg: Buffer.alloc(0), ancho: 900, alto: 748 },
    ];
    const pdf = documentoPdf({ titulo: 'x', bloques, pie: 'p' });
    const s = pdf.toString('latin1');
    // Los flujos de contenido, en orden: el que lleva «EL MAPA» tiene que llevar también el
    // dibujo de la imagen. Si el título se quedó huérfano, están en flujos distintos.
    const flujos = s.split('stream\n').slice(1).map((f) => f.split('endstream')[0]);
    const conTitulo = flujos.find((f) => f.includes('EL MAPA'));
    assert.ok(conTitulo, 'el título está en alguna página');
    assert.ok(conTitulo!.includes('/Im1 Do'), 'la imagen tiene que estar en la MISMA página que su título');
  });

  await t.test('medirJpeg saca el tamaño de la cabecera SOF', () => {
    // Un JPEG mínimo: SOI, un SOF0 de 4×8 con tres componentes, EOI.
    const jpeg = Buffer.from([
      0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x08, 0x00, 0x04, 0x03,
      0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
      0xff, 0xd9,
    ]);
    assert.deepEqual(medirJpeg(jpeg), { ancho: 4, alto: 8, componentes: 3 });
    assert.equal(medirJpeg(Buffer.from([1, 2, 3])), null, 'lo que no es JPEG no se mide');
  });

  await t.test('textoAPdf sigue existiendo para AU-RA', () => {
    const pdf = textoAPdf({ titulo: 'Nota de junta', cuerpo: 'Una línea.', pie: 'AU-RA FP' });
    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.ok(pdf.toString('latin1').includes('Nota de junta'));
    assert.ok(xrefCoherente(pdf));
  });
});
