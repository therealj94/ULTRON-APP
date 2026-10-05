/**
 * La línea de tiempos de cada turno de la mesa (lib/tiempos-turno.ts; José, 5-oct: «contestó con voz 7479 ms
 * después de la frase»): dónde se van los segundos (preparar, modelo, herramientas, la segunda vuelta de una
 * promesa) sin nada de lo que dijo la persona ni de lo que contestó. Y que server.ts la escriba en cada turno.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lineaTiemposTurno, type MedidaTurno } from '../lib/tiempos-turno';

test('la línea dice preparado, primera ficha, primer texto, modelo, herramientas, re-pregunta y total', () => {
  const m: MedidaTurno = {
    inicio: 1_000,
    preparado: 1_180,
    primeraFicha: 1_900,
    primerTexto: 2_050,
    modeloMs: 1_400,
    harnessMs: 2_600,
    herramientas: [{ nombre: 'web', ms: 900 }, { nombre: 'leer', ms: 700 }],
    repreguntaMs: 1_800,
    correccion: 'repregunta',
    tope: { dicho: 312, total: 1100 },
    hablado: true,
  };
  const l = lineaTiemposTurno('3f2a9c1b-aaaa-bbbb', m, 8_479);
  assert.equal(
    l,
    '[mesa] turno 3f2a9c1b (hablado): preparado 180 ms · primera ficha 900 ms · primer texto 1050 ms · modelo 1400 ms · herramientas web 900 ms, leer 700 ms (harness 2600 ms) · re-pregunta 1800 ms · voz 312/1100 car. · total 7479 ms'
  );
});

test('sin herramientas ni promesa, solo lo que hubo; la corrección local se nota', () => {
  const l = lineaTiemposTurno('abcdef0123', { inicio: 0, preparado: 50, primerTexto: 700, modeloMs: 640, herramientas: [], correccion: 'local' }, 900);
  assert.equal(l, '[mesa] turno abcdef01: preparado 50 ms · primera ficha — · primer texto 700 ms · modelo 640 ms · promesa corregida sin re-pregunta · total 900 ms');
  // El mismo turno pedido por la conversación de voz se distingue de la mesa.
  assert.match(lineaTiemposTurno('abcdef0123', { inicio: 0, herramientas: [], camino: 'llamada', hablado: true }, 5), /^\[llamada\] turno abcdef01 \(hablado\):/);
});

test('nunca lleva texto de la persona: de una herramienta, solo su nombre', () => {
  const l = lineaTiemposTurno('x', { inicio: 0, herramientas: [{ nombre: 'correo leer el de Ana: «te quiero»', ms: 10 }] }, 10);
  assert.ok(!/Ana|quiero|«/.test(l), l);
});

test('server.ts escribe la línea en cada turno de la mesa que termina, con lo medido en el camino', () => {
  const src = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const turno = src.slice(src.indexOf('async function turnoEnVivo('), src.indexOf("app.get('/api/taller'"));
  assert.match(turno, /console\.log\(lineaTiemposTurno\(reg\.id, medida/);
  for (const campo of ['medida.preparado =', 'medida.primerTexto ??=', 'medida.primeraFicha ??=', 'medida.modeloMs', 'medida.harnessMs =', 'medida.repreguntaMs =', 'medida.correccion =']) assert.ok(turno.includes(campo), campo);
});

test('prepararTurno arranca la clasificación y lo de la cuenta YA, a la par de la memoria (no una cosa detrás de otra)', () => {
  const src = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const prep = src.slice(src.indexOf('async function prepararTurno('), src.indexOf('async function respuestaChica('));
  const arranca = prep.indexOf("clasificar(message, 'ultron', { voz })");
  const memoria = prep.indexOf("await aTiempoParaVoz(voz, 'memoria'");
  assert.ok(arranca > 0 && memoria > 0 && arranca < memoria, 'Laya se pide antes de esperar la memoria');
  assert.ok(!/const clas = await clasificar\(/.test(prep), 'y no se vuelve a pedir después');
  assert.match(prep, /const vistaPedida = correoApp \? precargarVista\(correoApp\)/);
  assert.match(prep, /const tareasPedidas = correoApp \? precargarTareas\(correoApp\)/);
});

test('un turno hablado con tope le pide al modelo dos o tres frases (y ofrecer el resto); si pidió algo largo, no', () => {
  const src = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const prep = src.slice(src.indexOf('async function prepararTurno('), src.indexOf('async function respuestaChica('));
  assert.match(prep, /if \(topeDeVoz\(message, !!opciones\.voz\) > 0\)\s*hechos\.push\(/);
  assert.match(prep, /RESPUESTA HABLADA: esto se dice en voz alta\. Dos o tres frases cortas como mucho/);
});
