/**
 * RESULTADOS REALMENTE COMPROBADOS (revisión externa, bloqueo): ni «Listo» ni «Listo, 3 archivos» prueban que se
 * entregaron tres archivos. Cada requisito se comprueba POR SEPARADO: cantidad, identidad (qué archivo es cada cosa
 * pedida), tipo (extensión + lo que el nodo vio por dentro), existencia, acceso (dentro del espacio de trabajo) e
 * integridad (no vacío, sha256, de ESTA misión). Un `runtime.log` (o cualquier otro archivo que apareció) no cumple
 * tres documentos pedidos, y una evidencia nunca da por cumplidos todos los criterios.
 *
 * Pedido de tres documentos concretos: (a) ninguno, (b) uno de tres, (c) archivos equivocados, (d) incompletos (vacío,
 * otro tipo, fuera del espacio, viejo, nodo que no miró el tipo), (e) los tres correctos. SOLO (e) completa la tarea;
 * (a)–(d) quedan `partial` con el estado de cada cosa pedida. Y un pedido solo de cantidad y tipo («3 PDFs»).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as durables from '../lib/tareas-durables';
import { aplicarCambio, deComputadora, evaluarEntrega, reconciliarConComputadora, registroNuevo, type Criterio, type MisionComputadoraMin, type RegistroTarea } from '../lib/tareas-durables';

// Por nombre del módulo: así la reproducción con el código de antes falla prueba por prueba, no al importar.
const requisitosDeEntrega = (s: string): { seguro: boolean; items: { nombre?: string; extensiones: string[]; carpeta?: string }[] } => (durables as any).requisitosDeEntrega(s);
import { encargarTarea, _olvidarEncargos, misionDeTarea, vistaMision } from '../server/computadora';
import { almacenEnMemoria, _usarAlmacenDurable } from '../lib/durable';
import { crearTarea, leerTarea, ENTORNO_INVESTIGACION } from '../lib/tareas-durables';
import { abrirEncargoComputadora, cerrarInvestigacion } from '../server/trabajos';

const T0 = Date.parse('2026-10-04T15:00:00Z');
const ESP = '/home/computeruse';
const INSTR = 'Crea tres documentos: informe.docx, presupuesto.xlsx y carta.pdf, y guárdalos en Documentos';
const sha = (c: string) => c.repeat(64);

type A = Record<string, unknown>;
const ok = (nombre: string, tipo: string, s: string, extra: A = {}): A => ({ ruta: `${ESP}/Documents/${nombre}`, existe: true, bytes: 2048, sha256: sha(s), reciente: true, mencionado: true, tipo, integro: true, ...extra });
const falta = (nombre: string): A => ({ ruta: nombre, existe: false, bytes: 0, sha256: null, mencionado: true });
const suelto = (nombre: string, tipo: string, s: string): A => ({ ruta: `${ESP}/${nombre}`, existe: true, bytes: 300, sha256: sha(s), reciente: true, mencionado: false, tipo, integro: true });

const TRES_OK = [ok('informe.docx', 'docx', '1'), ok('presupuesto.xlsx', 'xlsx', '2'), ok('carta.pdf', 'pdf', '3')];

function tarea(instruccion: string): RegistroTarea {
  return registroNuevo(
    'tk_items1',
    {
      requestId: 'r-items',
      titulo: instruccion,
      objetivo: instruccion,
      estado: 'verifying',
      entorno: { kind: 'computadora', id: 'mis_i', displayName: 'Tu computadora' },
      criterios: [{ id: 'resultado', texto: 'Tu computadora termina y lo entregado se comprueba', obligatorio: true }],
      origen: { kind: 'chat' },
      enlace: { tipo: 'computadora', id: 'mis_i' },
    },
    T0
  );
}

const mision = (instruccion: string, archivos: A[] | null | undefined, resultado = 'Listo, ya creé los 3 archivos.'): MisionComputadoraMin =>
  ({ id: 'mis_i', tareaId: 'mis_i', instruccion, estado: 'hecha', ok: true, inicio: T0, segundos: 40, resultado, ...(archivos === undefined ? {} : { archivos }) }) as MisionComputadoraMin;

/** Cierra la tarea con la misión y comprueba lo que vale para TODOS los casos: un criterio por cosa pedida, cada uno con lo suyo. */
function cerrar(instruccion: string, archivos: A[] | null | undefined, resultado?: string) {
  const m = mision(instruccion, archivos, resultado);
  const c = reconciliarConComputadora(tarea(instruccion), m, T0 + 60_000);
  assert.ok(c, 'la misión terminada cambia la tarea');
  const criterios = (c!.criterios || []).filter((x) => x.obligatorio);
  const evid = new Set(c!.resultado!.evidencias.map((e) => e.id));
  // Una evidencia de archivo respalda a lo más UNA cosa pedida, y solo existe si está en el resultado.
  const usadas = criterios.flatMap((x) => x.evidencias);
  assert.equal(new Set(usadas).size, usadas.length, `ninguna evidencia se comparte entre criterios: ${JSON.stringify(criterios)}`);
  for (const x of criterios) {
    for (const e of x.evidencias) assert.ok(evid.has(e), `la evidencia ${e} del criterio «${x.texto}» está en el resultado`);
    if (x.estado === 'verified') assert.equal(x.evidencias.length, 1, `«${x.texto}» verificado con SU archivo`);
    else assert.equal(x.evidencias.length, 0, `«${x.texto}» sin verificar no presume evidencia`);
  }
  const s = deComputadora(m, T0 + 60_000);
  return { c: c!, criterios, s, texto: [c!.resultado!.resumen, ...c!.resultado!.parcial].join(' ') };
}

const de = (criterios: Criterio[], nombre: string) => {
  const x = criterios.find((k) => k.texto.includes(nombre));
  assert.ok(x, `hay un criterio para ${nombre}: ${criterios.map((k) => k.texto).join(' | ')}`);
  return x!;
};

/* ------------------------------------------------------------------ qué se pidió */

test('requisitos: cada cosa pedida es un requisito con su nombre o su tipo; sin cantidad clara no es «seguro»', () => {
  const r = requisitosDeEntrega(INSTR);
  assert.deepEqual(
    r.items.map((i) => [i.nombre ?? null, i.extensiones.slice(0, 1)[0] ?? null]),
    [
      ['informe.docx', 'docx'],
      ['presupuesto.xlsx', 'xlsx'],
      ['carta.pdf', 'pdf'],
    ]
  );
  assert.equal(r.seguro, true);
  const pdfs = requisitosDeEntrega('Guarda 3 PDFs de las facturas de septiembre en Descargas');
  assert.equal(pdfs.items.length, 3);
  assert.ok(pdfs.items.every((i) => !i.nombre && i.extensiones.includes('pdf') && !i.extensiones.includes('txt')));
  assert.equal(pdfs.seguro, true);
  const mezcla = requisitosDeEntrega('Hazme un documento de Word y dos PDFs con el resumen');
  assert.equal(mezcla.items.length, 3);
  assert.equal(mezcla.items.filter((i) => i.extensiones.includes('pdf') && i.extensiones.length === 1).length, 2);
  assert.equal(requisitosDeEntrega('Crea un documento informe.odt con el resumen y guárdalo en Documentos').items.length, 1, '«en Documentos» es la carpeta, no otro documento');
  const vago = requisitosDeEntrega('Descarga los PDFs de las facturas');
  assert.equal(vago.seguro, false, 'sin decir cuántos, no se puede comprobar que estén todos');
});

/* ------------------------------------------------------------------ (a)–(e): tres documentos concretos */

test('(a) ningún archivo → partial; cada uno de los tres «no encontrado»', () => {
  for (const archivos of [[falta('informe.docx'), falta('presupuesto.xlsx'), falta('carta.pdf')], []]) {
    const { c, criterios, s, texto } = cerrar(INSTR, archivos);
    assert.equal(c.estado, 'partial');
    assert.equal(criterios.length, 3, 'un criterio por documento pedido');
    for (const n of ['informe.docx', 'presupuesto.xlsx', 'carta.pdf']) assert.equal(de(criterios, n).estado, 'not_met', n);
    assert.match(texto, /0 de 3/);
    assert.equal(s.state, 'partial');
    assert.equal(s.acceptance.length, 3);
    assert.ok(s.acceptance.every((a) => a.status !== 'verified'));
  }
});

test('(b) uno de tres → partial «1 de 3»: informe.docx verificado con SU evidencia, los otros dos faltan', () => {
  const { c, criterios, s, texto } = cerrar(INSTR, [TRES_OK[0], falta('presupuesto.xlsx'), falta('carta.pdf')]);
  assert.equal(c.estado, 'partial');
  const inf = de(criterios, 'informe.docx');
  assert.equal(inf.estado, 'verified');
  const ev = c.resultado!.evidencias.find((e) => e.id === inf.evidencias[0])!;
  assert.equal(ev.tipo, 'archivo');
  assert.equal(ev.ref, `${ESP}/Documents/informe.docx`);
  assert.equal(de(criterios, 'presupuesto.xlsx').estado, 'not_met');
  assert.equal(de(criterios, 'carta.pdf').estado, 'not_met');
  assert.match(texto, /1 de 3/);
  assert.match(texto, /falta[^.]*presupuesto\.xlsx/i);
  assert.match(texto, /carta\.pdf/);
  assert.equal(s.state, 'partial');
  assert.deepEqual(s.acceptance.map((a) => a.status), ['verified', 'not_met', 'not_met']);
});

test('(c) archivos equivocados (runtime.log, random.txt, foto.png) → partial; ninguno cuenta por los documentos', () => {
  const equivocados = [suelto('runtime.log', 'texto', '4'), suelto('random.txt', 'texto', '5'), suelto('foto.png', 'png', '6')];
  // Con el nodo diciendo que los nombrados no están, y también si solo contara lo nuevo (sin los nombrados).
  for (const archivos of [[...equivocados, falta('informe.docx'), falta('presupuesto.xlsx'), falta('carta.pdf')], equivocados]) {
    const { c, criterios, texto } = cerrar(INSTR, archivos);
    assert.equal(c.estado, 'partial');
    assert.ok(criterios.every((x) => x.estado !== 'verified'), 'ningún criterio verificado');
    assert.ok(!c.resultado!.evidencias.some((e) => /runtime\.log|random\.txt|foto\.png/.test(`${e.ref} ${e.etiqueta}`)), 'lo que sobra no es evidencia');
    assert.match(texto, /0 de 3/);
    assert.match(texto, /runtime\.log.*no (es|son) lo que pediste/i);
  }
});

test('(d) incompletos: vacío, otro tipo, fuera del espacio, viejo o sin tipo comprobado → partial con el porqué de cada uno', () => {
  const casos: { nombre: string; archivo: A; espera: RegExp; estado: Criterio['estado'] }[] = [
    { nombre: 'presupuesto.xlsx', archivo: ok('presupuesto.xlsx', 'vacio', '2', { bytes: 0 }), espera: /presupuesto\.xlsx est[aá] vac[ií]o/i, estado: 'not_met' },
    { nombre: 'carta.pdf', archivo: ok('carta.pdf', 'texto', '3'), espera: /carta\.pdf no es (un )?PDF/i, estado: 'not_met' },
    { nombre: 'carta.pdf', archivo: { ruta: '/tmp/carta.pdf', existe: false, bytes: 0, sha256: null, mencionado: true, fuera: true }, espera: /carta\.pdf[^.]*fuera/i, estado: 'not_met' },
    { nombre: 'informe.docx', archivo: ok('informe.docx', 'docx', '1', { reciente: false }), espera: /informe\.docx[^.]*(antes de esta misi[oó]n|no (lo|la) hizo)/i, estado: 'not_met' },
    { nombre: 'carta.pdf', archivo: (() => { const a = ok('carta.pdf', 'pdf', '3'); delete a.tipo; return a; })(), espera: /carta\.pdf[^.]*(tipo|por dentro)/i, estado: 'unknown' },
    { nombre: 'carta.pdf', archivo: ok('carta.pdf', 'pdf', '3', { sha256: 'no-es-un-hash' }), espera: /carta\.pdf[^.]*huella/i, estado: 'not_met' },
  ];
  for (const k of casos) {
    const archivos = TRES_OK.filter((a) => !String(a.ruta).endsWith(`/${k.nombre}`)).concat([k.archivo]);
    const { c, criterios, texto } = cerrar(INSTR, archivos);
    assert.equal(c.estado, 'partial', JSON.stringify(k.archivo));
    assert.equal(de(criterios, k.nombre).estado, k.estado, `${k.nombre}: ${JSON.stringify(k.archivo)}`);
    assert.equal(criterios.filter((x) => x.estado === 'verified').length, 2, 'los otros dos sí se comprobaron, cada uno con lo suyo');
    assert.match(texto, /2 de 3/);
    assert.match(texto, k.espera);
  }
  // Un nombre que no es lo pedido (otro nombre con el tipo correcto) tampoco suple: la identidad cuenta.
  const { c } = cerrar(INSTR, [TRES_OK[0], TRES_OK[1], suelto('carta-vieja-2.pdf', 'pdf', '7'), falta('carta.pdf')]);
  assert.equal(c.estado, 'partial');
});

test('(e) los tres correctos → completed, cada criterio con SU archivo; lo que sobra no estorba ni cuenta', () => {
  for (const archivos of [TRES_OK, [...TRES_OK, suelto('runtime.log', 'texto', '4')]]) {
    const { c, criterios, s } = cerrar(INSTR, archivos);
    assert.equal(c.estado, 'completed');
    assert.equal(criterios.length, 3);
    for (const [n, ref] of [['informe.docx', 'informe.docx'], ['presupuesto.xlsx', 'presupuesto.xlsx'], ['carta.pdf', 'carta.pdf']]) {
      const x = de(criterios, n);
      assert.equal(x.estado, 'verified');
      assert.equal(c.resultado!.evidencias.find((e) => e.id === x.evidencias[0])!.ref, `${ESP}/Documents/${ref}`);
    }
    assert.ok(!c.resultado!.evidencias.some((e) => /runtime\.log/.test(`${e.ref}`)));
    assert.equal(s.state, 'completed');
    assert.deepEqual(s.acceptance.map((a) => a.status), ['verified', 'verified', 'verified']);
    assert.equal(new Set(s.acceptance.flatMap((a) => a.evidenceIds)).size, 3);
  }
});

test('un mismo archivo no cumple dos cosas pedidas', () => {
  const instr = 'Guarda la factura como factura.pdf y además otro PDF con el resumen';
  const e = evaluarEntrega(mision(instr, [ok('factura.pdf', 'pdf', '1')])) as any;
  assert.equal(e.comprobada, false);
  assert.equal(e.items.length, 2);
  assert.deepEqual(e.items.map((i: any) => i.estado).sort(), ['not_met', 'verified']);
});

/* ------------------------------------------------------------------ solo cantidad y tipo: «3 PDFs» */

test('«3 PDFs»: runtime.log no cuenta; 2 de 3 no basta; un .pdf que por dentro es texto no es un PDF; 3 PDFs de verdad sí', () => {
  const instr = 'Descarga las facturas y guarda 3 PDFs en Descargas';
  const pdf = (n: string, s: string, tipo = 'pdf') => ({ ruta: `${ESP}/Downloads/${n}`, existe: true, bytes: 5000, sha256: sha(s), reciente: true, tipo, integro: true });
  const solo = cerrar(instr, [suelto('runtime.log', 'texto', '9')]);
  assert.equal(solo.c.estado, 'partial', 'un log no es un PDF');
  assert.equal(solo.criterios.length, 3);
  assert.match(solo.texto, /0 de 3/);
  const dos = cerrar(instr, [pdf('f1.pdf', '1'), pdf('f2.pdf', '2'), suelto('runtime.log', 'texto', '9')]);
  assert.equal(dos.c.estado, 'partial');
  assert.equal(dos.criterios.filter((x) => x.estado === 'verified').length, 2);
  assert.match(dos.texto, /2 de 3/);
  const falso = cerrar(instr, [pdf('f1.pdf', '1'), pdf('f2.pdf', '2'), pdf('f3.pdf', '3', 'texto')]);
  assert.equal(falso.c.estado, 'partial');
  assert.match(falso.texto, /f3\.pdf no es (un )?PDF/i);
  const bien = cerrar(instr, [pdf('f1.pdf', '1'), pdf('f2.pdf', '2'), pdf('f3.pdf', '3'), suelto('runtime.log', 'texto', '9')]);
  assert.equal(bien.c.estado, 'completed');
  assert.equal(bien.criterios.length, 3);
  // Sin decir cuántos, ni con cinco PDFs se puede comprobar que están todos.
  const vago = cerrar('Descarga los PDFs de las facturas', [pdf('f1.pdf', '1'), pdf('f2.pdf', '2')]);
  assert.equal(vago.c.estado, 'partial');
  assert.ok(vago.criterios.every((x) => x.estado !== 'verified' || x.evidencias.length === 1));
  assert.ok(vago.criterios.some((x) => x.estado === 'unknown'));
});

/* ------------------------------------------------------------------ la tarea durable: una evidencia no cumple todo */

test('aplicarCambio: no hay «completed» si dos criterios comparten el mismo archivo o citan evidencia que no está', () => {
  const reg = registroNuevo(
    'tk_comp1',
    {
      requestId: 'r-c',
      titulo: 'x',
      estado: 'verifying',
      entorno: { kind: 'computadora', id: 'm', displayName: 'Tu computadora' },
      criterios: [
        { id: 'a', texto: 'informe.docx' },
        { id: 'b', texto: 'carta.pdf' },
      ],
      origen: { kind: 'chat' },
    },
    T0
  );
  const ev = [{ id: 'm:archivo:1', tipo: 'archivo' as const, etiqueta: 'runtime.log' }];
  const compartida = reg.criterios.map((c) => ({ ...c, estado: 'verified' as const, evidencias: ['m:archivo:1'] }));
  const r1 = aplicarCambio(reg, { estado: 'completed', criterios: compartida, resultado: { id: 'r', resumen: 'Listo', evidencias: ev, parcial: [], pendiente: [], t: T0 } }, T0);
  assert.equal(r1.ok, false, 'un archivo no cumple dos cosas pedidas');
  const inventada = reg.criterios.map((c, i) => ({ ...c, estado: 'verified' as const, evidencias: [`m:archivo:${i + 5}`] }));
  const r2 = aplicarCambio(reg, { estado: 'completed', criterios: inventada, resultado: { id: 'r', resumen: 'Listo', evidencias: ev, parcial: [], pendiente: [], t: T0 } }, T0);
  assert.equal(r2.ok, false, 'una evidencia que no está en el resultado no cuenta');
});

test('otros cierres: la evidencia va a SU criterio (investigar), y el encargo nace con un criterio por cosa pedida', async () => {
  _usarAlmacenDurable(almacenEnMemoria());
  const yo = 'bea@x.hn';
  const cr = await crearTarea(yo, {
    requestId: 'inv-dos-criterios',
    titulo: 'Investigar: tasas',
    entorno: ENTORNO_INVESTIGACION,
    origen: { kind: 'chat' },
    estado: 'running',
    criterios: [
      { id: 'fuentes', texto: 'Un resumen con fuentes' },
      { id: 'tabla', texto: 'Una tabla comparativa' },
    ],
  });
  assert.ok(cr.ok);
  const id = (cr as any).tarea.id;
  const r = await cerrarInvestigacion(yo, id, { estado: 'completed', resumen: 'Resumen con fuentes.', fuentes: [{ titulo: 'BCH', url: 'https://bch.hn/tasas' }] });
  assert.ok(r && r !== 'cerrada', 'el cierre se guardó');
  const t = (await leerTarea(yo, id)) as any;
  assert.equal(t.tarea.estado, 'partial', 'las fuentes no prueban la tabla');
  const [fuentes, tabla] = t.tarea.criterios;
  assert.equal(fuentes.estado, 'verified');
  assert.equal(fuentes.evidencias.length, 1);
  assert.equal(tabla.estado, 'unknown');
  assert.deepEqual(tabla.evidencias, []);
  // El encargo a la computadora: un criterio por documento pedido desde que nace (el panel los muestra pendientes).
  const ref = await abrirEncargoComputadora(yo, 'web', INSTR);
  const enc = (await leerTarea(yo, ref!.id)) as any;
  assert.deepEqual(enc.tarea.criterios.map((c: Criterio) => [c.texto.split(':')[0], c.estado]), [
    ['informe.docx', 'pending'],
    ['presupuesto.xlsx', 'pending'],
    ['carta.pdf', 'pending'],
  ]);
});

/* ------------------------------------------------------------------ el servidor contra un nodo: lo que AURA dice */

/* ------------------------------------------------------------------ revisión independiente: los huecos */

const pdfNuevo = (n: string, s: string, carpeta = 'Downloads'): A => ({ ruta: `${ESP}/${carpeta}/${n}`, existe: true, bytes: 4000, sha256: sha(s), reciente: true, tipo: 'pdf', integro: true });
const etiquetas = (r: { items: { nombre?: string; extensiones: string[] }[] }) => r.items.map((i) => i.nombre ?? i.extensiones.join('|'));

test('revisión 1: plurales y capturas también piden archivos; una misión de archivos nunca se completa por el texto', async () => {
  const { pideArchivo } = await import('../lib/tareas-durables');
  {
    // Lo que pasaba: tipo «dato» y completed con una respuesta que solo cuenta lo que hizo.
    const antes = cerrar('Crea tres PDFs con las facturas', [], 'Listo, terminé las tres facturas de septiembre del proveedor Ferretería Central.');
    assert.equal(antes.c.estado, 'partial', 'sin PDFs no hay completed');
  }
  assert.equal(pideArchivo('Crea tres PDFs con las facturas'), true);
  assert.equal(pideArchivo('Crea dos documentos: el acta y el anexo'), true);
  assert.equal(pideArchivo('Haz una captura de pantalla de la página'), true);
  assert.equal(pideArchivo('Busca el clima de Tegucigalpa'), false, 'lo legítimo sin archivos sigue siendo un dato');
  assert.equal(pideArchivo('Busca fotos de Copán y dime cuál te gusta'), false, 'buscar fotos no es dejarlas');
  // Antes: sin PDFs comprobados caía en «dato» y una respuesta con palabras («…del proveedor Ferretería Central») la completaba.
  for (const archivos of [[], undefined]) {
    const tres = cerrar('Crea tres PDFs con las facturas', archivos, 'Listo, terminé las tres facturas de septiembre del proveedor Ferretería Central.');
    assert.equal(tres.c.estado, 'partial', `«Listo, terminé» no completa una misión de archivos (${JSON.stringify(archivos)})`);
    assert.equal(tres.criterios.length, 3);
    assert.ok(tres.criterios.every((x) => x.estado !== 'verified'));
    assert.equal(evaluarEntrega(mision('Crea tres PDFs con las facturas', archivos, 'Listo, terminé las tres facturas de septiembre del proveedor Ferretería Central.')).tipo, 'archivo');
  }
  const dos = cerrar('Crea dos documentos: el acta y el anexo', [], 'Listo, ya están los dos documentos.');
  assert.equal(dos.c.estado, 'partial');
  assert.equal(dos.criterios.length, 2);
  const cap = cerrar('Haz una captura de pantalla de la página', [], 'Listo, ya la hice.');
  assert.equal(cap.c.estado, 'partial');
  const conCap = cerrar('Haz una captura de pantalla de la página', [{ ruta: `${ESP}/Pictures/captura.png`, existe: true, bytes: 9000, sha256: sha('c'), reciente: true, tipo: 'png', integro: true }], 'Listo, ya la hice.');
  assert.equal(conCap.c.estado, 'completed', 'con la captura de verdad, sí');
});

test('revisión 2a: el archivo de origen («convierte datos.csv», «lee informe.pdf») no es un entregable', () => {
  const conv = requisitosDeEntrega('Convierte datos.csv a PDF');
  assert.deepEqual(etiquetas(conv), ['pdf'], 'se entrega un PDF; datos.csv es de donde sale');
  assert.deepEqual(etiquetas(requisitosDeEntrega('Lee informe.pdf y crea un resumen.docx')), ['resumen.docx']);
  assert.deepEqual(etiquetas(requisitosDeEntrega('Con los datos de ventas.xlsx haz grafica.png')), ['grafica.png']);
  assert.deepEqual(etiquetas(requisitosDeEntrega('Convierte datos.csv a informe.pdf')), ['informe.pdf'], 'el destino con nombre sí');
  assert.deepEqual(etiquetas(requisitosDeEntrega('Resume reporte.pdf en un documento de Word')), ['docx|doc|odt|rtf'], 'resumir: el origen no, el Word sí');
  assert.deepEqual(etiquetas(requisitosDeEntrega('Abre el PDF del reglamento y dime qué dice')), [''], 'leer un PDF no es entregarlo');
  const datos: A = { ruta: `${ESP}/datos.csv`, existe: true, bytes: 100, sha256: sha('d'), reciente: false, mencionado: true, tipo: 'texto', integro: true };
  const bien = cerrar('Convierte datos.csv a PDF', [datos, pdfNuevo('datos.pdf', '1')], 'Listo, ya lo convertí.');
  assert.equal(bien.c.estado, 'completed', 'un PDF nuevo cumple; el CSV de origen (viejo) no estorba');
  assert.equal(cerrar('Convierte datos.csv a PDF', [datos], 'Listo.').c.estado, 'partial', 'sin el PDF, no');
});

test('revisión 2b: «guárdalo como PDF» es el formato del mismo entregable, no otro archivo', () => {
  const r = requisitosDeEntrega('Crea un documento con el resumen y guárdalo como PDF');
  assert.deepEqual(etiquetas(r), ['pdf']);
  assert.equal(r.seguro, true);
  assert.equal(cerrar('Crea un documento con el resumen y guárdalo como PDF', [pdfNuevo('resumen.pdf', '1', 'Documents')], 'Listo.').c.estado, 'completed');
  const w = requisitosDeEntrega('Crea un Word y expórtalo a PDF');
  assert.ok(w.items.length <= 1 || !w.seguro, `no exige de más: ${JSON.stringify(w)}`);
  assert.equal(cerrar('Crea un Word y expórtalo a PDF', [pdfNuevo('resumen.pdf', '1', 'Documents')], 'Listo.').c.estado, 'completed', 'el PDF exportado es lo que se entrega');
});

test('revisión 2c: un plural sin número no se da por cumplido con un archivo; una enumeración clara cuenta cada cosa', () => {
  const enu = requisitosDeEntrega('Descarga las facturas de enero, febrero y marzo');
  assert.equal(enu.items.length, 3);
  const una = cerrar('Descarga las facturas de enero, febrero y marzo', [pdfNuevo('factura_enero.pdf', '1')], 'Listo, descargué las facturas.');
  assert.equal(una.c.estado, 'partial', 'una de tres no basta');
  assert.match(una.texto, /1 de 3/);
  const tres = cerrar('Descarga las facturas de enero, febrero y marzo', [pdfNuevo('factura_enero.pdf', '1'), pdfNuevo('factura_febrero.pdf', '2'), pdfNuevo('factura_marzo.pdf', '3')], 'Listo.');
  assert.equal(tres.c.estado, 'completed');
  // Dos de enero no cubren marzo: cada mes es su archivo.
  assert.equal(cerrar('Descarga las facturas de enero, febrero y marzo', [pdfNuevo('factura_enero.pdf', '1'), pdfNuevo('factura_enero_2.pdf', '2'), pdfNuevo('factura_febrero.pdf', '3')], 'Listo.').c.estado, 'partial');
  const vago = requisitosDeEntrega('Descarga las facturas del proveedor');
  assert.equal(vago.seguro, false, 'sin decir cuántas, no es seguro');
  assert.equal(cerrar('Descarga las facturas del proveedor', [pdfNuevo('factura_1.pdf', '1'), pdfNuevo('factura_2.pdf', '2')], 'Listo.').c.estado, 'partial');
});

test('revisión 2d: el mismo nombre en dos carpetas son dos entregables', () => {
  const instr = 'Guarda la factura en ~/Documents/factura.pdf y una copia en ~/Desktop/factura.pdf';
  const r = requisitosDeEntrega(instr);
  assert.equal(r.items.length, 2, JSON.stringify(r));
  const unaSola = cerrar(instr, [pdfNuevo('factura.pdf', '1', 'Documents'), falta('~/Desktop/factura.pdf')], 'Listo, ya están las dos.');
  assert.equal(unaSola.c.estado, 'partial');
  assert.match(unaSola.texto, /1 de 2/);
  assert.equal(cerrar(instr, [pdfNuevo('factura.pdf', '1', 'Documents'), pdfNuevo('factura.pdf', '2', 'Desktop')], 'Listo.').c.estado, 'completed');
});

test('revisión 2e: el número pedido manda aunque el verbo esté en otra frase', () => {
  for (const instr of ['Necesito tres PDFs con las facturas de septiembre', 'Tres PDFs con las facturas de septiembre, por favor. Guárdalos en Descargas.']) {
    const r = requisitosDeEntrega(instr);
    assert.equal(r.items.length, 3, instr);
    const c = cerrar(instr, [pdfNuevo('factura_sep.pdf', '1')], 'Descargué las facturas.');
    assert.equal(c.c.estado, 'partial', instr);
    assert.equal(c.criterios.length, 3);
    assert.match(c.texto, /1 de 3/);
  }
});

test('revisión: lo legítimo no se rompe («crea informe.docx» con informe.docx correcto completa)', () => {
  assert.equal(cerrar('Crea informe.docx', [ok('informe.docx', 'docx', '1')], 'Listo.').c.estado, 'completed');
  assert.equal(cerrar('Busca el clima de Tegucigalpa', undefined, 'Soleado, 28 grados').c.estado, 'completed', 'un dato sigue siendo un dato');
});

async function nodo(respuesta: string, extra: Record<string, unknown>) {
  const srv = http.createServer((req, res) => {
    let datos = '';
    req.on('data', (c) => (datos += c));
    req.on('end', () => {
      const json = (code: number, j: unknown) => (res.writeHead(code, { 'content-type': 'application/json' }), res.end(JSON.stringify(j)));
      if (req.url === '/salud') return json(200, { ok: true, motores: ['holo'], ocupada: false });
      if (req.method === 'POST' && req.url === '/tareas') return json(200, { id: 'n1', estado: 'en_cola' });
      return json(200, { id: 'n1', motor: 'holo', instruccion: 'x', estado: 'hecha', segundos: 20, pasos: [{ n: 1, t: 2, accion: 'click', args: { x: 1, y: 2 }, hecho: true }, { n: 2, t: 9, accion: 'answer' }], respuesta, error: null, ...extra });
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, cerrar: () => new Promise<void>((r) => srv.close(() => r())) };
}

async function conNodo<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const antes = { u: process.env.COMPUTADORA_URL, c: process.env.COMPUTADORA_CLAVE };
  process.env.COMPUTADORA_URL = url;
  process.env.COMPUTADORA_CLAVE = 'clave';
  _olvidarEncargos();
  try {
    return await fn();
  } finally {
    if (antes.u === undefined) delete process.env.COMPUTADORA_URL;
    else process.env.COMPUTADORA_URL = antes.u;
    if (antes.c === undefined) delete process.env.COMPUTADORA_CLAVE;
    else process.env.COMPUTADORA_CLAVE = antes.c;
    _olvidarEncargos();
  }
}

test('servidor (c): «Listo, 3 archivos» con runtime.log, random.txt y foto.png → la voz, el HECHO y la tarjeta dicen 0 de 3', async () => {
  const n = await nodo('Listo, ya quedaron los 3 archivos.', {
    archivos: [suelto('runtime.log', 'texto', '4'), suelto('random.txt', 'texto', '5'), suelto('foto.png', 'png', '6'), falta('informe.docx'), falta('presupuesto.xlsx'), falta('carta.pdf')],
  });
  try {
    await conNodo(n.url, async () => {
      const r = await encargarTarea({ instruccion: INSTR, quien: 'ana@x.hn', motor: 'holo', esperaMs: 8000 });
      assert.match(r.hecho, /SIN COMPROBAR/);
      assert.match(r.hecho, /0 de 3/);
      assert.match(r.hecho, /runtime\.log.*no (es|son) lo que pediste/i);
      assert.equal(r.comprobada, false);
      const v = vistaMision(misionDeTarea(r.id!)!);
      assert.equal(v.final!.ok, false);
      assert.doesNotMatch(v.final!.texto, /^Listo/);
      assert.match(v.final!.texto, /0 de 3/);
      assert.deepEqual((v.final as any).entregables.map((e: any) => [e.texto.includes('informe.docx') || e.texto.includes('presupuesto.xlsx') || e.texto.includes('carta.pdf'), e.estado]), [
        [true, 'not_met'],
        [true, 'not_met'],
        [true, 'not_met'],
      ]);
    });
  } finally {
    await n.cerrar();
  }
});

test('servidor (b) y (e): uno de tres dice «1 de 3» y nombra lo que falta; los tres correctos, «Listo» con los tres comprobados', async () => {
  const uno = await nodo('Listo, ya quedaron los 3 archivos.', { archivos: [TRES_OK[0], falta('presupuesto.xlsx'), falta('carta.pdf')] });
  try {
    await conNodo(uno.url, async () => {
      const r = await encargarTarea({ instruccion: INSTR, quien: 'ana@x.hn', motor: 'holo', esperaMs: 8000 });
      const v = vistaMision(misionDeTarea(r.id!)!);
      assert.equal(v.final!.ok, false);
      assert.match(v.final!.texto, /1 de 3/);
      assert.match(v.final!.texto, /presupuesto\.xlsx/);
      assert.match(v.final!.sinComprobar || '', /falta[^.]*presupuesto\.xlsx/i);
      assert.deepEqual((v.final as any).entregables.map((e: any) => e.estado), ['verified', 'not_met', 'not_met']);
    });
  } finally {
    await uno.cerrar();
  }
  const tres = await nodo('Listo, ya quedaron los 3 archivos.', { archivos: [...TRES_OK, suelto('runtime.log', 'texto', '4')] });
  try {
    await conNodo(tres.url, async () => {
      const r = await encargarTarea({ instruccion: INSTR, quien: 'ana@x.hn', motor: 'holo', esperaMs: 8000 });
      assert.equal(r.comprobada, true);
      for (const nn of ['informe.docx', 'presupuesto.xlsx', 'carta.pdf']) assert.match(r.hecho, new RegExp(nn.replace('.', '\\.')));
      assert.doesNotMatch(r.hecho, /COMPROBADO[^]*runtime\.log/, 'lo que sobra no se cuenta como comprobado');
      const v = vistaMision(misionDeTarea(r.id!)!);
      assert.equal(v.final!.ok, true);
      assert.match(v.final!.texto, /^Listo/);
      assert.match(v.final!.texto, /3 de 3|informe\.docx[^)]*presupuesto\.xlsx[^)]*carta\.pdf/);
      assert.deepEqual((v.final as any).entregables.map((e: any) => e.estado), ['verified', 'verified', 'verified']);
    });
  } finally {
    await tres.cerrar();
  }
});

test('servidor: «guarda 3 PDFs» y el nodo solo encontró runtime.log → no queda ok (antes bastaba cualquier archivo nuevo)', async () => {
  const n = await nodo('Listo, guardé los 3 PDFs.', { archivos: [suelto('runtime.log', 'texto', '4')] });
  try {
    await conNodo(n.url, async () => {
      const r = await encargarTarea({ instruccion: 'Descarga las facturas y guarda 3 PDFs en Descargas', quien: 'ana@x.hn', motor: 'holo', esperaMs: 8000 });
      assert.equal(r.comprobada, false);
      const v = vistaMision(misionDeTarea(r.id!)!);
      assert.equal(v.final!.ok, false);
      assert.match(v.final!.texto, /0 de 3/);
    });
  } finally {
    await n.cerrar();
  }
});

/* ------------------------------------------------------------------ «tres archivos»: lo genérico también son archivos */

const nuevoEn = (n: string, tipo: string, s: string): A => ({ ruta: `${ESP}/Documents/${n}`, existe: true, bytes: 900, sha256: sha(s), reciente: true, tipo, integro: true });
const TRES_GENERICOS = [nuevoEn('resumen.txt', 'texto', '1'), nuevoEn('datos.csv', 'texto', '2'), nuevoEn('portada.png', 'png', '3')];

test('genéricos: «crea tres archivos», «save three files»… piden archivos; sin decir cuántos no es seguro', async () => {
  const { pideArchivo } = await import('../lib/tareas-durables');
  const casos: [string, number, boolean][] = [
    ['Crea tres archivos', 3, true],
    ['Guarda 3 archivos', 3, true],
    ['Genera dos ficheros', 2, true],
    ['Hazme tres documentos', 3, true],
    ['Save three files', 3, true],
    ['Create 2 files', 2, true],
    ['Create a file', 1, true],
    ['Crea un archivo', 1, true],
    ['Descarga los archivos', 1, false],
    ['Crea archivos con los datos', 1, false],
  ];
  for (const [q, n, seguro] of casos) {
    assert.equal(pideArchivo(q), true, q);
    const r = requisitosDeEntrega(q);
    assert.equal(r.items.length, n, `${q}: ${JSON.stringify(r)}`);
    assert.equal(r.seguro, seguro, q);
    // Con cero archivos y una respuesta que lo afirma con muchas palabras: nunca comprobado.
    const e = evaluarEntrega(mision(q, [], 'Listo, creé todos los archivos que pediste con los datos del proveedor de septiembre.'));
    assert.equal(e.tipo, 'archivo', q);
    assert.equal(e.comprobada, false, q);
    assert.equal(cerrar(q, [], 'Listo, creé todos los archivos que pediste con los datos del proveedor de septiembre.').c.estado, 'partial', q);
  }
  // Sin decir cuántos, ni con tres archivos buenos se completa.
  assert.equal(cerrar('Descarga los archivos', TRES_GENERICOS, 'Listo.').c.estado, 'partial');
});

test('«crea tres archivos»: 0 de 3, 1 de 3, registros y temporales no cuentan, tres buenos completan', () => {
  const q = 'Crea tres archivos';
  const cero = cerrar(q, [], 'Listo, creé los tres archivos');
  assert.equal(cero.c.estado, 'partial');
  assert.equal(cero.criterios.length, 3);
  assert.match(cero.texto, /0 de 3/);
  assert.equal(cero.s.state, 'partial');
  const uno = cerrar(q, [TRES_GENERICOS[0]], 'Listo, creé los tres archivos');
  assert.equal(uno.c.estado, 'partial');
  assert.match(uno.texto, /1 de 3/);
  const basura = cerrar(q, [suelto('runtime.log', 'texto', '7'), suelto('borrador.tmp', 'binario', '8'), suelto('descarga.part', 'binario', '9')], 'Listo, creé los tres archivos');
  assert.equal(basura.c.estado, 'partial');
  assert.ok(basura.criterios.every((x) => x.estado !== 'verified'), 'ni el registro ni los temporales cumplen');
  assert.match(basura.texto, /0 de 3/);
  // Un archivo vacío o viejo tampoco; y uno no cumple dos.
  assert.equal(cerrar(q, [TRES_GENERICOS[0], TRES_GENERICOS[1], nuevoEn('vacio.txt', 'vacio', '4')].map((a, i) => (i === 2 ? { ...a, bytes: 0 } : a)), 'Listo.').c.estado, 'partial');
  const tres = cerrar(q, TRES_GENERICOS, 'Listo, creé los tres archivos');
  assert.equal(tres.c.estado, 'completed');
  assert.equal(tres.criterios.filter((x) => x.estado === 'verified').length, 3);
  assert.equal(tres.s.state, 'completed');
});

test('servidor: «crea tres archivos» con cero archivos → la frase dice 0 de 3 y no «Listo»; con tres buenos, «Listo»', async () => {
  const cero = await nodo('Listo, creé los tres archivos', { archivos: [] });
  try {
    await conNodo(cero.url, async () => {
      const r = await encargarTarea({ instruccion: 'Crea tres archivos con el resumen', quien: 'ana@x.hn', motor: 'holo', esperaMs: 8000 });
      assert.equal(r.comprobada, false);
      assert.match(r.hecho, /SIN COMPROBAR/);
      const v = vistaMision(misionDeTarea(r.id!)!);
      assert.equal(v.final!.ok, false);
      assert.doesNotMatch(v.final!.texto, /^Listo/);
      assert.match(v.final!.texto, /0 de 3/);
    });
  } finally {
    await cero.cerrar();
  }
  const tres = await nodo('Listo, creé los tres archivos', { archivos: TRES_GENERICOS });
  try {
    await conNodo(tres.url, async () => {
      const r = await encargarTarea({ instruccion: 'Crea tres archivos con el resumen', quien: 'ana@x.hn', motor: 'holo', esperaMs: 8000 });
      assert.equal(r.comprobada, true);
      const v = vistaMision(misionDeTarea(r.id!)!);
      assert.match(v.final!.texto, /^Listo/);
      assert.match(v.final!.texto, /3 de 3/);
    });
  } finally {
    await tres.cerrar();
  }
});

/* ------------------------------------------------------------------ ronda 3: reglas de diseño (R1–R5) */

const VERBOSO = 'Listo, ya quedó todo lo que pediste con el contenido del sitio del proveedor de septiembre.';
const arch = (ruta: string, tipo: string, s: string, extra: A = {}): A => ({ ruta: `${ESP}/${ruta}`, existe: true, bytes: 3000, sha256: sha(s), reciente: true, tipo, integro: true, ...extra });

test('R1: un archivo mencionado que no existe nunca deja completar, tampoco por «dato»', () => {
  const dato = cerrar('Busca el horario del banco', [{ ruta: 'horario.txt', existe: false, bytes: 0, sha256: null, mencionado: true }], 'Abre de 9 a 4 de lunes a viernes; lo dejé anotado en horario.txt');
  assert.equal(dato.c.estado, 'partial', 'el modelo nombró horario.txt y no está');
  assert.match(dato.texto, /horario\.txt/);
  // El origen nombrado que no aparece tampoco: «convierte datos.csv» y datos.csv no está.
  const origen = cerrar('Convierte datos.csv a PDF', [{ ruta: 'datos.csv', existe: false, bytes: 0, sha256: null, mencionado: true }, arch('Documents/datos.pdf', 'pdf', '1')], 'Listo.');
  assert.equal(origen.c.estado, 'partial');
  // Fuera del espacio también es «no existe».
  assert.equal(cerrar('Crea informe.docx', [ok('informe.docx', 'docx', '1'), { ruta: '/tmp/copia.docx', existe: false, bytes: 0, sha256: null, mencionado: true, fuera: true }], 'Listo, y dejé otra en /tmp/copia.docx').c.estado, 'partial');
});

test('R2: cualquier familia de archivo hace la misión de archivos, aunque el verbo no esté en la lista', async () => {
  const { pideArchivo } = await import('../lib/tareas-durables');
  for (const q of ['imprime el reporte a PDF', 'print the invoice as PDF', 'grab a screenshot of the homepage', 'screenshot the dashboard', 'dos capturas del sitio por favor', 'comprime la carpeta reportes', 'ponme el estado de cuenta en un excel', 'Hazme un pantallazo del panel']) {
    assert.equal(pideArchivo(q), true, q);
    const c = cerrar(q, [], VERBOSO);
    assert.equal(c.c.estado, 'partial', `${q}: con cero archivos no se completa`);
    assert.ok(c.criterios.length >= 1 && c.criterios.every((x) => x.estado !== 'verified'), q);
  }
  assert.equal(requisitosDeEntrega('dos capturas del sitio por favor').items.length, 2);
  // Con lo pedido de verdad, sí.
  assert.equal(cerrar('imprime el reporte a PDF', [arch('Documents/reporte.pdf', 'pdf', '1')], 'Listo.').c.estado, 'completed');
  assert.equal(cerrar('dos capturas del sitio por favor', [arch('Pictures/a.png', 'png', '1'), arch('Pictures/b.png', 'png', '2')], 'Listo.').c.estado, 'completed');
  assert.equal(cerrar('comprime la carpeta reportes', [arch('reportes.zip', 'zip', '1')], 'Listo.').c.estado, 'completed');
  assert.equal(cerrar('screenshot the dashboard', [arch('Pictures/dash.png', 'png', '1')], 'Done.').c.estado, 'completed');
  // Un dato con un archivo como fuente sigue siendo un dato.
  for (const q of ['Abre el PDF del reglamento y dime qué dice', 'Busca fotos de Copán y dime cuál te gusta']) {
    assert.equal(pideArchivo(q), false, q);
    assert.equal(cerrar(q, undefined, 'El reglamento fija el pago del impuesto el día 10 de cada mes, con multa del 5 por ciento.').c.estado, 'completed', q);
  }
});

test('R3: un archivo de origen nunca cumple; un origen sin nombre del mismo tipo deja el requisito sin comprobar', () => {
  const ventas = arch('Downloads/ventas.xlsx', 'xlsx', 'e', { mencionado: true });
  const unaHoja = cerrar('Abre ventas.xlsx desde el correo y hazme 2 hojas de cálculo', [ventas, arch('Documents/resumen.xlsx', 'xlsx', '1')], 'Listo, ya están las dos hojas.');
  assert.equal(unaHoja.c.estado, 'partial', 'ventas.xlsx es de donde sale, no una de las dos hojas');
  assert.match(unaHoja.texto, /1 de 2/);
  // Su copia («ventas (1).xlsx») tampoco.
  assert.equal(cerrar('Abre ventas.xlsx desde el correo y hazme 2 hojas de cálculo', [ventas, arch('Downloads/ventas (1).xlsx', 'xlsx', 'f'), arch('Documents/resumen.xlsx', 'xlsx', '1')], 'Listo.').c.estado, 'partial');
  assert.equal(cerrar('Abre ventas.xlsx desde el correo y hazme 2 hojas de cálculo', [ventas, arch('Documents/resumen.xlsx', 'xlsx', '1'), arch('Documents/totales.xlsx', 'xlsx', '2')], 'Listo.').c.estado, 'completed', 'dos hojas nuevas sí');
  const estado = requisitosDeEntrega('Baja el estado de cuenta y hazme 2 PDFs');
  assert.equal(estado.seguro, false, 'lo que se baja sin nombre no se distingue de lo creado');
  const baja = cerrar('Baja el estado de cuenta y hazme 2 PDFs', [arch('Downloads/estado.pdf', 'pdf', '1'), arch('Documents/resumen.pdf', 'pdf', '2')], 'Listo.');
  assert.equal(baja.c.estado, 'partial');
  assert.match(baja.texto, /no (puedo|pude) distinguir/i);
  assert.equal(cerrar('Lee datos.csv y crea tres archivos', [arch('datos.csv', 'texto', 'd', { mencionado: true }), arch('Documents/a.txt', 'texto', '1'), arch('Documents/b.txt', 'texto', '2')], 'Listo.').c.estado, 'partial', 'datos.csv no es uno de los tres');
  assert.equal(cerrar('Usa plantilla.docx y crea dos documentos de Word', [arch('Documents/plantilla.docx', 'docx', 'c', { mencionado: true }), arch('Documents/carta1.docx', 'docx', '1')], 'Listo.').c.estado, 'partial');
});

test('R4: el mismo contenido (sha256) cumple a lo más una cosa pedida', () => {
  const copia = cerrar('Haz dos capturas de la página', [arch('Pictures/captura.png', 'png', '1'), arch('Pictures/captura (copia).png', 'png', '1')], 'Listo.');
  assert.equal(copia.c.estado, 'partial', 'una copia idéntica no es otra captura');
  assert.match(copia.texto, /1 de 2/);
  assert.equal(cerrar('Haz dos capturas de la página', [arch('Pictures/captura.png', 'png', '1'), arch('Pictures/captura2.png', 'png', '2')], 'Listo.').c.estado, 'completed');
  assert.equal(cerrar('Crea tres archivos', [arch('a.txt', 'texto', '1'), arch('b.txt', 'texto', '1'), arch('c.txt', 'texto', '2')], 'Listo.').c.estado, 'partial');
});

test('R5: los requisitos salen de lo que pidió la persona; gana lo más exigente y se guardan al crear la misión', async () => {
  const combinar = (durables as any).requisitosCombinados as (i: string, p?: string) => { items: unknown[]; seguro: boolean };
  assert.equal(typeof combinar, 'function');
  assert.equal(combinar('Toma una captura de la página', 'Hazme tres capturas de la página').items.length, 3, 'el modelo dijo una; la persona, tres');
  assert.equal(combinar('Hazme tres capturas de la página', 'Toma una captura').items.length, 3);
  assert.equal(combinar('Crea un PDF con el resumen', 'Hazme un Word con el resumen').seguro, false, 'se contradicen: no es seguro');
  assert.equal(combinar('Crea un PDF con el resumen', undefined).items.length, 1);
  // El encargo durable nace con los requisitos de la persona.
  _usarAlmacenDurable(almacenEnMemoria());
  const ref = await (abrirEncargoComputadora as any)('cami@x.hn', 'web', 'Toma una captura de la página', 'Hazme tres capturas de la página');
  const enc = (await leerTarea('cami@x.hn', ref!.id)) as any;
  assert.equal(enc.tarea.criterios.length, 3);
  // Por el servidor: el nodo deja una captura; la persona pidió tres.
  const n = await nodo('Listo, ya tomé la captura.', { archivos: [arch('Pictures/captura.png', 'png', '1')] });
  try {
    await conNodo(n.url, async () => {
      const r = await (encargarTarea as any)({ instruccion: 'Toma una captura de la página', pedidoPersona: 'Hazme tres capturas de la página', quien: 'cami@x.hn', motor: 'holo', esperaMs: 8000 });
      assert.equal(r.comprobada, false);
      const v = vistaMision(misionDeTarea(r.id!)!);
      assert.equal(v.final!.ok, false);
      assert.match(v.final!.texto, /1 de 3/);
      assert.equal((v.final as any).entregables.length, 3);
    });
  } finally {
    await n.cerrar();
  }
});

test('calificador de formato: «dos archivos PDF» son 2 PDFs, no 2 archivos + 1 PDF', () => {
  const casos: [string, number, string][] = [
    ['Crea dos archivos PDF', 2, 'pdf'],
    ['Tres documentos PDF', 3, 'pdf'],
    ['Dos imágenes PNG', 2, 'png'],
    ['Un archivo Excel', 1, 'xlsx'],
    ['Dos documentos en Word', 2, 'docx'],
    ['Save two PDF files', 2, 'pdf'],
  ];
  for (const [q, n, ext] of casos) {
    const r = requisitosDeEntrega(q);
    assert.equal(r.items.length, n, `${q}: ${JSON.stringify(r.items)}`);
    assert.ok(r.items.every((i) => i.extensiones.includes(ext)), `${q}: todos de tipo ${ext}`);
  }
  // Entregar los dos PDFs pedidos completa.
  assert.equal(cerrar('Crea dos archivos PDF', [arch('Documents/a.pdf', 'pdf', '1'), arch('Documents/b.pdf', 'pdf', '2')], 'Listo.').c.estado, 'completed');
  // Control: «un Word y un PDF» siguen siendo dos cosas distintas.
  const control = requisitosDeEntrega('Crea un Word y un PDF');
  assert.equal(control.items.length, 2);
  assert.deepEqual(control.items.map((i) => i.extensiones.includes('pdf')).sort(), [false, true]);
});

/* ------------------------------------------------------------------ ronda 4 */

type Pedido = { items: { nombre?: string; extensiones: string[]; carpeta?: string }[]; seguro: boolean };
const combinar4 = (i: string, p?: string): Pedido => (durables as any).requisitosCombinados(i, p);
const conRequisitos = (instr: string, req: unknown, archivos: A[]) => evaluarEntrega({ ...mision(instr, archivos, 'Listo.'), requisitos: req } as any);

test('ronda 4 · 1: al combinar, lo más específico gana (un nombre o un tipo le gana a lo genérico)', () => {
  const r1 = combinar4('Crea informe.docx', 'Hazme un archivo');
  assert.deepEqual(r1.items.map((i) => i.nombre), ['informe.docx'], JSON.stringify(r1));
  assert.equal(conRequisitos('Crea informe.docx', r1, [arch('Documents/informe.docx', 'texto', '1'), arch('Documents/x.txt', 'texto', '2')]).comprobada, false, 'un informe.docx que por dentro es texto no cumple');
  assert.equal(conRequisitos('Crea informe.docx', r1, [arch('Documents/informe.docx', 'docx', '1')]).comprobada, true);
  const r2 = combinar4('Crea resumen.pdf', 'Hazme un PDF');
  assert.deepEqual(r2.items.map((i) => i.nombre), ['resumen.pdf']);
  assert.equal(conRequisitos('Crea resumen.pdf', r2, [arch('Documents/resumen.pdf', 'texto', '1'), arch('Documents/otro.pdf', 'pdf', '2')]).comprobada, false);
  const r3 = combinar4('Crea informe.docx y datos.xlsx', 'Hazme dos documentos');
  assert.deepEqual(r3.items.map((i) => i.nombre), ['informe.docx', 'datos.xlsx']);
  assert.equal(conRequisitos('Crea informe.docx y datos.xlsx', r3, [arch('Documents/informe.docx', 'texto', '1'), arch('Documents/notas.txt', 'texto', '2'), arch('Documents/datos.xlsx', 'xlsx', '3')]).comprobada, false);
  // La cantidad mayor, con los nombres.
  const r4 = combinar4('Crea informe.docx', 'Hazme tres archivos');
  assert.equal(r4.items.length, 3);
  assert.ok(r4.items.some((i) => i.nombre === 'informe.docx'));
  // Se contradicen: otro tipo.
  assert.equal(combinar4('Crea informe.docx', 'Hazme un PDF').seguro, false);
  assert.equal(combinar4('Crea resumen.pdf', 'Crea informe.pdf').seguro, false, 'otro nombre');
});

test('ronda 4 · 2: una corrección hablada reemplaza; un ejemplo de referencia es origen', () => {
  const n = (q: string) => requisitosDeEntrega(q).items;
  assert.equal(n('Hazme dos PDFs, no, tres PDFs').length, 3);
  assert.deepEqual(n('Hazme el informe en PDF no, mejor en Word').map((i) => i.extensiones[0]), ['docx']);
  assert.equal(n('Hazme dos PDFs, como el PDF de ayer').length, 2);
  assert.deepEqual(n('Hazme un Word, perdón, un PDF').map((i) => i.extensiones[0]), ['pdf']);
  assert.deepEqual(n('Hazme un PDF y no un Word').map((i) => i.extensiones[0]), ['pdf'], '«no un Word» excluye, no suma');
  assert.equal(n('Hazme tres PDFs igual que el anterior').length, 3);
  assert.equal(cerrar('Hazme dos PDFs, no, tres PDFs', [arch('a.pdf', 'pdf', '1'), arch('b.pdf', 'pdf', '2'), arch('c.pdf', 'pdf', '3')], 'Listo.').c.estado, 'completed');
});

test('ronda 4 · 3: la carpeta dicha con palabras se comprueba', () => {
  const r = requisitosDeEntrega('Guarda informe.pdf en la carpeta facturas');
  assert.equal(r.items[0].carpeta, 'facturas');
  assert.equal(cerrar('Guarda informe.pdf en la carpeta facturas', [arch('Documents/otra/informe.pdf', 'pdf', '1', { mencionado: true })], 'Listo.').c.estado, 'partial');
  assert.equal(cerrar('Guarda informe.pdf en la carpeta facturas', [arch('Documents/facturas/informe.pdf', 'pdf', '1', { mencionado: true })], 'Listo.').c.estado, 'completed');
  const q = 'Hazme 2 PDFs y guárdalos en Documentos/facturas';
  assert.deepEqual(requisitosDeEntrega(q).items.map((i) => i.carpeta), ['documents/facturas', 'documents/facturas']);
  assert.equal(cerrar(q, [arch('a.pdf', 'pdf', '1'), arch('b.pdf', 'pdf', '2')], 'Listo.').c.estado, 'partial', 'en la raíz no');
  assert.equal(cerrar(q, [arch('Documents/facturas/a.pdf', 'pdf', '1'), arch('Documents/facturas/b.pdf', 'pdf', '2')], 'Listo.').c.estado, 'completed');
  assert.equal(cerrar('Hazme un PDF y guárdalo en el escritorio', [arch('Desktop/x.pdf', 'pdf', '1')], 'Listo.').c.estado, 'completed', 'Escritorio = Desktop');
  assert.equal(cerrar('Hazme un PDF y guárdalo en el escritorio', [arch('Documents/x.pdf', 'pdf', '1')], 'Listo.').c.estado, 'partial');
  assert.equal(cerrar('Descarga el reglamento en Descargas', [arch('Downloads/reglamento.pdf', 'pdf', '1')], 'Listo.').c.estado, 'completed', 'Descargas = Downloads');
});

test('ronda 4 · 4: copiar, mover, renombrar o borrar no se dan por hechos por el texto', () => {
  const dicho = 'Listo, ya quedó: el contrato de arrendamiento del local está ahora donde pediste, con fecha de hoy.';
  for (const q of ['Copia el contrato a la carpeta de José', 'Mueve las facturas a la carpeta 2024', 'Renombra el contrato a contrato-final', 'Borra los borradores viejos del escritorio']) {
    const e = evaluarEntrega(mision(q, [], dicho));
    assert.equal(e.comprobada, false, q);
    assert.equal(cerrar(q, [], dicho).c.estado, 'partial', q);
  }
  // Estricto: la copia nombrada existe en la carpeta pedida con la MISMA huella que el original.
  const q = 'Copia contrato.pdf a la carpeta jose';
  const original = arch('Documents/contrato.pdf', 'pdf', '7', { mencionado: true, reciente: false });
  assert.equal(cerrar(q, [original, arch('jose/contrato.pdf', 'pdf', '7', { mencionado: true })], 'Listo.').c.estado, 'completed');
  assert.equal(cerrar(q, [original, arch('jose/contrato.pdf', 'pdf', '8', { mencionado: true })], 'Listo.').c.estado, 'partial', 'otra huella no es una copia');
  assert.equal(cerrar(q, [original, arch('otra/contrato.pdf', 'pdf', '7', { mencionado: true })], 'Listo.').c.estado, 'partial', 'otra carpeta tampoco');
});

test('ronda 4 · 5: «descomprime facturas.zip» no pide el ZIP como entregable', () => {
  const q = 'Descomprime facturas.zip';
  const c = cerrar(q, [arch('Downloads/facturas.zip', 'zip', 'z', { mencionado: true, reciente: false }), arch('Downloads/facturas/f1.pdf', 'pdf', '1')], 'Listo, ya lo descomprimí.');
  assert.ok(!c.criterios.some((x) => /facturas\.zip: existe/.test(x.texto)), `el ZIP es el origen: ${JSON.stringify(c.criterios.map((x) => x.texto))}`);
  assert.equal(c.c.estado, 'partial', 'sin poder comprobar qué salió del ZIP, queda sin comprobar');
});

/* ------------------------------------------------------------------ ronda 5: cerrado por defecto */

const INFORMATIVA = 'Listo, ya quedó: son 120 mil lempiras de ventas en marzo de 2025, con la gráfica y los datos del proveedor.';

test('ronda 5 · 1: producir algo que no se reconoce da «lo que pediste» sin tipo verificable; nunca verificado', () => {
  for (const q of ['Hazme una gráfica de ventas', 'Crea un diagrama del proceso', 'Diseña un logo para la tienda', 'Graba un audio con el saludo', 'Hazme un video corto', 'Crea la factura de Ana']) {
    const r = requisitosDeEntrega(q);
    assert.ok(r.items.some((i: any) => /lo que pediste/.test(i.etiqueta ?? '')), `${q}: ${JSON.stringify(r.items)}`);
    assert.equal(cerrar(q, [], INFORMATIVA).c.estado, 'partial', q);
    assert.equal(evaluarEntrega(mision(q, [], INFORMATIVA)).comprobada, false, q);
  }
  // Ni con un archivo que parezca serlo: no se sabe comprobar «una gráfica».
  assert.equal(cerrar('Hazme una gráfica de ventas', [arch('Pictures/grafica.png', 'png', '1')], INFORMATIVA).c.estado, 'partial');
  // Dato + producción: solo se completa si la producción se verifica (aquí no se puede).
  assert.equal(cerrar('Dime cuánto vendimos en marzo y hazme una gráfica', [], INFORMATIVA).c.estado, 'partial');
  // Si no se puede decidir, no es dato.
  assert.equal(cerrar('Haz las cuentas de enero, febrero y marzo', [], 'Enero 10, febrero 12 y marzo 15: total 37.').c.estado, 'partial');
});

test('ronda 5 · 2: una extensión conocida obliga a entrega; nunca es dato', () => {
  for (const q of ['Lee informe.pdf y dime qué dice', '¿Qué dice contrato.docx en la cláusula 3?', 'Dime cuántas filas tiene ventas.xlsx']) {
    assert.notEqual(evaluarEntrega(mision(q, [], INFORMATIVA)).tipo, 'dato', q);
    assert.equal(cerrar(q, [], INFORMATIVA).c.estado, 'partial', q);
  }
});

test('ronda 5 · 3: operaciones sobre archivos con los nombres quitados («facturas.zip» no es el verbo «zip»)', () => {
  const extraido = (n: string, s: string) => arch(`Downloads/${n}`, 'texto', s);
  const casos: [string, A[]][] = [
    ['Descomprime facturas.zip', [arch('Downloads/facturas.zip', 'zip', 'a', { mencionado: true, reciente: false }), extraido('facturas-enero.csv', '1')]],
    ['Unzip reports.zip', [arch('Downloads/reports.zip', 'zip', 'a', { mencionado: true, reciente: false }), extraido('reports-2024.csv', '1')]],
    ['Extrae fotos.zip', [arch('Downloads/fotos.zip', 'zip', 'a', { mencionado: true, reciente: false }), arch('Downloads/fotos/copan.png', 'png', '1')]],
    ['Mueve respaldo.zip a la carpeta 2024', [arch('2024/respaldo.zip', 'zip', 'a', { mencionado: true, reciente: false })]],
    ['Copia respaldo.zip a la carpeta respaldos', [arch('respaldo.zip', 'zip', 'a', { mencionado: true, reciente: false }), arch('respaldos/respaldo.zip', 'zip', 'b', { mencionado: true })]],
  ];
  for (const [q, a] of casos) {
    const e = evaluarEntrega(mision(q, a, INFORMATIVA));
    assert.equal(e.tipo, 'accion', q);
    assert.equal(e.comprobada, false, q);
    assert.equal(cerrar(q, a, INFORMATIVA).c.estado, 'partial', q);
  }
  // La instrucción del modelo en inglés combinada con lo que dijo la persona.
  const req = combinar4('Unzip reports.zip into the reports folder', 'Descomprime reports.zip');
  assert.equal(conRequisitos('Unzip reports.zip into the reports folder', req, [arch('Downloads/reports.zip', 'zip', 'a', { mencionado: true, reciente: false }), arch('reports/reports-2024.csv', 'texto', '1')]).comprobada, false);
  // La copia estricta sigue: misma huella en la carpeta pedida.
  assert.equal(cerrar('Copia respaldo.zip a la carpeta respaldos', [arch('respaldo.zip', 'zip', 'a', { mencionado: true, reciente: false }), arch('respaldos/respaldo.zip', 'zip', 'a', { mencionado: true })], 'Listo.').c.estado, 'completed');
});

test('ronda 5 · 4: nombres con acentos, paréntesis, comillas y espacios', () => {
  const nombre = (q: string) => requisitosDeEntrega(q).items.map((i) => i.nombre);
  assert.deepEqual(nombre('Crea cotización.xlsx con los precios'), ['cotización.xlsx']);
  assert.deepEqual(nombre('Guarda reporte (1).pdf en Documentos'), ['reporte (1).pdf']);
  assert.deepEqual(nombre('Crea reporte (versión final).docx'), ['reporte (versión final).docx']);
  assert.deepEqual(nombre('Crea «informe final.pdf» con el resumen'), ['informe final.pdf']);
  assert.deepEqual(nombre('Guarda "mis notas.txt"'), ['mis notas.txt']);
  assert.equal(cerrar('Crea cotización.xlsx con los precios', [arch('Documents/cotización.xlsx', 'xlsx', '1', { mencionado: true })], 'Listo.').c.estado, 'completed');
  assert.equal(cerrar('Crea cotización.xlsx con los precios', [arch('Documents/n.xlsx', 'xlsx', '1')], 'Listo.').c.estado, 'partial', '«n.xlsx» no es cotización.xlsx');
  // Sin comillas: «informe final.pdf» o «final.pdf». Solo la frase completa cumple.
  const q = 'Guarda el informe final.pdf';
  assert.equal(cerrar(q, [arch('Documents/final.pdf', 'pdf', '1', { mencionado: true })], 'Listo.').c.estado, 'partial');
  assert.equal(cerrar(q, [{ ruta: 'final.pdf', existe: false, bytes: 0, sha256: null, mencionado: true }, arch('Documents/informe final.pdf', 'pdf', '1')], 'Listo.').c.estado, 'completed');
});

test('ronda 5 · 5: carpetas con espacios, completas y exactas', () => {
  const q = 'Guarda informe.pdf en la carpeta Facturas 2024';
  assert.equal(requisitosDeEntrega(q).items[0].carpeta, 'facturas 2024');
  assert.equal(cerrar(q, [arch('Documents/Facturas 2024/informe.pdf', 'pdf', '1', { mencionado: true })], 'Listo.').c.estado, 'completed');
  assert.equal(cerrar(q, [arch('Documents/Facturas/informe.pdf', 'pdf', '1', { mencionado: true })], 'Listo.').c.estado, 'partial', 'una carpeta parecida no');
  assert.equal(cerrar(q, [arch('Documents/Facturas 2023/informe.pdf', 'pdf', '1', { mencionado: true })], 'Listo.').c.estado, 'partial');
  const q2 = 'Hazme 2 PDFs y guárdalos en Documentos/Facturas 2024';
  assert.deepEqual(requisitosDeEntrega(q2).items.map((i) => i.carpeta), ['documents/facturas 2024', 'documents/facturas 2024']);
  assert.equal(cerrar(q2, [arch('Documents/Facturas 2024/a.pdf', 'pdf', '1'), arch('Documents/Facturas 2024/b.pdf', 'pdf', '2')], 'Listo.').c.estado, 'completed');
});

/** Un generador con semilla fija (mulberry32): las mismas combinaciones en cada corrida. */
function azar(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('ronda 5 · propiedad: «verbo de producir + objeto» con cero archivos nunca queda comprobado', () => {
  const verbos = ['crea', 'créame', 'haz', 'hazme', 'genera', 'prepara', 'prepárame', 'arma', 'ármame', 'diseña', 'dibuja', 'graba', 'escribe', 'redacta', 'exporta', 'guarda', 'descarga', 'baja', 'imprime', 'copia', 'mueve', 'renombra', 'borra', 'descomprime', 'comprime', 'sube', 'envía', 'make', 'create', 'generate'];
  const objetos = [
    'una gráfica de ventas', 'un diagrama de flujo', 'un logo nuevo', 'un audio con el saludo', 'un video corto', 'la factura de Ana', 'el reporte mensual', 'una tabla de precios', 'un resumen de la reunión', 'una presentación para el lunes',
    'un PDF con el contrato', 'tres PDFs', 'una hoja de cálculo', 'dos capturas de pantalla', 'un archivo', 'tres archivos', 'el documento final', 'una carta para el banco', 'un póster', 'un folleto',
    'una invitación', 'un calendario', 'una lista de compras', 'un presupuesto', 'una cotización', 'un mapa del sitio', 'un plano', 'un menú', 'una portada', 'un certificado',
    'un flurbo azul', 'la zentaria de Ana', 'un quorbo', 'tres blivets', 'el trámite de Pedro', 'un glimmer', 'la cosa de ayer', 'un wobble', 'dos snarks', 'un prixel',
    'informe.docx', 'cotización.xlsx', 'reporte (1).pdf', 'fotos.zip', 'datos.csv', 'notas.txt', 'portada.png', 'respaldo.zip', 'contrato final.pdf', 'plan 2025.pptx',
    'a chart', 'a logo', 'a report', 'two PDFs', 'a spreadsheet', 'a screenshot', 'the invoice', 'a video', 'three files', 'a diagram',
  ];
  assert.equal(verbos.length, 30);
  assert.equal(objetos.length, 60);
  const r = azar(20261004);
  const malos: string[] = [];
  for (let i = 0; i < 300; i++) {
    const q = `${verbos[Math.floor(r() * verbos.length)]} ${objetos[Math.floor(r() * objetos.length)]}`;
    for (const resp of ['Listo, ya está', 'Listo, ya está: quedó con 3 páginas y los datos de 2025 del proveedor.']) {
      const e = evaluarEntrega(mision(q, [], resp));
      const c = reconciliarConComputadora(tarea(q), mision(q, [], resp), T0 + 60_000);
      if (e.comprobada || c?.estado === 'completed' || deComputadora(mision(q, [], resp), T0 + 60_000).state === 'completed') malos.push(`${q} | ${resp}`);
    }
  }
  assert.deepEqual(malos, [], `se completaron sin entrega: ${malos.slice(0, 10).join(' · ')}`);
});

test('ronda 5 · propiedad inversa: 30 consultas puras sí se completan con el dato', () => {
  const consultas = [
    '¿Cuánto es el tipo de cambio hoy?', 'Dime qué tiempo hace en Tegucigalpa', '¿Cuál es el horario del banco?', 'Busca y dime el precio del oro', 'Averigua cuánto cuesta el pasaje a San Pedro Sula',
    '¿Qué dice la página principal del BCH?', 'Explica qué es el impuesto sobre ventas', 'Lee la noticia principal y dime de qué trata', 'Resume la página del SAR y dime lo importante', '¿Quién ganó el partido de anoche?',
    '¿Cuándo abre la oficina del RNP?', '¿Dónde queda la agencia más cercana?', 'Dime cuántos habitantes tiene Copán', '¿Cuánto cuesta la gasolina súper?', 'Busca el clima de mañana y dime',
    '¿Qué hora es en Madrid?', 'Dime el teléfono de la alcaldía', '¿Cuál es la tasa de interés del banco?', 'Averigua si abre el museo el domingo', '¿Cuánto mide el pico Bonito?',
    'What is the exchange rate today?', 'Tell me the weather in Tegucigalpa', 'How much is the bus ticket?', 'Which bank has the lowest rate?', 'Find and tell me the price of coffee',
    'Explain what the page says', '¿Qué precio tiene el café hoy?', 'Dime cuál es la capital de Belice', '¿Cuántos días faltan para el feriado?', 'Busca y dime quién es el ministro de salud',
  ];
  assert.equal(consultas.length, 30);
  const noCompletan = consultas.filter((q) => cerrar(q, undefined, 'Son 24.70 lempiras según el Banco Central, actualizado hoy a las 10:00.').c.estado !== 'completed');
  assert.deepEqual(noCompletan, []);
});

test('ronda 5 · texto en el chat: un resumen, una traducción o una lista que van en la respuesta SON la entrega', () => {
  const resumen =
    'La noticia cuenta que el Banco Central subió la tasa de política monetaria medio punto. La medida busca frenar la inflación, que llegó al 5,8 por ciento en septiembre. Los bancos comerciales ajustarán sus tasas de préstamo en las próximas semanas.';
  assert.equal(cerrar('Hazme un resumen de la noticia', undefined, resumen).c.estado, 'completed', 'el resumen está en la respuesta');
  assert.equal(cerrar('Hazme un resumen de la noticia', undefined, 'Listo, ya está').c.estado, 'partial', 'un acuse no es un resumen');
  assert.equal(cerrar('Hazme un resumen de la noticia', undefined, 'Listo, ya está, hice el resumen como pediste.').c.estado, 'partial');
  const pdf = evaluarEntrega(mision('Hazme un resumen en PDF', [], resumen));
  assert.equal(pdf.tipo, 'archivo', 'en PDF es un archivo');
  assert.equal(pdf.comprobada, false);
  const traduccion = 'Here is the translation: The Central Bank raised the monetary policy rate by half a point to curb inflation, which reached 5.8 percent in September.';
  assert.equal(cerrar('Tradúceme esto al inglés: el Banco Central subió la tasa medio punto para frenar la inflación', undefined, traduccion).c.estado, 'completed');
  assert.equal(cerrar('Haz un resumen y una gráfica', undefined, resumen).c.estado, 'partial', 'la gráfica no va en el texto');
  assert.equal(cerrar('Dame una lista de 5 ideas para el negocio', undefined, '1. Vender café en línea con entrega a domicilio. 2. Ofrecer cursos de barismo. 3. Abrir un puesto en el mercado. 4. Hacer suscripciones mensuales. 5. Vender a oficinas.').c.estado, 'completed');
  // Lo que ya estaba: un correo va por su borrador; una acción en pantalla queda sin comprobar.
  assert.equal(cerrar('Escribe un correo a Ana con el resumen', undefined, resumen).c.estado, 'partial');
  assert.equal(cerrar('Abre YouTube y pon música', undefined, resumen).c.estado, 'partial');
  assert.equal(cerrar('Hazme un resumen y guárdalo', undefined, resumen).c.estado, 'partial', 'guardarlo es un archivo');
});

/* ------------------------------------------------------------------ ronda 6 */

const INFO6 = 'El oro cerró hoy en 2,410 dólares la onza, según el mercado de Londres; subió 1.2 por ciento en la semana.';

test('ronda 6 · G2-A: la integridad es estructural; un archivo truncado no cumple, un nodo que no la comprobó tampoco', () => {
  const tres = (cambio: Record<string, A>) =>
    [ok('informe.docx', 'docx', '1'), ok('presupuesto.xlsx', 'xlsx', '2'), ok('carta.pdf', 'pdf', '3')].map((a) => cambio[nombreDeArchivo(a)] ?? a);
  const nombreDeArchivo = (a: A) => String(a.ruta).split('/').pop()!;
  // El nodo vio la cabecera pero no la estructura (PDF sin %%EOF, docx sin directorio central…): no cumple.
  for (const [n, t] of [['informe.docx', 'docx'], ['presupuesto.xlsx', 'xlsx'], ['carta.pdf', 'pdf']]) {
    const c = cerrar(INSTR, tres({ [n]: ok(n, t, n === 'carta.pdf' ? '3' : n === 'informe.docx' ? '1' : '2', { integro: false, defecto: 'sin %%EOF', bytes: 9 }) }));
    assert.equal(c.c.estado, 'partial', n);
    assert.match(c.texto, new RegExp(`${n.replace('.', '\\.')}[^.]*(incompleto|dañado)`), n);
  }
  // Un nodo de antes (sin `integro`): sin comprobar, nunca verificado.
  const viejo = tres({ 'carta.pdf': (() => { const a = ok('carta.pdf', 'pdf', '3'); delete a.integro; return a; })() });
  assert.equal(cerrar(INSTR, viejo).c.estado, 'partial');
  assert.equal(cerrar(INSTR, tres({})).c.estado, 'completed', 'con los tres íntegros, sí');
});

test('ronda 6 · G2-B: una consulta con una acción en otro fragmento no es consulta', () => {
  const casos = [
    'Busca el precio del oro y anótalo en un excel',
    'Busca el precio del oro y avísale a Bruno',
    'Revisa si hay actualizaciones e instálalas',
    'Busca el precio del oro y mándaselo a Ana',
    'Busca el precio del oro y compártelo',
    'Busca el precio del oro y reenvíaselo',
    'Busca vuelos y apártame uno',
    'What is the gold price? Then email it to Ana',
    'Find the gold price and text it to Bruno',
    'Check the settings and fix the wifi',
    'Tell me the price and order two',
  ];
  for (const q of casos) assert.notEqual(cerrar(q, undefined, INFO6).c.estado, 'completed', q);
  for (const q of ['Busca el precio del oro y dime cuánto subió', 'Busca el precio del oro y la plata', 'Busca vuelos a Los Ángeles', 'Busca la película de anoche y dime de qué trata'])
    assert.equal(cerrar(q, undefined, INFO6).c.estado, 'completed', q);
});

test('ronda 6 · G2-B propiedad: «consulta + y + acción» (30 × 30) nunca se completa', () => {
  const consultas = [
    'Busca el precio del oro', 'Averigua el horario del banco', 'Investiga el clima de mañana', 'Consulta el saldo de la tarjeta', 'Revisa los vuelos a Madrid', 'Mira el tipo de cambio', 'Fíjate en el precio del café',
    'Compara las tasas de los bancos', 'Dime el precio de la gasolina', 'Explícame el reglamento nuevo', 'Cuéntame la noticia principal', 'Lee el correo de Ana', 'Resume la página del SAR', 'Encuentra el teléfono de la alcaldía',
    'Busca hoteles en Roatán', 'Averigua cuánto cuesta el pasaje', 'Revisa el pronóstico', 'Mira las ofertas de la tienda', 'Consulta el estado del pedido', 'Busca el horario del museo', 'Find the gold price',
    'Search for flights to Miami', 'Look up the exchange rate', 'Check the weather', 'Tell me the score', 'What is the price of coffee', 'How much is the ticket', 'Which bank has the best rate', 'Who won the game', 'Where is the nearest pharmacy',
  ];
  const acciones = [
    'anótalo en un excel', 'avísale a Bruno', 'instálalas', 'mándaselo a Ana', 'compártelo', 'reenvíaselo', 'apártame uno', 'cómpralo', 'pídelo', 'resérvalo', 'págalo', 'bórralo', 'súbelo', 'publícalo', 'agéndalo',
    'llama a Ana', 'escríbele a Bruno', 'fix the wifi', 'order two', 'email it to Ana', 'text it to Bruno', 'book one', 'buy it', 'send it', 'share it', 'save it', 'post it', 'install them', 'delete it', 'reply to Ana',
  ];
  assert.equal(consultas.length, 30);
  assert.equal(acciones.length, 30);
  const malos: string[] = [];
  for (const c of consultas) for (const a of acciones) {
    const q = `${c} ${/^[a-z]/.test(a) && /^[A-Z]/.test(c) && /[a-z]$/.test(c) && /^(fix|order|email|text|book|buy|send|share|save|post|install|delete|reply)/.test(a) ? 'and' : 'y'} ${a}`;
    if (cerrar(q, undefined, INFO6).c.estado === 'completed') malos.push(q);
  }
  assert.deepEqual(malos.slice(0, 15), [], `${malos.length} se completaron`);
});

test('ronda 6 · G2-C: lo que pidió la persona cuenta aunque el modelo encargue solo la consulta', () => {
  const m = { ...mision('Busca el precio del oro', undefined, INFO6), pedidoPersona: 'Busca el precio del oro y mándaselo a Ana' } as MisionComputadoraMin;
  const c = reconciliarConComputadora(tarea('Busca el precio del oro'), m, T0 + 60_000);
  assert.equal(c!.estado, 'partial', 'mandárselo a Ana no se comprueba con el precio');
  assert.equal(deComputadora(m, T0 + 60_000).state, 'partial');
  // Persona y modelo piden lo mismo (consulta): se completa.
  const igual = { ...mision('Busca el precio del oro', undefined, INFO6), pedidoPersona: '¿A cómo está el oro hoy?' } as MisionComputadoraMin;
  assert.equal(reconciliarConComputadora(tarea('Busca el precio del oro'), igual, T0 + 60_000)!.estado, 'completed');
  // Texto en el chat solo si ninguna de las dos pide otra cosa.
  const res =
    'La noticia cuenta que el Banco Central subió la tasa de política monetaria medio punto. La medida busca frenar la inflación, que llegó al 5,8 por ciento en septiembre.';
  const texto = { ...mision('Hazme un resumen de la noticia', undefined, res), pedidoPersona: 'Hazme un resumen de la noticia y mándaselo a Ana' } as MisionComputadoraMin;
  assert.equal(reconciliarConComputadora(tarea('Hazme un resumen de la noticia'), texto, T0 + 60_000)!.estado, 'partial');
});

test('ronda 6 · G2-C por el servidor: la misión guarda lo que pidió la persona y no queda ok con solo la consulta', async () => {
  const n = await nodo(INFO6, {});
  try {
    await conNodo(n.url, async () => {
      const r = await (encargarTarea as any)({ instruccion: 'Busca el precio del oro', pedidoPersona: 'Busca el precio del oro y mándaselo a Ana', quien: 'ana@x.hn', motor: 'holo', esperaMs: 8000 });
      assert.equal(r.comprobada, false);
      const m = misionDeTarea(r.id!)! as any;
      assert.equal(m.pedidoPersona, 'Busca el precio del oro y mándaselo a Ana', 'se guarda en la misión');
      assert.equal(vistaMision(m).final!.ok, false);
      // Persona y modelo piden solo la consulta: ok (otra misión: el nodo de prueba siempre da el mismo id).
      _olvidarEncargos();
      const r2 = await (encargarTarea as any)({ instruccion: 'Busca el precio del oro', pedidoPersona: '¿A cómo está el oro hoy?', quien: 'ana@x.hn', motor: 'holo', esperaMs: 8000 });
      assert.equal(r2.comprobada, true);
    });
  } finally {
    await n.cerrar();
  }
});

test('ronda 6 · G2-D: un acuse largo no se hace pasar por resumen ni traducción', () => {
  const acuses = [
    'Listo, ya hice el resumen de la noticia que me pediste. Lo terminé correctamente y lo revisé dos veces para que quedara bien, como pediste.',
    'Aquí lo tienes: completé el resumen tal como me lo pediste, lo preparé con cuidado y quedó listo para que lo leas cuando quieras.',
    "Done! I've finished the summary as you asked. I completed it carefully and I have done a second review so it is ready for you now.",
  ];
  for (const r of acuses) assert.equal(cerrar('Hazme un resumen de la noticia', undefined, r).c.estado, 'partial', r);
  assert.equal(cerrar('Tradúceme esto al inglés: el banco subió la tasa', undefined, "Here it is: I've translated it as you asked and I completed the translation carefully, it is done and ready now.").c.estado, 'partial');
  const real =
    'La noticia cuenta que el Banco Central subió la tasa de política monetaria medio punto. La medida busca frenar la inflación, que llegó al 5,8 por ciento en septiembre. Los bancos ajustarán sus tasas en las próximas semanas.';
  assert.equal(cerrar('Hazme un resumen de la noticia', undefined, real).c.estado, 'completed');
  assert.equal(cerrar('Hazme un resumen de la noticia', undefined, `Listo, aquí está el resumen: ${real}`).c.estado, 'completed', 'un acuse delante de un resumen real no lo anula');
});

test("ronda 6 · G2-E: nombres con apóstrofo («O'Brien.pdf» no es «Brien.pdf»)", () => {
  assert.deepEqual(requisitosDeEntrega("Crea O'Brien.pdf con la carta").items.map((i) => i.nombre), ["O'Brien.pdf"]);
  assert.deepEqual(requisitosDeEntrega('Crea O’Brien.pdf con la carta').items.map((i) => i.nombre), ['O’Brien.pdf']);
  assert.deepEqual(requisitosDeEntrega("Guarda 'O'Brien.pdf' en Documentos").items.map((i) => i.nombre), ["O'Brien.pdf"]);
  assert.equal(cerrar("Crea O'Brien.pdf con la carta", [arch('Documents/Brien.pdf', 'pdf', '1', { mencionado: true })], 'Listo.').c.estado, 'partial');
  assert.equal(cerrar("Crea O'Brien.pdf con la carta", [arch("Documents/O'Brien.pdf", 'pdf', '1', { mencionado: true })], 'Listo.').c.estado, 'completed');
});

test('ronda 6 · menores: dos carpetas en un pedido, nombres NFD en disco y «una tabla» en el chat', () => {
  const q = 'Guarda informe.pdf en Documentos y carta.pdf en el Escritorio';
  assert.deepEqual(requisitosDeEntrega(q).items.map((i) => [i.nombre, i.carpeta]), [['informe.pdf', 'documents'], ['carta.pdf', 'desktop']]);
  assert.equal(cerrar(q, [arch('Documents/informe.pdf', 'pdf', '1', { mencionado: true }), arch('Desktop/carta.pdf', 'pdf', '2', { mencionado: true })], 'Listo.').c.estado, 'completed');
  // «cotización.xlsx» descompuesto en el disco (NFD) es el mismo nombre.
  assert.equal(cerrar('Crea cotización.xlsx con los precios', [arch('Documents/cotización.xlsx'.normalize('NFD'), 'xlsx', '1', { mencionado: true })], 'Listo.').c.estado, 'completed');
  const tabla = 'Producto | Precio\nCafé | 120 lempiras\nAzúcar | 45 lempiras\nArroz | 38 lempiras\nFrijoles | 52 lempiras la libra en el mercado.';
  assert.equal(cerrar('Hazme una tabla con los precios', undefined, tabla).c.estado, 'completed');
  assert.equal(cerrar('Hazme una tabla en Excel con los precios', undefined, tabla).c.estado, 'partial');
});

test('ronda 3: lo legítimo de un archivo sigue completando', () => {
  const casos: [string, A[]][] = [
    ['Crea informe.docx', [ok('informe.docx', 'docx', '1')]],
    ['Guarda la página como PDF', [arch('Documents/pagina.pdf', 'pdf', '1')]],
    ['Hazme una hoja de cálculo con los precios', [arch('Documents/precios.xlsx', 'xlsx', '1')]],
    ['Toma una captura de pantalla', [arch('Pictures/captura.png', 'png', '1')]],
    ['Descarga el reglamento', [arch('Downloads/reglamento.pdf', 'pdf', '1')]],
    ['Convierte datos.csv a PDF', [arch('datos.csv', 'texto', 'd', { reciente: false, mencionado: true }), arch('Documents/datos.pdf', 'pdf', '1')]],
  ];
  for (const [q, a] of casos) assert.equal(cerrar(q, a, 'Listo.').c.estado, 'completed', q);
});

test('la app: la tarjeta cuenta cuántas cosas pedidas se comprobaron y lista cada una', async () => {
  const app: any = await import('../mobile/src/compa/computadora');
  const { finalEnPalabras, entregablesEnPalabras } = app;
  const entregables = [
    { id: 'entrega-1', texto: 'informe.docx', estado: 'verified' as const, detalle: 'informe.docx · 2048 bytes' },
    { id: 'entrega-2', texto: 'presupuesto.xlsx', estado: 'not_met' as const, detalle: 'presupuesto.xlsx está vacío' },
    { id: 'entrega-3', texto: 'carta.pdf', estado: 'unknown' as const, detalle: 'no pude comprobar que carta.pdf sea un PDF' },
  ];
  assert.equal(finalEnPalabras({ estado: 'hecha', ok: false, comprobado: false, entregables }), 'Sin comprobar · 1 de 3');
  assert.equal(finalEnPalabras({ estado: 'hecha', ok: false, comprobado: false, entregables }, 'en'), 'Not verified · 1 of 3');
  assert.deepEqual(entregablesEnPalabras(entregables), ['✓ informe.docx · 2048 bytes', '✗ presupuesto.xlsx está vacío', '? no pude comprobar que carta.pdf sea un PDF']);
  assert.equal(finalEnPalabras({ estado: 'hecha', ok: false, comprobado: false }), 'Sin comprobar', 'un servidor de antes sigue como antes');
  // El panel de Tareas (teléfono y web): lo pedido uno por uno, con la marca de SU estado.
  const { criteriosEnPalabras } = (await import('../mobile/src/lib/trabajos')) as any;
  const { s } = cerrar(INSTR, [TRES_OK[0], ok('presupuesto.xlsx', 'vacio', '2', { bytes: 0 }), (() => { const a = ok('carta.pdf', 'pdf', '3'); delete a.tipo; return a; })()]);
  assert.deepEqual(criteriosEnPalabras(s.acceptance).map((c: any) => c.texto), ['✓ informe.docx', '✗ presupuesto.xlsx', '? carta.pdf']);
  assert.deepEqual(criteriosEnPalabras([{ id: 'resultado', text: 'x', required: true, status: 'verified', evidenceIds: ['e'] }]), [], 'con un solo criterio, el resultado ya lo dice');
});
