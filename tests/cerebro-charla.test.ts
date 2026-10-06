/**
 * EL CEREBRO DE LA VOZ: QUIÉN CONTESTA LA CHARLA Y CUÁNTO SE LE ESPERA (lib/cerebro-rapido.ts hablarConManos).
 *
 * Medido el 6-oct con el pedido REAL de un turno hablado (scripts/voz/latencia-voz.ts, 8 frases de charla × 3): GLM-5
 * tardó 4,1 s de mediana a la primera palabra (p75 7,2 s) y Kimi K2.5 1,0 s (p75 1,5 s), con la misma calidad en charla
 * (en ACCIONES GLM-5 sigue siendo el mejor: 13–14/14 contra 9–10/14). Por eso la charla sin pedidos va primero a Kimi y
 * las manos siguen con GLM-5.
 *
 * Y la auditoría (VOZ-06): los intentos en serie con 2,5 s y 3,75 s podían sumar 6,25 s antes del último respaldo. Ahora
 * hay un plazo TOTAL para la primera señal útil, cada intento deja su causa y su primera señal, nada de un intento que no
 * llegó a decir algo útil se le entrega a quien escucha (ni su etiqueta de ánimo: no hay «respuesta nueva» encima de otra),
 * y (desde la cobertura en paralelo del 6-oct, tests/cerebro-cobertura.test.ts) el que pierde la carrera se corta en
 * cuanto otro da su primera señal útil.
 *
 * Contra un Bedrock FALSO (HTTP/2 + event-stream, como el de verdad) en este mismo proceso.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { eventoBedrock } from './servidor-falso';

type Conducta = { demoraMs?: number; texto?: string; soloEtiquetaYCalla?: boolean; callaTrasUtil?: boolean; error?: boolean };
let conductas: Record<string, Conducta> = {};
const pedidos: { modelo: string; en: number }[] = [];
/** Cuántos pedidos siguen abiertos (diagnóstico). */
let abiertos = 0;

const bedrock = http2.createServer((req, res) => {
  req.on('data', () => {});
  req.on('end', async () => {
    const modelo = /\/model\/([^/]+)\/converse-stream/.exec(decodeURIComponent(req.url || ''))?.[1] || '?';
    pedidos.push({ modelo, en: Date.now() });
    abiertos++;
    let cerrado = false;
    res.on('close', () => {
      if (!cerrado) abiertos--;
      cerrado = true;
    });
    const c = conductas[modelo] || { texto: `[EMO: neutral] Soy ${modelo}.` };
    if (c.error) {
      res.writeHead(500, { 'content-type': 'application/json' });
      return res.end('{"message":"falla"}');
    }
    res.writeHead(200, { 'content-type': 'application/vnd.amazon.eventstream' });
    res.write(eventoBedrock('messageStart', { role: 'assistant' }));
    if (c.soloEtiquetaYCalla) {
      res.write(eventoBedrock('contentBlockDelta', { contentBlockIndex: 0, delta: { text: '[EMO: neutral] ' } }));
      return; // y se queda callado
    }
    if (c.demoraMs === -1) return; // no contesta nunca
    if (c.demoraMs) await new Promise((r) => setTimeout(r, c.demoraMs));
    if (res.closed) return;
    res.write(eventoBedrock('contentBlockDelta', { contentBlockIndex: 0, delta: { text: c.texto || 'Hola.' } }));
    if (c.callaTrasUtil) return;
    res.write(eventoBedrock('contentBlockStop', { contentBlockIndex: 0 }));
    res.write(eventoBedrock('messageStop', { stopReason: 'end_turn' }));
    res.end(eventoBedrock('metadata', { usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, metrics: { latencyMs: 1 } }));
    cerrado = true;
    abiertos--;
  });
});

let M: typeof import('../lib/cerebro-rapido');
before(async () => {
  await new Promise<void>((r) => bedrock.listen(0, '127.0.0.1', r));
  process.env.AWS_ENDPOINT_URL_BEDROCK_RUNTIME = `http://127.0.0.1:${(bedrock.address() as AddressInfo).port}`;
  process.env.AWS_ACCESS_KEY_ID = 'AKIAPRUEBA';
  process.env.AWS_SECRET_ACCESS_KEY = 'prueba';
  process.env.AWS_REGION = 'us-west-2';
  M = await import('../lib/cerebro-rapido');
});
after(() => {
  bedrock.close();
});

const MSG = [
  { role: 'system', content: 'Eres AU-RA.' },
  { role: 'user', content: '¿Qué opinas de la lluvia?' },
];

async function correr(ruta?: 'charla' | 'manos') {
  const piezas: any[] = [];
  const t0 = Date.now();
  let error: any = null;
  try {
    for await (const p of M.hablarConManos(MSG, [], undefined, ruta ? { ruta } : {})) piezas.push(p);
  } catch (e) {
    error = e;
  }
  return { piezas, error, ms: Date.now() - t0, texto: piezas.filter((p) => 'texto' in p).map((p) => p.texto).join(''), fin: piezas.find((p) => 'fin' in p)?.fin };
}

function reiniciar(env: Record<string, string | undefined> = {}) {
  conductas = {};
  pedidos.length = 0;
  for (const k of ['CEREBRO_VOZ_CHARLA', 'CEREBRO_VOZ_CHARLA_PRIMERA_MS', 'CEREBRO_VOZ_TOTAL_MS', 'CEREBRO_VOZ_PRIMERA_MS', 'CEREBRO_VOZ_RESPALDO_PRIMERA_MS', 'CEREBRO_VOZ_MODELO', 'CEREBRO_VOZ_RESPALDO']) delete process.env[k];
  Object.assign(process.env, env);
  M.anotarExitoRapido();
  M.reiniciarSaludModelos();
}

describe('cerebro de la voz: la charla va primero al rápido, las manos al que mejor las usa', () => {
  it('por omisión la charla va a Kimi K2.5 y las manos a GLM-5', async () => {
    reiniciar();
    assert.equal(M.MODELO_CHARLA_OMISION, 'moonshotai.kimi-k2.5');
    const charla = await correr('charla');
    assert.equal(charla.error, null);
    assert.equal(pedidos[0].modelo, 'moonshotai.kimi-k2.5');
    assert.deepEqual(charla.piezas[0], { modelo: 'moonshotai.kimi-k2.5' });
    pedidos.length = 0;
    const manos = await correr();
    assert.equal(pedidos[0].modelo, 'zai.glm-5');
    assert.deepEqual(manos.piezas[0], { modelo: 'zai.glm-5' });
  });

  it('si el de charla no da la primera señal a tiempo, se lanza también el principal; contesta él y el de charla se corta', async () => {
    reiniciar({ CEREBRO_VOZ_CHARLA_PRIMERA_MS: '200' });
    conductas['moonshotai.kimi-k2.5'] = { demoraMs: -1 };
    const r = await correr('charla');
    assert.equal(r.error, null);
    assert.deepEqual(pedidos.map((p) => p.modelo), ['moonshotai.kimi-k2.5', 'zai.glm-5']);
    assert.deepEqual(r.piezas[0], { modelo: 'zai.glm-5' });
    // Cobertura en paralelo (6-oct): el segundo sale a la espera del primero, sin cancelarlo; al ganar, el primero se corta.
    assert.ok(pedidos[1].en - pedidos[0].en >= 190, 'el segundo sale cuando el primero agotó su espera, no antes');
    for (let i = 0; i < 50 && abiertos > 0; i++) await new Promise((ok) => setTimeout(ok, 10));
    assert.equal(abiertos, 0, 'el que perdió no queda abierto (ni generando ni cobrándose)');
    assert.equal(r.fin.intentos.length, 2);
    assert.match(r.fin.intentos[0].causa, /primera señal/);
    assert.ok(Number.isFinite(r.fin.intentos[1].primeraMs), 'el que contestó deja cuándo dio su primera señal útil');
  });

  it('CEREBRO_VOZ_CHARLA=no: la charla va como todo (GLM-5 primero)', async () => {
    reiniciar({ CEREBRO_VOZ_CHARLA: 'no' });
    await correr('charla');
    assert.equal(pedidos[0].modelo, 'zai.glm-5');
  });
});

describe('cerebro de la voz: plazo total y nada de respuestas encimadas (VOZ-06)', () => {
  it('ninguno contesta: se rinde al plazo TOTAL (no 2,5 + 3,75 s), con la causa de cada intento', async () => {
    reiniciar({ CEREBRO_VOZ_PRIMERA_MS: '400', CEREBRO_VOZ_TOTAL_MS: '600' });
    conductas['zai.glm-5'] = { demoraMs: -1 };
    conductas['moonshotai.kimi-k2.5'] = { demoraMs: -1 };
    const r = await correr();
    assert.ok(r.error, 'lanza: quien llama sigue con el Qwen del nodo');
    assert.ok(r.ms < 900, `se rindió a los ${r.ms} ms (plazo total 600)`);
    assert.equal(r.error.intentos.length, 2);
    for (const i of r.error.intentos) assert.match(i.causa, /primera señal|plazo/);
  });

  it('un intento que solo alcanzó a poner su etiqueta de ánimo no le entrega nada a quien escucha', async () => {
    reiniciar({ CEREBRO_VOZ_PRIMERA_MS: '200' });
    conductas['zai.glm-5'] = { soloEtiquetaYCalla: true };
    conductas['moonshotai.kimi-k2.5'] = { texto: '[EMO: feliz] Me encanta.' };
    const r = await correr();
    assert.equal(r.error, null);
    assert.deepEqual(r.piezas[0], { modelo: 'moonshotai.kimi-k2.5' }, 'el primero que se entrega es el que contestó');
    assert.equal(r.texto, '[EMO: feliz] Me encanta.', 'sin la etiqueta del que se calló delante');
  });

  it('ya dijo algo útil y se cortó: no se vuelve a empezar con otro (se oiría dos veces)', async () => {
    reiniciar({ CEREBRO_VOZ_PRIMERA_MS: '300' });
    conductas['zai.glm-5'] = { texto: '[EMO: neutral] Mira, la lluvia', callaTrasUtil: true };
    process.env.CEREBRO_VOZ_INACTIVIDAD_MS = '300';
    const r = await correr();
    delete process.env.CEREBRO_VOZ_INACTIVIDAD_MS;
    assert.ok(r.error);
    assert.deepEqual(pedidos.map((p) => p.modelo), ['zai.glm-5']);
    assert.equal(r.texto, '[EMO: neutral] Mira, la lluvia');
  });

  it('el que falla al instante deja su causa y el siguiente contesta', async () => {
    reiniciar();
    conductas['zai.glm-5'] = { error: true };
    const r = await correr();
    assert.equal(r.error, null);
    assert.equal(r.fin.intentos[0].modelo, 'zai.glm-5');
    assert.match(r.fin.intentos[0].causa, /error/);
    assert.equal(r.fin.intentos[1].modelo, 'moonshotai.kimi-k2.5');
  });
});

/*
 * Qué va por la ruta de charla (esCharlaParaRuta). Medido el 6-oct con el servidor de verdad contra Bedrock de verdad:
 * con esSoloConversacion (pensada para un modelo SIN manos) solo 4 de 8 frases de charla iban por ahí («hoy», «oro» o
 * «inglés» las mandaban a GLM-5, que tardaba 2,5 s en no contestar y luego Kimi: 3,6 s). El de charla tiene las mismas
 * herramientas: puede buscar o leer si hace falta. Lo que NO le toca es HACER algo (mandar, llamar, recordar, pagar,
 * abrir, ajustar la app), un «sí»/«dale» que confirma, lo privado (correo, WhatsApp, agenda) o lo que pide ir a fondo.
 */
describe('cerebro de la voz: qué es charla para la ruta rápida', () => {
  it('la charla de verdad, aunque nombre el oro, hoy o el inglés', () => {
    for (const t of [
      'Buenas, ¿cómo va todo por allá?',
      '¿Qué opinas de que llueva tanto esta semana?',
      'Fíjate que hoy me levanté cansado, dormí mal.',
      '¿Tú crees que vale la pena aprender inglés a mi edad?',
      'Cuéntame algo interesante del oro.',
      '¿Y por qué el oro no se oxida?',
      'Ja, qué bueno. ¿Y tú qué harías un domingo libre?',
      'Dame un consejo para no estresarme tanto.',
      '¿Cuánto vale el oro hoy?',
      'Cuéntame un chiste.',
    ])
      assert.equal(M.esCharlaParaRuta(t), true, t);
  });

  it('hacer algo, confirmar, lo privado o lo que pide ir a fondo: no (va primero el de las manos)', () => {
    for (const t of [
      'Llámame en diez minutos.',
      'Mándale un WhatsApp a Beto que ya voy.',
      'Escríbele a Ana que llego tarde.',
      'Recuérdame comprar leche.',
      'Ponme música.',
      'Abre mis correos.',
      '¿Qué dice el último correo de Ana?',
      'Sí, mándalo.',
      'Dale.',
      'Págale cien lempiras a Beto.',
      '¿Cuánto tengo de saldo?',
      'Ponlo en modo oscuro.',
      'Analiza a fondo los riesgos de la mina.',
      'Explícame paso a paso cómo se forma el oro.',
      '',
    ])
      assert.equal(M.esCharlaParaRuta(t), false, t);
  });
});
