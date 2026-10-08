// LA RECARGA SIN CIERRE con el código real (out/recarga.cjs, construir.cjs). Emulador, 8-oct (y José, 7-oct: la app
// se cerró ~13 s después de abrir, justo tras bajar una OTA): «FATAL EXCEPTION: expo-updates-error-recovery …
// Player is accessed on the wrong thread … ExoPlayerImpl.release ← SimpleExoPlayerData.release ←
// AVManager.onHostDestroy ← ReactInstance.destroy ← ReactHostImpl.getOrCreateReloadTask». Al recargar el JS
// (`Updates.reloadAsync`), expo-av suelta desde un hilo de fondo los reproductores que siguen cargados. Lo que se
// prueba es que, en el instante de llamar a reloadAsync:
//  · no queda ningún sonido de expo-av cargado (tampoco uno que terminaba de cargar, ni uno nuevo pedido entretanto);
//  · la raíz se pinta vacía: ningún <Video> montado (el cuerpo en video de Claudio / ANT-ONIO);
//  · la voz ya se calló, pasó la espera (ESPERA_VACIA_MS) y se puso la marca de cierre intencional;
//  · reloadAsync se llama UNA vez aunque se pida varias;
//  · si reloadAsync falla, la app vuelve y se puede reintentar;
//  · y la causa de la segunda recarga del emulador: lo descargado que ya es lo que corre no se aplica otra vez, y
//    mientras se recarga no se busca otra OTA.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const m = require('./shims/mundo.js');

const SALIDA = process.env.RECARGA || path.join(__dirname, 'out/recarga.cjs');
const MOVIL = path.resolve(__dirname, '../..');
const SRC = path.resolve(process.env.SRC || path.join(MOVIL, 'src'));

let fallos = 0;
let n = 0;
const pruebas = [];
const prueba = (nombre, f) => pruebas.push([nombre, f]);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(f, topeMs = 4000) {
  const fin = Date.now() + topeMs;
  while (!f()) {
    if (Date.now() > fin) return false;
    await dormir(5);
  }
  return true;
}

/** El paquete de nuevo (estado de módulo limpio: ota.ts, recarga.ts, el registro, React). */
function cargar() {
  delete require.cache[require.resolve(SALIDA)];
  m.reiniciar();
  m.alMontar = [];
  return require(SALIDA);
}

/** Monta la raíz real (App.tsx) y prepara la foto que expo-updates toma al llamar a reloadAsync. */
function montarRaiz(B) {
  const { MONTAR, App, REGISTRO } = B;
  const vivo = MONTAR.montar(MONTAR.React.createElement(App));
  m.foto = () => ({
    cargados: m.sonidos.filter((s) => s.cargado).map((s) => s.nombre),
    videosMontados: m.videos.filter((v) => v.montado).map((v) => v.nombre),
    nodosVideo: MONTAR.buscar(vivo.raiz, (x) => x.type === 'Video').length,
    nodosApp: MONTAR.buscar(vivo.raiz, (x) => x.props && x.props.nombre === 'app').length,
    vivosRegistro: REGISTRO.sonidosVivos(),
  });
  return vivo;
}

const cuando = (que, dato) => {
  const e = m.eventos.find((x) => x.que === que && (dato === undefined || x.dato === dato));
  return e ? e.en : -1;
};
const cuantos = (que, dato) => m.eventos.filter((x) => x.que === que && (dato === undefined || x.dato === dato)).length;

/* ─────────────────────────────────────────────────────────────── la secuencia antes de reloadAsync */

prueba('antes de reloadAsync: voz callada, raíz vacía, todos los sonidos soltados, la marca puesta; una sola recarga', async () => {
  const B = cargar();
  const { AV, OTA, RECARGA, REGISTRO } = B;
  // Lo que la app tiene cargado al montar (la voz, un efecto, el timbre), como tts.ts / sfx.ts / compa/timbre.ts.
  m.alMontar = ['voz-frase.mp3', 'sfx-tap.mp3', 'timbre.wav'];
  const vivo = montarRaiz(B);
  assert.ok(await hasta(() => m.sonidos.length === 3 && m.videos.length === 1), 'la app montó su video y sus sonidos');
  // Otros caminos: new Sound + loadAsync (recorrido/sonidos.ts), uno que su dueño ya soltó (WhatsApp), uno que no
  // carga (archivo roto) y uno que termina de cargar con la recarga ya en marcha.
  const recorrido = new AV.Audio.Sound();
  await recorrido.loadAsync('recorrido.mp3');
  const { sound: wa } = await AV.Audio.Sound.createAsync({ uri: 'wa-audio.m4a' });
  await wa.unloadAsync();
  await AV.Audio.Sound.createAsync('roto.mp3').catch(() => {});
  m.demoraCarga['ambiente-lento.mp3'] = 150;
  const lento = AV.Audio.Sound.createAsync('ambiente-lento.mp3');
  assert.equal(REGISTRO.sonidosVivos(), 5, 'el registro ve los 4 cargados y el que carga (no el soltado ni el roto)');

  // El botón «Reiniciar», dos veces, y la recarga directa: una sola recarga.
  assert.deepEqual(OTA.aplicarAhora(), [], 'nada lo impide');
  OTA.aplicarAhora();
  // Y la recarga directa, ya en marcha la del botón: la misma promesa.
  assert.ok(await hasta(() => RECARGA.recargando()));
  const directa = RECARGA.recargarLimpio('otra vez');
  // Un sonido nuevo pedido con la recarga en marcha (un efecto al desmontar) se rechaza: ningún reproductor nuevo.
  assert.ok(await hasta(() => RECARGA.raizVacia()), 'la raíz se vacía');
  const tarde = await AV.Audio.Sound.createAsync('sfx-despedida.mp3').then(
    () => 'cargó',
    (e) => e.message
  );
  assert.match(tarde, /recargando/);
  await lento.catch(() => {});
  await directa;
  assert.ok(await hasta(() => m.recargas > 0), 'se llamó a reloadAsync');
  await dormir(600);
  assert.equal(m.recargas, 1, 'reloadAsync UNA vez');

  const f = m.alRecargar;
  assert.deepEqual(f.cargados, [], `ningún sonido cargado al recargar (quedaban: ${f.cargados.join(', ')})`);
  assert.equal(f.vivosRegistro, 0);
  assert.deepEqual(f.videosMontados, [], 'ningún <Video> montado al recargar');
  assert.equal(f.nodosVideo, 0, 'la raíz no pinta el video');
  assert.equal(f.nodosApp, 0, 'la raíz no pinta la app');
  for (const s of ['voz-frase.mp3', 'sfx-tap.mp3', 'timbre.wav', 'recorrido.mp3', 'ambiente-lento.mp3']) {
    assert.equal(cuantos('descargar', s), 1, `${s} se soltó una vez`);
    assert.ok(cuando('descargar', s) < cuando('reloadAsync'), `${s} se soltó antes de recargar`);
  }
  assert.equal(cuantos('descargar', 'wa-audio.m4a'), 1, 'lo que su dueño ya soltó no se suelta dos veces');
  assert.equal(cuantos('cargar', 'sfx-despedida.mp3'), 0);

  // El orden: la voz, la raíz vacía (el video se desmonta), la espera, la marca y la recarga.
  const t = { voz: cuando('stopSpeaking'), video: cuando('video-desmontado', 'cuerpo-claudio'), marca: cuando('cierreIntencional'), recarga: cuando('reloadAsync') };
  assert.ok(t.voz >= 0 && t.voz <= t.video, `la voz se calla primero (${JSON.stringify(t)})`);
  assert.ok(t.video < t.marca && t.marca <= t.recarga, `la marca, después de vaciar y antes de recargar (${JSON.stringify(t)})`);
  assert.ok(t.recarga - t.video >= B.RECARGA.ESPERA_VACIA_MS - 15, `la espera tras vaciar la raíz (${t.recarga - t.video} ms)`);
  assert.equal(cuantos('stopSpeaking'), 1);
  assert.equal(cuantos('cierreIntencional'), 1);
  assert.ok(m.migas.includes('ota: recarga intencional'), 'la marca de cierre intencional de siempre');
  vivo.desmontar();
});

prueba('si reloadAsync falla: la app vuelve (raíz pintada, sonidos de nuevo) y el botón reintenta', async () => {
  const B = cargar();
  const { AV, OTA, RECARGA, REGISTRO } = B;
  m.alMontar = ['voz-frase.mp3'];
  m.recargaFalla = true;
  const vivo = montarRaiz(B);
  assert.ok(await hasta(() => m.sonidos.length === 1 && m.videos.length === 1));
  OTA.aplicarAhora();
  assert.ok(await hasta(() => m.recargas === 1));
  assert.ok(await hasta(() => !RECARGA.raizVacia() && m.videos.filter((v) => v.montado).length === 1), 'la app se vuelve a pintar');
  assert.equal(REGISTRO.registroCerrado(), false, 'el registro vuelve a aceptar sonidos');
  const { sound } = await AV.Audio.Sound.createAsync('sfx-tap.mp3');
  assert.ok(await hasta(() => REGISTRO.sonidosVivos() === 2), 'la voz que la app vuelve a cargar al montarse y el efecto nuevo');
  assert.ok(m.migas.some((x) => /recarga: falló/.test(x)));
  // El botón otra vez: ahora sí.
  m.recargaFalla = false;
  await dormir(20);
  OTA.aplicarAhora();
  assert.ok(await hasta(() => m.recargas === 2), 'se reintentó');
  assert.deepEqual(m.alRecargar.cargados, [], 'y otra vez sin nada cargado');
  assert.deepEqual(m.alRecargar.videosMontados, []);
  void sound;
  vivo.desmontar();
});

/* ─────────────────────────────────────────────────── la segunda recarga del emulador (la que cerró la app) */

prueba('lo descargado que ya corre no se aplica otra vez al abrir (la 2.ª recarga del 8-oct)', async () => {
  const B = cargar();
  m.updateId = '01a11a24-2e81-7300-9d88-ad17ffece5f2';
  m.updates = { isUpdatePending: true, downloadedUpdate: { type: 'new', updateId: '01a11a24-2e81-7300-9d88-ad17ffece5f2' } };
  const vivo = montarRaiz(B);
  await dormir(1200);
  assert.equal(m.recargas, 0, 'no recarga la misma OTA');
  assert.equal(m.busquedas, 1, 'sí busca una nueva (la primera búsqueda de siempre)');
  vivo.desmontar();
});

prueba('una OTA nueva descargada se aplica al abrir, una vez, y mientras recarga no se busca otra', async () => {
  const B = cargar();
  m.updateId = 'ota-de-antes';
  m.updates = { isUpdatePending: true, downloadedUpdate: { type: 'new', updateId: 'ota-nueva' } };
  m.alMontar = ['voz-frase.mp3'];
  const vivo = montarRaiz(B);
  assert.ok(await hasta(() => m.recargas === 1), 'se aplica al abrir');
  await dormir(900);
  assert.equal(m.recargas, 1);
  assert.equal(m.busquedas, 0, 'la búsqueda de los 500 ms no corre con la recarga en marcha (bajaría otra «pendiente»)');
  assert.deepEqual(m.alRecargar.videosMontados, []);
  vivo.desmontar();
});

prueba('otaPendiente: pendiente solo si lo descargado no es lo que corre', () => {
  const { OTA } = cargar();
  assert.equal(OTA.otaPendiente({ isUpdatePending: false, descargada: 'a', corriendo: 'b' }), false);
  assert.equal(OTA.otaPendiente({ isUpdatePending: true, descargada: 'a', corriendo: 'b' }), true);
  assert.equal(OTA.otaPendiente({ isUpdatePending: true, descargada: 'a', corriendo: 'a' }), false);
  assert.equal(OTA.otaPendiente({ isUpdatePending: true }), true, 'sin datos, se fía del nativo');
  assert.equal(OTA.otaPendiente({ isUpdatePending: true, descargada: 'a', corriendo: null }), true, 'el JS de fábrica');
});

/* ─────────────────────────────────────────────────────────────────────────────── el registro */

prueba('registro: se instala una vez; una segunda carga rechazada no lo saca; soltar con tope no cuelga', async () => {
  const { AV, REGISTRO } = cargar();
  const carga = AV.Audio.Sound.prototype.loadAsync;
  assert.equal(REGISTRO.instalarRegistroAv(AV.Audio.Sound), true);
  assert.equal(AV.Audio.Sound.prototype.loadAsync, carga, 'instalar dos veces no envuelve dos veces');
  const s = new AV.Audio.Sound();
  await s.loadAsync('a.mp3');
  await assert.rejects(() => s.loadAsync('a.mp3'), /already loaded/);
  assert.equal(REGISTRO.sonidosVivos(), 1, 'sigue cargado: sigue en el registro');
  await s.unloadAsync();
  assert.equal(REGISTRO.sonidosVivos(), 0);
  // Un sonido cuyo nativo no responde: soltarTodo vuelve a su tope (nunca cuelga la recarga).
  const colgado = new AV.Audio.Sound();
  await colgado.loadAsync('colgado.mp3');
  m.colgar = new Set(['colgado.mp3']);
  const antes = Date.now();
  const r = await REGISTRO.soltarTodo(120);
  assert.ok(Date.now() - antes < 600, `volvió a su tope (${Date.now() - antes} ms)`);
  assert.deepEqual(r, { soltados: 1, pendientes: 1 }, 'el que no contestó se dice');
  assert.equal(REGISTRO.registroCerrado(), true);
  REGISTRO.abrirRegistro();
});

/* ─────────────────────────────────────────────────────────────── el código, leído */

prueba('el registro entra antes que la app; reloadAsync solo desde lib/recarga.ts', () => {
  const index = fs.readFileSync(path.join(path.dirname(SRC), 'index.js'), 'utf8');
  const iReg = index.indexOf("import './src/lib/avRegistro'");
  const iApp = index.indexOf("from './App'");
  assert.ok(iReg >= 0 && iReg < iApp, 'index.js importa el registro antes que la app');
  const llamadas = [];
  const recorrer = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'pruebas' && e.name !== 'node_modules') recorrer(p);
      } else if (/\.(ts|tsx)$/.test(e.name) && /\breloadAsync\s*\(/.test(fs.readFileSync(p, 'utf8'))) llamadas.push(path.relative(SRC, p));
    }
  };
  recorrer(SRC);
  assert.deepEqual(llamadas, ['lib/recarga.ts'], 'nadie más llama a reloadAsync');
});

(async () => {
  const filtro = process.env.FILTRO ? new RegExp(process.env.FILTRO) : null;
  for (const [nombre, f] of pruebas) {
    if (filtro && !filtro.test(nombre)) continue;
    n += 1;
    try {
      await f();
      console.log(`  ok  ${nombre}`);
    } catch (e) {
      fallos += 1;
      console.log(`  FALLA  ${nombre}\n        ${(e && e.stack) || e}`);
    }
  }
  console.log(`\n${n - fallos}/${n} pruebas de la recarga`);
  process.exit(fallos ? 1 : 0);
})();
