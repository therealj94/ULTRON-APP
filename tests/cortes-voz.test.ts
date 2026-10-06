/**
 * VOZ-05 (auditoría externa del 6-oct, AURA_MASTER §6): un solo contrato de corte para el servidor
 * (lib/trozos.ts puntoDeCorte), la mesa web (src/03-voz/frases.ts cortarFrases) y la app
 * (mobile/src/lib/cortesVoz.ts, que usa el StreamSpeaker; su arnés: mobile/pruebas/oido/locutor.cjs).
 *
 *  · el servidor ya no espera el espacio de después del punto («Hola.» al final de lo llegado sale);
 *  · «Dr. Gómez», «Sra.», «Lic.», «EE. UU.», 1.500, 3,5, 6.10.2026, 10:30, a.m., direcciones y etiquetas
 *    partidas no se cortan por dentro (y «Dr. Gómez» llega entero a la normalización: «Doctor Gómez»);
 *  · lo que el servidor suelta hasta un corte, la web y la app lo cortan en el mismo sitio sin retener nada
 *    (sin doble segmentación que agregue espera); la coma vale en toda la primera frase y, después, en una
 *    frase que se alarga (buffer acotado);
 *  · el oído Turbo ya no trata «origen» o «cartera» a secas como dinero (no espera otra transcripción).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { puntoDeCorte } from '../lib/trozos';
import { cortarFrases } from '../src/03-voz/frases';
import { afinarParaBoca } from '../server/habla';
import { esFraseDeDinero as dineroServidor } from '../lib/oido';
import { datoSensibleDeDinero, esFraseDeDinero as dineroMovil } from '../mobile/src/lib/turboLogica';

/** Lo que el servidor suelta, trozo a trozo, si el modelo escribe `texto` de a `paso` letras (como server.ts procesar). */
function soltadoPorServidor(texto: string, paso: number): string[] {
  const out: string[] = [];
  let enviado = 0;
  for (let i = paso; i < texto.length + paso; i += paso) {
    const cuerpo = texto.slice(0, Math.min(i, texto.length));
    const corte = puntoDeCorte(cuerpo, enviado);
    if (corte > enviado) {
      out.push(cuerpo.slice(enviado, corte + 1));
      enviado = corte + 1;
    }
  }
  if (enviado < texto.length) out.push(texto.slice(enviado));
  return out;
}

test('servidor: una frase cerrada sale aunque el punto sea lo último que llegó', () => {
  assert.equal(puntoDeCorte('Hola.', 0), 4, 'antes -1: esperaba el espacio del trozo siguiente');
  assert.equal(puntoDeCorte('¿Te llamo?', 0), 9);
  assert.equal(puntoDeCorte('Sí. Claro.', 0), 9);
  assert.equal(puntoDeCorte('Dijo «listo.»', 0), 12, 'con lo que cierra detrás');
});

test('servidor: abreviaturas, cifras, fechas, horas, unidades y direcciones no se cortan por dentro', () => {
  const sinCorte = [
    'El Dr. Gómez',
    'La Sra. Pérez y el Lic. Ruiz',
    'El Ing. Mejía',
    'Viven en EE. UU. desde',
    'Cuesta 1.500',
    'Son 3,5 kilos',
    'El 6.10.2026 a las 10:30',
    'Abre aura.app/hoy',
    'Te paso con el Dr.',
    'Cuesta 1.',
    '[ri',
    'Mira, lo que pasa',
  ];
  for (const t of sinCorte) assert.equal(puntoDeCorte(t, 0), -1, t);
  // Y donde sí cierran: tras una cifra con espacio, tras «UU.» o «a.m.» si sigue mayúscula.
  assert.equal(puntoDeCorte('Pesa 3. Luego', 0), 6);
  assert.equal(puntoDeCorte('Vive en EE. UU. Trabaja', 0), 'Vive en EE. UU.'.length - 1);
  assert.equal(puntoDeCorte('Llega a las 5 p.m. Te aviso', 0), 'Llega a las 5 p.m.'.length - 1);
  assert.equal(puntoDeCorte('Compré pan, leche, etc. y me fui', 0), -1, '«etc.» seguido de minúscula no cierra');
});

test('«Dr. Gómez» llega entero a la normalización: «Doctor Gómez» aunque llegue a trozos', () => {
  const texto = 'Hablé con el Dr. Gómez esta mañana. Mañana te llamo.';
  for (const paso of [1, 2, 3, 5, 8]) {
    const trozos = soltadoPorServidor(texto, paso);
    assert.ok(!trozos.some((t) => /\bDr\.\s*$/.test(t)), `paso ${paso}: ningún trozo termina en «Dr.» (${JSON.stringify(trozos)})`);
    assert.match(afinarParaBoca(trozos[0]), /Doctor Gómez/, `paso ${paso}`);
  }
});

test('lo que suelta el servidor, la web lo corta en el mismo sitio sin retener nada (sin doble espera)', () => {
  const textos = [
    'Sí. Puedo ayudarte con eso. Dime qué necesitas.',
    'Te recomiendo empezar ya mismo, revisar la planta con calma, y después las cuentas del mes. Luego hablamos.',
    'El Dr. Gómez dijo que cuesta 1.500 dólares, más o menos, en EE. UU. y que llega a las 5 p.m. Mañana te aviso.',
    'Mira, con lo que me cuentas de la planta de beneficio, yo empezaría por el molino; después vemos el resto con más calma.',
    'Primera frase corta. Y una segunda frase bastante más larga que sigue y sigue sin punto, con una coma pasada la mitad, y otra coma más adelante para ver si se suelta.',
  ];
  for (const texto of textos) {
    for (const paso of [1, 3, 7]) {
      const trozos = soltadoPorServidor(texto, paso);
      // Cada trozo soltado (menos el resto final) la web lo dice entero en cuanto llega.
      for (const t of trozos.slice(0, -1)) {
        const r = cortarFrases(t);
        assert.equal(r.resto.trim(), '', `paso ${paso}: «${t}» se quedó esperando en la web (${JSON.stringify(r)})`);
      }
      assert.equal(trozos.join(''), texto, 'nada se pierde ni se repite');
    }
  }
});

test('la coma: toda la primera frase; después solo una frase que se alarga (buffer acotado)', () => {
  const primera = 'Te recomiendo empezar ya mismo, revisar la planta con calma y después';
  assert.equal(puntoDeCorte(primera, 0), primera.indexOf(','));
  // Dos comas lejanas en la primera frase: el servidor suelta hasta la segunda (antes solo la primera vez).
  const dos = 'Te recomiendo empezar ya mismo, revisar la planta con calma suficiente, y después';
  const primerCorte = dos.indexOf(',') + 1;
  assert.equal(puntoDeCorte(dos, primerCorte), dos.lastIndexOf(','), 'antes -1: una vez soltado algo, solo frases');
  // En una frase siguiente corta, la coma no suelta; en una que se alarga más de CLAUSULA_LARGA, sí.
  const corta = 'Listo. Ahora, si quieres, lo vemos';
  assert.equal(puntoDeCorte(corta, 6), -1);
  const larga = 'Listo. ' + 'Ahora te cuento todo lo que encontré sobre la planta de beneficio y el molino de bolas nuevo que llegó ayer, y lo';
  assert.equal(puntoDeCorte(larga, 6), larga.lastIndexOf(','));
});

test('web: cortarFrases sigue el contrato («Dr.» no se parte; lo cerrado sale; al final, todo)', () => {
  assert.deepEqual(cortarFrases('El Dr. Gómez llegó. Y'), { listas: ['El Dr. Gómez llegó.'], resto: 'Y' });
  assert.deepEqual(cortarFrases('Te paso con el Dr.'), { listas: [], resto: 'Te paso con el Dr.' });
  assert.deepEqual(cortarFrases('Sí. No. Ok.'), { listas: ['Sí.', 'No.', 'Ok.'], resto: '' });
  assert.deepEqual(cortarFrases('Cuesta 1.', true), { listas: ['Cuesta 1.'], resto: '' });
});

test('Turbo: «origen» y «cartera» a secas no son dinero; montos y destinatarios siguen confirmándose', () => {
  for (const f of ['¿Cuál es el origen del universo?', '¿Dónde está mi cartera?', 'El origen de la palabra cartera', 'Se me perdió la billetera en el carro']) {
    assert.equal(dineroMovil(f), false, f);
    assert.equal(dineroServidor(f), false, f);
  }
  for (const f of ['Mándale cinco origen a Ana', 'envíale 5 ORIGEN a mi mamá', '¿Cuántos origen tengo?', '¿Cuánto tengo en la cartera?', 'manda 20 desde mi cartera a Beto', 'How much is in my wallet?', 'Págale cien lempiras a Ana', '¿Cuánto saldo tengo?']) {
    assert.equal(dineroMovil(f), true, f);
    assert.equal(dineroServidor(f), true, f);
  }
  // El dato sensible (monto o a quién) sigue pidiendo confirmación estricta.
  assert.equal(datoSensibleDeDinero('Mándale cinco origen a Ana'), true);
});
