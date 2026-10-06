/**
 * FILE-02 (auditoría maestra del 6-oct, §8): el piloto obligatorio de tres entregables, por la API y no por el ratón.
 *
 * Una petición sintética («informe.docx, presupuesto.xlsx y carta.pdf») produce los tres: existen, se abren (se releen
 * con lib/leer-oficina.ts, ExcelJS y pdf.js, y su ZIP/XML se revisa), tienen el nombre y el tipo correctos, el contenido
 * completo en español y los totales del presupuesto comprobados al releer. Cada uno queda para bajar SOLO con la sesión
 * de su dueño. Y se repite con:
 *   · una interrupción a mitad (parcial con lo hecho y lo que falta; al pedirlo otra vez sigue sin repetir),
 *   · un archivo temporal dañado (se detecta al releerlo; se regenera una vez; si sigue dañado, ese archivo falla),
 *   · cantidad insuficiente (pidió tres y el modelo mandó dos: parcial, «falta carta.pdf»),
 *   · un crash entre generar y entregar (al retomar se comprueba y entrega UNA vez: sin entrega duplicada).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { almacenEnMemoria, claveDe, huellaDueno } from '../lib/durable';
import { paginasDeDocx, paginasDeXlsx } from '../lib/leer-oficina';
import { textoPorPaginas } from '../lib/leer-pdf-pdfjs';
import { abrirDescarga, almacenArchivosDisco, almacenArchivosMemoria, claveArchivo, disposicionDescarga, ESPACIO_ARCHIVOS, ESPACIO_LOTES } from '../lib/oficina/almacen';
import { crearDocumentos, type ReciboLote } from '../lib/oficina/entrega';
import { leerTarea } from '../lib/tareas-durables';

const PEDIDO_PERSONA = 'Hazme tres documentos: informe.docx con el avance de la obra, presupuesto.xlsx con los materiales y carta.pdf para la señora López';

const ENTRADA = {
  archivos: [
    {
      tipo: 'docx',
      nombre: 'informe.docx',
      spec: {
        titulo: 'Informe de avance de obra',
        subtitulo: 'Ampliación del almacén — octubre de 2026',
        secciones: [
          { titulo: 'Resumen', parrafos: ['La obra avanzó un 40 % según el cronograma; la cimentación está terminada.'] },
          { titulo: 'Próximos pasos', vinetas: ['Instalar la cubierta metálica', 'Pedir la inspección de bomberos'] },
        ],
      },
    },
    {
      tipo: 'xlsx',
      nombre: 'presupuesto.xlsx',
      spec: {
        titulo: 'Presupuesto de materiales',
        cliente: 'Comercial López',
        moneda: 'L',
        partidas: [
          { concepto: 'Cemento gris', unidad: 'bolsa', cantidad: 120, precio_unitario: 245.5 },
          { concepto: 'Varilla de 3/8"', unidad: 'quintal', cantidad: 8, precio_unitario: 1890 },
          { concepto: 'Arena de río', unidad: 'm³', cantidad: 12.5, precio_unitario: 650 },
        ],
        impuesto: { nombre: 'ISV', porcentaje: 15 },
      },
    },
    {
      tipo: 'pdf',
      nombre: 'carta.pdf',
      spec: {
        carta: {
          lugar_fecha: 'Tegucigalpa, 6 de octubre de 2026',
          destinatario: ['Sra. Ana López', 'Comercial López'],
          asunto: 'Presupuesto de materiales',
          saludo: 'Estimada señora López:',
          cuerpo: ['Le adjunto el presupuesto de materiales para la ampliación del almacén, con el ISV incluido.', '¿Podríamos revisarlo juntos el lunes?'],
          despedida: 'Atentamente,',
          firma: ['José Enamorado', 'Orden Global'],
        },
      },
    },
  ],
};
// 120 × 245,50 + 8 × 1 890 + 12,5 × 650 = 29 460 + 15 120 + 8 125 = 52 705; ISV 15 % = 7 905,75; total 60 610,75.
const TOTAL = 60_610.75;

let n = 0;
const nuevoDueno = () => `piloto-${n++}@ejemplo.com`;
const entorno = () => ({ almacen: almacenEnMemoria(), archivos: almacenArchivosMemoria() });
const manifiestos = (alm: ReturnType<typeof almacenEnMemoria>, dueno: string) => [...alm.objetos.keys()].filter((k) => k.startsWith(`${ESPACIO_ARCHIVOS}/${huellaDueno(dueno)}/`));

async function comprobarTres(r: ReciboLote, dueno: string, env: ReturnType<typeof entorno>) {
  assert.equal(r.estado, 'completo', r.texto);
  assert.deepEqual(
    r.archivos.map((a) => [a.nombre, a.tipo, a.mime, a.estado]),
    [
      ['informe.docx', 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'disponible'],
      ['presupuesto.xlsx', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'disponible'],
      ['carta.pdf', 'pdf', 'application/pdf', 'disponible'],
    ]
  );
  for (const a of r.archivos) {
    // El recibo distingue generado, validado y puesto a disposición; «abierto» no se sabe y no se inventa.
    assert.equal(a.generado && a.validado && a.disponible, true, a.nombre);
    assert.equal(a.abierto, null);
    assert.match(a.sha256!, /^[0-9a-f]{64}$/);
    assert.ok(a.bytes! > 500);
    assert.equal(a.enlace, `/api/documentos/${a.id}`);
    assert.equal(a.tipoReal, a.tipo, 'el tipo por dentro es el del nombre');
    assert.ok(a.comprobaciones!.length >= 2 && a.comprobaciones!.every((c) => c.ok), JSON.stringify(a.comprobaciones));
  }
  // Cada requisito de lo que pidió la persona, verificado con SU archivo (lib/entregables.ts).
  assert.deepEqual(
    r.pedidos.map((p) => [p.etiqueta, p.estado]),
    [
      ['informe.docx', 'verified'],
      ['presupuesto.xlsx', 'verified'],
      ['carta.pdf', 'verified'],
    ]
  );
  assert.match(r.texto, /^DOCUMENTOS LISTOS Y COMPROBADOS/);
  assert.match(r.texto, /No digas que se los mandaste por correo/);

  // Se bajan con la sesión del dueño, con los mismos bytes que se comprobaron; se abren de verdad.
  const bajar = async (nombre: string) => {
    const a = r.archivos.find((x) => x.nombre === nombre)!;
    const d = await abrirDescarga(dueno, a.id!, env);
    assert.equal(d.estado, 'ok', nombre);
    if (d.estado !== 'ok') throw new Error('no');
    assert.equal(d.m.nombre, nombre);
    assert.equal(d.m.sha256, a.sha256);
    return d.datos;
  };
  const docx = await bajar('informe.docx');
  const zip = await JSZip.loadAsync(docx);
  assert.ok(zip.file('word/document.xml') && zip.file('[Content_Types].xml'));
  const textoDocx = (await paginasDeDocx(docx)).map((p) => p.texto).join('\n');
  for (const s of ['Informe de avance de obra', 'La obra avanzó un 40 % según el cronograma', 'Instalar la cubierta metálica', 'Próximos pasos']) assert.ok(textoDocx.includes(s), s);

  const xlsx = await bajar('presupuesto.xlsx');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx as any);
  const ws = wb.getWorksheet('Presupuesto')!;
  let sub = 0;
  for (let fila = 5; fila <= 7; fila++) sub += Math.round(Number(ws.getCell(`D${fila}`).value) * Number(ws.getCell(`E${fila}`).value) * 100);
  const total = (ws.getCell('F10').value as { formula: string; result: number });
  assert.equal(total.formula, 'F8+F9');
  assert.equal(Math.round(total.result * 100), sub + Math.round(sub * 0.15), 'el total se comprueba al releer: cantidades × precios + ISV');
  assert.equal(total.result, TOTAL);
  assert.match((await paginasDeXlsx(xlsx)).map((p) => p.texto).join('\n'), /Arena de río/);

  const pdf = await bajar('carta.pdf');
  const leido = await textoPorPaginas(pdf);
  const textoPdf = leido!.paginas.join('\n');
  for (const s of ['Estimada señora López:', '¿Podríamos revisarlo juntos el lunes?', 'José Enamorado', 'Tegucigalpa, 6 de octubre de 2026']) assert.ok(textoPdf.includes(s), s);
}

test('FILE-02: una petición produce informe.docx, presupuesto.xlsx y carta.pdf, comprobados y para bajar solo por su dueño', async () => {
  const env = entorno();
  const dueno = nuevoDueno();
  const r = await crearDocumentos({ dueno, requestId: 'piloto-1', entrada: ENTRADA, instruccion: PEDIDO_PERSONA, ...env });
  await comprobarTres(r, dueno, env);

  // La tarea del panel quedó `completed` con un archivo como evidencia de cada criterio.
  const t = await leerTarea(dueno, r.tareaId!, env.almacen);
  assert.equal(t.ok && t.tarea?.estado, 'completed');
  if (t.ok && t.tarea) {
    assert.equal(t.tarea.criterios.length, 3);
    assert.ok(t.tarea.criterios.every((c) => c.estado === 'verified' && c.evidencias.length === 1));
    assert.equal(t.tarea.resultado?.evidencias.filter((e) => e.tipo === 'archivo').length, 3);
  }

  // Cero archivos de otro dueño: con otra cuenta, el mismo id no existe. Un id inventado tampoco.
  const otro = nuevoDueno();
  for (const a of r.archivos) assert.equal((await abrirDescarga(otro, a.id!, env)).estado, 'no');
  assert.equal((await abrirDescarga(dueno, 'd_000000000000000000000000', env)).estado, 'no');
  assert.equal((await abrirDescarga(dueno, '../../etc/passwd', env)).estado, 'no');
  assert.equal((await abrirDescarga('', r.archivos[0].id!, env)).estado, 'no');

  // Bytes cambiados en el almacén: no se sirven («dañado»), nunca otra cosa con el nombre bueno.
  const id = r.archivos[2].id!;
  env.archivos.objetos.set(claveArchivo(dueno, id), Buffer.from('%PDF-1.4 otra cosa'));
  assert.equal((await abrirDescarga(dueno, id, env)).estado, 'danado');

  // Retención: vencido → 410 y los bytes se borran.
  const doc = r.archivos[0].id!;
  const v = await abrirDescarga(dueno, doc, { ...env, ahora: Date.now() + 8 * 86_400_000 });
  assert.equal(v.estado, 'vencido');
  assert.equal(env.archivos.objetos.has(claveArchivo(dueno, doc)), false);

  // El nombre va saneado también en la cabecera (ASCII y UTF-8).
  assert.equal(disposicionDescarga('cotización "final".xlsx'), `attachment; filename="cotizacion _final_.xlsx"; filename*=UTF-8''cotizaci%C3%B3n%20%22final%22.xlsx`);
});

test('FILE-02 en disco: temporales invisibles, rename atómico al confirmar, nada a medias', async () => {
  const dir = fs.mkdtempSync('/tmp/aura-docs-prueba-');
  try {
    const env = { almacen: almacenEnMemoria(), archivos: almacenArchivosDisco(dir) };
    const dueno = nuevoDueno();
    const vistos: string[] = [];
    const r = await crearDocumentos({
      dueno,
      requestId: 'piloto-disco',
      entrada: ENTRADA,
      instruccion: PEDIDO_PERSONA,
      ...env,
      ganchos: { temporalEscrito: ({ ruta }) => void vistos.push(String(ruta)) },
    });
    assert.equal(r.estado, 'completo', r.texto);
    assert.equal(vistos.length, 3);
    for (const v of vistos) {
      assert.match(v, /\/\.tmp\/[0-9a-f]{32}\.part$/);
      assert.equal(fs.existsSync(v), false, 'el temporal se confirmó (rename) y ya no está');
    }
    const finales = fs.readdirSync(`${dir}/${huellaDueno(dueno)}`);
    assert.equal(finales.length, 3);
    assert.ok(finales.every((f) => /^d_[0-9a-f]{24}\.bin$/.test(f)), 'en disco no queda el nombre que eligió el modelo');
    assert.deepEqual(fs.readdirSync(`${dir}/.tmp`), []);
    const d = await abrirDescarga(dueno, r.archivos[1].id!, env);
    assert.equal(d.estado, 'ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('FILE-02 con interrupción: parcial con lo hecho y lo que falta; al pedirlo otra vez sigue sin repetir', async () => {
  const env = entorno();
  const dueno = nuevoDueno();
  const corte = new AbortController();
  const r1 = await crearDocumentos({
    dueno,
    requestId: 'piloto-corte',
    entrada: ENTRADA,
    instruccion: PEDIDO_PERSONA,
    senal: corte.signal,
    ...env,
    ganchos: { antesDeArchivo: (_n, i) => void (i === 1 && corte.abort()) },
  });
  assert.equal(r1.estado, 'parcial');
  assert.equal(r1.interrumpido, true);
  assert.deepEqual(
    r1.archivos.map((a) => [a.nombre, a.estado]),
    [
      ['informe.docx', 'disponible'],
      ['presupuesto.xlsx', 'pendiente'],
      ['carta.pdf', 'pendiente'],
    ]
  );
  assert.match(r1.texto, /^DOCUMENTOS A MEDIAS/);
  assert.match(r1.texto, /informe\.docx/);
  assert.match(r1.texto, /falta presupuesto\.xlsx/);
  assert.match(r1.texto, /falta carta\.pdf/);
  assert.match(r1.texto, /NO digas «ya quedó»/);
  const t1 = await leerTarea(dueno, r1.tareaId!, env.almacen);
  assert.equal(t1.ok && t1.tarea?.estado, 'blocked', 'interrumpida: abierta para retomar, no terminada');

  const r2 = await crearDocumentos({ dueno, requestId: 'piloto-corte', entrada: ENTRADA, instruccion: PEDIDO_PERSONA, ...env });
  await comprobarTres(r2, dueno, env);
  assert.equal(r2.archivos[0].repetido, true, 'el informe ya estaba: no se volvió a hacer');
  assert.equal(r2.archivos[0].sha256, r1.archivos[0].sha256);
  assert.equal(r2.tareaId, r1.tareaId, 'la misma tarea');
  assert.equal(manifiestos(env.almacen, dueno).length, 3);
  assert.equal(env.archivos.objetos.size, 3);
  const t2 = await leerTarea(dueno, r2.tareaId!, env.almacen);
  assert.equal(t2.ok && t2.tarea?.estado, 'completed');
});

test('FILE-02 con un temporal dañado: se detecta al releerlo y se regenera; dañado siempre, ese archivo falla y los demás siguen', async () => {
  const env = entorno();
  const dueno = nuevoDueno();
  // Daña el temporal del presupuesto UNA vez (un disco que corta la escritura a la mitad).
  const r1 = await crearDocumentos({
    dueno,
    requestId: 'piloto-danado-1',
    entrada: ENTRADA,
    instruccion: PEDIDO_PERSONA,
    ...env,
    ganchos: {
      temporalEscrito: ({ nombre, token, intento }) => {
        if (nombre === 'presupuesto.xlsx' && intento === 1) env.archivos.temporales.set(token, env.archivos.temporales.get(token)!.subarray(0, 900));
      },
    },
  });
  await comprobarTres(r1, dueno, env);
  const p = r1.archivos.find((a) => a.nombre === 'presupuesto.xlsx')!;
  assert.equal(p.intentos, 2);
  assert.match(p.detalle, /primer intento salió dañado/);
  assert.equal(env.archivos.temporales.size, 0, 'ningún temporal queda colgado');

  // Dañado SIEMPRE: la carta no se entrega (ni su ficha ni sus bytes); los otros dos sí; parcial con el porqué.
  const env2 = entorno();
  const r2 = await crearDocumentos({
    dueno,
    requestId: 'piloto-danado-2',
    entrada: ENTRADA,
    instruccion: PEDIDO_PERSONA,
    ...env2,
    ganchos: { temporalEscrito: ({ nombre, token }) => void (nombre === 'carta.pdf' && env2.archivos.temporales.set(token, Buffer.from('%PDF-1.4\nbasura'))) },
  });
  assert.equal(r2.estado, 'parcial');
  const c = r2.archivos.find((a) => a.nombre === 'carta.pdf')!;
  assert.equal(c.estado, 'fallido');
  assert.equal(c.disponible, false);
  assert.equal(c.intentos, 2);
  assert.match(c.detalle, /dañado/);
  assert.equal(manifiestos(env2.almacen, dueno).length, 2);
  assert.equal(env2.archivos.objetos.size, 2);
  assert.equal(env2.archivos.temporales.size, 0);
  assert.match(r2.texto, /carta\.pdf/);
  assert.match(r2.texto, /NO digas «ya quedó»/);
  const t = await leerTarea(dueno, r2.tareaId!, env2.almacen);
  assert.equal(t.ok && t.tarea?.estado, 'partial');
});

test('FILE-02 con cantidad insuficiente: pidió tres y vinieron dos → parcial, «falta carta.pdf»', async () => {
  const env = entorno();
  const dueno = nuevoDueno();
  const r = await crearDocumentos({ dueno, requestId: 'piloto-dos', entrada: { archivos: ENTRADA.archivos.slice(0, 2) }, instruccion: PEDIDO_PERSONA, ...env });
  assert.equal(r.estado, 'parcial');
  assert.deepEqual(
    r.pedidos.map((p) => [p.etiqueta, p.estado]),
    [
      ['informe.docx', 'verified'],
      ['presupuesto.xlsx', 'verified'],
      ['carta.pdf', 'not_met'],
    ]
  );
  assert.deepEqual(r.faltan, ['falta carta.pdf']);
  assert.match(r.texto, /Lo que no quedó: falta carta\.pdf/);
  const t = await leerTarea(dueno, r.tareaId!, env.almacen);
  assert.equal(t.ok && t.tarea?.estado, 'partial', 'sin la evidencia de cada criterio no hay «completed»');
  // Una especificación mala para uno de los tres: los otros dos salen, y ese dice por qué no.
  const malo = { archivos: [ENTRADA.archivos[0], ENTRADA.archivos[1], { tipo: 'pdf', nombre: 'carta.pdf', spec: { carta: { saludo: 'Hola' } } }] };
  const r2 = await crearDocumentos({ dueno, requestId: 'piloto-malo', entrada: malo, instruccion: PEDIDO_PERSONA, ...entorno() });
  assert.equal(r2.estado, 'parcial');
  assert.match(r2.archivos.find((a) => a.nombre === 'carta.pdf')!.detalle, /especificación no sirve.*cuerpo/);
});

test('FILE-02 con crash entre generar y entregar: al retomar se comprueba y entrega UNA vez (sin entrega duplicada)', async () => {
  const env = entorno();
  const dueno = nuevoDueno();
  let ahora = Date.now();
  await assert.rejects(
    crearDocumentos({
      dueno,
      requestId: 'piloto-crash',
      entrada: ENTRADA,
      instruccion: PEDIDO_PERSONA,
      proceso: 'replica-a',
      ahora: () => ahora,
      ...env,
      ganchos: {
        trasGenerar: (nombre) => {
          if (nombre === 'presupuesto.xlsx') throw new Error('el proceso murió');
        },
      },
    }),
    /el proceso murió/
  );
  // Lo que quedó: el informe entregado; el presupuesto generado (bytes guardados) y SIN ficha; la carta sin empezar.
  const lote = env.almacen.objetos.get(claveDe(ESPACIO_LOTES, dueno, 'piloto-crash'))!;
  const estados = JSON.parse(lote).archivos.map((a: { nombre: string; estado: string }) => [a.nombre, a.estado]);
  assert.deepEqual(estados, [
    ['informe.docx', 'disponible'],
    ['presupuesto.xlsx', 'generado'],
    ['carta.pdf', 'pendiente'],
  ]);
  assert.equal(manifiestos(env.almacen, dueno).length, 1);
  const bytesPresupuesto = [...env.archivos.objetos.entries()].length;
  assert.equal(bytesPresupuesto, 2);

  // Otra réplica, con el lease del muerto aún vigente: no empieza a la vez.
  const ocupado = await crearDocumentos({ dueno, requestId: 'piloto-crash', entrada: ENTRADA, instruccion: PEDIDO_PERSONA, proceso: 'replica-b', ahora: () => ahora, ...env });
  assert.equal(ocupado.estado, 'fallido');
  assert.match(ocupado.texto, /otro proceso/);

  // Vencido el lease, retoma: el presupuesto se comprueba desde sus bytes y se entrega una vez; la carta se hace.
  ahora += 3 * 60_000;
  const r = await crearDocumentos({ dueno, requestId: 'piloto-crash', entrada: ENTRADA, instruccion: PEDIDO_PERSONA, proceso: 'replica-b', ahora: () => ahora, ...env });
  await comprobarTres(r, dueno, env);
  assert.equal(r.archivos[0].repetido, true);
  assert.equal(r.archivos[1].reanudado, true, 'el presupuesto no se regeneró: se comprobó y se entregó');
  assert.match(r.archivos[1].detalle, /estaba generado y sin entregar/);
  assert.equal(manifiestos(env.almacen, dueno).length, 3);
  assert.equal(env.archivos.objetos.size, 3);

  // Y otra vez el mismo pedido: nada nuevo, todo «ya estaba».
  const r3 = await crearDocumentos({ dueno, requestId: 'piloto-crash', entrada: ENTRADA, instruccion: PEDIDO_PERSONA, proceso: 'replica-c', ahora: () => ahora, ...env });
  assert.equal(r3.estado, 'completo');
  assert.ok(r3.archivos.every((a) => a.repetido));
  assert.equal(manifiestos(env.almacen, dueno).length, 3);
  assert.deepEqual(r3.archivos.map((a) => a.sha256), r.archivos.map((a) => a.sha256));
});

test('el mismo requestId con OTRO contenido no hereda ni pisa lo entregado', async () => {
  const env = entorno();
  const dueno = nuevoDueno();
  const r1 = await crearDocumentos({ dueno, requestId: 'piloto-mismo-id', entrada: ENTRADA, instruccion: PEDIDO_PERSONA, ...env });
  assert.equal(r1.estado, 'completo');
  const otra = { archivos: [{ ...ENTRADA.archivos[0], spec: { ...ENTRADA.archivos[0].spec, titulo: 'Otro informe' } }] };
  const r2 = await crearDocumentos({ dueno, requestId: 'piloto-mismo-id', entrada: otra, ...env });
  assert.equal(r2.estado, 'fallido');
  assert.match(r2.texto, /otro contenido/);
  assert.equal(manifiestos(env.almacen, dueno).length, 3);
  // Sin ningún archivo válido: fallido, sin tarea a medias, y lo dice.
  const r3 = await crearDocumentos({ dueno, requestId: 'piloto-vacio', entrada: { archivos: [] }, ...entorno() });
  assert.equal(r3.estado, 'fallido');
  assert.match(r3.texto, /^NO PUDE HACER LOS DOCUMENTOS/);
});
