#!/usr/bin/env node
/**
 * Empaqueta el cuerpo 3D de AURA (src/12-avatar3d/escena.ts + three.js + el decodificador meshopt)
 * en UNA página HTML y la escribe como módulo de la app del teléfono: mobile/src/avatar3d/escenaHtml.ts.
 *
 * Mismo camino que el orbe (scripts/orbe-movil.mjs): la página va dentro de la APK, así el avatar
 * aparece sin red y no depende de que el servidor esté arriba. El modelo .glb NO va aquí: lo lleva
 * Metro como archivo (mobile/assets/avatar3d/) y el teléfono se lo pasa a la página en pedazos.
 *
 * El módulo generado va en el repositorio (la APK se compila sin el proyecto web instalado) y la
 * prueba tests/avatar3d-movil.test.ts vuelve a empaquetar y compara.
 *
 *   node scripts/avatar3d-movil.mjs            # escribe el módulo
 *   node scripts/avatar3d-movil.mjs --revisar  # solo compara; sale con 1 si está desactualizado
 */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DESTINO = path.join(RAIZ, 'mobile/src/avatar3d/escenaHtml.ts');

/** El JS de la escena, minificado y en un solo bloque. esbuild es determinista: misma entrada, mismo texto. */
async function empaquetar() {
  const r = await build({
    entryPoints: [path.join(RAIZ, 'src/12-avatar3d/escena.ts')],
    bundle: true,
    minify: true,
    format: 'iife',
    // Android System WebView de un teléfono de hace cinco años (Chrome 90) ya tiene WebGL 2 y WebAssembly.
    target: ['chrome90'],
    legalComments: 'none',
    write: false,
    logLevel: 'silent',
  });
  return r.outputFiles[0].text;
}

/** La página: fondo transparente (el avatar se dibuja encima de la app) y el lienzo a todo lo que mida. */
function pagina(js) {
  const seguro = js.replace(/<\/script/gi, '<\\/script');
  return (
    '<!doctype html><html lang="es"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">' +
    '<style>html,body{margin:0;height:100%;overflow:hidden;background:transparent;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}</style>' +
    '</head><body><script>' +
    seguro +
    '</script></body></html>'
  );
}

export async function generar() {
  const html = pagina(await empaquetar());
  const huella = createHash('sha256').update(html).digest('hex').slice(0, 16);
  return (
    '/**\n' +
    ' * GENERADO por scripts/avatar3d-movil.mjs — no editar a mano.\n' +
    ' * El cuerpo 3D de AURA (src/12-avatar3d) empaquetado con three.js en una sola página para la WebView.\n' +
    ' * Si cambias la escena: `node scripts/avatar3d-movil.mjs` (tests/avatar3d-movil.test.ts lo exige).\n' +
    ' */\n' +
    `export const ESCENA_HUELLA = '${huella}';\n` +
    `export const ESCENA_HTML = ${JSON.stringify(html)};\n`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const nuevo = await generar();
  if (process.argv.includes('--revisar')) {
    const actual = fs.existsSync(DESTINO) ? fs.readFileSync(DESTINO, 'utf8') : '';
    if (actual !== nuevo) {
      console.error('mobile/src/avatar3d/escenaHtml.ts está desactualizado: corre `node scripts/avatar3d-movil.mjs`.');
      process.exit(1);
    }
    console.log('escena 3D del teléfono al día');
  } else {
    fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
    fs.writeFileSync(DESTINO, nuevo);
    console.log(`${path.relative(RAIZ, DESTINO)} · ${(Buffer.byteLength(nuevo) / 1024).toFixed(0)} KB`);
  }
}
