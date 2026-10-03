/**
 * Pruebas en Node de lo nuevo de la mesa (sin teléfono):
 *   · la cámara APAGADA por omisión, «solo ahora» (se apaga sola o al salir de la mesa) y «siempre»
 *     guardado por persona, y lo que se le dice por voz (lib/camaraModo.ts);
 *   · reconocer caras con permiso: comparar vectores, entender «conóceme / te presento a / olvida a»,
 *     el «sí» de la persona presentada (con plazo) y el permiso por persona (src/caras/caras.ts);
 *   · el recorrido de primera vez: solo capacidades que existen (cada paso nombra archivos reales) y
 *     «no volver a mostrar» por persona (src/tutorial/pasos.ts; el recorrido en sí: src/recorrido);
 *   · el contraste de los textos del tema (A17): cada token de texto ≥ 4,5:1 sobre cada fondo;
 *   · costuras leídas del código: «olvidar» también en el servidor, el puntito del Chat, salir con
 *     confirmación y la red de seguridad de cada pantalla (app/LimitePantalla.tsx).
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
import { conTutorialVisto, tocaTutorial } from '../../src/tutorial/pasos.ts';

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

prueba('hoja «Más» (José, Samsung Android 16: tarjetas apiladas como baraja): alturas por contenido, sin base 0, y la hoja se desplaza', () => {
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
  // Lo que no cabe se desplaza: ahora lo hace la hoja entera (ui/Hoja lleva su ScrollView, 2-oct, «no
  // puedo bajar» en los correos) y la rejilla va plana, sin otro desplazable adentro.
  const hoja = fs.readFileSync(path.join(RAIZ, 'mobile/src/ui/Hoja.tsx'), 'utf8');
  assert.match(hoja, /<ScrollView[\s\S]*?\{children\}[\s\S]*?<\/ScrollView>/, 'la hoja desplaza su contenido');
  assert.match(hoja, /contenido: \{ flexGrow: 0, flexShrink: 1 \}/, 'y se encoge para caber en la pantalla');
  assert.doesNotMatch(src, /<ScrollView/, 'sin un desplazable dentro de otro');
  assert.match(src, /<View style=\{\[st\.desplazable, st\.rejilla\]\}>/);
  assert.match(src, /<Text style=\{st\.titulo\}>\{m\.titulo\}<\/Text>/, 'el título no se corta (numberOfLines solo en el subtítulo)');
  assert.match(src, /width:\s*ancho\s*\}/, 'cada celda es una fracción del ancho real de la rejilla');
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

prueba('contraste (UI01, 3-oct): la letra sobre el oro (botón, burbuja mía, etiquetas) ≥ 4,5:1 en claro y en oscuro', () => {
  // Antes, en claro: blanco sobre #B8913F = 2,93:1. Ahora la letra sobre el oro es la tinta del tema.
  const filas = [];
  for (const [nombre, p] of [['claro', CLARO], ['oscuro', OSCURO]]) {
    filas.push([`${nombre}.sobreAcento/acento`, contraste(p.sobreAcento, p.acento)]);
    filas.push([`${nombre}.textoMia/burbujaMia`, contraste(p.textoMia, p.burbujaMia)]);
  }
  // El botón principal es un degradado de oro (ui/Boton.tsx, oroDe): la letra se lee en cada parada.
  const boton = fs.readFileSync(path.join(RAIZ, 'mobile/src/ui/Boton.tsx'), 'utf8');
  const oro = /return oscuro \? \[([^\]]+)\] : \[([^\]]+)\];/.exec(boton);
  assert.ok(oro, 'oroDe sigue en ui/Boton.tsx');
  const paradas = (s) => [...s.matchAll(/'(#[0-9A-Fa-f]{6})'/g)].map((m) => m[1]);
  for (const c of paradas(oro[1])) filas.push([`oscuro.sobreAcento/oro ${c}`, contraste(OSCURO.sobreAcento, c)]);
  for (const c of paradas(oro[2])) filas.push([`claro.sobreAcento/oro ${c}`, contraste(CLARO.sobreAcento, c)]);
  const malas = filas.filter(([, c]) => c < 4.5).map(([k, c]) => `${k} ${c.toFixed(2)}`);
  assert.deepEqual(malas, []);
  // Y nadie pinta blanco a mano encima del acento (lo que se arregla en el token no se rompe en una pantalla).
  const sospechosas = [];
  const recorrer = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'pruebas' && e.name !== 'node_modules') recorrer(f);
      } else if (/\.tsx$/.test(e.name)) {
        const src = fs.readFileSync(f, 'utf8');
        for (const linea of src.split('\n')) {
          if (/backgroundColor: (tema|t|P|p)\.(acento|burbujaMia)\b/.test(linea) && /color: '#(fff|FFF|ffffff|FFFFFF)'/.test(linea)) sospechosas.push(path.relative(RAIZ, f));
        }
      }
    }
  };
  recorrer(path.join(RAIZ, 'mobile/src'));
  assert.deepEqual(sospechosas, []);
});

/* ── costuras de la mesa (leídas del código: estos módulos cargan React Native) ───────────── */

const fuente = (archivo) => fs.readFileSync(path.join(RAIZ, 'mobile/src', archivo), 'utf8');

prueba('mesa: «olvidar» borra también en el servidor; el puntito del Chat llega a la barra; salir pregunta', () => {
  const desk = fuente('screens/DeskScreen.tsx');
  const olvido = /const confirmarOlvido = useCallback\(([\s\S]*?)\n  \}, \[/.exec(desk)?.[1] || '';
  assert.match(olvido, /clearLongMemory\(user\)/, 'borra la copia del teléfono');
  assert.match(olvido, /olvidarMemoriaServidor\(/, 'y pide al servidor que olvide');
  assert.match(olvido, /no pude borrar la copia del servidor/, 'si el servidor no confirmó, lo dice');
  assert.match(fuente('lib/api.ts'), /olvidar: true/, 'POST /api/memoria {olvidar:true}');
  assert.match(desk, /<BarraMesa[\s\S]*?chatSinLeer=\{chatSinLeer\}/, 'la mesa le pasa el puntito a la barra');
  const chats = fuente('pulse/chats.ts');
  const sinLeer = /export function useSinLeerTotal[\s\S]*?\n\}/.exec(chats)?.[0] || '';
  const ms = Number(/sondear\(refrescarLista, \(\) => ([\d_]+)\)/.exec(sinLeer)?.[1].replace(/_/g, ''));
  assert.ok(ms >= 30_000, `el sondeo del puntito es tranquilo (≥ 30 s; es ${ms} ms)`);
  // «Cerrar sesión» se mudó a Ajustes (José, 2-oct): ahí pregunta antes con su hoja; el menú ya no saca a nadie.
  const menu = fuente('components/DeskMenu.tsx');
  assert.doesNotMatch(menu, /onLogout/, 'el menú de la mesa ya no cierra la sesión');
  const ajustes = fuente('ajustes/Ajustes.tsx');
  assert.match(ajustes, /<Fila titulo=\{tr\('Cerrar sesión', 'Sign out'\)\}[^\n]*onPress=\{\(\) => abrir\('salir'\)\}/, 'en Ajustes, «Cerrar sesión» abre la pregunta');
  assert.match(ajustes, /<Hoja visible=\{hoja === 'salir'\}[\s\S]*?salirDeLaSesion\(\)/, 'y solo su botón saca');
});

prueba('menú de la mesa (José, 2-oct, captura): corto, ancho en vertical, nada cortado; los ajustes viven en Ajustes', async () => {
  const menu = fuente('components/DeskMenu.tsx');
  // Antes: Math.min(460, width * 0.64) → ~250 dp en un teléfono, con «Olvidar» fuera de la pantalla.
  assert.doesNotMatch(menu, /width \* 0\.64\)/);
  const ancho = /export function anchoPanel\(ancho: number\): number \{\s*return ([^;]+);/.exec(menu)?.[1];
  assert.ok(ancho, 'el ancho del panel sale de anchoPanel');
  const anchoPanel = new Function('ancho', `return ${ancho};`);
  assert.equal(anchoPanel(392), 360, 'vertical (392 dp): casi todo el ancho');
  assert.equal(anchoPanel(360), 328);
  assert.equal(anchoPanel(850), 440, 'acostado: una columna cómoda, no media pantalla');
  assert.ok(anchoPanel(320) <= 320 - 32, 'nunca más ancho que la pantalla');
  assert.match(menu, /textos: \{ flex: 1, minWidth: 0 \}/, 'el texto de cada fila se parte en renglones en vez de empujar el botón fuera');
  assert.doesNotMatch(menu, /maxWidth: 300/);
  assert.match(menu, /paddingBottom: ins\.bottom \+ 28, paddingRight: ins\.right \+ 20/, 'respeta la barra de gestos y la muesca acostado');
  assert.match(menu, /emitir\('accion', \{ tipo: 'abrir', pantalla: 'ajustes' \}\)/, '«Ajustes» abre la pantalla completa');
  // Lo que se fue del menú… sin perder nada: cada opción está en Ajustes con la misma acción de la mesa.
  for (const fuera of ['onSetSttEngine', 'onToggleProactive', 'onToggleSfx', 'onForget', 'memoryCount', 'onSetCara', 'onSetPostura']) assert.doesNotMatch(menu, new RegExp(fuera), `${fuera} ya no está en el menú`);
  const ajustes = fuente('ajustes/Ajustes.tsx');
  for (const [que, re] of [
    ['la voz', /tr\('Voz', 'Voice'\)/],
    ['el oído (teléfono o nube)', /acciones\.fijarOido\(e\)/],
    ['comenta lo que ve', /acciones\.alternarComentarios\(\)/],
    ['los efectos de sonido', /acciones\.alternarEfectos\(\)/],
    ['la memoria y olvidar', /onPress=\{acciones\.olvidar\}/],
    ['su cara', /onCambiar=\{acciones\.fijarCara\}/],
    ['el orbe (José, 2-oct) o los anillos', /\{ id: 'orbe', texto: tr\('Orbe', 'Orb'\) \}/],
    ['lo que sé de ti', /abrir\('conocer'\)/],
  ]) assert.match(ajustes, re, `Ajustes tiene ${que}`);
  const desk = fuente('screens/DeskScreen.tsx');
  // La cara de AURA es el orbe; si la WebView no puede, los anillos (y si tampoco, la clásica): nunca vacía.
  assert.match(desk, /<OrbeAura[\s\S]*?sonidos=\{settings\.sfx\}[\s\S]*?onFallo=\{onFalloOrbe\}/, 'el orbe con sus sonidos según Ajustes');
  assert.match(desk, /cara === 'orbe' && conOrbe \? 'orbe' : anillosOClasica/, 'si el orbe falla, los anillos');
  assert.doesNotMatch(desk, /SalaAura/, 'la habitación 3D ya no está en el teléfono');
  assert.match(desk, /publicarMesa\([\s\S]*?fijarOido: \(e\) => void changeStt\(e\)[\s\S]*?olvidar: confirmarOlvido/, 'la mesa le presta a Ajustes sus mismas acciones');
  assert.match(desk, /case 'ajustes':\s*\/\/[^\n]*\n\s*return emitir\('accion', \{ tipo: 'abrir', pantalla: 'ajustes' \}\)/, '«Más → Ajustes» abre la pantalla de Ajustes');
  // El puente entre la mesa y Ajustes: solo avisa si cambió algo; las acciones siempre las últimas.
  const { publicarMesa, retirarMesa, mesaAjustes, suscribirMesa } = await import('../../src/app/mesaAjustes.ts');
  let avisos = 0;
  const quitar = suscribirMesa(() => avisos++);
  const datos = { avatar: 'aura', sttEngine: 'native', proactive: true, sfx: true, memoria: 2, cara: 'anillos', postura: 'pie' };
  let llamadas = 0;
  publicarMesa(datos, { fijarOido() {}, alternarComentarios() {}, alternarEfectos() {}, olvidar() {}, fijarCara() {}, fijarPostura() {} });
  publicarMesa({ ...datos }, { fijarOido() {}, alternarComentarios() {}, alternarEfectos() {}, olvidar: () => llamadas++, fijarCara() {}, fijarPostura() {} });
  assert.equal(avisos, 1, 'redibujar la mesa sin cambios no redibuja Ajustes');
  mesaAjustes().acciones.olvidar();
  assert.equal(llamadas, 1, 'pero la acción es la del último dibujo');
  publicarMesa({ ...datos, memoria: 0 }, mesaAjustes().acciones);
  assert.equal(avisos, 2);
  assert.equal(mesaAjustes().datos.memoria, 0);
  retirarMesa();
  assert.equal(mesaAjustes(), null, 'sin mesa, Ajustes no dibuja la sección');
  assert.equal(avisos, 3);
  quitar();
});

prueba('app: cada pantalla va dentro de su red de seguridad (LimitePantalla) con «Reintentar»', () => {
  assert.match(fuente('app/AppAura.tsx'), /screenLayout=\{[\s\S]*?<LimitePantalla/);
  const limite = fuente('app/LimitePantalla.tsx');
  assert.match(limite, /getDerivedStateFromError/);
  assert.match(limite, /reportarErrorPantalla\(/);
  assert.match(limite, /tr\('Reintentar', 'Try again'\)/);
});

prueba('app: «abre tu computadora / WhatsApp / mis correos» desde cualquier pantalla, y la vista en vivo se abre sola (José, 2-oct)', () => {
  const raiz = fuente('app/AppAura.tsx');
  assert.match(raiz, /\{enSesion && <ComputadoraEnVivo \/>\}/, 'la raíz dibuja la vista en vivo encima de cualquier pantalla');
  const acciones = fuente('app/acciones.ts');
  assert.match(acciones, /mas === 'computadora' \|\| mas === 'correos'[\s\S]*?abrirHoja\(mas\)/, 'computadora y correos: las hojas de toda la app');
  assert.match(acciones, /mas === 'whatsapp'[\s\S]*?abrirWhatsapp\(\)/, 'WhatsApp: los chats con su pestaña');
  assert.match(fuente('app/rutas.ts'), /abrirRuta\('Chats', \{ whatsapp: Date\.now\(\) \}\)/);
  assert.match(fuente('app/pantallas/Chats.tsx'), /enWhatsapp=\{enWhatsapp\}/, 'la ruta le pasa la pestaña a los chats');
  const vivo = fuente('app/ComputadoraEnVivo.tsx');
  assert.match(vivo, /esAccionPc\(a\)\) companero\.alAccion\(a\)/, 'los avisos de su computadora llegan al compañero');
  assert.match(vivo, /emitir\('lectura'/, 'lo dice con la voz de AURA (lectura con boleto o la voz de la mesa)');
  assert.match(vivo, /<HojaCorreos visible=\{hojas\.abierta === 'correos'\}/);
  // La mesa y Ajustes no dibujan otra: HojaComputadora solo abre la de toda la app.
  const hoja = fuente('ajustes/Computadora.tsx');
  assert.match(hoja, /export function HojaComputadora\([\s\S]*?abrirHoja\('computadora'\)/);
  // Solo lo que ya trae la app: el tecleo es el mismo archivo del sonido de la conversación.
  assert.match(fuente('compa/computadoraSonido.ts'), /require\('\.\.\/\.\.\/assets\/sfx\/teclado\.mp3'\)/);
  assert.ok(fs.existsSync(path.join(RAIZ, 'mobile/assets/sfx/teclado.mp3')));
});

prueba('app: su computadora como un agente: captura arriba, plan marcado, tiempo, Detener/Pausar/Tomar el control, su sí, resultado para compartir e historial (José, 2-oct)', () => {
  const hoja = fuente('ajustes/Computadora.tsx');
  // De arriba abajo: la captura en vivo va antes que el plan, y el plan antes que los mandos y el final.
  const en = (re) => {
    const i = hoja.search(re);
    assert.ok(i >= 0, `falta ${re}`);
    return i;
  };
  const pantalla = en(/La pantalla en vivo, arriba de todo/);
  const pregunta = en(/tr\('Necesito tu sí para seguir'/);
  const plan = en(/tr\('El plan', 'The plan'\)/);
  const mandos = en(/tr\('Pausar', 'Pause'\)/);
  const final = en(/<TarjetaFinal mision=\{misionDeAhora\}/);
  assert.ok(pantalla < pregunta && pregunta < plan && plan < mandos && mandos < final, 'captura → su sí → plan → mandos → resultado');
  // Detener: fijo abajo (el pie de la hoja, fuera del desplazamiento) y nunca bloqueado por otro botón en camino
  // (auditoría, 3-oct: quedaba debajo de todo y la guarda de «ocupado» lo ignoraba).
  assert.match(hoja, /pie=\{\s*tarea && sigue \?\s*\(\s*<Boton titulo=\{tr\('Detener la tarea', 'Stop the task'\)\}/);
  assert.match(hoja, /\(ocupado && que !== 'parar'\)/);
  assert.match(hoja, /relojMision\(/, 'el tiempo transcurrido');
  assert.match(hoja, /sobreTarea\('si', 'confirmar', \{ si: true \}\)/, '«Sí, hazlo» manda el sí');
  assert.match(hoja, /sobreTarea\('no', 'confirmar', \{ si: false \}\)/);
  assert.match(hoja, /sobreTarea\('pausar', 'pausar'\)/);
  assert.match(hoja, /sobreTarea\('tomar', 'control', \{ tomar: true \}\)/);
  assert.match(hoja, /sobreTarea\('devolver', 'control', \{ tomar: false \}\)/);
  assert.match(hoja, /c\.faltaActualizar \?/, 'con el servicio viejo se explica por qué solo hay Detener');
  assert.match(hoja, /aCoordenadas\(locationX, locationY, anchoImg, altoImg\)/, 'con el control, tocar la captura hace clic ahí');
  assert.match(hoja, /Share\.share\(\{ message: textoParaCompartir\(/, 'el resultado se comparte (Share de React Native: sin módulos nativos nuevos)');
  assert.match(hoja, /Linking\.openURL\(u\)/, 'los enlaces se abren');
  assert.match(hoja, /\/api\/computadora\/misiones\/\$\{encodeURIComponent\(m\.id\)\}\/seguir/, '«Seguir» una misión a medias');
  assert.match(hoja, /tr\('Misiones recientes', 'Recent missions'\)/, 'el historial');
  assert.match(hoja, /sinRespuesta >= FALLOS_PARA_AVISAR/, 'si no llega nada, lo dice (nunca colgada en silencio)');
  const vivo = fuente('app/ComputadoraEnVivo.tsx');
  assert.match(vivo, /planInicial=\{companero\.plan\}/);
  assert.match(vivo, /companero\.alEstado\(s\.actual\.id, trabajando\(s\.actual\.estado\), s\.actual\.estado\)/, 'el sondeo de fondo también ve si quedó quieta');
  // Sin dependencias nativas nuevas (va por OTA): solo lo que ya trae React Native.
  const deps = JSON.parse(fs.readFileSync(path.join(RAIZ, 'mobile/package.json'), 'utf8')).dependencies;
  assert.ok(!deps['expo-clipboard'] && !deps['react-native-share'], 'sin módulos nativos nuevos');
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
