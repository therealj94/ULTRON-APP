#!/usr/bin/env node
/**
 * EL MODELO 3D DE AURA: revisarlo contra la especificación y registrarlo en la app.
 *
 *   npx tsx scripts/avatar3d-modelo.mjs revisar assets/avatar3d/aura.glb   # dice qué cumple y qué no
 *   npx tsx scripts/avatar3d-modelo.mjs registrar                           # revisa todos y escribe src/avatar3d/modelo.ts
 *   npx tsx scripts/avatar3d-modelo.mjs registrar --revisar                 # solo compara (sale con 1 si está desactualizado)
 *
 * La especificación es docs/avatar-3d-especificacion.md; aquí están sus reglas verificables. Lee el
 * .glb sin dependencias (cabecera, JSON y las cabeceras de las imágenes): formato y extensiones,
 * tamaño, triángulos, materiales, texturas, esqueleto humanoide, que mire hacia +Z y mida lo que mide
 * una persona, blendshapes (ARKit 52 + 15 visemas en `mesh.extras.targetNames`), animaciones, zonas
 * tocables y cámaras. Un ERROR impide registrarlo; un AVISO se dice y se registra igual.
 *
 * Los nombres propios de un modelo (si no son los de la especificación) van en `<avatar>.mapeo.json`
 * junto al .glb, con la forma de `MapeoParcial` (src/avatar3d/mapeo.ts) más, opcional, `humanoide`:
 * {"hips": "Pelvis", …} para los huesos que se llamen distinto.
 *
 * Se corre con tsx porque lee los nombres del mapeo directamente de src/avatar3d/mapeo.ts.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARKIT_52, BYTES_MAX_NODOS, MAPEO_BASE, PRESUPUESTO_NODOS, buscarNombre, combinarMapeo, nombreVisema } from '../src/avatar3d/mapeo.ts';
import { GESTOS_AVATAR, VISEMAS } from '../src/avatar3d/tipos.ts';

const MOVIL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CARPETA = path.join(MOVIL, 'assets/avatar3d');
export const REGISTRO = path.join(MOVIL, 'src/avatar3d/modelo.ts');
export const AVATARES = ['ojos', 'aura', 'claudio', 'antonio'];

/* ── los límites (los mismos números que la especificación, §3) ────────────────────────────── */

export const LIMITES = {
  bytesAviso: 8 * 1024 * 1024,
  bytesMax: 12 * 1024 * 1024,
  triangulosAviso: 50_000,
  triangulosMax: 70_000,
  huesosAviso: 90,
  huesosMax: 120,
  materialesAviso: 6,
  primitivasAviso: 12,
  texturaMax: 2048,
  alturaMin: 1.2,
  alturaMax: 2.1,
};

/** Extensiones que la escena sabe leer (GLTFLoader + el decodificador meshopt que va en la página). */
export const EXTENSIONES_OK = [
  'KHR_mesh_quantization', 'EXT_meshopt_compression', 'EXT_texture_webp', 'KHR_texture_transform', 'KHR_materials_emissive_strength', 'KHR_materials_unlit',
  // three.js las lee; en calidad «baja» la escena las apaga (capacidad.ts).
  'KHR_materials_clearcoat', 'KHR_materials_specular',
];
/** Las que NO: el decodificador no va en la página (Draco, KTX2) o cuestan de más en un teléfono. */
export const EXTENSIONES_NO = ['KHR_draco_mesh_compression', 'KHR_texture_basisu', 'KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_sheen', 'KHR_materials_iridescence'];

/** Los huesos humanoides de VRM 1.0 que hacen falta (nombres de nodo). */
export const HUESOS_EXIGIDOS = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
];
export const HUESOS_RECOMENDADOS = ['upperChest', 'leftShoulder', 'rightShoulder', 'leftEye', 'rightEye', 'jaw', 'leftToes', 'rightToes'];

/** Las animaciones que pidió José (el resto son opcionales: si faltan, la escena usa el reposo). */
export const ANIMACIONES_EXIGIDAS = ['idle', 'caminar', 'pensar', ...GESTOS_AVATAR.filter((g) => g !== 'despertar')];
export const ANIMACIONES_OPCIONALES = ['escuchar', 'hablar', 'dormir', 'levantada', 'despertar'];

export const ZONAS_EXIGIDAS = ['zona_cabeza', 'zona_mejilla_izq', 'zona_mejilla_der', 'zona_panza'];

/* ── leer el .glb ─────────────────────────────────────────────────────────────────────────── */

export function leerGlb(buf) {
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) throw new Error('no es un .glb (falta la firma glTF)');
  const version = buf.readUInt32LE(4);
  if (version !== 2) throw new Error(`es glTF ${version}; hace falta glTF 2.0`);
  const largo = buf.readUInt32LE(8);
  if (largo !== buf.length) throw new Error(`el largo declarado (${largo}) no es el del archivo (${buf.length})`);
  let o = 12;
  let json = null;
  let bin = null;
  while (o + 8 <= buf.length) {
    const n = buf.readUInt32LE(o);
    const tipo = buf.readUInt32LE(o + 4);
    const datos = buf.subarray(o + 8, o + 8 + n);
    if (tipo === 0x4e4f534a) json = JSON.parse(datos.toString('utf8'));
    else if (tipo === 0x004e4942) bin = datos;
    o += 8 + n;
  }
  if (!json) throw new Error('el .glb no trae el bloque JSON');
  return { json, bin };
}

/** Ancho y alto de una imagen PNG, JPEG o WebP (solo la cabecera). */
export function medidasImagen(b) {
  if (!b || b.length < 24) return null;
  if (b[0] === 0x89 && b[1] === 0x50) return { tipo: 'png', ancho: b.readUInt32BE(16), alto: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) return null;
      const m = b[o + 1];
      const n = b.readUInt16BE(o + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { tipo: 'jpeg', ancho: b.readUInt16BE(o + 7), alto: b.readUInt16BE(o + 5) };
      o += 2 + n;
    }
    return null;
  }
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const f = b.toString('ascii', 12, 16);
    if (f === 'VP8X') return { tipo: 'webp', ancho: 1 + b.readUIntLE(24, 3), alto: 1 + b.readUIntLE(27, 3) };
    if (f === 'VP8L') {
      const v = b.readUInt32LE(21);
      return { tipo: 'webp', ancho: 1 + (v & 0x3fff), alto: 1 + ((v >> 14) & 0x3fff) };
    }
    if (f === 'VP8 ') return { tipo: 'webp', ancho: b.readUInt16LE(26) & 0x3fff, alto: b.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

/* ── la posición de un nodo en el mundo (para la altura y hacia dónde mira) ────────────────── */

function multiplicar(a, b) {
  const r = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k];
  return r;
}
function matrizLocal(n) {
  if (Array.isArray(n.matrix) && n.matrix.length === 16) return n.matrix;
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale || [1, 1, 1];
  const [tx, ty, tz] = n.translation || [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
function posicionesMundo(json) {
  const nodos = json.nodes || [];
  const padre = new Array(nodos.length).fill(-1);
  nodos.forEach((n, i) => (n.children || []).forEach((c) => (padre[c] = i)));
  const memo = new Map();
  const mundo = (i) => {
    if (memo.has(i)) return memo.get(i);
    const m = padre[i] >= 0 ? multiplicar(mundo(padre[i]), matrizLocal(nodos[i])) : matrizLocal(nodos[i]);
    memo.set(i, m);
    return m;
  };
  return (i) => {
    const m = mundo(i);
    return [m[12], m[13], m[14]];
  };
}

/* ── la revisión ──────────────────────────────────────────────────────────────────────────── */

/** Sin mayúsculas, sin signos y sin el prefijo de Mixamo: «mixamorig:LeftUpLeg» y «leftupleg» son el mismo. */
const plano = (s) => String(s || '').toLowerCase().replace(/^mixamorig:?/, '').replace(/[^a-z0-9]/g, '');

/**
 * Revisa un .glb (Buffer) con su mapeo (o null). Devuelve { errores, avisos, resumen }. Nunca lanza:
 * un archivo ilegible es un error más.
 */
export function revisarGlb(buf, mapeoParcial = null) {
  const errores = [];
  const avisos = [];
  const resumen = { bytes: buf.length };
  let g;
  try {
    g = leerGlb(buf);
  } catch (e) {
    return { errores: [String(e.message || e)], avisos, resumen };
  }
  const j = g.json;
  const mapeo = combinarMapeo(MAPEO_BASE, mapeoParcial);
  if (mapeo.rig === 'nodos') return revisarNodos(buf, g, mapeo, { errores, avisos, resumen });
  const humanoide = (mapeoParcial && mapeoParcial.humanoide) || {};

  // Formato y tamaño.
  if (j.asset?.version !== '2.0') errores.push(`asset.version es «${j.asset?.version}»; hace falta «2.0»`);
  if (buf.length > LIMITES.bytesMax) errores.push(`pesa ${(buf.length / 1048576).toFixed(1)} MB; el máximo es ${LIMITES.bytesMax / 1048576} MB`);
  else if (buf.length > LIMITES.bytesAviso) avisos.push(`pesa ${(buf.length / 1048576).toFixed(1)} MB; lo recomendado es hasta ${LIMITES.bytesAviso / 1048576} MB`);
  for (const e of j.extensionsRequired || []) if (!EXTENSIONES_OK.includes(e)) errores.push(`exige la extensión ${e}, que la escena no lee`);
  for (const e of j.extensionsUsed || []) {
    if (EXTENSIONES_NO.includes(e)) errores.push(`usa ${e} (no permitida: ver §3 de la especificación)`);
    else if (/^VRMC?_/.test(e)) avisos.push(`trae ${e}: la escena lo lee como glTF normal (las extensiones VRM se ignoran)`);
    else if (!EXTENSIONES_OK.includes(e)) avisos.push(`usa ${e}, que la escena ignora`);
  }
  if ((j.buffers || []).some((b) => b.uri)) errores.push('tiene buffers externos (uri): todo tiene que ir dentro del .glb');
  if ((j.images || []).some((i) => i.uri)) errores.push('tiene imágenes externas (uri): todo tiene que ir dentro del .glb');

  // Geometría.
  let triangulos = 0;
  let primitivas = 0;
  for (const m of j.meshes || []) {
    for (const p of m.primitives || []) {
      primitivas++;
      const modo = p.mode ?? 4;
      const n = p.indices !== undefined ? j.accessors?.[p.indices]?.count : j.accessors?.[p.attributes?.POSITION]?.count;
      if (modo === 4) triangulos += (n || 0) / 3;
      else if (modo === 5 || modo === 6) triangulos += Math.max(0, (n || 0) - 2);
    }
  }
  triangulos = Math.round(triangulos);
  resumen.triangulos = triangulos;
  if (triangulos > LIMITES.triangulosMax) errores.push(`${triangulos} triángulos; el máximo es ${LIMITES.triangulosMax}`);
  else if (triangulos > LIMITES.triangulosAviso) avisos.push(`${triangulos} triángulos; lo recomendado es hasta ${LIMITES.triangulosAviso}`);
  if ((j.materials || []).length > LIMITES.materialesAviso) avisos.push(`${j.materials.length} materiales; lo recomendado es hasta ${LIMITES.materialesAviso}`);
  if (primitivas > LIMITES.primitivasAviso) avisos.push(`${primitivas} primitivas (llamadas de dibujo); lo recomendado es hasta ${LIMITES.primitivasAviso}`);

  // Texturas.
  resumen.texturas = [];
  for (const [i, img] of (j.images || []).entries()) {
    if (img.mimeType === 'image/ktx2') {
      errores.push(`la imagen ${i} es KTX2 (no permitida en esta versión)`);
      continue;
    }
    const bv = img.bufferView !== undefined ? j.bufferViews?.[img.bufferView] : null;
    const datos = bv && g.bin ? g.bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength) : null;
    const md = medidasImagen(datos);
    if (!md) {
      avisos.push(`no pude leer las medidas de la imagen ${i} (${img.mimeType || 'sin tipo'})`);
      continue;
    }
    resumen.texturas.push(`${md.ancho}×${md.alto} ${md.tipo}`);
    if (md.ancho > LIMITES.texturaMax || md.alto > LIMITES.texturaMax) errores.push(`la imagen ${i} mide ${md.ancho}×${md.alto}; el máximo es ${LIMITES.texturaMax}`);
    if ((md.ancho & (md.ancho - 1)) !== 0 || (md.alto & (md.alto - 1)) !== 0) avisos.push(`la imagen ${i} (${md.ancho}×${md.alto}) no es potencia de 2`);
  }

  // Esqueleto.
  const nodos = j.nodes || [];
  const nombres = nodos.map((n) => n.name || '');
  const huesos = new Set((j.skins || []).flatMap((s) => s.joints || []));
  resumen.huesos = huesos.size;
  if (!(j.skins || []).length) errores.push('no tiene esqueleto (skins)');
  if (huesos.size > LIMITES.huesosMax) errores.push(`${huesos.size} huesos; el máximo es ${LIMITES.huesosMax}`);
  else if (huesos.size > LIMITES.huesosAviso) avisos.push(`${huesos.size} huesos; lo recomendado es hasta ${LIMITES.huesosAviso}`);
  const indiceDe = (vrm) => {
    const nombre = humanoide[vrm] || vrm;
    const i = nombres.findIndex((n) => n === nombre);
    return i >= 0 ? i : nombres.findIndex((n) => plano(n) === plano(nombre));
  };
  const faltanHuesos = HUESOS_EXIGIDOS.filter((h) => indiceDe(h) < 0);
  if (faltanHuesos.length) errores.push(`faltan huesos humanoides: ${faltanHuesos.join(', ')}`);
  const faltanRec = HUESOS_RECOMENDADOS.filter((h) => indiceDe(h) < 0);
  if (faltanRec.length) avisos.push(`faltan huesos recomendados: ${faltanRec.join(', ')}`);

  // Altura y frente (con la pose de reposo de los nodos).
  const pos = posicionesMundo(j);
  const iCabeza = indiceDe('head');
  if (iCabeza >= 0) {
    const y = pos(iCabeza)[1];
    resumen.alturaCabeza = Math.round(y * 100) / 100;
    if (y < LIMITES.alturaMin || y > LIMITES.alturaMax) errores.push(`la cabeza está a ${y.toFixed(2)} m del suelo: la escala tiene que ser metros (una persona de 1,5–1,8 m) con los pies en y = 0`);
  }
  const iIzq = indiceDe('leftUpperArm');
  const iDer = indiceDe('rightUpperArm');
  if (iIzq >= 0 && iDer >= 0 && !(pos(iIzq)[0] > pos(iDer)[0])) errores.push('no mira hacia +Z: su brazo izquierdo tiene que quedar en +X (convención de glTF)');

  // Blendshapes.
  const morphs = new Set();
  for (const m of j.meshes || []) for (const n of m.extras?.targetNames || []) morphs.add(n);
  const conMorph = (j.meshes || []).some((m) => (m.primitives || []).some((p) => (p.targets || []).length));
  if (conMorph && !morphs.size) errores.push('tiene blendshapes sin nombre: los nombres van en mesh.extras.targetNames');
  resumen.blendshapes = morphs.size;
  const visemas = VISEMAS.flatMap((v) => Object.keys(mapeo.visemas[v] || { [nombreVisema(v)]: 1 }));
  const faltanVisemas = [...new Set(visemas)].filter((n) => !morphs.has(n));
  if (faltanVisemas.length) errores.push(`faltan visemas: ${faltanVisemas.join(', ')}`);
  const arkitUsado = mapeoParcial?.expresiones ? [...new Set(Object.values(mapeo.expresiones).flatMap((p) => Object.keys(p)))].filter((n) => n !== 'rubor') : [...ARKIT_52];
  const faltanArkit = arkitUsado.filter((n) => !morphs.has(n));
  if (faltanArkit.length) errores.push(`faltan blendshapes ARKit: ${faltanArkit.join(', ')}`);
  if (!morphs.has('rubor')) avisos.push('no trae «rubor» (opcional: la cara tímida se nota igual, un poco menos)');

  // Animaciones.
  const clips = (j.animations || []).map((a) => a.name || '');
  resumen.animaciones = clips;
  const candidatos = (k) => mapeo.animaciones.base[k] || mapeo.animaciones.gestos[k] || [k];
  const faltanAnim = ANIMACIONES_EXIGIDAS.filter((k) => !buscarNombre(candidatos(k), clips));
  if (faltanAnim.length) errores.push(`faltan animaciones: ${faltanAnim.join(', ')}`);
  const faltanOpc = ANIMACIONES_OPCIONALES.filter((k) => !buscarNombre(candidatos(k), clips));
  if (faltanOpc.length) avisos.push(`animaciones opcionales que no trae: ${faltanOpc.join(', ')}`);
  for (const a of j.animations || []) {
    const n = a.name || '(sin nombre)';
    if (!a.name) errores.push('hay una animación sin nombre');
    const tiempos = (a.samplers || []).map((s) => j.accessors?.[s.input]?.max?.[0] || 0);
    const dura = Math.max(0, ...tiempos);
    if (dura > 12) avisos.push(`la animación «${n}» dura ${dura.toFixed(1)} s (más de 12 s pesa de más)`);
  }

  // Zonas y cámaras.
  const faltanZonas = ZONAS_EXIGIDAS.filter((z) => !nombres.some((n) => n.toLowerCase().startsWith(z)));
  if (faltanZonas.length) errores.push(`faltan zonas tocables: ${faltanZonas.join(', ')}`);
  for (const c of [mapeo.camaras.retrato, mapeo.camaras.cuerpo]) if (!nombres.includes(c)) avisos.push(`no trae el nodo de cámara «${c}» (la escena encuadra sola)`);

  return { errores, avisos, resumen };
}

/* ── los rigs de nodos (los avatares de Codex) ─────────────────────────────────────────────── */

/** Los límites de un modelo «nodos» en el teléfono (mapeo.ts: PRESUPUESTO_NODOS, BYTES_MAX_NODOS). */
export const LIMITES_NODOS = { bytesMax: BYTES_MAX_NODOS, triangulosAviso: 50_000, triangulosMax: PRESUPUESTO_NODOS, texturaMax: 1024 };

/**
 * El perfil «nodos» no tiene esqueleto con piel, ni ARKit, ni zonas: lo que exige es lo que su
 * mapeo nombra (la cabeza, las formas de boca de los visemas y cada clip de fondo, de cara y de
 * gesto) y que quepa en el teléfono (≤ 3 MB, triángulos, texturas ≤ 1024, sin Draco).
 */
function revisarNodos(buf, g, mapeo, { errores, avisos, resumen }) {
  const j = g.json;
  resumen.rig = 'nodos';
  if (j.asset?.version !== '2.0') errores.push(`asset.version es «${j.asset?.version}»; hace falta «2.0»`);
  if (buf.length > LIMITES_NODOS.bytesMax) errores.push(`pesa ${(buf.length / 1048576).toFixed(2)} MB; el máximo es ${LIMITES_NODOS.bytesMax / 1048576} MB`);
  for (const e of j.extensionsRequired || []) if (!EXTENSIONES_OK.includes(e)) errores.push(`exige la extensión ${e}, que la escena no lee`);
  for (const e of j.extensionsUsed || []) {
    if (EXTENSIONES_NO.includes(e)) errores.push(`usa ${e} (no permitida: ver §3 de la especificación)`);
    else if (!EXTENSIONES_OK.includes(e)) avisos.push(`usa ${e}, que la escena ignora`);
  }
  if ((j.buffers || []).some((b) => b.uri)) errores.push('tiene buffers externos (uri): todo tiene que ir dentro del .glb');
  if ((j.images || []).some((i) => i.uri)) errores.push('tiene imágenes externas (uri): todo tiene que ir dentro del .glb');

  // Lo que se dibuja: una malla que usan dos nodos (los dos ojos) cuenta dos veces.
  let triangulos = 0;
  let primitivas = 0;
  for (const nodo of j.nodes || []) {
    const m = nodo.mesh !== undefined ? j.meshes?.[nodo.mesh] : null;
    for (const p of m?.primitives || []) {
      primitivas++;
      const n = p.indices !== undefined ? j.accessors?.[p.indices]?.count : j.accessors?.[p.attributes?.POSITION]?.count;
      if ((p.mode ?? 4) === 4) triangulos += (n || 0) / 3;
    }
  }
  resumen.triangulos = Math.round(triangulos);
  resumen.primitivas = primitivas;
  if (resumen.triangulos > LIMITES_NODOS.triangulosMax) errores.push(`${resumen.triangulos} triángulos; el máximo es ${LIMITES_NODOS.triangulosMax}`);
  else if (resumen.triangulos > LIMITES_NODOS.triangulosAviso) avisos.push(`${resumen.triangulos} triángulos; lo recomendado es hasta ${LIMITES_NODOS.triangulosAviso}`);

  resumen.texturas = [];
  for (const [i, img] of (j.images || []).entries()) {
    const bv = img.bufferView !== undefined ? j.bufferViews?.[img.bufferView] : null;
    const datos = bv && g.bin ? g.bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength) : null;
    const md = medidasImagen(datos);
    if (!md) {
      avisos.push(`no pude leer las medidas de la imagen ${i} (${img.mimeType || 'sin tipo'})`);
      continue;
    }
    resumen.texturas.push(`${md.ancho}×${md.alto} ${md.tipo}`);
    if (md.ancho > LIMITES_NODOS.texturaMax || md.alto > LIMITES_NODOS.texturaMax) errores.push(`la imagen ${i} mide ${md.ancho}×${md.alto}; el máximo es ${LIMITES_NODOS.texturaMax}`);
  }

  const nombres = (j.nodes || []).map((n) => n.name || '');
  if (!buscarNombre(mapeo.huesos.cabeza, nombres)) errores.push(`no tiene el nodo de la cabeza (${mapeo.huesos.cabeza.join(', ')}): sin él no hay mirada ni toques`);

  const morphs = new Set();
  for (const m of j.meshes || []) for (const n of m.extras?.targetNames || []) morphs.add(String(n));
  resumen.blendshapes = morphs.size;
  const formas = [...new Set(VISEMAS.flatMap((v) => Object.keys(mapeo.visemas[v] || {})))];
  const faltanFormas = formas.filter((n) => !morphs.has(n));
  if (faltanFormas.length) errores.push(`faltan las formas de boca de los visemas: ${faltanFormas.join(', ')}`);

  const clips = (j.animations || []).map((a) => a.name || '');
  resumen.animaciones = clips;
  const pedidas = [
    ...Object.entries(mapeo.animaciones.base).map(([k, l]) => [`fondo ${k}`, l]),
    ...Object.entries(mapeo.animaciones.expresiones).map(([k, l]) => [`cara ${k}`, l]),
    ...Object.entries(mapeo.animaciones.gestos).map(([k, l]) => [`gesto ${k}`, l]),
  ].filter(([, l]) => Array.isArray(l) && l.length);
  const faltanClips = pedidas.filter(([, l]) => !buscarNombre(l, clips)).map(([k, l]) => `${k} (${l.join('/')})`);
  if (faltanClips.length) errores.push(`faltan animaciones: ${faltanClips.join(', ')}`);
  if ((j.materials || []).length > 24) avisos.push(`${j.materials.length} materiales (cada uno cuesta en un teléfono modesto)`);
  if (primitivas > 120) avisos.push(`${primitivas} primitivas (llamadas de dibujo)`);
  return { errores, avisos, resumen };
}

/* ── el registro ──────────────────────────────────────────────────────────────────────────── */

/** El texto de src/avatar3d/modelo.ts para estos modelos ([{ avatar, bytes, huella, mapeo }]). */
export function generarRegistro(modelos) {
  const cabeza = fs.readFileSync(REGISTRO, 'utf8').split('export const MODELOS_3D')[0];
  if (!modelos.length) return `${cabeza}export const MODELOS_3D: Partial<Record<AvatarId, ModeloAvatar3D>> = {};\n`;
  const filas = modelos.map(
    (m) =>
      `  ${m.avatar}: {\n` +
      `    fuente: require('../../assets/avatar3d/${m.avatar}.glb'),\n` +
      `    huella: '${m.huella}',\n` +
      `    bytes: ${m.bytes},\n` +
      `    mapeo: ${m.mapeo ? JSON.stringify(m.mapeo) : 'null'},\n` +
      `  },\n`
  );
  return `${cabeza}export const MODELOS_3D: Partial<Record<AvatarId, ModeloAvatar3D>> = {\n${filas.join('')}};\n`;
}

/** Los modelos que hay en assets/avatar3d, revisados. */
export function modelosEnCarpeta(carpeta = CARPETA) {
  const out = [];
  for (const avatar of AVATARES) {
    const glb = path.join(carpeta, `${avatar}.glb`);
    if (!fs.existsSync(glb)) continue;
    const buf = fs.readFileSync(glb);
    const rutaMapeo = path.join(carpeta, `${avatar}.mapeo.json`);
    const mapeo = fs.existsSync(rutaMapeo) ? JSON.parse(fs.readFileSync(rutaMapeo, 'utf8')) : null;
    const r = revisarGlb(buf, mapeo);
    const { humanoide, ...mapeoEscena } = mapeo || {};
    void humanoide;
    out.push({ avatar, bytes: buf.length, huella: createHash('sha256').update(buf).digest('hex').slice(0, 16), mapeo: mapeo ? mapeoEscena : null, ...r });
  }
  return out;
}

function imprimir(nombre, r) {
  console.log(`\n${nombre}`);
  console.log(`  ${JSON.stringify(r.resumen)}`);
  for (const e of r.errores) console.log(`  ERROR  ${e}`);
  for (const a of r.avisos) console.log(`  aviso  ${a}`);
  console.log(r.errores.length ? `  ✗ no cumple (${r.errores.length} errores)` : '  ✓ cumple la especificación');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [orden, ...resto] = process.argv.slice(2);
  if (orden === 'revisar' && resto[0]) {
    const glb = path.resolve(resto[0]);
    const rutaMapeo = resto[1] ? path.resolve(resto[1]) : glb.replace(/\.glb$/i, '.mapeo.json');
    const mapeo = fs.existsSync(rutaMapeo) ? JSON.parse(fs.readFileSync(rutaMapeo, 'utf8')) : null;
    const r = revisarGlb(fs.readFileSync(glb), mapeo);
    imprimir(path.basename(glb), r);
    process.exit(r.errores.length ? 1 : 0);
  } else if (orden === 'registrar') {
    const modelos = modelosEnCarpeta();
    for (const m of modelos) imprimir(`${m.avatar}.glb`, m);
    if (modelos.some((m) => m.errores.length)) {
      console.error('\nNo se registra: hay modelos que no cumplen la especificación.');
      process.exit(1);
    }
    const nuevo = generarRegistro(modelos);
    const actual = fs.readFileSync(REGISTRO, 'utf8');
    if (resto.includes('--revisar')) {
      if (actual !== nuevo) {
        console.error('src/avatar3d/modelo.ts no coincide con assets/avatar3d: corre `npx tsx scripts/avatar3d-modelo.mjs registrar`.');
        process.exit(1);
      }
      console.log('registro de modelos 3D al día');
    } else {
      fs.writeFileSync(REGISTRO, nuevo);
      console.log(`\nsrc/avatar3d/modelo.ts · ${modelos.length ? modelos.map((m) => m.avatar).join(', ') : 'sin modelos (todos en 2D)'}`);
    }
  } else {
    console.log('uso: npx tsx scripts/avatar3d-modelo.mjs revisar <modelo.glb> [mapeo.json] | registrar [--revisar]');
    process.exit(2);
  }
}
