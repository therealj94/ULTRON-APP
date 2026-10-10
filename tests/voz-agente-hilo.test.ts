/**
 * LA LLAMADA QUE NO PIERDE EL HILO (José, 10-oct, APK 5.7.0: «AURA me seguía diciendo que me perdió el hilo»). En el log:
 * ráfagas de «[cerebro manos] intentos: … la persona interrumpió» (5–6 en un segundo), «[mesa] respuesta tardía», «tras
 * 5 frases a medias (seguía hablando)», «[voz] sin palabras … no es un turno» y `[turno] FALLA ruta=stream … estado=error`.
 *
 * Lo que se prueba en la ruta real del LLM propio (server/voz-agente.ts) con un cerebro falso en proceso:
 *  · el eco de su propia voz (o un «ajá») mientras AU-RA habla NO es un turno: no aborta la respuesta en curso, no va al
 *    cerebro, y la respuesta sigue desde la frase que se cortó;
 *  · una interrupción de verdad («espera», dos palabras suyas) sí corta, como siempre;
 *  · la misma frase repetida por ElevenLabs con otra puntuación se engancha al turno que ya piensa (no lo aborta);
 *  · una respuesta TARDÍA (llegó otra frase) no dice «Se me fue el hilo»: no dice nada;
 *  · un error de adentro dice lo que de verdad pasó (no te escuché / no alcanzo mi cerebro / se me cortó y de qué hablaban);
 *  · al reconectarse sin frase, el perdón retoma el tema de la conversación que se cayó.
 */
import './datos-prueba';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voz-agente-hilo-'));
process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(dir, 'cerradas.json');
process.env.ULTRON_SESION_SECRETO = 'secreto-de-prueba-largo-para-las-sesiones-1234';
process.env.ULTRON_MEMORIA_BUCKET = '';
process.env.AURA_SUSPENSIONES = 'ninguna';

const {
  emitirPase,
  montarVozAgente,
  abrirConversacion,
  ETIQUETA_SECRETO_LLM,
  vozQueSonaba,
  esEcoOAsentimiento,
  restoTrasLoOido,
  fraseDeError,
  recuperacionHilo,
  perdonReconexion,
  anotarHiloCuenta,
  hiloAnterior,
  mismaFrase,
  dichoEntero,
} = await import('../server/voz-agente');
const { secretoDerivado, emitirSesion, sesionDe } = await import('../server/seguridad');
type TurnoVoz = import('../server/voz-agente').TurnoVoz;

const BEARER = `Bearer ${secretoDerivado(ETIQUETA_SECRETO_LLM)}`;
let n = 0;
function persona() {
  n++;
  return emitirSesion({ correo: `hilo${n}@ordenglobal.org`, nombre: 'José', rol: 'Junta' });
}
function paseDe(s: ReturnType<typeof persona>, idioma: 'es' | 'en' = 'es') {
  const p = emitirPase(s, 'aura', idioma, {});
  abrirConversacion(s.correo, p.cid);
  return { pase: p.pase, cid: p.cid };
}

async function montar(cerebro: (t: TurnoVoz) => Promise<void>, o: { graciaReintentoMs?: number } = {}) {
  const app = express();
  app.use(express.json());
  const vistos: TurnoVoz[] = [];
  const pasa: express.RequestHandler = (_q, _s, next) => next();
  montarVozAgente(app, {
    exigirMesaODesk: pasa,
    limitar: () => pasa,
    sesionDe,
    turno: async (t) => {
      vistos.push(t);
      await cerebro(t);
    },
    puenteMs: 0,
    graciaReintentoMs: o.graciaReintentoMs ?? 300,
    etiquetas: false,
    ambiente: () => undefined,
  });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return { base, vistos, cerrar: () => new Promise((r) => srv.close(r)) };
}

const llm = (base: string, pase: string, messages: unknown[], signal?: AbortSignal) =>
  fetch(`${base}/api/voz/llm/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: BEARER, 'x-pase': pase },
    body: JSON.stringify({ model: 'aura', stream: true, messages }),
    signal,
  });

const dichoDe = (texto: string) =>
  texto
    .split('\n\n')
    .filter((l) => l.startsWith('data: {'))
    .map((l) => JSON.parse(l.slice(6)).choices[0].delta.content || '')
    .join('');

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LARGA = 'El oro está a tres mil cuatrocientos dólares la onza. Subió un poco esta semana por el dólar. La plata también subió. Y el cobre quedó igual.';

test('el eco: lo que llega mientras AU-RA habla se compara con lo que dice; un freno o dos palabras suyas sí cortan', () => {
  const conv = { enCurso: {}, algoEnCurso: true, dichoEnCurso: LARGA, anterior: dichoEntero('', '') };
  const s = vozQueSonaba(conv, [{ role: 'user', content: 'el oro' }, { role: 'assistant', content: 'El oro está a tres mil cuatrocientos dólares la onza. Subió un poco...' }, { role: 'user', content: 'x' }]);
  assert.ok(s && s.enCurso);
  assert.equal(esEcoOAsentimiento('subió un poco esta semana', s!.dichos), true, 'su propia voz');
  assert.equal(esEcoOAsentimiento('ajá', s!.dichos), true, 'asentir');
  assert.equal(esEcoOAsentimiento('espera', s!.dichos), false, 'un freno corta');
  assert.equal(esEcoOAsentimiento('mejor dime del clima', s!.dichos), false, 'dos palabras suyas cortan');
  assert.equal(esEcoOAsentimiento('¿y la plata?', s!.dichos), false, 'palabras que ella dijo, pero no en ese orden: es la persona');
  assert.equal(esEcoOAsentimiento('la plata también subió y el cobre', s!.dichos), true, 'un pedazo seguido de su voz es eco');
  // AU-RA ya había terminado (no la cortaron) y no piensa nada: un «sí» es una respuesta, no un eco.
  const termino = { enCurso: null, algoEnCurso: false, dichoEnCurso: '', anterior: dichoEntero('x', '¿Lo mando?') };
  assert.equal(vozQueSonaba(termino, [{ role: 'assistant', content: '¿Lo mando?' }, { role: 'user', content: 'sí' }]), null);
});

test('desde dónde sigue la respuesta: desde el principio de la frase que se cortó (sin contar las etiquetas)', () => {
  assert.equal(restoTrasLoOido(LARGA, ''), 0);
  const i = restoTrasLoOido(LARGA, 'El oro está a tres mil cuatrocientos dólares la onza. Subió un poco...');
  assert.equal(LARGA.slice(i).startsWith('Subió un poco esta semana'), true, LARGA.slice(i));
  const j = restoTrasLoOido(LARGA, 'El oro está a tres mil cuatrocientos dólares la onza.');
  assert.equal(LARGA.slice(j).startsWith('Subió'), true, 'terminó una frase: sigue la próxima');
  const conTag = '[warmly] Hola José. [laughs] Qué gusto oírte, de verdad.';
  assert.equal(conTag.slice(restoTrasLoOido(conTag, 'Hola José. Qué gusto')).startsWith('[laughs] Qué gusto') || conTag.slice(restoTrasLoOido(conTag, 'Hola José. Qué gusto')).startsWith('Qué gusto'), true);
  assert.equal(restoTrasLoOido(LARGA, LARGA), LARGA.length, 'lo oyó todo');
});

test('en la ruta: su eco no aborta la respuesta en curso; la respuesta sigue desde la frase cortada', async () => {
  let abortado = false;
  let turnos = 0;
  let soltar: () => void = () => undefined;
  const s = await montar(async (t) => {
    turnos++;
    t.senal.addEventListener('abort', () => (abortado = true));
    t.enviar('delta', { text: 'El oro está a tres mil cuatrocientos dólares la onza. ', voz: 'El oro está a tres mil cuatrocientos dólares la onza. ' });
    t.enviar('delta', { text: 'Subió un poco esta semana por el dólar. ', voz: 'Subió un poco esta semana por el dólar. ' });
    await new Promise<void>((r) => (soltar = r));
    t.enviar('delta', { text: 'La plata también subió.', voz: 'La plata también subió.' });
    t.enviar('done', { reply: 'listo' });
  });
  try {
    const { pase } = paseDe(persona());
    const ctrl = new AbortController();
    const r1 = await llm(s.base, pase, [{ role: 'user', content: '¿Cómo está el oro?' }], ctrl.signal);
    const lector = r1.body!.getReader();
    await lector.read();
    await espera(50);
    // ElevenLabs oyó «voz» (el eco por el altavoz): calla el audio y manda lo «oído» como turno nuevo.
    ctrl.abort();
    const r2 = llm(s.base, pase, [
      { role: 'user', content: '¿Cómo está el oro?' },
      { role: 'assistant', content: 'El oro está a tres mil cuatrocientos dólares la onza. Subió un poco...' },
      { role: 'user', content: 'subió un poco esta semana' },
    ]);
    await espera(80);
    soltar();
    const dicho = dichoDe(await (await r2).text());
    assert.equal(abortado, false, 'el eco no abortó el turno');
    assert.equal(turnos, 1, 'no fue al cerebro');
    assert.equal(dicho, 'Subió un poco esta semana por el dólar. La plata también subió.', 'sigue desde la frase cortada');
  } finally {
    await s.cerrar();
  }
});

test('en la ruta: el eco que corta una respuesta YA terminada repite lo que faltaba; una interrupción de verdad va al cerebro', async () => {
  const s = await montar(async (t) => {
    const m = String((t.body as any).message);
    const texto = m.includes('oro') ? LARGA : 'Va, te digo del clima: soleado.';
    t.enviar('delta', { text: texto, voz: texto });
    t.enviar('done', { reply: texto });
  });
  try {
    const { pase } = paseDe(persona());
    assert.equal(dichoDe(await (await llm(s.base, pase, [{ role: 'user', content: '¿Cómo está el oro?' }])).text()), LARGA);
    const cortada = [{ role: 'user', content: '¿Cómo está el oro?' }, { role: 'assistant', content: 'El oro está a tres mil cuatrocientos dólares la onza. Subió un...' }];
    const eco = dichoDe(await (await llm(s.base, pase, [...cortada, { role: 'user', content: 'Subió un poco' }])).text());
    assert.equal(eco, 'Subió un poco esta semana por el dólar. La plata también subió. Y el cobre quedó igual.');
    assert.equal(s.vistos.length, 1, 'el eco no fue un turno');
    const real = dichoDe(await (await llm(s.base, pase, [{ role: 'user', content: '¿Cómo está el oro?' }, { role: 'assistant', content: 'Subió un poco esta semana...' }, { role: 'user', content: 'espera, mejor el clima' }])).text());
    assert.match(real, /^Va, te digo del clima[:,] soleado\.$/);
    assert.equal(s.vistos.length, 2);
  } finally {
    await s.cerrar();
  }
});

test('la misma frase con otra puntuación (ElevenLabs la repite) se engancha al turno que piensa', async () => {
  let abortos = 0;
  let soltar: () => void = () => undefined;
  const s = await montar(async (t) => {
    t.senal.addEventListener('abort', () => abortos++);
    await new Promise<void>((r) => (soltar = r));
    t.enviar('delta', { text: 'Soleado y 28 grados.', voz: 'Soleado y 28 grados.' });
    t.enviar('done', { reply: 'Soleado y 28 grados.' });
  });
  try {
    assert.equal(mismaFrase('Oye, ¿y el clima?', 'oye y el clima'), true);
    assert.equal(mismaFrase('oye y el clima', 'oye y el clima de mañana'), false);
    const { pase } = paseDe(persona());
    const ctrl = new AbortController();
    void llm(s.base, pase, [{ role: 'user', content: 'Oye, ¿y el clima?' }], ctrl.signal).catch(() => undefined);
    await espera(50);
    const r2 = llm(s.base, pase, [{ role: 'user', content: 'oye y el clima' }]);
    await espera(50);
    soltar();
    assert.equal(dichoDe(await (await r2).text()), 'Soleado y 28 grados.');
    assert.equal(s.vistos.length, 1, 'un solo turno');
    assert.equal(abortos, 0, 'nadie abortó al primero');
    ctrl.abort();
  } finally {
    await s.cerrar();
  }
});

test('una respuesta TARDÍA no dice «Se me fue el hilo»; un error dice lo que de verdad pasó', async () => {
  let modo = 'tardia';
  const s = await montar(async (t) => {
    if (modo === 'tardia') return t.enviar('done', { reply: '', voz: '', estado: 'error', parcial: true, tardia: true, acciones: [] });
    if (modo === 'vacio') return t.enviar('error', { error: 'No te escuché bien. ¿Me lo repites?', codigo: 'vacio' });
    if (modo === 'cerebro') return t.enviar('error', { error: 'x', codigo: 'cerebro' });
    return t.enviar('error', { error: 'x', codigo: 'caido' });
  });
  try {
    const { pase } = paseDe(persona());
    const msgs = [{ role: 'user', content: 'cuéntame del proyecto de la mina' }];
    assert.equal(dichoDe(await (await llm(s.base, pase, msgs)).text()), '', 'tardía: nada (la contesta el turno nuevo)');
    modo = 'vacio';
    assert.equal(dichoDe(await (await llm(s.base, pase, msgs)).text()), 'No te escuché bien. ¿Me lo repites?');
    modo = 'cerebro';
    assert.match(dichoDe(await (await llm(s.base, pase, msgs)).text()), /no alcanzo mi cerebro/);
    modo = 'caido';
    assert.equal(dichoDe(await (await llm(s.base, pase, msgs)).text()), 'Perdón, se me cortó. Me decías «cuéntame del proyecto de la mina»: ¿me lo repites?');
  } finally {
    await s.cerrar();
  }
  assert.equal(fraseDeError('vacio', 'en'), "I didn't catch that. Could you say it again?");
  assert.equal(recuperacionHilo('es', '[[reconecta]]'), 'Se me fue el hilo. ¿Me lo repites?', 'una marca no se cita');
});

test('reconectar sin frase retoma el tema de la conversación que se cayó (el hilo pasa a la nueva)', async () => {
  const s = await montar(async (t) => {
    t.enviar('delta', { text: 'La concesión vence en marzo.', voz: 'La concesión vence en marzo.' });
    t.enviar('done', { reply: 'La concesión vence en marzo.' });
  });
  try {
    const yo = persona();
    const a = paseDe(yo);
    await (await llm(s.base, a.pase, [{ role: 'user', content: '¿Cuándo vence la concesión de El Corpus?' }])).text();
    // La sesión se cayó: el teléfono abre otra conversación y manda `[[reconecta]]` (la frase ya estaba contestada).
    const b = paseDe(yo);
    const dicho = dichoDe(await (await llm(s.base, b.pase, [{ role: 'user', content: '[[reconecta]]' }])).text());
    assert.equal(dicho, 'Perdón, se me cortó. Me hablabas de «¿Cuándo vence la concesión de El Corpus?». ¿Seguimos con eso?');
    assert.equal(s.vistos.length, 1, 'sin cerebro');
  } finally {
    await s.cerrar();
  }
  // Sin nada de antes, el de siempre (eso sí es verdad entonces).
  assert.equal(perdonReconexion('es', null), 'Perdón, se me cortó. ¿Me repites?');
  anotarHiloCuenta('otra@x.org', 'c1', { dicho: 'Te contaba del oro. Subió mucho esta semana.' });
  assert.equal(hiloAnterior('otra@x.org', 'c1'), null, 'la misma conversación no se retoma a sí misma');
  assert.equal(perdonReconexion('es', hiloAnterior('otra@x.org', 'c2')), 'Perdón, se me cortó. Te decía: «Subió mucho esta semana». ¿Sigo?');
});
