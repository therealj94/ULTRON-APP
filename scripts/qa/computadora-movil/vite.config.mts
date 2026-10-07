// Banco de pruebas de SU COMPUTADORA (la hoja de ajustes/Computadora.tsx: la tarjeta de la tarea con la pantalla en vivo,
// su sí antes de algo sensible, el resultado con su evidencia y lo que dice cuando la computadora no contesta) en un
// navegador con react-native-web. Solo para QA y capturas: lo que se revisa es el DISEÑO. Los módulos nativos van por los
// dobles de la mesa (../mesa-movil/simulado) y el servidor va simulado (./api-simulada.ts, con las capturas del escritorio
// que arma capturas.mjs).
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

const raiz = path.resolve(import.meta.dirname, '../../..');
const simulado = path.resolve(import.meta.dirname, '../mesa-movil/simulado');
const rnSimulado = path.resolve(simulado, 'react-native.tsx');
const apiSimulada = path.resolve(import.meta.dirname, 'api-simulada.ts');
const uiBanco = path.resolve(import.meta.dirname, 'ui-banco.ts');

/**
 * `../lib/api` (el cliente real habla con SecureStore y expo-crypto): aquí, el servidor simulado. `../ui` (el barril trae
 * el anillo de Skia): solo lo que usa la hoja (ui-banco.ts).
 */
const apiDelBanco: Plugin = {
  name: 'api-del-banco',
  enforce: 'pre',
  resolveId(fuente, desde) {
    if (!desde || !desde.includes(`${path.sep}mobile${path.sep}src${path.sep}`)) return null;
    if (/^(\.\.\/)+ui$/.test(fuente) && !desde.includes(`${path.sep}src${path.sep}ui${path.sep}`)) return uiBanco;
    return /^(\.\.\/)+lib\/api$/.test(fuente) || (fuente === './api' && desde.includes(`${path.sep}lib${path.sep}`)) ? apiSimulada : null;
  },
};

export default defineConfig({
  root: import.meta.dirname,
  plugins: [apiDelBanco, react()],
  resolve: {
    extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.jsx', '.js'],
    dedupe: ['react', 'react-dom'],
    alias: {
      'react-native-reanimated': path.resolve(import.meta.dirname, 'reanimated.tsx'),
      'react-native-worklets': path.resolve(simulado, 'simples.tsx'),
      'react-native-gesture-handler': path.resolve(simulado, 'simples.tsx'),
      'react-native-safe-area-context': path.resolve(simulado, 'simples.tsx'),
      '@shopify/react-native-skia': path.resolve(simulado, 'skia.tsx'),
      'expo-haptics': path.resolve(simulado, 'simples.tsx'),
      'expo-font': path.resolve(simulado, 'simples.tsx'),
      'expo-blur': path.resolve(simulado, 'simples.tsx'),
      'expo-keep-awake': path.resolve(simulado, 'simples.tsx'),
      'expo-linear-gradient': path.resolve(simulado, 'gradiente.tsx'),
      '@react-native-async-storage/async-storage': path.resolve(simulado, 'storage.ts'),
      'react-native': rnSimulado,
      react: path.resolve(raiz, 'node_modules/react'),
      'react-dom': path.resolve(raiz, 'node_modules/react-dom'),
      '@movil': path.resolve(raiz, 'mobile'),
    },
  },
  define: { __DEV__: 'false', global: 'globalThis', 'process.env.NODE_ENV': '"production"' },
});
