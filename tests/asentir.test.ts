/**
 * ASENTIR MIENTRAS LA PERSONA HABLA (mobile/src/lib/asentir.ts): cuándo un «mjm» sí, cuándo no, cuántos, y que lo
 * que se coló al micrófono no quede en su frase. Apagado por omisión hasta que el micrófono de escucha vaya con
 * cancelación de eco (ver la cabecera del módulo).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AJUSTES_ASENTIR, ASENTIR_POR_OMISION, Asentidor, debeAsentir, quitarAsentimientos, type EstadoAsentir } from '../mobile/src/lib/asentir';

const base: EstadoAsentir = { activo: true, ecoCancelado: true, auraHablando: false, parcial: 'y entonces fuimos a ver lo del terreno y', hablaMs: 8000, pausaMs: 500, ultimoMs: -Infinity, enTurno: 0, ahora: 100_000 };

test('apagado por omisión; y sin cancelación de eco, nunca (el «mjm» se oiría como suyo y atrasaría el cierre)', () => {
  assert.equal(ASENTIR_POR_OMISION, false);
  assert.ok(debeAsentir(base));
  assert.ok(!debeAsentir({ ...base, activo: false }));
  assert.ok(!debeAsentir({ ...base, ecoCancelado: false }));
  assert.ok(!debeAsentir({ ...base, silencioso: true }));
  assert.ok(!debeAsentir({ ...base, auraHablando: true }), 'nunca encima de su propia voz');
});

test('solo tras hablar un buen rato y en una pausa corta a media idea (nunca tras un punto o una pregunta)', () => {
  assert.ok(!debeAsentir({ ...base, hablaMs: 4000 }), 'poco rato');
  assert.ok(!debeAsentir({ ...base, pausaMs: 150 }), 'un respiro');
  assert.ok(!debeAsentir({ ...base, pausaMs: 1200 }), 'la frase ya se está cerrando');
  assert.ok(debeAsentir({ ...base, parcial: 'le dije que no, que mejor el lunes,' }));
  assert.ok(!debeAsentir({ ...base, parcial: 'y eso fue lo que pasó.' }), 'tras un punto quiere respuesta');
  assert.ok(!debeAsentir({ ...base, parcial: '¿vos qué harías?' }), 'tras una pregunta quiere respuesta');
});

test('en un tema triste o delicado, en silencio', () => {
  assert.ok(!debeAsentir({ ...base, parcial: 'es que mi abuelo murió la semana pasada y' }));
  assert.ok(!debeAsentir({ ...base, parcial: 'estuvo en el hospital toda la noche y' }));
});

test('uno cada diez segundos, dos por turno como mucho, nunca dos iguales seguidos', () => {
  const a = new Asentidor({ activo: true, ecoCancelado: true });
  a.oir('y entonces le conté a mi hermano lo del negocio y');
  let t = 0;
  const hablar = (ms: number) => {
    for (let i = 0; i < ms; i += 100) assert.equal(a.trozo(true, (t += 100)), null);
  };
  const callar = (ms: number) => {
    const dichas: string[] = [];
    for (let i = 0; i < ms; i += 100) {
      const f = a.trozo(false, (t += 100));
      if (f) dichas.push(f);
    }
    return dichas;
  };
  hablar(8000);
  const primera = callar(600);
  assert.equal(primera.length, 1, 'uno en la pausa');
  hablar(3000);
  assert.deepEqual(callar(600), [], 'antes de diez segundos, no');
  hablar(8000);
  const segunda = callar(600);
  assert.equal(segunda.length, 1);
  assert.notEqual(segunda[0], primera[0]);
  hablar(12_000);
  assert.deepEqual(callar(600), [], 'dos por turno');
  a.finTurno();
  // Una pausa larga corta el «hablando seguido»: vuelve a contar desde cero.
  hablar(5000);
  callar(2000);
  hablar(3000);
  assert.deepEqual(callar(600), [], 'tras una pausa larga, el rato vuelve a empezar');
  assert.ok(AJUSTES_ASENTIR.maxPorTurno === 2 && AJUSTES_ASENTIR.separacionMs === 10_000);
});

test('lo que se coló al micrófono sale de su frase (solo lo que AU-RA dijo, tantas veces como lo dijo)', () => {
  assert.equal(quitarAsentimientos('y entonces mjm le dije que no', ['mjm']), 'y entonces le dije que no');
  assert.equal(quitarAsentimientos('Ajá, y luego fuimos al banco', ['ajá']), 'y luego fuimos al banco');
  assert.equal(quitarAsentimientos('aja y luego aja otra vez', ['ajá']), 'y luego aja otra vez');
  assert.equal(quitarAsentimientos('ya te dije que ya voy', []), 'ya te dije que ya voy', 'sin asentimientos, nada cambia');
  const a = new Asentidor({ activo: true, ecoCancelado: true });
  assert.equal(a.quitarDelFinal('okey, entonces mañana'), 'okey, entonces mañana', 'el «okey» es de la persona: AU-RA no lo dijo');
});
