/**
 * EL TOPE DE VOZ, de punta a punta con el servidor de verdad (server.ts) y un Bedrock falso (tests/servidor-falso.ts):
 * un turno HABLADO cuya respuesta pasa del tope a mitad de una frase larga con comas. Antes (APK 5.5.0, 6-oct 17:11
 * «[voz] tope: dijo 295 de 326») la voz callaba en la coma; ahora termina esa frase y calla en su punto. El texto
 * entero sigue en el `done` (para leerlo en pantalla). Lo puro: tests/voz-tope-frase.test.ts.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { abrirTurno, esperarQue, levantarServidor, type RespuestaFalsa } from './servidor-falso';

const A = 'Revisé lo del envío y encontré tres novedades de hoy, todas sobre el molino de la planta de Choluteca.';
const B =
  'La primera es de Ana, que confirma la fecha del transporte para el jueves por la mañana temprano, la segunda es de Beto, que pregunta por la factura pendiente del mes pasado, y la tercera es del banco con el estado de cuenta.';
const C = 'Avísame cuál quieres que veamos primero.';

let contestar: (ultimo: string) => RespuestaFalsa = () => ({ texto: `[EMO: neutral] ${A} ${B} ${C}` });
const s = await levantarServidor({ correo: 'jose.tope@ordenglobal.org', env: { AURA_SUSPENSIONES: 'ninguna' }, contestar: (u) => contestar(u) });
after(() => s.cerrar());

const id = (n: string) => `tope-${n}-${Date.now()}`;
/** Lo que suena: los `delta` (y un `replace` lo reemplaza) en el orden en que llegaron. */
function loDicho(eventos: { ev: string; data: any }[]): string {
  let voz = '';
  for (const e of eventos) {
    if (e.ev === 'delta') voz += String(e.data?.voz ?? e.data?.text ?? '');
    else if (e.ev === 'replace') voz = String(e.data?.voz ?? e.data?.text ?? '');
  }
  return voz.replace(/\s+/g, ' ').trim();
}

test('el servidor levanta', () => {
  assert.ok(s.listo, `no levantó: ${s.errores()}`);
});

test('un turno hablado que pasa del tope en una frase con comas: la voz termina la frase, no calla en su coma', { skip: !s.listo }, async () => {
  const t = abrirTurno(s.BASE, s.h, { message: '¿Qué novedades hay del envío del molino?', hablado: true, idioma: 'es', avatar: 'aura', idTurno: id('frase') });
  assert.ok(await esperarQue(() => t.hay('done'), 15_000), `sin done: ${s.errores()}`);
  await t.fin;
  const voz = loDicho(t.eventos);
  assert.ok(voz.length > 0, 'algo sonó');
  assert.doesNotMatch(voz, /[,;:]$/, `la voz no calla en una coma: «…${voz.slice(-60)}»`);
  assert.match(voz, /[.?!…]$/, `la voz calla en un final de frase: «…${voz.slice(-60)}»`);
  assert.ok(voz.includes('estado de cuenta.'), `la frase larga se dice entera: «…${voz.slice(-60)}»`);
  assert.ok(!voz.includes('Avísame cuál'), 'lo que pasa del tope (la frase siguiente) no se dice');
  const done = t.eventos.find((e) => e.ev === 'done')!.data;
  assert.ok(String(done.reply).includes('Avísame cuál quieres'), 'el texto entero sigue en la respuesta, para leerlo');
  assert.match(s.stdout(), /\[voz\] tope: dijo \d+ de \d+ caracteres/);
});

test('una respuesta corta (bajo el tope) sale entera, igual que antes', { skip: !s.listo }, async () => {
  contestar = () => ({ texto: '[EMO: feliz] Todo en orden con el envío, llega el jueves.' });
  const t = abrirTurno(s.BASE, s.h, { message: '¿Cómo va el envío del molino?', hablado: true, idioma: 'es', avatar: 'aura', idTurno: id('corta') });
  assert.ok(await esperarQue(() => t.hay('done'), 15_000));
  await t.fin;
  assert.match(loDicho(t.eventos), /Todo en orden con el envío, llega el jueves\.$/);
});
