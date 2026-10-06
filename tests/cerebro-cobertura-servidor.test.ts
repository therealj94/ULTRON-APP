/**
 * LA COBERTURA EN PARALELO EN EL TURNO DE VERDAD (server.ts + lib/cerebro-rapido.ts) contra un Bedrock FALSO:
 *   · si ningún modelo de Bedrock da su primera señal, el turno HABLADO dice primero una frase de espera honesta y después
 *     contesta el Qwen del nodo (antes: silencio de 8–17 s tras el «déjame ver» del teléfono); la frase no entra en la
 *     respuesta guardada; escrito, no hay frase;
 *   · con los dos modelos en vuelo y los dos pidiendo la misma herramienta con efectos (llamarle), al teléfono le llega UNA
 *     sola acción: la del que contestó primero.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { abrirTurno, esperarQue, levantarServidor, type RespuestaFalsa } from './servidor-falso';

let contestar: (ultimo: string, modelo: string) => RespuestaFalsa = () => ({ texto: '[EMO: neutral] Hola.' });
const s = await levantarServidor({
  correo: 'jose.cobertura@ordenglobal.org',
  env: { CEREBRO_VOZ_PRIMERA_MS: '200', CEREBRO_VOZ_CHARLA_PRIMERA_MS: '200', CEREBRO_VOZ_TOTAL_MS: '900' },
  contestar: (u, m) => contestar(u, m),
});
after(() => s.cerrar());
const id = (n: string) => `cob-${n}-${Date.now()}`;
const textoDe = (t: ReturnType<typeof abrirTurno>) => t.eventos.filter((e) => e.ev === 'delta').map((e) => String(e.data.voz ?? e.data.text ?? '')).join('');

test('el servidor levanta', () => {
  assert.ok(s.listo, `no levantó: ${s.errores()}`);
});

test('ningún modelo de Bedrock da señal: en voz, primero la frase de espera honesta y después el Qwen del nodo', { skip: !s.listo }, async () => {
  contestar = () => ({ texto: '[EMO: neutral] Demasiado tarde.', demoraMs: 6_000 });
  const nodoAntes = s.alNodo();
  const t = abrirTurno(s.BASE, s.h, { message: '¿Qué opinas de la lluvia de esta semana?', hablado: true, idioma: 'es', avatar: 'aura', idTurno: id('lento') });
  await t.fin;
  const deltas = t.eventos.filter((e) => e.ev === 'delta');
  assert.ok(deltas.length >= 2, JSON.stringify(t.eventos.map((e) => e.ev)));
  assert.match(String(deltas[0].data.voz), /dame unos segundos/i, 'lo primero que oye es que va a tardar');
  // Charla: Kimi a los 0, GLM a los 200 y otra vez Kimi a los 400; se rinde al plazo total (900 ms).
  assert.ok(deltas[0].en >= 850, `la frase sale cuando Bedrock ya no contestó (${deltas[0].en} ms)`);
  assert.match(textoDe(t), /Hola desde el nodo\./, 'después contesta el Qwen del nodo');
  assert.equal(s.alNodo(), nodoAntes + 1);
  const done = t.eventos.find((e) => e.ev === 'done')?.data;
  assert.ok(done, 'termina');
  assert.doesNotMatch(String(done.reply), /dame unos segundos/i, 'la frase no entra en la respuesta (ni en su memoria)');
  assert.ok(await esperarQue(() => /frase de espera \d+ ms/.test(s.stdout())), 'la línea del turno lo dice');
});

test('escrito (no hablado): sin frase de espera, contesta el nodo como siempre', { skip: !s.listo }, async () => {
  contestar = () => ({ texto: '[EMO: neutral] Demasiado tarde.', demoraMs: 6_000 });
  const t = abrirTurno(s.BASE, s.h, { message: '¿Qué opinas de la lluvia en la tarde?', idioma: 'es', avatar: 'aura', idTurno: id('escrito') });
  await t.fin;
  assert.doesNotMatch(textoDe(t), /dame unos segundos/i);
  assert.match(textoDe(t), /Hola desde el nodo\./);
});

test('los dos modelos en vuelo piden la misma herramienta con efectos: al teléfono le llega UNA sola acción', { skip: !s.listo }, async () => {
  const llamar = { nombre: 'llamarme', input: { en_segundos: 600, motivo: 'lo del banco' } };
  // GLM (primero en las manos) tarda 380 ms, más que su espera (200); Kimi, lanzado a los 200, tardaría 400 más. En serie
  // GLM se cortaba a los 200 y llamaba Kimi; en paralelo gana GLM a los 380 y Kimi, ya en vuelo con la MISMA herramienta, se corta.
  contestar = (_u, modelo) => (modelo === 'zai.glm-5' ? { texto: '[EMO: neutral] Va.', herramienta: llamar, demoraMs: 380 } : { texto: '[EMO: neutral] Va.', herramienta: llamar, demoraMs: 400 });
  const pedidosAntes = s.pedidos.length;
  const accionesAntes = s.acciones.length;
  const t = abrirTurno(s.BASE, s.h, { message: 'Llámame en diez minutos.', hablado: true, idioma: 'es', avatar: 'aura', idTurno: id('herr') });
  await t.fin;
  await new Promise((r) => setTimeout(r, 1_000)); // lo que el perdedor habría pedido ya habría llegado
  const nuevos = s.pedidos.slice(pedidosAntes).map((p) => p.modelo);
  assert.deepEqual(nuevos.slice(0, 2), ['zai.glm-5', 'moonshotai.kimi-k2.5'], `los dos en vuelo: ${nuevos}`);
  const done = t.eventos.find((e) => e.ev === 'done')?.data;
  assert.equal(done?.modelo, 'zai.glm-5', JSON.stringify(done));
  const llamadas = s.acciones.slice(accionesAntes).filter((b) => /recordatorio|llamame/.test(b));
  assert.equal(llamadas.length, 1, `acciones al teléfono: ${JSON.stringify(s.acciones.slice(accionesAntes))}`);
  assert.equal((done?.acciones || []).filter((a: any) => a.accion?.tipo === 'recordatorio' || a.accion?.tipo === 'llamame').length, 1, JSON.stringify(done?.acciones));
});
