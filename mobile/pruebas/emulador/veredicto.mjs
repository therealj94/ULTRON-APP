#!/usr/bin/env node
/**
 * EL VEREDICTO DEL EMULADOR: HUMO y ACEPTACIÓN DE LA OTA, por separado (hallazgo REL01 de la auditoría externa).
 *
 * La corrida 38110074861 (después de publicar una OTA) salió VERDE aunque la app NO cargó la OTA publicada (seguía con
 * el JS de la APK) y los cinco escenarios con cuenta salieron OMITIDO (sin cuenta de prueba). Verde no era «la OTA que
 * se publicó está aceptada». Desde aquí:
 *
 *   HUMO (escenarios «0 · …» y «Cierres de la app»): instalar, abrir, llegar al formulario de entrada, sin cierres.
 *     PASA si todos pasan; FALLA si alguno falla o no hay resultados. Un humo que falla SIEMPRE pone rojo el trabajo.
 *
 *   ACEPTACIÓN DE LA OTA (escenarios «1 · …» a «5 · …» + qué JS corre la app):
 *     FALLA       si el humo falló, si un escenario falló, si la app cargó OTRA OTA (otro updateId), si lo cargado trae
 *                 otro runtime o si la APK pide otro canal que el de la OTA;
 *     INCONCLUSA  si no hay OTA esperada, si la app sigue con el JS embebido de la APK o no se pudo leer qué corre, si
 *                 algún escenario salió OMITIDO (p. ej. sin cuenta de prueba) o si no corrió ninguno;
 *     PASA        solo con la OTA esperada cargada Y todos los escenarios de aceptación en PASA.
 *     Nunca PASA con la OTA sin cargar ni con escenarios omitidos.
 *
 *   EL TRABAJO: rojo si el humo falla; y, en modo «aceptacion» (después de publicar una OTA, o a mano con OTA esperada),
 *   rojo también si la aceptación no es PASA. En modo «humo» (a mano sin OTA esperada, o pidiendo solo humo) puede
 *   salir verde con la aceptación sin exigir, y el resumen lo dice: «solo humo».
 *
 * Uso (paso «Resumen» y paso «Veredicto» de .github/workflows/emulador-android.yml):
 *   node veredicto.mjs <resultados.tsv> <datos/ota.json> --markdown   → el resumen (Markdown) por stdout
 *   node veredicto.mjs <resultados.tsv> <datos/ota.json> --salir      → ::error y código 1 si el trabajo va en rojo
 *   (sin bandera: el veredicto en JSON). Entorno: MODO (aceptacion|humo; sin él, aceptacion), OTA_ESPERADA,
 *   RUNTIME_ESPERADO y CANAL_APK como respaldo si ota.json no llegó a escribirse.
 *
 *   Pruebas: cd mobile && npx tsx pruebas/emulador/veredicto.prueba.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CANAL_OTA = 'production';

/** resultados.tsv (escenario \t PASA|FALLA|OMITIDO \t detalle) → filas. */
export function leerResultados(texto) {
  return String(texto || '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      const [escenario = '', estado = '', ...resto] = l.split('\t');
      return { escenario: escenario.trim(), estado: estado.trim().toUpperCase(), detalle: resto.join(' ').trim() };
    });
}

/** «0 · …» y «Cierres de la app» son humo; el resto (1 · … a 5 · …), aceptación. */
export function clasificar(escenario) {
  return /^0\s*·/.test(escenario) || /^cierres/i.test(escenario) ? 'humo' : 'aceptacion';
}

const minus = (s) => String(s || '').trim().toLowerCase();

/**
 * La decisión, pura. `ota`: lo que escribió correr.sh en datos/ota.json
 *   { esperada, runtimeEsperado, canalEsperado, canalApk, embebida, lanzada: { fuente: 'ota'|'embebido'|…, updateId, runtime } }.
 * `modo`: 'aceptacion' (por defecto) | 'humo'.
 */
export function decidir({ resultados = [], ota = {}, modo = 'aceptacion' } = {}) {
  const humo = resultados.filter((r) => clasificar(r.escenario) === 'humo');
  const acep = resultados.filter((r) => clasificar(r.escenario) === 'aceptacion');
  const motivosHumo = [];
  if (!resultados.length) motivosHumo.push('No hay resultados: el emulador no llegó a correr los escenarios.');
  else if (!humo.length) motivosHumo.push('No hay resultados de humo (instalar / abrir).');
  for (const r of humo) if (r.estado !== 'PASA') motivosHumo.push(`${r.escenario}: ${r.estado || 'sin estado'}.`);
  const estadoHumo = motivosHumo.length ? 'FALLA' : 'PASA';

  const falla = [];
  const inconclusa = [];
  if (estadoHumo === 'FALLA') falla.push('El humo falló: no se puede aceptar nada encima.');
  for (const r of acep) if (r.estado === 'FALLA') falla.push(`${r.escenario}: FALLA.`);

  const esperada = minus(ota.esperada);
  const l = ota.lanzada || {};
  const cargada = minus(l.updateId);
  let otaCargada = 'desconocida';
  if (!esperada) inconclusa.push('No hay OTA esperada que comprobar (sin ficha de OTA para el runtime de la APK).');
  if (l.fuente === 'ota' && cargada) {
    if (esperada && cargada !== esperada) {
      otaCargada = 'otra';
      falla.push(`La app cargó OTRA OTA (${l.updateId}), no la publicada (${ota.esperada}).`);
    } else if (esperada) otaCargada = 'esperada';
    else otaCargada = 'sin-esperada';
    if (ota.runtimeEsperado && l.runtime && minus(l.runtime) !== minus(ota.runtimeEsperado)) {
      falla.push(`Lo cargado trae el runtime ${l.runtime}, no el de la APK (${ota.runtimeEsperado}).`);
    }
  } else if (l.fuente === 'embebido') {
    otaCargada = 'embebido';
    if (esperada) inconclusa.push(`La app no cargó la OTA publicada: sigue con el JS embebido de la APK${l.updateId ? ` (${l.updateId})` : ''}.`);
  } else if (esperada) {
    inconclusa.push(`No se pudo saber qué JS corre la app${ota.motivo ? ` (${ota.motivo})` : ''}: la OTA publicada no está comprobada.`);
  }
  const canalEsperado = ota.canalEsperado || CANAL_OTA;
  if (ota.canalApk && minus(ota.canalApk) !== minus(canalEsperado)) {
    falla.push(`La APK pide el canal «${ota.canalApk}», no «${canalEsperado}» (el de la OTA): nunca la cargaría.`);
  }

  const omitidos = acep.filter((r) => r.estado === 'OMITIDO');
  if (omitidos.length) {
    const motivo = omitidos[0].detalle ? ` (${omitidos[0].detalle})` : '';
    inconclusa.push(`${omitidos.length} escenario(s) de aceptación OMITIDO(s)${motivo}: omitido no es aceptado.`);
  }
  const raros = acep.filter((r) => !['PASA', 'FALLA', 'OMITIDO'].includes(r.estado));
  for (const r of raros) inconclusa.push(`${r.escenario}: estado «${r.estado || 'vacío'}».`);
  if (!acep.length) inconclusa.push('No corrió ningún escenario de aceptación.');

  const estadoAcep = falla.length ? 'FALLA' : inconclusa.length ? 'INCONCLUSA' : 'PASA';
  const modoFinal = modo === 'humo' ? 'humo' : 'aceptacion';
  const rojo = estadoHumo === 'FALLA' || (modoFinal === 'aceptacion' && estadoAcep !== 'PASA');
  return {
    humo: estadoHumo,
    aceptacion: estadoAcep,
    modo: modoFinal,
    rojo,
    otaEsperada: ota.esperada || '',
    otaCargada,
    jsEmbebido: ota.embebida || '',
    jsCargado: l.updateId ? `${l.fuente || '?'}:${l.updateId}` : '',
    omitidos: omitidos.map((r) => r.escenario),
    motivos: { humo: motivosHumo, aceptacion: [...falla, ...inconclusa] },
  };
}

const ICONO = { PASA: '✅ PASA', FALLA: '❌ FALLA', INCONCLUSA: '⚠️ INCONCLUSA', OMITIDO: '⏭️ OMITIDO' };
const celda = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const codigo = (s) => (s ? `\`${celda(s)}\`` : '—');

/** El resumen para $GITHUB_STEP_SUMMARY: el veredicto arriba, los escenarios debajo. */
export function markdown(v, resultados = [], ota = {}) {
  const l = ota.lanzada || {};
  const cargada =
    v.otaCargada === 'esperada' ? `sí, la publicada ${codigo(l.updateId)}`
    : v.otaCargada === 'otra' ? `❌ otra: ${codigo(l.updateId)}`
    : v.otaCargada === 'embebido' ? `no: la app sigue con el JS embebido de la APK`
    : v.otaCargada === 'sin-esperada' ? `OTA ${codigo(l.updateId)} (sin OTA esperada con qué compararla)`
    : `no se pudo leer${ota.motivo ? ` (${celda(ota.motivo)})` : ''}`;
  const modo = v.modo === 'humo' ? '**solo humo** (la aceptación de la OTA no se exige en esta corrida)' : '**aceptación** (se exige la OTA publicada cargada y todos los escenarios en PASA)';
  const out = [
    '',
    `### Veredicto: ${v.rojo ? '❌ no aceptado' : v.modo === 'humo' ? '✅ solo humo' : '✅ OTA aceptada'}`,
    '',
    '| | |',
    '|---|---|',
    `| Humo (instalar, abrir, formulario, sin cierres) | ${ICONO[v.humo]} |`,
    `| Aceptación de la OTA | ${ICONO[v.aceptacion]} |`,
    `| Modo | ${modo} |`,
    `| OTA esperada | ${codigo(v.otaEsperada)}${ota.runtimeEsperado ? ` · runtime ${codigo(String(ota.runtimeEsperado).slice(0, 16))}` : ''} · canal ${codigo(ota.canalEsperado || CANAL_OTA)} |`,
    `| OTA cargada | ${cargada} |`,
    `| JS de la APK (embebido) | ${codigo(v.jsEmbebido)}${ota.canalApk ? ` · canal de la APK ${codigo(ota.canalApk)}` : ''} |`,
    `| JS que corre la app | ${codigo(v.jsCargado)}${ota.ciclos ? ` · ${ota.ciclos} ciclo(s) abrir → esperar → reabrir` : ''}${ota.descargadas?.length ? ` · bajada sin lanzar: ${ota.descargadas.map(codigo).join(', ')}` : ''} |`,
    `| Omitidos | ${v.omitidos.length ? `${v.omitidos.length}: ${celda(v.omitidos.join('; '))}` : '0'} |`,
  ];
  const motivos = [...v.motivos.humo, ...v.motivos.aceptacion];
  if (motivos.length) out.push('', ...motivos.map((m) => `- ${m}`));
  out.push('', '| Escenario | Tipo | Resultado | Detalle |', '|---|---|---|---|');
  if (resultados.length) {
    for (const r of resultados) out.push(`| ${celda(r.escenario)} | ${clasificar(r.escenario)} | ${ICONO[r.estado] || `⏭️ ${celda(r.estado)}`} | ${celda(r.detalle)} |`);
  } else {
    out.push('| (ninguno) | humo | ❌ FALLA | El emulador no llegó a correr los escenarios: ver el registro del paso «Emulador y escenarios». |');
  }
  return out.join('\n') + '\n';
}

function leerJson(ruta) {
  try {
    return JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch {
    return null;
  }
}

function principal(argv) {
  const [tsv, otaRuta] = argv.filter((a) => !a.startsWith('--'));
  let texto = '';
  try {
    texto = fs.readFileSync(tsv || '', 'utf8');
  } catch {
    texto = '';
  }
  const resultados = leerResultados(texto);
  // Si correr.sh no llegó a escribir ota.json (el emulador no arrancó), lo que se sabe desde el flujo.
  const ota = leerJson(otaRuta || '') || {
    esperada: process.env.OTA_ESPERADA || '',
    runtimeEsperado: process.env.RUNTIME_ESPERADO || '',
    canalEsperado: CANAL_OTA,
    canalApk: process.env.CANAL_APK || '',
    lanzada: null,
    motivo: 'correr.sh no escribió datos/ota.json',
  };
  const v = decidir({ resultados, ota, modo: process.env.MODO || 'aceptacion' });
  if (argv.includes('--markdown')) {
    process.stdout.write(markdown(v, resultados, ota));
    return 0;
  }
  if (argv.includes('--salir')) {
    const linea = `Humo: ${v.humo} · Aceptación de la OTA: ${v.aceptacion} · modo ${v.modo === 'humo' ? 'solo humo' : 'aceptación'} · OTA esperada: ${v.otaEsperada || 'ninguna'} · cargada: ${v.otaCargada} · omitidos: ${v.omitidos.length}`;
    if (v.humo === 'FALLA') {
      console.log(`::error title=Humo del emulador: FALLA::${[...v.motivos.humo, linea].join(' ')}`);
      return 1;
    }
    if (v.rojo) {
      console.log(`::error title=OTA no aceptada (${v.aceptacion})::${[...v.motivos.aceptacion, linea].join(' ')}`);
      return 1;
    }
    if (v.modo === 'humo') console.log(`::notice title=Solo humo::${linea}`);
    console.log(linea);
    return 0;
  }
  process.stdout.write(JSON.stringify(v, null, 2) + '\n');
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(principal(process.argv.slice(2)));
