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
  scheme: 'drelectrumfp',
  // Paquete distinto: si fuera el mismo, instalar una desinstalaría la otra.
  paquete: 'link.ordenglobal.drelectrumfp',
  /*
   * Libre: gira con el teléfono. AU-RA sigue en horizontal; esta no.
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

// AU-RA es Grafito (elegida el 25-sep): el sistema, el ícono adaptable y el arranque van en el
// mismo gris oscuro que la sala, o el teléfono enseña otro color antes de abrirse.
const AURA_FONDO = '#232528';
// El fondo del ícono, el mismo gris con el que se dibujó assets/icon.png (scripts/marca-aura.py).
const AURA_ICONO = '#2C2E32';

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
      userInterfaceStyle: 'dark',
      plugins: conPlugin(expo.plugins, 'expo-splash-screen', (o) => ({ ...o, backgroundColor: AURA_FONDO })),
      android: {
        ...expo.android,
        adaptiveIcon: { ...expo.android?.adaptiveIcon, backgroundColor: AURA_ICONO },
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
      permissions: [
        ...new Set([
          ...(expo.android?.permissions || []),
          'android.permission.ACCESS_FINE_LOCATION',
          'android.permission.ACCESS_COARSE_LOCATION',
        ]),
      ],
      adaptiveIcon: { ...expo.android?.adaptiveIcon, foregroundImage: ELECTRUM.iconoAdaptable, backgroundColor: '#000000' },
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
    extra: { ...expo.extra, variante: 'electrum', acento: ELECTRUM.acento, ultronUrl: 'https://ultron-looi-desk.onrender.com' },
  };
};
