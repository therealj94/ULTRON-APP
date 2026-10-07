/**
 * Leer un adjunto (lib/leer-adjunto.ts, auditoría del 7-oct, A-5) con archivos de verdad (tests/fixtures/adjuntos): un
 * PDF con texto, un PDF escaneado (sin texto), un Word, un Excel, un CSV en latin1, un texto, la foto de un recibo y un
 * formato que no se lee. El tipo sale de los BYTES, nunca del nombre; lo que no se pudo leer se dice (nunca se inventa);
 * los topes de tamaño y de texto se cumplen; el texto sale en trozos para la voz.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { leerAdjunto, tipoDeAdjunto, MAX_ADJUNTO_BYTES, MAX_TEXTO_ADJUNTO, TROZO_ADJUNTO } from '../lib/leer-adjunto';

const F = (n: string) => fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'adjuntos', n));
/** Sin ojos (ni OCR ni visión): lo que no tiene texto se dice. */
const ciego = { ocr: null, vision: null };

test('el tipo sale de los bytes, no del nombre', () => {
  assert.equal(tipoDeAdjunto({ nombre: 'cotizacion.pdf', datos: F('cotizacion.pdf') }), 'pdf');
  assert.equal(tipoDeAdjunto({ nombre: 'contrato.docx', datos: F('contrato.docx') }), 'word');
  assert.equal(tipoDeAdjunto({ nombre: 'sin-extension', datos: F('contrato.docx') }), 'word', 'un .docx sin extensión se reconoce por dentro');
  assert.equal(tipoDeAdjunto({ nombre: 'ventas.xlsx', datos: F('ventas.xlsx') }), 'excel');
  assert.equal(tipoDeAdjunto({ nombre: 'recibo.jpg', datos: F('recibo.jpg') }), 'imagen');
  assert.equal(tipoDeAdjunto({ nombre: 'falso.pdf', datos: F('falso.pdf') }), 'texto', 'un «.pdf» que es texto no se lee como PDF');
  assert.equal(tipoDeAdjunto({ nombre: 'programa', datos: F('desconocido.bin') }), 'desconocido');
});

test('un PDF con texto: pdf.js, en trozos, con sus cifras tal cual', async () => {
  const r = await leerAdjunto({ nombre: 'cotizacion.pdf', mime: 'application/pdf', datos: F('cotizacion.pdf') }, { ojos: ciego });
  assert.equal(r.ok, true);
  if (r.ok !== true) return;
  assert.equal(r.tipo, 'pdf');
  assert.match(r.texto, /48,500\.00/);
  assert.match(r.texto, /Minera El Ejemplo/);
  assert.ok(r.trozos.length >= 1 && r.trozos.every((t) => t.length <= TROZO_ADJUNTO));
  assert.equal(r.recortado, false);
});

test('un PDF escaneado: sin OCR se dice que no se sabe; con OCR se lee y se avisa que puede tener errores', async () => {
  const sin = await leerAdjunto({ nombre: 'escaneo.pdf', datos: F('escaneo.pdf') }, { ojos: ciego });
  assert.equal(sin.ok, false);
  if (sin.ok === false) {
    assert.equal(sin.motivo, 'escaneo');
    assert.match(sin.detalle, /no sé qué dice/i);
  }
  let pedido = '';
  const con = await leerAdjunto(
    { nombre: 'escaneo.pdf', datos: F('escaneo.pdf') },
    { ojos: { ocr: async (n) => ((pedido = n), { paginas: [{ pagina: 1, texto: 'RECIBO N.º 0042 — L 3,200.00' }], via: 'docling' }), vision: null } }
  );
  assert.equal(pedido, 'escaneo.pdf');
  assert.equal(con.ok, true);
  if (con.ok === true) {
    assert.equal(con.via, 'docling');
    assert.match(con.texto, /L 3,200\.00/);
    assert.ok(con.avisos.some((a) => /reconocimiento óptico/.test(a)));
  }
});

test('Word, Excel (con su hoja), CSV en latin1 y texto', async () => {
  const w = await leerAdjunto({ nombre: 'contrato.docx', datos: F('contrato.docx') }, { ojos: ciego });
  assert.ok(w.ok === true && /Renta mensual: L 15,000\.00/.test(w.texto) && w.tipo === 'word');
  const x = await leerAdjunto({ nombre: 'ventas.xlsx', datos: F('ventas.xlsx') }, { ojos: ciego });
  assert.ok(x.ok === true && /Hoja «Ventas»/.test(x.texto) && /Septiembre \| 412/.test(x.texto), x.ok === true ? x.texto : '');
  const c = await leerAdjunto({ nombre: 'pagos.csv', mime: 'text/csv', datos: F('pagos.csv') }, { ojos: ciego });
  assert.ok(c.ok === true && /Año;Concepto;Monto/.test(c.texto) && /perforación/.test(c.texto), 'el CSV de Excel en latin1 se lee con sus tildes');
  const t = await leerAdjunto({ nombre: 'notas.txt', datos: F('notas.txt') }, { ojos: ciego });
  assert.ok(t.ok === true && /tajo norte/.test(t.texto));
});

test('la foto de un documento: con visión se transcribe (y se dice que es una imagen); sin ella, no se inventa', async () => {
  const sin = await leerAdjunto({ nombre: 'recibo.jpg', datos: F('recibo.jpg') }, { ojos: ciego });
  assert.ok(sin.ok === false && sin.motivo === 'sin-ojos');
  let url = '';
  const con = await leerAdjunto({ nombre: 'recibo.jpg', datos: F('recibo.jpg') }, { ojos: { ocr: null, vision: async (u) => ((url = u), { texto: 'Recibo de caja N.º 77. Total: L 900.00', via: 'gemini:x' }) } });
  assert.match(url, /^data:image\/jpeg;base64,/);
  assert.ok(con.ok === true && /L 900\.00/.test(con.texto) && con.via === 'vision:gemini:x' && con.avisos.some((a) => /imagen/.test(a)));
});

test('lo que no se puede leer, vacío o demasiado grande: se dice, sin texto inventado', async () => {
  const exe = await leerAdjunto({ nombre: 'programa', datos: F('desconocido.bin') }, { ojos: ciego });
  assert.ok(exe.ok === false && exe.motivo === 'formato');
  const vacio = await leerAdjunto({ nombre: 'x.pdf', datos: Buffer.alloc(0) }, { ojos: ciego });
  assert.ok(vacio.ok === false && vacio.motivo === 'vacio');
  const grande = await leerAdjunto({ nombre: 'enorme.txt', datos: Buffer.alloc(MAX_ADJUNTO_BYTES + 1, 97) }, { ojos: ciego });
  assert.ok(grande.ok === false && grande.motivo === 'grande' && /10 MB/.test(grande.detalle));
  // Un texto más largo que el tope: se recorta y se dice.
  const largo = await leerAdjunto({ nombre: 'largo.txt', datos: Buffer.from('palabra '.repeat(MAX_TEXTO_ADJUNTO / 4)) }, { ojos: ciego });
  assert.ok(largo.ok === true && largo.recortado && largo.texto.length <= MAX_TEXTO_ADJUNTO + 1 && largo.avisos.some((a) => /primeras/.test(a)));
});
