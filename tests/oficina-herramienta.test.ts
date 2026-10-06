/**
 * FILE-01: la herramienta del cerebro (`crear_documento` nativa → `PEDIR_HERRAMIENTA: documento <json>` → harness →
 * server/documentos.ts) y la descarga autenticada GET /api/documentos/:id.
 *
 *   · la línea lleva el JSON entero en UNA línea (también con U+2028 en el texto) y el harness la reconoce;
 *   · solo con sesión (y nunca en modo invitado) se ofrece; sin dueño no se hace nada;
 *   · el recibo vuelve al modelo con su estado: completo = éxito; parcial = éxito incompleto (no se memoriza); nada = fallo;
 *   · el reintento del MISMO turno retoma el mismo lote (no entrega dos veces) y la tarea queda enlazada al turno;
 *   · la descarga es solo para el dueño de la sesión: otra cuenta 404, sin sesión 401, con MIME real, nombre saneado,
 *     `nosniff` y la huella que se comprobó.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { herramientasDelTurno, herramientasQueCumplen, lineaDeHerramienta, type ManosDelTurno } from '../lib/cerebro-manos';
import { EFECTO_HERRAMIENTA, extraerPedidoHerramienta, instruccionHarness, resolverPedidoConEstado, resultadoMemorizable } from '../lib/harness';
import { manosDeInvitado } from '../server/modo-invitado';
import { correrDocumento, montarRutasDocumentos, resultadoDeLote } from '../server/documentos';
import { enTurnoConTrabajos, nuevoContextoTrabajos } from '../server/trabajos';

const ENTRADA = {
  archivos: [
    { tipo: 'docx', nombre: 'informe.docx', spec: { titulo: 'Informe semanal', secciones: [{ titulo: 'Avance', parrafos: ['Todo va según lo previsto,\u2028con una línea separada.'] }] } },
    { tipo: 'xlsx', nombre: 'presupuesto.xlsx', spec: { titulo: 'Presupuesto', partidas: [{ concepto: 'Pintura', unidad: 'galón', cantidad: 4, precio_unitario: 520 }], impuesto: { nombre: 'ISV', porcentaje: 15 } } },
    { tipo: 'pdf', nombre: 'carta.pdf', spec: { carta: { saludo: 'Estimado Carlos:', cuerpo: ['Le comparto el informe y el presupuesto.'], despedida: 'Saludos,', firma: ['Marta'] } } },
  ],
};
const PEDIDO = 'Prepárame informe.docx, presupuesto.xlsx y carta.pdf';

const MANOS: ManosDelTurno = { app: false, manos: [], sistema: false, computadora: true, correo: false, whatsapp: false, sesion: true, triaje: false };

test('crear_documento → una sola línea PEDIR_HERRAMIENTA: documento con el JSON entero (también con U+2028)', () => {
  const linea = lineaDeHerramienta('crear_documento', ENTRADA)!;
  assert.ok(linea.startsWith('PEDIR_HERRAMIENTA: documento {'));
  assert.equal(linea.split(/\r?\n|\u2028|\u2029/).length, 1, 'una sola línea');
  const ped = extraerPedidoHerramienta(`Ahora te los preparo.\n${linea}\n`)!;
  assert.equal(ped.herramienta, 'documento');
  assert.deepEqual(JSON.parse(ped.arg), ENTRADA);
  // Uno suelto ({tipo, nombre, spec}) también vale; sin archivos, no hay línea.
  const suelto = extraerPedidoHerramienta(lineaDeHerramienta('crear_documento', ENTRADA.archivos[2])!)!;
  assert.deepEqual(JSON.parse(suelto.arg), { archivos: [ENTRADA.archivos[2]] });
  assert.equal(lineaDeHerramienta('crear_documento', {}), null);
  assert.equal(EFECTO_HERRAMIENTA.documento, 'interno');
});

test('se ofrece solo con sesión y nunca a un invitado; la computadora remite a crear_documento', () => {
  const nombres = (m: ManosDelTurno) => herramientasDelTurno(m).map((t) => t.toolSpec!.name);
  assert.ok(nombres(MANOS).includes('crear_documento'));
  assert.ok(!nombres({ ...MANOS, sesion: false }).includes('crear_documento'));
  assert.ok(!nombres({ ...MANOS, documentos: false }).includes('crear_documento'));
  assert.ok(!nombres(manosDeInvitado(MANOS)).includes('crear_documento'));
  const compu = herramientasDelTurno(MANOS).find((t) => t.toolSpec!.name === 'computadora')!;
  assert.match(compu.toolSpec!.description!, /Para CREAR documentos de Word, Excel o PDF usa crear_documento/);
  const doc = herramientasDelTurno(MANOS).find((t) => t.toolSpec!.name === 'crear_documento')!;
  assert.match(doc.toolSpec!.description!, /TODOS los pedidos en UNA llamada/);
  // Dijo que lo hacía sin usar la herramienta («voy a escribir el informe…»): la segunda vuelta puede pedir crear_documento.
  assert.ok(herramientasQueCumplen('Voy a escribir el informe ahora mismo.', ['crear_documento', 'correo'], { mensaje: 'hazme informe.docx' }).includes('crear_documento'));
  assert.ok(!herramientasQueCumplen('Voy a escribir el informe ahora mismo.', ['correo'], { mensaje: 'hazme informe.docx' }).includes('crear_documento'));
  // El harness de texto (Qwen): con sesión sí, sin sesión no.
  assert.match(instruccionHarness('junta', false, false, true, false), /PEDIR_HERRAMIENTA: documento \{"archivos"/);
  assert.doesNotMatch(instruccionHarness('junta', false, false, false, false), /PEDIR_HERRAMIENTA: documento/);
});

test('el harness corre la herramienta solo si hay runner y nunca sin especificación', async () => {
  const sin = await resolverPedidoConEstado({ herramienta: 'documento', arg: '{"archivos":[]}' }, { web: async () => '', sistema: async () => '', leer: async () => '', ejecutor: async () => '' });
  assert.equal(sin.estado, 'failed');
  assert.match(sin.texto, /no digas que quedaron/);
  const vacio = await resolverPedidoConEstado({ herramienta: 'documento', arg: '' }, { web: async () => '', sistema: async () => '', leer: async () => '', ejecutor: async () => '', documento: async () => 'no debería' });
  assert.equal(vacio.estado, 'failed');
  let visto = '';
  const con = await resolverPedidoConEstado(
    { herramienta: 'documento', arg: '{"archivos":[1]}' },
    { web: async () => '', sistema: async () => '', leer: async () => '', ejecutor: async () => '', documento: async (a) => ((visto = a), { texto: 'ok', estado: 'succeeded' as const }) }
  );
  assert.equal(con.estado, 'succeeded');
  assert.equal(visto, '{"archivos":[1]}');
});

test('correrDocumento: sin sesión no hace nada; JSON roto tampoco; con su dueño, recibo completo y tarea enlazada al turno', async () => {
  const sin = await correrDocumento({ dueno: '', arg: JSON.stringify(ENTRADA) });
  assert.equal(sin.estado, 'failed');
  assert.equal(sin.recibo?.codigo, 'sin-sesion');
  const roto = await correrDocumento({ dueno: 'marta@ejemplo.com', arg: '{"archivos":[' });
  assert.equal(roto.estado, 'failed');
  assert.match(roto.texto, /no es JSON válido/);

  const ctx = nuevoContextoTrabajos('turno-documentos-0001');
  const arg = lineaDeHerramienta('crear_documento', ENTRADA)!.replace(/^PEDIR_HERRAMIENTA: documento /, '');
  const r = await enTurnoConTrabajos(ctx, () => correrDocumento({ dueno: 'marta@ejemplo.com', arg, pedido: PEDIDO }));
  assert.equal(r.estado, 'succeeded', r.texto);
  assert.equal(r.recibo?.efecto, 'guardado');
  assert.ok(resultadoMemorizable(r));
  assert.match(r.texto, /^HARNESS documento: DOCUMENTOS LISTOS Y COMPROBADOS/);
  assert.match(r.texto, /informe\.docx.*presupuesto\.xlsx.*carta\.pdf/);
  assert.equal(ctx.refs.length, 1, 'la tarea del panel queda enlazada a la respuesta del turno');
  assert.equal(ctx.refs[0].state, 'completed');

  // El reintento del MISMO turno (la app reenvía) retoma el mismo lote: nada se entrega dos veces.
  const ctx2 = nuevoContextoTrabajos('turno-documentos-0001');
  const otra = await enTurnoConTrabajos(ctx2, () => correrDocumento({ dueno: 'marta@ejemplo.com', arg, pedido: PEDIDO }));
  assert.equal(otra.estado, 'succeeded');
  assert.equal(ctx2.refs[0].id, ctx.refs[0].id);
});

test('resultadoDeLote: parcial no se memoriza como hecho; sin nada es fallo', () => {
  const base = { requestId: 'x', archivos: [], pedidos: [], hechos: [], faltan: [], errores: [], texto: 't' };
  assert.equal(resultadoDeLote({ ...base, estado: 'completo' }).estado, 'succeeded');
  const p = resultadoDeLote({ ...base, estado: 'parcial' });
  assert.equal(p.estado, 'succeeded');
  assert.equal(p.recibo?.incompleto, true);
  assert.equal(resultadoMemorizable(p), false);
  assert.equal(resultadoDeLote({ ...base, estado: 'fallido' }).estado, 'failed');
});

test('GET /api/documentos/:id: solo el dueño de la sesión, MIME real, nombre saneado, nosniff y la huella comprobada', async () => {
  const ctx = nuevoContextoTrabajos('turno-documentos-0002');
  const arg = JSON.stringify({ archivos: [{ ...ENTRADA.archivos[1], nombre: 'cotización "final".xlsx' }] });
  const r = await enTurnoConTrabajos(ctx, () => correrDocumento({ dueno: 'marta@ejemplo.com', arg, pedido: 'hazme la cotización en Excel' }));
  assert.equal(r.estado, 'succeeded', r.texto);
  const id = /\/api\/documentos\/(d_[0-9a-f]{24})/.exec(r.texto)![1];

  const app = express();
  montarRutasDocumentos(app, {
    exigirMesa: (_req, _res, next) => next(),
    limitar: () => (_req, _res, next) => next(),
    sesionDe: (req) => (req.headers['x-prueba-sesion'] === undefined ? null : { correo: String(req.headers['x-prueba-sesion']) }),
  });
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((ok) => srv.once('listening', ok));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  try {
    const dueña = await fetch(`${base}/api/documentos/${id}`, { headers: { 'x-prueba-sesion': 'Marta@Ejemplo.com' } });
    assert.equal(dueña.status, 200);
    assert.equal(dueña.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal(dueña.headers.get('content-disposition'), `attachment; filename="cotizacion final.xlsx"; filename*=UTF-8''cotizaci%C3%B3n%20final.xlsx`);
    assert.equal(dueña.headers.get('x-content-type-options'), 'nosniff');
    assert.match(String(dueña.headers.get('cache-control')), /no-store/);
    const cuerpo = Buffer.from(await dueña.arrayBuffer());
    assert.equal(crypto.createHash('sha256').update(cuerpo).digest('hex'), dueña.headers.get('x-documento-sha256'));
    assert.equal(cuerpo.subarray(0, 2).toString(), 'PK');

    const otra = await fetch(`${base}/api/documentos/${id}`, { headers: { 'x-prueba-sesion': 'ana@ejemplo.com' } });
    assert.equal(otra.status, 404, 'cero archivos de otro dueño');
    const sinSesion = await fetch(`${base}/api/documentos/${id}`);
    assert.equal(sinSesion.status, 401);
    const sinCorreo = await fetch(`${base}/api/documentos/${id}`, { headers: { 'x-prueba-sesion': 'sin-correo' } });
    assert.equal(sinCorreo.status, 403);
    const inventado = await fetch(`${base}/api/documentos/d_${'0'.repeat(24)}`, { headers: { 'x-prueba-sesion': 'marta@ejemplo.com' } });
    assert.equal(inventado.status, 404);
    const raro = await fetch(`${base}/api/documentos/..%2F..%2Fpackage.json`, { headers: { 'x-prueba-sesion': 'marta@ejemplo.com' } });
    assert.equal(raro.status, 404);
  } finally {
    await new Promise((ok) => srv.close(ok));
  }
});
