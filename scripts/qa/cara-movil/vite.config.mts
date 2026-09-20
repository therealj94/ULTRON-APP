// Banco de pruebas: monta la cara del MÓVIL (UltronFace, React Native) en un navegador con
// react-native-web, para poder mirarla con Playwright en vez de adivinar. Solo para QA.
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

const raiz = path.resolve(import.meta.dirname, '../../..');

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  resolve: {
    extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.jsx', '.js'],
    // mobile/ tiene su propio node_modules: sin estos alias se cargan dos Reacts y los hooks explotan.
    dedupe: ['react', 'react-dom'],
    alias: {
      'react-native': path.resolve(raiz, 'node_modules/react-native-web'),
      react: path.resolve(raiz, 'node_modules/react'),
      'react-dom': path.resolve(raiz, 'node_modules/react-dom'),
    },
  },
  define: { __DEV__: 'false', global: 'globalThis', 'process.env.NODE_ENV': '"production"' },
});
