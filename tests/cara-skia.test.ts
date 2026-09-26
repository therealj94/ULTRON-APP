/**
 * La cara de anillos del teléfono (mobile/src/cara/estados.ts): qué estado se ve y dónde cae cada cosa.
 *
 * Es la parte pura de la cara Skia; el dibujo lo revisa scripts/qa/cara-skia.ts con CanvasKit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ESTADOS,
  OBJETIVOS,
  TEMAS,
  VIVO_QUIETO,
  disposicion,
  estadoDe,
  geometria,
  mezclar,
  mezclarHex,
  temaDeAcento,
  zonaDe,
} from '../mobile/src/cara/estados';

test('cada cara del cuerpo viejo cae en un estado de trabajo', () => {
  assert.equal(estadoDe({ face: 'IDLE' }), 'espera');
  assert.equal(estadoDe({ face: 'LISTENING' }), 'escucha');
  assert.equal(estadoDe({ face: 'THINKING' }), 'piensa');
  assert.equal(estadoDe({ face: 'SPEAKING' }), 'habla');
  assert.equal(estadoDe({ face: 'SING' }), 'habla');
  assert.equal(estadoDe({ face: 'HAPPY' }), 'listo');
  assert.equal(estadoDe({ face: 'SCAN' }), 'lee');
  assert.equal(estadoDe({ face: 'SLEEPING' }), 'duerme');
  assert.equal(estadoDe({ face: 'PRAY' }), 'duerme');
  // Lo que ya no existe: molesta y traviesa no se ven.
  assert.equal(estadoDe({ face: 'ANGRY' }), 'espera');
  assert.equal(estadoDe({ face: 'WINK' }), 'listo');
});

test('prioridades: hablar gana; la tarea se ve mientras no habla; sin red solo en reposo', () => {
  assert.equal(estadoDe({ face: 'SPEAKING', tarea: 'buscar', online: false, necesita: true }), 'habla');
  assert.equal(estadoDe({ face: 'THINKING', tarea: 'buscar' }), 'lee');
  assert.equal(estadoDe({ face: 'THINKING', tarea: 'leer' }), 'lee');
  assert.equal(estadoDe({ face: 'IDLE', tarea: 'enviar' }), 'trabaja');
  assert.equal(estadoDe({ face: 'IDLE', tarea: 'oro' }), 'trabaja');
  assert.equal(estadoDe({ face: 'IDLE', online: false }), 'sinred');
  assert.equal(estadoDe({ face: 'THINKING', online: false }), 'piensa');
  assert.equal(estadoDe({ face: 'IDLE', necesita: true }), 'necesita');
  assert.equal(estadoDe({ face: 'LISTENING', necesita: true }), 'escucha');
  assert.equal(estadoDe({ face: 'SLEEPING', tarea: 'buscar' }), 'duerme');
});

test('los 10 estados tienen objetivo y mezclar va de uno a otro sin salirse', () => {
  assert.equal(ESTADOS.length, 10);
  for (const e of ESTADOS) assert.ok(OBJETIVOS[e], e);
  const a = OBJETIVOS.espera;
  const b = OBJETIVOS.listo;
  assert.deepEqual(mezclar(a, b, 0), a);
  assert.deepEqual(mezclar(a, b, 1), b);
  assert.equal(mezclar(a, b, 0.5).sonrisa, 0.5);
  assert.deepEqual(mezclar(a, b, 7), b, 'la curva no pasa del destino');
});

test('la cara cabe en el teléfono acostado y parado, con las medidas del tablero', () => {
  for (const [W, H] of [
    [844, 390],
    [390, 844],
    [1280, 800],
  ]) {
    const L = disposicion(W, H);
    assert.ok(L.exL - L.d / 2 > 0 && L.exR + L.d / 2 < W, `ojos dentro a lo ancho en ${W}x${H}`);
    assert.ok(L.ey - L.d / 2 > 0 && L.bocaY < H, `ojos y boca dentro a lo alto en ${W}x${H}`);
    assert.ok(Math.abs(L.anillo - L.d * 0.09) < 1e-9);
    assert.ok(Math.abs(L.exR - L.exL - L.d * 1.52) < 1e-9, 'entre ojos 0,52 D');
  }
});

test('la mirada: el dedo manda, la lectura recorre y la pupila nunca sale del pozo', () => {
  const L = disposicion(844, 390);
  const inner = L.d - 2 * L.anillo;
  const dedo = geometria(OBJETIVOS.escucha, { ...VIVO_QUIETO, fueraX: -1, fueraY: 1, fuera: 1 }, L);
  assert.ok(dedo.izq.px < L.exL && dedo.izq.py > L.ey);
  const lee1 = geometria(OBJETIVOS.lee, { ...VIVO_QUIETO, fase: 1 }, L);
  const lee2 = geometria(OBJETIVOS.lee, { ...VIVO_QUIETO, fase: -1 }, L);
  assert.ok(lee1.izq.px > lee2.izq.px, 'al leer las pupilas van de lado a lado');
  for (const fx of [-5, 5]) {
    const g = geometria(OBJETIVOS.escucha, { ...VIVO_QUIETO, fueraX: fx, fueraY: fx, fuera: 1, sacadaX: fx }, L);
    const dist = Math.hypot(g.izq.px - L.exL, g.izq.py - L.ey) + g.izq.pr;
    assert.ok(dist <= inner / 2 + 1, `la pupila queda dentro del pozo (${dist.toFixed(1)} <= ${(inner / 2).toFixed(1)})`);
  }
});

test('párpados, anillo y boca según el estado', () => {
  const L = disposicion(844, 390);
  const espera = geometria(OBJETIVOS.espera, VIVO_QUIETO, L);
  assert.ok(espera.izq.tapaY + espera.izq.tapaR < L.ey - L.d / 2, 'en espera el párpado no toca el ojo');
  assert.ok(espera.izq.sonrisaY - espera.izq.sonrisaR > L.ey + L.d / 2, 'ni el de abajo');
  assert.equal(espera.arcoBarrido, 360);
  const duerme = geometria(OBJETIVOS.duerme, VIVO_QUIETO, L);
  assert.ok(duerme.izq.tapaY + duerme.izq.tapaR > L.ey + L.d * 0.4, 'dormida el párpado baja casi entero');
  const listo = geometria(OBJETIVOS.listo, VIVO_QUIETO, L);
  assert.ok(Math.abs(listo.izq.sonrisaY - listo.izq.sonrisaR - L.ey) < 1e-9, 'listo: el párpado de abajo llega a la mitad');
  const trabaja = geometria({ ...OBJETIVOS.trabaja, indeterminado: 0, progreso: 0.64 }, VIVO_QUIETO, L);
  assert.ok(Math.abs(trabaja.arcoBarrido - 0.64 * 360) < 1e-9);
  assert.equal(trabaja.arcoInicio, -90, 'la barra empieza arriba');
  const gira = geometria(OBJETIVOS.trabaja, { ...VIVO_QUIETO, giro: 90 }, L);
  assert.equal(gira.arcoInicio, 0, 'sin total conocido, el arco gira');
  const habla = geometria(OBJETIVOS.habla, { ...VIVO_QUIETO, voz: 0.8 }, L);
  assert.equal(habla.bocaAbierta, 0.8);
  assert.equal(geometria(OBJETIVOS.espera, { ...VIVO_QUIETO, voz: 0.8 }, L).bocaAbierta, 0, 'la voz solo abre la boca cuando habla');
});

test('la inclinación da profundidad: la pupila se mueve más que el anillo y éste más que el resplandor', () => {
  const L = disposicion(844, 390);
  const g = geometria(OBJETIVOS.espera, { ...VIVO_QUIETO, inclinX: 1 }, L);
  const pupila = g.izq.px - L.exL;
  assert.ok(pupila > g.izq.ax && g.izq.ax > g.izq.bx && g.izq.bx > 0);
});

test('zonas del tacto: las mismas que la cara vieja', () => {
  const L = disposicion(844, 390);
  assert.equal(zonaDe(L.exL, L.ey, L), 'eyeL');
  assert.equal(zonaDe(L.exR, L.ey, L), 'eyeR');
  assert.equal(zonaDe(L.cx, L.bocaY, L), 'mouth');
  assert.equal(zonaDe(L.cx, 2, L), 'forehead');
  assert.equal(zonaDe(L.cx, L.ey, L), 'cheek');
  assert.equal(zonaDe(4, L.H - 4, L), 'face');
});

test('temas: cian por omisión, un acento cualquiera da su propio tema, colores válidos', () => {
  assert.equal(temaDeAcento(), TEMAS.cian);
  assert.equal(temaDeAcento('#ffc27a'), TEMAS.ambar);
  const t = temaDeAcento('#e0a030');
  assert.equal(t.main, '#E0A030');
  for (const c of [t.hi, t.deep, t.fondo]) assert.match(c, /^#[0-9A-F]{6}$/);
  assert.equal(temaDeAcento('rojo'), TEMAS.cian, 'lo que no es color no rompe');
  assert.equal(mezclarHex('#000000', '#FFFFFF', 0.5), '#808080');
  assert.equal(mezclarHex('#3A4549', '#5CE1F7', 1), '#5CE1F7');
});
