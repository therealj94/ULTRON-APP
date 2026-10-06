/**
 * EL TURNO ESPECULATIVO, de punta a punta en el servidor de verdad (server.ts + server/turno-especulativo.ts) con un
 * Bedrock falso. Lo que importa: el texto puede adelantarse (el teléfono no lo suena hasta confirmar), pero NADA con
 * efecto ocurre antes del «sí» del teléfono: ni acciones al teléfono, ni herramientas, ni el `done` que las lleva; y un
 * pedido que no es charla no llega ni al modelo hasta confirmar. Si se corta sin confirmar, no ocurre nunca.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { abrirTurno, esperarQue, levantarServidor, type RespuestaFalsa } from './servidor-falso';

let contestar: (ultimo: string) => RespuestaFalsa = () => ({ texto: '[EMO: neutral] Claro, aquí estoy contigo.' });
const s = await levantarServidor({ correo: 'jose.especulativo@ordenglobal.org', contestar: (u) => contestar(u) });
after(() => s.cerrar());

const confirmar = (idTurno: string) => fetch(`${s.BASE}/api/turno/confirmar`, { method: 'POST', headers: s.h, body: JSON.stringify({ idTurno }) }).then((r) => r.json());
const id = (n: string) => `esp-${n}-${Date.now()}`;

test('el servidor levanta', () => {
  assert.ok(s.listo, `no levantó: ${s.errores()}`);
});

test('charla especulativa: el texto llega antes de confirmar; el `done` (y lo que hace) espera el «sí» del teléfono', { skip: !s.listo }, async () => {
  contestar = () => ({ texto: '[EMO: feliz] Me encanta la lluvia, la verdad. Huele a tierra mojada.' });
  const idTurno = id('charla');
  const t = abrirTurno(s.BASE, s.h, { message: '¿Qué opinas de la lluvia de esta semana?', hablado: true, idioma: 'es', avatar: 'aura', idTurno, especulativo: true });
  assert.ok(await esperarQue(() => t.hay('delta')), 'el texto se adelanta');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(t.hay('done'), false, 'sin confirmar, el turno no termina');
  const r = await confirmar(idTurno);
  assert.equal(r.estado, 'confirmado');
  assert.ok(await esperarQue(() => t.hay('done')), 'confirmado, termina');
  await t.fin;
});

test('charla especulativa cuyo modelo pide una herramienta: cortada sin confirmar, la acción no llega nunca al teléfono', { skip: !s.listo }, async () => {
  contestar = () => ({ texto: '[EMO: neutral] Va, te llamo.', herramienta: { nombre: 'llamarme', input: { en_segundos: 600 } } });
  const antes = s.acciones.length;
  const idTurno = id('corta');
  const t = abrirTurno(s.BASE, s.h, { message: '¿Qué opinas de la lluvia en la tarde?', hablado: true, idioma: 'es', avatar: 'aura', idTurno, especulativo: true });
  assert.ok(await esperarQue(() => s.pedidos.length > 0 && t.eventos.length > 0));
  await new Promise((r) => setTimeout(r, 400));
  t.cortar();
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(s.acciones.length, antes, 'ninguna acción salió hacia el teléfono');
  assert.equal(t.hay('done'), false);
  assert.equal((await confirmar(idTurno)).estado, 'no-existe', 'cortado, ya no se puede confirmar');
});

test('la misma, confirmada: la acción sí llega (la retención no se come lo que se pidió de verdad)', { skip: !s.listo }, async () => {
  contestar = () => ({ texto: '[EMO: neutral] Va, te llamo.', herramienta: { nombre: 'llamarme', input: { en_segundos: 600 } } });
  const antes = s.acciones.length;
  const idTurno = id('confirma');
  const t = abrirTurno(s.BASE, s.h, { message: '¿Qué opinas de la lluvia en la noche?', hablado: true, idioma: 'es', avatar: 'aura', idTurno, especulativo: true });
  assert.ok(await esperarQue(() => t.eventos.length > 0));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(s.acciones.length, antes);
  await confirmar(idTurno);
  assert.ok(await esperarQue(() => t.hay('done')));
  const done = t.eventos.find((e) => e.ev === 'done')!.data;
  await esperarQue(() => s.acciones.length > antes, 2_000);
  assert.ok(s.acciones.length > antes || (done.acciones || []).length > 0, `la acción salió al confirmar: ${JSON.stringify(done).slice(0, 300)}`);
  await t.fin;
});

test('un pedido que no es charla («llámame en diez minutos») no llega ni al modelo antes de confirmar; cortado, nunca', { skip: !s.listo }, async () => {
  contestar = () => ({ texto: '[EMO: neutral] Va.', herramienta: { nombre: 'llamarme', input: { en_segundos: 600 } } });
  const antes = s.pedidos.length;
  const accionesAntes = s.acciones.length;
  const t = abrirTurno(s.BASE, s.h, { message: 'Llámame en diez minutos.', hablado: true, idioma: 'es', avatar: 'aura', idTurno: id('orden'), especulativo: true });
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(s.pedidos.length, antes, 'ni siquiera se le preguntó al modelo');
  assert.equal(t.hay('delta'), false);
  t.cortar();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(s.pedidos.length, antes);
  assert.equal(s.acciones.length, accionesAntes);
});

test('sin `especulativo`, el turno de siempre no espera a nadie', { skip: !s.listo }, async () => {
  contestar = () => ({ texto: '[EMO: feliz] Claro que sí.' });
  const t = abrirTurno(s.BASE, s.h, { message: '¿Te gusta la música?', hablado: true, idioma: 'es', avatar: 'aura', idTurno: id('normal') });
  assert.ok(await esperarQue(() => t.hay('done')));
  await t.fin;
});

/* La ruta de charla (lib/cerebro-rapido.ts planDeModelos): la charla hablada va primero al cerebro rápido. */
test('la charla hablada va primero a Kimi; una orden, lo que pide ir a fondo o lo escrito, a GLM-5 (el de las manos)', { skip: !s.listo }, async () => {
  contestar = () => ({ texto: '[EMO: neutral] Claro.' });
  const modeloDe = async (message: string, extra: Record<string, unknown> = {}) => {
    const antes = s.pedidos.length;
    const t = abrirTurno(s.BASE, s.h, { message, idioma: 'es', avatar: 'aura', idTurno: id('ruta'), ...extra });
    await esperarQue(() => t.hay('done'));
    await t.fin;
    return s.pedidos.slice(antes)[0]?.modelo;
  };
  assert.equal(await modeloDe('¿Tú qué harías un domingo libre?', { hablado: true }), 'moonshotai.kimi-k2.5');
  assert.equal(await modeloDe('Llámame en diez minutos.', { hablado: true }), 'zai.glm-5');
  assert.equal(await modeloDe('Explícame paso a paso cómo se forma el oro.', { hablado: true }), 'zai.glm-5');
  assert.equal(await modeloDe('¿Tú qué harías un sábado libre?'), 'zai.glm-5', 'escrito: como siempre');
  const linea = s.stdout().split('\n').filter((l) => /\[mesa\] turno .* \(hablado\)/.test(l) && /\(charla\)/.test(l)).at(-1) || '';
  assert.match(linea, / · por bedrock moonshotai\.kimi-k2\.5 \(charla\) · total \d+ ms$/, 'la línea del turno lo dice');
});
