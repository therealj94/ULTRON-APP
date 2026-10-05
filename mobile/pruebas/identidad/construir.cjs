// Empaqueta para node lo que decide DE QUIÉN es cada cosa en un teléfono compartido: el cliente de la
// API (renovar y cerrar sesión, el turno en stream), el perfil, los recordatorios, la generación de la
// cuenta, los intentos de entrar (clave y Genesis ID) y la barrera de la actualización por aire. Con el código REAL; lo nativo, simulado (./shims y los del chat).
//
// `SRC=/otra/copia/mobile/src node construir.cjs` empaqueta otra copia (para ver fallar una prueba
// contra el código de antes).
const path = require('path');
const fs = require('fs');
const RAIZ = path.resolve(__dirname, '../..');
const MODULOS = path.join(RAIZ, 'node_modules');
const esbuild = require(fs.existsSync(path.join(RAIZ, '../node_modules/esbuild')) ? path.join(RAIZ, '../node_modules/esbuild') : 'esbuild');
const SRC = path.resolve(process.env.SRC || path.join(RAIZ, 'src'));
const SALIDA = path.resolve(process.env.SALIDA || path.join(__dirname, 'out/identidad.cjs'));
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
      '@react-native-async-storage/async-storage': path.join(PROPIOS, 'async-storage.js'),
    };
    b.onResolve({ filter: /.*/ }, (a) => {
      if (mapa[a.path]) return { path: mapa[a.path] };
      const enLib = a.importer.includes(`${path.sep}lib${path.sep}`);
      // El perfil habla con el servidor por api(): aquí, el de mentira (globalThis.__api). El cliente
      // REAL de la API se prueba por separado (pieza API).
      if (a.path === './api' && enLib && a.importer.endsWith(`perfil.ts`)) return { path: path.join(CHAT, 'api.js') };
      if (a.path === './storage' && enLib) return { path: path.join(PROPIOS, 'storage.js') };
      if (a.path === './tts' && enLib) return { path: path.join(PROPIOS, 'tts.js') };
      return null;
    });
  },
};

const piezas = {
  API: 'lib/api',
  PERFIL: 'lib/perfil',
  CUENTA: 'lib/cuenta',
  BARRERA: 'lib/barreraOta',
  // El diagnóstico de campo: una recarga a propósito (la OTA) no se acusa como crash.
  REPORTE: 'lib/reporte',
  RECORDATORIOS: 'compa/recordatorios',
  RELEVO: 'pulse/relevo',
  CONTRATO: 'nucleo/contrato',
  // De quién es cada intento de entrar (AUTH03) y la entrada con Genesis que lo usa.
  INTENTO: 'lib/intentoEntrada',
  GENESIS: 'lib/genesis',
  // El visor de la computadora (revisión 9): lo de A no queda abierto, escrito ni reanudable para B.
  VISOR: 'app/visor',
  // Qué build corre el teléfono, en la cabecera x-aura-cliente de api() (evidencia de operación, 5-oct).
  RECEPCION: 'lib/recepcion',
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
