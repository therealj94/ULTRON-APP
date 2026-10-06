/**
 * LA MESA DEL TELÉFONO NO SE QUEDA ATRÁS CON LA CÁMARA ENCENDIDA (José, 6-oct, Samsung SM-S942B: «contestó con voz» pasó
 * de ~2,6 s a ~6 s de mediana con la cámara y el reconocimiento de caras; «la cámara tarda en reconocer y se queda atrasado
 * con la voz»). Lo puro, sin teléfono:
 *
 *  · la traza de cada turno hablado (mobile/src/lib/trazaTurno.ts): de la frase lista a la voz, una miga corta que dice
 *    dónde se fue el tiempo (escena, envío, primer texto, audio, relleno, hilo de JS);
 *  · lo que hace la cámara cada minuto (mobile/src/lib/estadisticaCamara.ts) y el pulso del hilo de JS (lib/pulsoJs.ts);
 *  · el relleno («déjame ver») que todavía no sonó se tira cuando llega la respuesta (mobile/src/lib/relleno.ts): antes la
 *    respuesta esperaba a que el relleno se bajara y sonara entero;
 *  · con un turno en vuelo o AU-RA hablando, la cámara afloja: menos fotos, sin reconocer (salvo a quien llega), sin subir
 *    fotos al servidor; con todos reconocidos y la vista cerrada, también menos fotos (camaraModo, seguimiento, vistaCamara);
 *  · reconocer más rápido: un solo reconocimiento MUY seguro ya pone el nombre; lo dudoso sigue con 2 de 3 votos.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { TrazaTurno } from '../mobile/src/lib/trazaTurno';
import { EstadisticaCamara } from '../mobile/src/lib/estadisticaCamara';
import { PulsoJs } from '../mobile/src/lib/pulsoJs';
import { RellenoTurno, carreraConCorte, CORTADO } from '../mobile/src/lib/relleno';
import { LOCAL_CON_PERSONA_MS, LOCAL_DORMIDA_MS, LOCAL_IDENTIFICADA_MS, LOCAL_OCUPADA_MS, LOCAL_SIN_PERSONA_MS, ritmoFotos } from '../mobile/src/lib/camaraModo';
import { CONFIRMAR, RAPIDO, RECONOCER, Seguidor, decidirIdentidad, tocaReconocer } from '../mobile/src/caras/seguimiento';
import { intervaloServidor } from '../mobile/src/lib/vistaCamara';

/* ── la traza del turno ──────────────────────────────────────────────────────────────────── */

test('traza: la miga empieza igual que antes («contestó con voz N ms después de la frase») y suma cada tramo desde la frase', () => {
  const t = new TrazaTurno();
  t.empezar(10_000);
  t.marcar('pide', 10_004);
  t.marcar('escena', 10_352);
  t.dato('vozMs', 348);
  t.marcar('envio', 10_360);
  t.marcar('texto', 12_900);
  t.marcar('texto', 13_500); // solo cuenta el primero
  t.marcar('relleno', 12_500);
  t.marcar('rellenoSuena', 13_150);
  t.marcar('audio', 13_600);
  const l = t.linea(16_009, { jsMax: 120, camara: true, caras: true });
  assert.match(l, /^mesa: contestó con voz 6009 ms después de la frase · /);
  assert.match(l, /esc 352\/v348/);
  assert.match(l, /env 360/);
  assert.match(l, /txt 2900/);
  assert.match(l, /tts 3600/);
  assert.match(l, /rel 2500>3150/);
  assert.match(l, /js 120/);
  assert.match(l, /cám\+caras/);
  // Cabe en una miga (160 letras, con la marca de tiempo delante) y no se tapa como «número largo» al sanearla.
  assert.ok(l.length <= 140, `${l.length}: ${l}`);
  assert.doesNotMatch(l, /\d(?:[\s().-]?\d){8,}/, 'ningún tramo junta 9 cifras con espacios o guiones');
});

test('traza: un relleno que no sonó dice «tirado»; sin frase no hay traza; después de la línea se reinicia', () => {
  const t = new TrazaTurno();
  assert.equal(t.linea(5_000), null, 'sin empezar (un turno escrito) no hay nada');
  t.empezar(1_000);
  t.marcar('relleno', 3_500);
  t.marcar('rellenoTirado', 3_700);
  const l = t.linea(4_400)!;
  assert.match(l, /contestó con voz 3400 ms/);
  assert.match(l, /rel 2500 tirado/);
  assert.equal(t.linea(9_000), null, 'una vez por turno');
  t.marcar('texto', 9_100);
  assert.equal(t.linea(9_200), null, 'lo marcado sin turno no cuenta');
});

/* ── lo que hace la cámara cada minuto y el hilo de JS ───────────────────────────────────── */

test('cámara: el resumen del minuto dice fotos por segundo, lo que tardó cada paso y el reconocimiento', () => {
  const e = new EstadisticaCamara(0);
  for (let i = 0; i < 120; i++) {
    e.foto(180);
    e.mlkit(40);
  }
  e.lectura(12, 110_000);
  e.lectura(14, 90_000);
  e.analisis(650, 480);
  e.analisis(750, 520);
  e.saltada();
  e.subida();
  assert.equal(e.toca(59_000), false);
  assert.equal(e.toca(60_000), true);
  const l = e.linea(60_000, { media: 12, max: 380 })!;
  assert.match(l, /^cámara 60 s: 2\.0 f\/s · foto 180 · mlkit 40/);
  assert.match(l, /lee 13/);
  assert.match(l, /caras 2× 700 \(motor 500, 100 KB\)/);
  assert.match(l, /js 12\/380/);
  assert.match(l, /pausa 1/);
  assert.match(l, /sube 1/);
  assert.ok(l.length <= 140, l);
  // Reinicia: el minuto siguiente empieza de cero.
  assert.equal(e.toca(61_000), false);
  assert.equal(e.linea(120_000, { media: 0, max: 0 }), null, 'sin fotos en el minuto no hay línea');
});

test('pulso de JS: el atraso de un reloj de 200 ms dice cuánto se trabó el hilo (media y máximo, por ventana)', () => {
  const p = new PulsoJs(200);
  let t = 0;
  p.tic((t += 200));
  p.tic((t += 210));
  p.tic((t += 600)); // se trabó 400 ms
  p.tic((t += 200));
  const r = p.resumen(0);
  assert.equal(r.max, 400);
  assert.equal(r.n, 3, 'el primer tic solo pone la hora de partida');
  assert.equal(r.media, 137);
  assert.equal(p.maxEntre(t - 150, t), 0, 'en el último tic no se trabó');
  assert.equal(p.maxEntre(0, t), 400);
});

/* ── el relleno que no sonó no demora la respuesta ───────────────────────────────────────── */

function relojFalso() {
  let ahora = 0;
  let n = 0;
  const pend = new Map<number, { en: number; f: () => void }>();
  return {
    setTimeout: (f: () => void, ms: number) => {
      const id = ++n;
      pend.set(id, { en: ahora + ms, f });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (id: unknown) => void pend.delete(id as number),
    avanzar(ms: number) {
      ahora += ms;
      for (const [id, p] of [...pend]) if (p.en <= ahora) {
        pend.delete(id);
        p.f();
      }
    },
  };
}

test('relleno: suena solo si la respuesta tarda; el primer texto lo cancela antes de pedirlo y corta el que todavía no sonó', async () => {
  const r = relojFalso();
  const pedidos: Promise<void>[] = [];
  const rel = new RellenoTurno({ esperaMs: 2500, decir: (corte) => void pedidos.push(corte), setTimeout: r.setTimeout, clearTimeout: r.clearTimeout });
  rel.programar(false);
  r.avanzar(2000);
  rel.respuesta();
  r.avanzar(5000);
  assert.equal(pedidos.length, 0, 'la respuesta llegó antes: nunca se pide');

  const rel2 = new RellenoTurno({ esperaMs: 2500, decir: (corte) => void pedidos.push(corte), setTimeout: r.setTimeout, clearTimeout: r.clearTimeout });
  rel2.programar(false);
  r.avanzar(2600);
  assert.equal(pedidos.length, 1, 'tardó: se pide el relleno');
  let cortado = false;
  void pedidos[0].then(() => (cortado = true));
  await Promise.resolve();
  assert.equal(cortado, false);
  rel2.respuesta();
  await Promise.resolve();
  assert.equal(cortado, true, 'el primer texto de la respuesta corta el relleno que todavía no suena');
  assert.equal(rel2.pedido, true);

  const rel3 = new RellenoTurno({ esperaMs: 2500, decir: (corte) => void pedidos.push(corte), setTimeout: r.setTimeout, clearTimeout: r.clearTimeout });
  rel3.programar(true);
  assert.equal(pedidos.length, 2, 'con imagen (siempre tarda) se pide al instante');
  rel3.terminar();
  rel3.terminar();
});

test('relleno: la carrera con el corte devuelve el audio si llegó antes y CORTADO si llegó primero la respuesta', async () => {
  let soltar!: () => void;
  const corte = new Promise<void>((r) => (soltar = r));
  assert.equal(await carreraConCorte(Promise.resolve('audio'), corte), 'audio');
  const lento = new Promise<string>((r) => setTimeout(() => r('tarde'), 30));
  const p = carreraConCorte(lento, corte);
  soltar();
  assert.equal(await p, CORTADO);
  assert.equal(await carreraConCorte(Promise.resolve('sin corte'), undefined), 'sin corte');
});

/* ── la cámara afloja mientras se piensa o se habla ──────────────────────────────────────── */

test('ritmo de fotos: igual que antes en reposo; más lento con un turno en vuelo o con todos reconocidos (vista cerrada)', () => {
  const base = { dormida: false, conPersona: true, vista: false, ocupada: false, identificados: false };
  assert.equal(ritmoFotos(base), LOCAL_CON_PERSONA_MS);
  assert.equal(ritmoFotos({ ...base, conPersona: false }), LOCAL_SIN_PERSONA_MS);
  assert.equal(ritmoFotos({ ...base, dormida: true }), LOCAL_DORMIDA_MS);
  assert.equal(ritmoFotos({ ...base, ocupada: true }), LOCAL_OCUPADA_MS);
  assert.equal(ritmoFotos({ ...base, identificados: true }), LOCAL_IDENTIFICADA_MS);
  // «Lo que veo» abierto: la persona está mirando la vista, los recuadros siguen al ritmo de siempre.
  assert.equal(ritmoFotos({ ...base, vista: true, ocupada: true, identificados: true }), LOCAL_CON_PERSONA_MS);
  // Sin nadie, ocupada o no, el ritmo de sin nadie (ya es lento).
  assert.equal(ritmoFotos({ ...base, conPersona: false, ocupada: true }), LOCAL_SIN_PERSONA_MS);
  assert.ok(LOCAL_OCUPADA_MS >= 2 * LOCAL_CON_PERSONA_MS && LOCAL_OCUPADA_MS <= LOCAL_SIN_PERSONA_MS);
  assert.ok(LOCAL_IDENTIFICADA_MS > LOCAL_CON_PERSONA_MS && LOCAL_IDENTIFICADA_MS < LOCAL_OCUPADA_MS);
});

test('reconocer: con un turno en vuelo o hablando se pausa (vista cerrada); a quien LLEGA se le mira igual, enseguida', () => {
  const o = { ahora: 10_000, ultima: 0, nueva: false, porConfirmar: false, vistaAbierta: false, sinIdentificar: true, ocupado: false };
  assert.equal(tocaReconocer(o), true, 'en reposo, como antes');
  assert.equal(tocaReconocer({ ...o, mesaOcupada: true }), false, 'pensando o hablando: espera');
  assert.equal(tocaReconocer({ ...o, mesaOcupada: true, porConfirmar: true }), false);
  assert.equal(tocaReconocer({ ...o, mesaOcupada: true, nueva: true, ultima: 9_999 }), true, 'alguien llegó: prioridad');
  assert.equal(tocaReconocer({ ...o, mesaOcupada: true, vistaAbierta: true }), true, 'con la vista abierta no se pausa');
  assert.equal(tocaReconocer({ ...o, mesaOcupada: true, nueva: true, ocupado: true }), false, 'nunca dos análisis a la vez');
});

test('subir al servidor: con un turno en vuelo o hablando no se sube (ni compite con el turno); sin ML Kit, el respaldo sigue', () => {
  const o = { mlkit: true, dormida: false, conPersona: true, necesitaEscena: true, sinCambios: 0 };
  assert.ok(Number.isFinite(intervaloServidor(o)));
  assert.equal(intervaloServidor({ ...o, ocupada: true }), Infinity);
  assert.equal(intervaloServidor({ ...o, mlkit: false, ocupada: true }), 12_000, 'sin ML Kit es la única forma de saber si hay alguien');
});

/* ── reconocer más rápido sin llamar a nadie con otro nombre ─────────────────────────────── */

const voto = (id: string | null, distancia: number, ts: number, margen = 0.3) => (id ? { id, nombre: id.toUpperCase(), relacion: 'conocido' as const, distancia, margen, ts } : { id: null, distancia: 1, ts });

test('reconocer rápido: un solo reconocimiento MUY seguro ya pone el nombre; lo dudoso sigue esperando el segundo voto', () => {
  assert.ok(RAPIDO.dMax <= 0.38 && RAPIDO.margenMin >= 0.12, 'nunca más laxo que lo pedido');
  assert.equal(decidirIdentidad([voto('ana', 0.3, 1)], null, 1)?.id, 'ana', 'd 0,30 y margen 0,30: enseguida');
  assert.equal(decidirIdentidad([voto('ana', 0.42, 1)], null, 1), null, 'd 0,42: espera el segundo');
  assert.equal(decidirIdentidad([voto('ana', 0.3, 1, 0.08)], null, 1), null, 'margen chico sobre otra persona: espera');
  assert.equal(decidirIdentidad([{ id: 'ana', nombre: 'ANA', relacion: 'conocido', distancia: 0.3, ts: 1 }], null, 1), null, 'sin margen conocido: espera');
  assert.equal(decidirIdentidad([voto('jose', 0.45, 1), voto('ana', 0.3, 2)], null, 2), null, 'un voto anterior de OTRA persona: espera');
  // Con un nombre ya puesto, uno solo (por seguro que sea) no lo cambia: hacen falta 2 de 3.
  const actual = { id: 'jose', nombre: 'JOSE', relacion: 'conocido' as const, distancia: 0.3, desde: 0, ultimoVoto: 1 };
  assert.equal(decidirIdentidad([voto('jose', 0.3, 1), voto('ana', 0.25, 2)], actual, 2)?.id, 'jose');
  assert.equal(decidirIdentidad([voto('jose', 0.3, 1), voto('ana', 0.25, 2), voto('ana', 0.3, 3)], actual, 3)?.id, 'ana');
});

test('reconocer rápido en la pista: confirma con el primer voto seguro, pero aprender con el uso pide 2 votos a favor', () => {
  const s = new Seguidor();
  const [p] = s.actualizar([{ x: 0.3, y: 0.2, w: 0.2, h: 0.2 }], 1000);
  const r = { id: 'ana', nombre: 'Ana', relacion: 'conocido' as const, distancia: 0.31, margen: 0.25 };
  const v = s.votar(p.id, r, 1000);
  assert.equal(v.confirmo, true);
  assert.equal(v.identidad?.nombre, 'Ana');
  assert.equal(v.aFavor, 1, 'un solo voto: no alcanza para aprender');
  const v2 = s.votar(p.id, r, 2000);
  assert.equal(v2.confirmo, false, 'ya estaba');
  assert.equal(v2.aFavor, CONFIRMAR);
  // Dudoso: con el primer voto no hay nombre (como antes).
  const s2 = new Seguidor();
  const [q] = s2.actualizar([{ x: 0.3, y: 0.2, w: 0.2, h: 0.2 }], 1000);
  assert.equal(s2.votar(q.id, { ...r, distancia: 0.45 }, 1000).identidad, null);
  assert.equal(RECONOCER.llegadaMs, 0, 'al llegar alguien se mira en la primera foto');
});
