/**
 * Pruebas en Node de lo nuevo de la mesa (sin teléfono):
 *   · la cámara APAGADA por omisión, «solo ahora» (se apaga sola o al salir de la mesa) y «siempre»
 *     guardado por persona, y lo que se le dice por voz (lib/camaraModo.ts);
 *   · reconocer caras con permiso: comparar vectores, entender «conóceme / te presento a / olvida a»,
 *     el «sí» de la persona presentada (con plazo) y el permiso por persona (src/caras/caras.ts);
 *   · el recorrido de primera vez: solo capacidades que existen (cada paso nombra archivos reales) y
 *     «no volver a mostrar» por persona (src/tutorial/pasos.ts);
 *   · el contraste de los textos del tema (A17): cada token de texto ≥ 4,5:1 sobre cada fondo.
 *
 *   cd mobile && npx tsx pruebas/mesa/mesa.prueba.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ControlCamara, TEMPORAL_MS, conPreferencia, pedidoDeCamara, prefiereSiempre, respuestaModoCamara } from '../../src/lib/camaraModo.ts';
import {
  ESPERA_CONSENTIMIENTO_MS,
  MARGEN,
  Presentacion,
  UMBRAL,
  caraDelPresentado,
  carasActivas,
  conCarasActivas,
  distancia,
  esConsentimiento,
  frasePresentes,
  identificar,
  pedidoDeCaras,
  promediar,
  vectorValido,
} from '../../src/caras/caras.ts';
import { conTutorialVisto, pasosTutorial, tocaTutorial } from '../../src/tutorial/pasos.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '../../..');

/** Los colores del tema, leídos del código (los módulos del tema cargan React Native, que Node no tiene). */
function paleta(archivo, nombre) {
  const src = fs.readFileSync(path.join(RAIZ, 'mobile/src', archivo), 'utf8');
  const bloque = new RegExp(`export const ${nombre}\\b[^=]*=\\s*\\{([\\s\\S]*?)\\n\\}`).exec(src);
  if (!bloque) throw new Error(`no encuentro ${nombre} en ${archivo}`);
  return Object.fromEntries([...bloque[1].matchAll(/^\s*(\w+):\s*'(#[0-9A-Fa-f]{6})'/gm)].map((m) => [m[1], m[2]]));
}
const CLARO = paleta('nucleo/tema.ts', 'CLARO');
const OSCURO = paleta('nucleo/tema.ts', 'OSCURO');
const T = paleta('tema.ts', 'T');

let fallos = 0;
let n = 0;
const pruebas = [];
const prueba = (nombre, f) => pruebas.push([nombre, f]);

/* ── la cámara ───────────────────────────────────────────────────────────────────────────── */

prueba('cámara: apagada por omisión; encendida al entrar solo si ESTA persona eligió «siempre»', () => {
  const c = new ControlCamara();
  assert.equal(c.estado().modo, 'apagada', 'nace apagada');
  c.arrancar(prefiereSiempre({}, 'jose@x.com'));
  assert.equal(c.encendida(), false, 'sin preferencia: apagada');
  const mapa = conPreferencia({}, 'Jose@X.com ', true);
  assert.equal(prefiereSiempre(mapa, 'jose@x.com'), true);
  assert.equal(prefiereSiempre(mapa, 'mama@x.com'), false, 'es por persona: otra cuenta en el mismo teléfono no la hereda');
  c.arrancar(prefiereSiempre(mapa, 'jose@x.com'));
  assert.equal(c.estado().modo, 'siempre');
  // Revocable: quitarla deja a las demás intactas.
  const dos = conPreferencia(conPreferencia(mapa, 'ana@x.com', true), 'jose@x.com', false);
  assert.deepEqual(dos, { 'ana@x.com': true });
});

prueba('cámara: «solo ahora» se apaga sola a los 10 min o al salir de la mesa; «siempre» no', () => {
  let ahora = 1_000;
  const c = new ControlCamara(() => ahora);
  const avisos = [];
  c.suscribir((e) => avisos.push(e.modo));
  c.encender('temporal');
  assert.equal(c.estado().hasta, 1_000 + TEMPORAL_MS);
  ahora += TEMPORAL_MS - 1;
  assert.equal(c.tic(), false);
  assert.equal(c.encendida(), true);
  ahora += 2;
  assert.equal(c.tic(), true, 'vencida → apagada');
  assert.equal(c.encendida(), false);
  c.encender('temporal');
  assert.equal(c.alSalirDeLaMesa(), true, 'al irse a los chats se apaga');
  assert.equal(c.encendida(), false);
  c.encender('siempre');
  ahora += 10 * TEMPORAL_MS;
  assert.equal(c.tic(), false);
  assert.equal(c.alSalirDeLaMesa(), false, '«siempre» se queda (la mesa la pausa mientras no se ve)');
  assert.equal(c.estado().modo, 'siempre');
  c.apagar();
  assert.deepEqual(avisos, ['temporal', 'apagada', 'temporal', 'apagada', 'siempre', 'apagada']);
});

prueba('cámara por voz: «puedes verme / mírame» la piden; «apaga la cámara / deja de verme» la apagan', () => {
  for (const t of ['¿Puedes verme?', 'mírame', 'Enciende la cámara', 'abre la camara', 'quiero que me veas', 'can you see me', 'look at me']) assert.equal(pedidoDeCamara(t), 'encender', t);
  for (const t of ['apaga la cámara', 'deja de verme', 'ya no me veas', 'no me mires', 'turn off the camera']) assert.equal(pedidoDeCamara(t), 'apagar', t);
  assert.equal(pedidoDeCamara('no me veas nunca'), 'apagar_siempre');
  for (const t of ['¿qué ves?', 'veme el precio del oro'.replace('veme', 'dime'), 'hola', 'mira lo que dice Beto en el chat'.replace('mira', 'lee')]) assert.equal(pedidoDeCamara(t), null, t);
  assert.equal(respuestaModoCamara('solo ahora'), 'temporal');
  assert.equal(respuestaModoCamara('nada más por ahora'), 'temporal');
  assert.equal(respuestaModoCamara('siempre'), 'siempre');
  assert.equal(respuestaModoCamara('no, siempre'), 'siempre');
  assert.equal(respuestaModoCamara('no'), 'no');
  assert.equal(respuestaModoCamara('mejor no'), 'no');
  assert.equal(respuestaModoCamara('eh… lo que tú digas'), null, 'no se entendió → la mesa toma «solo ahora»');
});

/* ── reconocer caras ─────────────────────────────────────────────────────────────────────── */

/** Un vector de cara de mentira: cada semilla, una «persona» (valores al azar pero repetibles); `ruido`, otra toma. */
function vec(semilla, ruido = 0) {
  let x = semilla * 2654435761 % 4294967296;
  const azar = () => ((x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296) - 0.5;
  const base = Array.from({ length: 128 }, () => azar() * 0.3);
  let y = (semilla + 99) * 40503;
  const otro = () => ((y = (y * 1103515245 + 12345) % 2147483648) / 2147483648) - 0.5;
  return base.map((v) => Math.round((v + otro() * ruido) * 1e4) / 1e4);
}
const cara = (v, x = 0.3, w = 0.2) => ({ caja: { x, y: 0.2, w, h: w }, vector: v, puntaje: 0.9 });

prueba('caras: solo vectores de 128 números; la misma persona cerca, otra lejos; nunca el nombre de otro', () => {
  assert.equal(vectorValido(vec(1)), true);
  assert.equal(vectorValido(vec(1).slice(1)), false);
  assert.equal(vectorValido([...vec(1).slice(1), Number.NaN]), false);
  assert.equal(vectorValido('data:image/jpeg;base64,AAAA'), false, 'una foto no es un vector');
  const jose = { id: 'j', nombre: 'José', relacion: 'yo', vectores: [vec(1), vec(1, 0.004)] };
  const ana = { id: 'a', nombre: 'Ana', relacion: 'conocido', vectores: [vec(2)] };
  assert.ok(distancia(vec(1), vec(1, 0.01)) < UMBRAL);
  assert.ok(distancia(vec(1), vec(2)) > UMBRAL, `personas distintas lejos (${distancia(vec(1), vec(2)).toFixed(2)})`);
  assert.equal(identificar(vec(1, 0.01), [jose, ana])?.nombre, 'José');
  assert.equal(identificar(vec(2, 0.01), [jose, ana])?.nombre, 'Ana');
  assert.equal(identificar(vec(7), [jose, ana]), null, 'un desconocido no es nadie');
  // Dos personas guardadas casi iguales: dudar antes que confundir.
  const gemela = { id: 'g', nombre: 'Gemela', relacion: 'conocido', vectores: [vec(2, 0.001)] };
  assert.equal(identificar(vec(2), [ana, gemela]), null, `margen ${MARGEN}: si dos quedan parejas, no dice ninguna`);
  assert.equal(promediar([vec(1), vec(1)]).length, 128);
});

prueba('caras: la persona presentada es la cara que NO es la dueña (sola la dueña → nadie)', () => {
  const jose = { id: 'j', nombre: 'José', relacion: 'yo', vectores: [vec(1)] };
  const elegida = caraDelPresentado([cara(vec(1), 0.1, 0.4), cara(vec(3), 0.6, 0.2)], [jose]);
  assert.deepEqual(elegida.vector, vec(3), 'aunque la dueña salga más grande');
  assert.equal(caraDelPresentado([cara(vec(1))], [jose]), null, 'no se guarda a la dueña con otro nombre');
  assert.equal(caraDelPresentado([], [jose]), null);
  assert.ok(caraDelPresentado([cara(vec(3))], []), 'sin la dueña guardada, la cara que haya');
});

prueba('caras por voz: conóceme, te presento a…, olvida a…, ¿a quién conoces?, ¿quién soy?', () => {
  assert.deepEqual(pedidoDeCaras('Conóceme'), { tipo: 'conoceme' });
  assert.deepEqual(pedidoDeCaras('aprende mi cara'), { tipo: 'conoceme' });
  assert.deepEqual(pedidoDeCaras('Te presento a Ana'), { tipo: 'presentar', nombre: 'Ana' });
  assert.deepEqual(pedidoDeCaras('te presento a mi amigo Juan Pérez'), { tipo: 'presentar', nombre: 'Juan Pérez' });
  assert.deepEqual(pedidoDeCaras('Ella es María'), { tipo: 'presentar', nombre: 'María' });
  assert.equal(pedidoDeCaras('este es un buen día'), null, '«este es…» sin nombre no es presentar');
  assert.deepEqual(pedidoDeCaras('olvida a Ana'), { tipo: 'olvidar', nombre: 'Ana' });
  assert.deepEqual(pedidoDeCaras('Olvida la cara de Juan'), { tipo: 'olvidar', nombre: 'Juan' });
  assert.deepEqual(pedidoDeCaras('olvida mi cara'), { tipo: 'olvidar_mia' });
  assert.deepEqual(pedidoDeCaras('olvida todas las caras'), { tipo: 'olvidar_todas' });
  assert.deepEqual(pedidoDeCaras('¿A quién conoces?'), { tipo: 'lista' });
  assert.deepEqual(pedidoDeCaras('¿Quién soy?'), { tipo: 'quien' });
  assert.equal(pedidoDeCaras('olvida lo que te dije'), null, 'la memoria no es una cara');
  assert.equal(pedidoDeCaras('¿qué hora es?'), null);
});

prueba('caras: la presentada tiene que decir «sí» dentro del plazo; un «no», otra cosa o tarde → no se guarda', () => {
  let ahora = 0;
  const p = new Presentacion(() => ahora);
  p.empezar('Ana');
  assert.equal(p.pendiente(), 'Ana');
  for (const t of ['Sí', 'sí, claro', 'claro que sí', 'dale', 'puedes recordarme', 'yes']) assert.equal(esConsentimiento(t), 'si', t);
  for (const t of ['no', 'No, gracias', 'mejor no', 'no me recuerdes']) assert.equal(esConsentimiento(t), 'no', t);
  assert.equal(esConsentimiento('¿qué es eso?'), null, 'ni sí ni no → no se guarda');
  ahora = ESPERA_CONSENTIMIENTO_MS + 1;
  assert.equal(p.pendiente(), null, 'pasado el plazo, un «sí» ya no vale');
  p.empezar('Beto');
  p.terminar();
  assert.equal(p.pendiente(), null);
});

prueba('caras: el permiso es por persona y revocable; al cerebro solo le llega «Reconozco a …»', () => {
  const m = conCarasActivas({}, 'Jose@x.com', true, 5);
  assert.equal(carasActivas(m, 'jose@x.com'), true);
  assert.equal(carasActivas(m, 'mama@x.com'), false, 'otra cuenta en el mismo teléfono: apagado');
  assert.deepEqual(conCarasActivas(m, 'jose@x.com', false), {});
  assert.equal(frasePresentes([{ id: 'j', nombre: 'José', relacion: 'yo', distancia: 0.2 }, { id: 'a', nombre: 'Ana', relacion: 'conocido', distancia: 0.3 }], 1), 'Reconozco a José (quien te habla), Ana; 1 persona(s) que no conozco');
  assert.equal(frasePresentes([], 0), '');
});

/* ── el recorrido ────────────────────────────────────────────────────────────────────────── */

prueba('hoja «Más» (José, Samsung Android 16: tarjetas apiladas como baraja): alturas por contenido, sin base 0, con desplazamiento', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'mobile/src/components/HojaMas.tsx'), 'utf8');
  const estilo = (nombre) => {
    const m = new RegExp(`\\n    ${nombre}: \\{([\\s\\S]*?)\\n?    ?\\},?\\n`).exec(src.slice(src.indexOf('function estilos')));
    assert.ok(m, `falta el estilo ${nombre}`);
    return m[1];
  };
  // `flex: 1` es base 0 en Yoga: con la altura por contenido, la celda medía solo su relleno (8 dp) y
  // cada tarjeta se desbordaba sobre la siguiente. Se reprodujo con Yoga (el motor de Android).
  for (const n of ['celda', 'caja', 'mosaico']) assert.doesNotMatch(estilo(n), /(^|[\s{,])flex:\s*1\b/, `${n} sin flex: 1`);
  assert.match(estilo('mosaico'), /minHeight:\s*76/, 'la tarjeta mide por contenido, al menos 76 dp');
  assert.match(estilo('desplazable'), /flexShrink:\s*1/, 'la rejilla se encoge para caber en la hoja…');
  assert.match(src, /<ScrollView[^>]*style=\{st\.desplazable\}[^>]*contentContainerStyle=\{st\.rejilla\}/, '…dentro de un ScrollView (lo que no cabe se desplaza)');
  assert.match(src, /<Text style=\{st\.titulo\}>\{m\.titulo\}<\/Text>/, 'el título no se corta (numberOfLines solo en el subtítulo)');
  assert.match(src, /width:\s*ancho\s*\}/, 'cada celda es una fracción del ancho real de la rejilla');
});

prueba('recorrido: cada paso nombra de dónde sale y esos archivos EXISTEN (nada inventado)', () => {
  const pasos = pasosTutorial('Claudio');
  assert.ok(pasos.length >= 6 && pasos.length <= 9, 'corto');
  const ids = pasos.map((p) => p.id);
  for (const id of ['hablar', 'envivo', 'chat', 'manos', 'recordatorios', 'internet', 'camara', 'avatar']) assert.ok(ids.includes(id), `enseña «${id}»`);
  for (const p of pasos) {
    assert.ok(p.titulo && p.texto.length > 20, p.id);
    const rutas = [...p.fuente.matchAll(/((?:src|lib|server|screens|components|compa|pulse|avatares|caras|tutorial)\/[\w./-]+|\blib\/[\w.-]+)/g)].map((m) => m[1]);
    assert.ok(rutas.length, `${p.id}: nombra su fuente`);
    for (const r of rutas) {
      const limpio = r.replace(/\/\*$/, '').replace(/\.$/, '');
      const candidatos = [path.join(RAIZ, limpio), path.join(RAIZ, 'mobile', limpio), path.join(RAIZ, 'mobile/src', limpio), path.join(RAIZ, 'mobile/src', `${limpio}.ts`), path.join(RAIZ, 'mobile/src', `${limpio}.tsx`), path.join(RAIZ, `${limpio}.ts`)];
      assert.ok(candidatos.some((c) => fs.existsSync(c)), `${p.id}: «${limpio}» existe`);
    }
  }
  assert.match(pasos.find((p) => p.id === 'camara').texto, /números, no fotos/);
});

prueba('recorrido: una vez por persona; «no volver a mostrar» no se lo quita a otra cuenta', () => {
  assert.equal(tocaTutorial({}, 'jose@x.com'), true);
  const v = conTutorialVisto({}, 'Jose@x.com');
  assert.equal(tocaTutorial(v, 'jose@x.com'), false);
  assert.equal(tocaTutorial(v, 'mama@x.com'), true);
  assert.equal(tocaTutorial(v, ''), false, 'sin persona, nada');
});

/* ── contraste (A17) ─────────────────────────────────────────────────────────────────────── */

function luminancia(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contraste = (a, b) => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

prueba('contraste: texto, texto2 y texto3 ≥ 4,5:1 sobre cada fondo, en claro y en oscuro (y en la mesa)', () => {
  const filas = [];
  for (const [nombre, p] of [['claro', CLARO], ['oscuro', OSCURO]])
    for (const tok of ['texto', 'texto2', 'texto3'])
      for (const fondo of ['fondo', 'fondo2', 'superficie', 'superficie2']) filas.push([`${nombre}.${tok}/${fondo}`, contraste(p[tok], p[fondo])]);
  for (const tok of ['texto', 'texto2', 'texto3']) for (const fondo of ['fondo', 'fondo2', 'panel', 'panel2']) filas.push([`mesa.${tok}/${fondo}`, contraste(T[tok], T[fondo])]);
  const malas = filas.filter(([, c]) => c < 4.5).map(([k, c]) => `${k} ${c.toFixed(2)}`);
  assert.deepEqual(malas, []);
  const peor = filas.reduce((m, f) => (f[1] < m[1] ? f : m));
  console.log(`      (${filas.length} combinaciones; la más baja: ${peor[0]} ${peor[1].toFixed(2)}:1)`);
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
