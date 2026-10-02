/**
 * Pruebas en Node del recorrido (sin teléfono): el guion (solo los dos anfitriones, cada paso pedido
 * existe en su escena, las esperas tienen indicación, el nombre se pone bien), el motor (avanza al
 * terminar cada línea, espera el toque, sigue solo si nadie toca, un aviso viejo no mueve nada,
 * siguiente / atrás / pausa) y que cada escena tiene su animación.
 *
 *   cd mobile && npx tsx src/recorrido/pruebas/recorrido.prueba.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMOS, ESCENAS, OPCIONES_FINAL, PRUEBAS, duracionLectura, pasoEn, siguientes, textoDe } from '../guion.ts';
import { INICIO, lineaDe, progreso, reducir } from '../motor.ts';
import { COREOGRAFIA, EFECTOS, SONIDOS, achicadoEn, momentoDe } from '../coreografia.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const pruebas = [];
const prueba = (nombre, f) => pruebas.push([nombre, f]);

prueba('solo hablan Claudio y ANT-ONIO, y se turnan', () => {
  for (const e of ESCENAS) for (const l of e.lineas) assert.ok(l.quien === 'claudio' || l.quien === 'antonio', `${e.id}: ${l.quien}`);
  const quienes = ESCENAS.flatMap((e) => e.lineas.map((l) => l.quien));
  assert.ok(quienes.filter((q) => q === 'claudio').length >= 15 && quienes.filter((q) => q === 'antonio').length >= 15, 'los dos hablan bastante');
  let seguidas = 1;
  for (let i = 1; i < quienes.length; i++) {
    seguidas = quienes[i] === quienes[i - 1] ? seguidas + 1 : 1;
    assert.ok(seguidas <= 2, `nadie dice más de dos líneas seguidas (línea ${i})`);
  }
});

prueba('todas las escenas, en orden, con su animación y sus pasos', () => {
  assert.deepEqual(ESCENAS.map((e) => e.id), [...DEMOS]);
  for (const e of ESCENAS) {
    assert.ok(e.lineas.length >= 2, `${e.id} tiene conversación`);
    assert.ok(e.fuente.length > 10, `${e.id} dice de dónde sale`);
    for (const l of e.lineas) if (l.paso) assert.ok(e.pasos.includes(l.paso), `${e.id}: el paso «${l.paso}» no está en su lista`);
    for (const p of e.pasos) assert.ok(e.lineas.some((l) => l.paso === p), `${e.id}: nadie pide el paso «${p}»`);
    assert.equal(e.lineas[0].paso, e.pasos[0], `${e.id} empieza en su primer paso`);
    assert.ok(fs.existsSync(path.join(AQUI, '..', 'escenas', `${e.id[0].toUpperCase()}${e.id.slice(1)}.tsx`)), `falta escenas/${e.id}.tsx`);
  }
});

prueba('cada escena nombra de dónde sale su función y esos archivos EXISTEN (nada inventado)', () => {
  const RAIZ = path.resolve(AQUI, '../../../..');
  for (const e of ESCENAS) {
    const rutas = [...e.fuente.matchAll(/((?:src|lib|server|screens|components|compa|pulse|avatares|caras|avatar3d|ajustes|scripts|recorrido|tutorial)\/[\w./-]+)/g)].map((m) => m[1]);
    assert.ok(rutas.length || /DeskScreen/.test(e.fuente), `${e.id}: nombra su fuente`);
    for (const r of rutas) {
      const limpio = r.replace(/\/\*$/, '').replace(/[.,]$/, '');
      const candidatos = [limpio, `mobile/${limpio}`, `mobile/src/${limpio}`, `mobile/src/${limpio}.ts`, `mobile/src/${limpio}.tsx`, `${limpio}.ts`].map((c) => path.join(RAIZ, c));
      assert.ok(candidatos.some((c) => fs.existsSync(c)), `${e.id}: «${limpio}» no existe`);
    }
  }
});

prueba('los dos idiomas, frases cortas y esperas con indicación', () => {
  for (const e of ESCENAS) {
    assert.ok(e.titulo.es && e.titulo.en);
    for (const l of e.lineas) {
      assert.ok(l.texto.es && l.texto.en, `${e.id}: falta un idioma`);
      assert.ok(l.texto.es.length <= 190, `${e.id}: «${l.texto.es.slice(0, 40)}…» es muy larga para decirse de una vez`);
      if (l.espera) assert.ok(l.espera.etiqueta.es && l.espera.etiqueta.en && l.espera.ms >= 0);
    }
  }
  const conToque = ESCENAS.filter((e) => e.lineas.some((l) => l.espera)).map((e) => e.id);
  assert.deepEqual(conToque, ['camara', 'llamada', 'chat', 'final'], 'se toca: la foto, contestar, «sí, envíalo» y qué probar');
  const ultima = ESCENAS.at(-1).lineas.at(-1);
  assert.equal(ultima.espera.ms, 0, 'la última espera a que elija (no se cierra sola)');
});

prueba('el nombre: el primero, y sin nombre la frase queda limpia', () => {
  const l = ESCENAS[0].lineas[0];
  assert.equal(textoDe(l, 'es', 'José Enamorado'), '¡Hola, José! Soy Claudio, y hoy te voy a enseñar todo lo que puede hacer AU-RA.');
  assert.equal(textoDe(l, 'es', ''), '¡Hola! Soy Claudio, y hoy te voy a enseñar todo lo que puede hacer AU-RA.');
  assert.equal(textoDe(ESCENAS.at(-1).lineas.at(-1), 'en', ''), 'Now it’s your turn. What do you want to try first?');
  for (const e of ESCENAS) for (const l of e.lineas) for (const i of ['es', 'en']) assert.ok(!textoDe(l, i, 'Ana').includes('{'), 'no queda ninguna llave');
});

prueba('el paso de la animación sigue a las líneas', () => {
  const cam = ESCENAS.find((e) => e.id === 'camara');
  assert.deepEqual([0, 1, 2, 3, 4].map((l) => pasoEn(cam, l)), ['abre', 'abre', 'flash', 'analiza', 'resultado']);
});

prueba('el motor: habla, espera el toque, y sigue solo si nadie toca', () => {
  let s = INICIO;
  const v0 = s.vuelta;
  s = reducir(s, { tipo: 'termino', vuelta: s.vuelta });
  assert.deepEqual([s.e, s.l, s.fase], [0, 1, 'habla']);
  assert.ok(s.vuelta > v0, 'la línea nueva tiene su vuelta');
  assert.equal(reducir(s, { tipo: 'termino', vuelta: v0 }), s, 'un «terminó» viejo no hace nada');
  // A la cámara: la línea 1 espera el toque.
  s = reducir(s, { tipo: 'ir', e: 2 });
  s = reducir(s, { tipo: 'termino', vuelta: s.vuelta });
  assert.deepEqual([s.e, s.l, s.fase], [2, 1, 'habla']);
  s = reducir(s, { tipo: 'termino', vuelta: s.vuelta });
  assert.equal(s.fase, 'espera', 'terminó de hablar: espera la foto');
  const tocado = reducir(s, { tipo: 'toque' });
  assert.deepEqual([tocado.l, tocado.fase, tocado.tocado], [2, 'habla', true], 'tocó: flash');
  const solo = reducir(s, { tipo: 'esperaVencio', vuelta: s.vuelta });
  assert.deepEqual([solo.l, solo.tocado], [2, false], 'nadie tocó: sigue sola');
  assert.equal(reducir(tocado, { tipo: 'toque' }), tocado, 'tocar donde no se espera nada no hace nada');
});

prueba('tocar mientras todavía habla adelanta la espera', () => {
  let s = reducir(INICIO, { tipo: 'ir', e: 2 });
  s = reducir(s, { tipo: 'termino', vuelta: s.vuelta });
  assert.equal(s.fase, 'habla');
  assert.equal(reducir(s, { tipo: 'toque' }).l, 2);
});

prueba('siguiente, atrás, pausa y el final', () => {
  let s = reducir(INICIO, { tipo: 'siguiente' });
  assert.deepEqual([s.e, s.l], [1, 0]);
  s = reducir(s, { tipo: 'termino', vuelta: s.vuelta });
  s = reducir(s, { tipo: 'anterior' });
  assert.deepEqual([s.e, s.l], [1, 0], 'a mitad de escena, atrás vuelve a su principio');
  s = reducir(s, { tipo: 'anterior' });
  assert.deepEqual([s.e, s.l], [0, 0], 'al principio, a la escena de antes');
  const p = reducir(s, { tipo: 'pausa' });
  assert.ok(p.pausado);
  assert.equal(reducir(p, { tipo: 'termino', vuelta: p.vuelta }), p, 'en pausa no avanza');
  const r = reducir(p, { tipo: 'sigue' });
  assert.ok(!r.pausado && r.vuelta > p.vuelta, 'al seguir, la línea empieza otra vez');
  // Al final: la última línea espera sin límite.
  let f = reducir(INICIO, { tipo: 'ir', e: ESCENAS.length - 1 });
  f = reducir(f, { tipo: 'termino', vuelta: f.vuelta });
  f = reducir(f, { tipo: 'termino', vuelta: f.vuelta });
  assert.equal(f.fase, 'espera');
  assert.equal(reducir(f, { tipo: 'esperaVencio', vuelta: f.vuelta }), f, 'no se cierra sola');
  assert.equal(reducir(f, { tipo: 'toque' }).fase, 'fin', 'eligió: termina');
  assert.equal(progreso(reducir(f, { tipo: 'toque' })), 1);
  assert.equal(reducir(reducir(f, { tipo: 'siguiente' }), { tipo: 'siguiente' }).fase, 'fin');
});

prueba('recorrerlo entero sin tocar nada llega a elegir', () => {
  let s = INICIO;
  for (let i = 0; i < 200 && !(s.fase === 'espera' && lineaDe(s).espera.ms === 0); i++) {
    s = s.fase === 'espera' ? reducir(s, { tipo: 'esperaVencio', vuelta: s.vuelta }) : reducir(s, { tipo: 'termino', vuelta: s.vuelta });
  }
  assert.deepEqual([s.e, s.fase], [ESCENAS.length - 1, 'espera']);
  const total = ESCENAS.reduce((n, e) => n + e.lineas.reduce((m, l) => m + duracionLectura(l.texto.es) + (l.espera?.ms || 0), 0), 0);
  assert.ok(total > 150_000 && total < 330_000, `dura entre 2½ y 5½ minutos sin voz (${Math.round(total / 1000)} s)`);
});

prueba('preparar lo que sigue cruza de escena', () => {
  const ultima = ESCENAS[0].lineas.length - 1;
  assert.deepEqual(siguientes(0, ultima, 2), [{ e: 1, l: 0 }, { e: 1, l: 1 }]);
  assert.deepEqual(siguientes(ESCENAS.length - 1, ESCENAS.at(-1).lineas.length - 1), []);
});

prueba('lo que se prueba al final existe en la mesa', () => {
  assert.deepEqual(OPCIONES_FINAL.map((o) => o.id), [...PRUEBAS]);
  const mesa = fs.readFileSync(path.join(AQUI, '../../screens/DeskScreen.tsx'), 'utf8');
  for (const id of PRUEBAS) assert.ok(new RegExp(`case '${id}'`).test(mesa), `DeskScreen no atiende «${id}»`);
});

prueba('la coreografía: cada paso de cada escena tiene su momento, y lo que pide existe', () => {
  for (const e of ESCENAS) {
    assert.ok(COREOGRAFIA[e.id], `${e.id} sin coreografía`);
    for (const p of e.pasos) assert.ok(COREOGRAFIA[e.id][p], `${e.id}/${p} sin momento`);
    for (const p of Object.keys(COREOGRAFIA[e.id])) assert.ok(e.pasos.includes(p), `${e.id}: la coreografía nombra un paso que no existe («${p}»)`);
  }
  const efectos = fs.readFileSync(path.join(AQUI, '../escenas/efectos.tsx'), 'utf8');
  for (const ef of EFECTOS) assert.ok(efectos.includes(`case '${ef}':`), `efectos.tsx no dibuja «${ef}»`);
  const sonidos = fs.readFileSync(path.join(AQUI, '../sonidos.ts'), 'utf8');
  for (const so of SONIDOS) {
    if (so === 'whoosh' || so === 'tap') continue;
    const m = sonidos.match(new RegExp(`${so}: \\{ src: require\\('([^']+)'\\)`));
    assert.ok(m, `sonidos.ts no carga «${so}»`);
    assert.ok(fs.existsSync(path.join(AQUI, '..', m[1])), `falta el archivo de «${so}»: ${m[1]}`);
  }
  // Los momentos clave que pidió José: la foto con flash y obturador, la llamada con timbre.
  assert.deepEqual(momentoDe('camara', 'flash'), { efecto: 'flash', sonido: 'obturador', vibra: 'fuerte' });
  assert.equal(momentoDe('llamada', 'suena').sonido, 'timbre');
  assert.equal(momentoDe('nada', 'x').efecto, null);
});

prueba('el recordatorio: Claudio lo dice y es él quien se achica y vuela a la franja', () => {
  const rec = ESCENAS.find((e) => e.id === 'recordatorio');
  const achica = rec.lineas.find((l) => l.paso === 'achica');
  assert.equal(achica.quien, 'claudio');
  assert.match(achica.texto.es, /yo me hago chiquito/);
  assert.equal(achicadoEn('recordatorio', 'achica'), 'claudio');
  assert.equal(achicadoEn('recordatorio', 'suena'), 'claudio', 'sigue chiquito mientras suena la llamada');
  assert.equal(achicadoEn('recordatorio', 'pide'), null);
  assert.equal(achicadoEn('chat', 'lee'), null, 'al salir del recordatorio vuelve');
  const escena = fs.readFileSync(path.join(AQUI, '../escenas/Recordatorio.tsx'), 'utf8');
  assert.match(escena, /marcarLugar\?\.\('franja'/, 'la escena marca dónde aterriza');
});

prueba('cada vez que se abre empieza de cero (cerrado no se queda montado con el estado viejo)', () => {
  const app = fs.readFileSync(path.join(AQUI, '../RecorridoApp.tsx'), 'utf8');
  assert.match(app, /if \(!visible\) return null;/);
  // Y abierto de nuevo, el motor arranca en la bienvenida aunque la vez anterior terminara.
  let s = reducir(INICIO, { tipo: 'ir', e: ESCENAS.length - 1 });
  s = reducir(reducir(s, { tipo: 'siguiente' }), { tipo: 'siguiente' });
  assert.equal(s.fase, 'fin');
  assert.deepEqual([INICIO.e, INICIO.l, INICIO.fase], [0, 0, 'habla']);
});

let ok = 0;
for (const [nombre, f] of pruebas) {
  try {
    f();
    ok++;
    console.log(`ok - ${nombre}`);
  } catch (e) {
    console.log(`FALLA - ${nombre}\n  ${e.message}`);
  }
}
console.log(`\n${ok}/${pruebas.length} pruebas del recorrido`);
if (ok !== pruebas.length) process.exit(1);
