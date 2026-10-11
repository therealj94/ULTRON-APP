/**
 * El veredicto del emulador (veredicto.mjs), sin emulador (hallazgo REL01): la corrida 38110074861 salió VERDE con la
 * OTA publicada sin cargar y los cinco escenarios con cuenta OMITIDO. Aquí: humo y aceptación por separado, y la
 * aceptación nunca PASA con la OTA sin cargar ni con escenarios omitidos. Más la lectura de la base de expo-updates
 * (ota-cargada.py) y que el flujo y correr.sh usen todo esto.
 *
 *   cd mobile && npx tsx pruebas/emulador/veredicto.prueba.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clasificar, decidir, leerResultados, markdown } from './veredicto.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
let fallos = 0;
let n = 0;
function prueba(nombre, f) {
  n++;
  try {
    f();
    console.log('ok -', nombre);
  } catch (e) {
    fallos++;
    console.log('FALLA -', nombre, '\n ', String(e?.message || e).slice(0, 400));
  }
}

const ESPERADA = '0199c3a2-7d1e-7b8a-9f00-123456789abc';
const OTRA = '0199c3a2-0000-7000-8000-000000000001';
const EMBEBIDA = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const RT = 'f3a1c0ffee';

const HUMO_OK = [
  ['0 · Instalar la APK', 'PASA', 'Instalada'],
  ['0 · La app abre (sin cuenta)', 'PASA', 'Abre'],
];
const ACEP = ['1 · Abre, entra y la mesa se ve', '2 · Cambiar a Claudio pide confirmación', '3 · La misma pregunta dos veces', '4 · «¿me oyes?» no se come la pregunta', '5 · La cámara aguanta 20 s'];
const tsv = (filas) => filas.map((f) => f.join('\t')).join('\n') + '\n';
const todasPasan = tsv([...HUMO_OK, ...ACEP.map((e) => [e, 'PASA', 'bien'])]);
const sinCuenta = tsv([...HUMO_OK, ['0 · El formulario de correo y clave (sin escribir)', 'PASA', 'ok'], ...ACEP.map((e) => [e, 'OMITIDO', 'Sin cuenta de prueba segura: Faltan los secretos.'])]);
const ota = (lanzada, extra = {}) => ({ esperada: ESPERADA, runtimeEsperado: RT, canalEsperado: 'production', canalApk: 'production', embebida: EMBEBIDA, lanzada, ...extra });
const OTA_OK = { fuente: 'ota', updateId: ESPERADA.toUpperCase(), runtime: RT };
const EMB = { fuente: 'embebido', updateId: EMBEBIDA, runtime: RT };
const v = (texto, o, modo) => decidir({ resultados: leerResultados(texto), ota: o, modo });

prueba('clasificar: «0 · …» y «Cierres de la app» son humo; 1 · … a 5 · …, aceptación', () => {
  assert.equal(clasificar('0 · Instalar la APK'), 'humo');
  assert.equal(clasificar('Cierres de la app'), 'humo');
  for (const e of ACEP) assert.equal(clasificar(e), 'aceptacion', e);
});

prueba('OTA esperada cargada + todo PASA → humo PASA, aceptación PASA, verde', () => {
  const r = v(todasPasan, ota(OTA_OK));
  assert.equal(r.humo, 'PASA');
  assert.equal(r.aceptacion, 'PASA');
  assert.equal(r.otaCargada, 'esperada', 'sin distinguir mayúsculas');
  assert.equal(r.rojo, false);
  assert.deepEqual(r.motivos.aceptacion, []);
});

prueba('OTA sin cargar (JS embebido) → INCONCLUSA, nunca PASA; rojo en modo aceptación', () => {
  const r = v(todasPasan, ota(EMB));
  assert.equal(r.aceptacion, 'INCONCLUSA');
  assert.equal(r.otaCargada, 'embebido');
  assert.equal(r.rojo, true);
  assert.match(r.motivos.aceptacion.join(' '), /JS embebido/);
});

prueba('no se pudo leer qué corre la app → INCONCLUSA', () => {
  const r = v(todasPasan, ota(null, { motivo: 'sin su' }));
  assert.equal(r.aceptacion, 'INCONCLUSA');
  assert.equal(r.otaCargada, 'desconocida');
  assert.equal(r.rojo, true);
});

prueba('cargó OTRA OTA → FALLA', () => {
  const r = v(todasPasan, ota({ fuente: 'ota', updateId: OTRA, runtime: RT }));
  assert.equal(r.aceptacion, 'FALLA');
  assert.equal(r.otaCargada, 'otra');
  assert.equal(r.rojo, true);
});

prueba('la OTA esperada pero con otro runtime, o la APK en otro canal → FALLA', () => {
  assert.equal(v(todasPasan, ota({ ...OTA_OK, runtime: 'otro' })).aceptacion, 'FALLA');
  assert.equal(v(todasPasan, ota(OTA_OK, { canalApk: 'preview' })).aceptacion, 'FALLA');
  assert.equal(v(todasPasan, ota(OTA_OK, { canalApk: '' })).aceptacion, 'PASA', 'canal ilegible: no decide');
});

prueba('escenarios OMITIDO (sin cuenta) → INCONCLUSA, aunque la OTA esté cargada (el caso de la corrida 38110074861, y peor)', () => {
  const r = v(sinCuenta, ota(OTA_OK));
  assert.equal(r.humo, 'PASA', 'el humo sí pasa');
  assert.equal(r.aceptacion, 'INCONCLUSA');
  assert.equal(r.omitidos.length, 5);
  assert.equal(r.rojo, true, 'después de una OTA, rojo');
  const corrida = v(sinCuenta, ota(EMB));
  assert.equal(corrida.aceptacion, 'INCONCLUSA');
  assert.equal(corrida.rojo, true);
});

prueba('un solo omitido basta para no aceptar', () => {
  const t = tsv([...HUMO_OK, ...ACEP.slice(0, 4).map((e) => [e, 'PASA', '']), [ACEP[4], 'OMITIDO', 'Sin tiempo']]);
  assert.equal(v(t, ota(OTA_OK)).aceptacion, 'INCONCLUSA');
});

prueba('humo que falla → humo FALLA y aceptación FALLA, rojo en cualquier modo', () => {
  const t = tsv([['0 · Instalar la APK', 'PASA', ''], ['0 · La app abre (sin cuenta)', 'FALLA', 'no llegó'], ...ACEP.map((e) => [e, 'PASA', ''])]);
  for (const modo of ['aceptacion', 'humo']) {
    const r = v(t, ota(OTA_OK), modo);
    assert.equal(r.humo, 'FALLA');
    assert.equal(r.aceptacion, 'FALLA');
    assert.equal(r.rojo, true, modo);
  }
  const cierre = v(todasPasan + 'Cierres de la app\tFALLA\t2 cierres\n', ota(OTA_OK));
  assert.equal(cierre.humo, 'FALLA', 'un cierre de la app es humo');
});

prueba('sin resultados (el emulador no arrancó) → humo FALLA, rojo', () => {
  const r = v('', ota(null), 'humo');
  assert.equal(r.humo, 'FALLA');
  assert.equal(r.rojo, true);
});

prueba('un escenario de aceptación en FALLA → FALLA', () => {
  const t = tsv([...HUMO_OK, ...ACEP.map((e, i) => [e, i === 2 ? 'FALLA' : 'PASA', ''])]);
  assert.equal(v(t, ota(OTA_OK)).aceptacion, 'FALLA');
});

prueba('modo «humo» (a mano sin OTA esperada): verde con humo PASA, pero la aceptación sigue INCONCLUSA', () => {
  const r = v(sinCuenta, { esperada: '', lanzada: EMB, embebida: EMBEBIDA }, 'humo');
  assert.equal(r.humo, 'PASA');
  assert.equal(r.aceptacion, 'INCONCLUSA');
  assert.equal(r.rojo, false);
  assert.match(markdown(r, leerResultados(sinCuenta), { esperada: '' }), /solo humo/);
});

prueba('sin modo, se exige la aceptación (lo seguro)', () => {
  assert.equal(decidir({ resultados: leerResultados(sinCuenta), ota: ota(OTA_OK) }).rojo, true);
});

prueba('propiedad: nunca PASA con la OTA sin cargar o con un omitido (todas las combinaciones)', () => {
  const lanzadas = [EMB, null, { fuente: 'ota', updateId: OTRA }, OTA_OK];
  const estados = ['PASA', 'OMITIDO', 'FALLA'];
  for (const l of lanzadas) {
    for (const s of estados) {
      for (const esperada of [ESPERADA, '']) {
        const t = tsv([...HUMO_OK, ...ACEP.map((e, i) => [e, i === 1 ? s : 'PASA', ''])]);
        const r = v(t, ota(l, { esperada }));
        const otaBien = l === OTA_OK && esperada;
        if (r.aceptacion === 'PASA') assert.ok(otaBien && s === 'PASA', `PASA indebido: ${JSON.stringify({ l, s, esperada })}`);
        if (!otaBien || s !== 'PASA') assert.equal(r.rojo, true, 'en modo aceptación, rojo');
      }
    }
  }
});

prueba('el resumen trae humo, aceptación, OTA esperada, OTA cargada, JS embebido y omitidos', () => {
  const t = sinCuenta;
  const o = ota(EMB);
  const md = markdown(v(t, o), leerResultados(t), o);
  for (const s of ['Humo', 'Aceptación de la OTA', 'OTA esperada', 'OTA cargada', 'JS de la APK (embebido)', 'Omitidos', ESPERADA, EMBEBIDA, '⚠️ INCONCLUSA', '❌ no aceptado']) {
    assert.ok(md.includes(s), `falta «${s}»`);
  }
  assert.doesNotMatch(md, /OTA aceptada/);
});

prueba('ota-cargada.py: lanzada = la más reciente CON lanzamientos; una OTA bajada sin lanzar no cuenta', () => {
  const py = spawnSync('python3', ['--version']);
  if (py.status !== 0) return console.log('  (sin python3: se salta)');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-db-'));
  const db = path.join(d, 'updates.db');
  const crear = (filas) => {
    fs.rmSync(db, { force: true });
    const sql = `
import sqlite3, uuid, sys
con = sqlite3.connect(sys.argv[1])
con.execute("CREATE TABLE updates (id BLOB NOT NULL PRIMARY KEY, scope_key TEXT NOT NULL, commit_time INTEGER NOT NULL, runtime_version TEXT NOT NULL, launch_asset_id INTEGER, manifest TEXT, status INTEGER NOT NULL, keep INTEGER NOT NULL, last_accessed INTEGER NOT NULL, successful_launch_count INTEGER NOT NULL DEFAULT 0, failed_launch_count INTEGER NOT NULL DEFAULT 0)")
for (i, st, acc, ok) in ${JSON.stringify(filas)}:
    con.execute("INSERT INTO updates VALUES (?, 's', 0, ?, NULL, '{}', ?, 1, ?, ?, 0)", (uuid.UUID(i).bytes, '${RT}', st, acc, ok))
con.commit()
`;
    const r = spawnSync('python3', ['-I', '-c', sql, db], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  };
  const leer = () => JSON.parse(spawnSync('python3', ['-I', path.join(AQUI, 'ota-cargada.py'), db], { encoding: 'utf8' }).stdout);
  // Embebido lanzado; la OTA bajada DESPUÉS (last_accessed más nuevo) pero sin lanzar: corre el embebido.
  crear([[EMBEBIDA, 5, 1000, 1], [ESPERADA, 1, 2000, 0]]);
  let o = leer();
  assert.equal(o.lanzada.fuente, 'embebido');
  assert.equal(o.embebida, EMBEBIDA);
  assert.deepEqual(o.descargadas, [ESPERADA]);
  // Reabierta: la OTA se lanzó (accedida después y con un lanzamiento contado).
  crear([[EMBEBIDA, 5, 1000, 1], [ESPERADA, 1, 3000, 1]]);
  o = leer();
  assert.equal(o.lanzada.fuente, 'ota');
  assert.equal(o.lanzada.updateId, ESPERADA);
  assert.equal(o.lanzada.runtime, RT);
  // Sin base: no se adivina.
  fs.rmSync(db, { force: true });
  o = leer();
  assert.equal(o.leida, false);
  assert.equal(o.lanzada, null);
  fs.rmSync(d, { recursive: true, force: true });
});

prueba('correr.sh ya no toma «Stored update found» como «la carga» y escribe datos/ota.json; el flujo usa veredicto.mjs', () => {
  const sh = fs.readFileSync(path.join(AQUI, 'correr.sh'), 'utf8');
  const codigoSh = sh.replace(/^\s*#.*$/gm, '');
  assert.doesNotMatch(codigoSh, /Stored update found/, 'esa línea dice «bajada y pendiente», no «corriendo»');
  assert.match(codigoSh, /ota-cargada\.py/);
  assert.match(codigoSh, /datos\/ota\.json/);
  assert.match(codigoSh, /OTA_CICLOS/);
  const flujo = fs.readFileSync(path.join(AQUI, '../../../.github/workflows/emulador-android.yml'), 'utf8');
  const veredicto = flujo.slice(flujo.indexOf('- name: Veredicto'));
  assert.match(veredicto, /veredicto\.mjs .*--salir/);
  assert.match(veredicto, /MODO: \$\{\{ steps\.apk\.outputs\.modo \}\}/);
  assert.doesNotMatch(veredicto, /grep -qx FALLA/, 'el veredicto viejo solo miraba FALLA');
  assert.doesNotMatch(flujo, /OMITIDO \(sin cuenta\) no es un fallo/);
  assert.match(flujo, /veredicto\.mjs .*--markdown >> "\$GITHUB_STEP_SUMMARY"/);
  assert.match(flujo, /if \[ "\$EVENTO" != "workflow_run" \]/, 'después de una OTA, siempre modo aceptación');
});

console.log(`\n${n - fallos}/${n} pruebas del veredicto del emulador`);
process.exit(fallos ? 1 : 0);
