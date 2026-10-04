/**
 * «Listo» no es evidencia (revisión externa, 4-oct): «"Listo" puede marcar entregables como comprobados aunque los
 * archivos no existan».
 *
 * Lo que tiene que ser verdad:
 *   · una misión de su computadora queda `completed` con su criterio `verified` solo con evidencia que se
 *     comprobó de verdad. «Listo», «hecho», «guardé el archivo» o «ya está» son lo que DICE el modelo, no prueba;
 *   · un archivo entregable cuenta solo si el NODO, al terminar, lo encontró dentro del espacio de trabajo de la
 *     misión (existe, más de 0 bytes, su sha256, y es de esta misión); un nodo de antes que no lo comprueba deja la
 *     tarea «sin comprobar», nunca verificada;
 *   · una dirección cuenta solo si su computadora la abrió (un paso hecho), no si solo aparece en el texto;
 *   · una respuesta con el dato que se pidió («Soleado, 28 grados») sigue siendo el resultado: es lo pedido;
 *   · lo que AURA dice (la voz del final y el HECHO para el modelo) no da por guardado lo que no se comprobó.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { deComputadora, reconciliarConComputadora, registroNuevo, type MisionComputadoraMin, type RegistroTarea } from '../lib/tareas-durables';
import { encargarTarea, _olvidarEncargos, historialDe, misionDeTarea, vistaMision } from '../server/computadora';

const T0 = Date.parse('2026-10-04T15:00:00Z');
const SHA = 'a'.repeat(64);

function tareaDeEncargo(instruccion: string): RegistroTarea {
  return registroNuevo(
    'tk_prueba1',
    {
      requestId: 'r-1',
      titulo: instruccion,
      objetivo: instruccion,
      estado: 'verifying',
      entorno: { kind: 'computadora', id: 'mis_1', displayName: 'Tu computadora' },
      criterios: [{ id: 'resultado', texto: 'Tu computadora termina y deja un resultado comprobable', obligatorio: true }],
      origen: { kind: 'chat' },
      enlace: { tipo: 'computadora', id: 'mis_1' },
    },
    T0
  );
}

const mision = (extra: Partial<MisionComputadoraMin> & { archivos?: unknown }): MisionComputadoraMin =>
  ({ id: 'mis_1', tareaId: 'mis_1', instruccion: 'x', estado: 'hecha', ok: true, inicio: T0, segundos: 40, resultado: null, ...extra }) as MisionComputadoraMin;

/* ------------------------------------------------------------------ la tarea durable */

test('dijo «Listo, guardé el archivo», el nodo no comprobó nada (nodo de antes) → partial, nunca verified', () => {
  const instruccion = 'Crea un documento informe.odt con el resumen de ventas y guárdalo en Documentos';
  const m = mision({ instruccion, resultado: 'Listo, guardé el archivo informe.odt en Documentos.' });
  const c = reconciliarConComputadora(tareaDeEncargo(instruccion), m, T0 + 60_000);
  assert.ok(c);
  assert.equal(c!.estado, 'partial', 'decir que lo guardó no es comprobarlo');
  assert.ok(c!.criterios!.every((x) => x.estado !== 'verified'), 'ningún criterio verificado');
  assert.ok(!c!.resultado!.evidencias.some((e) => e.tipo === 'archivo'), 'sin archivo comprobado no hay evidencia de archivo');
  assert.match(c!.resultado!.parcial.join(' '), /no pude comprobar/i, 'lo dice con honestidad');
  assert.doesNotMatch(c!.resultado!.resumen, /^Listo/, 'el resumen no repite el «Listo» como si fuera un hecho');
  // La vista de una misión suelta (sin tarea durable) dice lo mismo.
  const s = deComputadora(m, T0 + 60_000);
  assert.equal(s.state, 'partial');
  assert.notEqual(s.acceptance[0].status, 'verified');
});

test('dijo «Listo», el nodo buscó y el archivo NO existe → partial con «no pude comprobarlo»', () => {
  const instruccion = 'Guarda la tabla de precios como precios.ods';
  const m = mision({
    instruccion,
    resultado: 'Listo.',
    archivos: [{ ruta: 'precios.ods', existe: false, bytes: 0, sha256: null, mencionado: true }],
  });
  const c = reconciliarConComputadora(tareaDeEncargo(instruccion), m, T0 + 60_000)!;
  assert.equal(c.estado, 'partial');
  assert.match(c.resultado!.parcial.join(' '), /precios\.ods/, 'nombra lo que no encontró');
  assert.equal(deComputadora(m, T0).state, 'partial');
});

test('un archivo vacío, viejo, fuera del espacio o sin huella no comprueba nada', () => {
  const instruccion = 'Descarga el reglamento y guárdalo';
  for (const a of [
    { ruta: '/home/computeruse/Downloads/reglamento.pdf', existe: true, bytes: 0, sha256: SHA, reciente: true },
    { ruta: '/home/computeruse/Downloads/reglamento.pdf', existe: true, bytes: 900, sha256: SHA, reciente: false },
    { ruta: '/home/computeruse/../../etc/passwd', existe: true, bytes: 900, sha256: SHA, reciente: true },
    { ruta: '/tmp/reglamento.pdf', existe: false, bytes: 0, sha256: null, fuera: true, mencionado: true },
    { ruta: '/home/computeruse/Downloads/reglamento.pdf', existe: true, bytes: 900, sha256: 'no-es-un-hash', reciente: true },
  ]) {
    const c = reconciliarConComputadora(tareaDeEncargo(instruccion), mision({ instruccion, resultado: 'Listo, ya lo descargué.', archivos: [a] }), T0 + 60_000)!;
    assert.equal(c.estado, 'partial', JSON.stringify(a));
  }
});

test('el nodo comprobó el archivo (existe, bytes, sha256, de esta misión) → completed con su evidencia de archivo', () => {
  const instruccion = 'Crea un documento informe.odt con el resumen y guárdalo';
  const m = mision({
    instruccion,
    resultado: 'Listo, guardé el archivo informe.odt en Documentos.',
    archivos: [{ ruta: '/home/computeruse/Documents/informe.odt', existe: true, bytes: 2048, sha256: SHA, reciente: true, mencionado: true, tipo: 'odt' }],
  });
  const c = reconciliarConComputadora(tareaDeEncargo(instruccion), m, T0 + 60_000)!;
  assert.equal(c.estado, 'completed');
  // Un nodo de antes no mira el tipo por dentro: el mismo archivo queda «sin comprobar», no verificado.
  const sinTipo = mision({ ...m, archivos: [{ ...(m as any).archivos[0], tipo: undefined }] });
  assert.equal(reconciliarConComputadora(tareaDeEncargo(instruccion), sinTipo, T0 + 60_000)!.estado, 'partial');
  const ev = c.resultado!.evidencias.find((e) => e.tipo === 'archivo');
  assert.ok(ev, 'la evidencia es el archivo comprobado');
  assert.equal(ev!.ref, '/home/computeruse/Documents/informe.odt');
  assert.match(ev!.etiqueta, /2048 bytes/);
  assert.ok(c.criterios!.every((x) => x.estado === 'verified' && x.evidencias.includes(ev!.id)));
  // Si nombró otro archivo que no apareció, no basta con que haya uno.
  const otro = mision({ ...m, archivos: [...(m as any).archivos, { ruta: 'anexo.pdf', existe: false, bytes: 0, sha256: null, mencionado: true }] });
  assert.equal(reconciliarConComputadora(tareaDeEncargo(instruccion), otro, T0 + 60_000)!.estado, 'partial');
});

test('una acción con efecto (llenar y enviar) que solo dice «Listo» no queda comprobada', () => {
  const instruccion = 'Entra a sar.gob.hn, llena el formulario de contacto y envíalo';
  const m = mision({ instruccion, resultado: 'Listo, ya lo envié.', enlaces: ['https://sar.gob.hn/contacto'] });
  const c = reconciliarConComputadora(tareaDeEncargo(instruccion), m, T0 + 60_000)!;
  assert.equal(c.estado, 'partial', 'abrir la página no prueba que se envió');
  assert.equal(deComputadora(m, T0).state, 'partial');
});

test('una dirección que solo está en el texto no es evidencia; la respuesta con el dato pedido sí es el resultado', () => {
  const sinDato = mision({ instruccion: 'Busca el reglamento del SAR', resultado: 'Listo: https://sar.gob.hn/reglamento.pdf', enlaces: [] });
  const c = reconciliarConComputadora(tareaDeEncargo('Busca el reglamento del SAR'), sinDato, T0 + 60_000)!;
  assert.equal(c.estado, 'partial');
  assert.ok(!c.resultado!.evidencias.some((e) => e.ref === 'https://sar.gob.hn/reglamento.pdf'), 'una URL inventada en el texto no es evidencia');
  // Lo que se pidió es un dato y la respuesta lo trae: ese es el resultado (no un «listo»).
  const clima = mision({ instruccion: 'Busca el clima de Tegucigalpa', resultado: 'Soleado, 28 grados', enlaces: ['https://clima.ejemplo/tgu'] });
  const c2 = reconciliarConComputadora(tareaDeEncargo('Busca el clima de Tegucigalpa'), clima, T0 + 60_000)!;
  assert.equal(c2.estado, 'completed');
  assert.ok(c2.resultado!.evidencias.some((e) => e.ref === 'https://clima.ejemplo/tgu'), 'la página que abrió de verdad sí cuenta');
});

/* ------------------------------------------------------------------ el servidor contra un nodo */

async function nodo(respuesta: string, extra: Record<string, unknown> = {}) {
  const srv = http.createServer((req, res) => {
    let datos = '';
    req.on('data', (c) => (datos += c));
    req.on('end', () => {
      const json = (code: number, j: unknown) => (res.writeHead(code, { 'content-type': 'application/json' }), res.end(JSON.stringify(j)));
      if (req.url === '/salud') return json(200, { ok: true, motores: ['holo'], ocupada: false });
      if (req.method === 'POST' && req.url === '/tareas') return json(200, { id: 'n1', estado: 'en_cola' });
      return json(200, {
        id: 'n1',
        motor: 'holo',
        instruccion: 'x',
        estado: 'hecha',
        segundos: 20,
        pasos: [{ n: 1, t: 2, accion: 'click', args: { x: 1, y: 2 }, hecho: true }, { n: 2, t: 9, accion: 'answer' }],
        respuesta,
        error: null,
        ...extra,
      });
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return { url, cerrar: () => new Promise<void>((r) => srv.close(() => r())) };
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

test('servidor: el nodo dice «Listo, guardé informe.odt» y no lo comprobó → AURA no dice que quedó guardado', async () => {
  const n = await nodo('Listo, guardé el archivo informe.odt en Documentos.');
  try {
    await conNodo(n.url, async () => {
      const r = await encargarTarea({ instruccion: 'Crea un documento informe.odt con el resumen y guárdalo', quien: 'jose@x.hn', motor: 'holo', esperaMs: 8000 });
      assert.match(r.hecho, /no (pude|se pudo) comprobar/i, 'el HECHO para el modelo dice que no se comprobó');
      assert.match(r.hecho, /no digas que (qued[oó]|lo) /i, 'y le prohíbe darlo por hecho');
      const m = misionDeTarea(r.id!)!;
      const v = vistaMision(m);
      assert.equal(v.final!.ok, false, 'la tarjeta no es «Listo»');
      assert.doesNotMatch(v.final!.texto, /^Listo, ya terminé/, 'la voz del final no lo da por hecho');
      assert.match(v.final!.texto, /no (lo )?pude comprobar|no lo encontr/i);
      assert.equal(historialDe('jose@x.hn')[0].ok, false);
    });
  } finally {
    await n.cerrar();
  }
});

test('servidor: el nodo comprobó informe.odt (existe, bytes, sha256) → la misión queda ok y el HECHO lo dice', async () => {
  const n = await nodo('Listo, guardé el archivo informe.odt en Documentos.', {
    archivos: [{ ruta: '/home/computeruse/Documents/informe.odt', existe: true, bytes: 4096, sha256: SHA, reciente: true, mencionado: true, tipo: 'odt' }],
  });
  try {
    await conNodo(n.url, async () => {
      const r = await encargarTarea({ instruccion: 'Crea un documento informe.odt con el resumen y guárdalo', quien: 'jose@x.hn', motor: 'holo', esperaMs: 8000 });
      assert.match(r.hecho, /informe\.odt/);
      assert.match(r.hecho, /4096 bytes/, 'el HECHO lleva lo que comprobó el nodo');
      const v = vistaMision(misionDeTarea(r.id!)!);
      assert.equal(v.final!.ok, true);
      assert.match(v.final!.texto, /^Listo/);
    });
  } finally {
    await n.cerrar();
  }
});

/* ------------------------------------------------------------------ las reglas y lo que ve la persona */

test('reglas: qué pide un archivo, qué es una acción con efecto y qué respuesta trae algo', async () => {
  const { pideArchivo, pideAccion, respuestaInformativa, archivoComprobado } = await import('../lib/tareas-durables');
  assert.equal(pideArchivo('Descarga el PDF del reglamento'), true);
  assert.equal(pideArchivo('Hazme una hoja de cálculo con los precios'), true);
  assert.equal(pideArchivo('Busca el reglamento del SAR'), false);
  assert.equal(pideArchivo('Busca el horario', 'Listo, quedó guardado en Descargas.'), true, 'la respuesta que dice que guardó también pide comprobarlo');
  assert.equal(pideArchivo('Lee https://x.hn/reglamento.pdf y dime qué dice'), false, 'una dirección no es un archivo que dejar');
  assert.equal(pideAccion('Entra a sar.gob.hn, llena el formulario y envíalo'), true);
  assert.equal(pideAccion('Publica el anuncio en el grupo'), true);
  assert.equal(pideAccion('Revisa si el banco publica el tipo de cambio'), false, '«publica» a media frase no es una orden');
  assert.equal(pideAccion('Busca cómo enviar un paquete a Danlí'), false);
  assert.equal(respuestaInformativa('Listo.'), false);
  assert.equal(respuestaInformativa('¡Hecho! Ya está, todo listo como pediste.'), false);
  assert.equal(respuestaInformativa('Listo: https://sar.gob.hn/x'), false, 'una URL sola no es un dato');
  assert.equal(respuestaInformativa('(sin respuesta)'), false);
  assert.equal(respuestaInformativa('Compra 24.70'), true);
  assert.equal(respuestaInformativa('La página muestra noticias del banco central y un menú de servicios.'), true);
  assert.equal(archivoComprobado({ ruta: '/home/computeruse/a.odt', existe: true, bytes: 10, sha256: SHA, reciente: true }), true);
  assert.equal(archivoComprobado({ ruta: '/home/computeruse/a.odt', existe: true, bytes: 10, sha256: SHA.toUpperCase() }), false);
});

test('la app: una misión «hecha» sin comprobar dice «Sin comprobar» (no «Listo» ni «A medias») y no se comparte como hecha', async () => {
  // Módulo puro de la app (sin expo).
  const { finalEnPalabras, textoParaCompartir } = await import('../mobile/src/compa/computadora');
  assert.equal(finalEnPalabras({ estado: 'hecha', ok: false, comprobado: false }), 'Sin comprobar');
  assert.equal(finalEnPalabras({ estado: 'hecha', ok: false, comprobado: false }, 'en'), 'Not verified');
  assert.equal(finalEnPalabras({ estado: 'hecha', ok: true, comprobado: true }), 'Listo');
  assert.equal(finalEnPalabras({ estado: 'hecha', ok: false }), 'A medias', 'un servidor de antes sigue como antes');
  const t = textoParaCompartir('Guarda informe.odt', { respuesta: 'Listo, guardé informe.odt.', error: null, datos: [], enlaces: [], ok: false, sinComprobar: 'No encontré «informe.odt» en tu computadora.' });
  assert.match(t, /Sin comprobar: No encontré «informe\.odt»/);
});
