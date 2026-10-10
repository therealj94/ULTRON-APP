/**
 * UNA SOLA VOZ DE PRINCIPIO A FIN DEL TURNO (10-oct; server/voz.ts, server/eleven.ts, server/hilo-voz.ts).
 *
 *  · Todas las frases con el mismo modelo (eleven_v4_turbo): ya no hay «primera frase rápida» con turbo v2.5 (cambiaba
 *    el timbre entre la frase 1 y la 2 y la primera nunca llevaba el tono de la emoción).
 *  · El tono de la emoción va en la primera frase del turno (la que no trae `previo`), ya con v4.
 *  · Si v4 falla a mitad del turno, el rápido de respaldo (flash v2.5, sin etiquetas) y el resto del turno sigue con él;
 *    si ElevenLabs entero falla, Voicebox hasta el final, sin tomas grabadas pegadas entre frases en vivo.
 *  · Los vecinos van sin marcas y cortos (100), y los `request-id` de las frases anteriores enlazan el audio
 *    (previous_request_ids, ≤3); si el modelo no los acepta, se reintenta sin ellos y se recuerda.
 *
 * ElevenLabs se finge interceptando `fetch`; Voicebox es el de mentira de siempre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELO_ELEVEN, MODELO_RESPALDO_OMISION, _olvidarSinEnlace, _olvidarSinTiempos, _reiniciarFrenoEleven, cuerpoEleven, enlaceActivo, idDePedido } from '../server/eleven';
import { _vaciarCacheVoz, _vaciarHiloVoz, abrirVozPcm, hablar } from '../server/voz';
import { HiloVoz, normalizarFrase } from '../server/hilo-voz';
import { voiceboxFalso, conVoicebox, CLAVE_FALSA } from './voicebox-falso';

type Llamada = { url: string; cuerpo: any };
let siguienteId = 1;

/** ElevenLabs de mentira: `responder` decide; por omisión, audio con su `request-id`. */
async function conEleven<T>(responder: ((l: Llamada) => Response | null) | null, fn: (llamadas: Llamada[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const antes = process.env.ELEVENLABS_API_KEY;
  const llamadas: Llamada[] = [];
  process.env.ELEVENLABS_API_KEY = 'xi-de-prueba';
  _reiniciarFrenoEleven();
  _olvidarSinTiempos();
  _olvidarSinEnlace();
  _vaciarCacheVoz();
  _vaciarHiloVoz();
  globalThis.fetch = (async (entrada: any, init?: any) => {
    const url = String(entrada?.url || entrada);
    if (!url.startsWith('https://api.elevenlabs.io/')) return real(entrada, init);
    const l = { url, cuerpo: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body };
    llamadas.push(l);
    const propia = responder?.(l);
    if (propia) return propia;
    return new Response(new Uint8Array(4000).fill(0xff), { status: 200, headers: { 'Content-Type': 'audio/mpeg', 'request-id': `req_prueba_${siguienteId++}` } });
  }) as typeof fetch;
  try {
    return await fn(llamadas);
  } finally {
    globalThis.fetch = real;
    if (antes === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = antes;
    _reiniciarFrenoEleven();
    _olvidarSinEnlace();
    _vaciarCacheVoz();
    _vaciarHiloVoz();
  }
}

test('todo el turno con eleven_v4_turbo; el tono de la emoción en la primera frase, nunca en las demás', async () => {
  await conEleven(null, async (llamadas) => {
    const uno = await hablar({ dueno: 'ana@prueba.hn', texto: 'Claro que sí, José.', emocion: 'feliz', siguiente: 'Eso va muy bien.' });
    const dos = await hablar({ dueno: 'ana@prueba.hn', texto: 'Eso va muy bien.', emocion: 'feliz', previo: 'Claro que sí, José.' });
    assert.equal(uno?.motor, `elevenlabs:${MODELO_ELEVEN}`);
    assert.equal(dos?.motor, `elevenlabs:${MODELO_ELEVEN}`, 'mismo modelo: mismo timbre de la frase 1 a la 2');
    assert.deepEqual(
      llamadas.map((l) => l.cuerpo.model_id),
      [MODELO_ELEVEN, MODELO_ELEVEN]
    );
    assert.equal(llamadas[0].cuerpo.text, '[warmly] Claro que sí, José.', 'el tono va en la primera, ya con v4');
    assert.equal(llamadas[1].cuerpo.text, 'Eso va muy bien.', 'y no se repite en la segunda');
  });
});

test('en un turno serio, de dinero o legal, ninguna etiqueta', async () => {
  await conEleven(null, async (llamadas) => {
    await hablar({ dueno: 'ana@prueba.hn', texto: 'Lo siento mucho [suspiro].', emocion: 'triste' });
    await hablar({ dueno: 'ana@prueba.hn', texto: 'Te transfiero L. 1,500 hoy [risa].', emocion: 'feliz' });
    assert.equal(llamadas[0].cuerpo.text, 'Lo siento mucho.');
    assert.doesNotMatch(llamadas[1].cuerpo.text, /\[/, 'hablar de lempiras no se actúa');
    assert.match(llamadas[1].cuerpo.text, /mil quinientos lempiras/);
  });
});

test('los vecinos sin marcas y cortos (100), y los request-id de las frases anteriores enlazan el audio', async () => {
  await conEleven(null, async (llamadas) => {
    const larga = `Primero ${'mucho texto de relleno '.repeat(10)}y al final [risa] el cierre.`;
    await hablar({ dueno: 'ana@prueba.hn', texto: larga, emocion: 'feliz', siguiente: `[risa] Después ${'otra cosa larga '.repeat(12)}` });
    const c0 = llamadas[0].cuerpo;
    assert.ok(!c0.previous_text);
    assert.ok(c0.next_text.length <= 100 && !/\[/.test(c0.next_text), `next_text: ${c0.next_text}`);
    assert.match(c0.next_text, /^Después/);
    assert.ok(!c0.previous_request_ids, 'la primera no tiene a quién enlazar');
    // La segunda: el previo (el final de la primera, recortado) basta para reconocer el turno.
    await hablar({ dueno: 'ana@prueba.hn', texto: 'Y la segunda frase.', emocion: 'feliz', previo: larga });
    const c1 = llamadas[1].cuerpo;
    assert.ok(c1.previous_text.length <= 100 && !/\[/.test(c1.previous_text), `previous_text: ${c1.previous_text}`);
    assert.deepEqual(c1.previous_request_ids, ['req_prueba_' + (siguienteId - 2)]);
    await hablar({ dueno: 'ana@prueba.hn', texto: 'Tercera.', emocion: 'feliz', previo: 'Y la segunda frase.' });
    await hablar({ dueno: 'ana@prueba.hn', texto: 'Cuarta y última.', emocion: 'feliz', previo: 'Tercera.' });
    const ids = llamadas[3].cuerpo.previous_request_ids;
    assert.equal(ids.length, 3, 'como mucho 3, los más recientes y seguidos');
    assert.equal(ids[2], 'req_prueba_' + (siguienteId - 2));
  });
});

test('si el modelo rechaza los request-id, se reintenta sin ellos (con el texto vecino) y se recuerda', async () => {
  await conEleven(
    (l) => (l.cuerpo.previous_request_ids ? new Response('{"detail":"previous_request_ids not supported"}', { status: 400 }) : null),
    async (llamadas) => {
      await hablar({ dueno: 'ana@prueba.hn', texto: 'Una frase primera.', emocion: 'neutral' });
      const h = await hablar({ dueno: 'ana@prueba.hn', texto: 'La segunda.', emocion: 'neutral', previo: 'Una frase primera.' });
      assert.equal(h?.motor, `elevenlabs:${MODELO_ELEVEN}`, 'no se queda muda');
      assert.equal(llamadas.length, 3);
      assert.ok(llamadas[1].cuerpo.previous_request_ids);
      assert.ok(!llamadas[2].cuerpo.previous_request_ids);
      assert.equal(llamadas[2].cuerpo.previous_text, 'Una frase primera.');
      assert.equal(enlaceActivo(MODELO_ELEVEN), false, 'por un rato, solo previous_text');
    }
  );
});

test('si v4 falla a mitad del turno, el rápido de respaldo sin etiquetas, y el resto del turno sigue con él', async () => {
  await conEleven(
    (l) => (l.cuerpo.model_id === MODELO_ELEVEN && /Segunda/.test(l.cuerpo.text) ? new Response('caído', { status: 500 }) : null),
    async (llamadas) => {
      await hablar({ dueno: 'ana@prueba.hn', texto: 'Primera frase del turno.', emocion: 'feliz' });
      const dos = await hablar({ dueno: 'ana@prueba.hn', texto: 'Segunda [risa] frase.', emocion: 'feliz', previo: 'Primera frase del turno.' });
      assert.equal(dos?.motor, `elevenlabs:${MODELO_RESPALDO_OMISION}`);
      const flash = llamadas.find((l) => l.cuerpo.model_id === MODELO_RESPALDO_OMISION)!;
      assert.equal(flash.cuerpo.text, 'Segunda frase.', 'sin etiquetas: flash las leería en voz alta');
      assert.ok(!flash.cuerpo.previous_request_ids, 'los ids de v4 no enlazan con otro modelo');
      // La tercera ya no prueba v4: el turno sigue con la misma voz de respaldo.
      const tres = await hablar({ dueno: 'ana@prueba.hn', texto: 'Tercera frase.', emocion: 'feliz', previo: 'Segunda frase.' });
      assert.equal(tres?.motor, `elevenlabs:${MODELO_RESPALDO_OMISION}`);
      assert.equal(llamadas[llamadas.length - 1].cuerpo.model_id, MODELO_RESPALDO_OMISION);
      // Un turno nuevo (sin previo) vuelve a v4.
      const nuevo = await hablar({ dueno: 'ana@prueba.hn', texto: 'Otro turno.', emocion: 'feliz' });
      assert.equal(nuevo?.motor, `elevenlabs:${MODELO_ELEVEN}`);
    }
  );
});

test('si ElevenLabs cae a mitad del turno: Voicebox hasta el final y sin tomas grabadas pegadas entre frases en vivo', async () => {
  const vb = await voiceboxFalso();
  try {
    await conVoicebox(vb.url, CLAVE_FALSA, () =>
      conEleven(
        (l) => (/caer/.test(l.cuerpo.text) || /Luego/.test(l.cuerpo.text) ? new Response('caído', { status: 503 }) : null),
        async () => {
          const uno = await hablar({ dueno: 'ana@prueba.hn', texto: 'Hola, José.', emocion: 'feliz' });
          assert.equal(uno?.motor, `elevenlabs:${MODELO_ELEVEN}`);
          const dos = await hablar({ dueno: 'ana@prueba.hn', texto: 'Ay [risa] me voy a caer.', emocion: 'feliz', previo: 'Hola, José.' });
          assert.equal(dos?.motor, 'voicebox:kokoro', 'sin «+expresiones»: la risa grabada no se pega tras una frase en vivo');
          // La siguiente ni prueba ElevenLabs (el turno ya va con Voicebox).
          const tres = await hablar({ dueno: 'ana@prueba.hn', texto: 'Luego sigo.', emocion: 'feliz', previo: 'Ay, me voy a caer.' });
          assert.equal(tres?.motor, 'voicebox:kokoro');
        }
      )
    );
    // Un turno que empieza (y sigue) en Voicebox sí lleva sus tomas: no hay frase en vivo con la que coser.
    await conVoicebox(vb.url, CLAVE_FALSA, () =>
      conEleven(
        () => new Response('caído', { status: 503 }),
        async () => {
          const solo = await hablar({ dueno: 'ana@prueba.hn', texto: 'Ay [risa] qué bueno.', emocion: 'feliz' });
          assert.equal(solo?.motor, 'voicebox:kokoro+expresiones');
        }
      )
    );
  } finally {
    await vb.cerrar();
  }
});

test('el PCM del teléfono sigue el mismo turno: mismo modelo, ids y respaldo', async () => {
  await conEleven(null, async (llamadas) => {
    const uno = await abrirVozPcm({ dueno: 'ana@prueba.hn', texto: 'Hola, José.', emocion: 'feliz', hz: 22050 });
    assert.equal(uno?.tipo, 'vivo');
    if (uno?.tipo === 'vivo') uno.guardar(Buffer.alloc(4000));
    await abrirVozPcm({ dueno: 'ana@prueba.hn', texto: 'Te cuento algo.', emocion: 'feliz', previo: 'Hola, José.', hz: 22050 });
    assert.equal(llamadas[0].cuerpo.model_id, MODELO_ELEVEN);
    assert.equal(llamadas[0].cuerpo.text, '[warmly] Hola, José.');
    assert.equal(llamadas[1].cuerpo.text, 'Te cuento algo.');
    assert.deepEqual(llamadas[1].cuerpo.previous_request_ids, ['req_prueba_' + (siguienteId - 2)], 'el id, cuando el audio llegó entero');
  });
});

test('el cuerpo: vecinos sin marcas y en palabras enteras; ids solo válidos y como mucho 3', () => {
  const c = cuerpoEleven({ texto: 'Hola.', voz: 'v', previo: `[risa] ${'palabra '.repeat(30)}fin [suspiro].`, siguiente: '[EMO:feliz] Después [1] viene.', previosIds: ['a', 'req_1234567', 'req_2234567', 'req_3234567', 'req_4234567'] });
  assert.ok(String(c.previous_text).length <= 100);
  assert.match(String(c.previous_text), /^palabra .* fin\.$/);
  assert.equal(c.next_text, 'Después [1] viene.', 'un [1] no es una marca');
  assert.deepEqual(c.previous_request_ids, ['req_2234567', 'req_3234567', 'req_4234567']);
  assert.equal(idDePedido({ headers: { get: () => 'req_abc123' } }), 'req_abc123');
  assert.equal(idDePedido({ headers: { get: () => 'no válido!' } }), undefined);
  assert.ok(!cuerpoEleven({ texto: 'x', voz: 'v', modelo: 'eleven_v3', previosIds: ['req_1234567'] }).previous_request_ids, 'v3 no enlaza por ids');
});

test('el hilo: reconoce la frase de antes por su final y no inventa cadenas', () => {
  const h = new HiloVoz();
  const a = h.anotar('ultron|aura|es|', 'Hola, ¿cómo estás, José?', 'v4', MODELO_ELEVEN, null);
  assert.equal(h.buscar('ultron|aura|es|', 'cómo estás José'), a);
  assert.equal(h.buscar('ultron|claudio|es|', 'cómo estás José'), null, 'otra voz, otro turno');
  assert.equal(h.buscar('ultron|aura|es|', 'hola'), null, 'muy corto para reconocerlo');
  assert.equal(h.idsPara(a, MODELO_ELEVEN), undefined, 'sin su id todavía, no se enlaza');
  a.id = 'req_a';
  const b = h.anotar('ultron|aura|es|', 'Bien.', 'v4', MODELO_ELEVEN, a);
  assert.deepEqual(h.idsPara(a, MODELO_ELEVEN), ['req_a']);
  assert.equal(h.idsPara(a, MODELO_RESPALDO_OMISION), undefined, 'otro modelo no enlaza');
  assert.deepEqual(b.antes, ['req_a']);
  assert.equal(normalizarFrase('¡Ay [risa], José!'), 'ay jose');
});

test('los agentes de la llamada (scripts/elevenlabs-agentes.ts): v4 Turbo, estabilidad 0,45 y sin respaldo silencioso', async () => {
  const A = await import('../scripts/elevenlabs-agentes');
  assert.equal(A.MODELO_TTS_AGENTE, MODELO_ELEVEN);
  const c = A.configAgente('aura', 'es', 'sec_prueba');
  assert.deepEqual(c.conversation_config.tts, { model_id: MODELO_ELEVEN, voice_id: c.conversation_config.tts.voice_id, stability: 0.45 });
  assert.match(A.modeloRechazado('AU-RA FP · AU-RA (es)', MODELO_ELEVEN, 422).message, /rechazó el modelo eleven_v4_turbo \(422\)\. No se usa otro/);
});

test('el hilo de la voz es de UNA cuenta: la misma frase de otra persona no enlaza su turno (revisión del PR #173)', () => {
  const h = new HiloVoz();
  h.anotar('ana@prueba.hn|ultron|aura|es|', 'Claro que sí.', 'respaldo', '', null);
  assert.equal(h.buscar('beto@prueba.hn|ultron|aura|es|', 'Claro que sí.'), null, 'otra cuenta: nada');
  assert.ok(h.buscar('ana@prueba.hn|ultron|aura|es|', 'Claro que sí.'), 'la misma cuenta: su frase');
  h.anotar('', 'Sin cuenta.', 'v4', 'eleven_v4_turbo', null);
  assert.equal(h.buscar('', 'Sin cuenta.'), null, 'sin cuenta no entra al hilo');
});
