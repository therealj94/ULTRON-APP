// Banco de pruebas de la APP del doctor (React Native) en un navegador, con react-native-web.
// Es la única forma honesta de revisar su diseño sin un teléfono delante: así se miraron las tres
// pantallas antes de que existiera un APK que instalar.
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

const raiz = path.resolve(import.meta.dirname, '../../..');
const movil = path.resolve(raiz, 'mobile');
const simulado = path.resolve(import.meta.dirname, 'simulado');

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  resolve: {
    extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.jsx', '.js'],
    dedupe: ['react', 'react-dom'],
    alias: {
      // Los módulos nativos no existen en un navegador: se sustituyen por dobles que devuelven lo
      // que devolvería el teléfono. Lo que se está revisando es el DISEÑO, no el GPS.
      'expo-constants': path.resolve(simulado, 'expo-constants.ts'),
      'expo-secure-store': path.resolve(simulado, 'expo-secure-store.ts'),
      'expo-splash-screen': path.resolve(simulado, 'expo-splash-screen.ts'),
      'expo-system-ui': path.resolve(simulado, 'expo-system-ui.ts'),
      'expo-status-bar': path.resolve(simulado, 'expo-status-bar.ts'),
      'expo-location': path.resolve(simulado, 'expo-location.ts'),
      'expo-av': path.resolve(simulado, 'expo-av.ts'),
      'react-native': path.resolve(raiz, 'node_modules/react-native-web'),
      react: path.resolve(raiz, 'node_modules/react'),
      'react-dom': path.resolve(raiz, 'node_modules/react-dom'),
      '@movil': movil,
    },
  },
  define: { __DEV__: 'false', global: 'globalThis', 'process.env.NODE_ENV': '"production"' },
});
