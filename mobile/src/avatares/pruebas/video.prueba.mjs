/**
 * Pruebas en Node del cuerpo en video de Claudio y ANT-ONIO (sin teléfono):
 *   el guion (qué clip toca con cada estado, los golpes de una vez, su enfriamiento, cuándo vuelve al
 *   fondo, «reducir movimiento»), el encuadre (la franja de la cara se ve entera y sin huecos), la zona
 *   del toque, y que los 18 clips existen, son livianos y están en clips.ts.
 *
 *   cd mobile && npx tsx src/avatares/pruebas/video.prueba.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIPS_VIDEO, DirectorVideo, ENFRIAR_GOLPE_MS, GOLPE_ANTES_DE_HABLAR_MS, VENTANAS, encuadrar, esDeFondo, fondoDe, zonaVideo } from '../video/guion.ts';
import { ESTADO_INICIAL } from '../../avatar3d/tipos.ts';
import { estadoDesdeMesa } from '../../avatar3d/contrato.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const pruebas = [];
const prueba = (nombre, f) => pruebas.push([nombre, f]);
const est = (x = {}) => ({ ...ESTADO_INICIAL, ...x });

function reloj(t0 = 1_000_000) {
  let t = t0;
  return { ahora: () => t, pasar: (ms) => void (t += ms) };
}
const nuevo = (o = {}) => {
  const r = reloj();
  return { r, d: new DirectorVideo({ hay: CLIPS_VIDEO, ahora: r.ahora, ...o }) };
};

prueba('el fondo sigue al estado: habla > piensa > escucha > reposo', () => {
  assert.equal(fondoDe(est()), 'reposo');
  assert.equal(fondoDe(est({ escuchando: true })), 'escucha');
  assert.equal(fondoDe(est({ escuchando: true, pensando: true })), 'piensa');
  assert.equal(fondoDe(est({ expresion: 'piensa' })), 'piensa');
  assert.equal(fondoDe(est({ escuchando: true, pensando: true, hablando: true })), 'habla');
  for (const c of ['reposo', 'escucha', 'habla', 'piensa']) assert.ok(esDeFondo(c));
  for (const c of ['risa', 'saluda', 'senala', 'sorpresa', 'triste']) assert.ok(!esDeFondo(c));
});

prueba('con la mesa de verdad: escucha, piensa y habla, en bucle', () => {
  const { d } = nuevo();
  assert.equal(d.estado(estadoDesdeMesa('IDLE', 'neutral')), null, 'empieza en reposo: nada que cambiar');
  const e = d.estado(estadoDesdeMesa('LISTENING', 'neutral'));
  assert.deepEqual([e.clip, e.bucle], ['escucha', true]);
  assert.equal(d.estado(estadoDesdeMesa('THINKING', 'neutral')).clip, 'piensa');
  const h = d.estado(estadoDesdeMesa('SPEAKING', 'neutral'));
  assert.deepEqual([h.clip, h.bucle], ['habla', true]);
  assert.equal(d.estado(estadoDesdeMesa('SPEAKING', 'neutral')), null, 'el mismo estado no reinicia el clip');
  assert.equal(d.estado(estadoDesdeMesa('IDLE', 'neutral')).clip, 'reposo');
});

prueba('las emociones del turno hacen su golpe una vez y vuelven al fondo', () => {
  const { d, r } = nuevo();
  const g = d.estado(estadoDesdeMesa('SPEAKING', 'risa'));
  assert.deepEqual([g.clip, g.bucle], ['risa', false], 'se ríe primero');
  assert.equal(d.estado(estadoDesdeMesa('SPEAKING', 'risa')), null, 'la misma emoción no repite el golpe');
  r.pasar(5000);
  const f = d.termino(g.n);
  assert.deepEqual([f.clip, f.bucle], ['habla', true], 'terminado el golpe, sigue hablando');
  assert.equal(d.termino(g.n), null, 'un aviso viejo no hace nada');
  assert.equal(d.estado(estadoDesdeMesa('IDLE', 'sorpresa')).clip, 'sorpresa');
  r.pasar(5000);
  assert.equal(d.termino(d.reproduccion.n).clip, 'reposo');
  assert.equal(d.estado(estadoDesdeMesa('IDLE', 'triste')).clip, 'triste');
  const otro = nuevo().d;
  assert.equal(otro.estado(estadoDesdeMesa('IDLE', 'preocupado')).clip, 'triste', '«uy» (preocupado) también entristece');
});

prueba('el mismo golpe no se repite antes de enfriarse', () => {
  const { d, r } = nuevo();
  const risa = est({ expresion: 'encantada' });
  assert.equal(d.estado(risa).clip, 'risa');
  r.pasar(5000);
  d.termino(d.reproduccion.n);
  d.estado(est());
  assert.equal(d.estado(risa), null, 'a los 5 s no se vuelve a reír');
  d.estado(est());
  r.pasar(ENFRIAR_GOLPE_MS);
  assert.equal(d.estado(risa).clip, 'risa', 'pasado el enfriamiento, sí');
});

prueba('los gestos de cuerpo: saluda, señala y el toque da risa; cada pedido nuevo cuenta', () => {
  const { d, r } = nuevo();
  assert.equal(d.estado(est({ gesto: { nombre: 'saludar', n: 1 } })).clip, 'saluda');
  r.pasar(5000);
  d.termino(d.reproduccion.n);
  assert.equal(d.estado(est({ gesto: { nombre: 'saludar', n: 1 } })), null, 'el mismo pedido no se repite');
  assert.equal(d.estado(est({ gesto: { nombre: 'senalar', n: 2 } })).clip, 'senala');
  assert.equal(d.estado(est({ gesto: { nombre: 'toque_panza', n: 3 } })).clip, 'risa', 'un golpe nuevo reemplaza al que está');
  assert.equal(d.estado(est({ gesto: { nombre: 'enojo', n: 4 } })), null, 'sin clip para el enojo: sigue lo que había');
});

prueba('si empieza a hablar en medio de un golpe, lo deja terminar su gesto y luego habla', () => {
  const { d, r } = nuevo();
  d.golpe('saluda');
  r.pasar(500);
  assert.equal(d.estado(est({ hablando: true })), null, 'recién empezó el saludo');
  r.pasar(GOLPE_ANTES_DE_HABLAR_MS);
  assert.equal(d.estado(est({ hablando: true })).clip, 'habla', 'ya saludó lo suficiente: habla');
  assert.equal(d.golpe('habla'), null, 'un clip de fondo no es un golpe');
  assert.equal(d.golpe('saluda'), null, 'acaba de saludar: no repite');
});

prueba('«reducir movimiento»: sin golpes, solo los fondos', () => {
  const { d } = nuevo({ reducido: true });
  assert.equal(d.golpe('saluda'), null);
  assert.equal(d.estado(est({ expresion: 'encantada' })), null);
  assert.equal(d.estado(est({ hablando: true })).clip, 'habla');
});

prueba('si falta un clip: el fondo cae al reposo y el golpe no se hace', () => {
  const r = reloj();
  const d = new DirectorVideo({ hay: ['reposo', 'habla'], ahora: r.ahora });
  assert.equal(d.estado(est({ escuchando: true })), null, 'sin «escucha», sigue en reposo');
  assert.equal(d.estado(est({ expresion: 'encantada' })), null, 'sin «risa», nada');
  assert.equal(d.estado(est({ hablando: true })).clip, 'habla');
});

prueba('el encuadre llena el alto, no deforma y muestra la franja de la cara entera', () => {
  for (const avatar of ['claudio', 'antonio']) {
    for (const camara of ['retrato', 'cuerpo']) {
      const v = VENTANAS[avatar][camara];
      for (const [W, H] of [[300, 300], [390, 520], [844, 390], [390, 844], [120, 120]]) {
        const e = encuadrar(W, H, v);
        assert.ok(Math.abs(e.width / e.height - 9 / 16) < 1e-9, 'sin deformar');
        assert.ok(e.height >= H - 1e-6, `${avatar} ${camara} ${W}×${H}: cubre el alto`);
        if (W / H <= (9 / 16) / (v.y1 - v.y0)) assert.ok(e.width >= W - 1e-6, `${avatar} ${camara} ${W}×${H}: en una caja angosta cubre el ancho`);
        assert.ok(e.top <= 1e-6 && e.top + e.height >= H - 1e-6, 'sin huecos arriba ni abajo');
        assert.ok(Math.abs(e.left + e.width / 2 - W / 2) < 1e-6, 'centrado a lo ancho');
        if (camara === 'retrato') {
          // La cabeza (la parte de arriba de la franja) se ve siempre.
          const caraArriba = e.top + v.y0 * e.height;
          const caraAbajo = e.top + ((v.y0 + v.y1) / 2) * e.height;
          assert.ok(caraArriba >= -1e-6 && caraAbajo <= H + 1e-6, `${avatar} ${W}×${H}: la cara se ve`);
        }
      }
    }
  }
  // En el círculo de la llamada (300×300), la franja del retrato de Claudio (0,02–0,54) llena el alto justo.
  const e = encuadrar(300, 300, VENTANAS.claudio.retrato);
  assert.equal(Math.round(e.height), 577);
  assert.equal(Math.round(e.top), -12);
  // Acostado (844×390): el video no se estira a lo ancho; queda centrado con márgenes a los lados.
  const a = encuadrar(844, 390, VENTANAS.claudio.retrato);
  assert.ok(a.left > 0 && a.width < 844, 'márgenes a los lados');
  assert.equal(Math.round(a.height), 750);
});

prueba('el toque: arriba de la barbilla es la cabeza; abajo, el cuerpo', () => {
  const e = encuadrar(390, 844, VENTANAS.claudio.cuerpo);
  assert.equal(zonaVideo(e.top + 0.2 * e.height, e, 'claudio'), 'cabeza');
  assert.equal(zonaVideo(e.top + 0.6 * e.height, e, 'claudio'), 'panza');
  assert.equal(zonaVideo(e.top + 0.41 * e.height, e, 'antonio'), 'cabeza', 'la cabeza de ANT-ONIO es más grande');
});

prueba('los 18 clips existen, son livianos y clips.ts los pide todos', () => {
  const dir = path.resolve(AQUI, '../../../assets/avatares/video');
  const fuente = fs.readFileSync(path.resolve(AQUI, '../video/clips.ts'), 'utf8');
  let total = 0;
  for (const a of ['claudio', 'antonio']) {
    for (const c of CLIPS_VIDEO) {
      const f = path.join(dir, `${a}-${c}.mp4`);
      assert.ok(fs.existsSync(f), `falta ${a}-${c}.mp4`);
      const b = fs.statSync(f).size;
      assert.ok(b > 50_000 && b < 600_000, `${a}-${c}.mp4: ${b} bytes`);
      total += b;
      assert.ok(fuente.includes(`video/${a}-${c}.mp4`), `clips.ts no pide ${a}-${c}`);
      // MP4 con «faststart»: el índice (moov) antes de los datos (mdat).
      const cabeza = fs.readFileSync(f).subarray(0, 64 * 1024).toString('latin1');
      assert.ok(cabeza.indexOf('moov') > 0 && (cabeza.indexOf('mdat') < 0 || cabeza.indexOf('moov') < cabeza.indexOf('mdat')), `${a}-${c}: faststart`);
    }
  }
  assert.ok(total < 8 * 1024 * 1024, `los 18 pesan ${(total / 1048576).toFixed(1)} MB`);
});

let fallas = 0;
for (const [nombre, f] of pruebas) {
  try {
    await f();
    console.log(`ok - ${nombre}`);
  } catch (e) {
    fallas++;
    console.log(`not ok - ${nombre}\n  ${e?.stack || e}`);
  }
}
console.log(`\n${pruebas.length - fallas}/${pruebas.length} pruebas del cuerpo en video`);
if (fallas) process.exit(1);
