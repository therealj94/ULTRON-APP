/**
 * Ayudas de las pruebas (no tiene pruebas propias): arma un archivo TypeScript con esbuild y lo
 * importa, y espera a que algo se cumpla.
 *
 * `armar` empaqueta en un directorio temporal (se borra al salir). Las piezas del teléfono importan
 * módulos nativos de Expo/React Native: `sustitutos` los cambia por las imitaciones de `test/shims/`.
 * Las piezas del teléfono no tienen `node_modules` propio: @noble sale del del Centro (`nodePaths`),
 * que es la MISMA versión que declara `mobile/package.json`.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
export const CENTRO = join(aqui, '..');
export const RAIZ = join(CENTRO, '..', '..');
export const MOVIL = join(RAIZ, 'mobile');

const SHIMS = {
  'expo-secure-store': join(aqui, 'shims', 'expo-secure-store.mjs'),
  'expo-crypto': join(aqui, 'shims', 'expo-crypto.mjs'),
  'expo-constants': join(aqui, 'shims', 'expo-constants.mjs'),
  'react-native': join(aqui, 'shims', 'react-native.mjs'),
};

let carpeta = null;
let serie = 0;
function salida() {
  if (!carpeta) {
    carpeta = mkdtempSync(join(tmpdir(), 'centro-pruebas-'));
    process.on('exit', () => rmSync(carpeta, { recursive: true, force: true }));
  }
  return join(carpeta, `modulo-${++serie}.mjs`);
}

const sustitutos = {
  name: 'sustitutos',
  setup(b) {
    const filtro = new RegExp(`^(${Object.keys(SHIMS).join('|')})$`);
    b.onResolve({ filter: filtro }, (a) => ({ path: SHIMS[a.path] }));
  },
};

/**
 * Empaqueta y carga un módulo. `entrada`: la ruta de un .ts, o `{ codigo, carpeta }` para un punto
 * de entrada escrito aquí (que reexporta varias piezas de un mismo empaque: comparten su estado).
 */
export async function armar(entrada) {
  const archivo = salida();
  const comun = {
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    outfile: archivo,
    logLevel: 'silent',
    nodePaths: [join(CENTRO, 'node_modules')],
    plugins: [sustitutos],
  };
  if (typeof entrada === 'string') await build({ ...comun, entryPoints: [entrada] });
  else await build({ ...comun, stdin: { contents: entrada.codigo, resolveDir: entrada.carpeta, loader: 'ts', sourcefile: 'entrada.ts' } });
  return import(pathToFileURL(archivo).href);
}

/** Espera a que `cond()` sea verdad (o lanza con `que` al vencer el plazo). */
export async function esperar(cond, que = 'la condición', ms = 3000) {
  const hasta = Date.now() + ms;
  for (;;) {
    let ok = false;
    try {
      ok = !!cond();
    } catch {
      ok = false;
    }
    if (ok) return;
    if (Date.now() > hasta) throw new Error(`no se cumplió a tiempo: ${que}`);
    await new Promise((r) => setTimeout(r, 4));
  }
}

export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
