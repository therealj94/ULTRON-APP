/**
 * La voz de Dr Electrum con ElevenLabs v4 Turbo y Voicebox detrás (server/eleven.ts), y el oído
 * con Scribe primero (lib/oido.ts). ElevenLabs se finge interceptando `fetch`; Voicebox es el de
 * mentira de siempre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { guionEleven, pausaPorFallo, VOZ_ELECTRUM_ELEVEN, VOCES_ELEVEN, vozEleven, _reiniciarFrenoEleven, elevenListo } from '../server/eleven';
import { abrirVozEnVivo, expresar, hablar } from '../server/voz';
import { PROVEEDORES_OIDO, PROVEEDORES_OIDO_ELECTRUM, transcribirAudio, topeScribe, RESERVA_RESPALDO_MS } from '../lib/oido';
import { presupuesto, PRESUPUESTO_OIDO_MS, MINIMO_UTIL_MS } from '../lib/presupuesto';
import { voiceboxFalso, conVoicebox, CLAVE_FALSA } from './voicebox-falso';

const preparar = (t: string) => expresar(t, 'neutral', 'speak', { cifras: false });

type Llamada = { url: string; cuerpo: any; clave: string | null };

/** Intercepta lo que va a api.elevenlabs.io; lo demás (el Voicebox falso) pasa. */
async function conEleven<T>(responder: (url: string, cuerpo: any) => Response, fn: (llamadas: Llamada[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const antes = process.env.ELEVENLABS_API_KEY;
  const llamadas: Llamada[] = [];
  process.env.ELEVENLABS_API_KEY = 'xi-de-prueba';
  _reiniciarFrenoEleven();
  globalThis.fetch = (async (entrada: any, init?: any) => {
    const url = String(entrada?.url || entrada);
    if (!url.startsWith('https://api.elevenlabs.io/')) return real(entrada, init);
    const cuerpo = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    llamadas.push({ url, cuerpo, clave: init?.headers?.['xi-api-key'] ?? null });
    return responder(url, cuerpo);
  }) as typeof fetch;
  try {
    return await fn(llamadas);
  } finally {
    globalThis.fetch = real;
    if (antes === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = antes;
    _reiniciarFrenoEleven();
  }
}

const mp3 = () => new Response(new Uint8Array(4000).fill(0xff), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });

test('el guion: el tono de la emoción delante, las marcas en español pasadas a v4, las cifras para v4', () => {
  const g = guionEleven('Buenas tardes, José. [mmm] Tiene 3,4 g/t en 1.250 ha. [risa] Dr Electrum le arma la ficha.', 'feliz', preparar);
  assert.equal(g, '[warmly] Buenas tardes, José. [thoughtful] Tiene 3,4 gramos por tonelada en 1.250 hectáreas. [laughs] Doctor Electrum le arma la ficha.');
  // Sereno no lleva etiqueta: una en cada frase suena actuada.
  assert.equal(guionEleven('Hay 206 concesiones.', 'neutral', preparar), 'Hay 206 concesiones.');
  // Las que no suman se quitan, las pausas son puntos suspensivos, las de la oración (en inglés) quedan.
  assert.equal(guionEleven('Listo [beso]. [pausa] Sigo.', 'neutral', preparar), 'Listo.... Sigo.');
  assert.equal(guionEleven('[softly, reverent] Amén.', 'oracion', preparar), '[softly, reverent] Amén.');
  // Una etiqueta desconocida en español no se lee en voz alta.
  assert.equal(guionEleven('Mire [carcajada estruendosa] esto.', 'neutral', preparar), 'Mire esto.');
  // Sin palabras no hay nada que decir.
  assert.equal(guionEleven('[risa] [suspiro]', 'feliz', preparar), '');
  // Como mucho cuatro etiquetas por trozo.
  const muchas = guionEleven('a [risa] b [risa] c [risa] d [risa] e [risa] f', 'neutral', preparar);
  assert.equal((muchas.match(/\[laughs\]/g) || []).length, 4);
});

test('la voz: Jorge para Dr Electrum; AU-RA con su voz v4 propia', () => {
  const antes = { e: process.env.ELEVENLABS_VOZ_ELECTRUM, a: process.env.ELEVENLABS_VOZ_AURA };
  delete process.env.ELEVENLABS_VOZ_ELECTRUM;
  delete process.env.ELEVENLABS_VOZ_AURA;
  try {
    assert.equal(vozEleven('electrum'), VOZ_ELECTRUM_ELEVEN);
    assert.equal(vozEleven('ultron'), VOCES_ELEVEN.aura.es);
    process.env.ELEVENLABS_VOZ_ELECTRUM = 'otra-voz';
    assert.equal(vozEleven('electrum'), 'otra-voz');
  } finally {
    for (const [k, v] of [['ELEVENLABS_VOZ_ELECTRUM', antes.e], ['ELEVENLABS_VOZ_AURA', antes.a]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('Dr Electrum habla con v4 Turbo, con los vecinos para enlazar la entonación', async () => {
  const vb = await voiceboxFalso();
  try {
    await conVoicebox(vb.url, CLAVE_FALSA, () =>
      conEleven(
        () => mp3(),
        async (llamadas) => {
          const h = await hablar({ texto: 'Buenas tardes, José.', emocion: 'feliz', plataforma: 'electrum', sinCache: true, previo: 'Antes.', siguiente: 'Después.' });
          assert.equal(h?.motor, 'elevenlabs:eleven_v4_turbo');
          assert.equal(h?.contentType, 'audio/mpeg');
          assert.equal(llamadas.length, 1);
          assert.match(llamadas[0].url, new RegExp(`/text-to-speech/${VOZ_ELECTRUM_ELEVEN}/stream\\?output_format=mp3_44100_96$`));
          assert.equal(llamadas[0].clave, 'xi-de-prueba');
          assert.equal(llamadas[0].cuerpo.model_id, 'eleven_v4_turbo');
          assert.equal(llamadas[0].cuerpo.language_code, 'es');
          // Con frase antes (`previo`), sin el tono: va solo en la primera de la respuesta (auditoría, 1-oct).
          assert.equal(llamadas[0].cuerpo.text, 'Buenas tardes, José.');
          assert.equal(llamadas[0].cuerpo.previous_text, 'Antes.');
          assert.equal(llamadas[0].cuerpo.next_text, 'Después.');
          assert.equal(vb.pedidos.filter((p) => p.ruta.startsWith('POST /generate')).length, 0, 'Voicebox ni se entera');
          // La segunda vez, con los mismos vecinos, sale de la caché: ni un crédito más.
          const otra = await hablar({ texto: 'Buenas tardes, José.', emocion: 'feliz', plataforma: 'electrum', previo: 'Antes.', siguiente: 'Después.' });
          assert.equal(otra?.cache, true);
          assert.equal(llamadas.length, 1);
          // Con otros vecinos la entonación es otra: se vuelve a pedir.
          const distinta = await hablar({ texto: 'Buenas tardes, José.', emocion: 'feliz', plataforma: 'electrum', previo: 'Otra cosa.' });
          assert.equal(distinta?.cache, false);
          assert.equal(llamadas.length, 2);
        }
      )
    );
  } finally {
    await vb.cerrar();
  }
});

test('si ElevenLabs falla, habla Voicebox; sin cupo, se deja de intentar un rato', async () => {
  const vb = await voiceboxFalso();
  try {
    await conVoicebox(vb.url, CLAVE_FALSA, () =>
      conEleven(
        () => new Response('{"detail":{"status":"quota_exceeded"}}', { status: 401 }),
        async (llamadas) => {
          const h = await hablar({ texto: 'Hay 206 concesiones.', plataforma: 'electrum', sinCache: true });
          assert.equal(h?.motor, 'voicebox:kokoro', 'el respaldo contesta');
          assert.equal(llamadas.length, 1);
          assert.equal(elevenListo(), false, 'en pausa');
          const h2 = await hablar({ texto: 'Otra cosa distinta.', plataforma: 'electrum', sinCache: true });
          assert.equal(h2?.motor, 'voicebox:kokoro');
          assert.equal(llamadas.length, 1, 'no se vuelve a pedir durante la pausa');
          // Voicebox recibe las cifras en palabras, como siempre.
          const alVoicebox = vb.pedidos.filter((p) => p.ruta.startsWith('POST /generate')).map((p) => p.cuerpo.text);
          assert.match(alVoicebox[0], /doscient\w+ seis/);
        }
      )
    );
  } finally {
    await vb.cerrar();
  }
  assert.equal(pausaPorFallo(429, ''), 30_000);
  assert.equal(pausaPorFallo(500, 'error'), 0, 'un fallo pasajero no frena');
});

test('AU-RA FP habla con ElevenLabs: la voz del avatar y del idioma elegidos; Voicebox queda de respaldo', async () => {
  const vb = await voiceboxFalso();
  try {
    await conVoicebox(vb.url, CLAVE_FALSA, async () => {
      await conEleven(
        () => mp3(),
        async (llamadas) => {
          const h = await hablar({ texto: 'Hola, soy Aura.', plataforma: 'ultron', sinCache: true });
          assert.equal(h?.motor, 'elevenlabs:eleven_v4_turbo');
          assert.equal(llamadas.length, 1);
          assert.ok(llamadas[0].url.includes(`/text-to-speech/${VOCES_ELEVEN.aura.es}/`));
          assert.equal(llamadas[0].cuerpo.language_code, 'es');
          const en = await hablar({ texto: 'Hi, I am your guardian. It is 25 degrees.', plataforma: 'ultron', avatar: 'ojos', idioma: 'en', sinCache: true });
          assert.equal(en?.motor, 'elevenlabs:eleven_v4_turbo');
          assert.ok(llamadas[1].url.includes(`/text-to-speech/${VOCES_ELEVEN.ojos.en}/`));
          assert.equal(llamadas[1].cuerpo.language_code, 'en');
          // En inglés las cifras no se vuelven palabras en español.
          assert.match(llamadas[1].cuerpo.text, /25 degrees/);
        }
      );
      // Si ElevenLabs no contesta, sigue hablando con Voicebox.
      await conEleven(
        () => new Response('caído', { status: 503 }),
        async () => {
          const h = await hablar({ texto: 'Sigo aquí.', plataforma: 'ultron', sinCache: true });
          assert.equal(h?.motor, 'voicebox:kokoro');
        }
      );
    });
  } finally {
    await vb.cerrar();
  }
});

test('el oído: Scribe primero en Dr Electrum (vocabulario minero) y en AU-RA (sus apps y avatares), Whisper de respaldo', async () => {
  assert.deepEqual(PROVEEDORES_OIDO_ELECTRUM.map((p) => p.nombre), ['elevenlabs', 'voicebox', 'gemini']);
  assert.deepEqual(PROVEEDORES_OIDO.map((p) => p.nombre), ['elevenlabs', 'voicebox', 'gemini'], 'AU-RA también: Scribe primero (José, 1-oct)');
  const vb = await voiceboxFalso({ transcripcion: () => ({ texto: 'lo oyó whisper' }) });
  const audio = Buffer.alloc(2000, 1);
  try {
    await conVoicebox(vb.url, CLAVE_FALSA, async () => {
      await conEleven(
        () => new Response(JSON.stringify({ text: 'Concordia seis en Olancho' }), { status: 200 }),
        async (llamadas) => {
          const o = await transcribirAudio({ audio, mime: 'audio/webm', language: 'es', plataforma: 'electrum' });
          assert.equal(o.via, 'elevenlabs:scribe');
          assert.equal(o.texto, 'Concordia seis en Olancho');
          const form = llamadas[0].cuerpo as FormData;
          assert.equal(form.get('model_id'), 'scribe_v2');
          assert.ok(form.getAll('keyterms').includes('INHGEOMIN'));
          // AU-RA también oye con Scribe, pero con SUS pistas (apps y avatares), no las del oficio minero.
          const a = await transcribirAudio({ audio, mime: 'audio/webm', language: 'es' });
          assert.equal(a.via, 'elevenlabs:scribe');
          assert.equal(llamadas.length, 2);
          const formAura = llamadas[1].cuerpo as FormData;
          assert.equal(formAura.get('model_id'), 'scribe_v2');
          assert.ok(formAura.getAll('keyterms').includes('Spotify') && formAura.getAll('keyterms').includes('AU-RA'));
          assert.ok(!formAura.getAll('keyterms').includes('INHGEOMIN'));
          assert.ok(formAura.getAll('keyterms').length < 100, 'menos de 100 pistas: con más, ElevenLabs cobra 20 s mínimo');
        }
      );
      await conEleven(
        () => new Response('caído', { status: 503 }),
        async () => {
          const o = await transcribirAudio({ audio, mime: 'audio/webm', language: 'es', plataforma: 'electrum' });
          assert.equal(o.via, 'voicebox:whisper', 'si Scribe falla, oye Whisper');
          assert.equal(o.texto, 'lo oyó whisper');
        }
      );
    });
  } finally {
    await vb.cerrar();
  }
});

test('si Scribe se cuelga, el respaldo todavía alcanza a oír dentro del presupuesto de /api/stt', async () => {
  // El tope de Scribe deja sitio al respaldo: con los 15 s de /api/stt, Scribe tiene 10 y quedan 5.
  assert.equal(topeScribe(presupuesto(PRESUPUESTO_OIDO_MS, () => 0)), PRESUPUESTO_OIDO_MS - RESERVA_RESPALDO_MS);
  assert.equal(topeScribe(presupuesto(60_000, () => 0)), 15000, 'sin apuro (Telegram): sus 15 s de siempre');
  assert.equal(topeScribe(presupuesto(3000, () => 0)), MINIMO_UTIL_MS, 'con poco tiempo: nunca menos del mínimo útil');
  const vb = await voiceboxFalso({ transcripcion: () => ({ texto: 'lo oyó whisper' }) });
  const real = globalThis.fetch;
  const antes = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = 'xi-de-prueba';
  // Scribe no contesta nunca: solo suelta cuando le cortan la señal.
  globalThis.fetch = (async (entrada: any, init?: any) => {
    const url = String(entrada?.url || entrada);
    if (!url.startsWith('https://api.elevenlabs.io/')) return real(entrada, init);
    return new Promise<Response>((_, rechazar) => init?.signal?.addEventListener('abort', () => rechazar(init.signal.reason)));
  }) as typeof fetch;
  try {
    await conVoicebox(vb.url, CLAVE_FALSA, async () => {
      const t0 = Date.now();
      const reloj = presupuesto(4000);
      const o = await transcribirAudio({ audio: Buffer.alloc(2000, 1), mime: 'audio/webm', language: 'es', presupuesto: reloj });
      assert.equal(o.via, 'voicebox:whisper', 'Scribe colgado: oye Whisper antes de que se acabe el tiempo');
      assert.equal(o.texto, 'lo oyó whisper');
      assert.ok(Date.now() - t0 < 4000, `dentro del presupuesto (${Date.now() - t0} ms)`);
    });
  } finally {
    globalThis.fetch = real;
    if (antes === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = antes;
    await vb.cerrar();
  }
});

test('en vivo: el audio llega mientras se genera y al final queda en la caché; si falla, null (Voicebox)', async () => {
  const pedazos = [new Uint8Array(300).fill(1), new Uint8Array(300).fill(2)];
  const enCurso = () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          for (const p of pedazos) c.enqueue(p);
          c.close();
        },
      }),
      { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }
    );
  await conEleven(
    () => enCurso(),
    async (llamadas) => {
      const pedido = { texto: 'Una frase en vivo.', plataforma: 'electrum' as const, previo: 'Antes.' };
      const v = await abrirVozEnVivo(pedido);
      assert.equal(v?.tipo, 'vivo');
      if (v?.tipo !== 'vivo') return;
      assert.equal(v.motor, 'elevenlabs:eleven_v4_turbo');
      const lector = v.cuerpo.getReader();
      const recibido: Buffer[] = [];
      for (;;) {
        const { done, value } = await lector.read();
        if (done) break;
        recibido.push(Buffer.from(value));
      }
      assert.equal(recibido.length, 2, 'llegó por pedazos');
      v.guardar(Buffer.concat(recibido));
      // Lo guardado sirve igual para la ruta en vivo y para hablar(): ni un crédito más.
      const otra = await abrirVozEnVivo(pedido);
      assert.equal(otra?.tipo, 'cache');
      const h = await hablar(pedido);
      assert.equal(h?.cache, true);
      assert.equal(h?.audio.length, 600);
      assert.equal(llamadas.length, 1);
    }
  );
  await conEleven(
    () => new Response('caído', { status: 503 }),
    async () => {
      assert.equal(await abrirVozEnVivo({ texto: 'Otra frase.', plataforma: 'electrum' }), null);
    }
  );
});


test('muletillas: son deterministas, solo en frases largas y no en la oración', async () => {
  const { conMuletillas } = await import('../server/eleven');
  const corta = 'Hay 206 concesiones.';
  assert.equal(conMuletillas(corta, { primero: true }), corta);
  const larga = 'La concesión Los Almendros tiene doscientas hectáreas, y el expediente dice que se otorgó en dos mil diez para oro y plata en Olancho.';
  assert.equal(conMuletillas(larga, { primero: true }), conMuletillas(larga, { primero: true }));
  assert.equal(conMuletillas(larga, { primero: true, emocion: 'oracion' }), larga);
  // Lo que ya arranca suelto no se duplica.
  const suelta = 'Bueno, la concesión Los Almendros tiene doscientas hectáreas y vence el año que viene en diciembre.';
  assert.ok(!/^(Mire|A ver|Pues|Eh|Mmm|Fíjese|Vea|Bueno), Bueno/.test(conMuletillas(suelta, { primero: true })));
  assert.ok(conMuletillas(suelta, { primero: true }).startsWith('Bueno, la concesión'));
});

test('muletillas: en muchas frases distintas, algunas arrancan con muletilla y el trozo siguiente nunca', async () => {
  const { conMuletillas } = await import('../server/eleven');
  let con = 0;
  for (let i = 0; i < 60; i++) {
    const t = `La concesión número ${i} está en el municipio de Juticalpa, con un área de ${100 + i} hectáreas medidas sobre el elipsoide.`;
    if (conMuletillas(t, { primero: true }) !== t && !conMuletillas(t, { primero: true }).startsWith('La concesión')) con++;
    assert.ok(conMuletillas(t, { primero: false }).startsWith('La concesión'));
  }
  assert.ok(con > 5 && con < 45, `con muletilla: ${con}`);
});
