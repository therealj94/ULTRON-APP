#!/usr/bin/env node
/**
 * Empaqueta la sala de AU-RA (src/11-sala/embed.ts + three.js) en UNA página HTML y la escribe
 * como módulo de la app del teléfono: mobile/src/sala/salaHtml.ts.
 *
 * Por qué dentro de la APK y no cargada del servidor: la sala es el cuerpo de AU-RA, y el cuerpo
 * no puede depender de que Render esté arriba, de qué plataforma sirva ni de bajar 600 KB cada vez
 * que se abre la app. Así aparece al instante y también sin red.
 *
 * El módulo generado va en el repositorio (la APK se compila sin el proyecto web instalado) y la
 * prueba tests/sala-movil.test.ts vuelve a empaquetar y compara: si alguien cambia la sala y no
 * corre esto, la prueba falla y dice qué correr.
 *
 *   node scripts/sala-movil.mjs            # escribe el módulo
 *   node scripts/sala-movil.mjs --revisar  # solo compara; sale con 1 si está desactualizado
 */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DESTINO = path.join(RAIZ, 'mobile/src/sala/salaHtml.ts');

/** El JS de la sala, minificado y en un solo bloque. esbuild es determinista: misma entrada, mismo texto. */
async function empaquetar() {
  const r = await build({
    entryPoints: [path.join(RAIZ, 'src/11-sala/embed.ts')],
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['chrome90'],
    legalComments: 'none',
    write: false,
    logLevel: 'silent',
  });
  return r.outputFiles[0].text;
}

/** La misma página que sala.html, sin fuentes (la sala no escribe texto: la burbuja es del teléfono). */
function pagina(js) {
  const seguro = js.replace(/<\/script/gi, '<\\/script');
  return (
    '<!doctype html><html lang="es"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">' +
    '<style>html,body{margin:0;height:100%;overflow:hidden;background:#F3E7D8}' +
    '#sala{position:fixed;inset:0;background:linear-gradient(180deg,#F6ECDF 0%,#EFE1CE 100%);-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}</style>' +
    '</head><body><div id="sala"></div><script>' +
    seguro +
    '</script></body></html>'
  );
}

export async function generar() {
  const html = pagina(await empaquetar());
  const huella = createHash('sha256').update(html).digest('hex').slice(0, 16);
  return (
    '/**\n' +
    ' * GENERADO por scripts/sala-movil.mjs — no editar a mano.\n' +
    ' * La sala de AU-RA (src/11-sala) empaquetada con three.js en una sola página para la WebView.\n' +
    ' * Si cambias la sala: `node scripts/sala-movil.mjs` (tests/sala-movil.test.ts lo exige).\n' +
    ' */\n' +
    `export const SALA_HUELLA = '${huella}';\n` +
    `export const SALA_HTML = ${JSON.stringify(html)};\n`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const nuevo = await generar();
  if (process.argv.includes('--revisar')) {
    const actual = fs.existsSync(DESTINO) ? fs.readFileSync(DESTINO, 'utf8') : '';
    if (actual !== nuevo) {
      console.error('mobile/src/sala/salaHtml.ts está desactualizado: corre `node scripts/sala-movil.mjs`.');
      process.exit(1);
    }
    console.log('sala del teléfono al día');
  } else {
    fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
    fs.writeFileSync(DESTINO, nuevo);
    console.log(`${path.relative(RAIZ, DESTINO)} · ${(Buffer.byteLength(nuevo) / 1024).toFixed(0)} KB`);
  }
}
