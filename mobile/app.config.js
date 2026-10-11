/**
 * DOS APLICACIONES, UN PROYECTO.
 *
 * AU-RA FP y Dr Electrum FP comparten el cuerpo también en el teléfono: la misma cara, el mismo
 * cliente de voz, el mismo lector de audio. Lo que cambia es el cerebro, y eso no justifica dos
 * proyectos Expo con dos copias de todo que se desincronizan a la tercera semana.
 *
 * `ULTRON_APP=electrum` cambia identidad, paquete, color e icono; sin ella sale AU-RA, exactamente
 * como salía antes. `app.json` NO se toca: es la configuración de la APK que ya funciona y se lee
 * tal cual. Acá solo se describen las DIFERENCIAS, de modo que un despiste en esta variante no
 * puede romper la app de la junta.
 */
const base = require('./app.json');

const ELECTRUM = {
  name: 'Dr Electrum FP',
  slug: 'dr-electrum-fp',
  // Proyecto EAS propio en la cuenta ordenglobal (las OTA del doctor no se mezclan con las de AU-RA).
  proyectoEas: '2bd6da7c-c804-467e-8fbd-a171699acc9b',
  scheme: 'drelectrumfp',
  // Paquete distinto: si fuera el mismo, instalar una desinstalaría la otra.
  paquete: 'link.ordenglobal.drelectrumfp',
  // Ámbar de mineral. Se lee en src/variante.ts (`extra.acento`); faltaba aquí y el manifiesto
  // salía con `acento: undefined` — funcionaba solo porque variante.ts repite el color de reserva.
  acento: '#FFAE3B',
  /*
   * Libre: gira con el teléfono. (AU-RA también es libre en el manifiesto desde la 4.5 y decide
   * su orientación en tiempo de ejecución: src/lib/orientacion.ts.)
   *
   * Estuvo bloqueada en horizontal «igual que AU-RA» (20-sep), y al día siguiente la pantalla del
   * campo se rehízo para las DOS formas —dos columnas con ancho, una sola con el pulgar abajo en
   * vertical— porque en el campo el teléfono se saca con una mano y la otra va ocupada (ver el
   * comentario de `apaisado` en src/electrum/CampoScreen.tsx). Con el bloqueo, ese diseño vertical
   * no se veía nunca. Las pantallas de Electrum miden la ventana y se acomodan; nada en su código
   * bloquea la orientación (el `lockOrientation` de App.tsx es solo de AU-RA).
   *
   * 'default' en Expo = `screenOrientation="unspecified"` en el manifiesto de Android: sigue al
   * sensor y respeta el bloqueo de rotación del teléfono.
   */
  orientacion: 'default',
  // Los íconos de siempre del doctor. Los de `assets/` pasaron a ser los de AU-RA (el planeta crema
  // del logo), así que Electrum lee su copia y no hereda la marca de la otra app.
  icono: './assets/electrum/icon.png',
  iconoAdaptable: './assets/electrum/adaptive-icon.png',
  arranque: './assets/electrum/splash-icon.png',
};

/*
 * Canal de EAS Update (actualizaciones por aire) que escucha la APK. Va al manifiesto al compilar y
 * NO cambia después. `production` solo para las APK de main; las de ramas escuchan `pruebas`: si
 * escucharan `production`, una APK de prueba que solo cambió JS tendría la misma huella que main y
 * se «actualizaría» sola al código de main. El canal entra en la huella nativa, así que quien
 * publica (.github/workflows/ota.yml) pone el mismo valor que quien compiló.
 */
const CANAL = process.env.EXPO_CANAL || 'production';

// AU-RA es Grafito (elegida el 25-sep): el sistema, el ícono adaptable y el arranque van en el
// mismo gris oscuro que la sala, o el teléfono enseña otro color antes de abrirse.
const AURA_FONDO = '#232528';
// El fondo del ícono, el mismo gris con el que se dibujó assets/icon.png (scripts/marca-aura.py).
const AURA_ICONO = '#2C2E32';

/*
 * AVISOS CON LA APP CERRADA (Firebase Cloud Messaging, src/push): SOLO AU-RA.
 *
 * `google-services.json` es del proyecto Firebase `aura-fp` y trae un único cliente, el paquete
 * `link.ordenglobal.ultronfp`. El plugin de `@react-native-firebase/app` aplica el plugin de Gradle
 * de Google Services, que falla la compilación si el archivo no tiene un cliente para el paquete que
 * se compila: en Dr Electrum (`link.ordenglobal.drelectrumfp`) rompería la APK. Por eso ni el archivo
 * ni los plugins entran en la rama del doctor. El de `messaging` solo pone el ícono y color por omisión
 * de los avisos de FCM (los nuestros son solo datos y los dibuja notifee).
 */
const FIREBASE_PLUGINS = ['@react-native-firebase/app', '@react-native-firebase/messaging'];

/*
 * AU-RA COMO ASISTENTE DIGITAL (plugins/asistente-digital.js): el botón lateral del teléfono, la burbuja encima de
 * cualquier app, el mosaico de Ajustes rápidos y el atajo del ícono. SOLO AU-RA: la burbuja habla con el cerebro de
 * AURA y el asistente del teléfono es uno solo; en la APK de Dr Electrum no queda ni una pieza (ni clases ni recursos:
 * el plugin las copia a la app, no van en un módulo que se enlace en las dos).
 */
const ASISTENTE_PLUGINS = ['./plugins/asistente-digital'];

/** Cambia las opciones de un plugin de la lista sin tocar el resto. */
function conPlugin(plugins, nombre, cambiar) {
  return (plugins || []).map((p) => {
    const [n, opts] = Array.isArray(p) ? p : [p, undefined];
    return n === nombre ? [n, cambiar(opts || {})] : p;
  });
}

module.exports = ({ config }) => {
  const variante = String(process.env.ULTRON_APP || 'ultron').toLowerCase();
  const expo = { ...base.expo, ...(config || {}) };

  if (variante !== 'electrum') {
    return {
      ...expo,
      // «automatic»: el tema «Sistema» de la 5.0 sigue al teléfono (con «dark» Android siempre dice oscuro).
      userInterfaceStyle: 'automatic',
      plugins: [...conPlugin(expo.plugins, 'expo-splash-screen', (o) => ({ ...o, backgroundColor: AURA_FONDO })), ...FIREBASE_PLUGINS, ...ASISTENTE_PLUGINS],
      android: {
        ...expo.android,
        // Firebase Cloud Messaging (src/push): solo AU-RA. Ver FIREBASE_PLUGINS.
        googleServicesFile: './google-services.json',
        adaptiveIcon: { ...expo.android?.adaptiveIcon, backgroundColor: AURA_ICONO },
        /*
         * La vuelta de la wallet por https (App Link verificado). `ultronfp://` lo puede declarar
         * cualquier app; `https://aura-fp.onrender.com/sso` solo se le entrega a la app que ese
         * dominio reconoce en /.well-known/assetlinks.json (paquete + huella de la firma; ver
         * server/enlaces-app.ts). Sin verificar, Android abre el enlace en el navegador y la página
         * /sso devuelve a la persona aquí con un intent atado al paquete. Solo AU-RA: Dr Electrum no
         * entra con Genesis ID.
         */
        intentFilters: [
          ...(expo.android?.intentFilters || []),
          {
            action: 'VIEW',
            autoVerify: true,
            category: ['BROWSABLE', 'DEFAULT'],
            data: [{ scheme: 'https', host: 'aura-fp.onrender.com', pathPrefix: '/sso' }],
          },
        ],
        /*
         * AU-RA no pide la ubicación, y hay que decirlo explícitamente.
         *
         * `expo-location` se instaló para la app del doctor, pero declara sus permisos en SU
         * propio AndroidManifest, y el fusionador de Android los mete en cualquier app que tenga
         * el paquete presente — diga lo que diga esta configuración. Sin este bloqueo, la app de
         * la junta empezaba a pedir la ubicación sin usarla jamás: una regresión de privacidad
         * introducida por una dependencia de la OTRA app, y de las que Play Store señala.
         *
         * Se vio regenerando el nativo y contando los permisos del manifiesto, no leyendo código.
         */
        blockedPermissions: [
          ...new Set([
            ...(expo.android?.blockedPermissions || []),
            'android.permission.ACCESS_FINE_LOCATION',
            'android.permission.ACCESS_COARSE_LOCATION',
            'android.permission.ACCESS_BACKGROUND_LOCATION',
          ]),
        ],
      },
      // Actualizaciones por aire: el canal va en la cabecera (sin EAS Build no se pone solo).
      updates: { ...expo.updates, requestHeaders: { 'expo-channel-name': CANAL } },
      // Cada app habla con SU servicio: desde que un despliegue sirve un solo producto, AU-RA vive
      // en aura-fp y Dr Electrum en ultron-looi-desk. Apuntar las dos al mismo deja a una en 404.
      extra: { ...expo.extra, variante: 'ultron', ultronUrl: 'https://aura-fp.onrender.com' },
    };
  }

  return {
    ...expo,
    name: ELECTRUM.name,
    slug: ELECTRUM.slug,
    scheme: ELECTRUM.scheme,
    orientation: ELECTRUM.orientacion,
    icon: ELECTRUM.icono,
    android: {
      ...expo.android,
      package: ELECTRUM.paquete,
      // Permisos: cámara para leer un afloramiento o un papel, micrófono para hablarle, y
      // ubicación para la pregunta que solo tiene sentido en el campo: «¿de quién es esto?».
      // Sin los de AU-RA que el doctor no usa (Bluetooth, huella, cámara en segundo plano): cada uno
      // es una declaración más en Play Store y una pregunta más de la persona.
      permissions: [
        ...new Set([
          ...(expo.android?.permissions || []).filter((x) => !/BLUETOOTH|BIOMETRIC|FINGERPRINT|FOREGROUND_SERVICE_CAMERA/.test(x)),
          'android.permission.ACCESS_FINE_LOCATION',
          'android.permission.ACCESS_COARSE_LOCATION',
        ]),
      ],
      adaptiveIcon: { ...expo.android?.adaptiveIcon, foregroundImage: ELECTRUM.iconoAdaptable, backgroundColor: '#000000' },
      // Con el teclado abierto la pantalla se acomoda (el hilo se achica) en vez de correrse hacia
      // arriba y esconder la barra de arriba.
      softwareKeyboardLayoutMode: 'resize',
      // Los plugins que siguen (huella, servicio de llamada) los vuelven a agregar después del filtro
      // de arriba: bloqueados aquí, salen del manifiesto final.
      blockedPermissions: [
        ...new Set([
          ...(expo.android?.blockedPermissions || []),
          'android.permission.USE_BIOMETRIC',
          'android.permission.USE_FINGERPRINT',
          'android.permission.FOREGROUND_SERVICE_CAMERA',
        ]),
      ],
    },
    plugins: (expo.plugins || []).map((p) => {
      if (!Array.isArray(p)) return p;
      const [nombre, opts] = p;
      // Los textos de permiso los lee la persona en el diálogo del sistema. Que digan AU-RA en la
      // app del doctor es de las cosas que delatan que una app es otra app disfrazada.
      if (nombre === 'expo-camera') {
        return [
          nombre,
          {
            ...opts,
            cameraPermission: 'Dr Electrum FP usa la cámara para leer un afloramiento, un testigo o un documento.',
            microphonePermission: 'Dr Electrum FP te escucha para que le hables en el campo sin escribir.',
          },
        ];
      }
      if (nombre === 'expo-speech-recognition') {
        return [
          nombre,
          {
            ...opts,
            microphonePermission: 'Dr Electrum FP te escucha para que le hables en el campo sin escribir.',
            speechRecognitionPermission: 'Dr Electrum FP convierte tu voz en texto en el teléfono.',
          },
        ];
      }
      // Sin máscara horizontal en iOS: DEFAULT = todas menos boca abajo, igual que el manifiesto.
      if (nombre === 'expo-screen-orientation') return [nombre, { initialOrientation: 'DEFAULT' }];
      if (nombre === 'expo-splash-screen') return [nombre, { ...opts, image: ELECTRUM.arranque }];
      return p;
    }),
    /*
     * Actualizaciones por aire con SU propio proyecto EAS (@ordenglobal/dr-electrum-fp): `eas update`
     * exige que el slug sea el del proyecto de `extra.eas.projectId`, así que el doctor ya no comparte
     * el de AU-RA ni pide el JS de la otra app.
     */
    updates: {
      ...expo.updates,
      url: `https://u.expo.dev/${ELECTRUM.proyectoEas}`,
      requestHeaders: { 'expo-channel-name': CANAL },
    },
    extra: {
      ...expo.extra,
      eas: { projectId: ELECTRUM.proyectoEas },
      variante: 'electrum',
      acento: ELECTRUM.acento,
      ultronUrl: 'https://ultron-looi-desk.onrender.com',
    },
  };
};
