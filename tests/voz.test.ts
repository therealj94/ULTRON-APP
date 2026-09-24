import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { expresar, cancionPorPedido, vozDe } from '../server/voz';
import { PALETA, EMOCION_INFO, instruccionEmocion, normalizarEmocion } from '../lib/emocion';
import { CARA_POR_EMOCION } from '../src/02-cara/emocion';

test('expresar añade la etiqueta de la emoción y convierte risas escritas en risa real', () => {
  const t = expresar('Je je, el oro subió 5000 dólares.', 'feliz');
  assert.ok(t.startsWith('[warmly]'), t);
  assert.ok(/\[laughs\]/.test(t), t);
  assert.ok(!/5000/.test(t), 'las cifras van en palabras');
});

test('expresar en canto antepone [singing] y no fija emoción', () => {
  assert.ok(expresar('quiero conocer a Jesús', 'neutral', 'sing').startsWith('[singing]'));
});

test('expresar respeta guiones que ya traen etiquetas', () => {
  const g = '[softly] Ahí voy. [singing] la la la';
  assert.equal(expresar(g, 'risa'), g);
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
  function conVoz(v: string | undefined, fn: () => void) {
    const antes = process.env.ELECTRUM_VOZ;
    if (v === undefined) delete process.env.ELECTRUM_VOZ;
    else process.env.ELECTRUM_VOZ = v;
    try {
      fn();
    } finally {
      if (antes === undefined) delete process.env.ELECTRUM_VOZ;
      else process.env.ELECTRUM_VOZ = antes;
    }
  }

  it('Dr Electrum no habla con la voz de AU-RA, ni siquiera por descuido', () => {
    // El respaldo NO es la voz de AU-RA a propósito: dos cerebros con la misma voz son la misma
    // cosa con dos nombres, y descubrirlo delante de un cliente es tarde.
    conVoz(undefined, () => {
      assert.notEqual(vozDe('electrum'), vozDe('ultron'));
      assert.equal(vozDe('electrum'), 'pqHfZKP75CvOlQylNhV4', 'Bill: la más veterana, como corresponde a un doctor');
    });
  });

  it('ELECTRUM_VOZ manda sobre el respaldo', () => {
    conVoz('onwK4e9ZLuTAKqWW03F9', () => {
      assert.equal(vozDe('electrum'), 'onwK4e9ZLuTAKqWW03F9');
      assert.notEqual(vozDe('ultron'), 'onwK4e9ZLuTAKqWW03F9', 'cambiar la del Doctor no toca la de AU-RA');
    });
  });

  it('una variable en blanco o con espacios no deja mudo al Doctor', () => {
    conVoz('   ', () => assert.equal(vozDe('electrum'), 'pqHfZKP75CvOlQylNhV4'));
    conVoz('', () => assert.equal(vozDe('electrum'), 'pqHfZKP75CvOlQylNhV4'));
  });
});

describe('el guion que recibe v3', () => {
  // Estos cuatro salieron imprimiendo lo que se le manda de verdad a `text-to-dialogue`. Ninguno
  // se ve leyendo el código y ninguno da error: v3 LEE la puntuación y las etiquetas, así que un
  // punto de más o una etiqueta repetida se oyen.
  it('no repite la etiqueta de emoción cuando el texto ya la trae', () => {
    const t = expresar('Mmm. Déjame ver.', 'pensando');
    assert.equal(t.match(/\[thoughtful\]/g)?.length, 1, t);
  });

  it('pone las que faltan de una emoción de dos etiquetas', () => {
    const t = expresar('Suave y con calma.', 'carino');
    assert.ok(t.startsWith('[softly] [warmly]'), t);
  });

  it('no deja cuatro puntos donde van tres', () => {
    for (const t of [expresar('Mmm. Ya veo.', 'neutral'), expresar('Déjame ver.', 'neutral'), expresar('Un segundo.', 'neutral')]) {
      assert.ok(!/\.{4,}/.test(t), t);
      assert.ok(/\.\.\./.test(t), t);
    }
  });

  it('no deja una coma huérfana al principio', () => {
    const t = expresar('Je je, qué bueno.', 'feliz');
    assert.ok(!/\]\s*,/.test(t), t);
  });

  it('respeta la mayúscula de una frase que empieza con la muletilla', () => {
    assert.match(expresar('Un segundo.', 'neutral'), /Un segundo\.\.\./);
    assert.match(expresar('Déjame ver.', 'neutral'), /Déjame ver\.\.\./);
  });

  it('los dos puntos y la raya dan pausa sin partir la frase', () => {
    // Antes esto era un punto, y dejaba «Vamos por partes. primero el derecho»: v3 lee ahí un fin
    // de frase que la gramática no tiene y suena a alguien que se corta a media idea.
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
