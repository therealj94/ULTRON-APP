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
 * Dos variantes por avatar (mapeo.ts: VARIANTES_NODOS):
 *   · «alta» ({avatar}.glb), la que se ve: SIN PÉRDIDA VISIBLE frente al original de Codex. La cabeza
 *     (todo lo que cuelga del nodo `head`: cara, ojos, párpados, boca, labios, cejas, lentes, orejas,
 *     pelaje, antenas) NO se simplifica; el cuerpo, solo con error acotado (una fracción del radio de
 *     cada pieza, con los bordes fijos) y solo si se pasa del presupuesto;
 *   · «ligera» ({avatar}-ligero.glb), para el teléfono que no da los cuadros con la alta (capacidad.ts):
 *     más simplificada, pero la cara sigue siendo la del original (simplificación suave, bordes fijos).
 *
 * La tubería (gltf-transform + meshoptimizer; sharp para las texturas):
 *   1. los morph targets sin nombre («0»…«5») de la cara y el contorno de los labios toman los nombres
 *      de los de la boca (open, laugh, round, wide, frown, closed): así la escena los mueve juntos;
 *   2. dedup + prune (las 30 animaciones repiten texturas); se conservan TODOS los materiales tal
 *      cual (el brillo de tela y pelo, KHR_materials_sheen, incluido). Las animaciones NO se
 *      remuestrean: `resample` movía la cabeza y el torso unas décimas de grado en cada pose, y eso
 *      solo ya corría la cara (y el pelaje) varios píxeles frente al original: era la mayor pérdida;
 *   3. el pelaje corto (cintas cruzadas del pelo de Claudio): la punta de cada cinta (dos vértices
 *      casi en el mismo lugar) pasa a uno: 3 triángulos en vez de 4, la misma silueta;
 *   4. simplificación con error acotado, por pieza, hasta el presupuesto de la variante;
 *   5. texturas a WebP en su tamaño original, calidad 92–95 en la alta;
 *   6. meshopt con cuantización fina (posición 16 bits, normales 12): el relieve no se escalona.
 * Después, cada .glb se revisa con mobile/scripts/avatar3d-modelo.mjs (peso, triángulos, clips y
 * morphs que pide el mapeo del perfil «nodos») y, si todos pasan, se reescribe src/avatar3d/modelo.ts.
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

/**
 * Cómo se aligera cada variante. `cuerpo`: los errores que se prueban, de menor a mayor, en lo que no
 * es cabeza (en unidades del modelo: simplificarMallas); `cabeza`: lo mismo para la cabeza (vacío = intacta);
 * `hebras`: cómo se aligera el pelaje (adelgazarHebras: «punta» sin cambio visible; «triangulo», la ligera);
 * `calidad…`: la del WebP (las texturas no se achican: quedan en el tamaño de la entrega).
 */
const AJUSTES = {
  alta: { cuerpo: [0.0003, 0.0006, 0.001], cabeza: [], hebras: { forma: 'punta' }, calidadTextura: 95, calidadNormales: 92 },
  ligera: { cuerpo: [0.002, 0.004, 0.006], cabeza: [0.001, 0.002, 0.003], hebras: { forma: 'triangulo', cada: 2 }, calidadTextura: 82, calidadNormales: 82 },
};

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

const trianglesDe = (p) => (p.getMode() === 4 ? (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0) / 3 : 0);

/** Los triángulos que se dibujan (una malla en dos nodos, como los ojos, cuenta dos veces). */
export function contarTriangulos(doc) {
  let t = 0;
  for (const n of doc.getRoot().listNodes()) for (const p of n.getMesh()?.listPrimitives() || []) t += trianglesDe(p);
  return Math.round(t);
}

/** Lo que no se simplifica ni en la ligera (por el nombre del nodo): lo que hace la expresión. */
const NUNCA = /iris|sclera|cornea|glint|eyelid|eye_line|eye_crease|brow|mouth|lip|lens|frame|temple|dental|teeth|tongue|nose|nostril|gold_|visor|display/i;

/** El nombre del (primer) nodo que usa esta malla. */
function nombreDe(doc, malla) {
  return doc.getRoot().listNodes().find((n) => n.getMesh() === malla)?.getName() || malla.getName() || '';
}

/** Las mallas de la cabeza: las de los nodos que cuelgan de `head` (en cualquier nodo que las use). */
function mallasDeCabeza(doc) {
  const cabeza = doc.getRoot().listNodes().find((n) => n.getName() === 'head');
  const out = new Set();
  if (!cabeza) return out;
  cabeza.traverse((n) => n.getMesh() && out.add(n.getMesh()));
  return out;
}

/**
 * EL PELAJE CORTO. Codex lo arma con cintas cruzadas (vendor/aura-avatar-suite/src/fur.js): cada eje
 * de cada pelo son 6 vértices (base, medio y punta, a los dos lados) y 4 triángulos con este orden de
 * índices, relativo al primero: 0 1 2 · 1 3 2 · 2 3 4 · 3 5 4. Dos formas de aligerarlo:
 *
 *  · «punta» (alta): los dos vértices de la punta (0,00003 de separación, menos de lo que mide un
 *    píxel aun en el retrato) se juntan en uno. El último triángulo queda degenerado y se va: 3
 *    triángulos por eje en vez de 4, con la MISMA silueta (base, medio curvado y punta donde estaban);
 *  · «triangulo» (ligera): cada eje queda en un triángulo base–punta, con la base un poco más ancha
 *    para cubrir la misma superficie; y se queda uno de cada `cada` pelos, tantas veces más ancho.
 *    Se nota (el pelo se ve más liso: se midió), por eso solo va en la ligera.
 *
 * Solo toca mallas cuyos índices tienen EXACTAMENTE ese patrón; lo demás queda igual.
 */
function adelgazarHebras(doc, fn, { forma, cada = 1 }) {
  const PATRON = [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4];
  // Cinta: base 2·0,0012 → medio (52 %) 2·0,0007 → punta ≈ 0; superficie 0,001324·L. Triángulo: 0,0012·L.
  const ANCHO = 1.103;
  let antes = 0;
  let despues = 0;
  const hechas = new Set();
  const v = [0, 0, 0];
  const w = [0, 0, 0];
  for (const malla of doc.getRoot().listMeshes()) {
    for (const p of malla.listPrimitives()) {
      const ind = p.getIndices();
      const pos = p.getAttribute('POSITION');
      // Una posición compartida por dos primitivas no se toca dos veces.
      if (!ind || !pos || hechas.has(pos) || p.listTargets().length || p.getMode() !== 4) continue;
      const a = ind.getArray();
      if (a.length < 12 || a.length % 12) continue;
      let ok = true;
      for (let g = 0; g < a.length && ok; g += 12) for (let k = 0; k < 12; k++) if (a[g + k] !== a[g] + PATRON[k]) { ok = false; break; }
      if (!ok) continue;
      hechas.add(pos);
      const nuevos = [];
      for (let g = 0; g < a.length; g += 12) {
        const f = a[g];
        if (forma === 'punta') {
          // La punta, en el medio de sus dos vértices.
          pos.getElement(f + 4, v);
          pos.getElement(f + 5, w);
          pos.setElement(f + 4, [(v[0] + w[0]) / 2, (v[1] + w[1]) / 2, (v[2] + w[2]) / 2]);
          nuevos.push(f, f + 1, f + 2, f + 1, f + 3, f + 2, f + 2, f + 3, f + 4);
          continue;
        }
        // Cada pelo son dos ejes (dos grupos seguidos): se queda o se va entero.
        if (Math.floor(g / 24) % cada) continue;
        // La base (f, f+1) se abre desde su centro; la punta es f+4.
        const ensanche = ANCHO * cada;
        pos.getElement(f, v);
        pos.getElement(f + 1, w);
        const c = [(v[0] + w[0]) / 2, (v[1] + w[1]) / 2, (v[2] + w[2]) / 2];
        pos.setElement(f, [c[0] + (v[0] - c[0]) * ensanche, c[1] + (v[1] - c[1]) * ensanche, c[2] + (v[2] - c[2]) * ensanche]);
        pos.setElement(f + 1, [c[0] + (w[0] - c[0]) * ensanche, c[1] + (w[1] - c[1]) * ensanche, c[2] + (w[2] - c[2]) * ensanche]);
        nuevos.push(f, f + 1, f + 4);
      }
      antes += a.length / 3;
      despues += nuevos.length / 3;
      ind.setArray(new a.constructor(nuevos));
      // Los vértices que ya no usa ningún triángulo: fuera.
      fn.compactPrimitive(p);
    }
  }
  return { antes, despues };
}

/**
 * Simplifica (error acotado, bordes fijos) las primitivas de estas mallas. El error va en UNIDADES DEL
 * MODELO, no en fracción de cada pieza: así un ojalillo del zapato y la chaqueta (con sus pliegues
 * esculpidos) se desvían lo mismo, como mucho `error` (el personaje mide ~4,5: 0,001 es menos de un
 * píxel aun en el retrato de pantalla completa). Una pieza chica no se desvía más del 5 % de su tamaño
 * ni se queda con menos del 5 % de sus triángulos (así no desaparece). Devuelve cuántas cambió.
 */
function simplificarMallas(doc, fn, mo, mallas, error) {
  let n = 0;
  for (const m of mallas)
    for (const p of m.listPrimitives()) {
      if (p.getMode() !== 4 || !p.getIndices() || trianglesDe(p) < 64) continue;
      const t = trianglesDe(p);
      const pos = p.getAttribute('POSITION');
      const [a, b] = [pos.getMin([]), pos.getMax([])];
      const radio = Math.max(1e-6, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2);
      fn.simplifyPrimitive(p, { simplifier: mo.MeshoptSimplifier, ratio: 0.05, error: Math.min(0.05, error / radio), lockBorder: true });
      if (trianglesDe(p) < t) n++;
    }
  return n;
}

export async function preparar(t, entrada, salida, { presupuesto, variante = 'alta' }) {
  const { io, fn, mo, sharp } = t;
  const aj = AJUSTES[variante];
  const doc = await io.read(entrada);
  const antes = contarTriangulos(doc);
  const nombradas = nombrarMorphs(doc);
  await doc.transform(fn.dedup(), fn.prune());
  const hebras = adelgazarHebras(doc, fn, aj.hebras);
  await doc.transform(fn.weld());
  const cabeza = mallasDeCabeza(doc);
  const cuerpo = doc.getRoot().listMeshes().filter((m) => !cabeza.has(m) && !m.listPrimitives().some((p) => p.listTargets().length));
  let tri = contarTriangulos(doc);
  const pasos = [];
  for (const e of aj.cuerpo) {
    if (tri <= presupuesto) break;
    simplificarMallas(doc, fn, mo, cuerpo, e);
    tri = contarTriangulos(doc);
    pasos.push(`cuerpo ${e}: ${tri}`);
  }
  // La cabeza, solo en la ligera: el cráneo, las orejas, las antenas, el pelo. Nunca las mallas con
  // morphs (la cara y la boca que se mueven) ni lo que hace la expresión: ojos (iris, esclerótica,
  // brillo, párpados), cejas, boca, labios, dientes, nariz y lentes (simplificados, el iris se deforma).
  const deCabeza = [...cabeza].filter((m) => !m.listPrimitives().some((p) => p.listTargets().length) && !NUNCA.test(nombreDe(doc, m)));
  for (const e of aj.cabeza) {
    if (tri <= presupuesto) break;
    simplificarMallas(doc, fn, mo, deCabeza, e);
    tri = contarTriangulos(doc);
    pasos.push(`cabeza ${e}: ${tri}`);
  }
  await doc.transform(
    fn.prune(),
    // Las texturas se quedan en su tamaño (512 en la entrega), en WebP de calidad alta.
    fn.textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /normal/i, quality: aj.calidadNormales }),
    fn.textureCompress({ encoder: sharp, targetFormat: 'webp', formats: /png|jpe?g/i, quality: aj.calidadTextura }),
    fn.meshopt({ encoder: mo.MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeNormal: 12, quantizeTexcoord: 14 })
  );
  const bytes = await io.writeBinary(doc);
  fs.writeFileSync(salida, bytes);
  return { antes, despues: contarTriangulos(doc), nombradas, bytes: bytes.length, hebras, pasos };
}

/** Rearma ANT-ONIO y CLAUDIO desde sus partes verificadas (herramienta de la entrega, sin red). */
function rearmarProvisionales() {
  const falta = FUENTES.some((f) => !fs.existsSync(path.join(ENTREGA, f.final)) && !fs.existsSync(path.join(ENTREGA, f.provisional)));
  if (falta) execFileSync(process.execPath, [path.join(ENTREGA, 'tools/restore-models.mjs')], { stdio: 'inherit' });
}

export async function main(argv = process.argv.slice(2)) {
  const R = await import('../mobile/scripts/avatar3d-modelo.mjs');
  const { VARIANTES_NODOS } = await import('../mobile/src/avatar3d/mapeo.ts');
  if (!argv.includes('--revisar')) {
    rearmarProvisionales();
    fs.mkdirSync(DESTINO, { recursive: true });
    const t = await herramientas();
    const solo = argv.find((a) => a.startsWith('--solo='))?.slice(7);
    for (const f of FUENTES) {
      if (solo && solo !== f.avatar) continue;
      const final = path.join(ENTREGA, f.final);
      const esFinal = fs.existsSync(final);
      const entrada = esFinal ? final : path.join(ENTREGA, f.provisional);
      let trianguloAlta = Infinity;
      for (const [variante, v] of Object.entries(VARIANTES_NODOS)) {
        const salida = path.join(DESTINO, `${f.avatar}${v.sufijo}.glb`);
        // Si la alta ya cabe en el presupuesto de la ligera (AU-RA), la ligera sobra.
        if (variante !== 'alta' && trianguloAlta <= v.triangulos) {
          fs.rmSync(salida, { force: true });
          console.log(`${f.avatar} ${variante}: no hace falta (la alta tiene ${trianguloAlta} triángulos)`);
          continue;
        }
        const r = await preparar(t, entrada, salida, { presupuesto: v.triangulos, variante });
        if (variante === 'alta') trianguloAlta = r.despues;
        console.log(
          `${f.avatar} ${variante}: ${esFinal ? 'FINAL' : 'provisional'} ${path.relative(RAIZ, entrada)} (${mb(fs.statSync(entrada).size)}, ${r.antes} triángulos)` +
            ` → ${path.relative(RAIZ, salida)} (${mb(r.bytes)}, ${r.despues} triángulos` +
            `${r.hebras.antes ? `, pelaje ${r.hebras.antes} → ${r.hebras.despues}` : ''}${r.pasos.length ? `, ${r.pasos.join(' · ')}` : ''}` +
            `${r.nombradas ? `, ${r.nombradas} mallas con morphs nombrados` : ''})`
        );
      }
      fs.writeFileSync(path.join(DESTINO, `${f.avatar}.mapeo.json`), JSON.stringify(MAPEO_NODOS, null, 2) + '\n');
    }
  }
  const modelos = R.modelosEnCarpeta();
  let malos = 0;
  for (const m of modelos) {
    for (const x of [m, ...(m.ligero ? [{ ...m.ligero, avatar: `${m.avatar}-ligero` }] : [])]) {
      console.log(`\n${x.avatar}.glb  ${JSON.stringify({ bytes: x.resumen.bytes, triangulos: x.resumen.triangulos, animaciones: x.resumen.animaciones?.length, blendshapes: x.resumen.blendshapes })}`);
      for (const e of x.errores) console.log(`  ERROR  ${e}`);
      for (const a of x.avisos) console.log(`  aviso  ${a}`);
      if (x.errores.length) malos++;
    }
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
  const total = modelos.reduce((s, m) => s + m.bytes + (m.ligero?.bytes || 0), 0);
  console.log(`\nmobile/src/avatar3d/modelo.ts · ${modelos.map((m) => m.avatar).join(', ')} · ${mb(total)} en total (alta + ligera)`);
  if (argv.includes('--fotos')) {
    // ANT-ONIO no tiene ilustraciones: su respaldo 2D sale de su modelo (con la escena ya empaquetada).
    const { fotografiar } = await import('./avatar3d-fotos.mjs');
    for (const avatar of SOLO_3D) console.log(`${avatar}: ${(await fotografiar(avatar)).length} fotos 2D rehechas desde su modelo`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main());
