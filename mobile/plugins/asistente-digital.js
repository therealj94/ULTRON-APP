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
 * JS no necesita un módulo nativo para cerrar la burbuja: `BackHandler.exitApp()` llega a la actividad que está delante
 * (la burbuja) y su `invokeDefaultOnBackPressed` hace finish(); y al dejar de verse se termina sola (onStop).
 *
 * Se comprueba regenerando el nativo (`npx expo prebuild -p android --no-install --clean`) y leyendo
 * android/app/src/main/AndroidManifest.xml; las piezas, en tests/asistente-digital-movil.test.ts.
 */
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

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
