// Empaqueta para node las piezas que se tocan entre frentes —el bus del contrato, el chat (relevo,
// chats, borradores), la compañera (acciones, contactos, ánimo, sesión, coordinación de llamadas) y el
// motor de llamadas— en UN solo módulo: así todas comparten el mismo bus, como en el teléfono.
//
// Lo nativo va simulado: los shims de Expo de ../chat/shims y los de ./shims (WebRTC, audio de
// LiveKit, expo-av, notifee). `SRC=/otra/copia/mobile/src node construir.cjs` empaqueta otra copia
// (para ver fallar una prueba contra el código de antes).
const path = require('path');
const fs = require('fs');
const RAIZ = path.resolve(__dirname, '../..');
const MODULOS = path.join(RAIZ, 'node_modules');
const esbuild = require(fs.existsSync(path.join(RAIZ, '../node_modules/esbuild')) ? path.join(RAIZ, '../node_modules/esbuild') : 'esbuild');
const SRC = path.resolve(process.env.SRC || path.join(RAIZ, 'src'));
const SALIDA = path.resolve(process.env.SALIDA || path.join(__dirname, 'out/costuras.cjs'));
const CHAT = path.join(__dirname, '../chat/shims');
const PROPIOS = path.join(__dirname, 'shims');

const alias = {
  name: 'alias',
  setup(b) {
    const mapa = {
      'expo-crypto': path.join(CHAT, 'expo-crypto.js'),
      'expo-secure-store': path.join(CHAT, 'expo-secure-store.js'),
      'expo-constants': path.join(CHAT, 'expo-constants.js'),
      'expo-web-browser': path.join(CHAT, 'expo-web-browser.js'),
      'react-native': path.join(PROPIOS, 'react-native.js'),
      '@livekit/react-native-webrtc': path.join(PROPIOS, 'webrtc.js'),
      '@livekit/react-native': path.join(PROPIOS, 'livekit.js'),
      'expo-av': path.join(PROPIOS, 'expo-av.js'),
      '@notifee/react-native': path.join(PROPIOS, 'notifee.js'),
    };
    b.onResolve({ filter: /.*/ }, (a) => {
      if (mapa[a.path]) return { path: mapa[a.path] };
      if (a.path === './api' && a.importer.includes(`${path.sep}lib${path.sep}`)) return { path: path.join(CHAT, 'api.js') };
      if (a.path === './storage' && a.importer.includes(`${path.sep}lib${path.sep}`)) return { path: path.join(PROPIOS, 'storage.js') };
      return null;
    });
  },
};

const piezas = {
  CONTRATO: 'nucleo/contrato',
  RELEVO: 'pulse/relevo',
  CHATS: 'pulse/chats',
  BORRADORES: 'pulse/borradores',
  LLAMADA: 'pulse/llamada',
  ACCIONES: 'compa/acciones',
  CONTACTOS: 'compa/contactos',
  ANIMO: 'compa/animo',
  SESION: 'compa/sesion',
  COMPA_LLAMADA: 'compa/llamada',
  AUDIO_VOZ: 'compa/audioVoz',
  MANOS: 'pulse/manos',
  RECORDATORIOS: 'compa/recordatorios',
  API: 'lib/api',
  APARATO: 'lib/aparato',
  CUENTA: 'lib/cuenta',
};
const lineas = Object.entries(piezas)
  .filter(([, r]) => fs.existsSync(path.join(SRC, r + '.ts')))
  .map(([n, r]) => `export * as ${n} from ${JSON.stringify(path.join(SRC, r))};`);
const entrada = path.join(path.dirname(SALIDA), 'entrada-' + path.basename(SALIDA, '.cjs') + '.ts');
fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
fs.writeFileSync(entrada, lineas.join('\n') + '\n');

esbuild
  .build({
    entryPoints: [entrada],
    outfile: SALIDA,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [alias],
    nodePaths: [MODULOS],
    loader: { '.png': 'empty', '.webp': 'empty', '.jpg': 'empty', '.wav': 'empty', '.mp3': 'empty' },
    logLevel: 'error',
  })
  .then(() => console.log('construido', path.relative(process.cwd(), SALIDA), 'desde', SRC))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
