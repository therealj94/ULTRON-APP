// LOS SONIDOS DE TRABAJO con el código real (out/sonidos.cjs, construir.cjs). José, 6-oct (APK 5.5.0): «cuando está
// escribiendo se escucha teclado, y sería bueno que si está haciendo o pensando algo se escucharan cosas como eso del
// teclado, tanto con el avatar como en la llamada». Lo que se prueba es lo que oiría:
//  · la mesa: el murmullo solo si el turno de verdad tarda (lo rápido no lo oye), el sonido de cada herramienta, y que
//    todo se calla en cuanto AU-RA habla (y vuelve si sigue trabajando), en cuanto la persona habla (y ya no vuelve),
//    con la respuesta y a su tope (nada en bucle); el oído sube su umbral mientras suena;
//  · el reproductor: por el canal de efectos (expo-av), bajito, en bucle, cada vez desde otro punto del archivo;
//  · la llamada: el murmullo con su tope más corto;
//  · los interruptores: los efectos, «Sonidos mientras trabaja» y AURA_AMBIENTE=0 (server/movil-config.ts);
//  · los archivos: existen, son mp3 pequeños y suenan (no son silencio);
//  · el contrato: los mismos nombres en el teléfono, su validador del canal de acciones y el servidor;
//  · y del micrófono de la mesa: el silencio con hora (8 h) y la gracia del segundo plano (lib/silencioMesa, lib/appDelante).
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const mundo = require('./shims/mundo.js');
const B = require(process.env.SON || path.join(__dirname, 'out/sonidos.cjs'));

const MOVIL = path.resolve(__dirname, '../..');
const RAIZ = path.resolve(MOVIL, '..');
const SRC = path.resolve(process.env.SRC || path.join(MOVIL, 'src'));

let fallos = 0;
let n = 0;
const pruebas = [];
const prueba = (nombre, f) => pruebas.push([nombre, f]);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Un reloj falso para la mesa: setTimeout/clearTimeout y avanzar. */
function reloj() {
  let ahora = 0;
  const relojes = [];
  return {
    ahora: () => ahora,
    setTimeout: (f, ms) => {
      const r = { en: ahora + ms, f, vivo: true };
      relojes.push(r);
      return r;
    },
    clearTimeout: (h) => h && (h.vivo = false),
    avanzar(ms) {
      const hasta = ahora + ms;
      for (;;) {
        const r = relojes.filter((x) => x.vivo && x.en <= hasta).sort((a, b) => a.en - b.en)[0];
        if (!r) break;
        r.vivo = false;
        ahora = r.en;
        r.f();
      }
      ahora = hasta;
    },
  };
}

/** La mesa de un turno: lo que suena (null = calló), el umbral del oído y las migas. */
function mesa(o = {}) {
  const r = reloj();
  const visto = { sonidos: [], fondo: [], migas: [] };
  let puede = o.puede ?? true;
  const t = new B.TRABAJO.TrabajoMesa({
    avatar: 'aura',
    idioma: 'es',
    memoria: new B.NARRADOR.MemoriaNarrador(),
    puedeHablar: () => false,
    hablar: () => {},
    alLinea: () => {},
    ambiente: { poner: (s) => visto.sonidos.push(s), quitar: () => visto.sonidos.push(null) },
    sonido: () => puede,
    pensando: o.pensando ?? true,
    alFondo: (on) => visto.fondo.push(on),
    miga: (m) => visto.migas.push(m),
    ahora: r.ahora,
    setTimeout: r.setTimeout,
    clearTimeout: r.clearTimeout,
  });
  return { t, visto, r, poderSonar: (v) => (puede = v) };
}

const { PENSANDO_DESDE_MS, MAX_SONIDO_MS, VOLUMEN_SONIDO, DURACION_SONIDO_MS } = B.SONIDOS;

/* ── la mesa ─────────────────────────────────────────────────────────────────────────────────────────────────── */

prueba('mesa: el turno que tarda sin herramienta suena «pensando» a los PENSANDO_DESDE_MS; antes, nada', () => {
  const m = mesa();
  m.r.avanzar(PENSANDO_DESDE_MS - 1);
  assert.deepEqual(m.visto.sonidos, [], 'antes del umbral: silencio');
  m.r.avanzar(1);
  assert.deepEqual(m.visto.sonidos, ['pensando']);
  assert.deepEqual(m.visto.fondo, [true], 'el oído sube su umbral mientras suena');
  m.t.respuesta();
  assert.deepEqual(m.visto.sonidos, ['pensando', null], 'llega la respuesta: se calla');
  assert.deepEqual(m.visto.fondo, [true, false]);
});

prueba('mesa: lo rápido (la respuesta antes del umbral) no oye nada nunca', () => {
  const m = mesa();
  m.r.avanzar(800);
  m.t.respuesta();
  m.r.avanzar(60_000);
  m.t.terminar();
  assert.deepEqual(m.visto.sonidos, []);
  assert.deepEqual(m.visto.fondo, []);
});

prueba('mesa: cada herramienta su sonido (tecleo al buscar o escribir, papel al leer, clics en su computadora) y gana al murmullo', () => {
  const m = mesa();
  m.r.avanzar(PENSANDO_DESDE_MS + 100);
  m.t.evento({ fase: 'empece', herramienta: 'web' });
  m.t.evento({ fase: 'encontre', herramienta: 'web', n: 3 });
  m.t.evento({ fase: 'empece', herramienta: 'leer' });
  m.t.evento({ fase: 'empece', herramienta: 'correo' });
  m.t.evento({ fase: 'empece', herramienta: 'computadora' });
  m.t.terminar();
  // Entre una herramienta y la siguiente (encontró y piensa), el murmullo.
  assert.deepEqual(m.visto.sonidos, ['pensando', 'teclado', 'pensando', 'papel', 'teclado', 'clics', null]);
});

prueba('mesa: AU-RA habla (el relleno, un comentario) → se calla; termina y sigue trabajando → vuelve', () => {
  const m = mesa();
  m.t.evento({ fase: 'empece', herramienta: 'web' });
  assert.deepEqual(m.visto.sonidos, ['teclado']);
  m.t.vozEmpieza();
  assert.deepEqual(m.visto.sonidos, ['teclado', null], 'su voz no va encima del tecleo');
  m.r.avanzar(1_000);
  m.t.vozTermina();
  assert.deepEqual(m.visto.sonidos, ['teclado', null, 'teclado'], 'sigue buscando: vuelve');
  assert.ok(m.visto.migas.includes('trabajo: fuera (habla)'), m.visto.migas.join(' | '));
});

prueba('mesa: la persona habla → se calla y ya no vuelve en ese turno (ni con otra herramienta ni pensando)', () => {
  const m = mesa();
  m.r.avanzar(PENSANDO_DESDE_MS);
  m.t.personaHabla();
  m.t.evento({ fase: 'empece', herramienta: 'web' });
  m.r.avanzar(10_000);
  m.t.vozTermina();
  assert.deepEqual(m.visto.sonidos, ['pensando', null]);
  assert.ok(m.visto.migas.includes('trabajo: fuera (persona)'));
});

prueba('mesa: nada en bucle: «pensando» calla a los MAX_SONIDO_MS y no vuelve aunque siga pensando; el tecleo, a su tope', () => {
  const m = mesa();
  m.r.avanzar(PENSANDO_DESDE_MS + MAX_SONIDO_MS.pensando + 5_000);
  assert.deepEqual(m.visto.sonidos, ['pensando', null]);
  assert.ok(m.visto.migas.includes('trabajo: fuera (tope)'));
  // Su tope cuenta aunque se corte y vuelva: hablar no le da otros 12 s.
  const k = mesa();
  k.r.avanzar(PENSANDO_DESDE_MS + 8_000);
  k.t.vozEmpieza();
  k.r.avanzar(2_000);
  k.t.vozTermina();
  k.r.avanzar(MAX_SONIDO_MS.pensando);
  assert.deepEqual(k.visto.sonidos, ['pensando', null, 'pensando', null]);
  // Una herramienta nueva sí suena (es otra cosa que de verdad pasa), con su propio tope.
  const w = mesa();
  w.r.avanzar(PENSANDO_DESDE_MS + MAX_SONIDO_MS.pensando);
  w.t.evento({ fase: 'empece', herramienta: 'web' });
  w.r.avanzar(MAX_SONIDO_MS.teclado + 1);
  assert.deepEqual(w.visto.sonidos, ['pensando', null, 'teclado', null]);
});

prueba('mesa: sin permiso de sonar (sonido() false: efectos, ajuste, servidor o un oído sin cancelador), nada; al volver a poder, revisar()', () => {
  const m = mesa({ puede: false });
  m.r.avanzar(PENSANDO_DESDE_MS + 500);
  m.t.evento({ fase: 'empece', herramienta: 'web' });
  assert.deepEqual(m.visto.sonidos, []);
  m.poderSonar(true);
  m.t.revisar();
  assert.deepEqual(m.visto.sonidos, ['teclado']);
  m.poderSonar(false);
  m.t.revisar();
  assert.deepEqual(m.visto.sonidos, ['teclado', null], 'apagados a medio sonar: se van al momento');
});

prueba('mesa: sin `pensando` (otra pantalla), solo las herramientas, como antes', () => {
  const m = mesa({ pensando: false });
  m.r.avanzar(30_000);
  assert.deepEqual(m.visto.sonidos, []);
  m.t.evento({ fase: 'empece', herramienta: 'leer' });
  assert.deepEqual(m.visto.sonidos, ['papel']);
});

prueba('mesa: terminar() lo apaga todo y lo que llegue tarde no hace nada', () => {
  const m = mesa();
  m.t.evento({ fase: 'empece', herramienta: 'web' });
  m.t.terminar();
  m.t.evento({ fase: 'empece', herramienta: 'leer' });
  m.t.vozTermina();
  m.r.avanzar(60_000);
  assert.deepEqual(m.visto.sonidos, ['teclado', null]);
  assert.deepEqual(m.visto.fondo, [true, false]);
});

/* ── el reproductor (canal de efectos) ───────────────────────────────────────────────────────────────────────── */

prueba('reproductor: cada sonido su archivo, en bucle, bajito (el murmullo más) y por expo-av (no por la voz de AU-RA)', async () => {
  mundo.reiniciar();
  for (const s of B.FRASES.SONIDOS_AMBIENTE) await B.REPRODUCTOR.reproductorAmbiente.poner(s);
  B.REPRODUCTOR.reproductorAmbiente.quitar();
  await dormir(0);
  assert.deepEqual(
    mundo.cargas.map((c) => c.archivo),
    B.FRASES.SONIDOS_AMBIENTE.map((s) => `${s}.mp3`)
  );
  for (const c of mundo.cargas) {
    const s = c.archivo.replace('.mp3', '');
    assert.equal(c.opciones.isLooping, true, s);
    assert.equal(c.opciones.shouldPlay, true, s);
    assert.equal(c.opciones.volume, VOLUMEN_SONIDO[s], s);
    assert.ok(c.opciones.volume <= 0.16, `${s} bajito: ${c.opciones.volume}`);
    assert.ok(c.opciones.positionMillis >= 0 && c.opciones.positionMillis < DURACION_SONIDO_MS[s], `${s} empieza dentro del archivo`);
  }
  assert.ok(VOLUMEN_SONIDO.pensando < VOLUMEN_SONIDO.teclado, 'el murmullo, más bajo que el tecleo');
  // Al poner el siguiente, el anterior se para y se descarga (nunca dos a la vez).
  for (const c of mundo.cargas.slice(0, -1)) assert.ok(c.parado && c.descargado, c.archivo);
  assert.ok(mundo.cargas.at(-1).descargado, 'quitar descarga el último');
});

prueba('reproductor: variación — cada vez empieza en otro punto del archivo (dos esperas seguidas no suenan igual)', async () => {
  mundo.reiniciar();
  for (let i = 0; i < 12; i++) await B.REPRODUCTOR.reproductorAmbiente.poner('pensando');
  B.REPRODUCTOR.reproductorAmbiente.quitar();
  const inicios = new Set(mundo.cargas.map((c) => c.opciones.positionMillis));
  assert.ok(inicios.size >= 8, `inicios distintos: ${[...inicios].join(', ')}`);
  assert.equal(B.SONIDOS.inicioVariado('pensando', () => 0), 0);
  assert.ok(B.SONIDOS.inicioVariado('pensando', () => 0.9999) <= DURACION_SONIDO_MS.pensando - 1_000);
});

prueba('reproductor: un sonido que termina de cargar después de quitarlo se descarga solo (no queda sonando)', async () => {
  mundo.reiniciar();
  mundo.demoraCarga = 30;
  const p = B.REPRODUCTOR.reproductorAmbiente.poner('teclado');
  B.REPRODUCTOR.reproductorAmbiente.quitar();
  await p;
  assert.equal(mundo.cargas.length, 1);
  assert.ok(mundo.cargas[0].descargado, 'llegó tarde: descargado');
});

/* ── la llamada ──────────────────────────────────────────────────────────────────────────────────────────────── */

prueba('llamada: el `ambiente` «pensando» del servidor suena y calla a su tope (más corto que el tecleo); la persona lo corta', () => {
  const r = reloj();
  const visto = [];
  const a = new B.AMBIENTE.AmbienteConversacion({
    reproductor: { poner: (s) => visto.push(s), quitar: () => visto.push(null) },
    puede: () => true,
    esperar: (f, ms) => {
      const h = r.setTimeout(f, ms);
      return () => r.clearTimeout(h);
    },
    reloj: r.ahora,
  });
  a.alEvento({ sonido: 'pensando', on: true });
  r.avanzar(MAX_SONIDO_MS.pensando - 1);
  assert.deepEqual(visto, ['pensando']);
  r.avanzar(1);
  assert.deepEqual(visto, ['pensando', null], 'a los 12 s calla aunque el servidor no lo quite');
  a.alEvento({ sonido: 'teclado', on: true });
  r.avanzar(MAX_SONIDO_MS.pensando + 1);
  assert.deepEqual(visto, ['pensando', null, 'teclado'], 'el tecleo de una búsqueda dura más');
  a.parar('persona');
  assert.deepEqual(visto, ['pensando', null, 'teclado', null]);
});

prueba('llamada: mientras la voz del avatar suena (modo «hablando»), el sonido calla debajo y vuelve al terminar si la tarea sigue', () => {
  const r = reloj();
  const visto = [];
  let puede = true;
  const a = new B.AMBIENTE.AmbienteConversacion({
    reproductor: { poner: (s) => visto.push(s), quitar: () => visto.push(null) },
    puede: () => puede,
    esperar: (f, ms) => {
      const h = r.setTimeout(f, ms);
      return () => r.clearTimeout(h);
    },
    reloj: r.ahora,
  });
  // El servidor pone el murmullo a la vez que la frase de espera: con la voz sonando, espera callado.
  a.alHablar(true);
  a.alEvento({ sonido: 'pensando', on: true });
  assert.deepEqual(visto, [], 'no va debajo de su voz');
  assert.equal(a.actual, 'pensando', 'pero la tarea sigue puesta');
  a.alHablar(false);
  assert.deepEqual(visto, ['pensando'], 'calló la frase: ahora sí');
  a.alHablar(true);
  assert.deepEqual(visto, ['pensando', null], 'un avance del narrador: calla');
  a.alHablar(false);
  assert.deepEqual(visto, ['pensando', null, 'pensando'], 'y vuelve');
  // El tope cuenta desde que la tarea empezó, aunque se haya callado a ratos.
  r.avanzar(MAX_SONIDO_MS.pensando);
  assert.deepEqual(visto, ['pensando', null, 'pensando', null]);
  a.alHablar(true);
  a.alHablar(false);
  assert.deepEqual(visto, ['pensando', null, 'pensando', null], 'pasado el tope no vuelve');
  // Apagados mientras hablaba (Ajustes, el servidor): al callar no vuelve, se va.
  a.alEvento({ sonido: 'teclado', on: true });
  a.alHablar(true);
  puede = false;
  a.alHablar(false);
  assert.equal(a.actual, null);
});

prueba('llamada: el validador del canal de acciones conoce «pensando» y «clics» (y lo desconocido es «sin sonido»)', () => {
  assert.deepEqual(B.ACCIONES.ambienteDe({ sonido: 'pensando', on: true }), { sonido: 'pensando', on: true });
  assert.deepEqual(B.ACCIONES.ambienteDe({ sonido: 'clics', on: true }), { sonido: 'clics', on: true });
  assert.deepEqual(B.ACCIONES.ambienteDe({ sonido: 'trompeta', on: true }), { sonido: null, on: false });
  assert.deepEqual(B.FRASES.tareaDe('computadora').sonido, 'clics');
  assert.equal(B.FRASES.sonidoDeEstado('pensando'), 'pensando');
  assert.equal(B.FRASES.sonidoDeEstado('buscando'), 'teclado');
  assert.equal(B.FRASES.sonidoDeEstado('mirando'), null);
});

/* ── los interruptores ───────────────────────────────────────────────────────────────────────────────────────── */

prueba('interruptores: encendidos por omisión; «Sonidos mientras trabaja» apagado, los efectos apagados o AURA_AMBIENTE=0 los callan', async () => {
  mundo.reiniciar();
  await B.AJUSTE.leerAmbiente();
  B.SFX.setSfxEnabled(true);
  assert.equal(B.AJUSTE.ambienteActivo(), true, 'sin elegir: encendidos');
  assert.equal(B.AJUSTE.estadoAmbiente().valor, true);
  let avisos = 0;
  const quitar = B.AJUSTE.suscribirAmbiente(() => avisos++);
  await B.AJUSTE.fijarAmbiente(false);
  assert.equal(B.AJUSTE.ambienteActivo(), false);
  assert.equal(B.AJUSTE.estadoAmbiente().motivo, 'apagados_por_la_persona');
  assert.equal(mundo.disco.get(B.AJUSTE.CLAVE_AJUSTE_AMBIENTE), '0', 'se guarda');
  await B.AJUSTE.fijarAmbiente(true);
  B.SFX.setSfxEnabled(false);
  assert.equal(B.AJUSTE.ambienteActivo(), false, 'sin efectos de sonido, tampoco');
  assert.equal(B.AJUSTE.estadoAmbiente().motivo, 'sin_efectos');
  B.SFX.setSfxEnabled(true);
  mundo.config = { ambiente: { activo: false } };
  await B.AJUSTE.refrescarAmbienteRemoto(true);
  assert.equal(B.AJUSTE.ambienteActivo(), false, 'el servidor los apaga para todos');
  assert.equal(B.AJUSTE.estadoAmbiente().motivo, 'apagados_por_el_servidor');
  assert.ok(avisos >= 3, 'cada cambio avisa (la mesa y la llamada callan al momento)');
  // Sin red o servidor viejo: queda lo último guardado.
  mundo.config = 404;
  await B.AJUSTE.refrescarAmbienteRemoto(true);
  assert.equal(B.AJUSTE.ambienteActivo(), false);
  mundo.config = { ambiente: { activo: true } };
  await B.AJUSTE.refrescarAmbienteRemoto(true);
  assert.equal(B.AJUSTE.ambienteActivo(), true);
  assert.ok(mundo.migas.some((t) => /sonidos de trabajo: el servidor los apaga/.test(t)), mundo.migas.join(' | '));
  quitar();
});

/* ── los archivos ────────────────────────────────────────────────────────────────────────────────────────────── */

prueba('archivos: los cinco existen, son mp3 pequeños; «pensando» y «clics» (sintetizados) duran ~12 s y suenan', () => {
  for (const s of B.FRASES.SONIDOS_AMBIENTE) {
    const f = path.join(MOVIL, 'assets/sfx', `${s}.mp3`);
    assert.ok(fs.existsSync(f), f);
    const b = fs.readFileSync(f);
    assert.ok(b.length > 4_000 && b.length <= 80_000, `${s}: ${b.length} bytes`);
    const id3 = b.slice(0, 3).toString() === 'ID3';
    const sync = b[0] === 0xff && (b[1] & 0xe0) === 0xe0;
    assert.ok(id3 || sync, `${s}: cabecera mp3`);
  }
  // Si hay con qué decodificarlos, se mide: duración y que no sean silencio (el pico: los clics son golpes sueltos).
  const py = spawnSync('python3', ['-I', '-c', 'import soundfile, numpy, sys\nfor f in sys.argv[1:]:\n  x, fs = soundfile.read(f)\n  print(round(len(x)/fs, 2), float(numpy.abs(x).max()))', ...['pensando', 'clics'].map((s) => path.join(MOVIL, 'assets/sfx', `${s}.mp3`))], { encoding: 'utf8' });
  if (py.status !== 0) {
    console.log('      (sin python3+soundfile: no se mide la duración ni el volumen de los archivos)');
    return;
  }
  const filas = py.stdout.trim().split('\n').map((l) => l.split(' ').map(Number));
  for (const [i, s] of ['pensando', 'clics'].entries()) {
    const [dur, pico] = filas[i];
    assert.ok(dur > 10 && dur < 14, `${s}: ${dur} s`);
    assert.ok(Math.abs(dur * 1000 - DURACION_SONIDO_MS[s]) < 400, `${s}: DURACION_SONIDO_MS al día (${dur} s)`);
    assert.ok(pico > 0.2 && pico <= 1, `${s}: suena, sin saturar (pico ${pico})`);
  }
});

/* ── el contrato ─────────────────────────────────────────────────────────────────────────────────────────────── */

prueba('contrato: los mismos nombres en frasesEstado, el validador del teléfono, el tipo del contrato y el servidor', () => {
  const lista = [...B.FRASES.SONIDOS_AMBIENTE].sort();
  assert.deepEqual(lista, ['clics', 'lapiz', 'papel', 'pensando', 'teclado']);
  const servidor = fs.readFileSync(path.join(RAIZ, 'lib/acciones-app.ts'), 'utf8');
  const m = /export const SONIDOS_AMBIENTE = \[([^\]]+)\] as const;/.exec(servidor);
  assert.ok(m, 'lib/acciones-app.ts SONIDOS_AMBIENTE');
  assert.deepEqual(m[1].split(',').map((x) => x.trim().replace(/'/g, '')).sort(), lista);
  const contrato = fs.readFileSync(path.join(SRC, 'nucleo/contrato.ts'), 'utf8');
  const t = /export type SonidoAmbiente = ([^;]+);/.exec(contrato);
  assert.deepEqual(t[1].split('|').map((x) => x.trim().replace(/'/g, '')).sort(), lista);
});

prueba('la mesa (DeskScreen) los pide por señales reales: el turno en curso, la voz, la persona; y solo con un oído que los aguante', () => {
  const d = fs.readFileSync(path.join(SRC, 'screens/DeskScreen.tsx'), 'utf8');
  assert.match(d, /sonido: \(\) => ambienteActivo\(\) && !conversandoRef\.current && !enLlamadaRef\.current && \(micMutedRef\.current \|\| oidoAguantaFondo\(\)\)/);
  assert.match(d, /pensando: true,\s*alFondo: setFondoPropio,/);
  assert.match(d, /trabajoActual\.current\?\.personaHabla\(\);/);
  assert.equal((d.match(/trabajo\?\.vozEmpieza\(\);/g) || []).length, 2, 'el relleno y el narrador');
  assert.equal((d.match(/trabajo\?\.vozTermina\(\);/g) || []).length, 2);
  const v = fs.readFileSync(path.join(SRC, 'compa/VozProvider.tsx'), 'utf8');
  assert.match(v, /AppState\.currentState === 'active' && ambienteActivo\(\);/, 'la llamada con los mismos interruptores');
});

/* ── el micrófono de la mesa (de paso: lo otro que José vivió como «el micrófono falla») ─────────────────────── */

prueba('micrófono: el silencio vale 8 h desde que se puso aunque Android cierre la app; pasado eso abre (y se dice)', () => {
  const { arranqueDelMicrofono, migaArranqueMic, SILENCIO_VIGENCIA_MS } = B.SILENCIO;
  const t = 50_000_000;
  assert.equal(SILENCIO_VIGENCIA_MS, 8 * 3_600_000);
  // La revisión del 6-oct a la 5.6.0: silenciado hace 3 min, Samsung mató la app en segundo plano → volvía ABIERTO.
  assert.deepEqual(arranqueDelMicrofono({ micMuted: true, micMutedEn: t - 3 * 60_000 }, t), { silenciada: true, motivo: 'vigente', desde: t - 3 * 60_000 });
  assert.deepEqual(arranqueDelMicrofono({ micMuted: true, micMutedEn: t - SILENCIO_VIGENCIA_MS }, t), { silenciada: false, motivo: 'otra-sesion' }, 'el de ayer no deja sordo hoy');
  assert.deepEqual(arranqueDelMicrofono({ micMuted: true }, t), { silenciada: false, motivo: 'otra-sesion' }, 'guardado sin hora (de la 5.5.0)');
  assert.deepEqual(arranqueDelMicrofono({ micMuted: false, micMutedEn: t }, t), { silenciada: false, motivo: 'abierto' });
  assert.match(migaArranqueMic({ silenciada: false, motivo: 'otra-sesion' }, t), /abierto/);
  assert.match(migaArranqueMic({ silenciada: true, motivo: 'vigente', desde: t - 3 * 60_000 }, t), /sigue silenciado \(lo silenciaste hace 3 min/);
  assert.equal(migaArranqueMic({ silenciada: false, motivo: 'abierto' }, t), '');
});

prueba('micrófono: un parpadeo de segundo plano (~0,1 s) no suelta el oído; uno de verdad sí, pasada la gracia', () => {
  const r = reloj();
  const cambios = [];
  const migas = [];
  const g = new B.DELANTE.GraciaFondo({ alCambiar: (v) => cambios.push(v), miga: (t) => migas.push(t), ahora: r.ahora, setTimeout: r.setTimeout, clearTimeout: r.clearTimeout });
  g.estado('background');
  r.avanzar(100);
  g.estado('active');
  r.avanzar(5_000);
  assert.deepEqual(cambios, [], 'el parpadeo de las migas del 6-oct (+2.6 s → +2.7 s) ya no suelta nada');
  assert.match(migas[0], /segundo plano breve \(100 ms\)/);
  g.estado('background');
  r.avanzar(B.DELANTE.GRACIA_FONDO_MS);
  assert.deepEqual(cambios, [false], 'de verdad detrás: se suelta');
  g.estado('active');
  assert.deepEqual(cambios, [false, true], 'volver es inmediato');
  g.estado('inactive');
  r.avanzar(5_000);
  assert.deepEqual(cambios, [false, true], '«inactive» no es irse');
});

(async () => {
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
  await dormir(0);
  console.log(`\n${n - fallos}/${n} de los sonidos de trabajo bien`);
  process.exit(fallos ? 1 : 0);
})();
