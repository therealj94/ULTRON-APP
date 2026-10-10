/**
 * AU-RA COMO ASISTENTE DIGITAL DEL TELÉFONO (Fase 1 del plan): el botón lateral, la burbuja, el mosaico y el atajo.
 *
 * José quiere llamar a AURA desde su Samsung S26 manteniendo el botón lateral (One UI 7+: Ajustes → Funciones
 * avanzadas → Botón lateral → Mantener pulsado → Asistente digital → AU-RA), y que salga como sale ChatGPT cuando es el
 * asistente: ENCIMA de lo que tenga abierto, con la pantalla de atrás oscurecida, el orbe abajo y dos botones (escribir
 * y cámara). Eso es la burbuja: src/burbuja/Burbuja.tsx, dibujada en una actividad translúcida.
 *
 * Este plugin pone, SOLO en la APK de AU-RA (app.config.js lo registra en la rama de AU-RA; Dr Electrum no lo ve):
 *
 *  · ServicioAura (VoiceInteractionService, BIND_VOICE_INTERACTION) con res/xml/aura_interaccion_voz.xml
 *    (sessionService, recognitionService, supportsAssist, sin abrir desde el bloqueo). Es lo que hace a AU-RA elegible
 *    para el rol ASSISTANT de Android (la lista «Asistente digital»).
 *  · SesionAuraServicio: su sesión abre la burbuja en onShow y se esconde (sin React ni audio ahí).
 *  · ReconocedorAura: el reconocedor que el XML exige. NO es un trozo vacío: le pasa el dictado al reconocedor de
 *    verdad del teléfono, porque al elegir AU-RA como asistente Android lo vuelve el reconocedor por omisión de todo el
 *    teléfono (ver ReconocedorAura.kt).
 *  · BurbujaActivity: la burbuja (translúcida, tarea propia, fuera de Recientes, sin showWhenLocked) con los filtros
 *    ASSIST y VOICE_COMMAND: la segunda vía para el rol ASSISTANT y la del botón del manos libres.
 *  · MosaicoAura: el mosaico «Hablar con AURA» de Ajustes rápidos (BIND_QUICK_SETTINGS_TILE).
 *  · El atajo estático del ícono (res/xml/aura_atajos.xml + meta-data android.app.shortcuts en MainActivity).
 *
 * POR QUÉ EL CÓDIGO NATIVO VA EN LA APP (copiado por este plugin) Y NO EN UN MÓDULO LOCAL (modules/aura-*):
 *  · BurbujaActivity es una ReactActivity con el mismo ReactActivityDelegateWrapper que MainActivity (el de `expo`, el
 *    que da los ciclos de vida de los módulos de Expo). Un módulo local no puede depender del proyecto `expo` (que ya
 *    depende de todos los módulos: sería un ciclo en Gradle), y además la burbuja usa el BuildConfig y la R de la app.
 *  · Los módulos de modules/ se enlazan en LAS DOS apps (autolinking); aquí no queda ni una clase ni un recurso del
 *    asistente en la APK de Dr Electrum.
 *  · prebuild --clean regenera android/ entero en cada compilación (no hay carpeta android/ en el repo): copiar en
 *    cada prebuild es justo lo que hace falta, sin nada que se quede viejo.
 * Las plantillas viven en plugins/asistente-digital-nativo/ como archivos .kt/.xml normales (se leen y se revisan como
 * código); `__PAQUETE__` y `__ESQUEMA__` se cambian por el paquete y el esquema de la configuración.
 *
 * LAS MANOS EN EL TELÉFONO (APK 5.7.1; José, 10-oct: «le pedí abrir Spotify y no pudo»): TelefonoAura.kt es un módulo
 * nativo de React Native (`AuraTelefono`) que lista y abre las apps del teléfono, abre enlaces profundos y usa los intents
 * estándar (alarma y temporizador con AlarmClock, navegar, el marcador con ACTION_DIAL, un borrador de SMS con SENDTO, la
 * pantalla de un evento nuevo del calendario) y recibe lo que otra app le comparte (ACTION_SEND). Este plugin lo registra
 * en MainApplication (getPackages: no es un módulo de modules/ porque esos se enlazan también en Dr Electrum) y pone en el
 * manifiesto lo que Android 11+ exige para ver esas apps: un `<queries>` con MAIN/LAUNCHER y cada intent que se resuelve
 * (NUNCA QUERY_ALL_PACKAGES), el permiso normal SET_ALARM y el filtro SEND de MainActivity. Sin CALL_PHONE ni SEND_SMS:
 * marcar y el SMS solo abren la pantalla con todo puesto; ella da el último toque.
 *
 * LA GUARDIA NATIVA DE LA LLAMADA DEL AVATAR (APK 5.7.1): GuardiaLlamadaAura.kt (`AuraGuardiaLlamada`) va en el mismo
 * paquete (TelefonoAuraPaquete la sirve también): un plazo en el Handler del hilo principal que cuelga la llamada que se
 * quedó detrás aunque los relojes de JS estén congelados (src/compa/fondoLlamada.ts). No añade nada al manifiesto: ni
 * servicio en primer plano nuevo, ni permisos (Android 14 no deja arrancar uno de micrófono desde segundo plano, y
 * `phoneCall` sigue prohibido: plugins/servicio-llamada.js).
 *
 * JS no necesita un módulo nativo para cerrar la burbuja: `BackHandler.exitApp()` llega a la actividad que está delante
 * (la burbuja) y su `invokeDefaultOnBackPressed` hace finish(); y al dejar de verse se termina sola (onStop).
 *
 * Se comprueba regenerando el nativo (`npx expo prebuild -p android --no-install --clean`) y leyendo
 * android/app/src/main/AndroidManifest.xml; las piezas, en tests/asistente-digital-movil.test.ts.
 */
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod, withMainApplication } = require('expo/config-plugins');

const PLANTILLAS = path.join(__dirname, 'asistente-digital-nativo');

/** Los nombres de las piezas, relativos al paquete (`<paquete>.asistente.X`). */
const PIEZAS = {
  servicio: 'asistente.ServicioAura',
  sesion: 'asistente.SesionAuraServicio',
  reconocedor: 'asistente.ReconocedorAura',
  burbuja: 'asistente.BurbujaActivity',
  mosaico: 'asistente.MosaicoAura',
};

const ACCION_VIS = 'android.service.voice.VoiceInteractionService';
const ACCION_RECONOCEDOR = 'android.speech.RecognitionService';
const ACCION_MOSAICO = 'android.service.quicksettings.action.QS_TILE';
const PERMISO_VOZ = 'android.permission.BIND_VOICE_INTERACTION';
const PERMISO_MOSAICO = 'android.permission.BIND_QUICK_SETTINGS_TILE';

/** Igual que MainActivity: rotar o cambiar el tema no recrea la burbuja (perdería el micrófono a media frase). */
const CAMBIOS = 'keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|smallestScreenSize|density';

const nombre = (paquete, pieza) => `${paquete}.${PIEZAS[pieza]}`;

function filtro(accion, categoria) {
  return { action: [{ $: { 'android:name': accion } }], ...(categoria ? { category: [{ $: { 'android:name': categoria } }] } : {}) };
}

/** Las piezas del asistente, tal cual van dentro de <application>. */
function piezasManifiesto(paquete) {
  return {
    actividades: [
      {
        $: {
          'android:name': nombre(paquete, 'burbuja'),
          'android:label': '@string/aura_hablar',
          'android:theme': '@style/Theme.AuraBurbuja',
          'android:exported': 'true',
          'android:launchMode': 'singleTask',
          // Su propia tarea: abrirla no trae a MainActivity al frente, y «Abrir en AURA» abre la app en la suya.
          'android:taskAffinity': `${paquete}.burbuja`,
          'android:excludeFromRecents': 'true',
          'android:configChanges': CAMBIOS,
          'android:windowSoftInputMode': 'adjustResize',
          'android:screenOrientation': 'unspecified',
          // NUNCA showWhenLocked / turnScreenOn: con el teléfono bloqueado, Android pide desbloquear (privacidad).
        },
        'intent-filter': [filtro('android.intent.action.ASSIST', 'android.intent.category.DEFAULT'), filtro('android.intent.action.VOICE_COMMAND', 'android.intent.category.DEFAULT')],
      },
    ],
    servicios: [
      {
        $: { 'android:name': nombre(paquete, 'servicio'), 'android:label': '@string/app_name', 'android:permission': PERMISO_VOZ, 'android:exported': 'true' },
        'meta-data': [{ $: { 'android:name': 'android.voice_interaction', 'android:resource': '@xml/aura_interaccion_voz' } }],
        'intent-filter': [filtro(ACCION_VIS)],
      },
      { $: { 'android:name': nombre(paquete, 'sesion'), 'android:permission': PERMISO_VOZ, 'android:exported': 'true' } },
      {
        $: { 'android:name': nombre(paquete, 'reconocedor'), 'android:label': '@string/aura_reconocedor', 'android:exported': 'true' },
        'intent-filter': [filtro(ACCION_RECONOCEDOR, 'android.intent.category.DEFAULT')],
      },
      {
        $: {
          'android:name': nombre(paquete, 'mosaico'),
          'android:label': '@string/aura_hablar',
          'android:icon': '@drawable/aura_mosaico',
          'android:permission': PERMISO_MOSAICO,
          'android:exported': 'true',
        },
        'intent-filter': [filtro(ACCION_MOSAICO)],
      },
    ],
  };
}

/** ¿Este nombre es una de las piezas del asistente? (para reescribir en vez de duplicar en otra corrida). */
function esPieza(paquete, n) {
  return Object.keys(PIEZAS).some((p) => n === nombre(paquete, p) || n === `.${PIEZAS[p]}`);
}

/* ── las manos en el teléfono ──────────────────────────────────────────────────────────────── */

/** Los esquemas de enlace que abre (lib/telefono-apps.ts ESQUEMAS_ENLACE y TelefonoAura.kt). */
const ESQUEMAS_ENLACE = ['spotify', 'whatsapp', 'geo', 'https', 'tel', 'mailto'];
/** El permiso normal de poner alarmas y temporizadores (AlarmClock). Nunca CALL_PHONE, SEND_SMS ni QUERY_ALL_PACKAGES. */
const PERMISO_ALARMA = 'com.android.alarm.permission.SET_ALARM';
const PERMISOS_PROHIBIDOS = ['android.permission.QUERY_ALL_PACKAGES', 'android.permission.CALL_PHONE', 'android.permission.SEND_SMS'];

/** Un `<intent>` de `<queries>`: la acción y, si hace falta, la categoría y el esquema o el tipo. */
function intentConsulta(accion, { categoria, esquema, tipo } = {}) {
  const i = { action: [{ $: { 'android:name': accion } }] };
  if (categoria) i.category = [{ $: { 'android:name': categoria } }];
  if (esquema) i.data = [{ $: { 'android:scheme': esquema } }];
  else if (tipo) i.data = [{ $: { 'android:mimeType': tipo } }];
  return i;
}

/**
 * Las consultas de visibilidad de paquetes (Android 11+): sin ellas, queryIntentActivities y resolveActivity no ven las
 * apps de otros. Lo justo para lo que hace TelefonoAura.kt.
 */
function consultasTelefono() {
  return [
    intentConsulta('android.intent.action.MAIN', { categoria: 'android.intent.category.LAUNCHER' }),
    ...ESQUEMAS_ENLACE.map((esquema) => intentConsulta('android.intent.action.VIEW', { esquema })),
    intentConsulta('android.intent.action.VIEW', { esquema: 'google.navigation' }),
    intentConsulta('android.intent.action.SET_ALARM'),
    intentConsulta('android.intent.action.SET_TIMER'),
    intentConsulta('android.intent.action.DIAL', { esquema: 'tel' }),
    intentConsulta('android.intent.action.SENDTO', { esquema: 'smsto' }),
    intentConsulta('android.intent.action.INSERT', { tipo: 'vnd.android.cursor.dir/event' }),
  ];
}

const firmaIntent = (i) => JSON.stringify([i.action, i.category || null, i.data || null]);

/** El `<queries>` con las consultas del teléfono (idempotente: lo que ya estaba no se duplica). */
function conConsultas(manifiesto) {
  const m = manifiesto.manifest;
  if (!Array.isArray(m.queries) || !m.queries.length) m.queries = [{}];
  const q = m.queries[0];
  const ya = new Set((q.intent || []).map(firmaIntent));
  q.intent = [...(q.intent || []), ...consultasTelefono().filter((i) => !ya.has(firmaIntent(i)))];
  return manifiesto;
}

/** El permiso de alarmas (normal) y fuera los prohibidos si algo los hubiera puesto. */
function conPermisosTelefono(manifiesto) {
  const m = manifiesto.manifest;
  const actuales = (m['uses-permission'] || []).filter((p) => !PERMISOS_PROHIBIDOS.includes(p?.$?.['android:name']));
  if (!actuales.some((p) => p?.$?.['android:name'] === PERMISO_ALARMA)) actuales.push({ $: { 'android:name': PERMISO_ALARMA } });
  m['uses-permission'] = actuales;
  return manifiesto;
}

/** El filtro de «Compartir» en MainActivity: texto, enlaces e imágenes que otra app le manda a AU-RA. */
const filtrosCompartir = () =>
  ['text/plain', 'image/*'].map((tipo) => ({
    action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
    category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
    data: [{ $: { 'android:mimeType': tipo } }],
  }));
const esFiltroCompartir = (f) => (f?.action || []).some((a) => a?.$?.['android:name'] === 'android.intent.action.SEND');

function conCompartir(manifiesto) {
  const principal = AndroidConfig.Manifest.getMainActivityOrThrow(manifiesto);
  principal['intent-filter'] = [...(principal['intent-filter'] || []).filter((f) => !esFiltroCompartir(f)), ...filtrosCompartir()];
  return manifiesto;
}

/** La línea que registra el módulo en MainApplication (getPackages). */
const lineaPaquete = (paquete) => `${paquete}.asistente.TelefonoAuraPaquete()`;

/**
 * Registra TelefonoAuraPaquete en getPackages de MainApplication.kt (las dos formas de la plantilla: `.apply { … }` de la
 * SDK 54 y `val packages = …` de antes). Idempotente. Si no reconoce la plantilla, falla el prebuild: mejor eso que una APK
 * que en silencio no abre nada.
 */
function conPaqueteTelefono(fuente, paquete) {
  const linea = lineaPaquete(paquete);
  if (fuente.includes(linea)) return fuente;
  const conApply = /PackageList\(this\)\.packages\.apply\s*\{/;
  if (conApply.test(fuente)) return fuente.replace(conApply, (m) => `${m}\n              add(${linea})`);
  const conVal = /val\s+packages\s*=\s*PackageList\(this\)\.packages/;
  if (conVal.test(fuente)) return fuente.replace(conVal, (m) => `${m}\n            packages.add(${linea})`);
  throw new Error('asistente-digital: no encontré getPackages en MainApplication para registrar TelefonoAuraPaquete');
}

/**
 * Pone las piezas en el manifiesto (idempotente) y el atajo en MainActivity. Puro sobre el objeto del manifiesto: las
 * pruebas lo llaman sin prebuild.
 */
function conAsistente(manifiesto, paquete) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifiesto);
  const { actividades, servicios } = piezasManifiesto(paquete);
  app.activity = [...(app.activity || []).filter((a) => !esPieza(paquete, a?.$?.['android:name'])), ...actividades];
  app.service = [...(app.service || []).filter((s) => !esPieza(paquete, s?.$?.['android:name'])), ...servicios];

  const principal = AndroidConfig.Manifest.getMainActivityOrThrow(manifiesto);
  const meta = (principal['meta-data'] || []).filter((m) => m?.$?.['android:name'] !== 'android.app.shortcuts');
  principal['meta-data'] = [...meta, { $: { 'android:name': 'android.app.shortcuts', 'android:resource': '@xml/aura_atajos' } }];
  // Las manos en el teléfono (TelefonoAura.kt): lo que Android 11+ exige para ver las apps, la alarma y «Compartir».
  conConsultas(manifiesto);
  conPermisosTelefono(manifiesto);
  conCompartir(manifiesto);
  return manifiesto;
}

/** Recorre las plantillas: { ruta relativa dentro de la plantilla → contenido ya con paquete y esquema }. */
function archivosNativos({ paquete, esquema }) {
  const fuera = {};
  const recorrer = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) recorrer(abs, r);
      else fuera[r] = fs.readFileSync(abs, 'utf8').replace(/__PAQUETE__/g, paquete).replace(/__ESQUEMA__/g, esquema);
    }
  };
  recorrer(PLANTILLAS, '');
  return fuera;
}

/** Dónde va cada plantilla dentro de android/app/src/main (el Kotlin, en la carpeta del paquete). */
function destinoDe(rel, paquete) {
  if (rel.startsWith('java/')) return path.join('java', ...paquete.split('.'), 'asistente', rel.slice('java/'.length));
  return rel; // res/…
}

function escribirNativo(raizAndroid, { paquete, esquema }) {
  const main = path.join(raizAndroid, 'app', 'src', 'main');
  const escritos = [];
  for (const [rel, contenido] of Object.entries(archivosNativos({ paquete, esquema }))) {
    const destino = path.join(main, destinoDe(rel, paquete));
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, contenido);
    escritos.push(destino);
  }
  return escritos;
}

function datosDe(config) {
  const paquete = config.android?.package;
  if (!paquete) throw new Error('asistente-digital: falta android.package en la configuración');
  const esquema = Array.isArray(config.scheme) ? config.scheme[0] : config.scheme;
  if (!esquema) throw new Error('asistente-digital: falta `scheme` (la burbuja se abre con <esquema>://burbuja)');
  return { paquete, esquema };
}

function asistenteDigital(config) {
  config = withDangerousMod(config, [
    'android',
    async (c) => {
      escribirNativo(c.modRequest.platformProjectRoot, datosDe(c));
      return c;
    },
  ]);
  config = withMainApplication(config, (c) => {
    if (c.modResults.language !== 'kt') throw new Error('asistente-digital: MainApplication tiene que ser Kotlin');
    c.modResults.contents = conPaqueteTelefono(c.modResults.contents, datosDe(c).paquete);
    return c;
  });
  return withAndroidManifest(config, (c) => {
    conAsistente(c.modResults, datosDe(c).paquete);
    return c;
  });
}

module.exports = asistenteDigital;
module.exports.conAsistente = conAsistente;
module.exports.archivosNativos = archivosNativos;
module.exports.escribirNativo = escribirNativo;
module.exports.piezasManifiesto = piezasManifiesto;
module.exports.PIEZAS = PIEZAS;
module.exports.conConsultas = conConsultas;
module.exports.conPaqueteTelefono = conPaqueteTelefono;
module.exports.consultasTelefono = consultasTelefono;
module.exports.PERMISO_ALARMA = PERMISO_ALARMA;
module.exports.PERMISOS_PROHIBIDOS = PERMISOS_PROHIBIDOS;
