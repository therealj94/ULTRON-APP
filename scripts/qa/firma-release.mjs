#!/usr/bin/env node
/**
 * Pone la firma propia al release en el `android/app/build.gradle` que genera `expo prebuild`.
 *
 * El template firma el release con `signingConfigs.debug` (la keystore debug que viene en el
 * template, igual en todos los proyectos: su huella es pública). Para que Android verifique el App
 * Link de AU-RA (/.well-known/assetlinks.json) la APK tiene que ir firmada con una llave que solo
 * tengamos nosotros, y esa huella es la que va en ANDROID_CERT_SHA256 del servidor.
 *
 * Aquí NO hay secretos: el bloque que se inyecta lee todo del entorno cuando Gradle compila
 * (AURA_FIRMA_ARCHIVO, AURA_FIRMA_CLAVE, AURA_FIRMA_ALIAS, AURA_FIRMA_CLAVE_LLAVE), que el flujo
 * llena desde los secretos. Nada queda escrito en un archivo ni en la línea de comandos.
 *
 * Si el template cambia y no se encuentra dónde inyectar, falla: mejor un CI rojo que una APK
 * «firmada» que en realidad salió con la keystore debug.
 *
 *   node scripts/qa/firma-release.mjs mobile/android/app/build.gradle
 */
import fs from 'node:fs';

const ruta = process.argv[2] || 'android/app/build.gradle';
const MARCA = '// firma-release.mjs';
let g = fs.readFileSync(ruta, 'utf8');

if (g.includes(MARCA)) {
  console.log(`${ruta}: la firma propia ya estaba`);
  process.exit(0);
}

/** El bloque `nombre {` que empieza en `desde`, con su cierre (cuenta llaves). */
function bloque(texto, nombre, desde = 0) {
  const m = new RegExp(`\\n(\\s*)${nombre}\\s*\\{`, 'g');
  m.lastIndex = desde;
  const r = m.exec(texto);
  if (!r) return null;
  const abre = r.index + r[0].length;
  let nivel = 1;
  for (let i = abre; i < texto.length; i++) {
    if (texto[i] === '{') nivel++;
    else if (texto[i] === '}' && --nivel === 0) return { inicio: r.index, abre, cierra: i, sangria: r[1] };
  }
  return null;
}

const firmas = bloque(g, 'signingConfigs');
if (!firmas) throw new Error(`${ruta}: no encuentro signingConfigs { … }`);
const s = firmas.sangria + '    ';
const release = [
  `${s}${MARCA}: la firma propia; archivo y claves llegan por el entorno (ver .github/workflows/android-apk.yml).`,
  `${s}release {`,
  `${s}    storeFile file(System.getenv('AURA_FIRMA_ARCHIVO'))`,
  `${s}    storePassword System.getenv('AURA_FIRMA_CLAVE')`,
  `${s}    keyAlias System.getenv('AURA_FIRMA_ALIAS') ?: 'aura'`,
  `${s}    keyPassword System.getenv('AURA_FIRMA_CLAVE_LLAVE') ?: System.getenv('AURA_FIRMA_CLAVE')`,
  `${s}}`,
  '',
].join('\n');
// Justo antes de la línea que cierra signingConfigs (sin dejar espacios colgando).
let corte = firmas.cierra;
while (g[corte - 1] === ' ' || g[corte - 1] === '\t') corte--;
g = g.slice(0, corte) + release + g.slice(corte);

// En buildTypes { release { … signingConfig signingConfigs.debug … } } → signingConfigs.release.
const tipos = bloque(g, 'buildTypes');
if (!tipos) throw new Error(`${ruta}: no encuentro buildTypes { … }`);
const rel = bloque(g, 'release', tipos.abre);
if (!rel || rel.cierra > tipos.cierra) throw new Error(`${ruta}: no encuentro buildTypes { release { … } }`);
const cuerpo = g.slice(rel.abre, rel.cierra);
const n = (cuerpo.match(/signingConfig\s+signingConfigs\.debug\b/g) || []).length;
if (n !== 1) throw new Error(`${ruta}: esperaba un «signingConfig signingConfigs.debug» en el release y hay ${n}`);
g = g.slice(0, rel.abre) + cuerpo.replace(/signingConfig\s+signingConfigs\.debug\b/, `signingConfig signingConfigs.release ${MARCA}`) + g.slice(rel.cierra);

fs.writeFileSync(ruta, g);
console.log(`${ruta}: el release se firma con la keystore propia`);
