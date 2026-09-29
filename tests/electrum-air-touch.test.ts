/**
 * Air touch: de los 21 puntos de la mano a gestos. Manos sintéticas con la forma de las de
 * MediaPipe (0..1 del cuadro, la muñeca abajo), sin cámara.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIC_MS, crearGestos, leerMano, PUNO_MS, type Punto } from '../src-electrum/manos/gestos';

type Forma = 'abierta' | 'pinza' | 'puno' | 'señala';

/** Una mano en (x, y) = nudillos; la muñeca 0,15 más abajo. */
function mano(forma: Forma, x = 0.5, y = 0.5): Punto[] {
  const p: Punto[] = new Array(21);
  p[0] = { x, y: y + 0.15 };
  const bases = [-0.03, -0.01, 0.01, 0.03];
  const estirados = forma === 'abierta' ? [1, 1, 1, 1] : forma === 'señala' ? [1, 0, 0, 0] : forma === 'pinza' ? [1, 1, 1, 1] : [0, 0, 0, 0];
  bases.forEach((bx, k) => {
    const i = 5 + k * 4;
    const cx = x + bx;
    p[i] = { x: cx, y };
    if (estirados[k]) {
      p[i + 1] = { x: cx, y: y - 0.05 };
      p[i + 2] = { x: cx, y: y - 0.08 };
      p[i + 3] = { x: cx, y: y - 0.11 };
    } else {
      p[i + 1] = { x: cx, y: y - 0.03 };
      p[i + 2] = { x: cx, y: y };
      p[i + 3] = { x: cx, y: y + 0.03 };
    }
  });
  p[1] = { x: x - 0.05, y: y + 0.1 };
  p[2] = { x: x - 0.07, y: y + 0.06 };
  p[3] = { x: x - 0.08, y: y + 0.02 };
  p[4] =
    forma === 'pinza'
      ? { x: p[8].x - 0.004, y: p[8].y + 0.004 }
      : forma === 'puno'
        ? { x: x - 0.01, y: y - 0.02 }
        : { x: x - 0.12, y: y - 0.02 };
  return p;
}

test('air touch: lee pellizco, puño y palma', () => {
  assert.equal(leerMano(mano('pinza'))!.pinza, true);
  assert.equal(leerMano(mano('abierta'))!.pinza, false);
  assert.equal(leerMano(mano('abierta'))!.palma, true);
  const puno = leerMano(mano('puno'))!;
  assert.equal(puno.puno, true);
  assert.equal(puno.pinza, false, 'un puño no es un pellizco');
  assert.equal(leerMano(mano('señala'))!.palma, false);
  assert.equal(leerMano([]), null);
});

test('air touch: pellizcar y soltar rápido es un toque; mover pellizcando arrastra', () => {
  const g = crearGestos();
  const W = 1000;
  const H = 800;
  g.procesar([mano('abierta')], 0, W, H);
  let ev = g.procesar([mano('pinza')], 30, W, H);
  assert.ok(ev.some((e) => e.tipo === 'bajar'));
  ev = g.procesar([mano('abierta')], 30 + CLIC_MS / 2, W, H);
  const suelta = ev.find((e) => e.tipo === 'soltar');
  assert.ok(suelta && suelta.tipo === 'soltar' && suelta.clic, 'toque');

  // Arrastre: pellizco que se mueve.
  const g2 = crearGestos();
  g2.procesar([mano('pinza', 0.5, 0.5)], 0, W, H);
  let arrastres = 0;
  let dxTotal = 0;
  for (let k = 1; k <= 12; k++) {
    for (const e of g2.procesar([mano('pinza', 0.5 - k * 0.02, 0.5)], k * 33, W, H)) {
      if (e.tipo === 'arrastrar') {
        arrastres++;
        dxTotal += e.dx;
      }
    }
  }
  assert.ok(arrastres > 3, `arrastres: ${arrastres}`);
  // La mano va a la izquierda del CUADRO = a la derecha de la persona: en espejo, el cursor va a la derecha.
  assert.ok(dxTotal > 0, `dx: ${dxTotal}`);
  const fin = g2.procesar([mano('abierta', 0.26, 0.5)], 500, W, H).find((e) => e.tipo === 'soltar');
  assert.ok(fin && fin.tipo === 'soltar' && !fin.clic, 'un arrastre no es un toque');
});

test('air touch: dos manos pellizcando que se abren hacen zoom', () => {
  const g = crearGestos();
  g.procesar([mano('pinza', 0.45, 0.5), mano('pinza', 0.55, 0.5)], 0, 1000, 800);
  const ev = g.procesar([mano('pinza', 0.35, 0.5), mano('pinza', 0.65, 0.5)], 33, 1000, 800);
  const z = ev.find((e) => e.tipo === 'zoom');
  assert.ok(z && z.tipo === 'zoom' && z.factor > 1.5, JSON.stringify(z));
  const ev2 = g.procesar([mano('pinza', 0.45, 0.5), mano('pinza', 0.55, 0.5)], 66, 1000, 800);
  const z2 = ev2.find((e) => e.tipo === 'zoom');
  assert.ok(z2 && z2.tipo === 'zoom' && z2.factor < 1);
});

test('air touch: puño sostenido cierra una sola vez; palma barriendo pasa al siguiente', () => {
  const g = crearGestos();
  let cierres = 0;
  for (let t = 0; t <= PUNO_MS * 2; t += 50) cierres += g.procesar([mano('puno')], t, 1000, 800).filter((e) => e.tipo === 'cerrar').length;
  assert.equal(cierres, 1);

  const g2 = crearGestos();
  const dirs: string[] = [];
  for (let k = 0; k <= 8; k++) {
    for (const e of g2.procesar([mano('abierta', 0.3 + k * 0.05, 0.5)], k * 40, 1000, 800)) if (e.tipo === 'deslizar') dirs.push(e.dir);
  }
  // La mano va a la derecha del cuadro = a la izquierda en pantalla (espejo).
  assert.deepEqual(dirs, ['izquierda']);
});

test('air touch: si la mano sale a medio arrastre, suelta sin tocar', () => {
  const g = crearGestos();
  g.procesar([mano('pinza')], 0, 1000, 800);
  const ev = g.procesar([], 40, 1000, 800);
  const s = ev.find((e) => e.tipo === 'soltar');
  assert.ok(s && s.tipo === 'soltar' && !s.clic);
});
