#!/usr/bin/env node
/**
 * Mete el orbe de AURA (src/14-orbe/orbe.html) en la app del teléfono como módulo:
 * mobile/src/orbe/orbeHtml.ts. Va dentro del paquete (no se baja de Render) por lo mismo que la sala:
 * la cara de AURA aparece al instante y sin red. El orbe no depende de nada externo.
 *
 * El módulo generado va en el repositorio y tests/orbe-movil.test.ts lo compara con la fuente:
 * si alguien toca el orbe y no corre esto, la prueba falla y dice qué correr.
 *
 *   node scripts/orbe-movil.mjs            # escribe el módulo
 *   node scripts/orbe-movil.mjs --revisar  # solo compara; sale con 1 si está desactualizado
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FUENTE = path.join(RAIZ, 'src/14-orbe/orbe.html');
export const DESTINO = path.join(RAIZ, 'mobile/src/orbe/orbeHtml.ts');

export function generar() {
  const html = fs.readFileSync(FUENTE, 'utf8');
  const huella = createHash('sha256').update(html).digest('hex').slice(0, 16);
  return (
    '/**\n' +
    ' * GENERADO por scripts/orbe-movil.mjs — no editar a mano.\n' +
    ' * El orbe de AURA (src/14-orbe/orbe.html) para la WebView del teléfono.\n' +
    ' * Si cambias el orbe: `node scripts/orbe-movil.mjs` (tests/orbe-movil.test.ts lo exige).\n' +
    ' */\n' +
    `export const ORBE_HUELLA = '${huella}';\n` +
    `export const ORBE_HTML = ${JSON.stringify(html)};\n`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const nuevo = generar();
  const viejo = fs.existsSync(DESTINO) ? fs.readFileSync(DESTINO, 'utf8') : '';
  if (process.argv.includes('--revisar')) {
    if (nuevo !== viejo) {
      console.error('mobile/src/orbe/orbeHtml.ts desactualizado: corre `node scripts/orbe-movil.mjs`');
      process.exit(1);
    }
    console.log('el orbe del teléfono está al día');
  } else {
    fs.writeFileSync(DESTINO, nuevo);
    console.log(`escrito ${path.relative(RAIZ, DESTINO)} (${(nuevo.length / 1024).toFixed(0)} KB)`);
  }
}
