/**
 * Humo de PantallaLlamada: la dibuja en node (react-dom/server) en cada estado de la llamada, con
 * React Native, Reanimated, Skia y los gestos simulados como etiquetas. No mira píxeles: mira que
 * ningún estado reviente al dibujar y que cada uno diga lo que tiene que decir.
 *
 *   node mobile/pruebas/llamadas/pantalla.js
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const MOVIL = path.resolve(__dirname, '../..');
const RAIZ = path.resolve(MOVIL, '..');
const ts = require(path.join(MOVIL, 'node_modules/typescript'));
// react-dom/server vive en la raíz del repo; React tiene que ser el MISMO que usa el renderizador.
const React = require(path.join(RAIZ, 'node_modules/react'));
const jsx = require(path.join(RAIZ, 'node_modules/react/jsx-runtime'));
const { renderToStaticMarkup } = require(path.join(RAIZ, 'node_modules/react-dom/server'));

require.extensions['.ts'] = require.extensions['.tsx'] = function (m, archivo) {
  const code = ts.transpileModule(fs.readFileSync(archivo, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    fileName: archivo,
  }).outputText;
  m._compile(code, archivo);
};

/** Un componente que es solo una etiqueta con sus hijos (y el texto de accesibilidad, para buscarlo). */
const etiqueta = (nombre) =>
  function Simulado(p) {
    return React.createElement(nombre, { 'data-a11y': p.accessibilityLabel }, p.children);
  };
/** Lo que se encadena (Gesture.Pan().onBegin(…)…, FadeIn.duration(…).delay(…)): siempre devuelve más cadena. */
const cadena = () =>
  new Proxy(function () {}, {
    get: (_t, k) => (k === Symbol.toPrimitive || k === 'then' ? undefined : cadena()),
    apply: () => cadena(),
  });

let dims = { width: 390, height: 844 };
const mocks = {
  react: React,
  'react/jsx-runtime': jsx,
  'react-native': {
    Modal: etiqueta('modal'),
    View: etiqueta('view'),
    Text: etiqueta('text'),
    Pressable: etiqueta('pressable'),
    StyleSheet: { create: (o) => o, absoluteFill: {}, hairlineWidth: 0.5 },
    useWindowDimensions: () => dims,
    Appearance: { getColorScheme: () => 'dark' },
    useColorScheme: () => 'dark',
    Platform: { OS: 'android', Version: 34 },
  },
  '@livekit/react-native-webrtc': { RTCView: etiqueta('rtcview') },
  'expo-linear-gradient': { LinearGradient: etiqueta('degradado') },
  'expo-haptics': { impactAsync: async () => {}, notificationAsync: async () => {}, selectionAsync: async () => {}, ImpactFeedbackStyle: {}, NotificationFeedbackType: {} },
  'expo-keep-awake': { activateKeepAwakeAsync: async () => {}, deactivateKeepAwake: async () => {} },
  'react-native-gesture-handler': { Gesture: cadena(), GestureDetector: (p) => p.children, GestureHandlerRootView: etiqueta('raiz-gestos') },
  'react-native-reanimated': {
    __esModule: true,
    default: { View: etiqueta('aview'), Text: etiqueta('atext') },
    useSharedValue: (v) => ({ value: v }),
    useAnimatedStyle: (f) => f(),
    withTiming: (v) => v,
    withSpring: (v) => v,
    withRepeat: (v) => v,
    withSequence: (...v) => v[0],
    withDelay: (_d, v) => v,
    cancelAnimation: () => {},
    runOnJS: (f) => f,
    interpolate: (v, i, o) => o[0] + ((o[o.length - 1] - o[0]) * (v - i[0])) / (i[i.length - 1] - i[0] || 1),
    Extrapolation: { CLAMP: 'clamp' },
    Easing: new Proxy({}, { get: () => () => () => 0 }),
    FadeIn: cadena(),
    FadeInDown: cadena(),
    FadeInUp: cadena(),
    ZoomIn: cadena(),
  },
  '@shopify/react-native-skia': { Canvas: etiqueta('canvas'), Group: etiqueta('group'), Path: etiqueta('path'), Skia: { Path: { MakeFromSVGString: () => ({}) } } },
  'react-native-safe-area-context': { initialWindowMetrics: { insets: { top: 24, bottom: 16, left: 0, right: 0 } } },
  './llamada': new Proxy({}, { get: () => () => {} }),
};
const origLoad = Module._load;
Module._load = function (req) {
  if (mocks[req]) return mocks[req];
  return origLoad.apply(this, arguments);
};

const { PantallaLlamada } = require(path.join(MOVIL, 'src/pulse/PantallaLlamada.tsx'));

const flujo = (video) => ({ toURL: () => 'f', getVideoTracks: () => (video ? [{}] : []) });
const base = { estado: 'libre', conQuien: 'maria.lopez@x.com', soyQuienLlama: true, entrante: null, flujoLocal: null, flujoRemoto: null, hayVideo: false, videoRemoto: false, conVideo: false, micAbierto: true, camAbierta: false, porAltavoz: false, reconectando: false };

const casos = [
  ['entrante de voz', { estado: 'entrando', entrante: { de: 'maria.lopez@x.com', video: false } }, ['Maria Lopez', 'Llamada de voz entrante', 'Desliza para contestar', 'Rechazar', 'Cifrada de punta a punta']],
  ['entrante de video', { estado: 'entrando', entrante: { de: 'maria.lopez@x.com', video: true } }, ['Videollamada entrante', 'Desliza para contestar con video', 'Solo voz']],
  ['sonando', { estado: 'llamando' }, ['Sonando…', 'Silenciar', 'Altavoz', 'Colgar']],
  ['conectando', { estado: 'conectando' }, ['Conectando…']],
  ['hablando voz', { estado: 'hablando' }, ['0:00', 'Colgar']],
  ['reconectando', { estado: 'hablando', reconectando: true }, ['Reconectando…']],
  ['silenciado y altavoz', { estado: 'hablando', micAbierto: false, porAltavoz: true }, ['Silenciado']],
  ['videollamada en pie', { estado: 'hablando', hayVideo: true, camAbierta: true, videoRemoto: true, flujoLocal: flujo(true), flujoRemoto: flujo(true) }, ['Cámara', 'Voltear', '<rtcview']],
  ['videollamada sonando (vista propia grande)', { estado: 'llamando', hayVideo: true, camAbierta: true, flujoLocal: flujo(true) }, ['<rtcview', 'Sonando…']],
  ['terminada: colgó', { motivo: 'el-otro' }, ['La otra persona colgó']],
  ['terminada: perdida', { motivo: 'perdida', soyQuienLlama: false }, ['Llamada perdida']],
  ['terminada: sin camino', { motivo: 'sin-camino' }, ['No hubo camino de red', 'Prueba con otra red']],
  ['terminada: sin permiso (Ajustes)', { motivo: 'sin-permiso', abrirAjustes: true }, ['Hace falta permiso de micrófono', 'Abrir Ajustes', 'Ahora no']],
  ['terminada: no te aceptó', { motivo: 'no-te-acepto' }, ['Todavía no te aceptó']],
  ['terminada: rechazada en otro aparato', { motivo: 'rechazada-en-otro-aparato' }, ['Rechazada en otro aparato']],
  ['terminada: contestaste en otro aparato', { motivo: 'en-otro-aparato' }, ['Contestaste en otro aparato']],
];

let fallas = 0;
for (const apaisado of [false, true]) {
  dims = apaisado ? { width: 844, height: 390 } : { width: 390, height: 844 };
  for (const [titulo, extra, espera] of casos) {
    let html = '';
    let error = '';
    try {
      html = renderToStaticMarkup(React.createElement(PantallaLlamada, { cuento: { ...base, ...extra }, onListo: () => {} }));
    } catch (e) {
      error = String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ');
    }
    const faltan = error ? [] : espera.filter((t) => !html.includes(t));
    const ok = !error && !faltan.length;
    if (!ok) fallas++;
    console.log(`${ok ? 'PASA ' : 'FALLA'}  ${apaisado ? 'apaisada' : 'vertical'}  ${titulo}${error ? '\n        → ' + error : faltan.length ? '\n        → falta: ' + faltan.join(' · ') : ''}`);
  }
}
// Todos los motivos que llamada.ts puede dar tienen su texto.
const tipos = fs.readFileSync(path.join(MOVIL, 'src/pulse/llamada.ts'), 'utf8');
const motivos = [...tipos.slice(tipos.indexOf('export type Motivo'), tipos.indexOf('export type Cuento')).matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
for (const motivo of motivos) {
  const html = renderToStaticMarkup(React.createElement(PantallaLlamada, { cuento: { ...base, motivo }, onListo: () => {} }));
  const sinTexto = !/<text[^>]*>[^<]{4,}<\/text>/.test(html.split('Maria Lopez')[1] || '');
  if (sinTexto) {
    fallas++;
    console.log(`FALLA  motivo sin texto: ${motivo}`);
  }
}
console.log(`\n${fallas ? fallas + ' fallas' : 'todo bien'} (${casos.length * 2} dibujos, ${motivos.length} motivos)`);
process.exit(fallas ? 1 : 0);
