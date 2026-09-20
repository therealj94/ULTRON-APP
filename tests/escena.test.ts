import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MaquinaEscena, describirEscena, ladoDesdeUltron, espejarX, normalizarY, cabezaDesde, UMBRALES, type Observacion, type Principal } from '../src/02-cara/vision/escena';
import { anguloEsperado, observacionDesdeResultado, anguloDesdeLandmarks, combinarAngulo, MEDIAPIPE_VERSION } from '../src/02-cara/vision/mediapipe';
import { analizarCuadro, MemoriaMovimiento, tieneEnergia, UMBRALES_OPTICO } from '../src/02-cara/vision/optico';

const principalBase = (p: Partial<Principal> = {}): Principal => ({
  x: 0,
  y: 0,
  tam: 0.25,
  mirando: false,
  sonrisa: 0,
  sorpresa: 0,
  ojosCerrados: false,
  bocaAbierta: 0,
  cabeza: 'centro',
  ...p,
});

const cara = (extra: Partial<NonNullable<Observacion['cara']>> = {}): NonNullable<Observacion['cara']> => ({
  cx: 0.5,
  cy: 0.5,
  tam: 0.25,
  yaw: 0,
  pitch: 0,
  sonrisa: 0,
  sorpresa: 0,
  bocaAbierta: 0,
  parpadeo: 0,
  ...extra,
});

const obs = (ts: number, c: Observacion['cara'], personas = c ? 1 : 0): Observacion => ({ ts, motor: 'mediapipe', personas, cara: c });

/** Alimenta cuadros cada `paso` ms desde `desde` hasta `hasta` (inclusive) y junta los eventos. */
function correr(m: MaquinaEscena, desde: number, hasta: number, paso: number, c: Observacion['cara'], personas?: number) {
  const eventos: string[] = [];
  let ultima = m.escena;
  for (let t = desde; t <= hasta; t += paso) {
    ultima = m.procesar(obs(t, c, personas));
    eventos.push(...ultima.eventos);
  }
  return { eventos, escena: ultima! };
}

// ---- descripción ---------------------------------------------------------------------------

test('describe 0 personas', () => {
  assert.equal(describirEscena({ personas: 0, principal: null, motor: 'mediapipe' }), 'No veo a nadie ahora.');
  assert.equal(describirEscena({ personas: 0, principal: null, motor: 'optico' }), 'No veo a nadie ahora.');
});

test('describe cámara apagada', () => {
  assert.equal(describirEscena({ personas: 0, principal: null, motor: 'ninguno' }), 'La cámara está apagada.');
});

test('describe 1 persona cerca, sonriendo y mirando; el lado se dice desde ULTRON (x<0 = a mi derecha)', () => {
  const d = describirEscena({ personas: 1, principal: principalBase({ x: -0.6, tam: 0.5, sonrisa: 0.8, mirando: true }), motor: 'mediapipe' });
  assert.equal(d, 'Veo a una persona cerca, a mi derecha, sonriendo y mirando la pantalla.');
  assert.doesNotMatch(d, /\btu\b/, 'nunca «tu»: ULTRON habla en primera persona');
});

test('describe 1 persona frente, sin gestos; y lejos a mi izquierda (x>0, espejado) mirando a otro lado', () => {
  assert.equal(describirEscena({ personas: 1, principal: principalBase(), motor: 'mediapipe' }), 'Veo a una persona, frente a mí.');
  const d = describirEscena({ personas: 1, principal: principalBase({ x: 0.7, tam: 0.1, cabeza: 'izquierda' }), motor: 'mediapipe' });
  assert.equal(d, 'Veo a una persona lejos, a mi izquierda, mirando hacia otro lado.');
});

test('ladoDesdeUltron: x>0 (derecha de la persona) es la izquierda de ULTRON', () => {
  assert.equal(ladoDesdeUltron(0.5), 'a mi izquierda');
  assert.equal(ladoDesdeUltron(-0.5), 'a mi derecha');
  assert.equal(ladoDesdeUltron(0.1), 'frente a mí');
  // Cara en la izquierda del cuadro sin espejar (cx 0.2) → x espejado > 0 → está a la izquierda de la cámara/ULTRON
  assert.equal(ladoDesdeUltron(espejarX(0.2)), 'a mi izquierda');
});

test('con motor óptico no afirma gestos ni identidad', () => {
  const d = describirEscena({ personas: 1, principal: principalBase({ sonrisa: 0.9, mirando: true }), motor: 'optico' });
  assert.match(d, /^Creo que hay alguien frente a mí/);
  assert.doesNotMatch(d, /sonriendo|mirando la pantalla/);
});

test('describe 2 personas sin inventar nada (también sin principal confirmada)', () => {
  const d = describirEscena({ personas: 2, principal: principalBase(), motor: 'mediapipe' });
  assert.equal(d, 'Veo a dos personas.');
  assert.doesNotMatch(d, /hombre|mujer|niñ|señor|años/i);
  assert.equal(describirEscena({ personas: 2, principal: null, motor: 'mediapipe' }), 'Veo a dos personas.');
  assert.equal(describirEscena({ personas: 1, principal: null, motor: 'mediapipe' }), 'No veo a nadie ahora.');
});

// ---- espejado ------------------------------------------------------------------------------

test('espeja x: cara a la izquierda del cuadro → x positivo (derecha de la persona)', () => {
  assert.equal(espejarX(0.5), 0);
  assert.ok(espejarX(0.2) > 0.55 && espejarX(0.2) < 0.65);
  assert.ok(espejarX(0.8) < -0.55 && espejarX(0.8) > -0.65);
  assert.equal(espejarX(0), 1);
  assert.equal(espejarX(1), -1);
  assert.equal(normalizarY(0), -1);
  assert.equal(normalizarY(1), 1);
});

test('la máquina publica x espejado y y sin espejar', () => {
  const m = new MaquinaEscena();
  const { escena } = correr(m, 0, 800, 50, cara({ cx: 0.2, cy: 0.75 }));
  assert.ok(escena.principal, 'hay principal tras llegar');
  assert.ok(escena.principal!.x > 0.5, `x espejado positivo, fue ${escena.principal!.x}`);
  assert.ok(escena.principal!.y > 0.4, `y hacia abajo positivo, fue ${escena.principal!.y}`);
});

// ---- histéresis llego / se_fue ---------------------------------------------------------------

test('llego solo tras 0.6 s de presencia continua', () => {
  const m = new MaquinaEscena();
  const antes = correr(m, 0, 500, 50, cara());
  assert.ok(!antes.eventos.includes('llego'), 'no llega a los 500 ms');
  assert.equal(antes.escena.personas, 0);
  assert.equal(antes.escena.principal, null);
  const despues = correr(m, 550, 700, 50, cara());
  assert.deepEqual(despues.eventos.filter((e) => e === 'llego'), ['llego']);
  assert.equal(despues.escena.personas, 1);
  assert.ok(despues.escena.principal);
  assert.match(despues.escena.descripcion, /^Veo a una persona/);
});

test('un corte breve reinicia el conteo de llegada', () => {
  const m = new MaquinaEscena();
  correr(m, 0, 400, 50, cara());
  correr(m, 450, 900, 50, null); // 450 ms sin cara > tolerancia
  const r = correr(m, 950, 1400, 50, cara()); // 450 ms de cara nueva: todavía no
  assert.ok(!r.eventos.includes('llego'));
  const r2 = correr(m, 1450, 1600, 50, cara());
  assert.ok(r2.eventos.includes('llego'));
});

test('se_fue solo tras 2 s sin cara', () => {
  const m = new MaquinaEscena();
  correr(m, 0, 1000, 50, cara());
  const a = correr(m, 1050, 2900, 50, null); // 1.85 s sin cara
  assert.ok(!a.eventos.includes('se_fue'), 'a los 1.85 s aún no se fue');
  assert.equal(a.escena.personas, 1, 'sigue contando como presente');
  const b = correr(m, 2950, 3100, 50, null);
  assert.deepEqual(b.eventos.filter((e) => e === 'se_fue'), ['se_fue']);
  assert.equal(b.escena.personas, 0);
  assert.equal(b.escena.principal, null);
  assert.equal(b.escena.descripcion, 'No veo a nadie ahora.');
  // Volver a aparecer exige otra vez 0.6 s
  const c = correr(m, 3150, 3500, 50, cara());
  assert.ok(!c.eventos.includes('llego'));
  const d = correr(m, 3550, 3800, 50, cara());
  assert.ok(d.eventos.includes('llego'));
});

test('un cuadro perdido no cambia principal ni descripción (la histéresis protege la salida)', () => {
  const m = new MaquinaEscena();
  const antes = correr(m, 0, 1000, 50, cara({ cx: 0.3, sonrisa: 0.8 }));
  assert.ok(antes.escena.principal);
  const perdido = m.procesar(obs(1050, null));
  assert.equal(perdido.personas, 1);
  assert.ok(perdido.principal, 'principal se mantiene durante el corte corto');
  assert.equal(perdido.principal!.x, antes.escena.principal!.x, 'misma posición congelada');
  assert.equal(perdido.descripcion, antes.escena.descripcion);
  assert.deepEqual(perdido.eventos, []);
  // Sigue igual hasta justo antes de los 2 s
  const casi = correr(m, 1100, 2950, 50, null);
  assert.ok(casi.escena.principal, 'a 1.9 s sin cara sigue publicada');
  assert.ok(!casi.eventos.includes('se_fue'));
  const vuelve = m.procesar(obs(3000, cara({ cx: 0.3, sonrisa: 0.8 })));
  assert.ok(vuelve.principal);
  assert.ok(!vuelve.eventos.includes('llego'), 'no vuelve a llegar');
  // Y si de verdad se va, principal pasa a null solo con se_fue
  const fin = correr(m, 3050, 5100, 50, null);
  assert.deepEqual(fin.eventos.filter((e) => e === 'se_fue'), ['se_fue']);
  assert.equal(fin.escena.principal, null);
  assert.equal(fin.escena.descripcion, 'No veo a nadie ahora.');
});

test('dos caras antes del llego: nadie cuenta todavía, sin frases contradictorias', () => {
  const m = new MaquinaEscena();
  const r = correr(m, 0, 500, 50, cara(), 2);
  assert.equal(r.escena.personas, 0);
  assert.equal(r.escena.principal, null);
  assert.equal(r.escena.descripcion, 'No veo a nadie ahora.');
  assert.ok(!r.eventos.includes('dos_personas'));
  const r2 = correr(m, 550, 1700, 50, cara(), 2);
  assert.ok(r2.eventos.includes('llego'));
  assert.ok(r2.eventos.includes('dos_personas'));
  assert.equal(r2.escena.personas, 2);
  assert.match(r2.escena.descripcion, /^Veo a dos personas/);
});

test('cambiarMotor (óptico → mediapipe) conserva la presencia: un solo llego', () => {
  const m = new MaquinaEscena();
  const ev: string[] = [];
  for (let t = 0; t <= 2000; t += 50) ev.push(...m.procesar({ ts: t, motor: 'optico', personas: 1, cara: cara() }).eventos);
  m.cambiarMotor();
  assert.ok(m.presenteConfirmado);
  let ultima = m.escena!;
  for (let t = 2050; t <= 3000; t += 50) {
    ultima = m.procesar(obs(t, cara({ sonrisa: 0.8 })));
    ev.push(...ultima.eventos);
  }
  assert.deepEqual(ev.filter((e) => e === 'llego'), ['llego']);
  assert.ok(!ev.includes('se_fue'));
  assert.ok(ev.includes('sonrie'), 'los gestos sí se re-evalúan con el motor nuevo');
  assert.equal(ultima.motor, 'mediapipe');
  assert.ok(ultima.principal);
});

// ---- sonrisa ---------------------------------------------------------------------------------

test('sonríe al cruzar 0.55 y deja de sonreír al bajar de 0.3', () => {
  const m = new MaquinaEscena();
  correr(m, 0, 1000, 50, cara({ sonrisa: 0.2 }));
  const a = correr(m, 1050, 1200, 50, cara({ sonrisa: 0.5 }));
  assert.ok(!a.eventos.includes('sonrie'), '0.5 no dispara');
  const b = correr(m, 1250, 1400, 50, cara({ sonrisa: 0.6 }));
  assert.deepEqual(b.eventos.filter((e) => e === 'sonrie'), ['sonrie']);
  assert.match(b.escena.descripcion, /sonriendo/);
  const c = correr(m, 1450, 1600, 50, cara({ sonrisa: 0.4 }));
  assert.ok(!c.eventos.includes('deja_de_sonreir'), '0.4 se mantiene sonriendo (histéresis)');
  assert.ok(!c.eventos.includes('sonrie'), 'no re-dispara sonrie');
  const d = correr(m, 1650, 1800, 50, cara({ sonrisa: 0.2 }));
  assert.deepEqual(d.eventos.filter((e) => e === 'deja_de_sonreir'), ['deja_de_sonreir']);
  assert.equal(UMBRALES.sonrieOn, 0.55);
  assert.equal(UMBRALES.sonrieOff, 0.3);
});

// ---- extras: distancia, dos personas, mirada, cabeza --------------------------------------------

test('cerca / lejos con histéresis y dos_personas estable 1 s', () => {
  const m = new MaquinaEscena();
  correr(m, 0, 1000, 50, cara({ tam: 0.25 }));
  const a = correr(m, 1050, 1800, 50, cara({ tam: 0.6 }));
  assert.deepEqual(a.eventos.filter((e) => e === 'cerca'), ['cerca']);
  assert.match(a.escena.descripcion, /cerca/);
  const b = correr(m, 1850, 2600, 50, cara({ tam: 0.05 }));
  assert.deepEqual(b.eventos.filter((e) => e === 'lejos'), ['lejos']);

  const antes = correr(m, 2650, 3550, 50, cara({ tam: 0.3 }), 2); // 900 ms con dos caras
  assert.ok(!antes.eventos.includes('dos_personas'), 'no antes de 1 s');
  const dos = correr(m, 3600, 3800, 50, cara({ tam: 0.3 }), 2);
  assert.equal(dos.eventos.filter((e) => e === 'dos_personas').length, 1);
  assert.equal(dos.escena.personas, 2);
  assert.match(dos.escena.descripcion, /^Veo a dos personas/);
});

test('mira / aparta_mirada según yaw-pitch; cabeza describe la dirección', () => {
  const m = new MaquinaEscena();
  const a = correr(m, 0, 1000, 50, cara({ yaw: 0, pitch: 0 }));
  assert.ok(a.escena.principal?.mirando);
  const b = correr(m, 1050, 1600, 50, cara({ yaw: 40, pitch: 0 }));
  assert.ok(b.eventos.includes('aparta_mirada'));
  assert.equal(b.escena.principal?.mirando, false);
  assert.equal(b.escena.principal?.cabeza, 'derecha');
  const c = correr(m, 1650, 2200, 50, cara({ yaw: 5, pitch: 3 }));
  assert.ok(c.eventos.includes('mira'));
  assert.equal(cabezaDesde(-30, 0), 'izquierda');
  assert.equal(cabezaDesde(0, 25), 'arriba');
  assert.equal(cabezaDesde(0, -25), 'abajo');
  assert.equal(cabezaDesde(3, -3), 'centro');
});

test('ojos cerrados solo si el parpadeo se sostiene 0.4 s', () => {
  const m = new MaquinaEscena();
  correr(m, 0, 1000, 50, cara());
  const a = correr(m, 1050, 1300, 50, cara({ parpadeo: 0.9 })); // 250 ms
  assert.equal(a.escena.principal?.ojosCerrados, false);
  const b = correr(m, 1350, 1600, 50, cara({ parpadeo: 0.9 })); // ya 550 ms
  assert.equal(b.escena.principal?.ojosCerrados, true);
  assert.match(b.escena.descripcion, /ojos cerrados/);
});

test('motor ninguno → escena apagada', () => {
  const m = new MaquinaEscena();
  const e = m.procesar({ ts: 0, motor: 'ninguno', personas: 0, cara: null });
  assert.equal(e.motor, 'ninguno');
  assert.equal(e.descripcion, 'La cámara está apagada.');
});

// ---- mediapipe: giro relativo a la posición en el cuadro y sorpresa ---------------------------------

/** Malla sintética: 468 puntos alrededor de (cx0, cy0); nariz desplazada según ratioX (0.5 = frontal). */
function mallaSintetica(cx0: number, cy0: number, ratioX = 0.5, w = 0.1, h = 0.15) {
  const lm: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < 468; i++) lm.push({ x: cx0, y: cy0, z: 0 });
  lm[33] = { x: cx0 - w, y: cy0 - 0.02, z: 0 }; // ojo derecho de la persona (izquierda del cuadro)
  lm[263] = { x: cx0 + w, y: cy0 - 0.02, z: 0 }; // ojo izquierdo
  lm[10] = { x: cx0, y: cy0 - h, z: 0 }; // frente
  lm[152] = { x: cx0, y: cy0 + h, z: 0 }; // barbilla
  lm[1] = { x: cx0 - w + ratioX * 2 * w, y: cy0 - h + 0.55 * 2 * h, z: 0 }; // nariz
  return lm;
}

/** Matriz 4x4 column-major con giro yaw (grados) alrededor de Y y traslación opcional. */
function matrizYaw(yawGrados: number, tx = 0, ty = 0, tz = -50) {
  const r = (yawGrados * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  // columnas: [c 0 -s 0] [0 1 0 0] [s 0 c 0] [tx ty tz 1]
  return { rows: 4, columns: 4, data: [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, tx, ty, tz, 1] };
}

const resultado = (lm: ReturnType<typeof mallaSintetica>, mat: ReturnType<typeof matrizYaw>, bs: Array<[string, number]> = []) =>
  ({
    faceLandmarks: [lm],
    faceBlendshapes: [{ categories: bs.map(([categoryName, score], index) => ({ index, score, categoryName, displayName: '' })), headIndex: 0, headName: '' }],
    facialTransformationMatrixes: [mat],
  }) as any;

test('anguloEsperado: persona a la izquierda del cuadro mira a la cámara girando a SU izquierda (yaw<0)', () => {
  const izq = anguloEsperado(0.2, 0.5);
  assert.ok(izq.yaw < -15 && izq.yaw > -25, `yaw esperado ≈ -19°, fue ${izq.yaw}`);
  assert.ok(Math.abs(izq.pitch) < 0.01);
  const der = anguloEsperado(0.8, 0.5);
  assert.ok(Math.abs(der.yaw + izq.yaw) < 1e-9, 'simétrico');
  assert.ok(anguloEsperado(0.5, 0.2).pitch < 0, 'arriba del cuadro → baja la cabeza (pitch<0)');
  assert.ok(anguloEsperado(0.5, 0.8).pitch > 0);
  assert.deepEqual(anguloEsperado(0.5, 0.5), { yaw: 0, pitch: 0 });
  // Con un video más ancho el FOV vertical es menor
  assert.ok(Math.abs(anguloEsperado(0.5, 0.2, 16 / 9).pitch) < Math.abs(anguloEsperado(0.5, 0.2, 4 / 3).pitch));
});

test('observacionDesdeResultado descuenta la posición: a un lado mirando la pantalla → yaw ≈ 0', () => {
  // Persona a la izquierda del cuadro (cx 0.2), girada hacia SU izquierda justo lo que hace falta para mirar a la cámara.
  const esperado = anguloEsperado(0.2, 0.5).yaw; // ≈ -19°
  const ratioX = 0.5 - esperado / 120; // geometría de landmarks: yaw = (0.5 - ratioX) * 120
  const lm = mallaSintetica(0.2, 0.5, ratioX);
  assert.ok(anguloDesdeLandmarks(lm).yaw < -10, 'la geometría marca giro a su izquierda');
  const o = observacionDesdeResultado(resultado(lm, matrizYaw(esperado, -20, 0, -60)), 100);
  assert.ok(o.cara);
  assert.ok(Math.abs(o.cara!.cx - 0.2) < 1e-6);
  assert.ok(Math.abs(o.cara!.yaw) < 3, `yaw relativo ≈ 0, fue ${o.cara!.yaw}`);
  assert.equal(cabezaDesde(o.cara!.yaw, o.cara!.pitch), 'centro');

  // La misma persona con la cabeza recta (paralela al eje de la cámara) mira más allá de la pantalla, hacia SU derecha.
  const recto = observacionDesdeResultado(resultado(mallaSintetica(0.2, 0.5, 0.5), matrizYaw(0, -20, 0, -60)), 200);
  assert.ok(recto.cara!.yaw > 15, `yaw relativo ≈ +19°, fue ${recto.cara!.yaw}`);
  assert.equal(cabezaDesde(recto.cara!.yaw, recto.cara!.pitch), 'derecha');

  // Centrada y frontal: sin corrección
  const centro = observacionDesdeResultado(resultado(mallaSintetica(0.5, 0.5, 0.5), matrizYaw(0)), 300);
  assert.ok(Math.abs(centro.cara!.yaw) < 1e-6 && Math.abs(centro.cara!.pitch) < 1e-6);
  assert.equal(centro.personas, 1);
});

test('sorpresa exige cejas: boca abierta sola no llega al umbral de la frase', () => {
  const lm = mallaSintetica(0.5, 0.5);
  const soloBoca = observacionDesdeResultado(resultado(lm, matrizYaw(0), [['jawOpen', 0.9]]), 1);
  assert.ok(soloBoca.cara!.sorpresa < 0.5, `sin cejas no es sorpresa, fue ${soloBoca.cara!.sorpresa}`);
  assert.ok(soloBoca.cara!.bocaAbierta > 0.8);
  const conCejas = observacionDesdeResultado(resultado(lm, matrizYaw(0), [['jawOpen', 0.7], ['browInnerUp', 0.7], ['eyeWideLeft', 0.5], ['eyeWideRight', 0.5]]), 2);
  assert.ok(conCejas.cara!.sorpresa >= 0.5, `con cejas y ojos abiertos sí, fue ${conCejas.cara!.sorpresa}`);
  const d = describirEscena({ personas: 1, principal: principalBase({ sorpresa: soloBoca.cara!.sorpresa, bocaAbierta: 0.9 }), motor: 'mediapipe' });
  assert.match(d, /boca abierta/);
  assert.doesNotMatch(d, /sorpresa/);
});

// ---- ronda de corrección: dos_personas con salida, cambiarMotor sin hueco, giro estable ------------

test('dos_personas no se repite si la segunda cara parpadea (histéresis de salida 1.5 s)', () => {
  // 1) un cuadro con una sola cara cada 1.2 s durante 12 s → un solo evento
  const m = new MaquinaEscena();
  const ev: string[] = [];
  for (let t = 0; t <= 12000; t += 50) {
    const dos = t % 1200 !== 0;
    ev.push(...m.procesar(obs(t, cara(), dos ? 2 : 1)).eventos);
  }
  assert.equal(ev.filter((e) => e === 'dos_personas').length, 1, `flicker: ${ev.join(',')}`);
  assert.equal(m.escena!.personas, 1, 'el cuadro de flicker publica lo contado (1) sin perder la presencia');
  assert.equal(m.procesar(obs(12050, cara(), 2)).personas, 2);

  // 2) segunda cara estable, corte de 300 ms y vuelve → no se repite
  const m2 = new MaquinaEscena();
  const ev2: string[] = [];
  ev2.push(...correr(m2, 0, 3000, 50, cara(), 2).eventos);
  ev2.push(...correr(m2, 3050, 3300, 50, cara(), 1).eventos);
  ev2.push(...correr(m2, 3350, 6000, 50, cara(), 2).eventos);
  assert.equal(ev2.filter((e) => e === 'dos_personas').length, 1, `corte 300 ms: ${ev2.join(',')}`);

  // 3) si la segunda persona falta ≥ 1.5 s y vuelve, sí se vuelve a anunciar (tras otro 1 s estable)
  ev2.length = 0;
  ev2.push(...correr(m2, 6050, 7700, 50, cara(), 1).eventos); // 1.65 s con una cara
  ev2.push(...correr(m2, 7750, 8700, 50, cara(), 2).eventos); // 0.95 s: aún no
  assert.ok(!ev2.includes('dos_personas'));
  ev2.push(...correr(m2, 8750, 9000, 50, cara(), 2).eventos);
  assert.equal(ev2.filter((e) => e === 'dos_personas').length, 1);
  assert.equal(UMBRALES.dosPersonasOffMs, 1500);
});

test('cambiarMotor conserva la última cara: nunca personas 1 con principal null', () => {
  const m = new MaquinaEscena();
  for (let t = 0; t <= 2000; t += 50) m.procesar({ ts: t, motor: 'optico', personas: 1, cara: cara() });
  m.cambiarMotor();
  // El motor nuevo todavía no ve la cara durante unos cuadros
  const hueco = correr(m, 2050, 2500, 50, null);
  assert.equal(hueco.escena.personas, 1);
  assert.ok(hueco.escena.principal, 'principal congelado del motor anterior');
  assert.notEqual(hueco.escena.descripcion, 'No veo a nadie ahora.');
  assert.ok(!hueco.eventos.includes('se_fue') && !hueco.eventos.includes('llego'));
  const ve = m.procesar(obs(2550, cara({ cx: 0.3 })));
  assert.ok(ve.principal && ve.principal.x > 0, 'posición fresca del motor nuevo');
  assert.deepEqual(ve.eventos.filter((e) => e === 'llego'), []);
});

test('combinarAngulo: con geometría ≈ 0 no toma el signo del ruido; continuo entre 5° y 10°', () => {
  assert.equal(combinarAngulo(0.5, 10), 0.5);
  assert.equal(combinarAngulo(-0.5, 10), -0.5);
  assert.equal(combinarAngulo(4.9, 12), 4.9);
  assert.ok(Math.abs(combinarAngulo(20, 25) - 25) < 1e-9, 'giro claro: magnitud de la matriz');
  assert.ok(Math.abs(combinarAngulo(-20, 25) + 25) < 1e-9, 'signo de la geometría');
  assert.equal(combinarAngulo(30, undefined), 30);
  // continuidad: pasos pequeños de geometría → pasos pequeños de salida
  let prev = combinarAngulo(4, 14);
  for (let g = 4.1; g <= 11; g += 0.1) {
    const v = combinarAngulo(g, 14);
    assert.ok(Math.abs(v - prev) < 0.5, `salto de ${prev} a ${v} en geo ${g}`);
    prev = v;
  }
  // observación completa: cara centrada, geometría ±0.5° alternando, matriz 10° → yaw estable ≈ 0
  const yaws: number[] = [];
  for (let i = 0; i < 6; i++) {
    const ratioX = 0.5 - (i % 2 ? 0.5 : -0.5) / 120;
    const o = observacionDesdeResultado(resultado(mallaSintetica(0.5, 0.5, ratioX), matrizYaw(10)), i + 1);
    yaws.push(o.cara!.yaw);
  }
  assert.ok(yaws.every((y) => Math.abs(y) < 1), `yaw estable, fueron ${yaws.map((y) => y.toFixed(2)).join(' ')}`);
});

test('la máquina alisa el giro: un yaw que alterna 0/38 cuadro a cuadro no hace saltar cabeza', () => {
  const m = new MaquinaEscena();
  correr(m, 0, 1000, 50, cara({ yaw: 20 }));
  const cabezas = new Set<string>();
  for (let t = 1050; t <= 2500; t += 50) {
    const e = m.procesar(obs(t, cara({ yaw: t % 100 === 0 ? 38 : 0 })));
    if (t >= 1600) cabezas.add(e.principal!.cabeza);
  }
  assert.equal(cabezas.size, 1, `cabeza estable, fue ${[...cabezas].join('/')}`);
  assert.equal(UMBRALES.alisadoGiro, 0.35);
});

// ---- respaldo óptico: una sala vacía no es nadie ----------------------------------------------

function cuadro(W: number, H: number, f: (x: number, y: number) => [number, number, number]) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const [r, g, b] = f(x, y);
      const i = (y * W + x) * 4;
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
  return d;
}

test('óptico: cuadro gris uniforme y estático → sin energía (personas 0) aunque sea claro', () => {
  const W = 64,
    H = 48;
  const gris = cuadro(W, H, () => [128, 128, 128]);
  const e0 = analizarCuadro(gris, null, W, H);
  assert.ok(e0.totalWeight > 1000, 'el peso por luminancia solo era lo que antes bastaba para «alguien»');
  assert.ok(e0.desvioLum < 0.01);
  assert.equal(e0.pixelesMovidos, 0);
  const mem = new MemoriaMovimiento();
  let detectado = false;
  for (let t = 0; t <= 5000; t += 60) {
    const e = analizarCuadro(gris, gris, W, H);
    if (tieneEnergia(e, mem.registrar(t, e.pixelesMovidos))) detectado = true;
  }
  assert.equal(detectado, false, 'gris uniforme nunca detecta');
});

test('óptico: textura + movimiento sostenido sí detecta; un solo cuadro con ruido no; se apaga sin movimiento', () => {
  const W = 64,
    H = 48;
  const escena = (dx: number) => cuadro(W, H, (x, y) => (Math.abs(x - 32 - dx) < 8 && Math.abs(y - 22) < 12 ? [200, 170, 150] : [40, 40, 45]));
  const mem = new MemoriaMovimiento();
  // un solo cuadro con cambio no basta
  let e = analizarCuadro(escena(2), escena(0), W, H);
  assert.ok(e.pixelesMovidos >= UMBRALES_OPTICO.pixelesMovidosMin);
  assert.ok(e.desvioLum >= UMBRALES_OPTICO.texturaMin, `textura ${e.desvioLum}`);
  assert.equal(tieneEnergia(e, mem.registrar(0, e.pixelesMovidos)), false, 'un cuadro con movimiento no basta');
  // tres cuadros con movimiento en 3 s → detecta
  e = analizarCuadro(escena(4), escena(2), W, H);
  mem.registrar(500, e.pixelesMovidos);
  e = analizarCuadro(escena(6), escena(4), W, H);
  assert.equal(tieneEnergia(e, mem.registrar(1000, e.pixelesMovidos)), true);
  // quieto 1 s: sigue (ventana de 3 s)
  e = analizarCuadro(escena(6), escena(6), W, H);
  assert.equal(tieneEnergia(e, mem.registrar(2000, 0)), true);
  // quieto > 3 s desde el último movimiento: se apaga
  assert.equal(tieneEnergia(e, mem.registrar(4100, 0)), false);
  // póster con textura pero sin movimiento: nunca
  const mem2 = new MemoriaMovimiento();
  let poster = false;
  for (let t = 0; t <= 6000; t += 60) {
    const p = analizarCuadro(escena(0), escena(0), W, H);
    if (tieneEnergia(p, mem2.registrar(t, p.pixelesMovidos))) poster = true;
  }
  assert.equal(poster, false);
});

// ---- versión del paquete: JS (npm) y WASM (CDN) alineados -----------------------------------------

test('MEDIAPIPE_VERSION coincide con package.json (exacta, sin ^) y con node_modules', () => {
  const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'));
  const dep = pkg.dependencies['@mediapipe/tasks-vision'];
  assert.equal(dep, MEDIAPIPE_VERSION, 'package.json debe fijar la versión exacta que usa la URL del WASM');
  const instalada = JSON.parse(fs.readFileSync(path.join(raiz, 'node_modules/@mediapipe/tasks-vision/package.json'), 'utf8')).version;
  assert.equal(instalada, MEDIAPIPE_VERSION);
});
