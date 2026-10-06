/**
 * EL TOPE DE VOZ TERMINA EN UNA FRASE ENTERA (José, 6-oct, APK 5.5.0: «la llamada fue fluida pero de repente falló»).
 * A las 17:11 UTC el registro dijo «[voz] tope: dijo 295 de 326 caracteres» y «252 de 349»: lo soltado mientras
 * llegaba acababa en la coma de una cláusula larga (mobile/src/lib/cortesVoz.ts) y el tope se miraba ahí, así que la
 * voz callaba a media frase. Lo puro (lib/trozos.ts cierreDeFrase) y que server.ts lo use en los tres sitios donde
 * para la voz: el stream, la vuelta del harness y lo que falta al terminar. El turno de punta a punta, con el servidor
 * de verdad: tests/voz-tope-frase-servidor.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cierreDeFrase, FRASE_EXTRA_VOZ, puntoDeCorte } from '../lib/trozos';
import { TOPE_VOZ_CHARS, duroDeVoz } from '../lib/cerebro-manos';

const A = 'Revisé tu bandeja y encontré tres correos nuevos de hoy, todos sobre el envío del molino de la planta.';
const B =
  'El primero es de Ana, que confirma la fecha del transporte para el jueves por la mañana temprano, el segundo es de Beto, que pregunta por la factura pendiente del mes pasado, y el tercero es del banco con el estado de cuenta.';
const C = 'Avísame cuál quieres revisar primero.';
const TEXTO = `${A} ${B} ${C}`;

/** Lo que el stream soltaba ANTES (main): por cortes, y al pasar el tope se paraba en el corte que fuera. */
function vozComoAntes(texto: string, tope: number): string {
  let enviado = 0;
  for (let i = 12; i <= texto.length + 12; i += 12) {
    const cuerpo = texto.slice(0, i);
    const corte = puntoDeCorte(cuerpo, enviado);
    if (corte > enviado) {
      if (enviado >= tope) break;
      enviado = corte + 1;
    }
  }
  return texto.slice(0, enviado);
}

/** Lo mismo con el arreglo: al pasar el tope, hasta el final de la frase en curso (o se espera a que llegue). */
function vozAhora(texto: string, tope: number): string {
  let enviado = 0;
  let topado = false;
  for (let i = 12; i <= texto.length + 12 && !topado; i += 12) {
    const cuerpo = texto.slice(0, i);
    const corte = puntoDeCorte(cuerpo, enviado);
    if (corte > enviado) {
      if (enviado >= tope) {
        const c = cierreDeFrase(cuerpo, enviado, { limite: duroDeVoz(tope) + FRASE_EXTRA_VOZ });
        if (c.estado === 'esperar') continue;
        enviado = c.hasta;
        topado = true;
        break;
      }
      enviado = corte + 1;
    }
  }
  return texto.slice(0, enviado);
}

test('el caso del registro: con el corte de antes la voz callaba en una coma, a media frase', () => {
  const antes = vozComoAntes(TEXTO, TOPE_VOZ_CHARS);
  assert.ok(antes.length >= TOPE_VOZ_CHARS && antes.length < TEXTO.length, `dijo ${antes.length} de ${TEXTO.length}`);
  assert.match(antes, /,$/, `antes terminaba en coma: «…${antes.slice(-40)}»`);
});

test('con el arreglo la voz termina la frase en curso y calla en su punto', () => {
  const ahora = vozAhora(TEXTO, TOPE_VOZ_CHARS);
  assert.equal(ahora, `${A} ${B}`, `«…${ahora.slice(-50)}»`);
  assert.ok(ahora.length <= duroDeVoz(TOPE_VOZ_CHARS) + FRASE_EXTRA_VOZ);
});

test('cierreDeFrase: ya en un final de frase (con o sin el espacio de después), no se alarga', () => {
  assert.deepEqual(cierreDeFrase(TEXTO, A.length), { estado: 'entera', hasta: A.length });
  assert.deepEqual(cierreDeFrase(TEXTO, A.length + 1), { estado: 'entera', hasta: A.length + 1 });
  assert.deepEqual(cierreDeFrase(TEXTO, 0), { estado: 'entera', hasta: 0 });
});

test('cierreDeFrase: a media frase, hasta su final si ya llegó; si no, esperar', () => {
  const coma = TEXTO.indexOf('Beto,') + 'Beto,'.length;
  assert.deepEqual(cierreDeFrase(TEXTO, coma), { estado: 'entera', hasta: A.length + 1 + B.length });
  // El final de la frase todavía no llegó (el modelo sigue escribiendo).
  const parcial = TEXTO.slice(0, coma + 30);
  assert.deepEqual(cierreDeFrase(parcial, coma), { estado: 'esperar', hasta: coma });
  // Llegó entero sin punto final: el final del texto cuenta.
  assert.deepEqual(cierreDeFrase('Te cuento que Ana llamó, que vuelve mañana', 24, { completo: true }), { estado: 'entera', hasta: 42 });
});

test('cierreDeFrase: una frase descomunal (sin punto en el límite) se queda en su pausa', () => {
  const larga = `Hola, ${'y luego otra cosa más, '.repeat(40)}fin.`;
  assert.deepEqual(cierreDeFrase(larga, 30, { limite: 200 }), { estado: 'larga', hasta: 30 });
});

test('cierreDeFrase: los finales fuertes y las abreviaturas siguen el contrato de cortesVoz', () => {
  const t = 'Hablé con el Dr. Gómez, que te manda saludos y dice que todo bien con la planta. ¿Sigo?';
  assert.deepEqual(cierreDeFrase(t, t.indexOf('Gómez,') + 6), { estado: 'entera', hasta: t.indexOf('planta.') + 7 }, 'no corta tras «Dr.»');
  const q = '¿Quieres que te lo lea completo, con todo lo que trae? Dime.';
  assert.deepEqual(cierreDeFrase(q, q.indexOf(',') + 1), { estado: 'entera', hasta: q.indexOf('?') + 1 });
});

test('server.ts usa cierreDeFrase en el stream, en la vuelta del harness y al terminar el turno', () => {
  const src = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const turno = src.slice(src.indexOf('async function turnoEnVivo('), src.indexOf("app.get('/api/taller'"));
  assert.match(turno, /const c = cierreDeFrase\(cuerpo, enviado, \{ limite: duroDeVoz\(topeDelTurno\) \+ FRASE_EXTRA_VOZ \}\);/);
  assert.match(turno, /const c = cierreDeFrase\(t, dichoH\.length, \{ limite: duroDeVoz\(topeDelTurno\) \+ FRASE_EXTRA_VOZ \}\);/);
  assert.match(turno, /const c = cierreDeFrase\(decible, enviado, \{ completo: true, limite: duroDeVoz\(topeDelTurno\) \+ FRASE_EXTRA_VOZ \}\);/);
  // Ya no hay un «topado» seco al llegar al tope (el que callaba en la coma).
  assert.doesNotMatch(turno, /if \(topeDelTurno && enviado >= topeDelTurno\) \{\s*topado = true;\s*return;/);
  assert.doesNotMatch(turno, /if \(topeDelTurno && dichoH\.length >= topeDelTurno\) \{\s*topado = true;\s*return;/);
});
