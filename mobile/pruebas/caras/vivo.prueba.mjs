/**
 * Pruebas en Node de «Lo que veo», la cámara de atrás y reconocer mejor (José, 5-oct: «le costó
 * reconocer y a veces no sabía que me miraba… ver lo que mira y que salga el cuadro de lo que reconoce,
 * poner cámara frontal y de atrás»). Sin teléfono:
 *
 *   · las cuentas de la vista (lib/vistaEnVivo.ts): una caja de la foto en la vista previa, con el espejo
 *     de la frontal y el recorte de la vista previa; el marco con la proporción de la foto;
 *   · seguir caras entre fotos y votar quién es (src/caras/seguimiento.ts): pistas por solapamiento, el
 *     nombre con 2 de 3 votos, que no parpadee ni se lo dé a otro, y cuándo volver a mirar;
 *   · lo que se dibuja y la línea de estado; la cámara elegida, guardada; lo que se dice por voz;
 *   · aprender: elegir 5 muestras distintas de las poses, el tope con la más redundante afuera, y cuándo
 *     se aprende con el uso (src/caras/caras.ts); el parentesco hasta la frase para el cerebro;
 *   · costuras leídas del código: la foto del bucle va al motor de caras (sin segunda foto), la frontal
 *     se dibuja espejada, la trasera no mueve los ojos del avatar, y el motor usa las cajas de ML Kit;
 *   · sin ML Kit (respaldo del servidor) también se reconoce seguido, sin pedir la foto por dos vías.
 *
 *   cd mobile && npx tsx pruebas/caras/vivo.prueba.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VISTA_FRESCA_MS, cajaEnPantalla, cajaNormal, etiquetaCara, ladoValido, lineaEstado, marcasEnVivo, marcoParaFoto, pedidoDeVista } from '../../src/lib/vistaEnVivo.ts';
import { CONFIRMAR, MANTENER_MS, PERDIDA_MS, RECONOCER, RESPALDO, Seguidor, VIVA_MS, VistoRespaldo, decidirIdentidad, iou, tocaReconocer, tocaReconocerRespaldo } from '../../src/caras/seguimiento.ts';
import { APRENDER, MAX_MUESTRAS, MUESTRAS_APRENDER, POSES, UMBRAL, debeAprender, distancia, elegirMuestras, frasePresentes, identificar, parentescoValido, sumarMuestras } from '../../src/caras/caras.ts';
import { pedidoDeCamara } from '../../src/lib/camaraModo.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MOVIL = path.resolve(AQUI, '../..');
const leer = (f) => fs.readFileSync(path.join(MOVIL, f), 'utf8');

let fallos = 0;
let n = 0;
const pruebas = [];
const prueba = (nombre, f) => pruebas.push([nombre, f]);
const cerca = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

/** Un azar repetible. */
function azar(semilla) {
  let x = (semilla * 2654435761) % 4294967296;
  return () => ((x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296) - 0.5;
}
/** Una «persona» (semilla) en una toma (k) con `ruido`: tomas distintas, ruido en direcciones distintas. */
function toma(semilla, ruido = 0, k = 0) {
  const a = azar(semilla);
  const b = azar(semilla * 31 + k * 7919 + 1);
  return Array.from({ length: 128 }, () => Math.round((a() * 0.3 + b() * ruido) * 1e4) / 1e4);
}
const vista = (v, x = 0.3, w = 0.2) => ({ caja: { x, y: 0.2, w, h: w }, vector: v, puntaje: 0.9 });
const reco = (id, nombre, d = 0.3, extra = {}) => ({ id, nombre, relacion: 'conocido', distancia: d, margen: 0.3, ...extra });

/* ── las cuentas de la vista ─────────────────────────────────────────────────────────────── */

prueba('vista: la caja de la foto cae en el mismo lugar del marco; la frontal se refleja (vista previa espejada), la trasera no', () => {
  const foto = { w: 720, h: 1280 };
  const marco = { w: 360, h: 640 }; // misma proporción: sin recorte
  const c = { x: 0.1, y: 0.2, w: 0.3, h: 0.25 };
  const tras = cajaEnPantalla(c, foto, marco, false);
  assert.ok(cerca(tras.left, 36) && cerca(tras.top, 128) && cerca(tras.width, 108) && cerca(tras.height, 160), JSON.stringify(tras));
  const fron = cajaEnPantalla(c, foto, marco, true);
  // Espejo: la cara a la IZQUIERDA de la foto se ve a la DERECHA de la vista (como en un espejo).
  assert.ok(cerca(fron.left, 360 - 36 - 108) && cerca(fron.top, 128) && cerca(fron.width, 108), JSON.stringify(fron));
});

prueba('vista: si el marco no tiene la proporción de la foto, se cuenta el recorte de la vista previa (cover) y se recorta a lo visible', () => {
  const foto = { w: 720, h: 1280 }; // 9:16
  const marco = { w: 300, h: 400 }; // 3:4: la vista previa recorta arriba y abajo
  const s = Math.max(300 / 720, 400 / 1280);
  const H = 1280 * s;
  const oy = (400 - H) / 2;
  const r = cajaEnPantalla({ x: 0.25, y: 0.5, w: 0.5, h: 0.1 }, foto, marco, false);
  assert.ok(cerca(r.left, 75) && cerca(r.top, oy + 0.5 * H) && cerca(r.height, 0.1 * H), JSON.stringify(r));
  assert.equal(cajaEnPantalla({ x: 0.1, y: 0.0, w: 0.2, h: 0.02 }, foto, marco, false), null, 'lo recortado no se dibuja');
  const borde = cajaEnPantalla({ x: 0.4, y: 0.05, w: 0.2, h: 0.2 }, foto, marco, false);
  assert.ok(borde.top === 0 && borde.height < 0.2 * H, 'una caja que sale del marco se recorta al borde');
});

prueba('vista: el marco toma la proporción de la foto y lo más grande que cabe; sin foto, 3:4 o 4:3 según el lugar', () => {
  assert.deepEqual(marcoParaFoto({ w: 720, h: 1280 }, { w: 400, h: 600 }), { w: 338, h: 600 });
  assert.deepEqual(marcoParaFoto({ w: 1280, h: 720 }, { w: 400, h: 600 }), { w: 400, h: 225 });
  assert.deepEqual(marcoParaFoto(null, { w: 400, h: 600 }), { w: 400, h: 533 });
  assert.deepEqual(marcoParaFoto(null, { w: 600, h: 300 }), { w: 400, h: 300 });
  const m = marcoParaFoto({ w: 720, h: 1280 }, { w: 400, h: 600 });
  assert.ok(Math.abs(m.w / m.h - 720 / 1280) < 0.01, 'sin recorte: lo que se ve es lo que analiza ML Kit');
});

prueba('vista: la caja de ML Kit (px) en fracciones, recortada a la foto; basura → null', () => {
  const c = cajaNormal({ x: 72, y: 128, width: 144, height: 256 }, 720, 1280);
  assert.ok(cerca(c.x, 0.1) && cerca(c.y, 0.1) && cerca(c.w, 0.2) && cerca(c.h, 0.2), JSON.stringify(c));
  const borde = cajaNormal({ x: -20, y: 1200, width: 100, height: 200 }, 720, 1280);
  assert.ok(borde.x === 0 && cerca(borde.y + borde.h, 1), JSON.stringify(borde));
  assert.equal(cajaNormal({ x: NaN, y: 0, width: 10, height: 10 }, 720, 1280), null);
  assert.equal(cajaNormal({ x: 0, y: 0, width: 10, height: 10 }, 0, 1280), null);
});

/* ── seguir caras y votar ────────────────────────────────────────────────────────────────── */

prueba('seguir: la misma cara que se mueve un poco es la misma pista; una que aparece en otro lado es otra; dos que se cruzan no se cambian', () => {
  const s = new Seguidor();
  const [a] = s.actualizar([{ x: 0.3, y: 0.3, w: 0.2, h: 0.2 }], 0);
  const [a2] = s.actualizar([{ x: 0.32, y: 0.31, w: 0.2, h: 0.2 }], 330);
  assert.equal(a2.id, a.id);
  assert.ok(s.tomarNueva(), 'llegó alguien');
  assert.ok(!s.tomarNueva(), 'la marca se borra al tomarla');
  const [a3, b] = s.actualizar([{ x: 0.33, y: 0.31, w: 0.2, h: 0.2 }, { x: 0.7, y: 0.2, w: 0.15, h: 0.15 }], 660);
  assert.equal(a3.id, a.id);
  assert.notEqual(b.id, a.id);
  assert.ok(s.hayNueva());
  // El orden de las cajas cambia: cada caja sigue con su pista (por solapamiento, no por orden).
  const [b2, a4] = s.actualizar([{ x: 0.69, y: 0.21, w: 0.15, h: 0.15 }, { x: 0.34, y: 0.3, w: 0.2, h: 0.2 }], 990);
  assert.equal(b2.id, b.id);
  assert.equal(a4.id, a.id);
  assert.ok(iou({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: 1 }) === 1 && iou({ x: 0, y: 0, w: 0.1, h: 0.1 }, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }) === 0);
});

prueba('seguir: una foto sin la cara no la cierra; pasado PERDIDA_MS sí (y deja de dibujarse a VIVA_MS)', () => {
  const s = new Seguidor();
  const [a] = s.actualizar([{ x: 0.3, y: 0.3, w: 0.2, h: 0.2 }], 0);
  s.actualizar([], 400);
  assert.equal(s.visibles(400).length, 1);
  assert.equal(s.visibles(VIVA_MS + 1).length, 0, 'la vista no dibuja cajas viejas');
  const [a2] = s.actualizar([{ x: 0.31, y: 0.3, w: 0.2, h: 0.2 }], 1200);
  assert.equal(a2.id, a.id, 'vuelve tras una foto perdida: la misma pista (y su nombre)');
  const [a3] = s.actualizar([{ x: 0.31, y: 0.3, w: 0.2, h: 0.2 }], 1200 + PERDIDA_MS + 1);
  assert.notEqual(a3.id, a.id, 'tras mucho rato es otra pista');
});

prueba('votar: un acierto suelto no pone nombre; 2 de 3 sí; un «no sé» no lo borra; para cambiarlo hacen falta 2 de 3 de otro', () => {
  const s = new Seguidor();
  const [p] = s.actualizar([{ x: 0.3, y: 0.3, w: 0.2, h: 0.2 }], 0);
  let v = s.votar(p.id, reco('a', 'Ana'), 100);
  assert.equal(v.identidad, null, 'con un voto, «Persona»');
  assert.ok(s.porConfirmar(100));
  v = s.votar(p.id, null, 1300);
  assert.equal(v.identidad, null);
  v = s.votar(p.id, reco('a', 'Ana', 0.28), 2500);
  assert.equal(v.identidad?.nombre, 'Ana');
  assert.ok(v.confirmo, 'acaba de confirmarse (para saludar una vez)');
  assert.equal(v.identidad.distancia, 0.28, 'la mejor distancia de los votos');
  v = s.votar(p.id, null, 5000);
  v = s.votar(p.id, reco('b', 'Beto'), 7500);
  assert.equal(v.identidad?.nombre, 'Ana', '«no sé» + un voto a otro: sigue Ana (no parpadea)');
  assert.ok(!v.confirmo);
  v = s.votar(p.id, reco('b', 'Beto'), 10000);
  assert.equal(v.identidad?.nombre, 'Beto', 'dos de tres dicen Beto: es Beto');
});

prueba('votar: sin un voto a favor en MANTENER_MS (solo «no sé»), el nombre se suelta', () => {
  const ana = reco('a', 'Ana');
  const votos = [
    { id: 'a', nombre: 'Ana', relacion: 'conocido', distancia: 0.3, ts: 0 },
    { id: 'a', nombre: 'Ana', relacion: 'conocido', distancia: 0.3, ts: 1000 },
  ];
  const conf = decidirIdentidad(votos, null, 1000);
  assert.equal(conf.nombre, 'Ana');
  const nulos = [...votos, { id: null, distancia: 1, ts: 2000 }, { id: null, distancia: 1, ts: 3000 }, { id: null, distancia: 1, ts: 4000 }];
  assert.equal(decidirIdentidad(nulos, conf, 5000)?.nombre, 'Ana');
  assert.equal(decidirIdentidad(nulos, conf, 1000 + MANTENER_MS + 1), null);
  assert.equal(CONFIRMAR, 2);
  assert.ok(ana);
});

prueba('para el cerebro: los confirmados y las caras sin nombre ya miradas 2 veces (a quien recién llega no se le dice «no te conozco»)', () => {
  const s = new Seguidor();
  const [a, b] = s.actualizar([{ x: 0.1, y: 0.3, w: 0.2, h: 0.2 }, { x: 0.6, y: 0.3, w: 0.2, h: 0.2 }], 0);
  s.votar(a.id, reco('a', 'Ana', 0.3, { parentesco: 'esposa' }), 0);
  s.votar(a.id, reco('a', 'Ana', 0.3, { parentesco: 'esposa' }), 100);
  assert.deepEqual(s.presentes(200).desconocidas, 0, 'b aún no se miró');
  s.votar(b.id, null, 200);
  s.votar(b.id, null, 300);
  const p = s.presentes(400);
  assert.equal(p.desconocidas, 1);
  assert.equal(frasePresentes(p.r, p.desconocidas), 'Reconozco a Ana (tu esposa); 1 persona(s) que no conozco');
  assert.equal(frasePresentes(p.r, 0, false, true), 'Con la cámara trasera: reconozco a Ana (tu esposa)');
  s.olvidar('a');
  assert.equal(s.presentes(500).r.length, 0, '«olvida a Ana»: su nombre se va de la vista ya');
});

prueba('cuándo mirar quién es: enseguida al llegar, ~1,2 s si falta un voto, ~2,5 s con la vista o alguien sin nombre, ~8 s si no; nunca dos a la vez', () => {
  const base = { ahora: 10_000, ultima: 9_900, nueva: false, porConfirmar: false, vistaAbierta: false, sinIdentificar: false, ocupado: false };
  assert.ok(tocaReconocer({ ...base, nueva: true }));
  assert.ok(!tocaReconocer({ ...base, nueva: true, ocupado: true }));
  assert.ok(!tocaReconocer({ ...base, ultima: 10_000 - RECONOCER.confirmarMs + 1, porConfirmar: true }));
  assert.ok(tocaReconocer({ ...base, ultima: 10_000 - RECONOCER.confirmarMs, porConfirmar: true }));
  assert.ok(tocaReconocer({ ...base, ultima: 10_000 - 2500, vistaAbierta: true }));
  assert.ok(tocaReconocer({ ...base, ultima: 10_000 - 2500, sinIdentificar: true }));
  assert.ok(!tocaReconocer({ ...base, ultima: 10_000 - 2500 }), 'todos con nombre y sin la vista: más calma');
  assert.ok(tocaReconocer({ ...base, ultima: 10_000 - 8000 }));
  assert.ok(RECONOCER.calmaMs < 20_000, 'antes era cada 20 s');
});

/* ── lo que se dibuja ────────────────────────────────────────────────────────────────────── */

prueba('dibujo: «José · tú», «Ana · tu esposa», «Persona»; «mirando» solo en la principal y solo con la frontal; objetos frescos con caja fiable', () => {
  const yo = { id: 'j', nombre: 'José', relacion: 'yo', distancia: 0.2, desde: 0, ultimoVoto: 0 };
  const ana = { id: 'a', nombre: 'Ana', relacion: 'conocido', parentesco: 'esposa', distancia: 0.3, desde: 0, ultimoVoto: 0 };
  assert.equal(etiquetaCara(yo, 'frontal'), 'José · tú');
  assert.equal(etiquetaCara(yo, 'trasera'), 'José');
  assert.equal(etiquetaCara(ana, 'frontal'), 'Ana · tu esposa');
  assert.equal(etiquetaCara(null, 'frontal'), 'Persona');
  assert.equal(etiquetaCara(null, 'frontal', true), 'Person');
  const pistas = [
    { id: 1, caja: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, visto: 0, nacio: 0, votos: [], identidad: yo },
    { id: 2, caja: { x: 0.6, y: 0.3, w: 0.1, h: 0.1 }, visto: 0, nacio: 0, votos: [], identidad: null },
  ];
  const v = { escena: '', lugar: '', personas: [], objetos: [{ nombre: 'taza', donde: '', caja: { x: 0.1, y: 0.7, w: 0.1, h: 0.1 } }, { nombre: 'libro', donde: '' }], textos: [], precios: [], principal: '', cajasFiables: true, formato: 'json' };
  const m = marcasEnVivo({ pistas, mirando: true, lado: 'frontal', vista: { v, ts: 0 }, ahora: 1000 });
  assert.deepEqual(m.map((x) => [x.tipo, x.etiqueta, x.detalle || '']), [['cara', 'José · tú', 'mirando'], ['cara', 'Persona', ''], ['objeto', 'taza', '']]);
  assert.ok(!marcasEnVivo({ pistas, mirando: true, lado: 'trasera', vista: null, ahora: 0 }).some((x) => x.detalle), 'con la trasera nadie «mira la pantalla»');
  assert.equal(marcasEnVivo({ pistas: [], mirando: false, lado: 'frontal', vista: { v, ts: 0 }, ahora: VISTA_FRESCA_MS + 1 }).length, 0, 'objetos viejos no');
  assert.equal(marcasEnVivo({ pistas: [], mirando: false, lado: 'frontal', vista: { v: { ...v, cajasFiables: false }, ts: 0 }, ahora: 0 }).length, 0, 'cajas no fiables: no se inventan recuadros');
});

prueba('línea de estado: te veo · mirando la pantalla / no veo a nadie / reconociendo… / cámara trasera', () => {
  const b = { lado: 'frontal', personas: 1, mirando: true, nombres: [], reconociendo: false };
  assert.equal(lineaEstado(b), 'Te veo · mirando la pantalla');
  assert.equal(lineaEstado({ ...b, mirando: false, reconociendo: true }), 'Te veo · mirando a otro lado · Reconociendo…');
  assert.equal(lineaEstado({ ...b, nombres: ['José · tú'] }), 'Te veo, José · tú · mirando la pantalla');
  assert.equal(lineaEstado({ ...b, personas: 0 }), 'No veo a nadie');
  assert.equal(lineaEstado({ ...b, personas: 2, nombres: ['Ana · tu esposa'] }), 'Veo a dos personas: Ana · tu esposa');
  assert.equal(lineaEstado({ ...b, lado: 'trasera', personas: 2 }), 'Cámara trasera · veo a dos personas');
  assert.equal(lineaEstado({ ...b, lado: 'trasera', personas: 0 }), 'Cámara trasera · no veo a nadie');
  assert.equal(lineaEstado({ ...b, sinDetector: true }), 'Miro con el servidor (sin recuadros de caras)');
  assert.equal(lineaEstado({ ...b, en: true }), 'I see you · looking at the screen');
});

/* ── la cámara elegida y la voz ──────────────────────────────────────────────────────────── */

prueba('cámara elegida: frontal salvo «trasera» guardada; se guarda al cambiar y se lee al entrar', () => {
  assert.equal(ladoValido('trasera'), 'trasera');
  for (const v of [undefined, null, 'frontal', 'back', 1, {}]) assert.equal(ladoValido(v), 'frontal', String(v));
  const storage = leer('src/lib/storage.ts');
  assert.match(storage, /camaraLado\?: 'frontal' \| 'trasera'/);
  const mesa = leer('src/screens/DeskScreen.tsx');
  assert.match(mesa, /saveSettings\(\{ camaraLado: l \}\)/, 'cambiar de cámara se guarda');
  assert.match(mesa, /setLadoCamara\(ladoValido\(s\.camaraLado\)\)/, 'y se lee al entrar a la mesa');
});

prueba('voz: «muéstrame lo que ves», «cierra la vista», «cámara trasera / de atrás / frontal», «voltea la cámara»', () => {
  for (const t of ['Muéstrame lo que ves', 'enséñame la cámara', 'déjame ver lo que estás viendo', 'abre la vista', 'show me what you see']) assert.equal(pedidoDeVista(t), 'abrir', t);
  for (const t of ['Cierra la vista', 'quita la vista', 'ya no me muestres la cámara']) assert.equal(pedidoDeVista(t), 'cerrar', t);
  for (const t of ['cámara trasera', 'pon la cámara de atrás', 'usa la de atrás', 'back camera']) assert.equal(pedidoDeVista(t), 'trasera', t);
  for (const t of ['cámara frontal', 'la cámara de adelante', 'front camera']) assert.equal(pedidoDeVista(t), 'frontal', t);
  for (const t of ['voltea la cámara', 'cambia de cámara', 'gira la cámara', 'flip the camera']) assert.equal(pedidoDeVista(t), 'voltear', t);
  for (const t of ['¿qué ves?', 'léeme esto', 'apaga la cámara', 'abre la cámara', 'no me veas', 'hola']) assert.equal(pedidoDeVista(t), null, t);
  // «Cierra / quita / apaga la cámara» es APAGARLA siempre (lib/camaraModo.ts; apagada, la vista se cierra
  // sola), también con la vista abierta: antes cerraba solo la vista y la cámara seguía mirando (revisión
  // del 5-oct). Solo «cierra la vista», «ya no me muestres…» (u «oculta la cámara») cierra la vista.
  for (const abierta of [true, false]) {
    for (const t of ['cierra la cámara', 'Quita la cámara', 'apaga la cámara', 'close the camera']) {
      assert.equal(pedidoDeVista(t, { vistaAbierta: abierta }), null, `${t} (vista ${abierta ? 'abierta' : 'cerrada'})`);
      assert.match(String(pedidoDeCamara(t)), /^apagar/, t);
    }
  }
  for (const t of ['cierra la vista', 'ya no me muestres lo que ves', 'oculta la cámara']) assert.equal(pedidoDeVista(t, { vistaAbierta: true }), 'cerrar', t);
  assert.equal(pedidoDeCamara('cierra la vista'), null, 'cerrar la vista no apaga la cámara');
  assert.equal(pedidoDeCamara('abre la cámara'), 'encender', '«abre la cámara» sigue siendo encenderla');
});

/* ── aprender ────────────────────────────────────────────────────────────────────────────── */

prueba('conóceme: 5 poses dichas en voz alta y las 5 muestras más distintas de la MISMA persona (otra que pasó, afuera)', () => {
  assert.equal(MUESTRAS_APRENDER, 5);
  assert.ok(POSES.length >= 5 && POSES.some((p) => /izquierda/.test(p.es)) && POSES.some((p) => /derecha/.test(p.es)) && POSES.every((p) => p.en));
  // 10 tomas: 4 casi iguales (de frente), 5 de poses distintas, y una de OTRA persona que se coló.
  const tomas = [
    ...[0, 1, 2, 3].map((k) => vista(toma(1, 0.004, k))),
    ...[10, 11, 12, 13, 14].map((k) => vista(toma(1, 0.05, k))),
    vista(toma(2, 0.01, 0)),
  ];
  const e = elegirMuestras(tomas);
  assert.equal(e.length, 5);
  assert.ok(!e.some((c) => distancia(c.vector, toma(2)) < UMBRAL), 'la otra persona no entra');
  const minimo = (lista) => Math.min(...lista.flatMap((a, i) => lista.slice(i + 1).map((b) => distancia(a.vector, b.vector))));
  const primeras = tomas.slice(0, 5);
  assert.ok(minimo(e) > minimo(primeras) * 2, `más distintas entre sí que 5 seguidas (${minimo(e).toFixed(3)} vs ${minimo(primeras).toFixed(3)})`);
  assert.ok(e.every((c) => distancia(c.vector, toma(1)) < UMBRAL), 'todas siguen siendo ella');
  assert.equal(elegirMuestras([tomas[0]]).length, 1);
  assert.equal(elegirMuestras([]).length, 0);
  assert.equal(elegirMuestras([tomas[0], vista(tomas[0].vector)]).length, 1, 'dos tomas idénticas enseñan una');
});

prueba('aprender con el uso: tope de 12, sale la más redundante; solo con reconocimiento muy seguro, confirmado, cara grande y sin abusar', () => {
  assert.equal(MAX_MUESTRAS, 12);
  const vs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((k) => toma(1, 0.05, k));
  const casi = vs[3].map((x) => Math.round((x + 0.0005) * 1e4) / 1e4);
  const r = sumarMuestras(vs, [casi]);
  assert.equal(r.length, 12);
  assert.ok(r.includes(casi) !== r.includes(vs[3]), 'de la pareja casi igual queda una');
  assert.deepEqual(r[0], vs[0], 'las demás no se tocan');
  assert.equal(sumarMuestras([], [toma(1), 'basura']).length, 1, 'lo que no es vector no entra');
  const ok = { confirmada: true, tam: 0.3, ahora: 10 * 60_000 + 1, ultima: 0, enSesion: 0 };
  const seguro = reco('a', 'Ana', 0.25, { margen: 0.3 });
  assert.ok(debeAprender(seguro, { ...ok, ultima: undefined }));
  assert.ok(!debeAprender(seguro, { ...ok, confirmada: false }), 'un acierto suelto no enseña');
  assert.ok(!debeAprender(reco('a', 'Ana', 0.42), ok), 'cerca del umbral: no (podría ser otra persona)');
  assert.ok(!debeAprender(reco('a', 'Ana', 0.05), ok), 'casi igual a una muestra que ya hay: no enseña nada');
  assert.ok(!debeAprender(reco('a', 'Ana', 0.25, { margen: 0.08 }), ok), 'sin margen sobre el segundo: no');
  assert.ok(!debeAprender(seguro, { ...ok, tam: 0.05 }), 'cara chica y lejana: no');
  assert.ok(!debeAprender(seguro, { ...ok, ultima: ok.ahora - 60_000 }), 'una vez cada 10 min por persona');
  assert.ok(!debeAprender(seguro, { ...ok, enSesion: APRENDER.porSesion }), 'tope por sesión');
});

prueba('identificar da el margen sobre el segundo y el parentesco; el parentesco se guarda de una lista cerrada', () => {
  const ana = { id: 'a', nombre: 'Ana', relacion: 'conocido', parentesco: 'esposa', vectores: [toma(2)] };
  const jose = { id: 'j', nombre: 'José', relacion: 'yo', vectores: [toma(1)] };
  const r = identificar(toma(2, 0.03, 5), [ana, jose]);
  assert.equal(r.nombre, 'Ana');
  assert.equal(r.parentesco, 'esposa');
  assert.ok(r.margen > 0.5, String(r.margen));
  assert.equal(identificar(toma(1, 0.03, 5), [jose]).margen, 1, 'sin segundo: margen 1');
  assert.equal(parentescoValido('Mamá'), 'mamá');
  assert.equal(parentescoValido('mujer'), 'esposa');
  assert.equal(parentescoValido('jefe supremo'), undefined);
  assert.equal(parentescoValido('constructor'), undefined, 'ni propiedades del objeto');
});

/* ── costuras leídas del código ──────────────────────────────────────────────────────────── */

prueba('costuras: la foto del bucle va al motor de caras (sin segunda foto), con las cajas de ML Kit; la frontal se dibuja espejada', () => {
  const cv = leer('src/components/CamaraVision.tsx');
  assert.match(cv, /if \(subir \|\| pedir\) b64 = await FileSystem\.readAsStringAsync\(foto\.uri/, 'la foto se lee una vez para el servidor y/o las caras');
  assert.match(cv, /borrar\(foto\.uri\);\n\s+if \(b64/, 'y se borra siempre');
  assert.match(cv, /minFaceSize: MIN_CARA_MLKIT/);
  assert.match(cv, /cajaEnPantalla\(mk\.caja, dims, m, lado === 'frontal'\)/, 'espejo solo con la frontal');
  assert.match(cv, /key=\{lado\}/, 'otra cámara: se vuelve a montar y espera su onCameraReady');
  assert.match(cv, /facing=\{lado === 'trasera' \? 'back' : 'front'\}/);
  assert.match(cv, /if \(e\.principal && !trasera\)/, 'con la trasera la mirada no sigue caras');
  const motor = leer('src/caras/motorCarasHtml.ts');
  assert.match(motor, /var cajas = Array\.isArray\(m\.cajas\)/);
  assert.match(motor, /integrity="\$\{FACE_API_SRI\}"/, 'el script sigue fijado con su huella');
  const uc = leer('src/caras/useCaras.tsx');
  assert.match(uc, /motor\.current\?\.analizar\(f\.b64, f\.cajas\.map/);
  const mesa = leer('src/screens/DeskScreen.tsx');
  assert.match(mesa, /activa: verPersona && ladoCamara === 'frontal'/, 'los ojos del avatar solo siguen con la frontal');
  assert.match(mesa, /vista=\{previaCamara \|\| vistaCamara\}/, 'apuntar para leer usa la misma vista');
});

prueba('sin ML Kit (respaldo del servidor) también se reconoce seguido, y con ML Kit no se pide dos veces (revisión del 5-oct, M3)', () => {
  // Cuándo: sin cajas no hay pistas que votar; cada foto del respaldo (12 s) basta, con su ritmo y nunca dos a la vez.
  assert.ok(RESPALDO.cadaMs > 0 && RESPALDO.cadaMs <= 12_000 && RESPALDO.frescoMs >= 2 * 12_000, JSON.stringify(RESPALDO));
  assert.equal(tocaReconocerRespaldo({ ahora: 100_000, ultima: 0, ocupado: false, reconoce: true }), true);
  assert.equal(tocaReconocerRespaldo({ ahora: 100_000, ultima: 0, ocupado: true, reconoce: true }), false, 'nunca dos a la vez');
  assert.equal(tocaReconocerRespaldo({ ahora: 100_000, ultima: 0, ocupado: false, reconoce: false }), false, 'sin caras activas o sin conocidas, nada');
  assert.equal(tocaReconocerRespaldo({ ahora: 100_000, ultima: 100_000 - RESPALDO.cadaMs + 1, ocupado: false, reconoce: true }), false);
  // Lo visto por el respaldo vale para la escena mientras es fresco (una foto cada 12-30 s) y se olvida al pedirlo.
  const v = new VistoRespaldo();
  const ana = { id: 'a', nombre: 'Ana', relacion: 'conocido', parentesco: 'esposa', distancia: 0.3, desde: 0, ultimoVoto: 0 };
  v.poner([ana], 1, 1000);
  assert.deepEqual(v.presentes(1000 + RESPALDO.frescoMs - 1), { r: [ana], desconocidas: 1 });
  assert.deepEqual(v.presentes(1000 + RESPALDO.frescoMs + 1), { r: [], desconocidas: 0 });
  v.poner([ana], 0, 5000);
  v.olvidar('a');
  assert.deepEqual(v.presentes(5001), { r: [], desconocidas: 0 }, '«olvida a Ana» la quita ya');
  // Las costuras: el bucle ofrece la foto a las caras por el respaldo SOLO sin ML Kit (con ML Kit va por onCaras).
  const cv = leer('src/components/CamaraVision.tsx');
  assert.match(cv, /if \(mlOk\.current\) \{[\s\S]*?cb\.current\.onCaras\([\s\S]*?\} else pedir = cb\.current\.onFotoRespaldo\(Date\.now\(\)\);/, 'una sola vía por foto');
  const uc = leer('src/caras/useCaras.tsx');
  assert.match(uc, /motor\.current\?\.analizar\(f\.b64\)/, 'sin cajas, el motor busca las caras en la foto');
  assert.match(uc, /respaldo\.presentes\(/, 'lo del respaldo entra a la escena');
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
