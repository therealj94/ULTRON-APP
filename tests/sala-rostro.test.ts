/** El rostro de AU-RA (src/11-sala/rostro.ts): qué cara pone cada emoción y cómo se anima. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Rostro, rasgosDe, RASGOS_BASE, type Pulso } from '../src/11-sala/rostro';
import type { Animo } from '../src/11-sala/tareas';

const ANIMOS: Animo[] = ['neutral', 'feliz', 'orgullo', 'risa', 'sorpresa', 'alarma', 'curioso', 'escepticismo', 'pensando', 'preocupado', 'triste', 'molesto', 'cansado', 'carino', 'travieso', 'canto', 'oracion', 'escuchando', 'dormido', 'firme', 'seco'];

test('cada emoción da una cara válida (todo dentro de rango)', () => {
  for (const a of ANIMOS) {
    const { rasgos: r } = rasgosDe(a);
    assert.ok(r.abre >= 0 && r.abre <= 1.4, `${a}: abre`);
    assert.ok(r.feliz >= 0 && r.feliz <= 1, `${a}: feliz`);
    assert.ok(r.ceja >= -1 && r.ceja <= 1, `${a}: ceja`);
    assert.ok(r.bocaCurva >= -1 && r.bocaCurva <= 1, `${a}: bocaCurva`);
    assert.ok(r.bocaAbre >= 0 && r.bocaAbre <= 1, `${a}: bocaAbre`);
    assert.ok(r.brillo > 0 && r.brillo <= 1.5, `${a}: brillo`);
    assert.ok(r.tono.every((c) => c >= 0 && c <= 255), `${a}: tono`);
  }
});

test('las emociones se distinguen: alegría en arco, tristeza con lágrima, enojo con ceja baja', () => {
  const c = (a: Animo) => rasgosDe(a);
  assert.ok(c('feliz').rasgos.feliz > 0.6 && c('feliz').rasgos.bocaCurva > 0.8, 'feliz: ojos en «^» y sonrisa');
  assert.ok(c('triste').rasgos.ceja < -0.8 && c('triste').rasgos.lagrima > 0.5 && c('triste').rasgos.bocaCurva < -0.5, 'triste');
  assert.ok(c('molesto').rasgos.ceja > 0.8 && c('molesto').rasgos.bocaCurva < 0, 'molesto');
  assert.ok(c('sorpresa').rasgos.abre > 1.1 && c('sorpresa').rasgos.bocaO > 0.5, 'sorpresa: ojos grandes y «o»');
  assert.ok(c('pensando').rasgos.miraY < -0.3, 'pensando mira arriba');
  assert.ok(c('travieso').rasgos.guino > 0.9, 'travieso guiña');
  assert.equal(c('risa').especial, 'risa');
  assert.equal(c('carino').especial, 'corazones');
  assert.equal(c('dormido').especial, 'dormido');
  assert.equal(c('neutral').especial, 'ninguno');
  assert.deepEqual(c('neutral').rasgos.tono, RASGOS_BASE.tono);
  // Cada emoción devuelve un objeto nuevo: cambiarlo no toca la tabla.
  c('feliz').rasgos.tono[0] = 0;
  assert.notEqual(c('feliz').rasgos.tono[0], 0);
});

const quieto: Pulso = { habla: false, nivel: 0, conAudio: false, mirarX: 0, mirarY: 0 };
function rostro(semilla = 1) {
  let s = semilla;
  const azar = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return new Rostro({ luz: true, tinta: '#1E1D1C', mejilla: '#D9BDB1', ojoY: 0.4, bocaY: 0.7, separacion: 0.16, ojoAlto: 0.4, ojoAncho: 0.6, azar });
}

test('llega a la cara de la emoción con suavidad (no de golpe)', () => {
  const r = rostro();
  const triste = rasgosDe('triste');
  r.avanzar(1 / 60, triste, quieto);
  const primero = r.estadoActual().rasgos.ceja;
  assert.ok(primero < 0 && primero > -0.5, 'un cuadro después va en camino, no llegó');
  for (let i = 0; i < 180; i++) r.avanzar(1 / 60, triste, quieto);
  assert.ok(r.estadoActual().rasgos.ceja < -0.95, 'en 3 s llegó');
  // Los ojos especiales entran y salen rápido.
  for (let i = 0; i < 60; i++) r.avanzar(1 / 60, rasgosDe('carino'), quieto);
  assert.ok(r.estadoActual().pesos.corazones > 0.95);
  for (let i = 0; i < 60; i++) r.avanzar(1 / 60, rasgosDe('neutral'), quieto);
  assert.ok(r.estadoActual().pesos.corazones < 0.01, 'en 1 s ya no quedan corazones');
});

test('parpadea con ritmo humano, pero nunca con los ojos cerrados o especiales', () => {
  const r = rostro(7);
  let parpadeos = 0;
  let antes = false;
  for (let i = 0; i < 60 * 20; i++) {
    r.avanzar(1 / 60, rasgosDe('neutral'), quieto);
    const p = r.estadoActual().parpadeando;
    if (p && !antes) parpadeos++;
    antes = p;
  }
  assert.ok(parpadeos >= 3 && parpadeos <= 12, `20 s: ${parpadeos} parpadeos`);
  const d = rostro(7);
  let alguno = false;
  for (let i = 0; i < 60 * 20; i++) {
    d.avanzar(1 / 60, rasgosDe('dormido'), quieto);
    alguno ||= d.estadoActual().parpadeando;
  }
  assert.equal(alguno, false, 'dormida no parpadea');
});

test('la boca sigue el nivel de la voz de verdad y se cierra al callar', () => {
  const r = rostro();
  for (let i = 0; i < 20; i++) r.avanzar(1 / 60, rasgosDe('neutral'), { ...quieto, habla: true, conAudio: true, nivel: 0.8 });
  assert.ok(r.estadoActual().boca > 0.8, 'abierta con la voz');
  for (let i = 0; i < 20; i++) r.avanzar(1 / 60, rasgosDe('neutral'), { ...quieto, habla: true, conAudio: true, nivel: 0 });
  assert.ok(r.estadoActual().boca < 0.1, 'cerrada en el silencio entre palabras');
  for (let i = 0; i < 60; i++) r.avanzar(1 / 60, rasgosDe('neutral'), quieto);
  assert.ok(r.estadoActual().boca < 0.02);
});

/** Un contexto 2D falso: acepta todo y cuenta lo que se dibuja (Node no tiene canvas). */
function contextoFalso() {
  const cuenta = { fill: 0, stroke: 0, drawImage: 0 };
  const grad = { addColorStop() {} };
  const ctx: any = new Proxy(
    {},
    {
      get(_t, k) {
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
        if (k in cuenta) return () => void (cuenta as any)[k]++;
        if (k === 'canvas') return { width: 640, height: 360 };
        return typeof k === 'string' && /^[a-z]/.test(k) && !['fillStyle', 'strokeStyle', 'globalAlpha', 'lineWidth', 'shadowBlur', 'shadowColor', 'globalCompositeOperation', 'lineCap', 'lineJoin'].includes(k) ? () => {} : undefined;
      },
      set() {
        return true;
      },
    }
  );
  return { ctx, cuenta };
}

test('dibuja todas las emociones sin fallar (con ojos de luz y pintados)', () => {
  const g = globalThis as any;
  const antes = g.OffscreenCanvas;
  g.OffscreenCanvas = class {
    width: number;
    height: number;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
    }
    getContext() {
      return contextoFalso().ctx;
    }
  };
  try {
    for (const luz of [true, false]) {
      const r = new Rostro({ luz, tinta: '#1E1D1C', mejilla: '#D9BDB1', ojoY: 0.4, bocaY: 0.7, separacion: 0.16, ojoAlto: 0.4, ojoAncho: 0.6, azar: () => 0.5 });
      for (const a of ANIMOS) {
        const { ctx, cuenta } = contextoFalso();
        for (let i = 0; i < 30; i++) r.avanzar(1 / 30, rasgosDe(a), { habla: a === 'canto', nivel: 0.6, conAudio: true, mirarX: 0.3, mirarY: -0.2 });
        r.dibujar(ctx, 640, 360);
        assert.ok(cuenta.fill + cuenta.stroke + cuenta.drawImage > 0, `${a} (${luz ? 'luz' : 'pintada'}): dibujó algo`);
      }
    }
  } finally {
    g.OffscreenCanvas = antes;
  }
});
