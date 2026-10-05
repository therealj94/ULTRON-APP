/**
 * Pruebas en Node de los toques a Claudio y ANT-ONIO en video (sin teléfono):
 *   el motor de los toques (la ráfaga de 4, los toques sueltos y sus golpes variados, el descanso, una
 *   secuencia a la vez, lo sutil cuando habla / oye / conversa / está en la llamada, «reducir movimiento»,
 *   el ataque que pide la mesa), la escena (el sable en la mano, los disparos de borde a borde, la
 *   sacudida, los sonidos y la vibración), la agenda (el golpe de un toque suelto espera al dedo quieto; el
 *   sable espera la mano del video, se queda con el clip, sale desde el borde si no llega o si la voz
 *   manda, se desvanece si la mano se va igual; tapado, nada queda) y que la capa no se quede con el dedo.
 *
 *   cd mobile && npx tsx src/avatares/pruebas/efectos.prueba.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENFRIAR_MS, GOLPE_ENTRE_MS, MotorToques, TOQUES_RAFAGA, VENTANA_MS, duracionEfecto, esSutil } from '../video/efectos/toques.ts';
import { AGARRES, AGARRES_BORDE, CORTE_MS, aCaja, encuadreDe, estadoEspada, estadoRayo, eventosDe, planBlasters, planEspada, planOnda, puntasEspada, sacudida } from '../video/efectos/escena.ts';
import { Agenda, ESPERA_MANO_MS, GOLPE_TOQUE_ESPERA_MS, GolpesDeToque, MIRAR_MANO_MS, sacarSable } from '../video/efectos/agenda.ts';
import { ENFRIAR_GOLPE_MS } from '../video/guion.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const pruebas = [];
const prueba = (nombre, f) => pruebas.push([nombre, f]);

/** Un azar fijo (siempre `v`) o una lista que se repite. */
const fijo = (...vs) => {
  let i = 0;
  return () => vs[i++ % vs.length];
};
const TRANQUILO = {};
/** Cuatro toques seguidos (cada `paso` ms) desde `t`; devuelve las reacciones. */
function rafaga(m, t, c = TRANQUILO, paso = 250, n = TOQUES_RAFAGA) {
  const r = [];
  for (let i = 0; i < n; i++) r.push(m.tocar(t + i * paso, typeof c === 'function' ? c(i) : c, 'cabeza', 100, 200));
  return r;
}

/* ── el motor de los toques ──────────────────────────────────────────────────────────────── */

prueba('cuatro toques en la ventana sacan el sable o los blasters', () => {
  const m = new MotorToques({ avatar: 'claudio', rng: fijo(0.5) });
  const r = rafaga(m, 1000);
  assert.deepEqual(r.slice(0, 3).map((x) => x.tipo), ['toque', 'toque', 'toque']);
  const s = r[3];
  assert.equal(s.tipo, 'secuencia');
  assert.equal(s.efecto, 'espada', 'Claudio prefiere el sable (0,5 < 0,7)');
  assert.equal(s.sutil, false);
  assert.equal(s.sonido, true);
  assert.equal(s.voz, true, 'la mesa dice su frase');
  assert.equal(s.golpe, 'niega', 'con el sable se molesta');
  assert.equal(s.duracion, duracionEfecto('espada', false, false));
});

prueba('tres toques son reacciones normales, y cuatro muy separados tampoco hacen ráfaga', () => {
  const m = new MotorToques({ avatar: 'claudio', rng: fijo(0.1) });
  assert.ok(rafaga(m, 0, TRANQUILO, 300, 3).every((x) => x.tipo === 'toque'));
  const m2 = new MotorToques({ avatar: 'claudio', rng: fijo(0.1) });
  const r = rafaga(m2, 0, TRANQUILO, VENTANA_MS / 3 + 10);
  assert.ok(r.every((x) => x.tipo === 'toque'), 'el cuarto cae fuera de la ventana');
  // Justo dentro de la ventana sí.
  const m3 = new MotorToques({ avatar: 'claudio', rng: fijo(0.1) });
  assert.equal(rafaga(m3, 0, TRANQUILO, (VENTANA_MS - 10) / 3)[3].tipo, 'secuencia');
});

prueba('ANT-ONIO prefiere los blasters; nunca tres veces seguidas lo mismo', () => {
  const a = new MotorToques({ avatar: 'antonio', rng: fijo(0.5) });
  const s = rafaga(a, 0)[3];
  assert.equal(s.efecto, 'blasters');
  assert.equal(s.golpe, 'sorpresa', 'con los blasters se asusta');
  // Con un azar que siempre pide el sable: sable, sable y el tercero blasters.
  const m = new MotorToques({ avatar: 'claudio', rng: fijo(0) });
  const efectos = [];
  for (let k = 0; k < 4; k++) efectos.push(rafaga(m, k * (ENFRIAR_MS + 1000))[3].efecto);
  assert.deepEqual(efectos, ['espada', 'espada', 'blasters', 'espada']);
  // Y el azar decide de verdad: con 0,9 Claudio también saca blasters.
  assert.equal(rafaga(new MotorToques({ avatar: 'claudio', rng: fijo(0.9) }), 0)[3].efecto, 'blasters');
});

prueba('una secuencia a la vez: los toques encima solo hacen la onda, sin golpe', () => {
  const m = new MotorToques({ avatar: 'claudio', rng: fijo(0.5) });
  const s = rafaga(m, 0)[3];
  const t0 = 750;
  assert.ok(m.enCurso(t0 + 100));
  const encima = rafaga(m, t0 + 100, TRANQUILO, 100, 6);
  assert.ok(encima.every((x) => x.tipo === 'toque' && x.enSecuencia && x.golpe === null && x.sutil));
  assert.ok(!m.enCurso(t0 + s.duracion + 1));
});

prueba('spam: otra ráfaga en el descanso solo lo molesta; después del descanso, otra secuencia', () => {
  const m = new MotorToques({ avatar: 'claudio', rng: fijo(0.5) });
  rafaga(m, 0); // la secuencia empieza en 750
  const t = 750 + duracionEfecto('espada', false, false) + 500;
  const r = rafaga(m, t);
  assert.equal(r[3].tipo, 'molesto');
  assert.equal(r[3].golpe, null, 'acaba de negar con el sable (niega no vuelve antes de 8 s) y el primer toque ya usó la duda');
  const r2 = rafaga(m, 750 + ENFRIAR_GOLPE_MS + 200);
  assert.equal(r2[3].tipo, 'molesto');
  assert.equal(r2[3].golpe, 'niega', 'pasado el enfriamiento del guion, niega con la cabeza');
  const r3 = rafaga(m, 750 + ENFRIAR_MS + 10);
  assert.equal(r3[3].tipo, 'secuencia');
  assert.equal(r3[3].n, 2);
});

prueba('hablando, oyendo, pensando, dormido, conversando o en la llamada: todo sutil', () => {
  for (const c of [{ hablando: true }, { escuchando: true }, { pensando: true }, { dormido: true }, { conversando: true }, { enLlamada: true }]) {
    assert.ok(esSutil(c));
    const m = new MotorToques({ avatar: 'claudio', rng: fijo(0.5) });
    const r = rafaga(m, 0, c);
    assert.ok(r.slice(0, 3).every((x) => x.tipo === 'toque' && x.sutil && x.golpe === null), JSON.stringify(c));
    const s = r[3];
    assert.equal(s.tipo, 'secuencia');
    assert.equal(s.sutil, true);
    assert.equal(s.sonido, false, 'sin sonido');
    assert.equal(s.voz, false, 'sin frase');
    assert.equal(s.golpe, null, 'sin golpe del video');
    assert.equal(s.duracion, duracionEfecto(s.efecto, true, false), 'la versión corta');
  }
  assert.ok(!esSutil({}));
});

prueba('la ráfaga vale por cómo estaba al empezar: la frase del primer toque no le quita el sable', () => {
  const m = new MotorToques({ avatar: 'claudio', rng: fijo(0.5) });
  // El primer toque, tranquilo; desde el segundo ya está diciendo la frase del toque.
  const r = rafaga(m, 0, (i) => (i === 0 ? {} : { hablando: true }));
  assert.equal(r[3].tipo, 'secuencia');
  assert.equal(r[3].sutil, false);
  // Pero si empezó hablando (una respuesta de verdad), es sutil aunque termine de hablar.
  const m2 = new MotorToques({ avatar: 'claudio', rng: fijo(0.5) });
  assert.equal(rafaga(m2, 0, (i) => (i === 0 ? { hablando: true } : {}))[3].sutil, true);
  // Y una conversación que se abre en medio la vuelve sutil.
  const m3 = new MotorToques({ avatar: 'claudio', rng: fijo(0.5) });
  assert.equal(rafaga(m3, 0, (i) => (i === 3 ? { conversando: true } : {}))[3].sutil, true);
});

prueba('reducir movimiento: la secuencia sale quieta (sin estela, sin sacudida) y más corta', () => {
  const m = new MotorToques({ avatar: 'antonio', rng: fijo(0.5) });
  const s = rafaga(m, 0, { reducido: true })[3];
  assert.equal(s.tipo, 'secuencia');
  assert.equal(s.reducido, true);
  assert.equal(s.duracion, duracionEfecto('blasters', false, true));
  const pe = planEspada('claudio', 'cuerpo', 390, 620, false, true);
  for (let t = 0; t <= pe.dur; t += 50) {
    const e = estadoEspada(pe, t);
    assert.equal(e.fuerzaEstela, 0);
    assert.ok(e.hoja === 0 || e.hoja === 1, 'la hoja no crece: aparece con un fundido');
    assert.ok(Math.abs(e.ang - pe.lado * pe.angulo) < 1e-9, 'no se blande ni tiembla');
  }
  const pb = planBlasters(390, 620, false, true, fijo(0.3, 0.7, 0.5));
  assert.equal(pb.sacudir, 0);
  for (let t = 0; t < pb.dur; t += 37) assert.deepEqual(sacudida(pb, t), { x: 0, y: 0, k: 1 });
  const r = pb.rayos[0];
  const a = estadoRayo(pb, r, r.t0 + 300);
  const b = estadoRayo(pb, r, r.t0 + 500);
  assert.equal(a.hx, b.hx, 'el disparo no vuela');
  assert.equal(a.fogonazo, 0);
  assert.ok(!eventosDe(pe, true).some((e) => e.sfx === 'whoosh'), 'sin zumbidos de tajos que no hay');
});

prueba('toques sueltos: golpes variados, nunca el mismo dos veces seguidas, ni dos en GOLPE_ENTRE_MS', () => {
  const m = new MotorToques({ avatar: 'claudio', rng: fijo(0, 0.4, 0.8, 0.2, 0.6, 0.95) });
  const golpes = [];
  for (let k = 0; k < 12; k++) golpes.push(m.tocar(k * 3000, {}, k % 2 ? 'panza' : 'cabeza').golpe);
  for (let k = 1; k < golpes.length; k++) if (golpes[k] && golpes[k - 1]) assert.notEqual(golpes[k], golpes[k - 1]);
  assert.ok(new Set(golpes.filter(Boolean)).size >= 4, `variados: ${golpes.join(', ')}`);
  // El mismo clip no vuelve antes del enfriamiento del guion (no pediría algo que el guion no va a hacer).
  const vistos = new Map();
  golpes.forEach((g, k) => {
    if (!g) return;
    if (vistos.has(g)) assert.ok(k * 3000 - vistos.get(g) >= ENFRIAR_GOLPE_MS, `${g} repetido muy pronto`);
    vistos.set(g, k * 3000);
  });
  const m2 = new MotorToques({ avatar: 'claudio', rng: fijo(0.5) });
  assert.ok(m2.tocar(0, {}).golpe);
  assert.equal(m2.tocar(GOLPE_ENTRE_MS - 100, {}).golpe, null, 'muy pronto: solo la onda');
});

prueba('el ataque de la mesa: se ve sin sonido propio, nunca encima de otro, y reinicia el descanso', () => {
  const m = new MotorToques({ avatar: 'claudio', rng: fijo(0.5) });
  const a = m.ataque(0, 'blasters', { hablando: true });
  assert.equal(a.tipo, 'secuencia');
  assert.equal(a.sonido, false);
  assert.equal(a.voz, false);
  assert.equal(a.sutil, false, 'la mesa diciendo su frase no lo vuelve sutil');
  assert.equal(m.ataque(500, 'espada', {}), null, 'ya hay una a la vista');
  assert.equal(rafaga(m, 4000)[3].tipo, 'molesto', 'descansando');
  assert.equal(m.ataque(0, 'espada', { conversando: true }) === null, true);
  assert.equal(new MotorToques({ avatar: 'claudio' }).ataque(0, 'espada', { conversando: true }).sutil, true);
});

prueba('tapado a mitad: la secuencia se da por terminada y nada queda «en curso»', () => {
  const m = new MotorToques({ avatar: 'claudio', rng: fijo(0.5) });
  rafaga(m, 0);
  assert.ok(m.enCurso(1000));
  m.cancelar(1000);
  assert.ok(!m.enCurso(1001));
  assert.equal(m.tocar(1500, {}).enSecuencia, false);
});

prueba('cuatro toques: el contador vuelve a cero tras la ráfaga, si se tapa, y con toques separados nunca suma', () => {
  const m = new MotorToques({ avatar: 'claudio', rng: fijo(0.5) });
  assert.equal(rafaga(m, 0)[3].tipo, 'secuencia');
  // Justo después: tres toques no completan otra ráfaga con los de antes.
  const t = 750 + duracionEfecto('espada', false, false) + 50;
  assert.ok(rafaga(m, t, TRANQUILO, 200, 3).every((x) => x.tipo === 'toque'));
  // Tres toques, se tapa, uno más: no es ráfaga (el tapado borra la cuenta).
  const m2 = new MotorToques({ avatar: 'claudio', rng: fijo(0.5) });
  rafaga(m2, 0, TRANQUILO, 200, 3);
  m2.cancelar(650);
  assert.equal(m2.tocar(700, {}).tipo, 'toque');
  // Toques de a uno, separados más que la ventana: nunca ráfaga.
  const m3 = new MotorToques({ avatar: 'claudio', rng: fijo(0.5) });
  for (let i = 0; i < 12; i++) assert.equal(m3.tocar(i * (VENTANA_MS / 3 + 50), {}).tipo, 'toque');
});

prueba('mostrar: si el sable esperó la mano, «en curso» dura hasta que se termina de ver (el ataque de la mesa no se encima)', () => {
  const m = new MotorToques({ avatar: 'claudio', rng: fijo(0.5) });
  const s = rafaga(m, 0)[3];
  const dur = s.duracion;
  m.mostrar(750 + 1500, 'espada', dur);
  assert.ok(m.enCurso(750 + dur + 100), 'todavía se ve');
  assert.equal(m.ataque(750 + dur + 100, 'blasters', {}), null, 'el blaster de la mesa no se encima');
  assert.ok(!m.enCurso(750 + 1500 + dur + 1));
  // Salió con otro efecto: lo de «nunca tres seguidas» cuenta lo que se vio.
  const m2 = new MotorToques({ avatar: 'claudio', rng: fijo(0) });
  rafaga(m2, 0);
  m2.mostrar(750, 'blasters', 1000);
  rafaga(m2, ENFRIAR_MS + 1000);
  assert.equal(rafaga(m2, 2 * (ENFRIAR_MS + 1000))[3].efecto, 'espada', 'blasters, espada: el tercero puede ser espada otra vez');
});

/** Un reloj de mentira para la agenda. */
function relojFalso() {
  let t = 0;
  const pendientes = [];
  const reloj = {
    poner: (ms, f) => {
      const x = { t: t + ms, f };
      pendientes.push(x);
      return x;
    },
    quitar: (x) => {
      const i = pendientes.indexOf(x);
      if (i >= 0) pendientes.splice(i, 1);
    },
  };
  const pasar = (ms) => {
    const fin = t + ms;
    for (;;) {
      pendientes.sort((a, b) => a.t - b.t);
      const x = pendientes[0];
      if (!x || x.t > fin) break;
      pendientes.shift();
      t = x.t;
      x.f();
    }
    t = fin;
  };
  return { reloj, pasar, ahora: () => t, pendientes };
}

prueba('el golpe de un toque suelto espera a que el dedo se quede quieto; la ráfaga lo descarta y trae el suyo', () => {
  const r = relojFalso();
  const agenda = new Agenda(r.reloj);
  const pedidos = [];
  const g = new GolpesDeToque(agenda, (c) => pedidos.push([r.ahora(), c]));
  const toque = (golpe) => ({ tipo: 'toque', enSecuencia: false, x: 0, y: 0, sutil: false, reducido: false, golpe });
  g.toque(toque('risa'));
  r.pasar(GOLPE_TOQUE_ESPERA_MS - 1);
  assert.deepEqual(pedidos, []);
  r.pasar(1);
  assert.deepEqual(pedidos, [[GOLPE_TOQUE_ESPERA_MS, 'risa']], 'un toque suelto: su golpe, al rato');
  // Dos toques seguidos: el golpe se corre al último (uno solo).
  g.toque(toque('duda'));
  r.pasar(200);
  g.toque(toque(null));
  r.pasar(GOLPE_TOQUE_ESPERA_MS);
  assert.deepEqual(pedidos.slice(1), [[GOLPE_TOQUE_ESPERA_MS + 200 + GOLPE_TOQUE_ESPERA_MS, 'duda']]);
  // Una ráfaga: lo que esperaba se descarta y el niega del sable va ya.
  g.toque(toque('celebra'));
  r.pasar(150);
  g.toque({ tipo: 'secuencia', efecto: 'espada', golpe: 'niega', x: 0, y: 0, sutil: false, reducido: false, n: 1, duracion: 3200, sonido: true, voz: true, externo: false });
  r.pasar(2000);
  assert.deepEqual(pedidos.slice(2).map((p) => p[1]), ['niega'], 'nunca la celebración a mitad del sable');
  // Toques encima del sable: nada.
  g.toque({ ...toque(null), enSecuencia: true });
  r.pasar(2000);
  assert.equal(pedidos.length, 3);
  // Cortado (tapado, desmontado): nada queda esperando.
  g.toque(toque('saluda'));
  agenda.cortar();
  g.olvidar();
  r.pasar(2000);
  assert.equal(pedidos.length, 3);
  assert.equal(agenda.pendientes, 0);
});

/** Un cuerpo en video de mentira: la mano libre que diga la prueba y lo que se le pidió sostener. */
function cuerpoFalso(r, libre) {
  const c = { sostenido: [], manoLibreMs: () => libre(r.ahora()), sostener: (ms) => c.sostenido.push([r.ahora(), ms]) };
  return c;
}

prueba('sacarSable: en la mesa vertical espera la mano (y sostiene el clip); si no llega, desde el borde y suelta', () => {
  // La mano queda libre a los 600 ms: el sable sale en la mano y el video se queda con su clip lo que dura.
  const r = relojFalso();
  const agenda = new Agenda(r.reloj);
  const c = cuerpoFalso(r, (t) => (t >= 600 ? 9000 : 0));
  let a = null;
  sacarSable(agenda, { ahora: r.ahora, lugar: 'cuerpo', sutil: false, externo: false, necesitaMs: 3200, cuerpo: c, arrancar: (x) => (a = { ...x, t: r.ahora() }) });
  assert.equal(a, null, 'todavía no');
  assert.deepEqual(c.sostenido[0], [0, ESPERA_MANO_MS + 3200], 'desde ya, nada le saca la mano');
  r.pasar(1000);
  assert.deepEqual([a.anclaje, a.t, a.esperoMs], ['mano', 600, 600]);
  assert.deepEqual(c.sostenido[1], [600, 3200]);
  r.pasar(4000);
  assert.equal(agenda.pendientes, 0, 'después, ningún reloj');
  // Nunca llega: a los ESPERA_MANO_MS sale desde el borde y suelta el clip.
  const r2 = relojFalso();
  const ag2 = new Agenda(r2.reloj);
  const c2 = cuerpoFalso(r2, () => 0);
  let b = null;
  sacarSable(ag2, { ahora: r2.ahora, lugar: 'cuerpo', sutil: false, externo: false, necesitaMs: 3200, cuerpo: c2, arrancar: (x) => (b = { ...x, t: r2.ahora() }) });
  r2.pasar(ESPERA_MANO_MS + 500);
  assert.deepEqual([b.anclaje, b.t], ['borde', ESPERA_MANO_MS]);
  assert.deepEqual(c2.sostenido.at(-1), [ESPERA_MANO_MS, 0], 'soltó');
  assert.equal(ag2.pendientes, 0);
});

prueba('sacarSable: hablando o con el comando de voz, la voz manda (desde el borde, sin sostener); retrato y llamada, ya', () => {
  for (const o of [
    { sutil: true, externo: false },
    { sutil: false, externo: true },
  ]) {
    const r = relojFalso();
    const c = cuerpoFalso(r, () => Infinity);
    let a = null;
    sacarSable(new Agenda(r.reloj), { ahora: r.ahora, lugar: 'cuerpo', ...o, necesitaMs: 1700, cuerpo: c, arrancar: (x) => (a = x) });
    assert.equal(a.anclaje, 'borde', JSON.stringify(o));
    assert.deepEqual(c.sostenido, [], 'no le quita la boca a la frase');
  }
  for (const lugar of ['retrato', 'llamada']) {
    const r = relojFalso();
    const c = cuerpoFalso(r, () => 0);
    let a = null;
    sacarSable(new Agenda(r.reloj), { ahora: r.ahora, lugar, sutil: false, externo: false, necesitaMs: 3200, cuerpo: c, arrancar: (x) => (a = x) });
    assert.deepEqual([a.anclaje, a.esperoMs], ['mano', 0], `${lugar}: la mano ya queda bajo el borde`);
    assert.deepEqual(c.sostenido, []);
  }
  // Sin video que preguntar (el 3D): ya.
  let a = null;
  const r = relojFalso();
  sacarSable(new Agenda(r.reloj), { ahora: r.ahora, lugar: 'cuerpo', sutil: false, externo: false, necesitaMs: 3200, cuerpo: null, arrancar: (x) => (a = x) });
  assert.equal(a.anclaje, 'mano');
});

prueba('sacarSable: si la mano se va igual, el sable se desvanece antes; tapado a mitad, suelta el clip y nada queda', () => {
  const r = relojFalso();
  const agenda = new Agenda(r.reloj);
  // Libre al empezar, pero a los 1500 ms la mano se va (un cambio que no llegó al reposo).
  const c = cuerpoFalso(r, (t) => (t < 1200 ? 9000 : Math.max(0, 1500 - t)));
  let cortado = null;
  sacarSable(agenda, { ahora: r.ahora, lugar: 'cuerpo', sutil: false, externo: false, necesitaMs: 3200, cuerpo: c, arrancar: () => {}, cortar: () => (cortado = r.ahora()) });
  r.pasar(4000);
  assert.ok(cortado !== null && cortado + CORTE_MS <= 1500, `se apagó a tiempo (${cortado} + ${CORTE_MS} ms)`);
  assert.ok(cortado >= 1500 - CORTE_MS - MIRAR_MANO_MS - 60, `y no mucho antes (${cortado})`);
  assert.deepEqual(c.sostenido.at(-1), [cortado, 0], 'soltó el clip');
  assert.equal(agenda.pendientes, 0);
  // Tapado mientras espera: la capa corta la agenda y llama a soltar.
  const r2 = relojFalso();
  const ag2 = new Agenda(r2.reloj);
  const c2 = cuerpoFalso(r2, () => 0);
  let salio = false;
  const soltar = sacarSable(ag2, { ahora: r2.ahora, lugar: 'cuerpo', sutil: false, externo: false, necesitaMs: 3200, cuerpo: c2, arrancar: () => (salio = true) });
  r2.pasar(500);
  ag2.cortar();
  soltar();
  soltar();
  r2.pasar(5000);
  assert.equal(salio, false, 'no sale después de tapado');
  assert.deepEqual(c2.sostenido, [
    [0, ESPERA_MANO_MS + 3200],
    [500, 0],
  ], 'suelta una sola vez');
  assert.equal(ag2.pendientes, 0);
});

prueba('el sable desde el borde: la empuñadura bajo el borde de abajo, por fuera del cuerpo, y la hoja en la caja', () => {
  for (const avatar of ['claudio', 'antonio']) {
    for (const [W, H] of [
      [390, 620],
      [360, 540],
    ]) {
      const p = planEspada(avatar, 'cuerpo', W, H, false, false, 'borde');
      const mano = aCaja(AGARRES[avatar].cuerpo.mano, encuadreDe(avatar, 'cuerpo', W, H));
      assert.ok(p.pivote.y > H, `${avatar}: la empuñadura bajo el borde (${p.pivote.y.toFixed(0)} > ${H})`);
      assert.ok(Math.abs(p.pivote.x - W / 2) > Math.abs(mano.x - W / 2), `${avatar}: más afuera que la mano`);
      const e = estadoEspada(p, 2300);
      const q = puntasEspada(p, e.ang, e.hoja);
      assert.ok(q.px > 0 && q.px < W && q.py > H * 0.3 && q.py < H, `${avatar} ${W}×${H}: la hoja se ve (${q.px.toFixed(0)}, ${q.py.toFixed(0)})`);
    }
    assert.equal(AGARRES_BORDE[avatar].lado, AGARRES[avatar].cuerpo.lado, 'del mismo lado que su mano');
    // En el retrato y la llamada el borde es lo mismo de siempre.
    assert.deepEqual(planEspada(avatar, 'retrato', 560, 330, false, false, 'borde').pivote, planEspada(avatar, 'retrato', 560, 330, false, false).pivote);
  }
});

prueba('acostado (retrato): la hoja nunca pasa por encima de la cara, ni en el tajo', () => {
  // La cara en el cuadro del video (0..1): la cabeza de Claudio va de 0,09 a 0,38 de alto; la de ANT-ONIO, de 0,11 a 0,43.
  const CARA = { claudio: { x0: 0.3, x1: 0.7, y0: 0.12, y1: 0.38 }, antonio: { x0: 0.3, x1: 0.7, y0: 0.14, y1: 0.43 } };
  for (const avatar of ['claudio', 'antonio']) {
    const e = encuadreDe(avatar, 'retrato', 560, 330);
    const c = CARA[avatar];
    const dentro = (x, y) => x > e.left + c.x0 * e.width && x < e.left + c.x1 * e.width && y > e.top + c.y0 * e.height && y < e.top + c.y1 * e.height;
    for (const sutil of [false, true]) {
      const p = planEspada(avatar, 'retrato', 560, 330, sutil, false);
      for (let t = 0; t <= p.dur; t += 20) {
        const s = estadoEspada(p, t);
        if (!s.visible || s.hoja <= 0) continue;
        const q = puntasEspada(p, s.ang, s.hoja);
        for (let k = 0; k <= 10; k++) {
          const x = q.bx + ((q.px - q.bx) * k) / 10;
          const y = q.by + ((q.py - q.by) * k) / 10;
          assert.ok(!dentro(x, y), `${avatar}${sutil ? ' sutil' : ''} t=${t}: la hoja pasa por la cara (${x.toFixed(0)}, ${y.toFixed(0)})`);
        }
      }
    }
  }
});

prueba('el corte: el sable se desvanece en CORTE_MS desde donde estaba, sin saltar de ángulo', () => {
  const p = planEspada('claudio', 'cuerpo', 390, 620, false, false);
  const c = { ...p, corte: 1200 };
  assert.equal(estadoEspada(c, 1199).alfaHoja, estadoEspada(p, 1199).alfaHoja);
  const medio = estadoEspada(c, 1200 + CORTE_MS / 2);
  assert.ok(medio.alfaHoja > 0.3 && medio.alfaHoja < 0.7, `a media salida (${medio.alfaHoja})`);
  assert.equal(medio.ang, estadoEspada(p, 1200 + CORTE_MS / 2).ang, 'el mismo ángulo: solo se apaga');
  assert.equal(estadoEspada(c, 1200 + CORTE_MS + 1).visible, false);
});

/* ── la escena ───────────────────────────────────────────────────────────────────────────── */

prueba('el sable va en la mano del video, en cualquier caja, y entra en la caja en reposo', () => {
  for (const avatar of ['claudio', 'antonio']) {
    for (const [W, H] of [
      [390, 620],
      [360, 540],
      [430, 800],
    ]) {
      const p = planEspada(avatar, 'cuerpo', W, H, false, false);
      const mano = aCaja(AGARRES[avatar].cuerpo.mano, encuadreDe(avatar, 'cuerpo', W, H));
      assert.ok(Math.hypot(mano.x - p.pivote.x, mano.y - p.pivote.y) < 1e-9);
      assert.ok(p.pivote.x > 0 && p.pivote.x < W && p.pivote.y > H * 0.5 && p.pivote.y < H, `${avatar} ${W}×${H}: la mano en la mitad de abajo`);
      const e = estadoEspada(p, 2300);
      const q = puntasEspada(p, e.ang, e.hoja);
      assert.ok(q.px > 0 && q.px < W && q.py > 0, `${avatar}: la punta en la caja (${q.px.toFixed(0)}, ${q.py.toFixed(0)})`);
      assert.ok(q.py < p.pivote.y, 'apunta hacia arriba');
    }
    // En el retrato (acostado) la mano queda debajo del borde: el sable entra desde abajo.
    const r = planEspada(avatar, 'retrato', 560, 330, false, false);
    assert.ok(r.pivote.y > 330, `${avatar}: retrato, la empuñadura bajo el borde`);
    const q = puntasEspada(r, estadoEspada(r, 2300).ang, 1);
    assert.ok(q.py > 0 && q.py < 330 && q.px > 0 && q.px < 560, 'la hoja se ve');
    // En la llamada, la hoja pasa por adentro del círculo.
    const l = planEspada(avatar, 'llamada', 142, 142, true, false);
    const ql = puntasEspada(l, estadoEspada(l, 900).ang, 1);
    const mx = (ql.bx + ql.px) / 2;
    const my = (ql.by + ql.py) / 2;
    assert.ok(Math.hypot(mx - 71, my - 71) < 71, `${avatar}: llamada, la mitad de la hoja dentro del círculo`);
  }
  assert.equal(AGARRES.claudio.cuerpo.lado, 1);
  assert.equal(AGARRES.antonio.cuerpo.lado, -1, 'ANT-ONIO lo saca con la otra mano');
});

prueba('el sable: se enciende, blande con estela, se apaga, y dentro de su tiempo', () => {
  const p = planEspada('claudio', 'cuerpo', 390, 620, false, false);
  assert.equal(estadoEspada(p, 0).hoja, 0);
  assert.ok(estadoEspada(p, p.encender[0] + 150).destello > 0.5, 'destello al encender');
  assert.ok(estadoEspada(p, 1000).hoja > 0.99);
  assert.ok(estadoEspada(p, 1330).fuerzaEstela > 0.5, 'estela en el tajo');
  assert.ok(estadoEspada(p, 2300).fuerzaEstela < 0.3, 'sostenido, casi sin estela');
  assert.equal(estadoEspada(p, p.apagar[1] + 10).hoja, 0);
  assert.equal(estadoEspada(p, p.dur + 1).visible, false);
  const s = planEspada('claudio', 'cuerpo', 390, 620, true, false);
  assert.ok(s.largo < p.largo && s.dur < p.dur, 'la sutil es más chica y más corta');
});

prueba('los blasters: de borde a borde, alternando lados, con impacto, sacudida y en su tiempo', () => {
  const W = 390;
  const H = 620;
  const p = planBlasters(W, H, false, false, fijo(0.2, 0.9, 0.4, 0.7, 0.1));
  assert.equal(p.rayos.length, 8);
  p.rayos.forEach((r, i) => {
    assert.ok((r.x0 === 0 && r.x1 === W) || (r.x0 === W && r.x1 === 0));
    if (i) assert.notEqual(r.x0, p.rayos[i - 1].x0, 'alternan');
    assert.ok(r.y0 > 0 && r.y0 < H && r.y1 > 0 && r.y1 < H);
    assert.ok(r.t1 > r.t0 && r.t1 + 320 <= p.dur, 'el último impacto termina antes del final');
    const m = estadoRayo(p, r, (r.t0 + r.t1) / 2);
    assert.equal(m.vuelo, 1);
    assert.ok(estadoRayo(p, r, r.t1 + 50).impacto > 0);
  });
  const r0 = p.rayos[0];
  assert.notDeepEqual(sacudida(p, r0.t1 + 30), { x: 0, y: 0, k: 1 }, 'el impacto sacude');
  assert.ok(Math.abs(sacudida(p, r0.t1 + 30).x) <= p.sacudir * 1.5);
  assert.equal(planBlasters(W, H, true, false, fijo(0.5)).rayos.length, 3, 'sutil: tres');
  assert.equal(planBlasters(W, H, true, false, fijo(0.5)).sacudir, 0, 'sutil: sin sacudida');
  // Con la misma semilla, los mismos disparos.
  assert.deepEqual(planBlasters(W, H, false, false, fijo(0.3, 0.6)), planBlasters(W, H, false, false, fijo(0.3, 0.6)));
});

prueba('sonidos y vibración: los de la app, en orden, y sin sonido cuando no toca', () => {
  const pe = planEspada('claudio', 'cuerpo', 390, 620, false, false);
  const ev = eventosDe(pe, true);
  assert.equal(ev[0].sfx, 'saber');
  assert.equal(ev[0].t, pe.encender[0]);
  assert.ok(ev.filter((e) => e.sfx === 'whoosh').length >= 3, 'un zumbido por tajo y al apagarse');
  assert.ok(ev.every((e, i) => !i || e.t >= ev[i - 1].t));
  assert.ok(ev.every((e) => e.t < pe.dur));
  assert.ok(eventosDe(pe, false).every((e) => !e.sfx && e.vibra), 'sin sonido: solo vibra');
  const pb = planBlasters(390, 620, false, false, fijo(0.5));
  assert.equal(eventosDe(pb, true).filter((e) => e.sfx === 'blaster').length, 8);
  const sutil = eventosDe(planBlasters(142, 142, true, false, fijo(0.5)), false);
  assert.deepEqual(sutil.map((e) => e.vibra), ['ligera'], 'sutil: una vibración suave y nada más');
  for (const e of [...ev, ...eventosDe(pb, true)]) if (e.sfx) assert.ok(['saber', 'blaster', 'whoosh'].includes(e.sfx));
});

prueba('las ondas: más chicas si es sutil, otro color si está molesto', () => {
  const o = planOnda('claudio', 390, 620, 10, 20, { sutil: false, reducido: false });
  const s = planOnda('claudio', 390, 620, 10, 20, { sutil: true, reducido: false });
  const m = planOnda('antonio', 390, 620, 10, 20, { sutil: false, reducido: false, molesto: true });
  assert.ok(s.r < o.r);
  assert.notEqual(m.color, planOnda('antonio', 390, 620, 0, 0, { sutil: false, reducido: false }).color);
});

/* ── la capa no se queda con el dedo ─────────────────────────────────────────────────────── */

prueba('la capa no toma toques y no toca el video ni el guion', () => {
  // El código, sin los comentarios (que explican lo que NO hace).
  const capa = fs
    .readFileSync(path.resolve(AQUI, '../video/efectos/CapaEfectos.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.ok((capa.match(/pointerEvents="none">/g) || []).length >= 2, 'la capa y la sacudida');
  assert.match(capa, /<Canvas[^>]*pointerEvents="none"/, 'el lienzo tampoco');
  assert.doesNotMatch(capa, /onStartShouldSetResponder|onPress|Pressable|GestureDetector/);
  assert.match(capa, /agenda\.cortar\(\);/, 'al irse corta los relojes (todos van en la agenda)');
  assert.doesNotMatch(capa, /setTimeout|setInterval/, 'ningún reloj por fuera de la agenda');
  assert.doesNotMatch(capa, /expo-haptics/, 'la vibración es la de la app (respeta el ajuste «Vibración»)');
  assert.match(capa, /useEffect\(\(\) => \(\) => cortar\(\), \[cortar\]\)/, 'al desmontarse corta todo');
  assert.doesNotMatch(capa, /speak\(|Audio\.Recording|speech|micr/i, 'nada de voz ni micrófono');
  const llamada = fs.readFileSync(path.resolve(AQUI, '../../avatar3d/CuerpoLlamada.tsx'), 'utf8');
  assert.match(llamada, /onStartShouldSetResponderCapture=\{mirar\}/);
  assert.match(llamada, /return false;/, 'solo mira el toque: el doble toque que silencia sigue siendo de la cara');
  const mesa = fs.readFileSync(path.resolve(AQUI, '../../avatar3d/CuerpoMesa.tsx'), 'utf8');
  assert.match(mesa, /efectos\.current\?\.tocar\(px, py\)/);
  assert.match(mesa, /<CapaEfectos[^>]*>\s*<CuerpoVideo/, 'envuelve al video desde afuera');
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
console.log(`\n${pruebas.length - fallas}/${pruebas.length} pruebas de los toques en video`);
if (fallas) process.exit(1);
