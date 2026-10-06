/**
 * /api/tts/pcm — la voz en streaming del teléfono (server/voz-pcm.ts, server/voz.ts `abrirVozPcm`;
 * docs/adr/ADR-voz-en-streaming.md). Con un ElevenLabs falso (se intercepta `fetch`) y HTTP de verdad:
 *
 *  · lo que ElevenLabs genera llega al teléfono A TROZOS, antes de que termine (no se junta en el servidor);
 *  · misma voz y modelo que /api/tts, PCM a 22 050 Hz, la frecuencia en la cabecera;
 *  · la caché guarda solo lo que llegó entero; un corte a media frase ROMPE la conexión y no se guarda;
 *  · las mismas puertas que /api/tts/stream (ruta abierta de voz exacta, cupo 'voz', minutos del miembro → Voicebox);
 *  · y cuánto antes empieza a sonar contra bajar la frase entera, con un ElevenLabs que suelta los bytes despacio.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { VOCES_ELEVEN, _reiniciarFrenoEleven, hzPcm, modeloDeLocucion } from '../server/eleven';
import { _vaciarCacheVoz, pcmDeWav } from '../server/voz';
import { montarVozPcm, type PeticionVozPcm } from '../server/voz-pcm';
import { mesaDeskAutorizada } from '../server/seguridad';
import { voiceboxFalso, conVoicebox, CLAVE_FALSA, wavDePrueba } from './voicebox-falso';
import { VOZ_VIVO, bytesDeMs, msDeBytes } from '../mobile/src/lib/vozNativa';

type Llamada = { url: string; cuerpo: any; accept: string | null };

/** El ElevenLabs falso: `responder` decide qué devuelve cada pedido (un Response con cuerpo en streaming). */
let responder: (url: string, cuerpo: any) => Response = () => new Response('sin respuesta', { status: 500 });
const llamadas: Llamada[] = [];
const fetchReal = globalThis.fetch;
const claveAntes = process.env.ELEVENLABS_API_KEY;
process.env.ELEVENLABS_API_KEY = 'xi-de-prueba';
// La mesa cerrada como en producción: con NODE_ENV=test (el CI) y sin clave, mesaAutorizada abre el hueco de desarrollo
// y cualquier ruta parecería autorizada (la prueba de «ruta EXACTA» no probaría nada).
process.env.ULTRON_MESA_CLAVE ||= 'clave-de-mesa-de-prueba-voz-pcm-larga';
globalThis.fetch = (async (entrada: any, init?: any) => {
  const url = String(entrada?.url || entrada);
  if (!url.startsWith('https://api.elevenlabs.io/')) return fetchReal(entrada, init);
  const cuerpo = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
  llamadas.push({ url, cuerpo, accept: init?.headers?.Accept ?? null });
  return responder(url, cuerpo);
}) as typeof fetch;

/** Un cuerpo que la prueba suelta a mano: `dar(bytes)`, `cerrar()`, `romper()`. */
function cuerpoManual() {
  let c!: ReadableStreamDefaultController<Uint8Array>;
  const cuerpo = new ReadableStream<Uint8Array>({ start: (x) => void (c = x) });
  return { cuerpo, dar: (b: Uint8Array) => c.enqueue(b), cerrar: () => c.close(), romper: () => c.error(new Error('ElevenLabs se cayó')) };
}
const pcm = (n: number, valor = 1000) => {
  const b = Buffer.alloc(n);
  for (let i = 0; i + 1 < n; i += 2) b.writeInt16LE(valor, i);
  return new Uint8Array(b);
};
const respuestaPcm = (cuerpo: ReadableStream<Uint8Array>) => new Response(cuerpo, { status: 200, headers: { 'Content-Type': 'audio/pcm' } });

/** Lo que la app de verdad lee del pedido (server.ts leerPeticionVoz), en corto. */
const leer = (req: express.Request): PeticionVozPcm => {
  const f: any = req.method === 'GET' ? req.query : { ...(req.query || {}), ...(req.body || {}) };
  return {
    texto: String(f.text || '').trim(),
    emocion: 'neutral',
    performance: 'speak',
    avatar: (String(f.avatar || 'aura') as any) || 'aura',
    idioma: f.idioma === 'en' ? 'en' : 'es',
    privado: f.privado === true || f.privado === '1',
    previo: f.previo ? String(f.previo) : undefined,
  };
};

const minutos = { cuenta: null as string | null, restante: 60_000, anotados: [] as Array<[string, number]> };
const limites: Array<[number, number | undefined, string | undefined]> = [];
/** Cuántas veces la ruta devolvió el lugar del cupo `voz` (el teléfono la pide por /api/tts, que cobra el suyo). */
let devueltos = 0;
const app = express();
app.use(express.json());
montarVozPcm(app, {
  // La puerta de verdad de las rutas de voz (seguridad.ts), con la ruta como la ve express.
  exigir: (req, res, next) => (mesaDeskAutorizada(req) ? next() : res.status(401).json({ error: 'sin sesión' })),
  limitar: (max, ventana, grupo) => {
    limites.push([max, ventana, grupo]);
    return (_req, _res, next) => next();
  },
  leer,
  cuentaMiembro: () => minutos.cuenta,
  restanteMs: () => minutos.restante,
  anotar: (c, ms) => minutos.anotados.push([c, ms]),
  msDeHabla: (t) => t.length * 60,
  devolver: () => void devueltos++,
});
const servidor = app.listen(0);
const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
after(() => {
  servidor.close();
  globalThis.fetch = fetchReal;
  if (claveAntes === undefined) delete process.env.ELEVENLABS_API_KEY;
  else process.env.ELEVENLABS_API_KEY = claveAntes;
});

/** GET con http (no fetch): se ve cada trozo cuando llega, y si la conexión se rompió. */
function pedir(ruta: string, alTrozo?: (b: Buffer, t: number) => void): Promise<{ status: number; headers: http.IncomingHttpHeaders; cuerpo: Buffer; roto: boolean; trozos: Array<[number, number]>; fin: number }> {
  const t0 = Date.now();
  return new Promise((ok) => {
    const req = http.get(`${base}${ruta}`, (res) => {
      const partes: Buffer[] = [];
      const trozos: Array<[number, number]> = [];
      let roto = false;
      res.on('data', (b: Buffer) => {
        partes.push(b);
        trozos.push([Date.now() - t0, b.length]);
        alTrozo?.(b, Date.now() - t0);
      });
      res.on('aborted', () => (roto = true));
      res.on('error', () => (roto = true));
      res.on('close', () => ok({ status: res.statusCode || 0, headers: res.headers, cuerpo: Buffer.concat(partes), roto: roto || !res.complete, trozos, fin: Date.now() - t0 }));
    });
    req.on('error', () => ok({ status: 0, headers: {}, cuerpo: Buffer.alloc(0), roto: true, trozos: [], fin: Date.now() - t0 }));
  });
}
const q = (texto: string, extra = '') => `/api/tts/pcm?text=${encodeURIComponent(texto)}&avatar=aura&idioma=es${extra}`;
const limpio = () => {
  _vaciarCacheVoz();
  _reiniciarFrenoEleven();
  llamadas.length = 0;
  minutos.cuenta = null;
  minutos.restante = 60_000;
  minutos.anotados.length = 0;
  devueltos = 0;
};

test('la frecuencia: 22 050 por omisión; ELEVENLABS_PCM_HZ solo si es una que todos los planes dan', () => {
  assert.equal(hzPcm({}), 22050);
  assert.equal(hzPcm({ ELEVENLABS_PCM_HZ: '16000' }), 16000);
  assert.equal(hzPcm({ ELEVENLABS_PCM_HZ: '24000' }), 24000);
  assert.equal(hzPcm({ ELEVENLABS_PCM_HZ: '44100' }), 22050, '44,1 kHz pide plan Pro: no');
  assert.equal(hzPcm({ ELEVENLABS_PCM_HZ: 'mucho' }), 22050);
});

test('llega A TROZOS antes del final: el primer trozo sale mientras ElevenLabs todavía genera; misma voz y modelo que /api/tts', async () => {
  limpio();
  const m = cuerpoManual();
  responder = () => respuestaPcm(m.cuerpo);
  let primeroCon = -1;
  const texto = 'Hola, ¿cómo estás hoy?';
  const p = pedir(q(texto), () => {
    if (primeroCon < 0) {
      // ElevenLabs todavía no terminó (la prueba no soltó el resto): esto llegó antes del final.
      primeroCon = llamadas.length;
      m.dar(pcm(8820));
      m.cerrar();
    }
  });
  await new Promise((r) => setTimeout(r, 30));
  m.dar(pcm(4410));
  const r = await p;
  assert.equal(r.status, 200);
  assert.equal(primeroCon, 1, 'el primer trozo llegó con ElevenLabs a medias');
  assert.ok(r.trozos.length >= 2, `a trozos: ${JSON.stringify(r.trozos)}`);
  assert.equal(r.cuerpo.length, 4410 + 8820, 'tal cual: ni un byte de más ni de menos');
  assert.equal(r.roto, false);
  assert.equal(r.headers['content-type'], 'audio/pcm');
  assert.equal(r.headers['x-ultron-pcm-hz'], '22050');
  assert.equal(r.headers['x-ultron-pcm-canales'], '1');
  assert.equal(r.headers['x-ultron-pcm-bits'], '16');
  assert.equal(r.headers['x-ultron-vivo'], '1');
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['transfer-encoding'], 'chunked', 'sin largo: va saliendo a medida que llega');
  const ll = llamadas[0];
  assert.match(ll.url, new RegExp(`/text-to-speech/${VOCES_ELEVEN.aura.es}/stream\\?output_format=pcm_22050$`), 'la voz de AU-RA de siempre, por /stream, en PCM');
  assert.equal(ll.accept, 'audio/pcm');
  assert.equal(ll.cuerpo.model_id, modeloDeLocucion({ texto, plataforma: 'ultron' }), 'el mismo modelo que /api/tts (la primera frase con el rápido)');
  assert.equal(ll.cuerpo.language_code, 'es');
});

test('la caché: lo que llegó entero se sirve la segunda vez sin pedirlo; con su largo y sin «en vivo»', async () => {
  limpio();
  const m = cuerpoManual();
  responder = () => respuestaPcm(m.cuerpo);
  const p = pedir(q('Una frase para la caché.'));
  m.dar(pcm(6000));
  m.dar(pcm(6000));
  m.cerrar();
  const a = await p;
  assert.equal(a.cuerpo.length, 12000);
  const b = await pedir(q('Una frase para la caché.'));
  assert.equal(llamadas.length, 1, 'la segunda no fue a ElevenLabs');
  assert.ok(b.cuerpo.equals(a.cuerpo), 'los mismos bytes');
  assert.equal(b.headers['content-length'], '12000');
  assert.equal(b.headers['x-ultron-vivo'], undefined);
  assert.equal(b.headers['x-ultron-pcm-hz'], '22050');
});

test('ElevenLabs se corta a media frase: la conexión se ROMPE (no un final limpio) y el pedazo NO queda en la caché', async () => {
  limpio();
  const m = cuerpoManual();
  responder = () => respuestaPcm(m.cuerpo);
  const p = pedir(q('Esta frase se corta a la mitad.'));
  m.dar(pcm(5000));
  await new Promise((r) => setTimeout(r, 30));
  m.romper();
  const r = await p;
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.length, 5000, 'lo que llegó sí pasó (el teléfono ya lo estaba sonando)');
  assert.equal(r.roto, true, 'roto: el teléfono sabe que no era el final');
  const m2 = cuerpoManual();
  responder = () => respuestaPcm(m2.cuerpo);
  const p2 = pedir(q('Esta frase se corta a la mitad.'));
  m2.dar(pcm(9000));
  m2.cerrar();
  const r2 = await p2;
  assert.equal(llamadas.length, 2, 'la segunda vez se pide de nuevo: el pedazo no se guardó');
  assert.equal(r2.cuerpo.length, 9000);
  assert.equal(r2.roto, false);
});

/*
 * Revisión independiente (MENOR 4): ElevenLabs terminaba limpio SIN un byte y la ruta contestaba 200 vacío; el teléfono lo
 * marcaba «formato» y apagaba el camino nuevo hasta reabrir la app, y el respaldo gastaba otro lugar del cupo `voz`.
 */
test('ElevenLabs termina sin audio (limpio, con trozos vacíos o roto antes del primer byte): 503 antes de las cabeceras, nada en la caché, el lugar vuelve', async () => {
  for (const [como, armar] of [
    ['limpio y vacío', (m: ReturnType<typeof cuerpoManual>) => m.cerrar()],
    ['solo trozos vacíos', (m: ReturnType<typeof cuerpoManual>) => (m.dar(new Uint8Array(0)), m.dar(new Uint8Array(0)), m.cerrar())],
    ['un byte suelto (ni una muestra)', (m: ReturnType<typeof cuerpoManual>) => (m.dar(new Uint8Array([7])), m.cerrar())],
    ['roto antes del primer byte', (m: ReturnType<typeof cuerpoManual>) => m.romper()],
  ] as const) {
    limpio();
    minutos.cuenta = 'ana@ejemplo.com';
    const m = cuerpoManual();
    responder = () => respuestaPcm(m.cuerpo);
    const p = pedir(q('Una frase que no trae voz.'));
    await new Promise((r) => setTimeout(r, 20));
    armar(m);
    const r = await p;
    assert.equal(r.status, 503, `${como}: 503, no un 200 vacío`);
    assert.match(String(r.headers['content-type']), /json/, como);
    assert.equal(r.headers['x-ultron-pcm-hz'], undefined, `${como}: sin cabeceras de PCM`);
    assert.equal(devueltos, 1, `${como}: el lugar del cupo vuelve (el respaldo cobra el suyo)`);
    assert.deepEqual(minutos.anotados, [], `${como}: sin audio no se cobran minutos`);
    // La segunda vez se pide de nuevo: nada vacío quedó en la caché.
    const m2 = cuerpoManual();
    responder = () => respuestaPcm(m2.cuerpo);
    const p2 = pedir(q('Una frase que no trae voz.'));
    m2.dar(pcm(4000));
    m2.cerrar();
    const r2 = await p2;
    assert.equal(r2.status, 200, como);
    assert.equal(r2.cuerpo.length, 4000, como);
    assert.equal(llamadas.length, 2, `${como}: no se sirvió de la caché`);
    assert.equal(devueltos, 1, `${como}: con audio no se devuelve nada`);
  }
});

test('lo privado (un chat de la persona) ni se guarda ni se sirve de la caché', async () => {
  limpio();
  for (let i = 0; i < 2; i++) {
    const m = cuerpoManual();
    responder = () => respuestaPcm(m.cuerpo);
    const p = pedir(q('Beto dijo que llega tarde.', '&privado=1'));
    m.dar(pcm(4000));
    m.cerrar();
    await p;
  }
  assert.equal(llamadas.length, 2);
});

test('ElevenLabs no abre (500): Voicebox, pasado a PCM con SU frecuencia; sin voz ninguna: 503 (el teléfono usa el camino de siempre)', async () => {
  limpio();
  const vb = await voiceboxFalso({ voz: () => ({ audio: wavDePrueba(0.25, 24000) }) });
  try {
    responder = () => new Response('caído', { status: 500 });
    const r = await conVoicebox(vb.url, CLAVE_FALSA, () => pedir(q('Respaldo con la otra voz.')));
    assert.equal(r.status, 200);
    assert.equal(r.headers['x-ultron-pcm-hz'], '24000');
    assert.equal(r.cuerpo.length, 6000 * 2, 'el WAV sin su cabecera: 0,25 s a 24 kHz');
    assert.ok(r.cuerpo.equals(pcmDeWav(wavDePrueba(0.25, 24000))!.pcm));
    assert.match(String(r.headers['x-ultron-tts']), /voicebox/);
    const sin = await conVoicebox(undefined, undefined, () => pedir(q('Nadie tiene voz.')));
    assert.equal(sin.status, 503);
    assert.match(String(sin.headers['content-type']), /json/);
    assert.equal(devueltos, 1, 'sin voz: el lugar del cupo vuelve (el teléfono la pide por /api/tts)');
  } finally {
    await vb.cerrar();
  }
});

test('minutos del miembro: con minutos se anotan (en vivo); sin minutos, Voicebox y X-Ultron-Tope-Voz, sin tocar ElevenLabs', async () => {
  limpio();
  minutos.cuenta = 'ana@ejemplo.com';
  const m = cuerpoManual();
  responder = () => respuestaPcm(m.cuerpo);
  const p = pedir(q('Con minutos.'));
  m.dar(pcm(3000));
  m.cerrar();
  await p;
  assert.deepEqual(minutos.anotados, [['ana@ejemplo.com', 'Con minutos.'.length * 60]]);
  minutos.restante = 0;
  const vb = await voiceboxFalso();
  try {
    const n = llamadas.length;
    const r = await conVoicebox(vb.url, CLAVE_FALSA, () => pedir(q('Sin minutos ya.')));
    assert.equal(r.status, 200);
    assert.equal(r.headers['x-ultron-tope-voz'], '1');
    assert.equal(llamadas.length, n, 'ElevenLabs no se tocó');
  } finally {
    await vb.cerrar();
  }
});

test('las puertas: las de /api/tts/stream (ruta de voz EXACTA, cupo «voz» de 60/min compartido); server.ts la monta así', async () => {
  assert.deepEqual(limites, [[60, 60_000, 'voz']], 'el mismo cupo que /api/tts y /api/tts/stream');
  assert.equal(mesaDeskAutorizada({ headers: {}, body: {}, path: '/api/tts/pcm', query: {} } as any), true);
  assert.equal(mesaDeskAutorizada({ headers: {}, body: {}, path: '/api/tts/pcm/', query: {} } as any), true);
  assert.equal(mesaDeskAutorizada({ headers: {}, body: {}, path: '/api/tts/pcmx', query: {} } as any), false, 'exacta: sin prefijos');
  assert.equal(mesaDeskAutorizada({ headers: {}, body: {}, path: '/api/tts/pcm/otra', query: {} } as any), false);
  const vacio = await pedir('/api/tts/pcm?text=');
  assert.equal(vacio.status, 400);
  const src = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(src, /montarVozPcm\(app, \{ exigir: exigirMesaODesk, limitar, leer: leerPeticionVoz, cuentaMiembro: cuentaDeVozMiembro, restanteMs: restanteVozMs, anotar: anotarVoz, msDeHabla, devolver: \(res\) => devolverLimite\(res, 'voz'\) \}\);/);
  assert.match(src, /app\.all\('\/api\/tts\/stream', exigirMesaODesk, limitar\(60, 60_000, 'voz'\), responderVozVivo\);/, '/api/tts/stream sigue igual');
});

test('devolverLimite: el lugar que cobró `limitar` a ESTE pedido vuelve; a lo más el cupo por ventana (el freno sigue)', async () => {
  const { limitar, devolverLimite } = await import('../server/seguridad');
  const lim = limitar(3, 60_000, 'voz-prueba-devolver');
  const pedido = () => {
    const req = { ip: '203.0.113.77', path: '/api/tts/pcm', socket: {} } as any;
    const res = { locals: {} as Record<string, unknown>, estado: 200, status(n: number) { this.estado = n; return this; }, json() { return this; } } as any;
    let paso = false;
    lim(req, res, () => (paso = true));
    return { res, paso };
  };
  // Tres pedidos llenan el cupo; el cuarto, 429.
  const a = [pedido(), pedido(), pedido()];
  assert.ok(a.every((x) => x.paso));
  assert.equal(pedido().paso, false, 'lleno');
  // Uno no se atendió (503) y se devuelve: entra otro.
  assert.equal(devolverLimite(a[0].res, 'voz-prueba-devolver'), true);
  assert.equal(devolverLimite(a[0].res, 'voz-prueba-devolver'), false, 'cada pedido devuelve una vez');
  assert.equal(devolverLimite(a[1].res, 'otro-grupo'), false, 'solo el grupo que cobró');
  assert.equal(pedido().paso, true, 'con el lugar devuelto, entra');
  // El freno: a lo más el cupo (3) devoluciones por ventana.
  assert.equal(devolverLimite(a[1].res, 'voz-prueba-devolver'), true);
  assert.equal(devolverLimite(a[2].res, 'voz-prueba-devolver'), true);
  const b = pedido();
  assert.equal(b.paso, true);
  assert.equal(devolverLimite(b.res, 'voz-prueba-devolver'), false, 'pasado el tope, lo devuelto sí cuenta');
});

test('MEDIDA: con un ElevenLabs que suelta 1,5 s de voz despacio, el teléfono empieza a sonar mucho antes que bajándola entera', async () => {
  limpio();
  const hz = 22050;
  const total = bytesDeMs(1500, hz);
  const trozos = 15;
  const cada = 60;
  responder = () => {
    let i = 0;
    const cuerpo = new ReadableStream<Uint8Array>({
      start(c) {
        const t = setInterval(() => {
          c.enqueue(pcm(total / trozos));
          if (++i >= trozos) {
            clearInterval(t);
            c.close();
          }
        }, cada);
      },
    });
    return respuestaPcm(cuerpo);
  };
  // El reproductor nativo manda a sonar cuando juntó VOZ_VIVO.prebufferMs (modules/aura-voz, mismo número).
  const prebufer = bytesDeMs(VOZ_VIVO.prebufferMs, hz);
  let juntado = 0;
  let suenaStream = -1;
  const r = await pedir(q('Una respuesta de un segundo y medio que llega despacio.'), (b, t) => {
    juntado += b.length;
    if (suenaStream < 0 && juntado >= prebufer) suenaStream = t;
  });
  // El camino de siempre: la frase entera bajada (y con eso recién se manda a sonar).
  const suenaEntera = r.fin;
  assert.equal(r.cuerpo.length, total);
  assert.equal(Math.round(msDeBytes(r.cuerpo.length, hz)), 1500);
  console.log(`  [medida] empieza a sonar: streaming ${suenaStream} ms · bajando entera ${suenaEntera} ms · ${suenaEntera - suenaStream} ms antes (${(suenaEntera / Math.max(1, suenaStream)).toFixed(1)}×)`);
  assert.ok(suenaStream > 0 && suenaStream < 300, `streaming suena con el primer prebúfer: ${suenaStream} ms`);
  assert.ok(suenaEntera >= cada * (trozos - 1), `entera espera a todo: ${suenaEntera} ms`);
  assert.ok(suenaEntera - suenaStream >= 500, 'medio segundo o más de ventaja');
});
