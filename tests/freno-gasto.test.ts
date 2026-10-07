/**
 * EL FRENO DE GASTO DIARIO (lib/freno-gasto.ts, auditoría del 7-oct, C-2): un tope global por día y por proveedor
 * (caracteres de ElevenLabs TTS, segundos de oído, llamadas a los ojos), configurable por entorno, con una línea clara
 * en el registro al saltar. Con ElevenLabs y los ojos falsos: pasado el tope, NO se les llama.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import express from 'express';
import {
  cobrarPermisoUsado,
  conPagadorGasto,
  estadoGasto,
  gastarCupoDiario,
  MAX_PERMISOS_ANTICIPADOS,
  reservarPermisoAnticipado,
  segundosDeAudio,
  soltarPermisoAnticipado,
  SEGUNDOS_POR_PERMISO_TURBO,
  topeGasto,
  TOPES_GASTO_OMISION,
  VIGENCIA_PERMISO_ANTICIPADO_MS,
  _reiniciarFrenoGasto,
} from '../lib/freno-gasto';
import { abrirEleven, hablarEleven, _reiniciarFrenoEleven } from '../server/eleven';
import { permisoTurbo, transcribirAudio } from '../lib/oido';
import { wavDePrueba } from './voicebox-falso';

const ENV = ['AURA_TOPE_DIA_TTS_CARACTERES', 'AURA_TOPE_DIA_STT_SEGUNDOS', 'AURA_TOPE_DIA_VISION_LLAMADAS', 'ELEVENLABS_API_KEY'] as const;
const antes = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
const fetchReal = globalThis.fetch;
const pedidasEleven: string[] = [];
globalThis.fetch = (async (entrada: any, init?: any) => {
  const url = String(entrada?.url || entrada);
  if (!url.startsWith('https://api.elevenlabs.io/')) return fetchReal(entrada, init);
  pedidasEleven.push(url);
  // El token de un solo uso del oído Turbo (lib/oido.ts permisoTurbo). `__sinTokenTurbo`: ElevenLabs no lo da.
  if (url.includes('/single-use-token/')) {
    if ((globalThis as any).__sinTokenTurbo) return new Response('{"detail":"no"}', { status: 503 });
    return new Response(JSON.stringify({ token: `tok-${pedidasEleven.length}` }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(new Uint8Array(2000), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
}) as typeof fetch;
after(() => {
  globalThis.fetch = fetchReal;
  for (const k of ENV) {
    if (antes[k] === undefined) delete process.env[k];
    else process.env[k] = antes[k];
  }
});

/** Lo que se escribe en console.error mientras corre `fn`. */
async function registro(fn: () => unknown): Promise<string[]> {
  const lineas: string[] = [];
  const real = console.error;
  console.error = (...a: unknown[]) => void lineas.push(a.map(String).join(' '));
  try {
    await fn();
  } finally {
    console.error = real;
  }
  return lineas;
}

test('los topes: generosos por omisión, por entorno si es un número >= 0; lo raro se ignora', () => {
  delete process.env.AURA_TOPE_DIA_TTS_CARACTERES;
  assert.equal(topeGasto('tts'), TOPES_GASTO_OMISION.tts);
  assert.ok(TOPES_GASTO_OMISION.tts >= 500_000 && TOPES_GASTO_OMISION.stt >= 36_000 && TOPES_GASTO_OMISION.vision >= 5_000, 'generosos');
  // Revisión de #157: el del oído, 4 veces el de antes (36 000 s): un día fuerte con Turbo no lo alcanza.
  assert.ok(TOPES_GASTO_OMISION.stt >= 4 * 36_000, `oído: ${TOPES_GASTO_OMISION.stt}`);
  delete process.env.AURA_TOPE_DIA_STT_SEGUNDOS;
  assert.equal(topeGasto('stt'), 144_000);
  process.env.AURA_TOPE_DIA_TTS_CARACTERES = '1200';
  assert.equal(topeGasto('tts'), 1200);
  process.env.AURA_TOPE_DIA_TTS_CARACTERES = 'mucho';
  assert.equal(topeGasto('tts'), TOPES_GASTO_OMISION.tts);
  process.env.AURA_TOPE_DIA_TTS_CARACTERES = '-5';
  assert.equal(topeGasto('tts'), TOPES_GASTO_OMISION.tts);
  process.env.AURA_TOPE_DIA_TTS_CARACTERES = '0';
  assert.equal(topeGasto('tts'), 0, '0 apaga el proveedor');
});

test('se cobra hasta el tope; al pasarse, «no» con UNA línea clara en el registro; al otro día vuelve a cero', async () => {
  _reiniciarFrenoGasto();
  process.env.AURA_TOPE_DIA_VISION_LLAMADAS = '2';
  const dia = Date.parse('2026-10-07T18:00:00Z');
  assert.equal(gastarCupoDiario('vision', 1, dia), true);
  assert.equal(gastarCupoDiario('vision', 1, dia), true);
  const lineas = await registro(() => {
    assert.equal(gastarCupoDiario('vision', 1, dia), false);
    assert.equal(gastarCupoDiario('vision', 1, dia), false);
  });
  assert.equal(lineas.length, 1, 'una vez por día y proveedor');
  assert.match(lineas[0], /\[freno-gasto\] TOPE DIARIO ALCANZADO: los ojos \(visión\) lleva 2 de 2 llamadas hoy \(2026-10-07, Honduras\)/);
  assert.match(lineas[0], /AURA_TOPE_DIA_VISION_LLAMADAS/);
  assert.deepEqual(estadoGasto(dia).vision, { usado: 2, tope: 2, dia: '2026-10-07', exento: 0 });
  // Medianoche de Honduras (UTC−6): otro día, otro cupo.
  assert.equal(gastarCupoDiario('vision', 1, Date.parse('2026-10-08T07:00:00Z')), true);
});

test('ElevenLabs TTS: cuenta los caracteres de cada síntesis (una sola vez por frase) y pasado el tope no se le llama', async () => {
  _reiniciarFrenoGasto();
  _reiniciarFrenoEleven();
  process.env.ELEVENLABS_API_KEY = 'xi-de-prueba';
  process.env.AURA_TOPE_DIA_TTS_CARACTERES = '30';
  pedidasEleven.length = 0;
  const frase = 'Veinte letras justas'; // 20 caracteres
  assert.ok(await hablarEleven({ texto: frase, voz: 'voz-x', tiempos: false }));
  assert.equal(pedidasEleven.length, 1);
  assert.equal(estadoGasto().tts.usado, 20);
  // La segunda pasaría de 30: no sale a ElevenLabs (quien llama sigue con Voicebox).
  const lineas = await registro(async () => {
    assert.equal(await hablarEleven({ texto: frase, voz: 'voz-x' }), null);
    assert.equal(await abrirEleven({ texto: frase, voz: 'voz-x' }), null);
  });
  assert.equal(pedidasEleven.length, 1, 'ElevenLabs no se tocó');
  assert.match(lineas.join('\n'), /ElevenLabs TTS lleva 20 de 30 caracteres/);
});

test('el oído: cuenta los segundos del audio (WAV exacto; lo demás por el peso) y pasado el tope no oye', async () => {
  assert.equal(segundosDeAudio(wavDePrueba(3, 16000)), 3);
  assert.equal(segundosDeAudio(Buffer.alloc(40_000), 'audio/m4a'), 10, '32 kbps');
  _reiniciarFrenoGasto();
  process.env.AURA_TOPE_DIA_STT_SEGUNDOS = '4';
  let oidos = 0;
  const proveedores = [{ nombre: 'falso', listo: () => true, oir: async () => (oidos++, { texto: 'hola', via: 'falso' }) }];
  const wav = wavDePrueba(3, 16000);
  assert.equal((await transcribirAudio({ audio: wav, mime: 'audio/wav', proveedores })).texto, 'hola');
  const r = await transcribirAudio({ audio: wav, mime: 'audio/wav', proveedores });
  assert.equal(r.via, 'tope');
  assert.equal(r.texto, '');
  assert.equal(oidos, 1, 'el proveedor no se llamó la segunda vez');
});

/* ── revisión de #157 (no bloqueante 2): el tope del oído no puede dejar sordo a AU-RA ─────────────────────────── */

test('mando: sin tope de voz ni de oído (se anota aparte, con UNA línea al pasar el tope); los ojos sí tienen tope', async () => {
  _reiniciarFrenoGasto();
  process.env.AURA_TOPE_DIA_STT_SEGUNDOS = '100';
  process.env.AURA_TOPE_DIA_TTS_CARACTERES = '50';
  process.env.AURA_TOPE_DIA_VISION_LLAMADAS = '1';
  const dia = Date.parse('2026-10-07T18:00:00Z');
  const avisos: string[] = [];
  const real = console.warn;
  console.warn = (...a: unknown[]) => void avisos.push(a.map(String).join(' '));
  try {
    conPagadorGasto(
      () => true,
      () => {
        for (let i = 0; i < 5; i++) assert.equal(gastarCupoDiario('stt', 60, dia), true, `oído ${i}: a mando nunca se le dice que no`);
        for (let i = 0; i < 3; i++) assert.equal(gastarCupoDiario('tts', 40, dia), true, `voz ${i}`);
        assert.equal(gastarCupoDiario('vision', 1, dia), true);
      }
    );
  } finally {
    console.warn = real;
  }
  const e = estadoGasto(dia);
  assert.deepEqual([e.stt.exento, e.stt.usado], [300, 0], 'lo de mando se anota aparte y no gasta el cupo de los demás');
  assert.deepEqual([e.tts.exento, e.tts.usado], [120, 0]);
  assert.equal(avisos.filter((l) => /cuenta de mando por encima del tope: el oído/.test(l)).length, 1, 'una línea al día por proveedor');
  assert.equal(avisos.filter((l) => /cuenta de mando por encima del tope: ElevenLabs TTS/.test(l)).length, 1);
  // Los ojos sí: el segundo de mando ya no pasa.
  const lineas = await registro(() => conPagadorGasto(() => true, () => assert.equal(gastarCupoDiario('vision', 1, dia), false)));
  assert.match(lineas.join('\n'), /TOPE DIARIO ALCANZADO: los ojos/);
  // Quien no es de mando sigue con su tope (el cupo del resto está entero).
  assert.equal(conPagadorGasto(() => false, () => gastarCupoDiario('stt', 60, dia)), true);
  assert.equal(conPagadorGasto(() => false, () => gastarCupoDiario('stt', 60, dia)), false, 'pasado el tope, al resto sí se le dice que no');
  // Fuera de una petición (calentar la caché): cuenta como siempre.
  assert.equal(gastarCupoDiario('stt', 60, dia), false);
});

test('mando: el ámbito sigue vivo a través de express (después de leer el cuerpo y de un await en la ruta)', async () => {
  _reiniciarFrenoGasto();
  process.env.AURA_TOPE_DIA_STT_SEGUNDOS = '10';
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => conPagadorGasto(() => req.headers['x-mando'] === '1', next));
  app.post('/gasta', async (req, res) => {
    await new Promise((r) => setTimeout(r, 5));
    await Promise.resolve();
    res.json({ ok: gastarCupoDiario('stt', Number(req.body?.n) || 0) });
  });
  const srv = app.listen(0);
  try {
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/gasta`;
    const pedir = (mando: boolean) =>
      fetchReal(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(mando ? { 'x-mando': '1' } : {}) }, body: JSON.stringify({ n: 60 }) }).then((r) => r.json());
    assert.deepEqual(await pedir(false), { ok: false }, 'sin mando, 60 s no caben en 10');
    assert.deepEqual(await pedir(true), { ok: true }, 'con mando, sí');
    assert.deepEqual(await pedir(true), { ok: true });
    assert.equal(estadoGasto().stt.exento, 120);
  } finally {
    srv.close();
  }
  // Y server.ts abre ese ámbito para cada petición, con quien puede mandar (José), ya leído el cuerpo.
  const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const i = server.indexOf('conPagadorGasto(() => {');
  assert.ok(i > 0, 'el middleware de quién paga');
  assert.ok(i > server.indexOf("return (cuerpoGrandePermitido(req) ? leerJsonGrande : leerJson)(req, res, next);"), 'después de leer el cuerpo');
  assert.ok(i < server.indexOf("app.post('/api/stt/turbo/permiso'"), 'antes de las rutas');
  assert.match(server.slice(i, i + 220), /puedeMandar\(id, 'ultron'\) \|\| puedeMandar\(id, 'electrum'\)/);
});

test('oído Turbo: el permiso adelantado no se cobra hasta usarlo o hasta que vence sin avisar', async () => {
  _reiniciarFrenoGasto();
  process.env.ELEVENLABS_API_KEY = 'xi-de-prueba';
  process.env.AURA_TOPE_DIA_STT_SEGUNDOS = String(10 * SEGUNDOS_POR_PERMISO_TURBO);
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const p = await permisoTurbo('es', undefined, undefined, { anticipado: true, quien: 'jose@x' });
    assert.ok(p?.url.startsWith('wss://') && p.id, `adelantado ${i}`);
    ids.push(p!.id!);
  }
  assert.equal(estadoGasto().stt.usado, 0, 'pedir por adelantado no cobra');
  // El teléfono dice que usó uno: ahí se cobra, una sola vez y solo a su cuenta.
  assert.equal(cobrarPermisoUsado(ids[0], 'otra@x'), false, 'el id de otra cuenta no cobra');
  assert.equal(cobrarPermisoUsado(ids[0], 'jose@x'), true);
  assert.equal(cobrarPermisoUsado(ids[0], 'jose@x'), false, 'una sola vez');
  assert.equal(estadoGasto().stt.usado, SEGUNDOS_POR_PERMISO_TURBO);
  // El pedido para usarlo YA (sin `anticipado`): se cobra al darlo, como siempre.
  assert.ok(await permisoTurbo('es'));
  assert.equal(estadoGasto().stt.usado, 2 * SEGUNDOS_POR_PERMISO_TURBO);
  // Revisión E4: los que vencen sin aviso (20 min) se cobran al vencer, una vez; avisar tarde ya no cobra otra vez.
  assert.equal(cobrarPermisoUsado(ids[1], 'jose@x', Date.now() + 21 * 60_000), false);
  assert.equal(estadoGasto().stt.usado, 4 * SEGUNDOS_POR_PERMISO_TURBO, 'ids[1] e ids[2] vencieron: cobrados');
  // ElevenLabs no da el token: el adelantado se suelta sin cobrar.
  (globalThis as any).__sinTokenTurbo = true;
  try {
    assert.equal(await permisoTurbo('es', undefined, undefined, { anticipado: true, quien: 'ana@x' }), null);
  } finally {
    (globalThis as any).__sinTokenTurbo = false;
  }
  assert.equal(estadoGasto().stt.usado, 4 * SEGUNDOS_POR_PERMISO_TURBO);
});

test('oído Turbo (E4): un adelantado que vence sin aviso se cobra una sola vez, a la cuenta que toca; el suelto no', async () => {
  _reiniciarFrenoGasto();
  process.env.AURA_TOPE_DIA_STT_SEGUNDOS = String(10 * SEGUNDOS_POR_PERMISO_TURBO);
  const t0 = Date.now();
  const vence = t0 + VIGENCIA_PERMISO_ANTICIPADO_MS + 1;
  const a = reservarPermisoAnticipado('mudo@x', t0)!;
  const b = reservarPermisoAnticipado('mudo@x', t0)!;
  const suelto = reservarPermisoAnticipado('mudo@x', t0)!;
  soltarPermisoAnticipado(suelto); // ElevenLabs no lo dio: nunca se cobra.
  assert.equal(estadoGasto(t0).stt.usado, 0, 'antes de vencer, nada');
  assert.equal(estadoGasto(t0 + VIGENCIA_PERMISO_ANTICIPADO_MS - 1).stt.usado, 0, 'al borde, todavía nada');
  // Con solo mirar el estado pasado el plazo, los dos vencidos ya cuentan (sin esperar a otro pedido).
  assert.equal(estadoGasto(vence).stt.usado, 2 * SEGUNDOS_POR_PERMISO_TURBO);
  assert.equal(cobrarPermisoUsado(a, 'mudo@x', vence), false, 'avisar tarde no cobra otra vez');
  assert.equal(cobrarPermisoUsado(b, 'mudo@x', vence + 1000), false);
  assert.equal(reservarPermisoAnticipado('otro@x', vence) !== null, true);
  assert.equal(estadoGasto(vence).stt.usado, 2 * SEGUNDOS_POR_PERMISO_TURBO, 'una sola vez');
  // Uno de mando que vence sin aviso: se anota aparte (exento), no en el tope del resto.
  const m = conPagadorGasto(() => true, () => reservarPermisoAnticipado('jose@x', vence))!;
  assert.ok(m);
  const e = estadoGasto(vence + VIGENCIA_PERMISO_ANTICIPADO_MS + 1).stt;
  assert.equal(e.exento, SEGUNDOS_POR_PERMISO_TURBO);
  assert.equal(e.usado, 3 * SEGUNDOS_POR_PERMISO_TURBO, 'el de otro@x también venció y se cobró');
});

test('oído Turbo: un teléfono que nunca avisa no oye gratis (más de MAX adelantados: el más viejo se cobra); pasado el tope, sin permiso', async () => {
  _reiniciarFrenoGasto();
  process.env.ELEVENLABS_API_KEY = 'xi-de-prueba';
  process.env.AURA_TOPE_DIA_STT_SEGUNDOS = String(3 * SEGUNDOS_POR_PERMISO_TURBO);
  for (let i = 0; i < MAX_PERMISOS_ANTICIPADOS; i++) assert.ok(await permisoTurbo('es', undefined, undefined, { anticipado: true, quien: 'mudo@x' }));
  assert.equal(estadoGasto().stt.usado, 0);
  assert.ok(await permisoTurbo('es', undefined, undefined, { anticipado: true, quien: 'mudo@x' }));
  assert.equal(estadoGasto().stt.usado, SEGUNDOS_POR_PERMISO_TURBO, 'el más viejo se cobró como usado');
  // Llenar el tope y ver que el siguiente (adelantado o no) ya no se da.
  assert.equal(gastarCupoDiario('stt', 2 * SEGUNDOS_POR_PERMISO_TURBO), true);
  const lineas = await registro(async () => {
    assert.equal(await permisoTurbo('es', undefined, undefined, { anticipado: true, quien: 'otro@x' }), null);
    assert.equal(await permisoTurbo('es'), null);
  });
  assert.match(lineas.join('\n'), /TOPE DIARIO ALCANZADO: el oído/);
  // A mando, aunque el tope esté lleno, sí (y se anota aparte al usarlo).
  const p = await conPagadorGasto(() => true, () => permisoTurbo('es', undefined, undefined, { anticipado: true, quien: 'jose@x' }));
  assert.ok(p?.id, 'mando oye aunque el día esté lleno');
  assert.equal(cobrarPermisoUsado(p!.id!, 'jose@x'), true);
  assert.equal(estadoGasto().stt.exento, SEGUNDOS_POR_PERMISO_TURBO);
  // La ruta del servidor: `anticipado` y `usado` llegan a permisoTurbo y a cobrarPermisoUsado, con la cuenta de la sesión.
  const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const r = server.slice(server.indexOf("app.post('/api/stt/turbo/permiso'"), server.indexOf("app.post('/api/stt', "));
  assert.match(r, /if \(usado\) cobrarPermisoUsado\(usado, quien\);/);
  assert.match(r, /permisoTurbo\(String\(req\.body\?\.language \|\| 'es'\), undefined, undefined, \{ anticipado: req\.body\?\.anticipado === true, quien \}\)/);
});

test('el teléfono: el motor del oído pide por adelantado y avisa el id que usó (mobile/src/lib/turboMotor.ts)', () => {
  const motor = fs.readFileSync(new URL('../mobile/src/lib/turboMotor.ts', import.meta.url), 'utf8');
  assert.match(motor, /\.permiso\(\{ anticipado, \.\.\.\(usado \? \{ usado \} : \{\}\) \}\)/);
  assert.match(motor, /if \(g\?\.anticipado && g\.id\) this\.usadoSinAvisar = g\.id;/);
  assert.match(motor, /this\.prepararPermiso\(false\);\n\s+await this\.pidiendo;/, 'el que se pide para usar ya, no es adelantado');
  const api = fs.readFileSync(new URL('../mobile/src/lib/api.ts', import.meta.url), 'utf8');
  assert.match(api, /'\/api\/stt\/turbo\/permiso', \{ method: 'POST', body: JSON\.stringify\(cuerpo\) \}, 8_000, true, \{ deLaPersona: !o\.anticipado \}\)/, 'el adelantado no pide la huella');
});
