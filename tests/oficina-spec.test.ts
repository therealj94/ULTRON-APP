/**
 * FILE-01 (auditoría maestra del 6-oct, §8): la especificación tipada de los archivos de oficina (lib/oficina/spec.ts).
 * Puro: nombres saneados, números del modelo, totales en centavos, inyección de fórmulas y errores con su porqué.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularTotales, celdaSegura, dinero, importeCentavos, nombreSeguro, numero, textosEsperados, validarPedido, type EspecHoja } from '../lib/oficina/spec';

test('nombreSeguro: sin carpetas, sin caracteres peligrosos, con la extensión del tipo real', () => {
  assert.equal(nombreSeguro('informe.docx', 'docx'), 'informe.docx');
  assert.equal(nombreSeguro('../../etc/passwd', 'pdf'), 'passwd.pdf');
  assert.equal(nombreSeguro('C:\\Users\\x\\carta.pdf', 'pdf'), 'carta.pdf');
  assert.equal(nombreSeguro('informe.doc', 'docx'), 'informe.docx', 'la extensión que vale es la del tipo');
  assert.equal(nombreSeguro('presupuesto', 'xlsx'), 'presupuesto.xlsx');
  assert.equal(nombreSeguro('', 'xlsx'), 'hoja.xlsx');
  assert.equal(nombreSeguro('   ', 'docx'), 'documento.docx');
  assert.equal(nombreSeguro('a"b<c>|d?.pdf', 'pdf'), 'a b c d.pdf');
  assert.equal(nombreSeguro('nombre\r\nX-Inyectada: 1.pdf', 'pdf'), 'nombre X-Inyectada 1.pdf', 'sin saltos de línea (cabecera HTTP)');
  assert.equal(nombreSeguro('con.docx', 'docx'), '_con.docx', 'nombres reservados de Windows');
  assert.equal(nombreSeguro('cotización.xlsx', 'xlsx'), 'cotización.xlsx', 'las tildes se conservan');
  assert.equal(nombreSeguro('.oculto.pdf', 'pdf'), 'oculto.pdf');
  assert.ok(nombreSeguro('x'.repeat(300), 'pdf').length <= 84);
});

test('numero: números de verdad o textos con un solo separador decimal', () => {
  assert.equal(numero(12.5), 12.5);
  assert.equal(numero('12,5'), 12.5);
  assert.equal(numero(' 120 '), 120);
  assert.equal(numero('1.234,56'), null, 'ambiguo: no se adivina');
  assert.equal(numero('doce'), null);
  assert.equal(numero(Number.NaN), null);
  assert.equal(numero(Infinity), null);
});

test('totales en centavos enteros, sin errores de coma flotante, igual que ROUND(;2)', () => {
  assert.equal(importeCentavos(3, 0.1), 30);
  assert.equal(importeCentavos(1, 1.005), 101, '1,005 redondea a 1,01 como una hoja de cálculo');
  assert.equal(importeCentavos(120, 245.5), 2_946_000);
  assert.equal(importeCentavos(2.5, 19.99), 4998);
  const h: Pick<EspecHoja, 'partidas' | 'impuesto' | 'descuento_porcentaje'> = {
    partidas: [
      { concepto: 'Cemento', cantidad: 120, precio_unitario: 245.5 },
      { concepto: 'Arena', cantidad: 3, precio_unitario: 0.1 },
    ],
    impuesto: { nombre: 'ISV', porcentaje: 15 },
    descuento_porcentaje: 5,
  };
  const t = calcularTotales(h);
  assert.deepEqual(t.importes, [2_946_000, 30]);
  assert.equal(t.subtotal, 2_946_030);
  assert.equal(t.descuento, 147_302); // 5 % de 29 460,30 = 1 473,0150 → 1 473,02
  assert.equal(t.base, 2_798_728);
  assert.equal(t.impuesto, 419_809); // 15 % de 27 987,28 = 4 198,092 → 4 198,09
  assert.equal(t.total, 3_218_537);
  assert.equal(dinero(t.total, 'L'), 'L 32,185.37');
});

test('celdaSegura: lo que empieza como fórmula se neutraliza (OWASP), lo demás queda igual', () => {
  for (const s of ['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1', '\uFF1D1']) assert.equal(celdaSegura(s), `'${s}`);
  for (const s of ['Cemento', 'Total 15 %', '', 'a=b']) assert.equal(celdaSegura(s), s);
});

test('validarPedido: tres archivos válidos, nombres saneados y sin repetir', () => {
  const r = validarPedido({
    archivos: [
      { tipo: 'docx', nombre: 'informe.docx', spec: { titulo: 'Informe', secciones: [{ titulo: 'Uno', parrafos: ['Hola.\n\nOtro párrafo.'] }] } },
      { tipo: 'XLSX', nombre: '../presupuesto.xlsx', spec: { titulo: 'P', partidas: [{ concepto: 'A', cantidad: '2', precio_unitario: '10,5' }] } },
      { tipo: 'pdf', nombre: 'informe.pdf', spec: { carta: { saludo: 'Hola:', cuerpo: ['Texto.'], despedida: 'Saludos,', firma: ['Ana'] } } },
      { tipo: 'docx', nombre: 'informe.docx', spec: { titulo: 'Otro', secciones: [{ parrafos: ['x'] }] } },
    ],
  });
  assert.deepEqual(r.errores, []);
  assert.deepEqual(
    r.archivos.map((a) => a.nombre),
    ['informe.docx', 'presupuesto.xlsx', 'informe.pdf', 'informe (2).docx']
  );
  const d = r.archivos[0];
  assert.equal(d.tipo, 'docx');
  if (d.tipo === 'docx') assert.deepEqual(d.spec.secciones[0].parrafos, ['Hola.', 'Otro párrafo.'], 'los saltos separan párrafos');
  const x = r.archivos[1];
  if (x.tipo === 'xlsx') {
    assert.equal(x.spec.partidas[0].precio_unitario, 10.5);
    assert.equal(x.spec.moneda, 'L');
  }
  const c = r.archivos[2];
  if (c.tipo === 'pdf') assert.equal(c.spec.titulo, 'Carta', 'una carta sin título lleva «Carta»');
});

test('validarPedido: lo que falta se dice archivo por archivo, sin rellenar nada', () => {
  const r = validarPedido({
    archivos: [
      { tipo: 'odp', nombre: 'deck.odp', spec: {} },
      { tipo: 'pptx', nombre: 'deck.pptx', spec: {} },
      { tipo: 'docx', nombre: 'vacio.docx', spec: { titulo: '' } },
      { tipo: 'xlsx', nombre: 'malo.xlsx', spec: { titulo: 'P', partidas: [{ concepto: '', cantidad: 0, precio_unitario: -1 }, { concepto: 'B', cantidad: 'mucho', precio_unitario: 1 }] } },
      { tipo: 'pdf', nombre: 'carta.pdf', spec: { carta: { cuerpo: [] } } },
    ],
  });
  assert.equal(r.archivos.length, 0);
  const por = Object.fromEntries(r.errores.map((e) => [e.nombre, e.errores.join(' | ')]));
  assert.match(por['deck.odp'], /no soportado: docx, xlsx, pptx o pdf/);
  // Una presentación vacía no se rellena: se dice qué le falta.
  assert.match(por['deck.pptx'], /falta el título de la presentación/);
  assert.match(por['deck.pptx'], /no tiene diapositivas/);
  assert.match(por['vacio.docx'], /no tiene contenido/);
  assert.match(por['vacio.docx'], /falta el título/);
  assert.match(por['malo.xlsx'], /falta el concepto/);
  assert.match(por['malo.xlsx'], /mayor que 0/);
  assert.match(por['malo.xlsx'], /no puede ser negativo/);
  assert.match(por['malo.xlsx'], /no es un número/);
  assert.match(por['carta.pdf'], /saludo/);
  assert.match(por['carta.pdf'], /cuerpo/);
  assert.match(por['carta.pdf'], /firma/);
});

test('validarPedido: un total declarado que no cuadra no se entrega «arreglado»', () => {
  const bien = validarPedido({ tipo: 'xlsx', nombre: 'p.xlsx', spec: { titulo: 'P', partidas: [{ concepto: 'A', cantidad: 2, precio_unitario: 50 }], impuesto: { porcentaje: 15 }, total_declarado: 115 } });
  assert.equal(bien.archivos.length, 1);
  const mal = validarPedido({ tipo: 'xlsx', nombre: 'p.xlsx', spec: { titulo: 'P', partidas: [{ concepto: 'A', cantidad: 2, precio_unitario: 50 }], impuesto: { porcentaje: 15 }, total_declarado: 100 } });
  assert.equal(mal.archivos.length, 0);
  assert.match(mal.errores[0].errores[0], /total calculado \(L 115\.00\) no coincide con el total declarado \(L 100\.00\)/);
});

test('validarPedido: topes (más de 5 archivos, tablas desmesuradas)', () => {
  const muchos = validarPedido({ archivos: Array.from({ length: 7 }, (_, i) => ({ tipo: 'pdf', nombre: `a${i}.pdf`, spec: { titulo: 'T', secciones: [{ parrafos: ['x'] }] } })) });
  assert.equal(muchos.archivos.length, 5);
  assert.match(muchos.errores[0].errores[0], /hasta 5/);
  const tabla = validarPedido({ tipo: 'docx', nombre: 't.docx', spec: { titulo: 'T', secciones: [{ tabla: { cabecera: Array.from({ length: 13 }, (_, i) => `c${i}`), filas: [['a']] } }] } });
  assert.match(tabla.errores[0].errores.join(' '), /13 columnas/);
  assert.deepEqual(validarPedido(null).errores[0].nombre, '(pedido)');
});

test('textosEsperados: todo lo que tiene que poder releerse', () => {
  const e = textosEsperados({ titulo: 'T', subtitulo: 'S', secciones: [{ titulo: 'Sec', parrafos: ['p1'], vinetas: ['v1'], tabla: { cabecera: ['A', 'B'], filas: [['1', '']] } }] });
  assert.deepEqual(e.parrafos, ['T', 'S', 'p1', 'v1']);
  assert.deepEqual(e.secciones, ['Sec']);
  assert.deepEqual(e.cabeceras, ['A', 'B']);
  assert.deepEqual(e.celdas, ['1']);
  const c = textosEsperados({ titulo: 'Carta', secciones: [], carta: { destinatario: ['Ana'], saludo: 'Hola:', cuerpo: ['x'], despedida: 'Adiós,', firma: ['Yo'] } }, false);
  assert.deepEqual(c.parrafos, ['Ana', 'Hola:', 'x', 'Adiós,', 'Yo']);
});
