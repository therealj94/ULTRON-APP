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
const requisitosDeEntrega = (s: string): { seguro: boolean; items: { nombre?: string; extensiones: string[] }[] } => (durables as any).requisitosDeEntrega(s);
import { encargarTarea, _olvidarEncargos, misionDeTarea, vistaMision } from '../server/computadora';
import { almacenEnMemoria, _usarAlmacenDurable } from '../lib/durable';
import { crearTarea, leerTarea, ENTORNO_INVESTIGACION } from '../lib/tareas-durables';
import { abrirEncargoComputadora, cerrarInvestigacion } from '../server/trabajos';

const T0 = Date.parse('2026-10-04T15:00:00Z');
const ESP = '/home/computeruse';
const INSTR = 'Crea tres documentos: informe.docx, presupuesto.xlsx y carta.pdf, y guárdalos en Documentos';
const sha = (c: string) => c.repeat(64);

type A = Record<string, unknown>;
const ok = (nombre: string, tipo: string, s: string, extra: A = {}): A => ({ ruta: `${ESP}/Documents/${nombre}`, existe: true, bytes: 2048, sha256: sha(s), reciente: true, mencionado: true, tipo, ...extra });
const falta = (nombre: string): A => ({ ruta: nombre, existe: false, bytes: 0, sha256: null, mencionado: true });
const suelto = (nombre: string, tipo: string, s: string): A => ({ ruta: `${ESP}/${nombre}`, existe: true, bytes: 300, sha256: sha(s), reciente: true, mencionado: false, tipo });

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
  const pdf = (n: string, s: string, tipo = 'pdf') => ({ ruta: `${ESP}/Downloads/${n}`, existe: true, bytes: 5000, sha256: sha(s), reciente: true, tipo });
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
