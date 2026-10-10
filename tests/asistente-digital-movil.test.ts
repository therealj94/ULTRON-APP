/**
 * AU-RA COMO ASISTENTE DIGITAL (Fase 1: el botón lateral del S26 de José, la burbuja encima de cualquier app, el mosaico
 * de Ajustes rápidos y el atajo del ícono).
 *
 *  · El plugin (mobile/plugins/asistente-digital.js) corrido de verdad sobre un manifiesto y una carpeta android/ de
 *    mentira: el VoiceInteractionService con BIND_VOICE_INTERACTION y su XML, la sesión, el reconocedor, la burbuja
 *    translúcida con ASSIST y VOICE_COMMAND (sin showWhenLocked), el mosaico y el atajo; el Kotlin y los recursos
 *    copiados con el paquete y el esquema de la app.
 *  · Solo AU-RA: app.config.js con ULTRON_APP=electrum no trae el plugin.
 *  · Lo puro de JS: los enlaces y orígenes, el modo de arranque (burbuja / app), la doble invocación, la medida, el
 *    buzón del «hablar», lo que pasa al cerrar la burbuja, el hilo que comparte con la mesa y el dueño del audio.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  BuzonHablar,
  GuardiaInvocacion,
  VENTANA_DOBLE_MS,
  VIGENCIA_PEDIDO_MS,
  enlaceHablar,
  leerEnlace,
  lineaEntrada,
  modoDeArranque,
  momentoInvocacion,
  origenValido,
} from '../mobile/src/entrada/enlace';
import { AvisoBurbuja, CIERRE_POR_SILENCIO_MS, HiloCompartido, TOPE_HILO, cierreBurbuja, debeCerrarPorSilencio, preguntaDeFoto, quiereOido, sinConversacion, textoEstado } from '../mobile/src/burbuja/logica';
import { OidoMesa, duenoAudio, oidoPropio } from '../mobile/src/compa/duenoAudio';

const requerir = createRequire(import.meta.url);
const raizMovil = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../mobile');
const plugin = requerir(path.join(raizMovil, 'plugins/asistente-digital.js'));
const appConfig = requerir(path.join(raizMovil, 'app.config.js'));

const PAQUETE = 'link.ordenglobal.ultronfp';

/** El manifiesto mínimo que deja el prebuild (lo que el plugin encuentra al llegar). */
function manifiestoBase() {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      application: [
        {
          $: { 'android:name': '.MainApplication' },
          activity: [
            {
              $: { 'android:name': '.MainActivity', 'android:exported': 'true' },
              'intent-filter': [{ action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }], category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }] }],
            },
          ],
          service: [{ $: { 'android:name': 'app.notifee.core.ForegroundService' } }],
        },
      ],
    },
  };
}

/** Corre los mods del plugin como el prebuild: el manifiesto en memoria y el nativo en una carpeta temporal. */
async function correrPlugin() {
  const raizAndroid = fs.mkdtempSync(path.join(os.tmpdir(), 'asistente-digital-'));
  const config = plugin({ name: 'AU-RA FP', slug: 'ultron-fp', scheme: 'ultronfp', android: { package: PAQUETE } });
  const modRequest = { platform: 'android', projectRoot: raizMovil, platformProjectRoot: raizAndroid, introspect: false };
  await config.mods.android.dangerous({ ...config, modResults: {}, modRequest: { ...modRequest, modName: 'dangerous' } });
  const r = await config.mods.android.manifest({ ...config, modResults: manifiestoBase(), modRequest: { ...modRequest, modName: 'manifest' } });
  return { manifiesto: r.modResults, raizAndroid };
}

const app = (m: any) => m.manifest.application[0];
const porNombre = (lista: any[] | undefined, n: string) => (lista || []).find((x) => x?.$?.['android:name'] === n);
const acciones = (c: any) => (c['intent-filter'] || []).flatMap((f: any) => (f.action || []).map((a: any) => a.$['android:name']));

test('el VoiceInteractionService: BIND_VOICE_INTERACTION, su filtro y el XML con la sesión, el reconocedor y supportsAssist', async () => {
  const { manifiesto, raizAndroid } = await correrPlugin();
  const vis = porNombre(app(manifiesto).service, `${PAQUETE}.asistente.ServicioAura`);
  assert.ok(vis, 'falta el VoiceInteractionService');
  assert.equal(vis.$['android:permission'], 'android.permission.BIND_VOICE_INTERACTION');
  assert.equal(vis.$['android:exported'], 'true');
  assert.deepEqual(acciones(vis), ['android.service.voice.VoiceInteractionService']);
  assert.deepEqual(vis['meta-data'], [{ $: { 'android:name': 'android.voice_interaction', 'android:resource': '@xml/aura_interaccion_voz' } }]);

  const xml = fs.readFileSync(path.join(raizAndroid, 'app/src/main/res/xml/aura_interaccion_voz.xml'), 'utf8');
  assert.match(xml, new RegExp(`android:sessionService="${PAQUETE}\\.asistente\\.SesionAuraServicio"`));
  assert.match(xml, new RegExp(`android:recognitionService="${PAQUETE}\\.asistente\\.ReconocedorAura"`));
  assert.match(xml, /android:supportsAssist="true"/);
  assert.match(xml, /android:supportsLaunchVoiceAssistFromKeyguard="false"/);
  assert.doesNotMatch(xml, /__PAQUETE__|__ESQUEMA__/);
});

test('la sesión (BIND_VOICE_INTERACTION) y el reconocedor (android.speech.RecognitionService) están declarados', async () => {
  const { manifiesto } = await correrPlugin();
  const sesion = porNombre(app(manifiesto).service, `${PAQUETE}.asistente.SesionAuraServicio`);
  assert.ok(sesion, 'falta el VoiceInteractionSessionService');
  assert.equal(sesion.$['android:permission'], 'android.permission.BIND_VOICE_INTERACTION');
  const rec = porNombre(app(manifiesto).service, `${PAQUETE}.asistente.ReconocedorAura`);
  assert.ok(rec, 'falta el RecognitionService');
  assert.deepEqual(acciones(rec), ['android.speech.RecognitionService']);
});

test('la burbuja: translúcida, con ASSIST y VOICE_COMMAND (DEFAULT), tarea propia, fuera de Recientes y SIN abrirse con el teléfono bloqueado', async () => {
  const { manifiesto, raizAndroid } = await correrPlugin();
  const b = porNombre(app(manifiesto).activity, `${PAQUETE}.asistente.BurbujaActivity`);
  assert.ok(b, 'falta BurbujaActivity');
  assert.equal(b.$['android:theme'], '@style/Theme.AuraBurbuja');
  assert.equal(b.$['android:excludeFromRecents'], 'true');
  assert.equal(b.$['android:taskAffinity'], `${PAQUETE}.burbuja`);
  assert.equal(b.$['android:launchMode'], 'singleTask');
  assert.deepEqual(acciones(b).sort(), ['android.intent.action.ASSIST', 'android.intent.action.VOICE_COMMAND']);
  for (const f of b['intent-filter']) assert.deepEqual(f.category, [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }]);
  // Privacidad (plan Fase 1): con el teléfono bloqueado Android pide desbloquear antes.
  for (const k of Object.keys(b.$)) assert.doesNotMatch(k, /showWhenLocked|turnScreenOn|showOnLockScreen/);

  const estilos = fs.readFileSync(path.join(raizAndroid, 'app/src/main/res/values/aura_asistente.xml'), 'utf8');
  const tema = /<style name="Theme\.AuraBurbuja"[^>]*>([\s\S]*?)<\/style>/.exec(estilos)?.[1] || '';
  assert.match(tema, /<item name="android:windowIsTranslucent">true<\/item>/);
  assert.match(tema, /<item name="android:windowBackground">@android:color\/transparent<\/item>/);
  assert.match(tema, /<item name="android:backgroundDimEnabled">true<\/item>/);
  assert.match(tema, /<item name="android:windowNoTitle">true<\/item>/);
  assert.match(estilos, /<string name="aura_hablar">Hablar con AURA<\/string>/);
});

test('el mosaico «Hablar con AURA» (BIND_QUICK_SETTINGS_TILE) y el atajo estático en MainActivity', async () => {
  const { manifiesto, raizAndroid } = await correrPlugin();
  const m = porNombre(app(manifiesto).service, `${PAQUETE}.asistente.MosaicoAura`);
  assert.ok(m, 'falta el mosaico');
  assert.equal(m.$['android:permission'], 'android.permission.BIND_QUICK_SETTINGS_TILE');
  assert.equal(m.$['android:label'], '@string/aura_hablar');
  assert.equal(m.$['android:icon'], '@drawable/aura_mosaico');
  assert.deepEqual(acciones(m), ['android.service.quicksettings.action.QS_TILE']);
  assert.ok(fs.existsSync(path.join(raizAndroid, 'app/src/main/res/drawable/aura_mosaico.xml')));

  const principal = porNombre(app(manifiesto).activity, '.MainActivity');
  assert.deepEqual(principal['meta-data'], [{ $: { 'android:name': 'android.app.shortcuts', 'android:resource': '@xml/aura_atajos' } }]);
  const atajos = fs.readFileSync(path.join(raizAndroid, 'app/src/main/res/xml/aura_atajos.xml'), 'utf8');
  assert.match(atajos, new RegExp(`android:targetPackage="${PAQUETE}"`));
  assert.match(atajos, new RegExp(`android:targetClass="${PAQUETE}\\.asistente\\.BurbujaActivity"`));
  assert.match(atajos, /android:data="ultronfp:\/\/burbuja\?origen=atajo"/);
  assert.match(atajos, /android:shortcutLongLabel="@string\/aura_hablar"/);
});

test('el Kotlin va a la carpeta del paquete, con el paquete y el esquema puestos; correr el plugin dos veces no duplica nada', async () => {
  const { manifiesto, raizAndroid } = await correrPlugin();
  const dir = path.join(raizAndroid, 'app/src/main/java', ...PAQUETE.split('.'), 'asistente');
  const kt = fs.readdirSync(dir).sort();
  assert.deepEqual(kt, ['AsistenteVoz.kt', 'BurbujaActivity.kt', 'Invocacion.kt', 'MosaicoAura.kt', 'ReconocedorAura.kt']);
  for (const f of kt) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.match(src, new RegExp(`^package ${PAQUETE.replace(/\./g, '\\.')}\\.asistente$`, 'm'), f);
    assert.doesNotMatch(src, /__PAQUETE__|__ESQUEMA__/, f);
  }
  const burbuja = fs.readFileSync(path.join(dir, 'BurbujaActivity.kt'), 'utf8');
  // Las props de arranque que lee App.tsx (modoDeArranque) y el «atrás» que la cierra a ella sola.
  assert.match(burbuja, /putString\("modo", "burbuja"\)/);
  assert.match(burbuja, /putString\("origen"/);
  assert.match(burbuja, /putDouble\("invocadaEn"/);
  assert.match(burbuja, /override fun invokeDefaultOnBackPressed\(\) \{\s*finish\(\)/);
  assert.doesNotMatch(burbuja, /setShowWhenLocked|setTurnScreenOn/);
  const sesion = fs.readFileSync(path.join(dir, 'AsistenteVoz.kt'), 'utf8');
  assert.match(sesion, /override fun onShow[\s\S]*Invocacion\.burbuja\(context, Invocacion\.ASISTENTE\)[\s\S]*hide\(\)/);
  const mosaico = fs.readFileSync(path.join(dir, 'MosaicoAura.kt'), 'utf8');
  assert.match(mosaico, /SDK_INT >= 34[\s\S]*PendingIntent\.getActivity[\s\S]*startActivityAndCollapse\(pendiente\)/);
  assert.match(fs.readFileSync(path.join(dir, 'Invocacion.kt'), 'utf8'), /private const val ESQUEMA = "ultronfp"/);

  // Idempotente: otra corrida sobre el mismo manifiesto no duplica piezas ni el atajo.
  plugin.conAsistente(manifiesto, PAQUETE);
  const nombres = [...app(manifiesto).activity, ...app(manifiesto).service].map((x: any) => x.$['android:name']);
  assert.equal(nombres.length, new Set(nombres).size);
  assert.equal(porNombre(app(manifiesto).activity, '.MainActivity')['meta-data'].length, 1);
  assert.ok(porNombre(app(manifiesto).service, 'app.notifee.core.ForegroundService'), 'no toca lo que ya estaba');
});

test('solo AU-RA: Dr Electrum no trae el plugin del asistente; AU-RA sí', () => {
  const antes = process.env.ULTRON_APP;
  try {
    const nombres = (c: any) => (c.plugins || []).map((p: any) => (Array.isArray(p) ? p[0] : p));
    process.env.ULTRON_APP = 'electrum';
    const electrum = appConfig({ config: {} });
    assert.equal(electrum.android.package, 'link.ordenglobal.drelectrumfp');
    assert.ok(!nombres(electrum).some((n: string) => /asistente-digital/.test(n)), 'Dr Electrum no debe traer el asistente');
    delete process.env.ULTRON_APP;
    const aura = appConfig({ config: {} });
    assert.equal(aura.android.package, PAQUETE);
    assert.ok(nombres(aura).includes('./plugins/asistente-digital'));
    assert.equal(aura.scheme, 'ultronfp');
  } finally {
    if (antes === undefined) delete process.env.ULTRON_APP;
    else process.env.ULTRON_APP = antes;
  }
});

test('la versión de la APK del asistente: 5.7.0 (versionCode 56)', () => {
  const j = JSON.parse(fs.readFileSync(path.join(raizMovil, 'app.json'), 'utf8'));
  assert.equal(j.expo.version, '5.7.0');
  assert.equal(j.expo.android.versionCode, 56);
  // El parche de expo-av que esperaba esta APK ya va en mobile/patches (lo aplica patch-package en el postinstall).
  assert.ok(fs.existsSync(path.join(raizMovil, 'patches/expo-av+16.0.8.patch')));
  assert.match(JSON.parse(fs.readFileSync(path.join(raizMovil, 'package.json'), 'utf8')).scripts.postinstall, /patch-package/);
});

/* ── lo puro de JS ───────────────────────────────────────────────────────────────────────────── */

test('los enlaces: hablar y burbuja con su origen y su momento; un origen desconocido es «enlace»; lo demás no es nuestro', () => {
  assert.deepEqual(leerEnlace('ultronfp://hablar?origen=burbuja'), { destino: 'hablar', origen: 'burbuja', invocadaEn: null });
  assert.deepEqual(leerEnlace('ultronfp://burbuja?origen=asistente&t=1700000000000'), { destino: 'burbuja', origen: 'asistente', invocadaEn: 1700000000000 });
  assert.deepEqual(leerEnlace('ULTRONFP://Hablar/?origen=ATAJO'), { destino: 'hablar', origen: 'atajo', invocadaEn: null });
  assert.equal(leerEnlace('ultronfp://hablar?origen=hacker')?.origen, 'enlace');
  assert.equal(leerEnlace('ultronfp://hablar')?.origen, 'enlace');
  assert.equal(leerEnlace('ultronfp://hablar?origen=%E0%A4%A')?.origen, 'enlace', 'un % roto no tumba al oyente');
  assert.equal(leerEnlace('ultronfp://hablar?t=abc')?.invocadaEn, null);
  for (const otro of ['ultronfp://sso?x=1', 'https://aura-fp.onrender.com/sso?c=1', 'vetawallet://sso', 'drelectrumfp://hablar', '', null, undefined, 42]) assert.equal(leerEnlace(otro), null, String(otro));
  for (const o of ['asistente', 'comando', 'mosaico', 'atajo', 'burbuja', 'enlace'] as const) assert.equal(origenValido(o), o);
  assert.equal(origenValido(' Mosaico '), 'mosaico');
  assert.equal(enlaceHablar('burbuja'), 'ultronfp://hablar?origen=burbuja');
  assert.deepEqual(leerEnlace(enlaceHablar('burbuja', 123)), { destino: 'hablar', origen: 'burbuja', invocadaEn: 123 });
});

test('el modo de arranque: solo `modo: burbuja` dibuja la burbuja; cualquier otra cosa es la app', () => {
  assert.deepEqual(modoDeArranque({ modo: 'burbuja', origen: 'mosaico', invocadaEn: 1234 }), { modo: 'burbuja', origen: 'mosaico', invocadaEn: 1234 });
  assert.deepEqual(modoDeArranque({ modo: 'burbuja', origen: 'raro' }), { modo: 'burbuja', origen: 'enlace', invocadaEn: null });
  assert.deepEqual(modoDeArranque({ modo: 'burbuja', invocadaEn: 'x' }), { modo: 'burbuja', origen: 'enlace', invocadaEn: null });
  for (const p of [undefined, null, {}, { modo: 'app' }, { modo: 'BURBUJA' }, 'burbuja', { rootTag: 11 }]) assert.deepEqual(modoDeArranque(p), { modo: 'app' }, JSON.stringify(p));
});

test('la doble invocación: la segunda dentro de 1,5 s se ignora y no alarga la ventana', () => {
  const g = new GuardiaInvocacion();
  assert.equal(g.aceptar(10_000), true);
  assert.equal(g.aceptar(10_400), false);
  assert.equal(g.aceptar(10_000 + VENTANA_DOBLE_MS - 1), false);
  assert.equal(g.aceptar(10_000 + VENTANA_DOBLE_MS), true, 'la ventana se cuenta desde la aceptada, no desde la ignorada');
  assert.equal(g.aceptar(10_000 + VENTANA_DOBLE_MS + 100), false);
  assert.equal(VENTANA_DOBLE_MS, 1_500);
});

test('la medida: desde la invocación creíble hasta que escucha, con la misma forma siempre', () => {
  assert.equal(momentoInvocacion(9_000, 10_000), 9_000);
  assert.equal(momentoInvocacion(null, 10_000), 10_000);
  assert.equal(momentoInvocacion(20_000, 10_000), 10_000, 'del futuro: desde que llegó');
  assert.equal(momentoInvocacion(10_000 - 61_000, 10_000), 10_000, 'de hace más de un minuto: desde que llegó');
  assert.equal(lineaEntrada('asistente', 1_000, 1_812.4), '[entrada] origen=asistente invocacion→escuchando=812ms');
  assert.equal(lineaEntrada('mosaico', 1_000, 900), '[entrada] origen=mosaico invocacion→escuchando=0ms');
  assert.equal(lineaEntrada('atajo', 1_000, null, 'sin permiso del micrófono'), '[entrada] origen=atajo invocacion→escuchando=sin-oido (sin permiso del micrófono)');
});

test('el buzón del «hablar»: el último vale, la intro mira sin consumir, la mesa lo toma una vez, caduca', () => {
  const b = new BuzonHablar();
  const vistos: string[] = [];
  const quitar = b.escuchar((p) => vistos.push(`${p.origen}#${p.n}`));
  b.pedir('enlace', 1_000);
  b.pedir('burbuja', 2_000);
  assert.deepEqual(vistos, ['enlace#1', 'burbuja#2']);
  assert.equal(b.pendiente(2_500)?.origen, 'burbuja');
  assert.equal(b.pendiente(2_500)?.origen, 'burbuja', 'mirar no consume');
  assert.equal(b.tomar(2_600)?.origen, 'burbuja');
  assert.equal(b.tomar(2_700), null, 'una sola vez');
  b.pedir('atajo', 3_000);
  assert.equal(b.pendiente(3_000 + VIGENCIA_PEDIDO_MS + 1), null, 'caducado: no abre el micrófono horas después');
  quitar();
  b.pedir('enlace', 5_000);
  assert.equal(vistos.length, 3);
});

test('cerrar la burbuja: siempre calla, corta el turno y suelta el micrófono; solo «abrir-app» abre la app y NO termina la actividad desde JS', () => {
  for (const m of ['fuera', 'atras', 'silencio'] as const) {
    assert.deepEqual(cierreBurbuja(m), { callar: true, cancelarTurno: true, soltarMic: true, terminarActividad: true, abrirApp: false }, m);
  }
  // Con «abrir-app» la que está delante es MainActivity: un exitApp le llegaría a ella. La burbuja se termina en onStop.
  assert.deepEqual(cierreBurbuja('abrir-app'), { callar: true, cancelarTurno: true, soltarMic: true, terminarActividad: false, abrirApp: true });
  assert.deepEqual(cierreBurbuja('fondo'), { callar: true, cancelarTurno: true, soltarMic: true, terminarActividad: false, abrirApp: false });
});

test('la burbuja: se cierra sola tras 30 s sin nada (solo escuchando o en un fallo), y sus textos', () => {
  assert.equal(debeCerrarPorSilencio({ estado: 'escuchando', ultimaActividad: 0, ahora: CIERRE_POR_SILENCIO_MS }), true);
  assert.equal(debeCerrarPorSilencio({ estado: 'escuchando', ultimaActividad: 0, ahora: CIERRE_POR_SILENCIO_MS - 1 }), false);
  for (const e of ['pensando', 'hablando', 'escribiendo', 'camara', 'sin-sesion'] as const) assert.equal(debeCerrarPorSilencio({ estado: e, ultimaActividad: 0, ahora: 10 * CIERRE_POR_SILENCIO_MS }), false, e);
  assert.equal(textoEstado('escuchando'), 'Te escucho…');
  assert.equal(textoEstado('pensando'), 'Pensando…');
  assert.equal(textoEstado('sin-sesion'), 'Entra a AURA primero');
  assert.equal(textoEstado('escuchando', true), 'Listening…');
  assert.equal(textoEstado('hablando'), '');
  assert.equal(quiereOido('escuchando'), true);
  assert.equal(quiereOido('escribiendo'), false);
  assert.equal(sinConversacion('sin-sesion'), true);
  assert.equal(sinConversacion('ocupada'), true);
  assert.equal(sinConversacion('escuchando'), false);
  assert.equal(preguntaDeFoto('  '), '¿Qué ves en esta foto?');
  assert.equal(preguntaDeFoto('¿qué precio tiene?'), '¿qué precio tiene?');
});

test('el aviso «la burbuja está abierta»: avisa solo al cambiar', () => {
  const a = new AvisoBurbuja();
  let n = 0;
  const quitar = a.suscribir(() => n++);
  a.fijar(true);
  a.fijar(true);
  assert.equal(a.abierta(), true);
  a.fijar(false);
  assert.equal(n, 2);
  quitar();
  a.fijar(true);
  assert.equal(n, 2);
});

test('el hilo compartido: la burbuja pregunta con el hilo de la mesa y le deja lo suyo, de la misma cuenta y una vez', () => {
  const h = new HiloCompartido();
  const mesa = [{ rol: 'usuario' as const, texto: 'hola' }, { rol: 'ultron' as const, texto: 'Hola, José' }];
  assert.equal(h.hayMesa(), false);
  const dejar = h.proveer('Jose@Correo.com', () => mesa);
  assert.equal(h.hayMesa(), true);
  assert.deepEqual(h.historial('jose@correo.com'), mesa);
  assert.deepEqual(h.historial('otra@correo.com'), [], 'el hilo de una cuenta no viaja con otra');
  h.anotar('jose@correo.com', { rol: 'usuario', texto: ' ¿qué hora es? ' });
  h.anotar('jose@correo.com', { rol: 'ultron', texto: 'Son las tres.' });
  h.anotar('jose@correo.com', { rol: 'ultron', texto: '   ' });
  assert.deepEqual(h.historial('jose@correo.com').slice(-2), [{ rol: 'usuario', texto: '¿qué hora es?' }, { rol: 'ultron', texto: 'Son las tres.' }]);
  assert.deepEqual(h.tomarPorEntregar('otra@correo.com'), []);
  assert.equal(h.tomarPorEntregar('jose@correo.com').length, 2);
  assert.deepEqual(h.tomarPorEntregar('jose@correo.com'), [], 'una sola vez');
  dejar();
  assert.equal(h.hayMesa(), false);
  for (let i = 0; i < 20; i++) h.anotar('jose@correo.com', { rol: 'usuario', texto: `t${i}` });
  assert.equal(h.historial('jose@correo.com').length, TOPE_HILO);
  h.anotar('otra@correo.com', { rol: 'usuario', texto: 'x' });
  assert.deepEqual(h.tomarPorEntregar('jose@correo.com'), [], 'otra cuenta tira lo anterior');
});

test('el dueño del audio: con la burbuja abierta la mesa suelta el oído (y lo retoma al cerrarse); la llamada y la conversación mandan sobre ella', () => {
  const base = { enLlamada: false, conversacion: false, mesaVisible: true, appActiva: true };
  assert.equal(duenoAudio({ ...base, burbuja: true }), 'burbuja');
  assert.equal(oidoPropio('burbuja'), false);
  assert.equal(duenoAudio({ ...base, burbuja: true, enLlamada: true }), 'llamada');
  assert.equal(duenoAudio({ ...base, burbuja: true, conversacion: true }), 'conversacion');
  assert.equal(duenoAudio({ ...base, burbuja: false }), 'mesa');
  assert.equal(duenoAudio(base), 'mesa', 'sin el campo, lo de siempre');

  const hechos: string[] = [];
  const oido = new OidoMesa({
    muteMic: () => void hechos.push('mute'),
    unmuteMic: () => void hechos.push('unmute'),
    reabrirMic: () => void hechos.push('reabrir'),
    pauseMicForTts: (p) => void hechos.push(`pausa:${p}`),
    stopSpeaking: () => void hechos.push('callar'),
    cancelarTurno: () => void hechos.push('cortar'),
    micQuerido: () => true,
  });
  oido.fijar('mesa');
  assert.equal(oido.aplicar(duenoAudio({ ...base, burbuja: true })), 'suelta');
  assert.deepEqual(hechos, ['cortar', 'callar', 'pausa:false', 'mute']);
  assert.equal(oido.puedeHablar(), false, 'la mesa no habla encima de la burbuja');
  hechos.length = 0;
  assert.equal(oido.aplicar(duenoAudio({ ...base, burbuja: false })), 'toma');
  assert.deepEqual(hechos, ['pausa:false', 'reabrir']);
});

test('la app lee las piezas: App.tsx bifurca por el modo, la mesa usa el dueño «burbuja» y atiende el «hablar», la intro no espera', () => {
  const leer = (r: string) => fs.readFileSync(path.join(raizMovil, r), 'utf8');
  const appTsx = leer('App.tsx');
  assert.match(appTsx, /modoDeArranque\(props\)/);
  assert.match(appTsx, /modo\.modo === 'burbuja' && !ES_ELECTRUM/);
  const desk = leer('src/screens/DeskScreen.tsx');
  assert.match(desk, /duenoAudio\(\{ enLlamada, conversacion: vozOcupa, burbuja,/);
  assert.match(desk, /useHablarEnMesa\(\{/);
  assert.match(desk, /hiloCompartido\.proveer\(user\.correo/);
  assert.match(desk, /hiloCompartido\.tomarPorEntregar\(user\.correo\)/);
  const intro = leer('src/app/pantallas/Intro.tsx');
  assert.match(intro, /const minimo = paraHablar \? 0 : sesion \? 1_150 : 2_300;/);
  assert.match(leer('src/app/AppAura.tsx'), /useEnlacesHablar\(\);/);
  // La burbuja usa el oído prestado (no un oído nuevo) y el turno de siempre (turnoStream + StreamSpeaker).
  const burbuja = leer('src/burbuja/Burbuja.tsx');
  assert.match(burbuja, /prestarOido\(\{/);
  assert.match(burbuja, /medirHastaEscuchar\(/);
  assert.match(burbuja, /BackHandler\.exitApp\(\)/);
  const turno = leer('src/burbuja/turnoBurbuja.ts');
  assert.match(turno, /turnoStream\(base,/);
  assert.match(turno, /new StreamSpeaker\(/);
});
