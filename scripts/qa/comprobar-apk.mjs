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
  electrum: { paquete: 'link.ordenglobal.drelectrumfp', nombre: 'Dr Electrum FP', orientacion: 'landscape', ubicacion: true },
};

const quiero = ESPERADO[variante];
if (!quiero) throw new Error(`variante desconocida: ${variante}`);
if (!fs.existsSync(apk)) throw new Error(`no encuentro el APK: ${apk}`);

/**
 * Lector mínimo de AndroidManifest.xml compilado (AXML), para una sola cosa: la orientación.
 *
 * Hace falta porque en el APK el manifiesto NO es texto. `android:screenOrientation` se guarda
 * como un ENTERO (landscape=0, portrait=1) y el nombre del atributo se referencia por su id de
 * recurso, no por su nombre. Buscar «landscape» con `strings` no encuentra nada y parece que el
 * manifiesto no declara orientación — que es justo lo que me pareció a mí la primera vez.
 *
 * Y comprobarla importa: la orientación del `app.config` es lo que la app pide en JS, pero la que
 * Android OBEDECE al lanzar la actividad es esta. Si las dos se separaran, la app arrancaría
 * girada y el `app.config` diría que todo está bien.
 */
const ORIENTACION = ['landscape', 'portrait', 'user', 'behind', 'sensor', 'nosensor', 'sensorLandscape', 'sensorPortrait', 'reverseLandscape', 'reversePortrait', 'fullSensor', 'userLandscape', 'userPortrait', 'fullUser', 'locked'];
const ID_SCREEN_ORIENTATION = 0x0101001e;
const ID_NAME = 0x01010003;

function orientacionDeManifiesto(buf) {
  let off = 8;
  const csize = buf.readUInt32LE(off + 4);
  const nStr = buf.readUInt32LE(off + 8);
  const flags = buf.readUInt32LE(off + 16);
  const strStart = buf.readUInt32LE(off + 20);
  const utf8 = !!(flags & (1 << 8));
  const cad = [];
  for (let i = 0; i < nStr; i += 1) {
    let p = off + strStart + buf.readUInt32LE(off + 28 + i * 4);
    if (utf8) {
      p += buf[p] & 0x80 ? 2 : 1;
      let l = buf[p];
      if (l & 0x80) { l = ((l & 0x7f) << 8) | buf[p + 1]; p += 2; } else { p += 1; }
      cad.push(buf.subarray(p, p + l).toString('utf8'));
    } else {
      const l = buf.readUInt16LE(p);
      cad.push(buf.subarray(p + 2, p + 2 + l * 2).toString('utf16le'));
    }
  }

  off += csize;
  let mapa = [];
  const actividades = [];
  while (off + 8 <= buf.length) {
    const tipo = buf.readUInt16LE(off);
    const sz = buf.readUInt32LE(off + 4);
    if (!sz) break;
    if (tipo === 0x0180) {
      mapa = [];
      for (let i = 0; i < (sz - 8) / 4; i += 1) mapa.push(buf.readUInt32LE(off + 8 + i * 4));
    } else if (tipo === 0x0102) {
      const aStart = buf.readUInt16LE(off + 24);
      const aSize = buf.readUInt16LE(off + 26);
      const aCount = buf.readUInt16LE(off + 28);
      // Los atributos cuelgan del attrExt, que empieza en off+16 — no del chunk.
      let p = off + 16 + aStart;
      const attrs = {};
      for (let i = 0; i < aCount; i += 1) {
        const nm = buf.readUInt32LE(p + 4);
        attrs[mapa[nm]] = buf.readInt32LE(p + 16);
        p += aSize;
      }
      if (ID_SCREEN_ORIENTATION in attrs) {
        const v = attrs[ID_SCREEN_ORIENTATION];
        actividades.push({ nombre: cad[attrs[ID_NAME]] || '?', orientacion: ORIENTACION[v] ?? String(v) });
      }
    }
    off += sz;
  }
  return actividades;
}

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

/*
 * La actividad principal de la app, no las que traigan sus dependencias: ML Kit mete un lector de
 * códigos en vertical, y darla por buena o por mala sería juzgar código ajeno.
 */
const actividades = orientacionDeManifiesto(fs.readFileSync(path.join(tmp, 'AndroidManifest.xml')));
const principal = actividades.find((a) => a.nombre.startsWith(quiero.paquete));
if (!principal) fallos.push('el manifiesto nativo no declara orientación para la actividad principal');
else comprobar('MainActivity screenOrientation (nativo)', principal.orientacion, quiero.orientacion);

const tieneUbicacion = /permission\.ACCESS_(FINE|COARSE)_LOCATION/.test(manifiesto);
if (tieneUbicacion !== quiero.ubicacion) {
  fallos.push(
    quiero.ubicacion
      ? 'permisos: falta la ubicación, y esta app la necesita para decir sobre qué concesión estás'
      : 'permisos: pide la UBICACIÓN y no la usa. La mete expo-location al fusionar; hay que bloquearla'
  );
}

console.log(`${apk}`);
console.log(
  `  variante ${cfg?.extra?.variante} · ${cfg?.name} · ${cfg?.android?.package} · ${cfg?.orientation} (nativo: ${principal?.orientacion ?? '—'}) · ubicación ${tieneUbicacion ? 'sí' : 'no'}`
);

if (fallos.length) {
  console.error(`\n✗ este APK no es la app que dice ser:`);
  for (const f of fallos) console.error(`   · ${f}`);
  process.exit(1);
}
console.log('  ✓ es la app que dice ser');
