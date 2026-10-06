/**
 * LA COBERTURA EN PARALELO DEL CEREBRO DE LA VOZ (lib/cerebro-rapido.ts hablarConManos y planDeModelos).
 *
 * Producción, 6-oct (José: respuestas de voz de 9–38 s): `zai.glm-5 sin primera señal útil en 2500 ms →
 * moonshotai.kimi-k2.5 sin primera señal útil en 3498 ms` y el turno al Qwen del nodo (primera ficha 16,5 s), en la mitad
 * de los turnos con manos. Medido ese día con el pedido real: ni GLM-5 ni Kimi razonan en Bedrock por omisión; lo lento es
 * la cola del proveedor antes de las cabeceras, distinta en cada pedido. Aquí, con proveedores FALSOS de tiempos guionados
 * (el SDK de Bedrock con `send` cambiado; nada sale de la máquina):
 *   · la cascada NO suma esperas: el primero sigue vivo cuando se lanza el siguiente y gana el que contesta antes;
 *   · el orden se adapta: tres turnos seguidos sin señal a tiempo y ese modelo va detrás (y vuelve);
 *   · el razonamiento cuenta como vivo, nunca como útil ni como algo que se dice;
 *   · al perdedor se le corta el stream al instante y NADA suyo (ni texto ni herramientas) llega a quien llama: una
 *     herramienta con efectos la pide un solo modelo, aunque los dos la pidan en el mismo instante.
 * Más una vuelta por el SDK de verdad contra un Bedrock HTTP/2 falso: el stream del perdedor se cierra en el servidor.
 */
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { eventoBedrock } from './servidor-falso';

let M: typeof import('../lib/cerebro-rapido');

/** Un evento del guion: a los `en` ms desde que se lanzó ese pedido. */
type Paso = { en: number; ev: Record<string, unknown> };
type Registro = { modelo: string; lanzado: number; cortado?: number; trasCorte: number; entregados: number };
const ENV = ['CEREBRO_VOZ_PRIMERA_MS', 'CEREBRO_VOZ_RESPALDO_PRIMERA_MS', 'CEREBRO_VOZ_TOTAL_MS', 'CEREBRO_VOZ_CHARLA', 'CEREBRO_VOZ_CHARLA_PRIMERA_MS', 'CEREBRO_VOZ_LANZAMIENTOS', 'CEREBRO_VOZ_INACTIVIDAD_MS', 'CEREBRO_VOZ_EXTRA', 'CEREBRO_VOZ_MODELO', 'CEREBRO_VOZ_RESPALDO'];
const original = BedrockRuntimeClient.prototype.send;
let registros: Registro[] = [];
let t0 = 0;

/** El proveedor falso: cada modelo con su guion (por número de pedido de ese modelo, si es una lista de guiones). */
function proveedor(guiones: Record<string, Paso[] | Paso[][]>) {
  const vistos: Record<string, number> = {};
  (BedrockRuntimeClient.prototype as any).send = async function (cmd: any, o: { abortSignal?: AbortSignal } = {}) {
    const modelo = String(cmd.input.modelId);
    const g = guiones[modelo] ?? [];
    const n = (vistos[modelo] = (vistos[modelo] ?? -1) + 1);
    const guion: Paso[] = Array.isArray(g[0]) ? ((g as Paso[][])[Math.min(n, g.length - 1)] ?? []) : (g as Paso[]);
    const reg: Registro = { modelo, lanzado: Date.now() - t0, trasCorte: 0, entregados: 0 };
    registros.push(reg);
    const desde = Date.now();
    const senal = o.abortSignal;
    senal?.addEventListener('abort', () => (reg.cortado = Date.now() - t0), { once: true });
    const dormir = (ms: number) =>
      new Promise<void>((ok, no) => {
        if (senal?.aborted) return no(Object.assign(new Error('Request aborted'), { name: 'AbortError' }));
        const t = setTimeout(ok, Math.max(0, ms));
        senal?.addEventListener('abort', () => (clearTimeout(t), no(Object.assign(new Error('Request aborted'), { name: 'AbortError' }))), { once: true });
      });
    return {
      stream: (async function* () {
        for (const p of guion) {
          await dormir(desde + p.en - Date.now());
          if (senal?.aborted) reg.trasCorte++;
          reg.entregados++;
          yield p.ev;
        }
        // Sin messageStop en el guion: el pedido se queda abierto hasta que lo corten.
        if (!guion.some((p) => 'messageStop' in p.ev)) await dormir(60_000);
      })(),
    };
  };
}
const texto = (en: number, t: string): Paso => ({ en, ev: { contentBlockDelta: { delta: { text: t } } } });
const razon = (en: number, t: string): Paso => ({ en, ev: { contentBlockDelta: { delta: { reasoningContent: { text: t } } } } });
const fin = (en: number, motivo = 'end_turn'): Paso => ({ en, ev: { messageStop: { stopReason: motivo } } });
const herramienta = (en: number, nombre: string, input: Record<string, unknown>): Paso[] => [
  { en, ev: { contentBlockStart: { start: { toolUse: { name: nombre, toolUseId: `t-${en}` } } } } },
  { en, ev: { contentBlockDelta: { delta: { toolUse: { input: JSON.stringify(input) } } } } },
  { en, ev: { contentBlockStop: {} } },
];
const respuesta = (en: number, t: string): Paso[] => [texto(en, t), { en, ev: { contentBlockStop: {} } }, fin(en)];

async function correr(o: { ruta?: 'charla' | 'manos'; senal?: AbortSignal } = {}) {
  const piezas: any[] = [];
  t0 = Date.now();
  let error: any = null;
  try {
    for await (const p of M.hablarConManos([{ role: 'user', content: 'hola' }], [], o.senal, o.ruta ? { ruta: o.ruta } : {})) piezas.push({ ...p, en: Date.now() - t0 });
  } catch (e) {
    error = e;
  }
  return {
    piezas,
    error,
    ms: Date.now() - t0,
    quien: piezas.find((p) => 'modelo' in p)?.modelo,
    texto: piezas.filter((p) => 'texto' in p).map((p) => p.texto).join(''),
    herramientas: piezas.filter((p) => 'herramienta' in p).map((p) => p.herramienta),
    fin: piezas.find((p) => 'fin' in p)?.fin,
  };
}
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  process.env.AWS_ACCESS_KEY_ID = 'AKIAPRUEBA';
  process.env.AWS_SECRET_ACCESS_KEY = 'prueba';
  process.env.AWS_REGION = 'us-west-2';
  M = await import('../lib/cerebro-rapido');
});
beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  registros = [];
  // (con ?.: contra el código de antes, que no tenía salud, las pruebas fallan por lo que hacen y no por esto)
  (M as any).reiniciarSaludModelos?.();
  M.anotarExitoRapido();
});
afterEach(() => {
  (BedrockRuntimeClient.prototype as any).send = original;
});

describe('cobertura en paralelo: la cascada no suma esperas', () => {
  it('el principal que tarda más que su espera sigue vivo y gana si contesta antes que el de respaldo', async () => {
    process.env.CEREBRO_VOZ_PRIMERA_MS = '200';
    // GLM a los 450 ms; Kimi (lanzado a los 200) tardaría 600 ms más: en serie, 200 + 600 = 800 ms y contestaba Kimi.
    proveedor({ 'zai.glm-5': respuesta(450, '[EMO: neutral] Hola, aquí GLM.'), 'moonshotai.kimi-k2.5': respuesta(600, '[EMO: neutral] Hola, aquí Kimi.') });
    const r = await correr();
    assert.equal(r.error, null);
    assert.equal(r.quien, 'zai.glm-5', 'contestó el que llegó antes');
    assert.ok(r.ms < 650, `primera señal a los ${r.ms} ms (en serie habrían sido ~800)`);
    const kimi = registros.find((x) => x.modelo === 'moonshotai.kimi-k2.5')!;
    const glm = registros.find((x) => x.modelo === 'zai.glm-5')!;
    assert.ok(kimi.lanzado >= 180 && kimi.lanzado < 300, `el de respaldo se lanzó a los ${kimi.lanzado} ms, sin cancelar al principal`);
    assert.equal(glm.cortado, undefined, 'al principal no se le cortó al pasar su espera');
    assert.ok(kimi.cortado !== undefined && kimi.cortado < 520, 'al perdedor se le corta en cuanto gana el otro');
    assert.equal(r.texto, '[EMO: neutral] Hola, aquí GLM.');
  });

  it('ninguno en su espera: en serie se rendía (y caía al Qwen del nodo); en paralelo contesta el principal al llegar', async () => {
    process.env.CEREBRO_VOZ_PRIMERA_MS = '200';
    process.env.CEREBRO_VOZ_TOTAL_MS = '1000';
    proveedor({ 'zai.glm-5': respuesta(700, 'Ya estoy.'), 'moonshotai.kimi-k2.5': [] });
    const r = await correr();
    assert.equal(r.error, null, 'en serie: GLM cortado a los 200, Kimi a los 500 y error');
    assert.equal(r.quien, 'zai.glm-5');
    assert.ok(r.ms >= 680 && r.ms < 900, `contestó a los ${r.ms} ms`);
    assert.equal(r.fin.intentos.length, 3, 'GLM, Kimi y otra vez GLM (un pedido nuevo)');
    assert.match(r.fin.intentos[1].causa, /contestó antes zai\.glm-5; cancelado/);
  });

  it('el que contesta primero es el de respaldo: habla él y el principal se corta', async () => {
    process.env.CEREBRO_VOZ_PRIMERA_MS = '150';
    proveedor({ 'zai.glm-5': respuesta(2000, 'Tarde.'), 'moonshotai.kimi-k2.5': respuesta(100, '[EMO: feliz] Aquí estoy.') });
    const r = await correr();
    assert.equal(r.quien, 'moonshotai.kimi-k2.5');
    assert.ok(r.ms < 400, `${r.ms} ms`);
    const glm = registros.find((x) => x.modelo === 'zai.glm-5')!;
    assert.ok(glm.cortado !== undefined && glm.cortado < 400, 'el principal se cortó al ganar el de respaldo');
    assert.equal(glm.entregados, 0);
    assert.equal(r.fin.intentos[1].desdeMs >= 140, true, 'el log dice desde cuándo se lanzó');
  });

  it('nadie da señal: se rinde al plazo total con todos cortados (el turno sigue con el Qwen del nodo)', async () => {
    process.env.CEREBRO_VOZ_PRIMERA_MS = '100';
    process.env.CEREBRO_VOZ_TOTAL_MS = '500';
    proveedor({ 'zai.glm-5': [], 'moonshotai.kimi-k2.5': [] });
    const r = await correr();
    assert.ok(r.error);
    assert.ok(r.ms >= 240 && r.ms < 700, `se rindió a los ${r.ms} ms`);
    for (const x of registros) assert.ok(x.cortado !== undefined, `${x.modelo} quedó cortado`);
    for (const i of r.error.intentos) assert.match(i.causa, /primera señal|plazo/);
  });
});

describe('cobertura en paralelo: el perdedor se cancela y nada suyo llega (herramientas una sola vez)', () => {
  it('los dos piden la MISMA herramienta con efectos: llega una sola vez, la del ganador', async () => {
    process.env.CEREBRO_VOZ_PRIMERA_MS = '150';
    const llamar = { en_segundos: 30 };
    proveedor({
      'zai.glm-5': [texto(350, '[EMO: neutral] '), ...herramienta(350, 'llamarme', llamar), fin(360, 'tool_use')],
      'moonshotai.kimi-k2.5': [texto(100, '[EMO: neutral] '), ...herramienta(100, 'llamarme', llamar), fin(110, 'tool_use')],
    });
    const r = await correr();
    await espera(400); // lo que el perdedor habría dicho después ya pasó
    assert.equal(r.error, null);
    assert.equal(r.herramientas.length, 1, `herramientas entregadas: ${JSON.stringify(r.herramientas)}`);
    assert.equal(r.quien, 'moonshotai.kimi-k2.5');
    const glm = registros.find((x) => x.modelo === 'zai.glm-5')!;
    const kimi = registros.find((x) => x.modelo === 'moonshotai.kimi-k2.5')!;
    assert.ok(glm.cortado !== undefined && glm.cortado - kimi.lanzado >= 60, `los dos estuvieron en vuelo a la vez (GLM cortado a los ${glm.cortado} ms, Kimi lanzado a los ${kimi.lanzado})`);
    assert.ok(glm.cortado < 330, 'el perdedor se cortó ANTES de pedir su herramienta');
    assert.equal(glm.entregados, 0, 'el perdedor no alcanzó a mandar nada');
    assert.equal(glm.trasCorte, 0);
  });

  it('los dos piden la herramienta en el MISMO instante: gana uno solo y la del otro no llega nunca', async () => {
    process.env.CEREBRO_VOZ_PRIMERA_MS = '100';
    // GLM a los 300 ms; Kimi, lanzado a los 100, a los 200 de su lanzamiento: el mismo instante.
    proveedor({
      'zai.glm-5': [...herramienta(300, 'whatsapp', { accion: 'responder', chat: 'Beto', texto: 'Ya voy' }), fin(300, 'tool_use')],
      'moonshotai.kimi-k2.5': [...herramienta(200, 'whatsapp', { accion: 'responder', chat: 'Beto', texto: 'Ya voy' }), fin(200, 'tool_use')],
    });
    for (let i = 0; i < 5; i++) {
      registros = [];
      const r = await correr();
      await espera(50);
      assert.equal(r.error, null);
      assert.equal(r.herramientas.length, 1, `vuelta ${i}: ${JSON.stringify(r.piezas)}`);
      assert.equal(r.piezas.filter((p) => 'modelo' in p).length, 1, 'un solo «quién contesta»');
      const perdedor = registros.find((x) => x.modelo !== r.quien)!;
      assert.ok(perdedor.cortado !== undefined, 'el otro quedó cortado');
    }
  });

  it('una herramienta a medio escribir no gana: si el modelo se calla a media herramienta, contesta la cobertura', async () => {
    process.env.CEREBRO_VOZ_PRIMERA_MS = '100';
    // Medido el 6-oct: GLM-5 empieza una herramienta y se queda callado 8–20 s a media escritura.
    proveedor({
      'zai.glm-5': [{ en: 30, ev: { contentBlockStart: { start: { toolUse: { name: 'buscar_web', toolUseId: 't1' } } } } }, { en: 40, ev: { contentBlockDelta: { delta: { toolUse: { input: '{"consulta": "oro' } } } } }],
      'moonshotai.kimi-k2.5': [...herramienta(80, 'buscar_web', { consulta: 'precio del oro hoy' }), fin(90, 'tool_use')],
    });
    const r = await correr();
    assert.equal(r.error, null, String(r.error?.message));
    assert.equal(r.quien, 'moonshotai.kimi-k2.5');
    assert.deepEqual(r.herramientas, [{ nombre: 'buscar_web', input: { consulta: 'precio del oro hoy' } }]);
    assert.ok(r.ms < 400, `${r.ms} ms`);
    assert.ok(registros.find((x) => x.modelo === 'zai.glm-5')!.cortado !== undefined, 'el que se quedó a media herramienta se cortó');
  });

  it('el perdedor dijo su etiqueta y media frase antes de perder: no se entrega nada de eso', async () => {
    process.env.CEREBRO_VOZ_PRIMERA_MS = '100';
    proveedor({ 'zai.glm-5': [texto(50, '[EMO: triste] '), texto(400, 'Lo siento')], 'moonshotai.kimi-k2.5': respuesta(100, '[EMO: feliz] ¡Claro!') });
    const r = await correr();
    assert.equal(r.texto, '[EMO: feliz] ¡Claro!', 'ni la etiqueta del perdedor delante');
  });

  it('por el SDK de verdad: el stream HTTP/2 del perdedor se cierra en el servidor en cuanto gana el otro', async () => {
    const cerrados: Record<string, number> = {};
    const abiertos: Record<string, number> = {};
    const srv = http2.createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', async () => {
        const modelo = /\/model\/([^/]+)\/converse-stream/.exec(decodeURIComponent(req.url || ''))?.[1] || '?';
        abiertos[modelo] = Date.now() - t0;
        res.on('close', () => (cerrados[modelo] = Date.now() - t0));
        res.writeHead(200, { 'content-type': 'application/vnd.amazon.eventstream' });
        res.write(eventoBedrock('messageStart', { role: 'assistant' }));
        // GLM no dice nada nunca (la cola del proveedor); Kimi contesta 150 ms después de que lo lanzan.
        if (modelo === 'zai.glm-5') return;
        await espera(150);
        res.write(eventoBedrock('contentBlockDelta', { contentBlockIndex: 0, delta: { text: '[EMO: neutral] Hola.' } }));
        res.write(eventoBedrock('contentBlockStop', { contentBlockIndex: 0 }));
        res.write(eventoBedrock('messageStop', { stopReason: 'end_turn' }));
        res.end(eventoBedrock('metadata', { usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, metrics: { latencyMs: 1 } }));
      });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    process.env.AWS_ENDPOINT_URL_BEDROCK_RUNTIME = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    process.env.CEREBRO_VOZ_PRIMERA_MS = '200';
    process.env.CEREBRO_VOZ_LANZAMIENTOS = '2';
    try {
      const r = await correr();
      assert.equal(r.quien, 'moonshotai.kimi-k2.5');
      for (let i = 0; i < 50 && cerrados['zai.glm-5'] === undefined; i++) await espera(10);
      assert.ok(cerrados['zai.glm-5'] !== undefined, 'el stream del perdedor se cerró (no sigue generando ni cobrándose)');
      const tras = cerrados['zai.glm-5'] - abiertos['moonshotai.kimi-k2.5'];
      assert.ok(tras >= 100 && tras < 300, `GLM siguió abierto mientras Kimi pensaba y se cerró al ganar Kimi: ${tras} ms después de lanzarlo`);
    } finally {
      delete process.env.AWS_ENDPOINT_URL_BEDROCK_RUNTIME;
      srv.close();
    }
  });

  it('la persona interrumpe con dos pedidos en vuelo: se cortan los dos y no sale nada', async () => {
    process.env.CEREBRO_VOZ_PRIMERA_MS = '100';
    proveedor({ 'zai.glm-5': respuesta(800, 'Tarde.'), 'moonshotai.kimi-k2.5': respuesta(800, 'Tarde.') });
    const corte = new AbortController();
    setTimeout(() => corte.abort(), 250);
    const r = await correr({ senal: corte.signal });
    assert.ok(r.error);
    assert.ok(r.ms < 400, `${r.ms} ms`);
    assert.equal(r.piezas.length, 0);
    assert.equal(registros.length >= 2, true);
    for (const x of registros) assert.ok(x.cortado !== undefined, `${x.modelo} cortado`);
    assert.ok(r.error.intentos.every((i: any) => i.causa === 'la persona interrumpió'));
  });
});

describe('cobertura en paralelo: el razonamiento cuenta como vivo, nunca como útil', () => {
  it('un modelo que razona antes de contestar no se da por muerto a su espera: si contesta primero, gana', async () => {
    process.env.CEREBRO_VOZ_PRIMERA_MS = '150';
    proveedor({
      'zai.glm-5': [razon(30, 'El usuario saluda; '), razon(120, 'contesto corto.'), ...respuesta(350, '[EMO: neutral] ¡Hola!')],
      'moonshotai.kimi-k2.5': respuesta(500, 'Hola desde Kimi.'),
    });
    const r = await correr();
    assert.equal(r.quien, 'zai.glm-5', 'en serie se cortaba a los 150 ms aunque estaba pensando');
    assert.equal(r.texto, '[EMO: neutral] ¡Hola!', 'el razonamiento no se dice');
    assert.ok(!r.piezas.some((p) => /usuario saluda/.test(JSON.stringify(p))), 'el razonamiento no sale en ninguna pieza');
    assert.equal(r.fin.intentos[0].razonMs >= 25, true, 'el log dice desde cuándo razonó');
  });

  it('a media respuesta, el razonamiento mantiene vivo al ganador (no lo corta el silencio de texto)', async () => {
    process.env.CEREBRO_VOZ_INACTIVIDAD_MS = '200';
    proveedor({
      'zai.glm-5': [texto(10, '[EMO: neutral] Déjame pensarlo. '), razon(150, 'a'), razon(300, 'b'), razon(450, 'c'), ...respuesta(600, 'Son 391.')],
    });
    const r = await correr();
    assert.equal(r.error, null, `cortado: ${r.error?.message}`);
    assert.equal(r.texto, '[EMO: neutral] Déjame pensarlo. Son 391.');
  });

  it('solo razonamiento y nada que decir: no cuenta como señal útil (el de respaldo contesta)', async () => {
    process.env.CEREBRO_VOZ_PRIMERA_MS = '100';
    process.env.CEREBRO_VOZ_LANZAMIENTOS = '2';
    proveedor({ 'zai.glm-5': [razon(10, 'pienso'), razon(80, 'y pienso')], 'moonshotai.kimi-k2.5': respuesta(50, 'Aquí estoy.') });
    const r = await correr();
    assert.equal(r.quien, 'moonshotai.kimi-k2.5');
  });
});

describe('orden adaptativo según la salud de los últimos minutos', () => {
  it('tres turnos seguidos sin señal a tiempo del principal: el siguiente turno empieza por el de respaldo', async () => {
    process.env.CEREBRO_VOZ_PRIMERA_MS = '100';
    process.env.CEREBRO_VOZ_LANZAMIENTOS = '2';
    proveedor({ 'zai.glm-5': respuesta(400, 'GLM tarde.'), 'moonshotai.kimi-k2.5': respuesta(50, 'Kimi.') });
    for (let i = 0; i < M.FALLOS_PARA_DEGRADAR; i++) {
      assert.equal(M.planDeModelos('manos')[0].modelo, 'zai.glm-5', `turno ${i + 1}: todavía primero`);
      const r = await correr();
      assert.equal(r.quien, 'moonshotai.kimi-k2.5');
    }
    assert.equal(M.modeloDegradado('zai.glm-5'), true);
    const plan = M.planDeModelos('manos');
    assert.deepEqual(
      plan.map((p) => p.modelo),
      ['moonshotai.kimi-k2.5', 'zai.glm-5'],
      'GLM va segundo'
    );
    assert.equal(plan[0].primeraMs, 100, 'la espera es la del puesto: el primero espera lo del primero');
    registros = [];
    const r = await correr();
    assert.equal(registros[0].modelo, 'moonshotai.kimi-k2.5', 'el pedido sale primero al sano');
    assert.equal(registros.length, 1, 'contestó a tiempo: GLM ni se lanzó');
    assert.equal(r.quien, 'moonshotai.kimi-k2.5');
  });

  it('el degradado vuelve a su lugar pasada la ventana, o en cuanto contesta a tiempo', async () => {
    process.env.CEREBRO_VOZ_PRIMERA_MS = '100';
    process.env.CEREBRO_VOZ_LANZAMIENTOS = '2';
    proveedor({ 'zai.glm-5': respuesta(400, 'GLM tarde.'), 'moonshotai.kimi-k2.5': respuesta(50, 'Kimi.') });
    for (let i = 0; i < M.FALLOS_PARA_DEGRADAR; i++) await correr();
    assert.equal(M.planDeModelos('manos')[0].modelo, 'moonshotai.kimi-k2.5');
    assert.equal(M.planDeModelos('manos', Date.now() + M.VENTANA_SALUD_MS + 1)[0].modelo, 'zai.glm-5', 'pasada la ventana, vuelve a probarse primero');
    // Kimi no contesta y GLM (segundo) sí, a tiempo de su puesto: GLM queda sano otra vez.
    proveedor({ 'zai.glm-5': respuesta(30, 'GLM a tiempo.'), 'moonshotai.kimi-k2.5': [] });
    const r = await correr();
    assert.equal(r.quien, 'zai.glm-5');
    assert.equal(M.modeloDegradado('zai.glm-5'), false);
  });

  it('un turno con dos fallos del mismo modelo (el pedido nuevo también) cuenta una sola vez', async () => {
    process.env.CEREBRO_VOZ_PRIMERA_MS = '60';
    process.env.CEREBRO_VOZ_TOTAL_MS = '400';
    proveedor({ 'zai.glm-5': [], 'moonshotai.kimi-k2.5': [] });
    await correr();
    await correr();
    assert.equal(M.modeloDegradado('zai.glm-5'), false, 'dos turnos, aunque fueron cuatro pedidos a GLM');
    await correr();
    assert.equal(M.modeloDegradado('zai.glm-5'), true);
  });

  it('la ruta de charla también se adapta, y CEREBRO_VOZ_EXTRA añade coberturas al final (apagado por omisión)', async () => {
    assert.deepEqual(
      M.planDeModelos('charla').map((p) => p.modelo),
      ['moonshotai.kimi-k2.5', 'zai.glm-5']
    );
    process.env.CEREBRO_VOZ_EXTRA = 'proveedor.modelo-extra';
    assert.deepEqual(
      M.planDeModelos('manos').map((p) => p.modelo),
      ['zai.glm-5', 'moonshotai.kimi-k2.5', 'proveedor.modelo-extra']
    );
    delete process.env.CEREBRO_VOZ_EXTRA;
    process.env.CEREBRO_VOZ_PRIMERA_MS = '60';
    process.env.CEREBRO_VOZ_CHARLA_PRIMERA_MS = '60';
    process.env.CEREBRO_VOZ_LANZAMIENTOS = '2';
    proveedor({ 'zai.glm-5': respuesta(10, 'GLM.'), 'moonshotai.kimi-k2.5': respuesta(300, 'Kimi tarde.') });
    for (let i = 0; i < M.FALLOS_PARA_DEGRADAR; i++) assert.equal((await correr({ ruta: 'charla' })).quien, 'zai.glm-5');
    assert.equal(M.planDeModelos('charla')[0].modelo, 'zai.glm-5', 'Kimi lento tres veces: la charla empieza por GLM');
  });
});

describe('revisión del 6-oct: un fin sin nada útil no gana, y el empate no paga un pedido de más', () => {
  it('una corrida que termina solo con «[EMO: neutral]» no corta a la otra que sí iba a contestar (y cuenta como fallo)', async () => {
    process.env.CEREBRO_VOZ_PRIMERA_MS = '100';
    process.env.CEREBRO_VOZ_LANZAMIENTOS = '2';
    // GLM cierra limpio a los 250 ms sin decir nada (solo la etiqueta); Kimi, lanzado a los 100, contesta a los 400.
    proveedor({ 'zai.glm-5': [texto(240, '[EMO: neutral] '), { en: 245, ev: { contentBlockStop: {} } }, fin(250)], 'moonshotai.kimi-k2.5': respuesta(300, '[EMO: feliz] Claro, son las tres.') });
    for (let i = 0; i < M.FALLOS_PARA_DEGRADAR; i++) {
      const r = await correr();
      assert.equal(r.error, null, String(r.error?.message));
      assert.equal(r.quien, 'moonshotai.kimi-k2.5', `vuelta ${i}: antes ganaba GLM con la etiqueta sola y Kimi se cancelaba`);
      assert.equal(r.texto, '[EMO: feliz] Claro, son las tres.');
      const glm = r.fin.intentos.find((x: any) => x.modelo === 'zai.glm-5');
      assert.match(glm.causa, /sin nada útil/, 'el log dice por qué no cuenta');
      assert.equal(registros.find((x) => x.modelo === 'moonshotai.kimi-k2.5')!.cortado, undefined, 'a Kimi no se le cortó');
      registros = [];
    }
    assert.equal(M.modeloDegradado('zai.glm-5'), true, 'en la salud de su modelo cuenta como fallo');
  });

  it('si es la última viva, lo poco que dijo sale igual (quien llama decide)', async () => {
    process.env.CEREBRO_VOZ_PRIMERA_MS = '500';
    process.env.CEREBRO_VOZ_LANZAMIENTOS = '1';
    proveedor({ 'zai.glm-5': [texto(40, '[EMO: neutral] '), fin(50)] });
    const r = await correr();
    assert.equal(r.error, null);
    assert.equal(r.quien, 'zai.glm-5');
    assert.equal(r.texto, '[EMO: neutral] ');
    assert.equal(r.fin.estado, 'completo');
  });

  it('empate entre la primera señal y el vencimiento de la espera: no se lanza una cobertura que se cancela al instante', async () => {
    process.env.CEREBRO_VOZ_PRIMERA_MS = '150';
    // Un empate de verdad (en la MISMA vuelta del bucle de eventos): el primer trozo de GLM sale del mismo reloj que
    // vence su espera, justo antes de que la cascada despierte. Así, sin depender de que dos relojes caigan en el mismo ms.
    const setTimeoutOriginal = globalThis.setTimeout;
    let liberar: (() => void) | null = null;
    (globalThis as any).setTimeout = (f: (...a: unknown[]) => void, ms?: number, ...a: unknown[]) =>
      setTimeoutOriginal(() => {
        if (liberar && typeof ms === 'number' && ms >= 140 && ms <= 150) {
          const l = liberar;
          liberar = null;
          l();
        }
        f(...a);
      }, ms);
    try {
      for (let i = 0; i < 5; i++) {
        // (la señal cae en el ms 150 o 151 de una espera de 150: que la salud no reordene los modelos entre vueltas)
        M.reiniciarSaludModelos();
        const lanzados: string[] = [];
        (BedrockRuntimeClient.prototype as any).send = async function (cmd: any) {
          const modelo = String(cmd.input.modelId);
          lanzados.push(modelo);
          const primero = modelo === 'zai.glm-5' ? new Promise<void>((r) => (liberar = r)) : Promise.resolve();
          return {
            stream: (async function* () {
              await primero;
              yield { contentBlockDelta: { delta: { text: `Hola, aquí ${modelo}.` } } };
              yield { contentBlockStop: {} };
              yield { messageStop: { stopReason: 'end_turn' } };
            })(),
          };
        };
        const r = await correr();
        assert.equal(r.error, null);
        assert.equal(r.quien, 'zai.glm-5');
        assert.deepEqual(lanzados, ['zai.glm-5'], `vuelta ${i}: se lanzó un pedido de más (cancelado al instante)`);
      }
    } finally {
      globalThis.setTimeout = setTimeoutOriginal;
    }
  });
});

after(() => {
  (BedrockRuntimeClient.prototype as any).send = original;
});
