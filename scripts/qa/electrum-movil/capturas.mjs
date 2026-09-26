#!/usr/bin/env node
/**
 * EL BANCO DE PRUEBAS DE LA APP DE DR ELECTRUM, pantalla por pantalla y estado por estado.
 *
 * Monta las pantallas del teléfono con react-native-web (vite.config.mts de esta carpeta), las abre
 * en Chromium a tamaño de teléfono —vertical 360×760 y 390×844, horizontal 844×390— y contesta la
 * API con las FORMAS REALES de server.ts (no inventadas): `/api/electrum/salud`, `/turno`,
 * `/subir`, `/voz`, `/entrar`, `/api/ultron/salir`. Por cada escenario deja una captura y anota
 * los errores de consola y las alertas que la app levantó.
 *
 * Encima de la página se pintan, en magenta translúcido, la barra de estado (24 px arriba) y la
 * de navegación de tres botones (48 px abajo en vertical, a la derecha en horizontal), que es lo
 * que Android 15+ dibuja ENCIMA de la app con edge-to-edge. Lo que quede debajo del magenta es lo
 * que en el teléfono no se ve o no se puede tocar.
 *
 *   node scripts/qa/electrum-movil/capturas.mjs <salida> [--sin-construir] [--solo=patron]
 *
 * Chromium: PLAYWRIGHT_BROWSERS_PATH (o CHROMIUM_PATH para uno concreto).
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const aqui = import.meta.dirname;
const raiz = path.resolve(aqui, '../../..');
const salida = path.resolve(process.argv[2] || '/tmp/elmovil/capturas');
const construir = !process.argv.includes('--sin-construir');
const solo = (process.argv.find((a) => a.startsWith('--solo=')) || '').slice(7);
const web = path.join(salida, '_web');
fs.mkdirSync(salida, { recursive: true });

if (construir) {
  execFileSync('npx', ['vite', 'build', '--config', path.join(aqui, 'vite.config.mts'), '--outDir', web, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: raiz,
    stdio: 'inherit',
  });
}

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = createServer(async (req, res) => {
  const p = (req.url || '/').split('?')[0];
  const f = path.join(web, p === '/' ? 'index.html' : p);
  try {
    const cuerpo = await readFile(f);
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' });
    res.end(cuerpo);
  } catch {
    res.writeHead(404).end('no');
  }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;

/* ------------------------------------------------------------------ respuestas (forma de server.ts) */

// GET /api/electrum/salud: `...saludBase()` arriba, más listo/cerebro/voz/catastro/quien/nivel.
const salud = (o = {}) => ({
  viva: true,
  postgis: '3.4 USE_GEOS=1 USE_PROJ=1 USE_STATS=1',
  concesiones: 1043,
  listo: true,
  cerebro: { configurado: true, vivo: true },
  voz: { llave: true, perfil: 'Alex' },
  catastro: { viva: true, motivo: null, concesiones: 1043 },
  herramientas: 14,
  quien: 'José Ordóñez',
  nivel: 'mando',
  bot: true,
  honesto: true,
  ...o,
});
const SALUD_CAIDA = salud({
  viva: false,
  concesiones: undefined,
  postgis: undefined,
  motivo: 'connect ECONNREFUSED 10.208.3.14:5432',
  catastro: { viva: false, motivo: 'connect ECONNREFUSED 10.208.3.14:5432', concesiones: null },
});

// POST /api/electrum/turno: RespuestaTurno (server/electrum/turno.ts) + honesto.
const turno = (texto, o = {}) => ({
  texto,
  emocion: 'neutral',
  panel: 'Geólogo y Legal Minero',
  traza: [],
  ui: [],
  fin: 'respuesta',
  trazaId: 'tr_9f2c1a',
  honesto: true,
  ...o,
});
const LARGO =
  'Según el catastro minero de INHGEOMIN, el punto (-87.042100, 13.421800) cae dentro de la concesión «Quebrada Seca II» ' +
  '(expediente 2019-EXP-0417), inscrita a nombre de Minerales del Sur S. de R.L., de tipo explotación metálica, con 412,7 ha. ' +
  'A 180 m al noreste está el lindero con «El Corpus» (expediente 2016-EXP-0233): con un GPS de ±6 m no caés sobre el lindero, ' +
  'pero si vas a marcar un mojón, confirmalo con la estación total. Esto es lo que dice el padrón; de quién es el derecho lo dice ' +
  'el expediente y, si hay conflicto, un juez. Vence el 14 de marzo de 2027 y figura con el pago del canon de 2025 al día.';
const TRAZA = [
  { herramienta: 'catastro_en_punto', ok: true, resumen: 'dentro de Quebrada Seca II (2019-EXP-0417), 412,7 ha, explotación', ms: 812 },
  { herramienta: 'gis_traslapes', ok: true, resumen: '1 vecina a 180 m: El Corpus (2016-EXP-0233); sin traslape', ms: 1204 },
  { herramienta: 'expediente_buscar', ok: false, resumen: 'sin documentos indexados para 2019-EXP-0417 — cargá la resolución para citarla', ms: 402 },
];

/** Un WAV de verdad (cabecera RIFF + 0,2 s de silencio a 24 kHz): lo que devuelve /api/electrum/voz. */
function wav() {
  const n = 4800;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(24000, 24);
  b.writeUInt32LE(48000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  return b;
}
const WAV = wav();
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n'.repeat(40));

/** Un turno en el que el doctor armó un PDF: `ui` trae `{ informe }` como lo deja `informe_pdf` (manos.ts). */
const TURNO_INFORME = turno(
  'Te armé la ficha de Quebrada Seca II: 412,7 ha medidas sobre la geometría del catastro, un traslape de 0,8 ha con El Corpus y dos citas de expediente. Ya está listo para descargar.',
  {
    panel: 'Legal Minero',
    traza: [{ herramienta: 'informe_pdf', ok: true, resumen: 'ficha de Quebrada Seca II · 3 páginas', ms: 4120 }],
    ui: [{ informe: { id: 'mfk2x9a1b2c3d4', nombre: 'Informe-Quebrada-Seca-II-2026-09-26.pdf', url: '/api/electrum/informe/mfk2x9a1b2c3d4', bytes: 318_422 } }],
  }
);

const json = (status, cuerpo) => ({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(cuerpo) });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Las rutas por omisión. Cada escenario pisa las que necesita: `api['POST /api/electrum/turno']`.
 * Una función recibe (req, contador) y devuelve {status, body…}, 'red' (sin red) o 'colgar'.
 */
function rutas(extra = {}) {
  return {
    'GET /api/electrum/salud': () => json(200, salud()),
    'POST /api/electrum/turno': (req, n) =>
      n === 1
        ? json(200, turno(LARGO, { traza: TRAZA, emocion: 'serio' }))
        : json(200, turno('Son 27.330 onzas troy: 250.000 t × 3,4 g/t = 850.000 g, y 850.000 ÷ 31,1035 = 27.328 oz. Sin recuperación metalúrgica; con un 90 % quedarían unas 24.600 oz.', { panel: 'Metalurgista', traza: [{ herramienta: 'calcular', ok: true, resumen: '250000*3.4/31.1035 = 27328.4', ms: 3 }] })),
    'POST /api/electrum/voz': () => ({ status: 200, contentType: 'audio/wav', body: WAV }),
    'POST /api/electrum/subir': () =>
      json(200, {
        clase: 'documento',
        dicho: 'Leí la foto y saqué 1.284 caracteres: 3 fragmentos indexados y ya queda en el expediente, buscable. Es lo que se lee en la imagen; lo que salía borroso lo dejé marcado como ilegible en vez de completarlo.',
        avisos: [{ nivel: 'ojo', texto: 'Leído con gemini. Es una transcripción de una foto, no el documento original.' }],
        ui: { accion: 'documento', documento_id: 88, nombre: 'foto.jpg', paginas: 1, fragmentos: 3, foto: true },
        capaId: null,
        honesto: true,
      }),
    'POST /api/electrum/entrar': () =>
      json(200, { ok: true, token: 'u1.eyJjIjoiai5vcmRvbmV6In0.firma', miembro: { nombre: 'José', correo: 'j.ordonez@ordenglobal.org', rol: 'Junta Directiva · Orden Global' }, message: 'Bienvenido a AU-RA FP, José', remoteUrl: 'https://cerebro' }),
    'POST /api/ultron/salir': () => json(200, { ok: true, cerrada: true, message: 'Sesión cerrada.' }),
    // GET /api/electrum/informe/:id: el PDF crudo (application/pdf), como `res.end(r.informe.pdf)`.
    'GET /api/electrum/informe/*': () => ({ status: 200, contentType: 'application/pdf', body: PDF }),
    ...extra,
  };
}

/* ------------------------------------------------------------------ escenarios */

const V = { v360: { width: 360, height: 760 }, v390: { width: 390, height: 844 }, h844: { width: 844, height: 390 } };

const escribir = async (p, etiqueta, texto) => {
  const c = p.getByLabel(etiqueta, { exact: true });
  await c.click();
  await c.fill(texto);
};
const tocar = (p, etiqueta) => p.getByRole('button', { name: etiqueta, exact: true }).first().click();

/** [nombre, consulta, {api, antes(p), espera, tamaños}] */
const ESCENARIOS = [
  ['arranque', '', { espera: 700 }],
  ['arranque-a-entrar', '', { espera: 3400 }],
  ['entrar-vacio', '?p=entrar', {}],
  [
    'entrar-cargando',
    '?p=entrar',
    {
      api: { 'POST /api/electrum/entrar': () => 'colgar' },
      antes: async (p) => {
        await escribir(p, 'Correo', 'j.ordonez@ordenglobal.org');
        await escribir(p, 'Clave', 'secreta-larga');
        await tocar(p, 'Entrar');
      },
    },
  ],
  [
    'entrar-401',
    '?p=entrar',
    {
      api: { 'POST /api/electrum/entrar': () => json(401, { error: 'credenciales inválidas' }) },
      antes: async (p) => {
        await escribir(p, 'Correo', 'j.ordonez@ordenglobal.org');
        await escribir(p, 'Clave', 'mala');
        await tocar(p, 'Entrar');
      },
    },
  ],
  [
    'entrar-sin-red',
    '?p=entrar',
    {
      api: { 'POST /api/electrum/entrar': () => 'red' },
      antes: async (p) => {
        await escribir(p, 'Correo', 'j.ordonez@ordenglobal.org');
        await escribir(p, 'Clave', 'secreta');
        await tocar(p, 'Entrar');
      },
    },
  ],
  [
    'entrar-429',
    '?p=entrar',
    {
      api: {
        'POST /api/electrum/entrar': () =>
          json(429, { error: 'Demasiados intentos con esta cuenta. Probá de nuevo en 12 minutos.', code: 'demasiados_intentos', reintentarEnS: 700, honesto: true }),
      },
      antes: async (p) => {
        await escribir(p, 'Correo', 'j.ordonez@ordenglobal.org');
        await escribir(p, 'Clave', 'secreta');
        await tocar(p, 'Entrar');
      },
    },
  ],
  [
    'entrar-llave',
    '?p=entrar',
    {
      antes: async (p) => {
        await p.getByRole('tab', { name: 'Entrar con llave de demostración' }).click();
        await escribir(p, 'Llave de la demostración', 'demo-cliente-2026');
      },
    },
  ],
  [
    'entrar-sin-permiso',
    '?p=entrar',
    {
      api: {
        'GET /api/electrum/salud': () => json(401, { error: 'Dr Electrum FP es privado. Entrá con tu sesión o con la llave de la demostración.', code: 'sesion_requerida', plataforma: 'electrum', honesto: true }),
      },
      antes: async (p) => {
        await escribir(p, 'Correo', 'otra@ordenglobal.org');
        await escribir(p, 'Clave', 'secreta');
        await tocar(p, 'Entrar');
      },
    },
  ],
  [
    'flujo-completo',
    '',
    {
      espera: 400,
      antes: async (p) => {
        await p.waitForTimeout(3000);
        await escribir(p, 'Correo', 'j.ordonez@ordenglobal.org');
        await escribir(p, 'Clave', 'secreta');
        await tocar(p, 'Entrar');
        await p.waitForTimeout(1500);
      },
    },
  ],
  ['campo-vacio', '?p=campo', {}],
  ['campo-salud-fallo', '?p=campo', { api: { 'GET /api/electrum/salud': () => 'red' } }],
  ['campo-catastro-caido', '?p=campo', { api: { 'GET /api/electrum/salud': () => json(200, SALUD_CAIDA) } }],
  ['campo-consulta', '?p=campo', { api: { 'GET /api/electrum/salud': () => json(200, salud({ quien: null, nivel: null })) } }],
  [
    'campo-pensando',
    '?p=campo',
    {
      api: { 'POST /api/electrum/turno': () => 'colgar' },
      antes: async (p) => {
        await escribir(p, 'Pregunta para Dr Electrum', '¿qué concesiones vencen este año en Choluteca?');
        await tocar(p, 'Mandar la pregunta');
      },
    },
  ],
  [
    'campo-conversacion',
    '?p=campo',
    {
      antes: async (p) => {
        await tocar(p, '¿se traslapa algo en el catastro?');
        await p.waitForTimeout(900);
        await escribir(p, 'Pregunta para Dr Electrum', '250.000 toneladas a 3,4 g/t, ¿cuántas onzas?');
        await tocar(p, 'Mandar la pregunta');
        await p.waitForTimeout(900);
      },
    },
  ],
  [
    'campo-doble-toque',
    '?p=campo',
    {
      tamanos: { v390: V.v390 },
      antes: async (p) => {
        await escribir(p, 'Pregunta para Dr Electrum', '¿cuántas concesiones hay en Danlí?');
        const ir = p.getByRole('button', { name: 'Mandar la pregunta', exact: true });
        // Dos toques en el mismo instante, antes de que React vuelva a pintar.
        await ir.evaluate((el) => {
          el.click();
          el.click();
        });
        await p.waitForTimeout(900);
      },
      comprobar: (c) => (c['POST /api/electrum/turno'] === 1 ? [] : [`se mandaron ${c['POST /api/electrum/turno'] || 0} preguntas por un doble toque`]),
    },
  ],
  [
    'campo-hilo-sin-fallos',
    '?p=campo',
    {
      tamanos: { v390: V.v390 },
      api: {
        'POST /api/electrum/turno': (req, n) => {
          if (n === 1) return 'red';
          globalThis.__hiloMandado = req.postDataJSON()?.hilo;
          return json(200, turno('Ahora sí te alcanzo.'));
        },
      },
      antes: async (p) => {
        await escribir(p, 'Pregunta para Dr Electrum', 'primera, que falla');
        await tocar(p, 'Mandar la pregunta');
        await p.waitForTimeout(700);
        await escribir(p, 'Pregunta para Dr Electrum', 'segunda');
        await tocar(p, 'Mandar la pregunta');
        await p.waitForTimeout(700);
      },
      comprobar: () => {
        const h = globalThis.__hiloMandado || [];
        return h.length ? [`el hilo mandó los fallos al modelo: ${JSON.stringify(h).slice(0, 200)}`] : [];
      },
    },
  ],
  [
    'campo-voz-apagada',
    '?p=campo',
    {
      tamanos: { v390: V.v390 },
      antes: async (p) => {
        await p.getByRole('switch', { name: 'Voz del doctor' }).click();
        await tocar(p, '¿se traslapa algo en el catastro?');
        await p.waitForTimeout(900);
      },
      comprobar: (c) => (c['POST /api/electrum/voz'] ? ['con VOZ apagada se pidió audio igual'] : []),
    },
  ],
  [
    'campo-informe',
    '?p=campo',
    {
      api: { 'POST /api/electrum/turno': () => json(200, TURNO_INFORME) },
      antes: async (p) => {
        await escribir(p, 'Pregunta para Dr Electrum', 'armame un informe de Quebrada Seca II');
        await tocar(p, 'Mandar la pregunta');
        await p.waitForTimeout(900);
      },
    },
  ],
  [
    'campo-informe-guardado',
    '?p=campo',
    {
      api: { 'POST /api/electrum/turno': () => json(200, TURNO_INFORME) },
      antes: async (p) => {
        await escribir(p, 'Pregunta para Dr Electrum', 'armame un informe de Quebrada Seca II');
        await tocar(p, 'Mandar la pregunta');
        await p.waitForTimeout(900);
        await p.getByRole('button', { name: /Guardar en el teléfono el informe/ }).click();
        await p.waitForTimeout(900);
      },
      comprobar: async (c, p) => {
        const a = await p.evaluate(() => globalThis.__archivos || []);
        return a.length === 1 && a[0].cabecera === '%PDF-' && c['GET /api/electrum/informe/mfk2x9a1b2c3d4'] === 1
          ? []
          : [`el PDF no quedó escrito: ${JSON.stringify(a)} ${JSON.stringify(c)}`];
      },
    },
  ],
  [
    'campo-informe-caducado',
    '?p=campo',
    {
      tamanos: { v390: V.v390 },
      api: {
        'POST /api/electrum/turno': () => json(200, TURNO_INFORME),
        'GET /api/electrum/informe/*': () =>
          json(404, { error: 'Ese informe ya no está. Se guardan media hora porque describen el catastro del momento; pedime otro.', honesto: true }),
      },
      antes: async (p) => {
        await escribir(p, 'Pregunta para Dr Electrum', 'armame un informe de Quebrada Seca II');
        await tocar(p, 'Mandar la pregunta');
        await p.waitForTimeout(900);
        await p.getByRole('button', { name: /Guardar en el teléfono el informe/ }).click();
        await p.waitForTimeout(900);
      },
    },
  ],
  [
    'campo-dictado-oyendo',
    '?p=campo',
    {
      tamanos: { v390: V.v390 },
      espera: 0,
      antes: async (p) => {
        await tocar(p, 'Dictar la pregunta');
        await p.waitForTimeout(1300);
      },
      comprobar: async (_c, p) =>
        (await p.getByRole('button', { name: 'Dejar de dictar', exact: true }).count()) ? [] : ['el micrófono se apagó solo al empezar a dictar'],
    },
  ],
  [
    'campo-dictado-listo',
    '?p=campo',
    {
      tamanos: { v390: V.v390 },
      antes: async (p) => {
        await tocar(p, 'Dictar la pregunta');
        await p.waitForTimeout(3200);
      },
      comprobar: async (_c, p) => {
        const v = await p.getByLabel('Pregunta para Dr Electrum', { exact: true }).inputValue();
        return v === '¿qué dice el catastro de Quebrada Seca?' ? [] : [`la caja quedó con «${v}» en vez de lo dictado`];
      },
    },
  ],
  [
    'campo-dictado-y-mandar',
    '?p=campo',
    {
      tamanos: { v390: V.v390 },
      antes: async (p) => {
        await tocar(p, 'Dictar la pregunta');
        await p.waitForTimeout(1300);
        await tocar(p, 'Mandar la pregunta');
        await p.waitForTimeout(1500);
      },
      comprobar: async (_c, p) => {
        const v = await p.getByLabel('Pregunta para Dr Electrum', { exact: true }).inputValue();
        return v === '' ? [] : [`después de mandar, el dictado volvió a llenar la caja con «${v}»`];
      },
    },
  ],
  [
    'campo-atras',
    '?p=campo',
    {
      tamanos: { v390: V.v390 },
      antes: async (p) => {
        await tocar(p, '¿se traslapa algo en el catastro?');
        await p.waitForTimeout(900);
        await p.evaluate(() => globalThis.__atras());
      },
    },
  ],
  [
    'flujo-sesion-caducada',
    '?sesion=u1.vieja',
    {
      espera: 3200,
      api: { 'GET /api/electrum/salud': () => json(401, { error: 'Dr Electrum FP es privado. Entrá con tu sesión o con la llave de la demostración.', code: 'sesion_requerida', plataforma: 'electrum', honesto: true }) },
    },
  ],
  [
    'flujo-401-en-pregunta',
    '?sesion=u1.buena',
    {
      tamanos: { v390: V.v390 },
      api: {
        'POST /api/electrum/turno': () => json(401, { error: 'Dr Electrum FP es privado. Entrá con tu sesión o con la llave de la demostración.', code: 'sesion_requerida', plataforma: 'electrum', honesto: true }),
      },
      antes: async (p) => {
        await p.waitForTimeout(3000);
        await escribir(p, 'Pregunta para Dr Electrum', '¿qué vence este mes?');
        await tocar(p, 'Mandar la pregunta');
        await p.waitForTimeout(1500);
      },
      // Una sola comprobación de la puerta al arrancar y una de la barra del campo. Una tercera es
      // el efecto de montaje del campo corriendo otra vez cuando el arranque termina de fundirse.
      comprobar: (c) => (c['GET /api/electrum/salud'] === 2 ? [] : [`salud se pidió ${c['GET /api/electrum/salud']} veces (se esperaban 2)`]),
    },
  ],
  [
    'campo-error-turno',
    '?p=campo',
    {
      api: { 'POST /api/electrum/turno': () => json(500, { error: 'Se me cayó el turno. Volvé a preguntarme.', honesto: true }) },
      antes: async (p) => {
        await escribir(p, 'Pregunta para Dr Electrum', '¿qué dice la resolución de Quebrada Seca?');
        await tocar(p, 'Mandar la pregunta');
        await p.waitForTimeout(600);
      },
    },
  ],
  [
    'campo-sin-red-turno',
    '?p=campo',
    {
      api: { 'POST /api/electrum/turno': () => 'red' },
      antes: async (p) => {
        await escribir(p, 'Pregunta para Dr Electrum', '¿cuántas hectáreas tiene El Corpus?');
        await tocar(p, 'Mandar la pregunta');
        await p.waitForTimeout(600);
      },
    },
  ],
  [
    'campo-donde-estoy',
    '?p=campo',
    {
      antes: async (p) => {
        await tocar(p, 'Consultar el catastro del punto donde estoy');
        await p.waitForTimeout(1200);
      },
    },
  ],
  [
    'campo-gps-lento',
    '?p=campo&gps=lento',
    {
      antes: async (p) => {
        await tocar(p, 'Consultar el catastro del punto donde estoy');
        await p.waitForTimeout(800);
      },
    },
  ],
  [
    // El GPS que no fija nunca: a los 25 s tiene que soltar el botón y decir qué pasó.
    'campo-gps-sin-fijar',
    '?p=campo&gps=lento',
    {
      tamanos: { v390: V.v390 },
      antes: async (p) => {
        await tocar(p, 'Consultar el catastro del punto donde estoy');
        await p.waitForTimeout(26_000);
      },
      comprobar: async (_c, p) => {
        const a = await p.evaluate(() => globalThis.__alertas || []);
        const libre = await p.getByText('¿DÓNDE ESTOY?', { exact: true }).count();
        return a.some((x) => /GPS tardó demasiado/.test(x.mensaje)) && libre ? [] : [`el GPS lento no se cortó: ${JSON.stringify(a)}`];
      },
    },
  ],
  [
    'campo-camara',
    '?p=campo',
    {
      antes: async (p) => {
        await tocar(p, 'Fotografiar un papel para el expediente');
        await p.waitForTimeout(700);
      },
    },
  ],
  [
    'campo-foto-leida',
    '?p=campo',
    {
      antes: async (p) => {
        await tocar(p, 'Fotografiar un papel para el expediente');
        await p.waitForTimeout(700);
        await tocar(p, 'Tomar la foto y leerla');
        await p.waitForTimeout(1200);
      },
    },
  ],
  [
    'campo-foto-consulta',
    '?p=campo',
    {
      api: { 'GET /api/electrum/salud': () => json(200, salud({ quien: null, nivel: null })) },
      antes: async (p) => {
        await p.waitForTimeout(500);
        await tocar(p, 'Fotografiar un papel para el expediente');
        await p.waitForTimeout(700);
      },
    },
  ],
  [
    'campo-texto-largo',
    '?p=campo',
    {
      antes: async (p) => {
        await escribir(
          p,
          'Pregunta para Dr Electrum',
          'Estoy en el lindero norte de Quebrada Seca, junto al mojón 14, y el vecino dice que su concesión El Corpus llega hasta la quebrada; ¿qué dice el catastro de ese traslape y qué papeles tengo que pedir en INHGEOMIN?'
        );
      },
    },
  ],
  [
    'campo-salir',
    '?p=campo',
    {
      antes: async (p) => {
        await tocar(p, 'Salir y cerrar la sesión');
      },
    },
  ],
];

/* ------------------------------------------------------------------ el recorrido */

const BARRAS = `
  (() => {
    const pintar = () => {
      if (document.getElementById('__barras')) return;
      const d = document.createElement('div');
      d.id = '__barras';
      const h = innerWidth > innerHeight;
      d.innerHTML =
        '<div style="position:fixed;left:0;right:0;top:0;height:24px;background:rgba(255,0,200,.38);z-index:2147483647;pointer-events:none;font:11px monospace;color:#fff;padding-left:8px;line-height:24px">10:30 · barra de estado</div>' +
        (h
          ? '<div style="position:fixed;top:0;bottom:0;right:0;width:48px;background:rgba(255,0,200,.38);z-index:2147483647;pointer-events:none"></div>'
          : '<div style="position:fixed;left:0;right:0;bottom:0;height:48px;background:rgba(255,0,200,.38);z-index:2147483647;pointer-events:none;font:11px monospace;color:#fff;text-align:center;line-height:48px">◁   ○   □</div>');
      document.body.appendChild(d);
    };
    addEventListener('DOMContentLoaded', pintar);
    addEventListener('resize', () => { document.getElementById('__barras')?.remove(); pintar(); });
  })();
`;

const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader'] });
const informe = [];
for (const [nombre, consulta, op] of ESCENARIOS) {
  if (solo && !nombre.includes(solo)) continue;
  for (const [tam, vp] of Object.entries(op.tamanos || V)) {
    const ctx = await nav.newContext({ viewport: vp, screen: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: false, locale: 'es-HN' });
    const p = await ctx.newPage();
    const errores = [];
    const alertas = [];
    p.on('pageerror', (e) => errores.push(`pageerror: ${String(e?.message || e).slice(0, 240)}`));
    p.on('console', (m) => {
      const t = m.text();
      if (t.startsWith('[alerta]')) alertas.push(t.slice(9));
      // Los 4xx/5xx y la red cortada que los escenarios provocan a propósito no son fallos de la app.
      else if (m.type() === 'error' && !/^Failed to load resource/.test(t)) errores.push(`console.error: ${t.slice(0, 240)}`);
    });
    const api = rutas(op.api);
    const cuenta = {};
    await p.route(/\/api\//, async (ruta) => {
      const req = ruta.request();
      const clave = `${req.method()} ${new URL(req.url()).pathname}`;
      cuenta[clave] = (cuenta[clave] || 0) + 1;
      const h = api[clave] || api[clave.replace(/\/[^/]+$/, '/*')];
      if (!h) return ruta.fulfill(json(404, { error: `sin doble para ${clave}` }));
      const r = await h(req, cuenta[clave]);
      if (r === 'red') return ruta.abort('internetdisconnected');
      if (r === 'colgar') return; // nunca contesta: el estado de «esperando»
      await dormir(250);
      return ruta.fulfill(r).catch(() => {});
    });
    await p.addInitScript(BARRAS);
    await p.goto(`${base}/${consulta}`, { waitUntil: 'load' });
    await p.waitForTimeout(op.antes ? 900 : 0);
    try {
      if (op.antes) await op.antes(p);
    } catch (e) {
      errores.push(`guion: ${String(e?.message || e).split('\n')[0].slice(0, 200)}`);
    }
    await p.waitForTimeout(op.espera ?? 900);
    const archivo = path.join(salida, `${nombre}-${tam}.png`);
    await p.screenshot({ path: archivo });
    // Lo que se sale de la pantalla por los lados (el fallo más común al girar).
    const desborde = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (desborde > 0) errores.push(`desborde horizontal: ${desborde}px`);
    if (op.comprobar) errores.push(...(await op.comprobar(cuenta, p)));
    const sonidos = await p.evaluate(() => (globalThis).__sonidos || null);
    informe.push({ nombre, tam, errores, alertas, llamadas: cuenta, sonidos });
    await ctx.close();
  }
}

// La rotación con conversación en pantalla: el hilo tiene que seguir ahí al girar.
if (!solo || 'rotacion'.includes(solo)) {
  const ctx = await nav.newContext({ viewport: V.v390, screen: V.v390, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', (e) => errores.push(`pageerror: ${String(e?.message || e).slice(0, 240)}`));
  const api = rutas();
  const cuenta = {};
  await p.route(/\/api\//, async (ruta) => {
    const req = ruta.request();
    const clave = `${req.method()} ${new URL(req.url()).pathname}`;
    cuenta[clave] = (cuenta[clave] || 0) + 1;
    const r = await api[clave](req, cuenta[clave]);
    await dormir(200);
    return ruta.fulfill(r);
  });
  await p.addInitScript(BARRAS);
  await p.goto(`${base}/?p=campo`);
  await p.waitForTimeout(900);
  await tocar(p, '¿se traslapa algo en el catastro?');
  await p.waitForTimeout(900);
  await p.screenshot({ path: path.join(salida, 'rotacion-1-vertical.png') });
  await p.setViewportSize(V.h844);
  await p.waitForTimeout(700);
  await p.screenshot({ path: path.join(salida, 'rotacion-2-horizontal.png') });
  await p.setViewportSize(V.v390);
  await p.waitForTimeout(700);
  await p.screenshot({ path: path.join(salida, 'rotacion-3-vertical.png') });
  const burbujas = await p.getByText('Quebrada Seca II', { exact: false }).count();
  if (!burbujas) errores.push('la respuesta se perdió al girar');
  informe.push({ nombre: 'rotacion', tam: '390↔844', errores, alertas: [], llamadas: cuenta });
  await ctx.close();
}

await nav.close();
srv.close();

let malos = 0;
for (const r of informe) {
  const marca = r.errores.length ? '✗' : '·';
  if (r.errores.length) malos += 1;
  console.log(`${marca} ${r.nombre} [${r.tam}] llamadas=${JSON.stringify(r.llamadas)}${r.sonidos ? ` sonidos=${JSON.stringify(r.sonidos)}` : ''}`);
  for (const a of r.alertas) console.log(`    alerta: ${a}`);
  for (const e of r.errores) console.log(`    ${e}`);
}
console.log(`\n${informe.length} capturas en ${salida} · ${malos} con errores`);
fs.writeFileSync(path.join(salida, 'informe.json'), JSON.stringify(informe, null, 2));
