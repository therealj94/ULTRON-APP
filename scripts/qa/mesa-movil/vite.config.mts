// Banco de pruebas de la MESA del teléfono (la barra de tres botones, la hoja «Más», el recorrido y la
// transición grande → chiquita) en un navegador con react-native-web. Solo para QA y capturas: lo que
// se revisa es el DISEÑO; los módulos nativos (Reanimated, Skia, gestos) van por dobles sencillos.
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

const raiz = path.resolve(import.meta.dirname, '../../..');
const simulado = path.resolve(import.meta.dirname, 'simulado');
const rnSimulado = path.resolve(simulado, 'react-native.tsx');

/**
 * Las fotos que la app pide con `require('…/foto.webp')` (Metro): en el navegador, la URL del archivo
 * (`{ uri }`, como las toma <Image>). Así se ven los retratos de Claudio y ANT-ONIO en la llamada.
 */
const requireDeFotos = {
  name: 'require-de-fotos',
  transform(codigo: string, id: string) {
    if (!/\.(t|j)sx?$/.test(id) || !codigo.includes('require(')) return null;
    const nuevo = codigo.replace(/require\((['"])([^'"]+\.(?:webp|png|jpe?g))\1\)/g, (_m, _q, ruta) => `({ uri: new URL(${JSON.stringify(ruta)}, import.meta.url).href })`);
    return nuevo === codigo ? null : { code: nuevo, map: null };
  },
};

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), requireDeFotos],
  resolve: {
    extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.jsx', '.js'],
    dedupe: ['react', 'react-dom'],
    alias: {
      'react-native-reanimated': path.resolve(simulado, 'reanimated.tsx'),
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
