/**
 * Pruebas en Node de la CÁMARA EN VIVO (modules/aura-camara + components/CamaraVivo.tsx), sin teléfono:
 *
 *   · lo que llega del nativo se revisa (eventoValido) y entra a la MISMA escena de siempre
 *     (observacionNativa → MaquinaEscena con UMBRALES_VIVO): llega, sonríe, se va, con el latido del nativo;
 *   · el contrato de coordenadas: la caja del cuadro derecho → la vista tal como se ve (llena y recorta,
 *     espejo en la frontal) es la misma cuenta que lib/vistaEnVivo.ts y que Geometria.aVista en Kotlin;
 *   · la identidad pegada al trackingId (seguimiento.ts con ids) y cuándo volver a mirar (pistaNativa.ts);
 *   · la guardia contra cierres (marca «montando», golpes, días apagada) y qué cámara se elige;
 *   · costuras leídas del código: la mesa elige con CamaraMesa, la marca se escribe ANTES de montar la vista
 *     nativa, el nativo manda los campos que JS lee, las versiones de CameraX/ML Kit son las que ya van en la
 *     APK y no vuelve worklets-core ni vision-camera (0602318).
 *
 *   cd mobile && npx tsx pruebas/camara/nativa.prueba.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GUARDIA,
  UMBRALES_VIVO,
  cajaEnVista,
  carasMlkitDeEvento,
  configCamaraValida,
  elegirCamara,
  eventoValido,
  guardiaAlArrancar,
  guardiaAlMontar,
  guardiaAlSanar,
  guardiaAlSoltar,
  guardiaBloqueada,
  guardiaValida,
  observacionNativa,
  rectDeCara,
  tamEquivalente,
} from '../../src/lib/camaraNativa.ts';
import { MaquinaEscena, UMBRALES, observacionMlkit } from '../../src/lib/escena.ts';
import { cajaEnPantalla } from '../../src/lib/vistaEnVivo.ts';
import { Seguidor } from '../../src/caras/seguimiento.ts';
import * as pistaNativa from '../../src/caras/pistaNativa.ts';
const { RECONOCER_VIVO, elegirPistaParaReconocer, podarIntentos, prioridadPista } = pistaNativa;
import { APRENDER } from '../../src/caras/caras.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MOVIL = path.resolve(AQUI, '../..');
const RAIZ = path.resolve(MOVIL, '..');
const leer = (f) => fs.readFileSync(path.join(MOVIL, f), 'utf8');

let fallos = 0;
let n = 0;
const pruebas = [];
const prueba = (nombre, f) => pruebas.push([nombre, f]);
const cerca = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

/** Un evento del nativo como lo arma AuraCamaraView.emitirSiCambio. */
function evento(ts, caras = [], extra = {}) {
  return {
    caras: caras.map((c) => ({ id: 1, yaw: 0, pitch: 0, roll: 0, sonrisa: 0.1, ojos: 0.9, ojoI: 0.9, ojoD: 0.9, ...c })),
    w: 400,
    h: 300,
    iw: 640,
    ih: 480,
    ms: 18,
    fps: 15,
    ts,
    lado: 'frontal',
    espejo: true,
    ...extra,
  };
}
const cara = (x = 0.4, y = 0.3, w = 0.2, h = 0.27, extra = {}) => ({ foto: { x, y, w, h }, ...extra });

/* ── lo que llega del nativo ─────────────────────────────────────────────────────────────── */

prueba('eventoValido: revisa todo; basura → null; recorta cajas a la imagen; -1 si no clasificó', () => {
  assert.equal(eventoValido(null), null);
  assert.equal(eventoValido({ caras: 'x', iw: 1, ih: 1 }), null);
  assert.equal(eventoValido({ caras: [], iw: 0, ih: 480 }), null, 'sin tamaño de cuadro no sirve');
  const e = eventoValido({
    caras: [
      { id: 7, foto: { x: 0.9, y: -0.2, w: 0.5, h: 0.4 }, caja: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, yaw: 'no', pitch: 3, roll: NaN, sonrisa: -1, ojos: 2 },
      { id: 8, foto: { x: 0.2, y: 0.2, w: 0, h: 0.1 } },
      { foto: null },
    ],
    iw: 640,
    ih: 480,
    ts: 123,
    lado: 'trasera',
    espejo: true,
  });
  assert.equal(e.caras.length, 1, 'las cajas vacías o sin foto se descartan');
  const c = e.caras[0];
  assert.equal(c.id, 7);
  assert.ok(cerca(c.foto.x, 0.9) && cerca(c.foto.y, 0) && cerca(c.foto.w, 0.1) && cerca(c.foto.h, 0.4), JSON.stringify(c.foto));
  assert.equal(c.yaw, 0);
  assert.equal(c.roll, 0);
  assert.equal(c.sonrisa, -1);
  assert.equal(c.ojos, 1);
  assert.equal(e.lado, 'trasera');
  assert.equal(e.espejo, false, 'la trasera nunca va espejada');
  assert.equal(eventoValido({ caras: new Array(30).fill({ foto: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } }), iw: 1, ih: 1 }).caras.length, 10, 'como mucho 10');
});

prueba('adaptador: el evento nativo da la MISMA observación que una foto de ML Kit con esas cajas', () => {
  const e = eventoValido(evento(5000, [cara(0.1, 0.2, 0.25, 0.33, { yaw: -12, pitch: 4, sonrisa: 0.8, ojoI: 0.2, ojoD: 0.4 })]));
  const o = observacionNativa(e);
  const ml = observacionMlkit(
    [{ bounds: { x: 64, y: 96, width: 160, height: 158.4 }, yawAngle: -12, pitchAngle: 4, rollAngle: 0, smilingProbability: 0.8, leftEyeOpenProbability: 0.2, rightEyeOpenProbability: 0.4 }],
    640,
    480,
    'portrait',
    5000
  );
  assert.equal(o.personas, 1);
  for (const k of ['cx', 'cy', 'tam', 'yaw', 'pitch', 'sonrisa', 'parpadeo']) assert.ok(cerca(o.cara[k], ml.cara[k], 1e-3), `${k}: ${o.cara[k]} vs ${ml.cara[k]}`);
  assert.equal(carasMlkitDeEvento(e)[0].bounds.width, 160);
  const t = observacionNativa(eventoValido(evento(1, [cara()], { lado: 'trasera' })));
  assert.equal(t.trasera, true, 'la trasera se marca: sin espejo ni «mirando»');
});

prueba('escena con el latido del nativo: llega (~0,6 s), sonríe, y se va cuando deja de verse (eventos vacíos cada 1 s)', () => {
  const m = new MaquinaEscena(UMBRALES_VIVO);
  const eventos = [];
  let t = 1000;
  // Alguien quieto: solo el latido de 500 ms.
  for (; t <= 3000; t += 500) eventos.push(...m.procesar(observacionNativa(eventoValido(evento(t, [cara()])))).eventos);
  assert.ok(eventos.includes('llego'), `llega con el latido: ${eventos}`);
  // Sonríe: el nativo manda al momento (cambió la sonrisa).
  eventos.length = 0;
  eventos.push(...m.procesar(observacionNativa(eventoValido(evento(t, [cara(0.4, 0.3, 0.2, 0.27, { sonrisa: 0.9 })])))).eventos);
  assert.ok(eventos.includes('sonrie'), `sonríe: ${eventos}`);
  // Se va: eventos vacíos cada 1 s.
  eventos.length = 0;
  for (t += 1000; t <= 9000; t += 1000) eventos.push(...m.procesar(observacionNativa(eventoValido(evento(t, [])))).eventos);
  assert.ok(eventos.includes('se_fue'), `se va: ${eventos}`);
});

prueba('por qué UMBRALES_VIVO: con los del flujo de 10 fps el latido de 1 s sin caras era «cámara apagada» y nunca se iba', () => {
  const m = new MaquinaEscena(UMBRALES);
  const ev = [];
  let t = 1000;
  for (; t <= 3000; t += 100) ev.push(...m.procesar(observacionNativa(eventoValido(evento(t, [cara()])))).eventos);
  assert.ok(ev.includes('llego'));
  for (t += 1000; t <= 12000; t += 1000) ev.push(...m.procesar(observacionNativa(eventoValido(evento(t, [])))).eventos);
  assert.ok(!ev.includes('se_fue'), 'con UMBRALES (hueco 700 ms) nunca se iba: el defecto que UMBRALES_VIVO corrige');
  assert.ok(UMBRALES_VIVO.huecoMuestreoMs > 1000 && UMBRALES_VIVO.toleranciaCorteMs > 500, 'el hueco pasa el latido sin caras (1 s) y el corte pasa el latido con caras (0,5 s)');
});

prueba('una pausa larga de la cámara (segundo plano) no inventa «se fue» ni «llegó» al volver', () => {
  const m = new MaquinaEscena(UMBRALES_VIVO);
  let t = 0;
  for (; t <= 2000; t += 500) m.procesar(observacionNativa(eventoValido(evento(t, [cara()]))));
  const ev = m.procesar(observacionNativa(eventoValido(evento(t + 30_000, [cara()])))).eventos;
  assert.deepEqual(ev, [], JSON.stringify(ev));
});

/* ── el contrato de coordenadas ──────────────────────────────────────────────────────────── */

prueba('coordenadas: cajaEnVista (= Geometria.aVista en Kotlin) es cajaEnPantalla de «Lo que veo» en fracciones, con y sin espejo', () => {
  let semilla = 7;
  const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 400; i++) {
    const iw = [480, 640, 720, 960][i % 4];
    const ih = Math.round(iw * (i % 3 ? 3 / 4 : 4 / 3));
    const vw = 50 + Math.round(azar() * 900);
    const vh = 50 + Math.round(azar() * 900);
    const f = { x: azar() * 0.8, y: azar() * 0.8, w: 0.02 + azar() * 0.3, h: 0.02 + azar() * 0.3 };
    const espejo = i % 2 === 0;
    const a = cajaEnVista(f, iw, ih, vw, vh, espejo);
    const b = cajaEnPantalla(f, { w: iw, h: ih }, { w: vw, h: vh }, espejo);
    if (!a || !b) {
      // Las dos descartan lo que queda fuera (umbral de 1 px en una, 2 px en la otra: solo difiere en el borde).
      continue;
    }
    assert.ok(cerca(a.x * vw, b.left, 1e-6) && cerca(a.y * vh, b.top, 1e-6) && cerca(a.w * vw, b.width, 1e-6) && cerca(a.h * vh, b.height, 1e-6), `caso ${i}`);
  }
});

prueba('coordenadas: con la frontal la caja de la izquierda del cuadro sale a la DERECHA de la vista (espejo); la trasera no', () => {
  const f = { x: 0.1, y: 0.4, w: 0.2, h: 0.2 };
  const fr = cajaEnVista(f, 640, 480, 640, 480, true);
  const tr = cajaEnVista(f, 640, 480, 640, 480, false);
  assert.ok(cerca(fr.x, 0.7) && cerca(tr.x, 0.1), JSON.stringify({ fr, tr }));
  // Vista más ancha que el cuadro (llena y recorta arriba/abajo).
  // 640×480 en 800×300: se escala a 800×600 y se ven las filas 150..450 del cuadro escalado.
  const ancha = cajaEnVista({ x: 0.45, y: 0, w: 0.1, h: 0.3 }, 640, 480, 800, 300, false);
  assert.ok(cerca(ancha.y, 0) && cerca(ancha.h, 0.1), `lo de arriba queda recortado: ${JSON.stringify(ancha)}`);
  assert.equal(cajaEnVista({ x: 0.45, y: 0, w: 0.1, h: 0.05 }, 640, 480, 800, 300, false), null, 'fuera de lo visible: nada');
  // rectDeCara: la del nativo si viene; si no, la cuenta aquí.
  const e = { iw: 640, ih: 480, espejo: true };
  assert.deepEqual(rectDeCara({ caja: { x: 0.5, y: 0.5, w: 0.1, h: 0.2 }, foto: f }, e, { w: 200, h: 100 }), { left: 100, top: 50, width: 20, height: 20 });
  const r = rectDeCara({ foto: f }, e, { w: 640, h: 480 });
  assert.ok(cerca(r.left, 448) && cerca(r.width, 128), JSON.stringify(r));
});

/* ── la identidad pegada al trackingId ──────────────────────────────────────────────────── */

const reco = (id, nombre, d = 0.3) => ({ id, nombre, relacion: 'conocido', distancia: d, margen: 0.3 });

prueba('seguimiento con ids: la pista sigue a SU trackingId; si el id brinca de lugar (ML Kit pudo cambiarlos), el nombre se borra en las dos y se mira ya', () => {
  const s = new Seguidor();
  const [a, b] = s.actualizar([{ x: 0.1, y: 0.3, w: 0.2, h: 0.2 }, { x: 0.6, y: 0.3, w: 0.2, h: 0.2 }], 1000, [11, 22]);
  s.votar(a.id, reco('ana', 'Ana'), 1000);
  s.votar(a.id, reco('ana', 'Ana'), 1100);
  assert.equal(a.identidad?.nombre, 'Ana');
  s.tomarNueva();
  // En el cuadro siguiente la caja del id 11 está donde estaba la otra: los ids pudieron cambiarse (revisión 7, M5).
  const [p22, p11] = s.actualizar([{ x: 0.1, y: 0.3, w: 0.2, h: 0.2 }, { x: 0.6, y: 0.3, w: 0.2, h: 0.2 }], 1200, [22, 11]);
  assert.equal(p11.id, a.id, 'el id 11 sigue siendo la misma pista');
  assert.equal(p22.id, b.id);
  assert.equal(p11.identidad, null, 'pero el nombre de Ana ya no se le da a esa caja sin volver a mirar');
  assert.equal(p22.identidad, null, 'ni salta a la otra persona');
  assert.ok(s.hayNueva(), 'y se vuelve a mirar enseguida');
});

prueba('seguimiento con ids: un id nuevo es otra persona aunque aparezca en el mismo lugar; sin id, por solapamiento', () => {
  const s = new Seguidor();
  const [a] = s.actualizar([{ x: 0.3, y: 0.3, w: 0.2, h: 0.2 }], 0, [5]);
  s.votar(a.id, reco('ana', 'Ana'), 0);
  s.votar(a.id, reco('ana', 'Ana'), 10);
  const [b] = s.actualizar([{ x: 0.3, y: 0.3, w: 0.2, h: 0.2 }], 100, [6]);
  assert.notEqual(b.id, a.id, 'ML Kit dice que es otra pista: no hereda el nombre');
  assert.equal(b.identidad, null);
  assert.equal(b.ext, 6);
  s.actualizar([{ x: 0.36, y: 0.3, w: 0.2, h: 0.2 }], 150, [6]);
  // Sin seguimiento (id negativo): por solapamiento, como con fotos.
  const [c] = s.actualizar([{ x: 0.37, y: 0.3, w: 0.2, h: 0.2 }], 200, [-1]);
  assert.equal(c.id, b.id, 'sin id se une por IoU con la pista más parecida');
  // Sin ids (cámara de fotos): igual que siempre.
  const s2 = new Seguidor();
  const [x] = s2.actualizar([{ x: 0.3, y: 0.3, w: 0.2, h: 0.2 }], 0);
  const [y] = s2.actualizar([{ x: 0.32, y: 0.3, w: 0.2, h: 0.2 }], 300);
  assert.equal(x.id, y.id);
  assert.equal(x.ext, undefined);
});

prueba('a quién mirar: la nueva YA; con un voto, confirmar enseguida; «no sé» con pausas; confirmada, repaso cada 12 s (5 s si fue por poco)', () => {
  const R = RECONOCER_VIVO;
  const nueva = { votos: [], identidad: null };
  assert.equal(prioridadPista(nueva, undefined, 1000, false), 0);
  const unVoto = { votos: [{ id: 'ana', distancia: 0.3, ts: 0 }], identidad: null };
  assert.equal(prioridadPista(unVoto, { ultimo: 1000, n: 1 }, 1000 + R.confirmarMs, false), 1, 'el segundo recorte sale apenas el motor se libera');
  assert.equal(prioridadPista(unVoto, { ultimo: 1000, n: 1 }, 1000 + R.confirmarMs - 1, false), null);
  assert.equal(prioridadPista(unVoto, { ultimo: 1000, n: R.confirmarMax }, 1000 + R.reintentoMs, false), null, 'con tope: si el motor no la encuentra, no se insiste sin fin');
  const nose = { votos: [{ id: null, distancia: 1, ts: 0 }], identidad: null };
  assert.equal(prioridadPista(nose, { ultimo: 0, n: 1 }, R.reintentoMs - 1, false), null);
  assert.equal(prioridadPista(nose, { ultimo: 0, n: 1 }, R.reintentoMs, false), 2);
  // José, 6-oct («primer nombre 95376 ms después de ver la cara»): tras las rápidas, ~30 s atenta cada 2,5 s (como la
  // cámara de fotos con alguien sin nombre); después, la calma de 5 s.
  assert.equal(prioridadPista(nose, { ultimo: 0, n: R.intentosRapidos }, R.atentoMs - 1, false), null);
  assert.equal(prioridadPista(nose, { ultimo: 0, n: R.intentosRapidos }, R.atentoMs, false), 3, 'atenta: cada 2,5 s, no cada 5');
  assert.ok(R.atentoMs <= 2500 && R.intentosAtentos * R.atentoMs <= 35_000, 'la parte atenta dura ~30 s');
  assert.equal(prioridadPista(nose, { ultimo: 0, n: R.intentosAtentos }, R.desconocidoMs - 1, false), null, 'quien no está guardado no se mira sin fin cada 2,5 s');
  assert.equal(prioridadPista(nose, { ultimo: 0, n: R.intentosAtentos }, R.desconocidoMs, false), 3);
  assert.equal(prioridadPista(nose, { ultimo: 0, n: R.intentosAtentos }, R.desconocidoVistaMs, true), 3, 'con «Lo que veo» abierto, más seguido');
  const ana = { votos: [], identidad: { id: 'ana', nombre: 'Ana', relacion: 'conocido', distancia: 0.3, desde: 0, ultimoVoto: 0 } };
  assert.equal(prioridadPista(ana, { ultimo: 0, n: 2 }, R.confirmadaMs - 1, false), null, 'confirmada: no se la vuelve a mirar a cada rato');
  assert.equal(prioridadPista(ana, { ultimo: 0, n: 2 }, R.confirmadaMs, false), 4);
  const dudosa = { ...ana, identidad: { ...ana.identidad, distancia: R.dudosaDistancia + 0.01 } };
  assert.equal(prioridadPista(dudosa, { ultimo: 0, n: 2 }, R.dudosaMs, false), 4, 'ganó por poco: repaso a los 5 s');
  assert.ok(R.confirmadaMs >= 10_000 && R.confirmadaMs <= 15_000);
});

prueba('el primer nombre con tomas malas al principio (cara de lado o movida): sale en segundos, no en decenas', () => {
  // José, 6-oct: «primer nombre 95376 ms después de ver la cara». El recorrido real (Seguidor + prioridadPista) con un
  // motor que tarda 250 ms y cuyas 4 primeras tomas no dicen nada (sin cara o «no sé»); la 5.ª y siguientes, José.
  const s = new Seguidor();
  const caja = { x: 0.3, y: 0.2, w: 0.3, h: 0.4 };
  const intentos = new Map();
  let analizandoHasta = -1;
  let n = 0;
  let nombreEn = null;
  for (let t = 0; t <= 60_000 && nombreEn === null; t += 50) {
    const [p] = s.actualizar([caja], t, [7]);
    if (t < analizandoHasta) continue;
    // Lo mismo que CamaraVivo.intentarReconocer antes de elegir.
    pistaNativa.anotarVotos(intentos, [p]);
    const elegida = elegirPistaParaReconocer([p], intentos, t, { ocupado: false, reconoce: true, vistaAbierta: false, alto: () => 200 });
    if (!elegida) continue;
    const i = intentos.get(p.id);
    intentos.set(p.id, { ...i, ultimo: t, n: (i?.n ?? 0) + 1 });
    n += 1;
    analizandoHasta = t + 250;
    const r = n <= 4 ? null : { id: 'jose', nombre: 'José', relacion: 'yo', distancia: 0.41, margen: 1 };
    const v = s.votar(p.id, r, t + 250);
    if (v.identidad) nombreEn = t + 250;
  }
  assert.ok(nombreEn !== null, 'tiene que salir el nombre');
  assert.ok(nombreEn <= 8000, `el nombre salió a los ${nombreEn} ms (con 5 s entre tomas desde la cuarta: ~11,6 s)`);
});

prueba('por qué no sale el nombre: recortes, sin cara, «no sé» y la distancia más cercana', async () => {
  const { DiagnosticoReconocer } = await import('../../src/caras/pistaNativa.ts');
  const d = new DiagnosticoReconocer();
  assert.equal(d.linea(3, 0.5), 'ningún recorte analizado');
  d.analizado(3, { cara: false, reconocida: false });
  d.analizado(3, { cara: true, reconocida: false, distancia: 0.58 });
  d.analizado(3, { cara: true, reconocida: false, distancia: 0.54 });
  d.analizado(3, { cara: true, reconocida: true, distancia: 0.31 });
  assert.equal(d.linea(3, 0.5), '4 recortes: 1 sin cara, 2 «no sé» (la más parecida a 0.54; umbral 0.50)');
  d.podar([{ id: 9 }]);
  assert.equal(d.linea(3, 0.5), 'ningún recorte analizado', 'la pista que se fue se olvida');
});

prueba('a quién mirar: de a una, primero la nueva y la más grande; las muy chicas esperan; sin reconocer, nada', () => {
  const s = new Seguidor();
  const pistas = s.actualizar(
    [
      { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
      { x: 0.5, y: 0.1, w: 0.3, h: 0.3 },
      { x: 0.8, y: 0.8, w: 0.05, h: 0.05 },
    ],
    0,
    [1, 2, 3]
  );
  const intentos = new Map();
  const alto = (p) => p.caja.h * 480;
  const o = { ocupado: false, reconoce: true, vistaAbierta: false, alto };
  assert.equal(elegirPistaParaReconocer(pistas, intentos, 0, o)?.ext, 2, 'la más grande primero');
  intentos.set(pistas[1].id, { ultimo: 0, n: 1 });
  assert.equal(elegirPistaParaReconocer(pistas, intentos, 10, o)?.ext, 1, 'después la otra nueva');
  intentos.set(pistas[0].id, { ultimo: 10, n: 1 });
  assert.equal(elegirPistaParaReconocer(pistas, intentos, 20, o), null, `la de ${0.05 * 480} px espera (mín. ${RECONOCER_VIVO.minPx})`);
  assert.equal(elegirPistaParaReconocer(pistas, new Map(), 0, { ...o, ocupado: true }), null, 'el motor ocupado: nada');
  assert.equal(elegirPistaParaReconocer(pistas, new Map(), 0, { ...o, reconoce: false }), null);
  podarIntentos(intentos, [pistas[1]]);
  assert.deepEqual([...intentos.keys()], [pistas[1].id], 'las pistas que se fueron se olvidan');
});

prueba('camino entero: persona nueva → dos recortes → nombre; y se queda sin volver a mirar hasta el repaso', () => {
  const s = new Seguidor();
  const intentos = new Map();
  const o = { ocupado: false, reconoce: true, vistaAbierta: false, alto: (p) => p.caja.h * 480 };
  let t = 0;
  let pedidos = 0;
  let nombreEn = null;
  for (; t <= 20_000; t += 66) {
    const [p] = s.actualizar([{ x: 0.4, y: 0.3, w: 0.2, h: 0.27 }], t, [42]);
    const elegida = elegirPistaParaReconocer([p], intentos, t, o);
    if (elegida) {
      pedidos += 1;
      intentos.set(p.id, { ultimo: t, n: (intentos.get(p.id)?.n ?? 0) + 1 });
      // El motor contesta ~250 ms después (mientras, «ocupado»).
      const fin = t + 250;
      while (t < fin) {
        t += 66;
        s.actualizar([{ x: 0.4, y: 0.3, w: 0.2, h: 0.27 }], t, [42]);
      }
      s.votar(p.id, reco('jose', 'José', 0.31), t);
      if (p.identidad && nombreEn === null) nombreEn = t;
    }
  }
  assert.ok(nombreEn !== null && nombreEn <= 800, `el nombre sale en ≤0,8 s (salió a los ${nombreEn} ms)`);
  assert.ok(pedidos <= 4, `en 20 s solo ${pedidos} recortes (2 para confirmar + repasos cada 12 s)`);
});

prueba('aprender con el uso: el tamaño del recorte se lleva a la escala de las fotos de 720 px', () => {
  assert.ok(cerca(tamEquivalente(0.18, 480), 0.12), 'una cara de 86 px en 480 cuenta como 0,12 (el mínimo de APRENDER)');
  assert.ok(tamEquivalente(0.17, 480) < APRENDER.tamMin, 'más chica no aprende');
  assert.ok(cerca(tamEquivalente(0.2, 720), 0.2));
});

/* ── la guardia contra cierres y qué cámara ──────────────────────────────────────────────── */

const DIA = 24 * 3600_000;

prueba('guardia: murió montándola → 7 días apagada en este teléfono, con aviso; después vuelve sola', () => {
  const t0 = 1_000_000;
  let g = guardiaAlMontar({}, t0);
  assert.equal(g.montando, t0);
  const r = guardiaAlArrancar(g, t0 + 60_000, true);
  assert.ok(r.aviso && /se cerró montándola/.test(r.aviso), r.aviso);
  assert.equal(r.estado.montando, undefined, 'la marca se consume');
  assert.ok(guardiaBloqueada(r.estado, t0 + 6 * DIA));
  assert.ok(!guardiaBloqueada(r.estado, t0 + 8 * DIA), 'pasados los días, se prueba otra vez');
  assert.equal(r.estado.bloqueadaHasta - (t0 + 60_000), GUARDIA.bloqueoMontarMs);
  // Con «no se sabe» (sin la marca de reporte.ts) también cuenta: mejor apagarla de más.
  assert.ok(guardiaBloqueada(guardiaAlArrancar(guardiaAlMontar({}, t0), t0 + 1, null).estado, t0 + 2));
});

prueba('guardia: una recarga a propósito (OTA) o un cierre normal con la marca puesta NO cuentan', () => {
  const r = guardiaAlArrancar({ montando: 5, enUso: 6 }, 100, false);
  assert.equal(r.aviso, undefined);
  assert.ok(!guardiaBloqueada(r.estado, 101));
  assert.deepEqual(r.estado, {});
});

prueba('guardia: sana a los 10 s → «en uso»; morir así es un golpe; dos golpes en 3 días → 3 días apagada', () => {
  let g = guardiaAlSanar(guardiaAlMontar({}, 0), 10_000);
  assert.equal(g.montando, undefined);
  assert.equal(g.enUso, 10_000);
  let r = guardiaAlArrancar(g, DIA, true);
  assert.ok(!guardiaBloqueada(r.estado, DIA + 1), 'un golpe no la apaga');
  assert.equal(r.estado.golpes.length, 1);
  g = guardiaAlSanar(guardiaAlMontar(r.estado, DIA + 5), DIA + 15_000);
  r = guardiaAlArrancar(g, 2 * DIA, true);
  assert.ok(guardiaBloqueada(r.estado, 2 * DIA + 1) && r.aviso, 'el segundo sí');
  assert.equal(r.estado.bloqueadaHasta - 2 * DIA, GUARDIA.bloqueoGolpesMs);
  // Golpes viejos (más de 3 días) se olvidan.
  const viejo = guardiaAlArrancar({ golpes: [0], enUso: 5 * DIA }, 5 * DIA + 1, true);
  assert.ok(!guardiaBloqueada(viejo.estado, 5 * DIA + 2));
  assert.equal(viejo.estado.golpes.length, 1);
});

prueba('guardia: soltarla con calma (segundo plano, salir de la mesa) borra las marcas; lo guardado se revisa', () => {
  assert.deepEqual(guardiaAlSoltar({ montando: 1, enUso: 2, golpes: [3] }), { montando: undefined, enUso: undefined, golpes: [3] });
  assert.deepEqual(guardiaValida('basura'), {});
  assert.deepEqual(guardiaValida({ montando: -5, enUso: 'x', golpes: [1, 'a', null, 2], bloqueadaHasta: 9, motivo: 7 }), { golpes: [1, 2], bloqueadaHasta: 9 });
});

prueba('qué cámara: la nueva solo con todo a favor; si no, la de fotos y el motivo', () => {
  const base = { android: true, modulo: true, bloqueada: false };
  assert.deepEqual(elegirCamara(base), { usar: 'vivo', motivo: 'nueva' });
  assert.deepEqual(elegirCamara({ ...base, ajuste: undefined, remoto: undefined }), { usar: 'vivo', motivo: 'nueva' }, 'sin elegir: encendida');
  assert.equal(elegirCamara({ ...base, android: false }).motivo, 'no-android');
  assert.equal(elegirCamara({ ...base, modulo: false }).motivo, 'sin-modulo', 'APK vieja con este JS por OTA');
  assert.equal(elegirCamara({ ...base, remoto: false }).motivo, 'remoto');
  assert.equal(elegirCamara({ ...base, ajuste: false }).motivo, 'ajuste');
  assert.equal(elegirCamara({ ...base, bloqueada: true }).motivo, 'bloqueada');
  assert.equal(elegirCamara({ ...base, falloEnSesion: true }).motivo, 'fallo');
  for (const m of ['no-android', 'sin-modulo', 'remoto', 'ajuste', 'bloqueada', 'fallo']) assert.ok(m);
  assert.deepEqual(configCamaraValida({ camaraRapida: { activa: false } }), { activa: false });
});

/* ── costuras leídas del código ──────────────────────────────────────────────────────────── */

prueba('costuras: la mesa elige con CamaraMesa (mismas props) y la de fotos sigue entera como respaldo', () => {
  const mesa = leer('src/screens/DeskScreen.tsx');
  assert.match(mesa, /<CamaraMesa\n/);
  assert.doesNotMatch(mesa, /<CamaraVision\n/);
  const cm = leer('src/components/CamaraMesa.tsx');
  assert.match(cm, /decision\.usar === 'vivo'\) return <CamaraVivo \{\.\.\.props\} remota=\{decision\.remota\} onFallo=\{camaraFallo\} \/>/);
  assert.match(cm, /return <CamaraVision \{\.\.\.props\} \/>/);
  const cv = leer('src/components/CamaraVision.tsx');
  assert.match(cv, /FaceDetection\.detect\(foto\.uri, OPCIONES_ML\)/, 'la cámara de fotos no se tocó');
});

prueba('costuras: la marca «montando» se escribe y se ESPERA antes de montar la vista nativa; sin cuadros o con error → respaldo', () => {
  const v = leer('src/components/CamaraVivo.tsx');
  // CAM-D: solo con la marca ESCRITA (ok); si no quedó en el disco, a la de fotos (onFallo) sin montar.
  assert.match(v, /void camaraMontando\(\)\.then\(\(ok\) => \{\n\s+if \(!vivo\) return;\n(\s+\/\/.*\n)?\s+if \(!ok\) return fallar\([^)]*\);\n\s+ultimoEvento\.current = Date\.now\(\);\n\s+setMontable\(true\);/);
  assert.match(v, /if \(!activa \|\| !montable\) return null;/, 'la vista nativa solo con la marca escrita');
  assert.match(v, /camaraSana\(evento\.current\?\.fps\);\n\s+\}, GUARDIA\.sanoTrasMs\)/);
  assert.match(v, /camaraSoltada\(\);/);
  assert.match(v, /SIN_CUADROS_MS = 8000/);
  const g = leer('src/lib/guardiaCamara.ts');
  assert.match(g, /export async function camaraMontando\(\): Promise<boolean> \{\n\s+const ok = await escribirGuardia/);
  assert.match(g, /murioLaVezAnterior\(\)/);
  const a = leer('src/lib/auraCamara.ts');
  assert.match(a, /requireOptionalNativeModule<ModuloCamara>\('AuraCamara'\)/, 'sin el módulo (APK vieja), null: nada se rompe');
  assert.match(a, /camaraVivaDisponible\(\) \? requireNativeView/, 'la vista nativa solo se pide si el módulo está');
});

prueba('costuras: el nativo manda los campos que JS lee y hace la misma cuenta de coordenadas', () => {
  const kt = fs.readFileSync(path.join(MOVIL, 'modules/aura-camara/android/src/main/java/expo/modules/auracamara/AuraCamaraView.kt'), 'utf8');
  for (const k of ['id', 'foto', 'caja', 'yaw', 'pitch', 'roll', 'sonrisa', 'ojos', 'ojoI', 'ojoD']) assert.match(kt, new RegExp(`m\\["${k}"\\]`), `cara.${k}`);
  for (const k of ['caras', 'w', 'h', 'iw', 'ih', 'ms', 'fps', 'ts', 'lado', 'espejo']) assert.match(kt, new RegExp(`evento\\["${k}"\\]`), `evento.${k}`);
  assert.match(kt, /\.enableTracking\(\)/);
  assert.match(kt, /STRATEGY_KEEP_ONLY_LATEST/);
  assert.match(kt, /PERFORMANCE_MODE_FAST/);
  assert.match(kt, /CLASSIFICATION_MODE_ALL/);
  assert.match(kt, /LANDMARK_MODE_NONE/);
  assert.match(kt, /ImplementationMode\.COMPATIBLE/, 'TextureView: respeta opacidad y recorte de RN');
  assert.match(kt, /avisarError\("sin-permiso"/, 'sin permiso: un evento, no un cierre');
  const geo = fs.readFileSync(path.join(MOVIL, 'modules/aura-camara/android/src/main/java/expo/modules/auracamara/Cuadro.kt'), 'utf8');
  assert.match(geo, /val s = max\(vw\.toFloat\(\) \/ iw, vh\.toFloat\(\) \/ ih\)/, 'llena y recorta (FILL_CENTER)');
  assert.match(geo, /val x = if \(espejo\) 1f - fx - fw else fx/, 'espejo como en cajaEnVista');
  const mod = fs.readFileSync(path.join(MOVIL, 'modules/aura-camara/android/src/main/java/expo/modules/auracamara/AuraCamaraModule.kt'), 'utf8');
  assert.match(mod, /Name\("AuraCamara"\)/);
  assert.match(mod, /Events\("onCaras", "onEstado"\)/);
  for (const p of ['lado', 'activa', 'hz', 'fps', 'ladoCorto', 'minCara']) assert.match(mod, new RegExp(`Prop\\("${p}"\\)`));
});

prueba('costuras: CameraX y ML Kit con las MISMAS versiones que ya trae la APK; sin worklets-core ni vision-camera (0602318)', () => {
  const gradle = fs.readFileSync(path.join(MOVIL, 'modules/aura-camara/android/build.gradle'), 'utf8');
  const nm = (f) => {
    const p = path.join(MOVIL, 'node_modules', f);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  };
  const cam = nm('expo-camera/android/build.gradle');
  if (cam) {
    const v = /camerax_version = "([^"]+)"/.exec(cam)?.[1];
    assert.ok(v && gradle.includes(`def camerax_version = "${v}"`), `CameraX ${v} como expo-camera`);
  }
  const ml = nm('@react-native-ml-kit/face-detection/android/build.gradle');
  if (ml) {
    const v = /com\.google\.mlkit:face-detection:([\d.]+)/.exec(ml)?.[1];
    assert.ok(v && gradle.includes(`com.google.mlkit:face-detection:${v}`), `ML Kit ${v} como @react-native-ml-kit`);
  }
  const pkg = JSON.parse(leer('package.json'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const prohibido of ['react-native-worklets-core', 'react-native-vision-camera', 'react-native-vision-camera-face-detector']) assert.ok(!deps[prohibido], `${prohibido} no vuelve`);
  assert.doesNotMatch(gradle, /implementation[^\n]*(tensorflow|tflite|litert)/i, 'sin modelos propios esta vez');
  const cfg = JSON.parse(leer('modules/aura-camara/expo-module.config.json'));
  assert.deepEqual(cfg.platforms, ['android'], 'solo Android: iOS sigue con la cámara de fotos');
  const flujo = fs.readFileSync(path.join(RAIZ, '.github/workflows/android-apk.yml'), 'utf8');
  assert.match(flujo, /- "mobile\/\*\*"/, 'el flujo de la APK compila con cualquier cambio en mobile/');
});

prueba('costuras: useCaras dice si el motor está ocupado y aprende con el tamaño real de la cara', () => {
  const uc = leer('src/caras/useCaras.tsx');
  assert.match(uc, /const ocupado = useCallback\(\(\) => analizando\.current, \[\]\);/);
  assert.match(uc, /tam: de\.tam \?\? de\.caja\.h/);
});

for (const [nombre, f] of pruebas) {
  n += 1;
  try {
    await f();
    console.log(`ok    ${nombre}`);
  } catch (e) {
    fallos += 1;
    console.log(`FALLA ${nombre}\n      ${e?.message || e}`);
  }
}
console.log(`\n${n - fallos}/${n} pruebas bien`);
process.exit(fallos ? 1 : 0);
