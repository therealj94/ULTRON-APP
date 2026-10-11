/**
 * /api/tts/pcm: EL TELÉFONO SE VA Y NADIE SIGUE GENERANDO (auditoría del 11-oct, VOZ-03; server/voz-pcm.ts,
 * server/voz.ts `abrirVozPcm`, server/eleven.ts).
 *
 * Antes la ruta esperaba a `abrirVozPcm` (caché, S3, ElevenLabs) ANTES de escuchar el cierre de la conexión, y
 * ElevenLabs solo tenía su propio tope de 15/30 s: si la persona cancelaba en el teléfono mientras ElevenLabs tardaba
 * en contestar, el pedido seguía (cupo gastado) y, si fallaba, hasta se arrancaba Voicebox para una frase que ya no
 * oía nadie. Ahora el corte existe ANTES de la primera espera y junta el cierre del teléfono, el plazo del primer
 * audio y la cancelación de la generación; llega a ElevenLabs, a Voicebox y a la lectura; sin nadie esperando no hay
 * respaldo ni escrituras tarde, y el turno siguiente funciona.
 *
 * ElevenLabs se finge interceptando `fetch`; S3 y Voicebox también son de mentira.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { _reiniciarFrenoEleven, _olvidarSinEnlace } from '../server/eleven';
import { _s3VozDePrueba, _vaciarCacheVoz, _vaciarHiloVoz } from '../server/voz';
import { montarVozPcm, type PeticionVozPcm } from '../server/voz-pcm';
import { anotarFraseFija } from '../lib/frases-conocidas';
import { voiceboxFalso, conVoicebox, CLAVE_FALSA } from './voicebox-falso';

type Llamada = { url: string; senal?: AbortSignal };
let responder: (l: Llamada) => Response | Promise<Response> = () => new Response('sin respuesta', { status: 500 });
const llamadas: Llamada[] = [];
const fetchReal = globalThis.fetch;
const claveAntes = process.env.ELEVENLABS_API_KEY;
process.env.ELEVENLABS_API_KEY = 'xi-de-prueba';
globalThis.fetch = (async (entrada: any, init?: any) => {
  const url = String(entrada?.url || entrada);
  if (!url.startsWith('https://api.elevenlabs.io/')) return fetchReal(entrada, init);
  const l = { url, senal: init?.signal as AbortSignal | undefined };
  llamadas.push(l);
  return responder(l);
}) as typeof fetch;

/** ElevenLabs que no suelta las cabeceras: solo termina cuando le cortan el pedido (y lo anota). */
const cortes: string[] = [];
function retenerCabeceras(l: Llamada): Promise<Response> {
  return new Promise<Response>((_ok, mal) => {
    const fin = () => {
      cortes.push(l.url);
      mal(l.senal?.reason ?? new DOMException('abortado', 'AbortError'));
    };
    if (l.senal?.aborted) return fin();
    l.senal?.addEventListener('abort', fin, { once: true });
  });
}

/** Un cuerpo PCM que la prueba suelta a mano, y que avisa si alguien lo canceló. */
function cuerpoManual() {
  let c!: ReadableStreamDefaultController<Uint8Array>;
  const estado = { cancelado: false };
  const cuerpo = new ReadableStream<Uint8Array>({ start: (x) => void (c = x), cancel: () => void (estado.cancelado = true) });
  return { cuerpo, estado, dar: (b: Uint8Array) => c.enqueue(b), cerrar: () => c.close() };
}
const pcm = (n: number) => new Uint8Array(Buffer.alloc(n, 3));
const respuestaPcm = (cuerpo: ReadableStream<Uint8Array>) => new Response(cuerpo, { status: 200, headers: { 'Content-Type': 'audio/pcm' } });

const leer = (req: express.Request): PeticionVozPcm => ({
  texto: String(req.query.text || '').trim(),
  emocion: 'neutral',
  performance: 'speak',
  avatar: 'aura',
  idioma: 'es',
  privado: false,
});

/** Escrituras en la respuesta DESPUÉS de que el teléfono se fue (no debería haber ninguna). */
let tarde: string[] = [];
let devueltos = 0;
let cancelacion: AbortController | null = null;
const app = express();
app.use((_req, res, next) => {
  let cerrado = false;
  res.on('close', () => (cerrado = true));
  for (const k of ['write', 'end', 'writeHead'] as const) {
    const orig = (res as any)[k].bind(res);
    (res as any)[k] = (...a: any[]) => {
      if (cerrado && !res.writableEnded) tarde.push(k);
      return orig(...a);
    };
  }
  next();
});
montarVozPcm(app, {
  exigir: (_req, _res, next) => next(),
  limitar: () => (_req, _res, next) => next(),
  leer,
  cuentaMiembro: () => null,
  restanteMs: () => 60_000,
  anotar: () => undefined,
  msDeHabla: (t) => t.length * 60,
  devolver: () => void devueltos++,
  cancelado: () => cancelacion?.signal,
  esperaMs: 400,
});
const servidor = app.listen(0);
const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
after(() => {
  servidor.close();
  globalThis.fetch = fetchReal;
  _s3VozDePrueba(null);
  if (claveAntes === undefined) delete process.env.ELEVENLABS_API_KEY;
  else process.env.ELEVENLABS_API_KEY = claveAntes;
});

const q = (texto: string) => `/api/tts/pcm?text=${encodeURIComponent(texto)}`;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pide y CUELGA: a los `ms` (sin haber visto nada) o cuando `colgarAl(trozos)` lo diga. */
function pedirYColgar(ruta: string, o: { ms?: number; colgarAl?: (trozos: number) => boolean }): Promise<{ status: number; bytes: number }> {
  return new Promise((ok) => {
    let status = 0;
    let bytes = 0;
    let trozos = 0;
    const req = http.get(`${base}${ruta}`, (res) => {
      status = res.statusCode || 0;
      res.on('data', (b: Buffer) => {
        bytes += b.length;
        trozos++;
        if (o.colgarAl?.(trozos)) req.destroy();
      });
      res.on('error', () => undefined);
      res.on('close', () => ok({ status, bytes }));
    });
    req.on('error', () => ok({ status, bytes }));
    if (o.ms !== undefined) setTimeout(() => req.destroy(), o.ms);
  });
}
function pedir(ruta: string): Promise<{ status: number; cuerpo: Buffer }> {
  return new Promise((ok) => {
    http
      .get(`${base}${ruta}`, (res) => {
        const partes: Buffer[] = [];
        res.on('data', (b: Buffer) => partes.push(b));
        res.on('error', () => undefined);
        res.on('close', () => ok({ status: res.statusCode || 0, cuerpo: Buffer.concat(partes) }));
      })
      .on('error', () => ok({ status: 0, cuerpo: Buffer.alloc(0) }));
  });
}

const limpio = () => {
  _vaciarCacheVoz();
  _vaciarHiloVoz();
  _reiniciarFrenoEleven();
  _olvidarSinEnlace();
  _s3VozDePrueba(null);
  llamadas.length = 0;
  cortes.length = 0;
  tarde = [];
  devueltos = 0;
  cancelacion = null;
};

/** El turno siguiente, con un ElevenLabs que sí contesta: 200 con su audio. */
async function turnoSiguienteFunciona(texto: string) {
  const m = cuerpoManual();
  responder = () => respuestaPcm(m.cuerpo);
  const p = pedir(q(texto));
  await espera(20);
  m.dar(pcm(4000));
  m.cerrar();
  const r = await p;
  assert.equal(r.status, 200, 'el turno siguiente suena');
  assert.equal(r.cuerpo.length, 4000);
}

test('ElevenLabs retiene las cabeceras y el teléfono cuelga a los 100 ms: el pedido se corta, sin respaldo ni escrituras tarde', async () => {
  limpio();
  const vb = await voiceboxFalso();
  try {
    await conVoicebox(vb.url, CLAVE_FALSA, async () => {
      responder = retenerCabeceras;
      await pedirYColgar(q('Una frase que nadie va a oír.'), { ms: 100 });
      await espera(150);
      assert.equal(llamadas.length, 1, 'un solo pedido a ElevenLabs: ni el modelo de respaldo');
      assert.equal(llamadas[0].senal?.aborted, true, 'el pedido a ElevenLabs quedó cortado');
      assert.equal(cortes.length, 1);
      assert.equal(vb.pedidos.filter((p) => p.ruta.includes('/generate')).length, 0, 'sin Voicebox: nadie espera la frase');
      assert.deepEqual(tarde, [], 'nada se escribió después de colgar');
      await turnoSiguienteFunciona('La frase del turno siguiente.');
    });
  } finally {
    await vb.cerrar();
  }
});

test('el plazo del primer audio (antes de las cabeceras): ElevenLabs no contesta → 503, el pedido se corta y no arranca Voicebox', async () => {
  limpio();
  const vb = await voiceboxFalso();
  try {
    await conVoicebox(vb.url, CLAVE_FALSA, async () => {
      responder = retenerCabeceras;
      const t0 = Date.now();
      const r = await pedir(q('Una frase que tarda demasiado.'));
      assert.equal(r.status, 503, 'el teléfono la pide por el camino de siempre');
      assert.ok(Date.now() - t0 < 1500, 'a los 400 ms del plazo, no a los 15 s de ElevenLabs');
      assert.equal(llamadas.length, 1);
      assert.equal(llamadas[0].senal?.aborted, true);
      assert.equal(vb.pedidos.filter((p) => p.ruta.includes('/generate')).length, 0);
      assert.equal(devueltos, 1, 'el lugar del cupo vuelve');
      await turnoSiguienteFunciona('Después del plazo, otra frase.');
    });
  } finally {
    await vb.cerrar();
  }
});

test('la generación se cancela (la persona interrumpió) mientras ElevenLabs tarda: se corta todo, sin respaldo', async () => {
  limpio();
  const vb = await voiceboxFalso();
  try {
    await conVoicebox(vb.url, CLAVE_FALSA, async () => {
      responder = retenerCabeceras;
      cancelacion = new AbortController();
      const c = cancelacion;
      setTimeout(() => c.abort(), 100);
      const r = await pedir(q('Una frase interrumpida.'));
      assert.notEqual(r.status, 200);
      assert.equal(llamadas.length, 1);
      assert.equal(llamadas[0].senal?.aborted, true);
      assert.equal(vb.pedidos.filter((p) => p.ruta.includes('/generate')).length, 0);
      cancelacion = null;
      await turnoSiguienteFunciona('Lo nuevo que pidió.');
    });
  } finally {
    await vb.cerrar();
  }
});

test('cuelga con el primer byte, a media frase o al final: ElevenLabs se cancela, nada queda en la caché, sin escrituras tarde', async () => {
  for (const [cuando, colgarAl, trozosAntes] of [
    ['primer byte', 1, 1],
    ['a media frase', 2, 2],
    ['al final (sin cerrar ElevenLabs)', 4, 4],
  ] as const) {
    limpio();
    const texto = `Una frase cortada (${cuando}).`;
    const m = cuerpoManual();
    responder = () => respuestaPcm(m.cuerpo);
    const p = pedirYColgar(q(texto), { colgarAl: (n) => n >= colgarAl });
    for (let i = 0; i < trozosAntes; i++) {
      await espera(30);
      m.dar(pcm(2000));
    }
    await p;
    await espera(80);
    assert.ok(m.estado.cancelado || llamadas[0].senal?.aborted, `${cuando}: ElevenLabs dejó de generar`);
    assert.deepEqual(tarde, [], `${cuando}: nada después de colgar`);
    // No quedó en la caché: la misma frase vuelve a ElevenLabs.
    await turnoSiguienteFunciona(texto);
    assert.equal(llamadas.length, 2, `${cuando}: el pedazo no se guardó`);
  }
});

test('caché lenta (S3) y el teléfono cuelga mientras se lee: ni ElevenLabs ni Voicebox después', async () => {
  limpio();
  const texto = `¡Hola, José! ¿En qué te ayudo? ${Math.random()}`;
  anotarFraseFija(texto);
  _s3VozDePrueba({
    listo: () => true,
    get: async () => {
      await espera(300);
      return { ok: true, json: null, detalle: 'vacío', missing: true } as any;
    },
    put: async () => ({ ok: true, detalle: 'ok' }) as any,
  });
  const vb = await voiceboxFalso();
  try {
    await conVoicebox(vb.url, CLAVE_FALSA, async () => {
      responder = retenerCabeceras;
      await pedirYColgar(q(texto), { ms: 100 });
      await espera(500);
      assert.equal(llamadas.length, 0, 'ElevenLabs ni se tocó: la persona ya se había ido');
      assert.equal(vb.pedidos.filter((p) => p.ruta.includes('/generate')).length, 0);
      assert.deepEqual(tarde, []);
    });
  } finally {
    await vb.cerrar();
    _s3VozDePrueba(null);
  }
  await turnoSiguienteFunciona('Una frase cualquiera después.');
});
