/**
 * Pruebas en Node de la VOZ EN STREAMING (modules/aura-voz + lib/sonidoVivo.ts + lib/vozNativa.ts), sin teléfono.
 * docs/adr/ADR-voz-en-streaming.md. Como pruebas/camara/nativa.prueba.mjs:
 *
 *  · lo puro: qué camino toma la voz, lo que llega del nativo revisado, la boca por el volumen real, la posición por
 *    los bytes que sonaron, cuándo un fallo apaga el camino nuevo, el interruptor remoto;
 *  · SonidoVivo y la central con un puente simulado: los avisos del nativo → estados como los de expo-av, encadenar,
 *    el respaldo por el camino de siempre si falla antes de sonar, cancelar;
 *  · los CONTRATOS DEL PUENTE leídos del código: lo que Kotlin manda (nombres de eventos y campos) es lo que JS lee;
 *    las cabeceras y la ruta del servidor son las que el nativo pide; los atributos de audio; el autolinking (mismo
 *    molde que aura-mic y aura-camara); el manifiesto no pide nada que comprobar-apk rechace; la versión de la app.
 *
 * El reproductor en sí (Reproductor.kt) corre en la JVM con un AudioTrack de mentira: pruebas/voz/jvm/correr.sh.
 * Con el código real de la mesa (tts.ts) y el nativo simulado: pruebas/oido/vozvivo.cjs.
 *
 *   cd mobile && npx tsx pruebas/voz/nativa.prueba.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TEXTOS_GUARDIA_VOZ,
  VOZ_VIVO,
  bytesDeMs,
  cabecerasVoz,
  configVozValida,
  elegirVoz,
  eventoVozValido,
  falloDeSesion,
  msDeBytes,
  nivelDeRms,
} from '../../src/lib/vozNativa.ts';
import { CentralVoz } from '../../src/lib/sonidoVivo.ts';
import { GUARDIA, guardiaAlArrancar, guardiaAlMontar, guardiaBloqueada } from '../../src/lib/camaraNativa.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MOVIL = path.resolve(AQUI, '../..');
const RAIZ = path.resolve(MOVIL, '..');
const leer = (f) => fs.readFileSync(path.join(MOVIL, f), 'utf8');
const leerRaiz = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const KT = 'modules/aura-voz/android/src/main/java/expo/modules/auravoz';

let fallos = 0;
let n = 0;
const pruebas = [];
const prueba = (nombre, f) => pruebas.push([nombre, f]);
const espera = () => new Promise((r) => setImmediate(r));

/** Un puente nativo simulado: anota lo que JS le pide y deja mandar avisos a mano. */
function puente(o = {}) {
  const llamadas = [];
  const oyentes = new Set();
  return {
    llamadas,
    avisar: (e) => [...oyentes].forEach((f) => f(e)),
    disponible: () => true,
    version: () => 1,
    encolar(id, url, cabeceras, opciones) {
      llamadas.push(['encolar', id, url, cabeceras, opciones]);
      if (o.lanza) throw new Error('puente roto');
      return o.acepta ?? true;
    },
    soltar: (id) => llamadas.push(['soltar', id]),
    cancelar: (id) => llamadas.push(['cancelar', id]),
    parar: () => llamadas.push(['parar']),
    addListener(ev, cb) {
      oyentes.add(cb);
      return { remove: () => oyentes.delete(cb) };
    },
  };
}

/** Un sonido de expo-av simulado (el respaldo). */
function sonidoArchivo() {
  const s = {
    cb: null,
    tocado: false,
    soltado: false,
    setOnPlaybackStatusUpdate: (cb) => (s.cb = cb),
    playAsync: async () => {
      s.tocado = true;
      s.cb?.({ isLoaded: true, isPlaying: true, positionMillis: 0, durationMillis: 900 });
    },
    stopAsync: async () => {},
    unloadAsync: async () => (s.soltado = true),
  };
  return s;
}

function crear(o = {}) {
  const m = puente(o.puente);
  const c = new CentralVoz(m);
  const r = { fallos: [], listos: 0, sonados: 0, respaldos: 0, estados: [] };
  const respaldo = 'respaldo' in o ? o.respaldo : sonidoArchivo();
  const s = c.crear({
    url: 'https://x/api/tts/pcm?text=hola',
    cabeceras: { Accept: 'audio/pcm', 'x-ultron-sesion': 'tok' },
    respaldo: async () => {
      r.respaldos++;
      return respaldo;
    },
    alFallar: (f) => r.fallos.push(f),
    alListo: () => r.listos++,
    alSonar: () => r.sonados++,
  });
  s?.setOnPlaybackStatusUpdate((st) => r.estados.push(st));
  return { m, c, s, r, respaldo, id: s?.id };
}

/* ── lo puro ─────────────────────────────────────────────────────────────────────────────── */

prueba('bytes ↔ ms del PCM de 16 bits mono: la posición sale de lo que SONÓ', () => {
  assert.equal(bytesDeMs(150, 22050), 6616, '150 ms a 22 050 Hz: 3308 muestras');
  assert.equal(bytesDeMs(1000, 16000), 32000);
  assert.equal(msDeBytes(44100, 22050), 1000);
  assert.equal(msDeBytes(44101, 22050), 1000, 'el byte suelto de una muestra a medias no cuenta');
  assert.equal(msDeBytes(0, 22050), 0);
  assert.equal(msDeBytes(100, 0), 0);
  assert.equal(VOZ_VIVO.prebufferMs, 150);
});

prueba('la boca por el volumen real: silencio cerrada, voz plena abierta, en medio proporcional', () => {
  assert.equal(nivelDeRms(0), 0);
  assert.equal(nivelDeRms(-1), 0);
  assert.equal(nivelDeRms(NaN), 0);
  assert.equal(nivelDeRms(10 ** (-50 / 20)), 0, '−50 dBFS: cerrada');
  assert.equal(nivelDeRms(1), 1);
  assert.ok(Math.abs(nivelDeRms(10 ** (-12 / 20)) - 1) < 1e-9, '−12 dBFS: abierta');
  const voz = nivelDeRms(0.1);
  assert.ok(voz > 0.7 && voz < 0.85, `−20 dBFS (la voz de ElevenLabs): ~3/4 (${voz})`);
  assert.ok(nivelDeRms(0.01) < voz, 'más bajo, menos abierta');
});

prueba('eventoVozValido: lo que manda el nativo, revisado; basura → null', () => {
  assert.equal(eventoVozValido(null), null);
  assert.equal(eventoVozValido({ tipo: 'sonando' }), null, 'sin id');
  assert.equal(eventoVozValido({ tipo: 'raro', id: 'a' }), null);
  assert.equal(eventoVozValido({ tipo: 'sonando', id: 'x'.repeat(81) }), null);
  assert.deepEqual(eventoVozValido({ tipo: 'listo', id: 'a', hz: 22050 }), { tipo: 'listo', id: 'a', hz: 22050 });
  assert.equal(eventoVozValido({ tipo: 'listo', id: 'a', hz: 3 }), null);
  assert.deepEqual(eventoVozValido({ tipo: 'posicion', id: 'a', ms: 120, nivel: 0.2 }), { tipo: 'posicion', id: 'a', ms: 120, nivel: 0.2 });
  assert.deepEqual(eventoVozValido({ tipo: 'posicion', id: 'a', ms: 120, nivel: 9 }), { tipo: 'posicion', id: 'a', ms: 120, nivel: 0 }, 'volumen fuera de rango: 0');
  assert.equal(eventoVozValido({ tipo: 'posicion', id: 'a', ms: -5 }), null);
  assert.deepEqual(eventoVozValido({ tipo: 'termino', id: 'a', ms: 900, truncada: true, cortada: false }), { tipo: 'termino', id: 'a', ms: 900, truncada: true });
  assert.deepEqual(eventoVozValido({ tipo: 'error', id: 'a', codigo: 'http', status: 503, motivo: 'm' }), { tipo: 'error', id: 'a', codigo: 'http', status: 503, motivo: 'm' });
  assert.deepEqual(eventoVozValido({ tipo: 'error', id: 'a', codigo: '???', status: 0 }), { tipo: 'error', id: 'a', codigo: 'interno', motivo: 'interno' }, 'código desconocido: interno; status 0 no va');
  assert.equal(eventoVozValido({ tipo: 'error', id: 'a', codigo: 'vacio', status: 200, motivo: 'llegó sin audio' }).codigo, 'vacio');
  // Una APK de antes (sin «vacio») con este JS por aire: la frase sin audio llega como «formato» con su motivo.
  assert.equal(eventoVozValido({ tipo: 'error', id: 'a', codigo: 'formato', status: 200, motivo: 'llegó sin audio' }).codigo, 'vacio', 'el nativo viejo');
  assert.equal(eventoVozValido({ tipo: 'error', id: 'a', codigo: 'formato', status: 200, motivo: 'no es PCM (text/html, 0 Hz)' }).codigo, 'formato', 'sin PCM sigue siendo formato');
});

prueba('qué camino: el nuevo solo con todo a favor; si no, el de siempre y el motivo', () => {
  const base = { android: true, modulo: true, decidido: true, bloqueada: false };
  assert.deepEqual(elegirVoz(base), { usar: 'vivo', motivo: 'vivo' });
  assert.deepEqual(elegirVoz({ ...base, ajuste: undefined, remoto: undefined }), { usar: 'vivo', motivo: 'vivo' }, 'sin elegir: encendida');
  assert.equal(elegirVoz({ ...base, android: false }).motivo, 'no-android');
  assert.equal(elegirVoz({ ...base, modulo: false }).motivo, 'sin-modulo', 'APK vieja con este JS por OTA');
  assert.equal(elegirVoz({ ...base, decidido: false }).motivo, 'sin-decidir', 'hasta leer lo guardado, la de siempre');
  assert.equal(elegirVoz({ ...base, remoto: false }).motivo, 'remoto', 'AURA_VOZ_STREAM=0');
  assert.equal(elegirVoz({ ...base, ajuste: false }).motivo, 'ajuste');
  assert.equal(elegirVoz({ ...base, bloqueada: true }).motivo, 'bloqueada');
  assert.equal(elegirVoz({ ...base, falloEnSesion: true }).motivo, 'fallo');
});

prueba('cuándo un fallo apaga el camino nuevo en la sesión', () => {
  for (const codigo of ['pista', 'interno', 'puente', 'formato']) assert.equal(falloDeSesion({ codigo }, 1), true, codigo);
  assert.equal(falloDeSesion({ codigo: 'http', status: 404 }, 1), true, 'servidor viejo sin la ruta');
  assert.equal(falloDeSesion({ codigo: 'http', status: 401 }, 1), true);
  assert.equal(falloDeSesion({ codigo: 'http', status: 503 }, 1), false, 'un 503 suelto: solo esa frase');
  assert.equal(falloDeSesion({ codigo: 'red' }, 1), false, 'una caída de red: solo esa frase');
  assert.equal(falloDeSesion({ codigo: 'red' }, 2), true, 'dos seguidas: apagado');
  // Revisión independiente (MENOR 4): una frase que llegó sin audio apagaba el camino nuevo hasta reabrir la app.
  assert.equal(falloDeSesion({ codigo: 'vacio', status: 200 }, 1), false, 'llegó sin audio: solo esa frase');
  assert.equal(falloDeSesion(eventoVozValido({ tipo: 'error', id: 'a', codigo: 'formato', status: 200, motivo: 'llegó sin audio' }), 1), false, 'tampoco con el nativo viejo');
  assert.equal(falloDeSesion({ codigo: 'vacio' }, 2), true, 'dos seguidas sí: algo anda mal');
});

prueba('el interruptor remoto y las cabeceras', () => {
  assert.deepEqual(configVozValida({ vozStream: { activa: false }, camaraRapida: { activa: true } }), { activa: false });
  assert.deepEqual(configVozValida({ camaraRapida: { activa: false } }), { activa: true });
  assert.deepEqual(configVozValida(undefined), { activa: true });
  assert.deepEqual(cabecerasVoz({ 'x-ultron-sesion': 'abc', malo: 'a\nb', 'con espacio': 'x', numero: 5 }), { Accept: 'audio/pcm', 'x-ultron-sesion': 'abc' });
});

prueba('la guardia contra cierres vale para la voz con sus palabras (la de la cámara no cambia)', () => {
  const caida = { murio: true, motivoAndroid: 'crash-nativo' };
  let r = guardiaAlArrancar(guardiaAlMontar({ v: GUARDIA.version }, 1000), 2000, caida, TEXTOS_GUARDIA_VOZ);
  assert.ok(!guardiaBloqueada(r.estado, 2001), 'una caída sola no la apaga en el teléfono');
  assert.equal(r.soloSesion, true);
  assert.match(r.aviso, /^voz en vivo: la app se cerró arrancándola \(Android: crash-nativo; 1 aviso\); en esta sesión va por la de siempre/);
  r = guardiaAlArrancar(guardiaAlMontar(r.estado, 3000), 4000, caida, TEXTOS_GUARDIA_VOZ);
  assert.ok(guardiaBloqueada(r.estado, 4001));
  assert.match(r.aviso, /^voz en vivo: la app se cerró 2 veces con ella \(la última arrancándola, Android: crash-nativo\); la apago 1 hora en este teléfono/);
  assert.equal(r.estado.motivo, 'se cerró 2 veces (la última al arrancar la voz en vivo)');
  const cam = guardiaAlArrancar(guardiaAlMontar({ v: GUARDIA.version }, 1000), 2000, caida);
  assert.match(cam.aviso, /^cámara nueva: la app se cerró montándola/);
});

prueba('la guardia de la voz (José, 7-oct 00:30): la app se cerró a los 13 s con una OTA recién bajada, sin crash → NO la apaga', () => {
  // Lo que había en el teléfono: la marca «arrancando» puesta por el JS de antes de la OTA.
  const marca = guardiaAlMontar({ v: GUARDIA.version }, 1_000, 'ota-de-antes');
  for (const s of [
    { murio: true, bundle: 'ota-nueva' }, // la OTA se aplicó al reabrir
    { murio: true, motivoAndroid: 'otro', bundle: 'ota-de-antes' }, // deslizada en recientes
    { murio: true, motivoAndroid: 'la-persona' },
    { murio: false }, // segundo plano o recarga intencional de la OTA
    { murio: null }, // reporte.ts no alcanzó a leer: no se acusa
  ]) {
    const r = guardiaAlArrancar(marca, 14_000, s, TEXTOS_GUARDIA_VOZ);
    assert.ok(!guardiaBloqueada(r.estado, 14_001) && !r.soloSesion && !r.aviso, JSON.stringify(s));
  }
  // Y el apagado de 7 días que ya quedó (guardia anterior, sin versión) se borra con esta OTA, avisando.
  const quedado = { bloqueadaHasta: Date.UTC(2026, 9, 14, 0, 30), motivo: 'se cerró al arrancar la voz en vivo' };
  const r = guardiaAlArrancar(quedado, Date.UTC(2026, 9, 7, 12), true, TEXTOS_GUARDIA_VOZ);
  assert.ok(!guardiaBloqueada(r.estado, Date.UTC(2026, 9, 7, 12, 1)));
  assert.match(r.aviso, /^voz en vivo: quito el apagado que dejó la guardia anterior/);
});

/* ── SonidoVivo y la central con un puente simulado ──────────────────────────────────────── */

prueba('encolar: con `esperar` y el prebúfer; playAsync la suelta; los avisos son estados como los de expo-av', async () => {
  const { m, s, r, id } = crear();
  const [, , url, cab, op] = m.llamadas[0];
  assert.equal(url, 'https://x/api/tts/pcm?text=hola');
  assert.equal(cab['x-ultron-sesion'], 'tok');
  assert.deepEqual(op, { esperar: true, prebufferMs: 150 });
  m.avisar({ tipo: 'listo', id, hz: 22050 });
  assert.equal(r.listos, 1);
  m.avisar({ tipo: 'sonando', id });
  assert.equal(r.estados.length, 0, 'sin playAsync no se avisa (todavía no la pidieron)');
  await s.playAsync();
  assert.deepEqual(m.llamadas.at(-1), ['soltar', id]);
  assert.deepEqual(r.estados[0], { isLoaded: true, isPlaying: true, positionMillis: 0 }, 'lo que ya pasó se cuenta al pedirla');
  assert.equal(r.sonados, 1);
  m.avisar({ tipo: 'bajado', id, ms: 900 });
  m.avisar({ tipo: 'posicion', id, ms: 300, nivel: 0.1 });
  assert.deepEqual(r.estados.at(-1), { isLoaded: true, isPlaying: true, positionMillis: 300, durationMillis: 900 });
  assert.equal(s.nivelBoca(), nivelDeRms(0.1));
  m.avisar({ tipo: 'termino', id, ms: 900 });
  assert.deepEqual(r.estados.at(-1), { isLoaded: true, isPlaying: false, positionMillis: 900, durationMillis: 900, didJustFinish: true });
  assert.equal(s.nivelBoca(), null, 'terminada: la boca no sigue al nativo');
  await s.unloadAsync();
  assert.ok(!m.llamadas.some((l) => l[0] === 'cancelar'), 'terminada: no hace falta cancelarla');
});

prueba('encadenar: sonó detrás de otra ANTES de que la mesa llegue a ella; al pedirla se cuenta todo en orden', async () => {
  const { m, s, r, id } = crear();
  let detras = 0;
  s.cuandoSuene(() => detras++);
  s.encadenar();
  s.encadenar();
  assert.equal(m.llamadas.filter((l) => l[0] === 'soltar').length, 1, 'una sola vez');
  m.avisar({ tipo: 'sonando', id });
  assert.equal(detras, 1, 'cuandoSuene corre al sonar por el nativo');
  m.avisar({ tipo: 'termino', id, ms: 20 });
  await s.playAsync();
  assert.deepEqual(
    r.estados.map((e) => [e.isPlaying, !!e.didJustFinish]),
    [
      [true, false],
      [false, true],
    ]
  );
  assert.equal(m.llamadas.filter((l) => l[0] === 'soltar').length, 1, 'playAsync no la suelta otra vez');
});

prueba('falla ANTES de sonar (ya pedida): la misma frase por el camino de siempre, con sus avisos; nada se pierde', async () => {
  const { m, s, r, id, respaldo } = crear();
  let detras = 0;
  s.cuandoSuene(() => detras++);
  await s.playAsync();
  m.avisar({ tipo: 'error', id, codigo: 'red', motivo: 'sin red' });
  await espera();
  await espera();
  assert.deepEqual(r.fallos, [{ codigo: 'red', status: undefined, motivo: 'sin red' }]);
  assert.equal(r.respaldos, 1);
  assert.ok(respaldo.tocado, 'el respaldo suena');
  assert.deepEqual(r.estados.at(-1), { isLoaded: true, isPlaying: true, positionMillis: 0, durationMillis: 900 }, 'sus avisos llegan como si fueran de ella');
  assert.equal(r.listos, 1, '«bajado» para la traza: el respaldo bajó');
  assert.equal(s.enRespaldo, true);
  assert.equal(s.nivelBoca(), null, 'en respaldo, la boca va con la envolvente de siempre');
  assert.equal(detras, 0, 'lo encadenado detrás NO se suelta (no se pisan)');
  m.avisar({ tipo: 'sonando', id });
  assert.equal(r.estados.length, 1, 'un aviso tardío del nativo ya no cuenta');
  await s.unloadAsync();
  assert.ok(respaldo.soltado);
  assert.ok(!m.llamadas.some((l) => l[0] === 'cancelar'), 'el nativo ya la soltó: no se le cancela');
});

prueba('falla antes de pedirla: el respaldo se baja YA y suena al pedirla; encadenar no hace nada', async () => {
  const { m, s, r, id, respaldo } = crear();
  m.avisar({ tipo: 'error', id, codigo: 'http', status: 503, motivo: '503' });
  await espera();
  assert.equal(r.respaldos, 1, 'se pide en el acto');
  assert.ok(!respaldo.tocado, 'pero no suena hasta que la pidan');
  s.encadenar();
  assert.ok(!m.llamadas.some((l) => l[0] === 'soltar'));
  await s.playAsync();
  await espera();
  assert.ok(respaldo.tocado);
});

prueba('sin respaldo posible (el servidor tampoco da voz): un aviso de error y playPrepared termina', async () => {
  const { m, s, r, id } = crear({ respaldo: null });
  await s.playAsync();
  m.avisar({ tipo: 'error', id, codigo: 'red', motivo: 'x' });
  await espera();
  await espera();
  assert.deepEqual(r.estados.at(-1), { isLoaded: false, error: 'sin voz' });
});

prueba('cancelar (stop/unload): el nativo la suelta y nada más se avisa; dos veces, una', async () => {
  const { m, s, r, id } = crear();
  await s.playAsync();
  m.avisar({ tipo: 'sonando', id });
  await s.stopAsync();
  await s.unloadAsync();
  assert.equal(m.llamadas.filter((l) => l[0] === 'cancelar').length, 1);
  const antes = r.estados.length;
  m.avisar({ tipo: 'posicion', id, ms: 100, nivel: 0.2 });
  m.avisar({ tipo: 'termino', id, ms: 100 });
  assert.equal(r.estados.length, antes);
});

prueba('la central: avisos de otra frase o basura se ignoran; parar() calla todo; si el puente lanza o no acepta, null', async () => {
  const a = crear();
  a.m.avisar({ tipo: 'sonando', id: 'otra' });
  a.m.avisar({ tipo: 'sonando' });
  a.m.avisar('basura');
  await a.s.playAsync();
  assert.equal(a.r.estados.length, 0);
  assert.equal(a.c.vivas, 1);
  a.c.parar();
  assert.deepEqual(a.m.llamadas.at(-1), ['parar']);
  assert.equal(a.c.vivas, 0);
  a.m.avisar({ tipo: 'sonando', id: a.id });
  assert.equal(a.r.estados.length, 0, 'después de parar no avisa');
  const b = crear({ puente: { lanza: true } });
  assert.equal(b.s, null);
  assert.equal(b.r.fallos[0].codigo, 'puente');
  const c = crear({ puente: { acepta: false } });
  assert.equal(c.s, null);
  assert.equal(c.r.fallos[0].codigo, 'puente');
});

/* ── contratos del puente, leídos del código ─────────────────────────────────────────────── */

prueba('el módulo: nombre, evento y funciones que lib/auraVoz.ts usa', () => {
  const mod = leer(`${KT}/AuraVozModule.kt`);
  assert.match(mod, /Name\("AuraVoz"\)/);
  assert.match(mod, /Events\("onVoz"\)/);
  for (const f of ['disponible', 'version', 'encolar', 'soltar', 'cancelar', 'parar']) assert.match(mod, new RegExp(`Function\\("${f}"\\)`), f);
  assert.match(mod, /opciones\?\.get\("esperar"\) == true/);
  assert.match(mod, /opciones\?\.get\("prebufferMs"\)/);
  assert.match(mod, /\?: 150\b/, 'el prebúfer por omisión es el de VOZ_VIVO');
  assert.match(mod, /OnDestroy/);
  const js = leer('src/lib/auraVoz.ts');
  assert.match(js, /requireOptionalNativeModule<ModuloVoz>\('AuraVoz'\)/, 'sin el módulo (APK vieja): null, nada se rompe');
  assert.match(js, /addListener\(evento: 'onVoz'/);
});

prueba('los avisos: cada tipo y campo que manda Kotlin es uno que eventoVozValido acepta (y viceversa)', () => {
  const kt = leer(`${KT}/Reproductor.kt`);
  const tipos = [...kt.matchAll(/"tipo" to "([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tipos)].sort(), ['bajado', 'error', 'listo', 'posicion', 'sonando', 'termino']);
  for (const t of new Set(tipos)) assert.ok(eventoVozValido({ tipo: t, id: 'a', ms: 1, hz: 22050, nivel: 0, codigo: 'red', motivo: 'm' }), t);
  const campos = new Set([...kt.matchAll(/"([a-z]+)" to /g)].map((m) => m[1]));
  assert.deepEqual([...campos].sort(), ['codigo', 'cortada', 'hz', 'id', 'motivo', 'ms', 'nivel', 'status', 'tipo', 'truncada']);
  const codigos = new Set([...kt.matchAll(/"codigo" to "([a-z]+)"/g)].map((m) => m[1]));
  for (const c of ['pista']) assert.ok(codigos.has(c));
  for (const c of [...kt.matchAll(/falloAntes\(f, "([a-z]+)"/g)].map((m) => m[1])) assert.ok(['red', 'http', 'formato', 'vacio'].includes(c), c);
  assert.match(kt, /falloAntes\(f, "vacio", "llegó sin audio"/, 'la frase sin audio es «vacio», no «formato»');
});

prueba('lo que el nativo pide es lo que el servidor da: ruta, tipo, cabecera de frecuencia', () => {
  const kt = leer(`${KT}/Reproductor.kt`);
  const srv = leerRaiz('server/voz-pcm.ts');
  const voz = leerRaiz('server/voz.ts');
  assert.match(kt, /getHeaderField\("X-Ultron-Pcm-Hz"\)/);
  assert.match(srv, /res\.setHeader\('X-Ultron-Pcm-Hz', String\(voz\.hz\)\)/);
  assert.match(kt, /tipo\.startsWith\("audio\/pcm"\)/);
  assert.match(voz, /export const TIPO_PCM = 'audio\/pcm';/);
  assert.match(srv, /export const RUTA_VOZ_PCM = '\/api\/tts\/pcm';/);
  assert.match(leer('src/lib/api.ts'), /return `\$\{API_BASE\}\/api\/tts\/pcm\?\$\{q\.toString\(\)\}`;/);
  assert.match(kt, /c\.requestMethod = "GET"/, 'GET: la URL lleva el texto (lo privado no va por aquí)');
  assert.match(srv, /romperSiFalla: true/, 'cortada a media frase: conexión rota → «truncada», no un final limpio');
});

prueba('la pista: MODE_STREAM, escrituras sin bloquear, USAGE_MEDIA + SPEECH (el mismo flujo que expo-av: el eco del oído Turbo la ve igual)', () => {
  const kt = leer(`${KT}/Reproductor.kt`);
  assert.match(kt, /setTransferMode\(AudioTrack\.MODE_STREAM\)/);
  assert.match(kt, /AudioTrack\.WRITE_NON_BLOCKING/);
  assert.doesNotMatch(kt, /WRITE_BLOCKING/, 'nunca una escritura que pueda trabar un corte');
  assert.match(kt, /setUsage\(AudioAttributes\.USAGE_MEDIA\)\.setContentType\(AudioAttributes\.CONTENT_TYPE_SPEECH\)/);
  assert.doesNotMatch(kt, /USAGE_VOICE_COMMUNICATION\)/, 'no cambia la ruta de salida (auricular de llamada)');
  assert.match(kt, /p\.pause\(\)\s*\n\s*p\.flush\(\)/, 'callar ya: pausa + vaciar');
  assert.match(kt, /setStartThresholdInFrames/, 'Android 12+: arranca con el prebúfer');
  const mic = leer('modules/aura-mic/android/src/main/java/expo/modules/auramic/AuraMicModule.kt');
  assert.match(mic, /VOICE_COMMUNICATION/, 'el oído con eco sigue igual (no se tocó)');
});

prueba('autolinking: el mismo molde que aura-mic y aura-camara (expo-module.config, build.gradle, manifiesto)', () => {
  const cfg = JSON.parse(leer('modules/aura-voz/expo-module.config.json'));
  assert.deepEqual(cfg, { platforms: ['android'], android: { modules: ['expo.modules.auravoz.AuraVozModule'] } });
  for (const otro of ['aura-mic', 'aura-camara']) {
    const o = JSON.parse(leer(`modules/${otro}/expo-module.config.json`));
    assert.deepEqual(Object.keys(o).sort(), Object.keys(cfg).sort(), otro);
    assert.deepEqual(o.platforms, ['android']);
  }
  const gradle = leer('modules/aura-voz/android/build.gradle');
  assert.match(gradle, /id 'expo-module-gradle-plugin'/);
  assert.match(gradle, /namespace "expo\.modules\.auravoz"/);
  assert.doesNotMatch(gradle, /implementation /, 'sin dependencias nuevas en la APK');
  assert.ok(fs.existsSync(path.join(MOVIL, `${KT}/AuraVozModule.kt`)));
  assert.match(leer(`${KT}/AuraVozModule.kt`), /^package expo\.modules\.auravoz/);
  // Expo enlaza solo lo de modules/ (nativeModulesDir por omisión): ni plugin ni lista que lo deje fuera.
  const pkg = JSON.parse(leer('package.json'));
  assert.equal(pkg.expo?.autolinking?.nativeModulesDir, undefined, 'modules/ por omisión');
  assert.equal(pkg.expo?.autolinking?.exclude?.includes?.('aura-voz'), undefined);
  assert.doesNotMatch(leer('react-native.config.js'), /aura-voz/, 'react-native.config no lo saca');
  const app = JSON.parse(leer('app.json'));
  assert.ok(!JSON.stringify(app.expo.plugins).includes('aura-mic') && !JSON.stringify(app.expo.plugins).includes('aura-camara'), 'los otros no llevan plugin: este tampoco');
});

prueba('el manifiesto no pide nada que comprobar-apk rechace (ubicación) ni nada que la app no tenga ya', () => {
  const man = leer('modules/aura-voz/android/src/main/AndroidManifest.xml');
  assert.doesNotMatch(man, /LOCATION/);
  const permisos = [...man.matchAll(/android:name="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(permisos, ['android.permission.INTERNET']);
  const app = JSON.parse(leer('app.json'));
  for (const p of permisos) assert.ok(app.expo.android.permissions.includes(p), `${p} ya está en app.json`);
  const qa = leerRaiz('scripts/qa/comprobar-apk.mjs');
  assert.match(qa, /permission\\\.ACCESS_\(FINE\|COARSE\)_LOCATION/, 'lo único de permisos que mira comprobar-apk');
});

prueba('la mesa: tts.ts usa el camino nuevo con sus guardas y stopSpeaking calla al nativo', () => {
  const tts = leer('src/lib/tts.ts');
  assert.match(tts, /return vivoPermitido && !falloVivo && perf === 'speak' && !privado && !suspendida && !callaPorConversacion && !!centralVoz\(\);/);
  assert.match(tts, /if \(central\) central\.parar\(\);/);
  assert.match(tts, /const vivoOk = !opts\?\.hastaQue;/, 'el relleno, por el camino de siempre');
  assert.match(tts, /if \(esVivo\(source\)\) return prepararVivo\(source\.vivo\);/);
  assert.match(tts, /const fs = \[\.\.\.this\.fs\]\.reverse\(\);/, 'cancelar: lo encadenado detrás antes que lo que suena');
  const g = leer('src/lib/guardiaVoz.ts');
  assert.match(g, /const inicio = guardiaAlArrancar\(previa, Date\.now\(\), await salidaAnterior\(previa\), TEXTOS_GUARDIA_VOZ\);/);
  assert.match(g, /bloqueada: soloSesion \|\| guardiaBloqueada\(guardia, Date\.now\(\)\)/, 'un golpe: la de siempre en esta sesión');
  assert.match(g, /guardiaAlMontar\(guardia, Date\.now\(\), bundleActual\(\)\)/, 'la marca dice qué JS la puso (una OTA no se culpa)');
  assert.match(g, /api<unknown>\('\/api\/movil\/config'/);
  assert.match(leer('src/app/AppAura.tsx'), /void prepararVoz\(\);/);
  assert.match(leer('src/ajustes/Ajustes.tsx'), /<FilaVozEnVivo \/>/);
  assert.match(leerRaiz('server/movil-config.ts'), /vozStream: \{ activa: !apagado\(env\.AURA_VOZ_STREAM\) \}/);
});

// El módulo nativo de la voz entró con la 5.5.0 (versionCode 54). La versión se LEE de app.json (antes estaba fijada y
// la prueba fallaba con cada APK nueva, 5.6.0/55 incluida): lo que se exige es que no baje de ahí y que sea coherente.
prueba('la versión: desde la 5.5.0 (entró un módulo nativo nuevo), leída de app.json, con su versionCode', () => {
  const app = JSON.parse(leer('app.json'));
  const version = String(app.expo.version || '');
  const codigo = app.expo.android.versionCode;
  assert.match(version, /^\d+\.\d+\.\d+$/, `versión «${version}»`);
  const [ma, mi, pa] = version.split('.').map(Number);
  assert.ok(ma * 1e6 + mi * 1e3 + pa >= 5_005_000, `la versión ${version} es anterior a la 5.5.0 (la del módulo nativo de la voz)`);
  assert.ok(Number.isInteger(codigo) && codigo >= 54, `versionCode ${codigo}: el de la 5.5.0 era 54`);
  // Cada versión menor de la 5 subió un versionCode desde la 5.5.0/54 (5.6.0/55): si se sube una sin la otra, se dice.
  if (ma === 5) assert.equal(codigo, 54 + (mi - 5), `5.${mi}.x va con versionCode ${54 + (mi - 5)}`);
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
