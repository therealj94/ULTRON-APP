/**
 * LAS MANOS EN EL TELÉFONO (José, 10-oct, AU-RA 5.7.0 en su S26: «le pedí abrir una app, Spotify, en mi celular y no
 * pudo»; APK 5.7.1) Y LO QUE CADA SUPERFICIE PUEDE COMPLETAR (revisión del dueño, F02).
 *
 *  · El plugin (mobile/plugins/asistente-digital.js): las consultas de visibilidad de Android 11+ (sin QUERY_ALL_PACKAGES),
 *    el permiso normal de alarmas, el filtro «Compartir», el registro del módulo en MainApplication y el Kotlin con los
 *    intents estándar (sin CALL_PHONE ni SEND_SMS). Se salta sin expo/config-plugins, como tests/asistente-digital-movil.
 *  · El teléfono: el nombre de la app contra las instaladas, el ejecutor (con y sin el módulo nativo), los recibos con su
 *    id, lo compartido, el respaldo del stream sin duplicar el turno.
 *  · El servidor: la herramienta abrir_en_telefono (y el reloj, el SMS, el calendario) y su elección, la corrección de
 *    «te abro Spotify» sin herramienta, la guarda de honestidad que pide el recibo del aparato, el registro de recibos y
 *    de aparatos, el contrato por superficie y el bloque de objetivos solo cuando viene al caso.
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { accionDeAbrir, accionDeEvento, accionDeReloj, accionDeSms, dichoDeAbrir, enlaceValido, msDeHoraHN, nombraAppExterna, pideAbrirEnTelefono, validarAccionTelefono } from '../lib/telefono-apps';
import {
  corregirPromesaSinHerramienta,
  debeCorregirSinHerramienta,
  herramientasDelTurno,
  herramientasQueCumplen,
  HERRAMIENTAS_TELEFONO,
  lineaDeHerramienta,
  type ManosDelTurno,
} from '../lib/cerebro-manos';
import { extraerAcciones, validarAccion } from '../lib/acciones-app';
import { MANOS } from '../lib/manos-app';
import { guardaDeHonestidad, promesaSinCumplir, recibosDeAcciones, _olvidarEfectos, anotarEfectoReal, efectosRecientes } from '../lib/honestidad';
import { anotarAccionSalida, esperarRecibos, recibirRecibo, salidaDe, _olvidarSalidas } from '../lib/recibos-aparato';
import { capacidadesDelTurno, claseDeAccion, completaAqui, decisionDeSuperficie, manosDeSuperficie, superficieDelTurno } from '../lib/superficie';
import { objetivosAlCaso, type ObjetivoParaTurno } from '../lib/objetivos-turno';
import { almacenEnMemoria, _usarAlmacenDurable } from '../lib/durable';
import { crearObjetivo } from '../lib/objetivos';
import { bloqueObjetivosDelTurno, _olvidarObjetivosDelTurno } from '../server/objetivos';
import { anotarLatido, aparatosDe, latidoValido, lineaAparatos, _olvidarAparatos } from '../lib/aparatos';
import { esAccionTelefono, nombreLimpio, resolverApp, type AppInstalada } from '../mobile/src/telefono/apps';
import { ejecutarAccionTelefono, _olvidarCacheApps, type NativoTelefono } from '../mobile/src/telefono/ejecutor';
import { anotarIdAccion, fijarEnvioRecibos, mandarRecibo, _olvidarRecibos, type Recibo } from '../mobile/src/telefono/recibos';
import { escucharCompartido, guardarCompartido, pedidoDeCompartido, tomarCompartido } from '../mobile/src/telefono/compartido';
import { capacidadesDeSuperficie, permisosDeNotifee } from '../mobile/src/telefono/capacidades';
import { planRespaldo } from '../mobile/src/lib/respaldoTurno';

afterEach(() => {
  _usarAlmacenDurable(null);
  _olvidarSalidas();
  _olvidarEfectos();
  _olvidarRecibos();
  _olvidarCacheApps();
});

const requerir = createRequire(import.meta.url);
const raizMovil = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../mobile');
let plugin: any = null;
let sinExpo: string | false = false;
try {
  plugin = requerir(path.join(raizMovil, 'plugins/asistente-digital.js'));
} catch (e: any) {
  if (e?.code !== 'MODULE_NOT_FOUND') throw e;
  sinExpo = 'faltan las dependencias del teléfono (expo/config-plugins): corre en «Calidad (antes de publicar la app)»';
}
const PAQUETE = 'link.ordenglobal.ultronfp';

function manifiestoBase() {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      'uses-permission': [{ $: { 'android:name': 'android.permission.INTERNET' } }, { $: { 'android:name': 'android.permission.QUERY_ALL_PACKAGES' } }],
      application: [
        {
          $: { 'android:name': '.MainApplication' },
          activity: [
            {
              $: { 'android:name': '.MainActivity', 'android:exported': 'true' },
              'intent-filter': [{ action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }], category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }] }],
            },
          ],
        },
      ],
    },
  };
}

/* ------------------------------------------------------------------ el plugin (AU-RA) */

test('el manifiesto: <queries> para ver las apps y cada intent (Android 11+), SET_ALARM, «Compartir», y NUNCA QUERY_ALL_PACKAGES, CALL_PHONE ni SEND_SMS', { skip: sinExpo }, () => {
  const m = plugin.conAsistente(manifiestoBase(), PAQUETE);
  const intents = m.manifest.queries[0].intent as any[];
  const con = (accion: string, f: (i: any) => boolean = () => true) => intents.some((i) => i.action[0].$['android:name'] === accion && f(i));
  assert.ok(con('android.intent.action.MAIN', (i) => i.category?.[0].$['android:name'] === 'android.intent.category.LAUNCHER'), 'MAIN/LAUNCHER para listar las apps');
  for (const esquema of ['spotify', 'whatsapp', 'geo', 'https', 'tel', 'mailto', 'google.navigation'])
    assert.ok(con('android.intent.action.VIEW', (i) => i.data?.[0].$['android:scheme'] === esquema), `VIEW ${esquema}`);
  assert.ok(con('android.intent.action.SET_ALARM') && con('android.intent.action.SET_TIMER'), 'la alarma y el temporizador');
  assert.ok(con('android.intent.action.DIAL', (i) => i.data?.[0].$['android:scheme'] === 'tel'), 'el marcador');
  assert.ok(con('android.intent.action.SENDTO', (i) => i.data?.[0].$['android:scheme'] === 'smsto'), 'el borrador de SMS');
  assert.ok(con('android.intent.action.INSERT', (i) => i.data?.[0].$['android:mimeType'] === 'vnd.android.cursor.dir/event'), 'el evento del calendario');
  const permisos = m.manifest['uses-permission'].map((p: any) => p.$['android:name']);
  assert.ok(permisos.includes('com.android.alarm.permission.SET_ALARM'));
  for (const prohibido of ['android.permission.QUERY_ALL_PACKAGES', 'android.permission.CALL_PHONE', 'android.permission.SEND_SMS']) assert.ok(!permisos.includes(prohibido), prohibido);
  assert.ok(permisos.includes('android.permission.INTERNET'), 'no toca lo que ya estaba');
  const principal = m.manifest.application[0].activity.find((a: any) => a.$['android:name'] === '.MainActivity');
  const enviar = principal['intent-filter'].filter((f: any) => f.action[0].$['android:name'] === 'android.intent.action.SEND').map((f: any) => f.data[0].$['android:mimeType']);
  assert.deepEqual(enviar.sort(), ['image/*', 'text/plain']);
  // Idempotente: otra corrida no duplica consultas, permisos ni filtros.
  plugin.conAsistente(m, PAQUETE);
  assert.equal(m.manifest.queries[0].intent.length, intents.length);
  assert.equal(m.manifest['uses-permission'].filter((p: any) => p.$['android:name'] === 'com.android.alarm.permission.SET_ALARM').length, 1);
  assert.equal(principal['intent-filter'].filter((f: any) => f.action[0].$['android:name'] === 'android.intent.action.SEND').length, 2);
});

test('MainApplication: registra TelefonoAuraPaquete en getPackages (las dos plantillas), una vez; una plantilla desconocida falla el prebuild', { skip: sinExpo }, async () => {
  const sdk54 = 'override fun getPackages(): List<ReactPackage> =\n            PackageList(this).packages.apply {\n              // add(MyReactNativePackage())\n            }';
  const r = plugin.conPaqueteTelefono(sdk54, PAQUETE);
  assert.match(r, /packages\.apply \{\n\s+add\(link\.ordenglobal\.ultronfp\.asistente\.TelefonoAuraPaquete\(\)\)/);
  assert.equal(plugin.conPaqueteTelefono(r, PAQUETE), r, 'idempotente');
  const vieja = 'val packages = PackageList(this).packages\n            return packages';
  assert.match(plugin.conPaqueteTelefono(vieja, PAQUETE), /packages\.add\(link\.ordenglobal\.ultronfp\.asistente\.TelefonoAuraPaquete\(\)\)/);
  assert.throws(() => plugin.conPaqueteTelefono('class MainApplication {}', PAQUETE), /getPackages/);
  // El mod de verdad, como en el prebuild.
  const config = plugin({ name: 'AU-RA FP', slug: 'ultron-fp', scheme: 'ultronfp', android: { package: PAQUETE } });
  const out = await config.mods.android.mainApplication({ ...config, modResults: { language: 'kt', contents: sdk54, path: 'MainApplication.kt' }, modRequest: { platform: 'android', modName: 'mainApplication', projectRoot: raizMovil, platformProjectRoot: os.tmpdir(), introspect: false } });
  assert.match(out.modResults.contents, /TelefonoAuraPaquete\(\)/);
});

test('el Kotlin: intents estándar con las constantes del SDK, resolveActivity antes de abrir, sin llamar ni mandar SMS solo', { skip: sinExpo }, () => {
  const kt = plugin.archivosNativos({ paquete: PAQUETE, esquema: 'ultronfp' })['java/TelefonoAura.kt'] as string;
  assert.match(kt, /^package link\.ordenglobal\.ultronfp\.asistente$/m);
  assert.match(kt, /const val NOMBRE = "AuraTelefono"/);
  assert.match(kt, /Intent\(Intent\.ACTION_MAIN\)\.addCategory\(Intent\.CATEGORY_LAUNCHER\)/);
  assert.match(kt, /getLaunchIntentForPackage\(paquete\)/);
  assert.match(kt, /FLAG_ACTIVITY_NEW_TASK/);
  assert.match(kt, /AlarmClock\.ACTION_SET_ALARM[\s\S]*AlarmClock\.EXTRA_HOUR[\s\S]*AlarmClock\.EXTRA_MINUTES[\s\S]*AlarmClock\.EXTRA_SKIP_UI, true/);
  assert.match(kt, /AlarmClock\.ACTION_SET_TIMER[\s\S]*AlarmClock\.EXTRA_LENGTH/);
  assert.match(kt, /google\.navigation:q=/);
  assert.match(kt, /Intent\.ACTION_DIAL/);
  assert.match(kt, /Intent\.ACTION_SENDTO, Uri\.parse\("smsto:/);
  assert.match(kt, /Intent\.ACTION_INSERT\)[\s\S]*CalendarContract\.Events\.CONTENT_URI/);
  assert.match(kt, /resolveActivity/);
  assert.doesNotMatch(kt, /ACTION_CALL\b|SmsManager|android\.permission\.(QUERY_ALL_PACKAGES|CALL_PHONE|SEND_SMS)/);
  assert.match(kt, /setOf\("spotify", "whatsapp", "geo", "https", "tel", "mailto"\)/, 'los mismos esquemas que el servidor');
  assert.match(kt, /class TelefonoAuraPaquete : BaseReactPackage\(\)/);
});

/* ------------------------------------------------------------------ el nombre de la app (teléfono) */

const INSTALADAS: AppInstalada[] = [
  { paquete: 'com.spotify.music', nombre: 'Spotify' },
  { paquete: 'com.whatsapp', nombre: 'WhatsApp' },
  { paquete: 'com.whatsapp.w4b', nombre: 'WhatsApp Business' },
  { paquete: 'com.google.android.youtube', nombre: 'YouTube' },
  { paquete: 'com.google.android.apps.maps', nombre: 'Maps' },
  { paquete: 'com.google.android.gm', nombre: 'Gmail' },
  { paquete: 'com.instagram.android', nombre: 'Instagram' },
  { paquete: 'com.zhiliaoapp.musically', nombre: 'TikTok' },
  { paquete: 'com.sec.android.app.camera', nombre: 'Cámara' },
  { paquete: 'com.android.settings', nombre: 'Ajustes' },
  { paquete: 'com.samsung.android.calendar', nombre: 'Calendario' },
  { paquete: 'com.samsung.android.dialer', nombre: 'Teléfono' },
  { paquete: 'com.google.android.apps.docs', nombre: 'Google Drive' },
  { paquete: 'com.google.android.apps.photos', nombre: 'Google Fotos' },
];
const paqueteDe = (pedido: string) => {
  const r = resolverApp(pedido, INSTALADAS);
  return r.tipo === 'una' ? r.app.paquete : r.tipo;
};

test('el nombre de la app contra las instaladas: tildes, mayúsculas, apodos y relleno', () => {
  assert.equal(paqueteDe('Spotify'), 'com.spotify.music');
  assert.equal(paqueteDe('abre la app de spotify'), 'com.spotify.music');
  assert.equal(paqueteDe('SPOTIFY'), 'com.spotify.music');
  assert.equal(paqueteDe('spotfy'), 'com.spotify.music', 'un error de dedo');
  assert.equal(paqueteDe('WhatsApp'), 'com.whatsapp', 'con Business instalado, «WhatsApp» es WhatsApp');
  assert.equal(paqueteDe('wasap'), 'com.whatsapp');
  assert.equal(paqueteDe('YouTube'), 'com.google.android.youtube');
  assert.equal(paqueteDe('Google Maps'), 'com.google.android.apps.maps');
  assert.equal(paqueteDe('maps'), 'com.google.android.apps.maps');
  assert.equal(paqueteDe('mapas'), 'com.google.android.apps.maps');
  assert.equal(paqueteDe('Gmail'), 'com.google.android.gm');
  assert.equal(paqueteDe('insta'), 'com.instagram.android');
  assert.equal(paqueteDe('tik tok'), 'com.zhiliaoapp.musically');
  assert.equal(paqueteDe('la cámara'), 'com.sec.android.app.camera');
  assert.equal(paqueteDe('camara'), 'com.sec.android.app.camera');
  assert.equal(paqueteDe('ajustes del teléfono'), 'com.android.settings');
  assert.equal(paqueteDe('configuración'), 'com.android.settings');
  assert.equal(paqueteDe('el calendario'), 'com.samsung.android.calendar');
  assert.equal(paqueteDe('Teléfono'), 'com.samsung.android.dialer');
  assert.equal(paqueteDe('Drive'), 'com.google.android.apps.docs');
  assert.equal(nombreLimpio('Ábreme la aplicación de Google Maps'), 'google maps');
});

test('el nombre de la app: varias que se parecen → pregunta; ninguna → no está; el paquete exacto gana', () => {
  const g = resolverApp('Google', INSTALADAS);
  assert.equal(g.tipo, 'varias');
  if (g.tipo === 'varias') assert.deepEqual(g.opciones.map((o) => o.nombre).sort(), ['Google Drive', 'Google Fotos']);
  assert.equal(resolverApp('Netflix', INSTALADAS).tipo, 'ninguna');
  assert.equal(resolverApp('', INSTALADAS).tipo, 'ninguna');
  assert.equal(resolverApp('lo que sea', INSTALADAS, 'com.whatsapp.w4b').tipo, 'una');
});

/* ------------------------------------------------------------------ el ejecutor (teléfono) */

function nativoFalso(o: { enlaces?: string[]; abre?: boolean } = {}) {
  const hechos: string[] = [];
  const n: NativoTelefono = {
    listarApps: async () => INSTALADAS,
    abrirApp: async (p) => (hechos.push(`app:${p}`), o.abre !== false),
    abrirEnlace: async (u) => (hechos.push(`enlace:${u}`), (o.enlaces || []).some((e) => u.startsWith(e))),
    alarma: async (h, m, e) => (hechos.push(`alarma:${h}:${m}:${e}`), { ok: true, via: 'alarma' }),
    temporizador: async (s) => (hechos.push(`temporizador:${s}`), { ok: true, via: 'temporizador' }),
    navegar: async (d) => (hechos.push(`navegar:${d}`), { ok: true, via: 'google' }),
    borradorSms: async (num, t) => (hechos.push(`sms:${num}:${t}`), { ok: false, via: 'sms', motivo: 'sin-app' }),
    eventoCalendario: async (t) => (hechos.push(`evento:${t}`), { ok: true, via: 'calendario' }),
  };
  return { n, hechos };
}
const tr = (es: string) => es;

test('el ejecutor: abre la app resuelta, pregunta si hay varias, dice si no está; el enlace con su respaldo web', async () => {
  const { n, hechos } = nativoFalso({ enlaces: ['https://open.spotify.com'] });
  const d = { nativo: n, plataforma: 'android', electrum: false, tr };
  assert.deepEqual(await ejecutarAccionTelefono({ tipo: 'abrir_app', app: 'Spotify' }, d), { ok: true, via: 'app', app: 'Spotify' });
  assert.deepEqual(hechos, ['app:com.spotify.music']);
  const varias = await ejecutarAccionTelefono({ tipo: 'abrir_app', app: 'Google' }, d);
  assert.equal(varias.ok, false);
  assert.match(varias.detalle || '', /varias que se parecen: .*Google Drive.*¿Cuál abro\?/);
  assert.match((await ejecutarAccionTelefono({ tipo: 'abrir_app', app: 'Netflix' }, d)).detalle || '', /No encuentro Netflix en tu teléfono/);
  // spotify: no lo abre nadie → el respaldo https sí.
  const e = await ejecutarAccionTelefono({ tipo: 'abrir_enlace', uri: 'spotify:search:Bad%20Bunny', web: 'https://open.spotify.com/search/Bad%20Bunny', app: 'Spotify' }, d);
  assert.deepEqual(e, { ok: true, via: 'web', app: 'Spotify' });
  const sms = await ejecutarAccionTelefono({ tipo: 'sms', numero: '+50499998888', texto: 'Llego a las 5' }, d);
  assert.equal(sms.ok, false);
  assert.match(sms.detalle || '', /No encontré en tu teléfono una app/);
  const ev = await ejecutarAccionTelefono({ tipo: 'evento_calendario', titulo: 'Dentista', inicio: 1, fin: 2 }, d);
  assert.equal(ev.ok, true);
  assert.match(ev.detalle || '', /para que lo confirmes/, 'revisión obligatoria: nunca «agendado»');
  assert.doesNotMatch(ev.detalle || '', /agend/);
});

test('el ejecutor sin el módulo nativo (APK de antes con esta OTA): «actualiza a la 5.7.1»; Dr Electrum y fuera de Android, nunca', async () => {
  const r = await ejecutarAccionTelefono({ tipo: 'abrir_app', app: 'Spotify' }, { nativo: null, plataforma: 'android', electrum: false, tr });
  assert.equal(r.ok, false);
  assert.match(r.detalle || '', /esta versión de la app no puede abrir otras apps.*actualiza a la 5\.7\.1/i);
  assert.equal((await ejecutarAccionTelefono({ tipo: 'abrir_app', app: 'Spotify' }, { nativo: nativoFalso().n, plataforma: 'android', electrum: true, tr })).ok, false);
  assert.equal((await ejecutarAccionTelefono({ tipo: 'abrir_app', app: 'Spotify' }, { nativo: nativoFalso().n, plataforma: 'ios', electrum: false, tr })).ok, false);
});

/* ------------------------------------------------------------------ los recibos (teléfono) */

test('los recibos del teléfono: con el id con que llegó, una vez por id; sin id o no local, nada; sin red, se puede reintentar', async () => {
  const enviados: Recibo[] = [];
  let falla = false;
  fijarEnvioRecibos(async (r) => {
    if (falla) throw new Error('sin red');
    enviados.push(r);
  });
  const a = { tipo: 'abrir_app', app: 'Spotify' };
  assert.equal(await mandarRecibo(a, true), false, 'sin id no se manda: el servidor no podría atarlo');
  anotarIdAccion(a, 'id-spotify-1');
  falla = true;
  assert.equal(await mandarRecibo(a, true), false);
  falla = false;
  assert.equal(await mandarRecibo(a, true), true, 'tras un fallo de red, el mismo id se reintenta');
  assert.equal(await mandarRecibo(a, true), false, 'una vez por id');
  assert.deepEqual(enviados, [{ id: 'id-spotify-1', ok: true }]);
  assert.equal(await mandarRecibo({ tipo: 'abrir' }, true, undefined, 'otro'), false, 'abrir una pantalla de AU-RA no tiene recibo de aparato');
  assert.equal(await mandarRecibo({ tipo: 'recordatorio' }, false, 'Sin permiso de alarmas', 'rec-1'), true);
  assert.deepEqual(enviados[1], { id: 'rec-1', ok: false, detalle: 'Sin permiso de alarmas' });
});

test('la forma estricta de las acciones del teléfono es la misma en el teléfono y en el servidor', () => {
  const buenas = [
    { tipo: 'abrir_app', app: 'Spotify' },
    { tipo: 'abrir_enlace', uri: 'spotify:search:Bad%20Bunny', app: 'Spotify', web: 'https://open.spotify.com/search/Bad%20Bunny' },
    { tipo: 'navegar', destino: 'San Pedro Sula' },
    { tipo: 'alarma', hora: 6, minutos: 30, etiqueta: 'Gimnasio' },
    { tipo: 'temporizador', segundos: 600 },
    { tipo: 'sms', numero: '+50499998888', texto: 'Llego a las 5' },
    { tipo: 'evento_calendario', titulo: 'Dentista', inicio: 1_700_000_000_000, fin: 1_700_003_600_000 },
  ];
  for (const a of buenas) {
    assert.ok(esAccionTelefono(a), `teléfono: ${a.tipo}`);
    assert.deepEqual(validarAccionTelefono(a), a, `servidor: ${a.tipo}`);
  }
  for (const mala of [
    { tipo: 'abrir_enlace', uri: 'javascript:alert(1)' },
    { tipo: 'abrir_enlace', uri: 'intent://x#Intent;end' },
    { tipo: 'abrir_enlace', uri: 'http://inseguro.com' },
    { tipo: 'alarma', hora: 25, minutos: 0 },
    { tipo: 'sms', numero: 'mi mamá', texto: 'hola' },
  ]) {
    assert.equal(esAccionTelefono(mala), false, JSON.stringify(mala));
    assert.equal(validarAccionTelefono(mala), null, JSON.stringify(mala));
  }
});

/* ------------------------------------------------------------------ la herramienta (servidor) */

const MANOS_TEL: ManosDelTurno = { app: true, manos: [...MANOS], sistema: false, computadora: false, correo: false, whatsapp: false, sesion: true, triaje: false };
const nombres = (d: ManosDelTurno) => herramientasDelTurno(d).map((t) => String(t.toolSpec?.name));

test('abrir_en_telefono (y el reloj, el SMS, el calendario): solo si el teléfono declaró la mano; nombres exportados para el conjunto fijo', () => {
  assert.deepEqual([...HERRAMIENTAS_TELEFONO], ['abrir_en_telefono', 'alarma_telefono', 'sms_telefono', 'evento_telefono']);
  const con = nombres(MANOS_TEL);
  for (const h of HERRAMIENTAS_TELEFONO) assert.ok(con.includes(h), h);
  const sin = nombres({ ...MANOS_TEL, manos: MANOS.filter((m) => m !== 'abrir_apps' && m !== 'intents_telefono') });
  for (const h of HERRAMIENTAS_TELEFONO) assert.ok(!sin.includes(h), `sin la mano no hay ${h}`);
  assert.deepEqual(
    nombres({ ...MANOS_TEL, manos: ['abrir_apps'] }).filter((n) => (HERRAMIENTAS_TELEFONO as readonly string[]).includes(n)),
    ['abrir_en_telefono']
  );
});

test('de la herramienta a la acción: «abre Spotify», «pon música de Bad Bunny en Spotify», «llévame a San Pedro Sula», un enlace', () => {
  assert.deepEqual(accionDeAbrir({ app: 'Spotify' }), { tipo: 'abrir_app', app: 'Spotify' });
  assert.deepEqual(accionDeAbrir({ app: 'Spotify', que: 'reproduce música de Bad Bunny en Spotify' }), {
    tipo: 'abrir_enlace',
    uri: 'spotify:search:Bad%20Bunny',
    app: 'Spotify',
    web: 'https://open.spotify.com/search/Bad%20Bunny',
  });
  assert.deepEqual(accionDeAbrir({ que: 'pon música de Marco Antonio Solís' }), { tipo: 'abrir_enlace', uri: 'spotify:search:Marco%20Antonio%20Sol%C3%ADs', app: 'Spotify', web: 'https://open.spotify.com/search/Marco%20Antonio%20Sol%C3%ADs' });
  assert.deepEqual(accionDeAbrir({ app: 'Maps', que: 'llévame a San Pedro Sula' }), { tipo: 'navegar', destino: 'San Pedro Sula', app: 'Maps' });
  assert.equal(accionDeAbrir({ app: 'YouTube', que: 'videos de gatos' })?.tipo, 'abrir_enlace');
  assert.deepEqual(accionDeAbrir({ enlace: 'whatsapp://send?text=hola' }), { tipo: 'abrir_enlace', uri: 'whatsapp://send?text=hola', app: 'WhatsApp' });
  assert.equal(accionDeAbrir({ enlace: 'javascript:alert(1)' }), null);
  assert.equal(enlaceValido('file:///sdcard/x'), null);
  const linea = lineaDeHerramienta('abrir_en_telefono', { app: 'Spotify' });
  assert.equal(linea, 'ACCION_APP: {"tipo":"abrir_app","app":"Spotify"}');
  assert.deepEqual(validarAccion(extraerAcciones(`Abriendo Spotify…\n${linea}`).acciones[0]), { tipo: 'abrir_app', app: 'Spotify' });
  assert.equal(dichoDeAbrir({ tipo: 'abrir_app', app: 'Spotify' }), 'Abriendo Spotify…');
});

test('el reloj, el SMS (con lectura de a quién y qué) y el calendario (revisión obligatoria)', () => {
  assert.deepEqual(accionDeReloj({ accion: 'alarma', hora: '06:30', etiqueta: 'Gimnasio' }), { tipo: 'alarma', hora: 6, minutos: 30, etiqueta: 'Gimnasio' });
  assert.deepEqual(accionDeReloj({ accion: 'temporizador', segundos: 600 }), { tipo: 'temporizador', segundos: 600 });
  assert.equal(accionDeReloj({ accion: 'alarma', hora: 'a las seis' }), null);
  assert.deepEqual(accionDeSms({ a: '9999-8888', texto: 'Llego a las 5' }), { tipo: 'sms', numero: '99998888', texto: 'Llego a las 5' });
  const mama = accionDeSms({ a: 'Mamá', texto: 'Ya voy' }, [{ nombre: 'Mamá', telefono: '+50433334444' }, { nombre: 'Beto', telefono: '+50455556666' }]);
  assert.deepEqual(mama, { tipo: 'sms', numero: '+50433334444', texto: 'Ya voy', nombre: 'Mamá' });
  assert.equal(accionDeSms({ a: 'Desconocido', texto: 'hola' }, []), null, 'sin número no hay borrador: el modelo pregunta');
  // Regla de aprobación hablada: lo que va a otra persona se lee entero (a quién y el texto final).
  assert.equal(dichoDeAbrir(mama!), 'Te dejo listo el SMS para Mamá (+50433334444): «Ya voy». Tú le das enviar.');
  const ev = accionDeEvento({ titulo: 'Dentista', inicio: '2026-10-12T15:00', minutos: 30 });
  assert.deepEqual(ev, { tipo: 'evento_calendario', titulo: 'Dentista', inicio: msDeHoraHN('2026-10-12T15:00'), fin: msDeHoraHN('2026-10-12T15:00')! + 30 * 60_000 });
  assert.equal(msDeHoraHN('2026-10-12T15:00'), Date.UTC(2026, 9, 12, 21, 0), 'Honduras es UTC-6');
  assert.doesNotMatch(dichoDeAbrir(ev!), /agendad/);
});

test('elegir la herramienta en un turno hablado: lo que pide abrir otra app (no la charla de música)', () => {
  for (const f of ['Abre Spotify', 'abre la app de Instagram', 'Pon música de Bad Bunny en Spotify', 'ponme una canción de Shakira', 'Llévame a San Pedro Sula', 'abre YouTube']) assert.ok(pideAbrirEnTelefono(f), f);
  for (const f of ['¿Qué opinas de la música de los noventa?', 'Abre mis correos', 'abre ajustes', '¿Cómo está el clima?', 'Pon la cámara de atrás']) assert.ok(!pideAbrirEnTelefono(f), f);
  assert.ok(nombraAppExterna('Te abro Spotify'));
  assert.ok(!nombraAppExterna('Te abro ajustes'));
});

/* ------------------------------------------------------------------ «te abro Spotify» sin la herramienta */

test('«Te abro Spotify» SIN la herramienta (APK de antes, la burbuja vieja, Dr Electrum): sin segunda vuelta, dice claro que todavía no puede', () => {
  const disponibles = ['abrir_pantalla', 'ajustar_app', 'abrir_cartera', 'chat_aura', 'buscar_web'];
  assert.deepEqual(herramientasQueCumplen('¡Claro! Te abro Spotify.', disponibles, { mensaje: 'abre Spotify' }), [], 'abrir una pantalla de AU-RA no cumple «te abro Spotify»');
  const c = corregirPromesaSinHerramienta('[EMO: feliz] ¡Claro! Te abro Spotify.', 'es', { sinHerramienta: true, mensaje: 'abre Spotify' });
  assert.equal(c.texto, '[EMO: feliz] ¡Claro! No la abrí: todavía no puedo abrir otras apps de tu teléfono desde aquí.');
  // Con la herramienta en el turno, sí se le vuelve a pedir.
  assert.deepEqual(herramientasQueCumplen('¡Claro! Te abro Spotify.', [...disponibles, 'abrir_en_telefono'], { mensaje: 'abre Spotify' }), ['abrir_en_telefono']);
  // «Te abro ajustes» sigue siendo la pantalla de AU-RA.
  assert.ok(herramientasQueCumplen('Va, te abro ajustes.', disponibles, { mensaje: 'abre ajustes' }).includes('abrir_pantalla'));
});

test('la re-pregunta con TODAS tampoco usó ninguna: la respuesta final dice que no lo hizo y que no pudo (nunca la promesa)', () => {
  const dicho = 'Va, te abro Spotify.';
  const promesa = { correccion: 'repregunta' as const, cumplida: false, candidatas: ['abrir_en_telefono'], ms: 900 };
  assert.equal(debeCorregirSinHerramienta({ promesa, usoManos: false, borradorPendiente: false, pasos: [], dicho, mensaje: 'abre Spotify' }), true);
  const c = corregirPromesaSinHerramienta(dicho, 'es', { sinHerramienta: false, mensaje: 'abre Spotify' });
  assert.equal(c.texto, 'Eso todavía no lo hice: no pude hacerlo esta vez.');
  assert.doesNotMatch(c.texto, /te abro/i);
  // Contestó «NADA» (el registro de José: «promesa-sin-recibo»): lo prometido es lo pedido → se corrige igual.
  assert.equal(debeCorregirSinHerramienta({ promesa: { ...promesa, nada: true }, usoManos: false, borradorPendiente: false, pasos: [], dicho, mensaje: 'abre Spotify' }), false);
  assert.equal(promesaSinCumplir({ dicho, mensaje: 'abre Spotify' }), true);
});

/* ------------------------------------------------------------------ honestidad: el recibo del aparato */

test('honestidad (F02): una acción del teléfono NO consta por su tipo; con el recibo del aparato, sí', () => {
  const enCurso = recibosDeAcciones([{ tipo: 'abrir_app', app: 'Spotify' }]);
  assert.deepEqual(enCurso, [{ canal: 'app', estado: 'en-curso', destino: 'Spotify' }]);
  assert.equal(guardaDeHonestidad('Listo, ya abrí Spotify.', { recibos: [], mensaje: 'abre Spotify' }).texto, 'Todavía no la abrí.');
  assert.equal(guardaDeHonestidad('Listo, ya abrí Spotify.', { recibos: enCurso, mensaje: 'abre Spotify' }).texto, 'La mandé a abrir en tu teléfono; si no la tienes, te aviso.');
  assert.equal(guardaDeHonestidad('Listo, ya abrí Spotify.', { recibos: [{ canal: 'app', estado: 'confirmado', destino: 'Spotify' }], mensaje: 'abre Spotify' }).cambiada, false);
  assert.equal(guardaDeHonestidad('Abriendo Spotify…', { recibos: [], mensaje: 'abre Spotify' }).cambiada, false, 'decir lo que hace no es dar por hecho');
  // Un recordatorio que salió al teléfono: el compromiso («te llamo a las 5») vale; «quedó puesta» espera el recibo.
  const rec = recibosDeAcciones([{ tipo: 'recordatorio' }]);
  assert.equal(guardaDeHonestidad('Listo, te llamo a las 5:00 de la tarde.', { recibos: rec, mensaje: 'recuérdame a las 5' }).cambiada, false);
  assert.equal(guardaDeHonestidad('Listo, tu alarma quedó puesta.', { recibos: rec, mensaje: 'ponme una alarma a las 6' }).texto, 'Lo mandé a tu teléfono; te confirmo en cuanto quede puesto.');
  assert.equal(guardaDeHonestidad('Listo, tu alarma quedó puesta.', { recibos: [{ canal: 'recordatorio', estado: 'confirmado' }], mensaje: 'ponme una alarma a las 6' }).cambiada, false);
  // El calendario del teléfono: solo se abrió la pantalla para que ella confirme.
  const cal = recibosDeAcciones([{ tipo: 'evento_calendario' }]);
  assert.equal(guardaDeHonestidad('Listo, quedó en tu calendario.', { recibos: cal, mensaje: 'agenda el dentista' }).texto, 'Te abrí la pantalla para que lo confirmes: queda agendado cuando tú lo guardes.');
  // El SMS: un borrador en su teléfono, nunca «enviado».
  const sms = recibosDeAcciones([{ tipo: 'sms' }]);
  assert.equal(guardaDeHonestidad('Listo, mensaje enviado.', { recibos: sms, mensaje: 'mándale un SMS a mi mamá' }).texto, 'Te dejé el SMS listo en tu teléfono: sale cuando tú le das enviar.');
});

/* ------------------------------------------------------------------ el registro de recibos (servidor) */

const CORREO = 'jose@ejemplo.com';
const salida = (id: string, accion: Record<string, unknown> & { tipo: string }, aparato: string | null = 'tel-1', t = Date.now()) => anotarAccionSalida(CORREO, { id, accion }, aparato, t);

test('el recibo del aparato: solo de un id que salió a esa cuenta y ese aparato; el primero manda; nunca se inventa (reinicio, tarde, ajeno)', () => {
  salida('a1', { tipo: 'abrir_app', app: 'Spotify' });
  salida('p1', { tipo: 'abrir', pantalla: 'ajustes' });
  assert.equal(salidaDe(CORREO, 'p1'), undefined, 'una pantalla de AU-RA no espera recibo de aparato');
  assert.deepEqual(recibirRecibo(CORREO, { id: 'zz', ok: true }, 'tel-1'), { estado: 'desconocido' });
  assert.deepEqual(recibirRecibo('otra@ejemplo.com', { id: 'a1', ok: true }, 'tel-1'), { estado: 'desconocido' }, 'de otra cuenta no');
  assert.deepEqual(recibirRecibo(CORREO, { id: 'a1', ok: true }, 'tel-2'), { estado: 'otro-aparato' });
  const r = recibirRecibo(CORREO, { id: 'a1', ok: true }, 'tel-1');
  assert.equal(r.estado, 'aceptado');
  if (r.estado === 'aceptado') assert.deepEqual({ ...r.efecto, t: 0 }, { canal: 'app', estado: 'confirmado', destino: 'Spotify', t: 0 });
  assert.deepEqual(recibirRecibo(CORREO, { id: 'a1', ok: false }, 'tel-1'), { estado: 'repetido', ok: true, tipo: 'abrir_app' }, 'repetido o tardío no cambia lo que pasó');
  // Tarde (pasada su vida) y tras un reinicio: nada.
  salida('v1', { tipo: 'recordatorio', texto: 'x', cuando: 1 }, 'tel-1', Date.now() - 16 * 60_000);
  assert.deepEqual(recibirRecibo(CORREO, { id: 'v1', ok: true }, 'tel-1'), { estado: 'vencido' }, 'tarde: no confirma nada');
  salida('v2', { tipo: 'recordatorio', texto: 'x', cuando: 1 }, 'tel-1');
  _olvidarSalidas();
  assert.deepEqual(recibirRecibo(CORREO, { id: 'v2', ok: true }, 'tel-1'), { estado: 'desconocido' });
});

test('el turno espera un momento el recibo: llega → confirmado; falla → fallida (no «en curso»); no llega → sin recibo, sin inventar', async () => {
  salida('r1', { tipo: 'alarma', hora: 6, minutos: 0 });
  salida('r2', { tipo: 'abrir_app', app: 'Netflix' });
  salida('r3', { tipo: 'recordatorio', texto: 'pastilla', cuando: 1 });
  setTimeout(() => recibirRecibo(CORREO, { id: 'r1', ok: true }, 'tel-1'), 20);
  setTimeout(() => recibirRecibo(CORREO, { id: 'r2', ok: false, detalle: 'No encuentro Netflix' }, 'tel-1'), 30);
  const t0 = Date.now();
  const e = await esperarRecibos(CORREO, ['r1', 'r2', 'r3', 'desconocido'], 200);
  assert.ok(Date.now() - t0 >= 150, 'esperó hasta el tope por r3');
  assert.deepEqual(e.recibos.map((r) => r.canal), ['recordatorio']);
  assert.deepEqual([...e.fallidas.entries()], [['r2', 'No encuentro Netflix']]);
  assert.deepEqual(e.sinRecibo, ['r3']);
  // Cuando ya están todos, no espera.
  const t1 = Date.now();
  await esperarRecibos(CORREO, ['r1', 'r2'], 5_000);
  assert.ok(Date.now() - t1 < 100);
});

test('la burbuja con la app cerrada y sin permiso de alarmas: el recordatorio nunca se da por puesto sin recibo confirmado', () => {
  // La burbuja no completa recordatorios (dependen del cliente de la app): el servidor ni la ofrece ni la manda.
  assert.equal(completaAqui('recordatorio', 'burbuja', capacidadesDeSuperficie('burbuja', { android: true, electrum: false })), false);
  // Y si salió a un teléfono que contesta que falló (sin permiso), nada queda como hecho.
  salida('b1', { tipo: 'recordatorio', texto: 'pastilla', cuando: 1 });
  const r = recibirRecibo(CORREO, { id: 'b1', ok: false, detalle: 'Sin permiso de alarmas exactas' }, 'tel-1');
  assert.equal(r.estado === 'aceptado' && r.efecto, null);
  assert.deepEqual(efectosRecientes(CORREO), []);
  assert.equal(guardaDeHonestidad('Listo, tu recordatorio quedó puesto.', { recibos: [], previos: efectosRecientes(CORREO), mensaje: 'recuérdame la pastilla a las 8' }).cambiada, true);
  // Una consulta y una acción real del servidor guardan sus recibos (los del harness) como siempre.
  anotarEfectoReal(CORREO, { canal: 'correo', estado: 'confirmado', destino: 'Ana' });
  assert.equal(guardaDeHonestidad('Sí, ya se lo mandé a Ana.', { recibos: [], previos: efectosRecientes(CORREO), mensaje: '¿ya le mandaste el correo a Ana?' }).cambiada, false);
});

/* ------------------------------------------------------------------ el contrato por superficie */

test('qué completa cada superficie: la mesa todo lo suyo; la burbuja solo lo del teléfono (y «llámame», que pasa a la app); Windows y la web nada local', () => {
  const burbuja = capacidadesDeSuperficie('burbuja', { android: true, electrum: false });
  assert.deepEqual(burbuja, ['abrir_apps', 'intents_telefono', 'llamame']);
  assert.deepEqual(capacidadesDeSuperficie('burbuja', { android: true, electrum: true }), [], 'Dr Electrum: nada');
  const mesa = capacidadesDeSuperficie('mesa', { android: true, electrum: false });
  assert.ok(mesa.includes('pantallas') && mesa.includes('revision') && mesa.includes('recordatorio') && mesa.includes('abrir_apps'));
  assert.ok(!capacidadesDeSuperficie('mesa', { android: false, electrum: false }).includes('abrir_apps'));
  assert.equal(claseDeAccion('abrir_app', 'burbuja', burbuja), 'local');
  assert.equal(claseDeAccion('abrir', 'burbuja', burbuja), 'no_soportada', 'navegar la app de atrás, no');
  assert.equal(claseDeAccion('redactar', 'burbuja', burbuja), 'revision');
  assert.equal(completaAqui('redactar', 'burbuja', burbuja), false, 'la burbuja no muestra la ventana de decisión');
  assert.equal(completaAqui('redactar', 'mesa', mesa), true);
  assert.equal(completaAqui('recordatorio', 'mesa', undefined), true, 'una app de antes sin capacidades: lo de siempre');
  assert.equal(claseDeAccion('abrir_app', 'windows'), 'no_soportada');
  assert.equal(claseDeAccion('buscar_web', 'web'), 'servidor');
  assert.equal(superficieDelTurno({ origen: 'app', superficie: 'burbuja' }), 'burbuja');
  assert.equal(superficieDelTurno({ origen: 'app' }), 'mesa');
  assert.equal(superficieDelTurno({ origen: 'windows', superficie: 'burbuja' }), 'windows');
  assert.equal(superficieDelTurno({}), 'web');
  assert.deepEqual(capacidadesDelTurno({ capacidades: ['abrir_apps', 'abrir_apps', 'MAL', 7, 'pantallas'] }), ['abrir_apps', 'pantallas']);
  assert.deepEqual(manosDeSuperficie('burbuja', ['recordatorio', 'llamar'], burbuja), ['abrir_apps', 'intents_telefono', 'llamame'], 'en la burbuja, solo lo que ella declara');
  assert.deepEqual(manosDeSuperficie('mesa', ['recordatorio'], ['abrir_apps', 'pantallas']), ['recordatorio', 'abrir_apps']);
  assert.deepEqual(manosDeSuperficie('web', ['recordatorio'], ['abrir_apps']), []);
});

test('un «sí» en la burbuja, sin la propuesta a la vista, no se ata a nada (no ejecuta)', () => {
  const o = { hablado: false, decisionVista: { tareaId: 't', decisionId: 'd', huella: 'abcdefgh12' }, aparato: 'tel-1', mensaje: 'sí' };
  assert.deepEqual(decisionDeSuperficie('burbuja', o), { hablado: true, decisionVista: undefined, aparato: undefined, mensaje: 'sí' });
  assert.equal(decisionDeSuperficie('mesa', o), o, 'en la mesa, lo de siempre');
});

test('el respaldo del stream conserva el turno: si el servidor ya lo tiene, solo se repite; si no le llegó, recién se pide', () => {
  assert.equal(planRespaldo({ status: 200, json: { repetido: true, reply: 'Abriendo Spotify…' } }), 'repetir');
  assert.equal(planRespaldo({ status: 409, json: { enCurso: true } }), 'repetir');
  assert.equal(planRespaldo({ status: 200, json: { repetido: true, reconciliando: true } }), 'repetir', 'un efecto incierto se reconcilia, no se repite');
  assert.equal(planRespaldo({ status: 404, json: { codigo: 'no_existe' } }), 'pedir');
  assert.equal(planRespaldo(null), 'pedir', 'sin red: con el mismo idTurno (el servidor nunca corre dos)');
});

/* ------------------------------------------------------------------ «que no se mix con otras cosas»: los objetivos */

const ob = (x: Partial<ObjetivoParaTurno>): ObjetivoParaTurno => ({ titulo: 'Propuesta para el banco', estado: 'en-curso', actualizado: 1, ...x });

test('el bloque de objetivos solo cuando viene al caso: seguir, el trabajo, un objetivo nombrado, o qué decidir si algo espera', () => {
  const xs = [ob({}), ob({ titulo: 'Mudanza a Tegucigalpa', estado: 'abierto' })];
  for (const m of ['Abre Spotify', 'pon música en Spotify', '¿Cómo está el clima?', 'Cuéntame un chiste', '¿Qué opinas de la música de los noventa?', 'sigue lloviendo afuera']) assert.equal(objetivosAlCaso(m, xs), false, m);
  for (const m of ['Sigue', 'continúa con lo de ayer', '¿En qué quedamos?', '¿Cómo va el trabajo?', '¿Cómo va la propuesta?', '¿qué tengo pendiente?', '¿y lo de la mudanza?', 'retoma el objetivo'])
    assert.equal(objetivosAlCaso(m, xs), true, m);
  // «¿Qué falta?» solo si un objetivo espera su decisión.
  assert.equal(objetivosAlCaso('¿Qué falta?', xs), false);
  assert.equal(objetivosAlCaso('¿Qué falta?', [ob({ estado: 'esperando-decision', decisiones: [{ pregunta: '¿La mando hoy?', opciones: [{ etiqueta: 'Hoy' }] }] })]), true);
  assert.equal(objetivosAlCaso('Sigue', []), false, 'sin objetivos abiertos, nunca');
  assert.equal(objetivosAlCaso('Sigue', [ob({ estado: 'completado' })]), false);
});

test('el bloque del turno desde el almacén respeta el mensaje: «abre Spotify» va sin él; «¿en qué quedamos?» con él', async () => {
  _olvidarObjetivosDelTurno();
  const a = almacenEnMemoria();
  const yo = `obj-${Date.now()}@ejemplo.com`;
  const c = await crearObjetivo(yo, { requestId: 'tel-obj-1', titulo: 'Propuesta para el banco', criterioCierre: ['PDF'], siguientePaso: 'Reunir anexos' }, { almacen: a });
  assert.ok(c.ok);
  assert.equal(await bloqueObjetivosDelTurno(yo, { plataforma: 'ultron', almacen: a, esperaMs: 2000, mensaje: 'Abre Spotify' }), '');
  assert.match(await bloqueObjetivosDelTurno(yo, { plataforma: 'ultron', almacen: a, esperaMs: 2000, mensaje: '¿En qué quedamos?' }), /Propuesta para el banco/);
  assert.match(await bloqueObjetivosDelTurno(yo, { plataforma: 'ultron', almacen: a, esperaMs: 2000 }), /Propuesta para el banco/, 'sin mensaje, como antes');
});

/* ------------------------------------------------------------------ el registro de aparatos */

test('el registro de aparatos: el latido validado queda en el almacén durable (sobrevive a un reinicio) y el turno lleva una línea corta', async () => {
  const a = almacenEnMemoria();
  _usarAlmacenDurable(a);
  _olvidarAparatos();
  assert.equal(latidoValido(null, { tipo: 'android' }), null, 'sin el id del aparato, nada');
  assert.equal(latidoValido('tel-1', { tipo: 'nevera' }), null);
  const l = latidoValido('tel-1', { tipo: 'android', superficie: 'mesa', version: '5.7.1', habilidades: ['abrir_apps', 'recordatorio', 'MAL'], permisos: { alarmas_exactas: 'no', notificaciones: 'si', raro: 'quizá' } }, 1_000);
  assert.deepEqual(l, { id: 'tel-1', tipo: 'android', superficie: 'mesa', version: '5.7.1', habilidades: ['abrir_apps', 'recordatorio'], permisos: { alarmas_exactas: 'no', notificaciones: 'si' }, ultimoLatido: 1_000 });
  assert.deepEqual(await anotarLatido(CORREO, l!), { guardado: true });
  assert.deepEqual(await anotarLatido(CORREO, { ...l!, ultimoLatido: 2_000 }), { guardado: false }, 'el mismo latido al rato no escribe');
  _olvidarAparatos(); // como un despliegue
  const vuelta = await aparatosDe(CORREO, { almacen: a, esperaMs: 2000 });
  assert.equal(vuelta.length, 1);
  assert.equal(vuelta[0].version, '5.7.1');
  assert.equal(lineaAparatos(vuelta, 'tel-1', 1_000 + 60_000), 'APARATOS EN LÍNEA: este teléfono (app 5.7.1): abrir apps, recordatorios; sin permiso de alarmas_exactas.');
  assert.equal(lineaAparatos(vuelta, 'tel-1', 1_000 + 10 * 60_000), '', 'sin latido reciente no está en línea');
});

/* ------------------------------------------------------------------ «Compartir → AU-RA» y los permisos */

test('lo compartido con AU-RA: un turno nuevo con eso como contexto (texto, enlace o foto), una sola vez', () => {
  assert.equal(pedidoDeCompartido(null), null);
  assert.equal(pedidoDeCompartido({ texto: '   ' }), null);
  assert.deepEqual(pedidoDeCompartido({ texto: 'https://ejemplo.com/nota' }), { mensaje: 'Te comparto este enlace desde otra app: https://ejemplo.com/nota ¿De qué se trata?' });
  assert.deepEqual(pedidoDeCompartido({ texto: 'La reunión es a las 3', asunto: 'Reunión' }), { mensaje: 'Te comparto esto desde otra app: «Reunión — La reunión es a las 3». ¿Qué me dices?' });
  assert.deepEqual(pedidoDeCompartido({ imagen: 'file:///cache/compartido-1.jpg' }), { mensaje: 'Te comparto esta imagen desde otra app. ¿Qué ves?', imagen: 'file:///cache/compartido-1.jpg', mime: 'image/jpeg' });
  // El tipo real viaja (PNG, WebP): la visión confía en el tipo declarado; uno raro queda en JPEG.
  assert.equal(pedidoDeCompartido({ tipo: 'image/png', imagen: 'file:///cache/c.png' })?.mime, 'image/png');
  assert.equal(pedidoDeCompartido({ tipo: 'image/webp', imagen: 'file:///cache/c.webp' })?.mime, 'image/webp');
  assert.equal(pedidoDeCompartido({ tipo: 'image/svg+xml', imagen: 'file:///cache/c.svg' })?.mime, 'image/jpeg');
  assert.equal(pedidoDeCompartido({ imagen: 'javascript:x' }), null);
  const vistos: string[] = [];
  const quitar = escucharCompartido((p) => vistos.push(p.mensaje));
  guardarCompartido({ mensaje: 'uno' }, 1_000);
  assert.deepEqual(vistos, ['uno']);
  assert.deepEqual(tomarCompartido(1_500), { mensaje: 'uno' });
  assert.equal(tomarCompartido(1_600), null, 'una sola vez');
  guardarCompartido({ mensaje: 'viejo' }, 0);
  assert.equal(tomarCompartido(10 * 60_000), null, 'lo viejo no se dice');
  quitar();
  assert.deepEqual(permisosDeNotifee({ authorizationStatus: 1, android: { alarm: 0 } }), { notificaciones: 'si', alarmas_exactas: 'no' });
  assert.deepEqual(permisosDeNotifee({ authorizationStatus: -1, android: { alarm: -1 } }), { notificaciones: 'preguntar' });
});

test('los nombres que exporta el plugin y la versión de la APK de las manos', () => {
  const j = JSON.parse(fs.readFileSync(path.join(raizMovil, 'app.json'), 'utf8'));
  assert.equal(j.expo.version, '5.7.1');
  assert.equal(j.expo.android.versionCode, 57);
  // app.json (la base de las dos apps) NO pide SET_ALARM: va solo por el plugin de AU-RA. Dr Electrum queda igual.
  assert.ok(!j.expo.android.permissions.includes('com.android.alarm.permission.SET_ALARM'));
});

test('nombrar otra app no le quita a AU-RA sus pantallas cuando la promesa es interna (límites de palabra reales, PR #173)', async () => {
  const { herramientasPara } = await import('../lib/cerebro-manos');
  assert.ok(herramientasPara('Te abro el chat sobre Spotify').has('chat_aura'), 'el chat de AU-RA sigue');
  assert.ok(!herramientasPara('Te abro Spotify').has('chat_aura'), 'abrir Spotify no lo cumple una pantalla de AU-RA');
});
