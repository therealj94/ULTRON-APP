/**
 * DOS APLICACIONES, UN PROYECTO.
 *
 * ULTRON FP y Dr Electrum FP comparten el cuerpo también en el teléfono: la misma cara, el mismo
 * cliente de voz, el mismo lector de audio. Lo que cambia es el cerebro, y eso no justifica dos
 * proyectos Expo con dos copias de todo que se desincronizan a la tercera semana.
 *
 * `ULTRON_APP=electrum` cambia identidad, paquete, color e icono; sin ella sale ULTRON, exactamente
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
  acento: '#FFAE3B',
  // El campo se sostiene en la mano, en vertical. La mesa de ULTRON es horizontal; esto no.
  orientacion: 'portrait',
};

module.exports = ({ config }) => {
  const variante = String(process.env.ULTRON_APP || 'ultron').toLowerCase();
  const expo = { ...base.expo, ...(config || {}) };

  if (variante !== 'electrum') {
    return { ...expo, extra: { ...expo.extra, variante: 'ultron' } };
  }

  return {
    ...expo,
    name: ELECTRUM.name,
    slug: ELECTRUM.slug,
    scheme: ELECTRUM.scheme,
    orientation: ELECTRUM.orientacion,
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
      adaptiveIcon: { ...expo.android?.adaptiveIcon, backgroundColor: '#000000' },
    },
    plugins: (expo.plugins || []).map((p) => {
      if (!Array.isArray(p)) return p;
      const [nombre, opts] = p;
      // Los textos de permiso los lee la persona en el diálogo del sistema. Que digan ULTRON en la
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
      if (nombre === 'expo-screen-orientation') return [nombre, { initialOrientation: 'PORTRAIT' }];
      return p;
    }),
    extra: { ...expo.extra, variante: 'electrum', acento: ELECTRUM.acento },
  };
};
