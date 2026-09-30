#!/usr/bin/env node
/**
 * LOS MODELOS 3D DE LOS AVATARES, de la entrega de Codex a la APK: un solo comando.
 *
 *   npm run avatar3d                                 # TODO: escena + modelos + registro + fotos de ANT-ONIO
 *   npx tsx scripts/avatar3d-assets.mjs              # prepara, revisa y registra los tres
 *   npx tsx scripts/avatar3d-assets.mjs --fotos      # … y rehace las fotos 2D de ANT-ONIO desde su modelo
 *   npx tsx scripts/avatar3d-assets.mjs --revisar    # solo revisa lo que ya está en mobile/assets/avatar3d
 *
 * Cuando el relevo de Codex deje los finales en vendor/aura-avatar-suite/assets/movil/, basta
 * `npm run avatar3d` (y correr las pruebas): los toma solos en vez de los provisionales.
 *
 * De dónde sale cada uno (vendor/aura-avatar-suite, que NO se edita aquí: se consume):
 *
 *   · el FINAL, si existe: vendor/aura-avatar-suite/assets/movil/{aura,claudio,antonio}.glb (los que
 *     optimiza el relevo de Codex). Se vuelve a pasar por la misma tubería: si ya viene liviano,
 *     casi no cambia; si trae Draco, se pasa a meshopt (el único decodificador que va en la escena).
 *   · si no, uno PROVISIONAL desde los GLB de la entrega (AURA-ORBE.glb, CLAUDIO.glb, ANT-ONIO.glb;
 *     los dos últimos se rearman de sus partes con la herramienta de la entrega, sin red).
 *
 * La tubería (gltf-transform + meshoptimizer; sharp para las texturas):
 *   1. los morph targets sin nombre («0»…«5») de la cara y el contorno de los labios toman los nombres
 *      de los de la boca (open, laugh, round, wide, frown, closed): así la escena los mueve juntos;
 *   2. fuera KHR_materials_sheen (cara en un teléfono y la escena no la necesita);
 *   3. dedup + prune + resample (las 30 animaciones repiten texturas y poses constantes);
 *   4. simplify hasta el presupuesto de triángulos (mapeo: PRESUPUESTO_NODOS), solo si se pasa;
 *   5. texturas a WebP, como mucho 1024 px;
 *   6. meshopt (cuantiza y comprime geometría y animaciones).
 * Después, cada .glb se revisa con mobile/scripts/avatar3d-modelo.mjs (≤ 3 MB, triángulos, clips y
 * morphs que pide el mapeo del perfil «nodos») y, si los tres pasan, se reescribe src/avatar3d/modelo.ts.
 *
 * Se corre con tsx porque el revisor lee los nombres directamente de mobile/src/avatar3d/mapeo.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTREGA = path.join(RAIZ, 'vendor/aura-avatar-suite');
const DESTINO = path.join(RAIZ, 'mobile/assets/avatar3d');

/** Cada avatar de la app y su modelo en la entrega. */
export const FUENTES = [
  { avatar: 'aura', final: 'assets/movil/aura.glb', provisional: 'assets/AURA-ORBE.glb' },
  { avatar: 'claudio', final: 'assets/movil/claudio.glb', provisional: 'assets/CLAUDIO.glb' },
  { avatar: 'antonio', final: 'assets/movil/antonio.glb', provisional: 'assets/ANT-ONIO.glb' },
];

/** Los avatares sin ilustraciones propias: sus fotos 2D de respaldo se sacan de su modelo 3D. */
export const SOLO_3D = ['antonio'];

/** El mapeo que acompaña a cada modelo: el perfil de los rigs de Codex (mobile/src/avatar3d/mapeo.ts). */
const MAPEO_NODOS = { perfil: 'nodos' };

const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

async function herramientas() {
  const [{ NodeIO }, ext, fn, mo, draco3d, sharp] = await Promise.all([
    import('@gltf-transform/core'),
    import('@gltf-transform/extensions'),
    import('@gltf-transform/functions'),
    import('meshoptimizer'),
    import('draco3dgltf'),
    import('sharp'),
  ]);
  await Promise.all([mo.MeshoptDecoder.ready, mo.MeshoptEncoder.ready, mo.MeshoptSimplifier.ready]);
  const io = new NodeIO().registerExtensions(ext.ALL_EXTENSIONS).registerDependencies({
    // Draco solo para LEER (por si el final viene así); lo que sale va siempre con meshopt.
    'draco3d.decoder': await draco3d.default.createDecoderModule(),
    'meshopt.decoder': mo.MeshoptDecoder,
    'meshopt.encoder': mo.MeshoptEncoder,
  });
  return { io, fn, mo, sharp: sharp.default };
}

/** Los targets «0»…«5» de una malla toman los nombres de la única otra malla con esa cantidad nombrada. */
function nombrarMorphs(doc) {
  const mallas = doc.getRoot().listMeshes();
  const nombres = (m) => (Array.isArray(m.getExtras()?.targetNames) ? m.getExtras().targetNames : null);
  const conNombre = mallas.map(nombres).filter((n) => n && n.length && n.some((x) => !/^\d+$/.test(String(x))));
  let cambiadas = 0;
  for (const m of mallas) {
    const n = nombres(m);
    const cuantos = m.listPrimitives()[0]?.listTargets().length || 0;
    if (!cuantos || (n && n.some((x) => !/^\d+$/.test(String(x))))) continue;
    const iguales = [...new Set(conNombre.filter((c) => c.length === cuantos).map((c) => c.join('|')))];
    if (iguales.length !== 1) continue;
    const nuevos = iguales[0].split('|');
    // gltf-transform escribe `extras.targetNames` con los nombres de los targets: van en los dos lados.
    m.setExtras({ ...(m.getExtras() || {}), targetNames: nuevos });
    for (const p of m.listPrimitives()) p.listTargets().forEach((t, i) => t.setName(nuevos[i]));
    cambiadas++;
  }
  return cambiadas;
}

/** Los triángulos que se dibujan (una malla en dos nodos, como los ojos, cuenta dos veces). */
function contarTriangulos(doc) {
  let t = 0;
  for (const n of doc.getRoot().listNodes())
    for (const p of n.getMesh()?.listPrimitives() || []) {
      const i = p.getIndices();
      const pos = p.getAttribute('POSITION');
      if (p.getMode() === 4) t += (i ? i.getCount() : pos?.getCount() || 0) / 3;
    }
  return Math.round(t);
}

async function preparar(t, entrada, salida, presupuesto) {
  const { io, fn, mo, sharp } = t;
  const doc = await io.read(entrada);
  const antes = contarTriangulos(doc);
  const nombradas = nombrarMorphs(doc);
  for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'KHR_materials_sheen') e.dispose();
  await doc.transform(fn.dedup(), fn.prune(), fn.resample(), fn.weld());
  // El simplificador de meshoptimizer, con la misma proporción en todas las mallas, hasta que entre.
  let tri = contarTriangulos(doc);
  for (let vuelta = 0; tri > presupuesto && vuelta < 6; vuelta++) {
    const ratio = Math.max(0.05, (presupuesto / tri) * 0.97);
    await doc.transform(fn.simplify({ simplifier: mo.MeshoptSimplifier, ratio, error: 0.004 * (vuelta + 1), lockBorder: false }));
    tri = contarTriangulos(doc);
  }
  await doc.transform(
    fn.prune(),
    fn.textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }),
    fn.meshopt({ encoder: mo.MeshoptEncoder, level: 'medium' })
  );
  const bytes = await io.writeBinary(doc);
  fs.writeFileSync(salida, bytes);
  return { antes, despues: contarTriangulos(doc), nombradas, bytes: bytes.length };
}

/** Rearma ANT-ONIO y CLAUDIO desde sus partes verificadas (herramienta de la entrega, sin red). */
function rearmarProvisionales() {
  const falta = FUENTES.some((f) => !fs.existsSync(path.join(ENTREGA, f.final)) && !fs.existsSync(path.join(ENTREGA, f.provisional)));
  if (falta) execFileSync(process.execPath, [path.join(ENTREGA, 'tools/restore-models.mjs')], { stdio: 'inherit' });
}

export async function main(argv = process.argv.slice(2)) {
  const R = await import('../mobile/scripts/avatar3d-modelo.mjs');
  const { PRESUPUESTO_NODOS } = await import('../mobile/src/avatar3d/mapeo.ts');
  if (!argv.includes('--revisar')) {
    rearmarProvisionales();
    fs.mkdirSync(DESTINO, { recursive: true });
    const t = await herramientas();
    for (const f of FUENTES) {
      const final = path.join(ENTREGA, f.final);
      const esFinal = fs.existsSync(final);
      const entrada = esFinal ? final : path.join(ENTREGA, f.provisional);
      const salida = path.join(DESTINO, `${f.avatar}.glb`);
      const r = await preparar(t, entrada, salida, PRESUPUESTO_NODOS);
      fs.writeFileSync(path.join(DESTINO, `${f.avatar}.mapeo.json`), JSON.stringify(MAPEO_NODOS, null, 2) + '\n');
      console.log(
        `${f.avatar}: ${esFinal ? 'FINAL' : 'provisional'} ${path.relative(RAIZ, entrada)} (${mb(fs.statSync(entrada).size)}, ${r.antes} triángulos)` +
          ` → ${path.relative(RAIZ, salida)} (${mb(r.bytes)}, ${r.despues} triángulos${r.nombradas ? `, ${r.nombradas} mallas con morphs nombrados` : ''})`
      );
    }
  }
  const modelos = R.modelosEnCarpeta();
  let malos = 0;
  for (const m of modelos) {
    console.log(`\n${m.avatar}.glb  ${JSON.stringify({ bytes: m.resumen.bytes, triangulos: m.resumen.triangulos, animaciones: m.resumen.animaciones?.length, blendshapes: m.resumen.blendshapes })}`);
    for (const e of m.errores) console.log(`  ERROR  ${e}`);
    for (const a of m.avisos) console.log(`  aviso  ${a}`);
    if (m.errores.length) malos++;
  }
  if (malos) {
    console.error(`\n${malos} modelo(s) no cumplen: no se registra nada.`);
    return 1;
  }
  const nuevo = R.generarRegistro(modelos);
  if (argv.includes('--revisar')) {
    if (fs.readFileSync(R.REGISTRO, 'utf8') !== nuevo) {
      console.error('\nmobile/src/avatar3d/modelo.ts no coincide con mobile/assets/avatar3d.');
      return 1;
    }
    console.log('\nregistro de modelos 3D al día');
    return 0;
  }
  fs.writeFileSync(R.REGISTRO, nuevo);
  const total = modelos.reduce((s, m) => s + m.bytes, 0);
  console.log(`\nmobile/src/avatar3d/modelo.ts · ${modelos.map((m) => m.avatar).join(', ')} · ${mb(total)} en total`);
  if (argv.includes('--fotos')) {
    // ANT-ONIO no tiene ilustraciones: su respaldo 2D sale de su modelo (con la escena ya empaquetada).
    const { fotografiar } = await import('./avatar3d-fotos.mjs');
    for (const avatar of SOLO_3D) console.log(`${avatar}: ${(await fotografiar(avatar)).length} fotos 2D rehechas desde su modelo`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main());
