/**
 * ¿Terminó de hablar o solo hizo una pausa? (mobile/src/lib/finDeTurno.ts). Lo que siente la persona: cuando la idea
 * está cerrada AU-RA no la hace esperar; cuando quedó colgando («y luego…», «es que», «mándale un mensaje a») la deja
 * terminar, aunque Turbo le haya puesto un punto.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CIERRE_MS, SONDEO_MS, cierreDe, finDeTurno, sePuedeEspecular } from '../mobile/src/lib/finDeTurno';
import { SILENCIO_BASE_MS, SILENCIO_LARGO_MS } from '../mobile/src/lib/turboLogica';

describe('fin de turno semántico (teléfono)', () => {
  it('ideas cerradas: preguntas, órdenes con lo que piden y respuestas cortas', () => {
    for (const t of [
      '¿Qué hora es?',
      '¿Y tú?',
      'Cómo estás hoy.',
      '¿Cómo se llama este?',
      'Cuéntame algo interesante del oro.',
      'Dame un consejo para no estresarme.',
      'Abre mis correos.',
      'Gracias.',
      'Sí.',
      'No gracias.',
      'Hola.',
      'Okay.',
      'What time is it?',
      'Tell me a joke.',
      'Thank you.',
      'Qué opinas de la lluvia.',
    ])
      assert.equal(finDeTurno(t), 'completo', t);
  });

  it('a medias: conjunción, preposición, artículo, muletilla o puntos suspensivos (aunque Turbo cierre con punto)', () => {
    for (const t of [
      'Y luego.',
      'Es que.',
      'Mándale un mensaje a.',
      'Ponme música y.',
      'Quiero ir al centro con mi.',
      'Fíjate que.',
      'Bueno, eh.',
      'Lo que pasa es que.',
      'Hoy fui al banco y…',
      'Hoy fui al banco,',
      'Revisa mi-',
      'Este...',
      'Mira.',
      'And then.',
      'I was going to the.',
      'You know.',
      '',
    ])
      assert.equal(finDeTurno(t), 'incompleto', t);
  });

  it('lo demás es dudoso: puede seguir o no (se espera lo de siempre, pero se puede empezar el turno)', () => {
    for (const t of ['Hoy fui al centro.', 'Mamá.', 'Llámame.', 'Fíjate que hoy me levanté cansado.', 'Ayer vi a Beto.']) assert.equal(finDeTurno(t), 'dudoso', t);
  });

  it('los tiempos: el sondeo antes del cierre corto; completo más rápido que antes, incompleto espera más', () => {
    assert.ok(SONDEO_MS < CIERRE_MS.completo);
    assert.ok(CIERRE_MS.completo < SILENCIO_BASE_MS, 'una idea cerrada se cierra antes que con el silencio de siempre');
    assert.equal(CIERRE_MS.dudoso, SILENCIO_BASE_MS, 'lo dudoso espera lo mismo que antes');
    assert.ok(CIERRE_MS.incompleto >= SILENCIO_LARGO_MS, 'lo que quedó colgando espera al menos lo de antes');
    assert.equal(cierreDe('completo'), CIERRE_MS.completo);
    assert.equal(sePuedeEspecular('incompleto'), false);
    assert.equal(sePuedeEspecular('dudoso'), true);
    assert.equal(sePuedeEspecular('completo'), true);
  });
});
