import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { expresar, cancionPorPedido, vozDe, hablar, notaDeVozBuffer, sinEtiquetas, estadoVoz, PERFIL_AURA, PERFIL_ELECTRUM } from '../server/voz';
import { PALETA, EMOCION_INFO, instruccionEmocion, normalizarEmocion } from '../lib/emocion';
import { CARA_POR_EMOCION } from '../src/02-cara/emocion';
import { duracionWav } from '../lib/mp3';
import { voiceboxFalso, conVoicebox, CLAVE_FALSA, wavDePrueba } from './voicebox-falso';

test('expresar no deja etiquetas de audio: Kokoro las leería en voz alta', () => {
  const t = expresar('[softly] Hola. [short pause] [singing, slow worship ballad, tender] Qué bueno verte. [laughs]', 'feliz');
  assert.equal(t, 'Hola. Qué bueno verte.');
  assert.ok(!/\[|\]/.test(expresar('Je je, el oro subió 5000 dólares.', 'feliz')));
});

test('expresar pone las cifras en palabras y no inventa etiquetas por la emoción', () => {
  const t = expresar('El oro subió 5000 dólares.', 'feliz');
  assert.ok(!/5000/.test(t), 'las cifras van en palabras');
  assert.match(t, /cinco mil/);
  assert.ok(!/\[/.test(expresar('Suave y con calma.', 'carino')), 'la emoción ya no añade etiquetas');
});

test('en canto el texto se dice igual: Kokoro no canta', () => {
  assert.equal(expresar('quiero conocer a Jesús', 'canto', 'sing'), 'quiero conocer a Jesús');
});

test('un guion largo con etiquetas se respeta entero, sin etiquetas', () => {
  const g = `[softly, reverent] Cierro los ojos. ${'Bendice este día. '.repeat(90)}[short pause] En el nombre de Jesús... [softly, firmly] Amén.`;
  const t = expresar(g, 'oracion');
  assert.ok(t.length > 1200, 'no se corta a lo de una respuesta');
  assert.ok(t.startsWith('Cierro los ojos.'), t.slice(0, 40));
  assert.ok(t.endsWith('En el nombre de Jesús... Amén.'), t.slice(-40));
  assert.ok(!/\[/.test(t));
});

test('sinEtiquetas no deja espacios delante de la puntuación', () => {
  assert.equal(sinEtiquetas('Ay, no [laughs]. ¿En serio [surprised]? [curious] Contame más.'), 'Ay, no. ¿En serio? Contame más.');
  assert.equal(sinEtiquetas('¡ [warmly] Hola!'), '¡Hola!');
});

test('el repertorio se reconoce en lenguaje natural', () => {
  assert.equal(cancionPorPedido('canta quiero conocer a Jesús')?.id, 'jesus');
  assert.equal(cancionPorPedido('cantame la de Generación 12')?.id, 'jesus');
  assert.equal(cancionPorPedido('canta 1')?.id, 'bohemian');
  assert.equal(cancionPorPedido('cantá way maker')?.id, 'waymaker');
  assert.equal(cancionPorPedido('cantame algo en inglés')?.id, 'waymaker');
  assert.equal(cancionPorPedido('canta la de Medardo')?.id, 'bittersweet');
  assert.equal(cancionPorPedido('canta algo de salsa'), null);
});

describe('cada plataforma con su voz', () => {
  function conPerfiles(aura: string | undefined, electrum: string | undefined, fn: () => void) {
    const antes = { a: process.env.VOICEBOX_PERFIL_AURA, e: process.env.VOICEBOX_PERFIL_ELECTRUM };
    const poner = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
    poner('VOICEBOX_PERFIL_AURA', aura);
    poner('VOICEBOX_PERFIL_ELECTRUM', electrum);
    try {
      fn();
    } finally {
      poner('VOICEBOX_PERFIL_AURA', antes.a);
      poner('VOICEBOX_PERFIL_ELECTRUM', antes.e);
    }
  }

  it('AU-RA habla con Dora y Dr Electrum con Alex, sin configurar nada', () => {
    // El respaldo del Doctor NO es la voz de AU-RA a propósito: dos cerebros con la misma voz son
    // la misma cosa con dos nombres, y descubrirlo delante de un cliente es tarde.
    conPerfiles(undefined, undefined, () => {
      assert.equal(vozDe('ultron'), '0014442b-51e6-44f5-9a35-f0e1ed296da5', 'AU-RA · Kokoro Dora');
      assert.equal(vozDe('electrum'), 'c4259ed3-f15c-4fe7-a20c-6c59c877cf5c', 'Electrum · Kokoro Alex');
      assert.notEqual(vozDe('electrum'), vozDe('ultron'));
    });
  });

  it('las variables mandan sobre el respaldo, cada una sobre su plataforma', () => {
    conPerfiles(undefined, 'perfil-nuevo-del-doctor', () => {
      assert.equal(vozDe('electrum'), 'perfil-nuevo-del-doctor');
      assert.equal(vozDe('ultron'), PERFIL_AURA, 'cambiar la del Doctor no toca la de AU-RA');
    });
    conPerfiles('perfil-nuevo-de-aura', undefined, () => {
      assert.equal(vozDe('ultron'), 'perfil-nuevo-de-aura');
      assert.equal(vozDe('electrum'), PERFIL_ELECTRUM);
    });
  });

  it('una variable en blanco o con espacios no deja mudo a nadie', () => {
    conPerfiles('   ', '', () => {
      assert.equal(vozDe('electrum'), PERFIL_ELECTRUM);
      assert.equal(vozDe('ultron'), PERFIL_AURA);
    });
  });
});

describe('hablar contra Voicebox', () => {
  it('sin VOICEBOX_URL devuelve null sin romper', async () => {
    await conVoicebox(undefined, CLAVE_FALSA, async () => {
      assert.equal(await hablar({ texto: 'Hola, jefe. Nadie me configuró.', sinCache: true }), null);
      assert.equal(estadoVoz().voicebox, false);
    });
  });

  it('cada plataforma pide su perfil, en español y con Kokoro, sin etiquetas', async (t) => {
    const vb = await voiceboxFalso();
    t.after(() => vb.cerrar());
    await conVoicebox(vb.url, CLAVE_FALSA, async () => {
      const aura = await hablar({ texto: '[softly] Hola. [short pause] Soy AU-RA.', emocion: 'carino', plataforma: 'ultron' });
      const doc = await hablar({ texto: '[softly] Hola. [short pause] Soy AU-RA.', emocion: 'carino', plataforma: 'electrum' });
      assert.ok(aura && doc);
      assert.equal(vb.pedidos.length, 2, 'la voz entra en la caché: el Doctor no recibe el audio de AU-RA');
      const [p1, p2] = vb.pedidos;
      assert.equal(p1.ruta, 'POST /generate/stream');
      assert.equal(p1.clave, CLAVE_FALSA);
      assert.deepEqual(p1.cuerpo, { profile_id: PERFIL_AURA, text: 'Hola. Soy Aura.', language: 'es', engine: 'kokoro' });
      assert.equal(p2.cuerpo.profile_id, PERFIL_ELECTRUM);
      assert.equal(aura!.contentType, 'audio/wav');
      assert.equal(aura!.motor, 'voicebox:kokoro');
      assert.ok(duracionWav(aura!.audio) > 0.4, 'WAV de verdad');
      assert.equal(estadoVoz().voicebox, true);
      assert.equal(estadoVoz().servidor, new URL(vb.url).host);

      // Mismo texto, misma voz, otra emoción: sale de la caché (la emoción ya no cambia el audio).
      const otra = await hablar({ texto: '[softly] Hola. [short pause] Soy AU-RA.', emocion: 'feliz', plataforma: 'ultron' });
      assert.equal(otra?.cache, true);
      assert.equal(vb.pedidos.length, 2);
    });
  });

  it('si Voicebox falla, calla: null, no otra voz', async (t) => {
    const vb = await voiceboxFalso({ voz: () => ({ status: 500, texto: 'Internal Server Error' }) });
    t.after(() => vb.cerrar());
    await conVoicebox(vb.url, CLAVE_FALSA, async () => {
      assert.equal(await hablar({ texto: 'Esto no va a sonar.', sinCache: true }), null);
    });
    await conVoicebox(vb.url, 'llave-equivocada', async () => {
      assert.equal(await hablar({ texto: 'Esto tampoco.', sinCache: true }), null);
      assert.equal(vb.pedidos.at(-1)?.clave, 'llave-equivocada');
    });
  });

  it('un 200 que no es audio no se hace pasar por voz', async (t) => {
    const vb = await voiceboxFalso({ voz: () => ({ status: 200, tipo: 'text/html', texto: '<html>'.padEnd(400, 'x') }) });
    t.after(() => vb.cerrar());
    await conVoicebox(vb.url, CLAVE_FALSA, async () => {
      assert.equal(await hablar({ texto: 'Un proxy contesta por su cuenta.', sinCache: true }), null);
    });
  });

  it('la nota de voz para Telegram sale en MP3', async (t) => {
    const vb = await voiceboxFalso({ voz: () => ({ audio: wavDePrueba(1.5) }) });
    t.after(() => vb.cerrar());
    await conVoicebox(vb.url, CLAVE_FALSA, async () => {
      const mp3 = await notaDeVozBuffer('Jefe, el sistema está en pie.');
      assert.ok(mp3 && mp3.length > 1000);
      // Cabecera de trama MPEG (0xFFE sincronía), no «RIFF»: sendVoice no acepta WAV.
      assert.equal(mp3![0], 0xff);
      assert.equal(mp3![1] & 0xe0, 0xe0);
      assert.notEqual(mp3!.toString('ascii', 0, 4), 'RIFF');
    });
  });
});

describe('el texto que recibe la voz', () => {
  // La voz LEE la puntuación: un punto de más o una coma huérfana se oyen.
  it('no deja cuatro puntos donde van tres', () => {
    for (const t of [expresar('Mmm. Ya veo.', 'neutral'), expresar('Déjame ver.', 'neutral'), expresar('Un segundo.', 'neutral')]) {
      assert.ok(!/\.{4,}/.test(t), t);
      assert.ok(/\.\.\./.test(t), t);
    }
  });

  it('respeta la mayúscula de una frase que empieza con la muletilla', () => {
    assert.match(expresar('Un segundo.', 'neutral'), /Un segundo\.\.\./);
    assert.match(expresar('Déjame ver.', 'neutral'), /Déjame ver\.\.\./);
  });

  it('los dos puntos y la raya dan pausa sin partir la frase', () => {
    // Antes esto era un punto, y dejaba «Vamos por partes. primero el derecho»: la voz lee ahí un
    // fin de frase que la gramática no tiene y suena a alguien que se corta a media idea.
    const t = expresar('Vamos por partes: primero el derecho.', 'neutral');
    assert.match(t, /partes, primero/, t);
    assert.ok(!/\.\s+[a-záéíóúñ]/.test(t), `punto seguido de minúscula: ${t}`);
    assert.match(expresar('Bien —muy bien— seguimos.', 'neutral'), /Bien, muy bien, seguimos\./);
  });
});

describe('cada cerebro con su paleta de emociones', () => {
  it('Dr Electrum tiene MENOS emociones que AU-RA, no más', () => {
    // Es la parte contraintuitiva y es a propósito: un 27B con quince opciones delante elige peor
    // que uno con once. Si esta prueba empieza a fallar porque alguien le sumó emociones al
    // doctor «para que tenga más», el que pierde es el doctor.
    assert.ok(PALETA.electrum.length < PALETA.ultron.length);
  });

  it('al doctor no se le ofrece cantar, orar ni hacer travesuras', () => {
    for (const e of ['canto', 'oracion', 'travieso'] as const) {
      assert.ok(!PALETA.electrum.includes(e), `${e} no le toca a Dr Electrum`);
    }
  });

  it('AU-RA no cambió: sigue con las quince de siempre', () => {
    assert.equal(PALETA.ultron.length, 15);
    for (const e of ['canto', 'oracion', 'travieso', 'triste'] as const) assert.ok(PALETA.ultron.includes(e));
  });

  it('las cuatro del oficio existen, y la cara y la voz saben expresarlas', () => {
    for (const e of ['escepticismo', 'alarma', 'firme', 'seco'] as const) {
      assert.ok(PALETA.electrum.includes(e), `${e} le falta al doctor`);
      assert.ok(EMOCION_INFO[e].cuando.length > 10, `${e} sin descripción de cuándo usarla`);
      assert.ok(CARA_POR_EMOCION[e], `${e} sin cara`);
    }
  });

  it('el prompt de cada uno lleva su lista y sus ejemplos, no los del otro', () => {
    const e = instruccionEmocion('electrum');
    const u = instruccionEmocion('ultron');
    assert.match(e, /escepticismo/);
    assert.ok(!/oracion|travieso/.test(e), 'al doctor no se le nombran emociones que no tiene');
    assert.match(e, /inferido no es una reserva/, 'los ejemplos enseñan el registro, no solo la sintaxis');
    assert.match(u, /oracion/);
    assert.ok(!/escepticismo/.test(u), 'AU-RA no cambió');
  });

  it('el modelo puede escribirlas de varias formas y se entienden igual', () => {
    for (const [dicho, esperado] of [
      ['esceptico', 'escepticismo'],
      ['SKEPTICAL', 'escepticismo'],
      ['peligro', 'alarma'],
      ['tajante', 'firme'],
      ['sobrio', 'seco'],
    ] as const) {
      assert.equal(normalizarEmocion(dicho), esperado, dicho);
    }
  });
});

test('«AU-RA» se dice «Aura»: la voz no deletrea el nombre', () => {
  const t = expresar('Soy AU-RA, de AU-RA FP.', 'feliz');
  assert.ok(!/AU-RA/.test(t), t);
  assert.equal((t.match(/Aura/g) || []).length, 2, t);
});
