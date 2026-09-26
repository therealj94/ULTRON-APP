/**
 * La cámara del teléfono con ML Kit sobre fotos (mobile/src/components/CamaraVision.tsx, 4.3).
 *
 * Lo puro vive en mobile/src/lib/escena.ts: qué tamaño de foto pedir (chico, no el del sensor) y cómo
 * una cara de ML Kit llega a ser la mirada de AU-RA. Aquí se comprueba el camino entero sin teléfono.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { LADO_CORTO_MIN, MaquinaEscena, UMBRALES, UMBRALES_FOTOS, caraDeMlkit, elegirTamano, observacionMlkit, type CaraFoto } from '../mobile/src/lib/escena';

test('pide la foto más chica que alcanza, no la del sensor', () => {
  const tamanos = ['4000x3000', '1920x1080', '1280x960', '1280x720', '640x480', '320x240'];
  assert.equal(elegirTamano(tamanos), '1280x720');
  assert.equal(elegirTamano(['4032x3024', '1600x1200', '960x720']), '960x720');
  // Si ninguno llega al mínimo, el más grande que haya.
  assert.equal(elegirTamano(['640x480', '320x240']), '640x480');
  // Basura o lista vacía: se queda el de fábrica.
  assert.equal(elegirTamano([]), null);
  assert.equal(elegirTamano(['auto', 'x', '0x0']), null);
  assert.equal(LADO_CORTO_MIN, 720);
});

test('la cara de ML Kit se traduce sin perder nada y con -1 cuando no clasificó', () => {
  const f: CaraFoto = { frame: { left: 100, top: 50, width: 200, height: 220 }, rotationX: 5, rotationY: -12, rotationZ: 2, smilingProbability: 0.8 };
  const c = caraDeMlkit(f);
  assert.deepEqual(c.bounds, { x: 100, y: 50, width: 200, height: 220 });
  assert.equal(c.yawAngle, -12);
  assert.equal(c.pitchAngle, 5);
  assert.equal(c.smilingProbability, 0.8);
  assert.equal(c.leftEyeOpenProbability, -1);
  const rara = caraDeMlkit({ frame: { left: 0, top: 0, width: 10, height: 10 }, rotationX: NaN, rotationY: Infinity, rotationZ: 0 });
  assert.equal(rara.yawAngle, 0);
  assert.equal(rara.pitchAngle, 0);
});

test('camino entero: una cara a un lado de la foto hace que la mirada vaya hacia ese lado (espejada)', () => {
  const W = 1280;
  const H = 720;
  const maquina = new MaquinaEscena(UMBRALES_FOTOS);
  // Cara en el tercio IZQUIERDO de la foto sin espejar = a la DERECHA de AU-RA vista de frente.
  const izquierda: CaraFoto = { frame: { left: 150, top: 250, width: 220, height: 240 }, rotationX: 0, rotationY: 0, rotationZ: 0 };
  let e = maquina.procesar(observacionMlkit([caraDeMlkit(izquierda)], W, H, 'portrait', 1000), { inmediato: true });
  for (let t = 1100; t < 2500; t += 330) e = maquina.procesar(observacionMlkit([caraDeMlkit(izquierda)], W, H, 'portrait', t));
  assert.equal(e.personas, 1);
  assert.ok(e.principal, 'hay persona principal');
  assert.ok(e.principal!.x > 0.3, `x espejada hacia el lado de la persona (${e.principal!.x})`);

  // Se mueve al otro lado: la mirada la sigue.
  const derecha: CaraFoto = { ...izquierda, frame: { ...izquierda.frame, left: 900 } };
  for (let t = 2600; t < 5000; t += 330) e = maquina.procesar(observacionMlkit([caraDeMlkit(derecha)], W, H, 'portrait', t));
  assert.ok(e.principal!.x < -0.3, `la sigue al otro lado (${e.principal!.x})`);

  // Arriba o abajo en la foto: y negativa arriba.
  const arriba: CaraFoto = { ...izquierda, frame: { left: 530, top: 20, width: 220, height: 240 } };
  for (let t = 5100; t < 7500; t += 330) e = maquina.procesar(observacionMlkit([caraDeMlkit(arriba)], W, H, 'portrait', t));
  assert.ok(e.principal!.y < -0.2, `arriba es y negativa (${e.principal!.y})`);
});

test('sin caras durante un rato, la escena dice que se fue', () => {
  const maquina = new MaquinaEscena(UMBRALES_FOTOS);
  const cara: CaraFoto = { frame: { left: 500, top: 200, width: 220, height: 240 }, rotationX: 0, rotationY: 0, rotationZ: 0 };
  let e = maquina.procesar(observacionMlkit([caraDeMlkit(cara)], 1280, 720, 'portrait', 0), { inmediato: true });
  for (let t = 330; t < 2000; t += 330) e = maquina.procesar(observacionMlkit([caraDeMlkit(cara)], 1280, 720, 'portrait', t));
  assert.equal(e.personas, 1);
  let fue = false;
  for (let t = 2000; t < 20_000; t += 1000) {
    e = maquina.procesar(observacionMlkit([], 1280, 720, 'portrait', t));
    if (e.eventos.includes('se_fue')) fue = true;
  }
  assert.equal(e.personas, 0);
  assert.ok(fue, 'emite se_fue');
});

test('al ritmo real de las fotos (≈0,6-0,8 s con ML Kit) llega y se va; con los umbrales de cuadros no', () => {
  const cara: CaraFoto = { frame: { left: 500, top: 200, width: 220, height: 240 }, rotationX: 0, rotationY: 0, rotationZ: 0 };
  const correr = (m: MaquinaEscena) => {
    const eventos: string[] = [];
    let t = 0;
    for (let i = 0; i < 8; i++, t += 700) eventos.push(...m.procesar(observacionMlkit([caraDeMlkit(cara)], 1280, 720, 'portrait', t)).eventos);
    for (let i = 0; i < 8; i++, t += 1000) eventos.push(...m.procesar(observacionMlkit([], 1280, 720, 'portrait', t)).eventos);
    return eventos;
  };
  const fotos = correr(new MaquinaEscena(UMBRALES_FOTOS));
  assert.ok(fotos.includes('llego'), `con UMBRALES_FOTOS llega (${fotos})`);
  assert.ok(fotos.includes('se_fue'), `con UMBRALES_FOTOS se va (${fotos})`);
  const cuadros = correr(new MaquinaEscena(UMBRALES));
  assert.ok(!cuadros.includes('llego'), 'con los umbrales de cuadros no llegaba nunca: por eso existen los de fotos');
});
