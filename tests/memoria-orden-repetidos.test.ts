/**
 * EL HILO EN ORDEN Y SIN REPETIDOS (José, 6-oct, memoria de las 21:14–21:16 UTC): la misma frase guardada cinco veces
 * («Vamos entonces, ¿ya lo guardaste?» / «Estamos entonces…», turnos de voz que se cortaban y volvían a empezar) y una
 * respuesta fuera de orden («¡Listo! Hablamos después.», que contestaba a su «bye», guardada DESPUÉS de «Mándele un mensaje
 * a mi viejo» porque la memoria de la voz se anota al confirmarse, con la hora de ese momento). lib/hilo-orden.ts, y por
 * dentro de lib/memoria.ts (la de la junta) y lib/memoria-miembro.ts. Frases inventadas.
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { insertarTurno, mismaFrase } from '../lib/hilo-orden';

process.env.ULTRON_MEMORIA_BUCKET = '';
// La copia a disco va a una carpeta temporal (lib/memoria.ts: ULTRON_MEMORIA_JUNTA_FILE), no a data/ del repo.
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-orden-'));
process.env.ULTRON_MEMORIA_JUNTA_FILE = path.join(DIR, 'memoria-junta.json');
after(() => fs.rmSync(DIR, { recursive: true, force: true }));
const { recordarTurno, resetMemoriaTest, fotoMemoria } = await import('../lib/memoria');

describe('hilo en orden y sin repetidos', () => {
  it('la misma frase (o con la primera palabra mal oída) es la misma; otra no', () => {
    assert.equal(mismaFrase('Vamos entonces, ¿ya lo guardaste?', 'Estamos entonces, ¿ya lo guardaste?'), true);
    assert.equal(mismaFrase('Vale, vale. Me llamas después. Bye.', 'vale vale me llamas despues bye'), true);
    assert.equal(mismaFrase('Sí.', 'No.'), false);
    assert.equal(mismaFrase('Mándale a Beto', 'Mándale a Ana'), false);
  });

  it('insertarTurno: por su hora, y la frase repetida sin respuesta en medio no entra', () => {
    const t0 = 1_000_000;
    let h = [{ rol: 'user', texto: 'Vale, vale. Bye.', t: t0 }];
    h = insertarTurno(h, { rol: 'user', texto: 'Escríbele a mi compadre.', t: t0 + 15_000 }, 50)!;
    // La respuesta al «bye» se anota tarde, con la hora de cuando se dijo: entra antes de «Escríbele…».
    h = insertarTurno(h, { rol: 'ultron', texto: '¡Listo! Hablamos después.', t: t0 + 3_000 }, 50)!;
    assert.deepEqual(h.map((x) => x.texto), ['Vale, vale. Bye.', '¡Listo! Hablamos después.', 'Escríbele a mi compadre.']);
    // El «bye» repetido (reintento) a los pocos segundos, antes de la respuesta: no entra.
    assert.equal(insertarTurno(h, { rol: 'user', texto: 'Vale, vale. Bye.', t: t0 + 1_000 }, 50), null);
    // Dicho otra vez DESPUÉS de una respuesta: sí es otro turno.
    assert.ok(insertarTurno(h, { rol: 'user', texto: 'Escríbele a mi compadre.', t: t0 + 90_000 }, 50));
  });

  it('lib/memoria.ts: cinco veces la misma frase en un segundo queda una; la respuesta tardía va en su lugar', async () => {
    resetMemoriaTest();
    const ahora = Date.now();
    for (let i = 0; i < 5; i++) await recordarTurno({ quien: 'jose', rol: 'user', texto: i % 2 ? 'Estamos entonces, ¿ya lo guardaste?' : 'Vamos entonces, ¿ya lo guardaste?', canal: 'mesa', t: ahora - 30_000 + i * 200 });
    await recordarTurno({ quien: 'jose', rol: 'user', texto: 'Escríbele a mi compadre por WhatsApp.', canal: 'mesa', t: ahora - 10_000 });
    // La respuesta a la frase de antes, anotada ahora pero con la hora en que se dijo.
    await recordarTurno({ quien: 'jose', rol: 'ultron', texto: 'Sí, ya quedó.', canal: 'mesa', t: ahora - 25_000 });
    const corta = fotoMemoria('jose').privada.corta.map((x) => `${x.rol}: ${x.texto}`);
    assert.deepEqual(corta, ['user: Vamos entonces, ¿ya lo guardaste?', 'ultron: Sí, ya quedó.', 'user: Escríbele a mi compadre por WhatsApp.']);
  });
});
