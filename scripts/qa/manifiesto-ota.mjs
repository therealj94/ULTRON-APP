#!/usr/bin/env node
/**
 * LA FICHA DE LA OTA PUBLICADA (ota-aura.json en el Release «aura-ota»). EAS publica la OTA y no le avisa a nadie: el
 * servidor no sabía qué updateId esperar en cada teléfono y /api/build decía «desconocido». Con esta ficha pública
 * (lib/ota-publicada.ts la lee) compara de verdad: mismo runtime y mismo updateId → recibido.
 *
 * Dos usos, los dos desde .github/workflows/ota.yml:
 *
 *   node scripts/qa/manifiesto-ota.mjs entrada --variante ultron --canal production --runtime <rt> --commit <sha> \
 *        [--eas salida-de-eas-update--json.json | --embebido]
 *     → la entrada de ESTA publicación (stdout). Con --eas, de lo que devolvió `eas update --json` (el updateId y el
 *       grupo de verdad, no los de un cálculo aparte); con --embebido, la marcha atrás al JS de la APK.
 *
 *   node scripts/qa/manifiesto-ota.mjs fusionar --actual ota-aura.json --salida ota-aura.json ficha1.json [ficha2.json…]
 *     → la ficha publicada con estas entradas: reemplaza la de la misma app + canal + runtime y guarda las
 *       MAX_RUNTIMES más recientes por app y canal (una APK vieja con otro runtime sigue encontrando la suya).
 *
 * Solo datos públicos (ids de la actualización, runtime, commit, fecha): nada de tokens ni del mensaje del commit.
 * Cualquier forma inesperada FALLA (código 1): una ficha rota no se sube.
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const VERSION_FICHA = 1;
export const MAX_RUNTIMES = 5;
export const VARIANTES = ['ultron', 'electrum'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUNTIME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CANAL = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const COMMIT = /^[0-9a-f]{40}$/i;

const fecha = (v, porOmision) => {
  const t = Date.parse(String(v ?? ''));
  return Number.isFinite(t) ? new Date(t).toISOString() : porOmision;
};

function comprobarBase({ variante, canal, runtime, commit }) {
  if (!VARIANTES.includes(variante)) throw new Error(`variante desconocida: ${variante}`);
  if (!CANAL.test(String(canal || ''))) throw new Error(`canal inválido: ${canal}`);
  if (!RUNTIME.test(String(runtime || ''))) throw new Error(`runtime inválido: ${runtime}`);
  if (!COMMIT.test(String(commit || ''))) throw new Error(`commit inválido: ${commit}`);
}

/**
 * La entrada de una publicación a partir de la salida de `eas update --json` (una lista con una actualización por
 * plataforma: id, group, runtimeVersion, platform, createdAt…). Exige la de Android (es lo único que se publica hoy).
 * El runtime que vale es el que usó EAS (el que comparan los teléfonos); si no es el calculado aparte, avisa.
 */
export function entradaDesdeEas(eas, { variante, canal, runtime, commit, ahora = new Date().toISOString() }) {
  comprobarBase({ variante, canal, runtime, commit });
  const lista = Array.isArray(eas) ? eas : eas && typeof eas === 'object' ? [eas] : [];
  const de = (p) => lista.find((u) => u && typeof u === 'object' && u.platform === p);
  const android = de('android');
  const ios = de('ios');
  if (!android) throw new Error('la salida de eas update no trae la actualización de Android');
  if (!UUID.test(String(android.id || ''))) throw new Error(`updateId de Android inválido: ${android.id}`);
  const rtEas = String(android.runtimeVersion || '');
  if (!RUNTIME.test(rtEas)) throw new Error(`runtimeVersion de EAS inválido: ${android.runtimeVersion}`);
  const avisos = rtEas === runtime ? [] : [`EAS publicó con runtime ${rtEas} y aquí se calculó ${runtime}: la ficha usa el de EAS`];
  return {
    entrada: {
      plataforma: variante,
      canal,
      runtimeVersion: rtEas,
      tipo: 'ota',
      androidUpdateId: android.id.toLowerCase(),
      iosUpdateId: ios && UUID.test(String(ios.id || '')) ? ios.id.toLowerCase() : null,
      // El grupo es informativo (el teléfono compara el updateId): si no viene, null.
      grupo: UUID.test(String(android.group || '')) ? android.group.toLowerCase() : null,
      commit: commit.toLowerCase(),
      publicado: fecha(android.createdAt, ahora),
    },
    avisos,
  };
}

/** La marcha atrás (`eas update:roll-back-to-embedded`): en ese runtime se espera el JS de fábrica, sin OTA. */
export function entradaEmbebida({ variante, canal, runtime, commit, ahora = new Date().toISOString() }) {
  comprobarBase({ variante, canal, runtime, commit });
  return { plataforma: variante, canal, runtimeVersion: runtime, tipo: 'embebido', androidUpdateId: null, iosUpdateId: null, grupo: null, commit: commit.toLowerCase(), publicado: ahora };
}

/** ¿Es una entrada como las que escribe este script? (Lo de una ficha vieja que no lo sea, se descarta.) */
export function entradaValida(e) {
  if (!e || typeof e !== 'object') return false;
  if (!VARIANTES.includes(e.plataforma) || !CANAL.test(String(e.canal || '')) || !RUNTIME.test(String(e.runtimeVersion || ''))) return false;
  if (!Number.isFinite(Date.parse(String(e.publicado || '')))) return false;
  if (e.tipo === 'ota') return UUID.test(String(e.androidUpdateId || '')) || UUID.test(String(e.iosUpdateId || ''));
  return e.tipo === 'embebido';
}

/** La ficha con estas entradas nuevas (puro). La misma app + canal + runtime se reemplaza; la más reciente primero. */
export function fusionar(actual, nuevas, ahora = new Date().toISOString()) {
  for (const n of nuevas) if (!entradaValida(n)) throw new Error(`entrada nueva inválida: ${JSON.stringify(n).slice(0, 200)}`);
  const previas = Array.isArray(actual?.publicaciones) ? actual.publicaciones.filter(entradaValida) : [];
  const clave = (e) => `${e.plataforma}|${e.canal}|${e.runtimeVersion}`;
  const nuevasClaves = new Set(nuevas.map(clave));
  const todas = [...nuevas, ...previas.filter((e) => !nuevasClaves.has(clave(e)))].sort((a, b) => Date.parse(b.publicado) - Date.parse(a.publicado));
  const porApp = new Map();
  const publicaciones = todas.filter((e) => {
    const k = `${e.plataforma}|${e.canal}`;
    porApp.set(k, (porApp.get(k) || 0) + 1);
    return porApp.get(k) <= MAX_RUNTIMES;
  });
  return { v: VERSION_FICHA, actualizado: ahora, publicaciones };
}

/* ------------------------------------------------------------------ línea de órdenes */

function argumentos(lista) {
  const o = { _: [] };
  for (let i = 0; i < lista.length; i++) {
    const a = lista[i];
    if (a === '--embebido') o.embebido = true;
    else if (a.startsWith('--')) o[a.slice(2)] = lista[++i];
    else o._.push(a);
  }
  return o;
}

function leerJson(ruta) {
  return JSON.parse(fs.readFileSync(ruta, 'utf8'));
}

function principal(argv) {
  const [orden, ...resto] = argv;
  const a = argumentos(resto);
  if (orden === 'entrada') {
    const base = { variante: a.variante, canal: a.canal, runtime: a.runtime, commit: a.commit };
    if (a.embebido) return process.stdout.write(JSON.stringify(entradaEmbebida(base), null, 2) + '\n');
    if (!a.eas) throw new Error('falta --eas <salida de eas update --json> (o --embebido)');
    const { entrada, avisos } = entradaDesdeEas(leerJson(a.eas), base);
    for (const x of avisos) console.error(`::warning title=Ficha OTA (${a.variante})::${x}`);
    return process.stdout.write(JSON.stringify(entrada, null, 2) + '\n');
  }
  if (orden === 'fusionar') {
    if (!a.salida) throw new Error('falta --salida');
    let actual = null;
    if (a.actual && fs.existsSync(a.actual)) {
      try {
        actual = leerJson(a.actual);
      } catch (e) {
        // Una ficha publicada ilegible se rehace con lo de esta ejecución, pero que se vea.
        console.error(`::warning title=Ficha OTA::la ficha publicada no se pudo leer (${e.message}); se rehace con lo de esta ejecución`);
      }
    }
    const nuevas = a._.map(leerJson);
    if (!nuevas.length) throw new Error('sin fichas nuevas que fusionar');
    fs.writeFileSync(a.salida, JSON.stringify(fusionar(actual, nuevas), null, 2) + '\n');
    return;
  }
  throw new Error(`orden desconocida: ${orden ?? '(ninguna)'} (entrada | fusionar)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    principal(process.argv.slice(2));
  } catch (e) {
    console.error(`::error title=Ficha OTA::${e.message}`);
    process.exit(1);
  }
}
