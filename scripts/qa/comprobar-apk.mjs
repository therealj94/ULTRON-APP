#!/usr/bin/env node
/**
 * Abre un APK y comprueba que es la app que dice ser.
 *
 * Existe por un fallo concreto y silencioso: la APK de Dr Electrum salió con su paquete, su icono
 * y su nombre correctos, y con la configuración de ULTRON embebida dentro. Al abrirla habría
 * arrancado la mesa de la junta. Compilaba, instalaba y estaba mal.
 *
 * La causa: `expo-constants` instala una tarea de Gradle que REGENERA `assets/app.config` en cada
 * compilación, así que `app.config.js` se evalúa dos veces —una en el prebuild y otra dentro de
 * `assembleRelease`— y la variante solo estaba puesta en la primera. Nada en la salida de Gradle
 * lo insinuaba; los dos APK pesaban 64 bytes distintos.
 *
 *   node scripts/qa/comprobar-apk.mjs out/DR-ELECTRUM-FP-4.1.2.apk electrum
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const apk = process.argv[2];
const variante = (process.argv[3] || 'ultron').toLowerCase();

const ESPERADO = {
  ultron: { paquete: 'link.ordenglobal.ultronfp', nombre: 'ULTRON FP', orientacion: 'landscape', ubicacion: false },
  electrum: { paquete: 'link.ordenglobal.drelectrumfp', nombre: 'Dr Electrum FP', orientacion: 'portrait', ubicacion: true },
};

const quiero = ESPERADO[variante];
if (!quiero) throw new Error(`variante desconocida: ${variante}`);
if (!fs.existsSync(apk)) throw new Error(`no encuentro el APK: ${apk}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apk-'));
execFileSync('unzip', ['-o', '-q', path.resolve(apk), 'assets/app.config', 'AndroidManifest.xml', '-d', tmp]);

const cfg = JSON.parse(fs.readFileSync(path.join(tmp, 'assets/app.config'), 'utf8'));
// El manifiesto es AXML binario: las cadenas van en UTF-16, así que se leen como tal.
const manifiesto = fs.readFileSync(path.join(tmp, 'AndroidManifest.xml')).toString('utf16le');

const fallos = [];
const comprobar = (que, tiene, espera) => {
  if (tiene !== espera) fallos.push(`${que}: esperaba «${espera}», el APK trae «${tiene}»`);
};

comprobar('extra.variante', cfg?.extra?.variante, variante);
comprobar('name', cfg?.name, quiero.nombre);
comprobar('orientation', cfg?.orientation, quiero.orientacion);
comprobar('android.package', cfg?.android?.package, quiero.paquete);

const tieneUbicacion = /permission\.ACCESS_(FINE|COARSE)_LOCATION/.test(manifiesto);
if (tieneUbicacion !== quiero.ubicacion) {
  fallos.push(
    quiero.ubicacion
      ? 'permisos: falta la ubicación, y esta app la necesita para decir sobre qué concesión estás'
      : 'permisos: pide la UBICACIÓN y no la usa. La mete expo-location al fusionar; hay que bloquearla'
  );
}

console.log(`${apk}`);
console.log(`  variante ${cfg?.extra?.variante} · ${cfg?.name} · ${cfg?.android?.package} · ${cfg?.orientation} · ubicación ${tieneUbicacion ? 'sí' : 'no'}`);

if (fallos.length) {
  console.error(`\n✗ este APK no es la app que dice ser:`);
  for (const f of fallos) console.error(`   · ${f}`);
  process.exit(1);
}
console.log('  ✓ es la app que dice ser');
