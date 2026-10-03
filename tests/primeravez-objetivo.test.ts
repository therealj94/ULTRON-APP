/**
 * AUR11 (documento maestro, sección 14 «Un inicio real orientado a un resultado»; recorrido R1): la primera
 * vez se ADAPTA (no se reemplaza) para que el primer valor llegue antes de configurar nada.
 *
 *  · empieza por «¿Qué te gustaría resolver primero? Puedes empezar sin conectar ninguna cuenta»;
 *  · pide SOLO la restricción que cambia el resultado (presupuesto y uso para comparar, cuándo para un
 *    recordatorio…), y se puede saltar;
 *  · la conexión (correo, WhatsApp) y los permisos solo aparecen cuando el objetivo los necesita;
 *  · familia, salud ni finanzas son obligatorias: todo lo personal se salta;
 *  · deja un MINIRESULTADO comprobable: la primera petición, armada, escrita en la mesa al terminar;
 *  · quien iba a mitad de la primera vez de antes retoma donde estaba (claves v3 y v2 de siempre).
 *
 * Lógica pura de mobile/src/primeravez/flujo.ts (y una mirada al código de las pantallas).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  OBJETIVOS,
  PASOS,
  PASOS_V2,
  PREGUNTAS,
  anteriorEn,
  borradorDesde,
  cambiosDe,
  objetivoDe,
  objetivoGuardado,
  pasoRetomado,
  pasosDelPlan,
  permisosDelPlan,
  peticionInicial,
  progresoEn,
  puedeSeguir,
  saltable,
  siguienteEn,
} from '../mobile/src/primeravez/flujo';

const leer = (r: string) => fs.readFileSync(path.join(import.meta.dirname, '../mobile/src', r), 'utf8');
const ENCUESTA = PREGUNTAS.map((q) => `encuesta:${q.campo}`);

test('empieza por el objetivo; lo de antes sigue (apodo, avatar, tema, encuesta, iniciativa) en el mismo orden', () => {
  assert.equal(PASOS[0], 'objetivo');
  assert.equal(PASOS.at(-1), 'fiesta');
  const i = (p: string) => PASOS.indexOf(p as any);
  assert.ok(i('restriccion') === 1, 'después del objetivo, la única restricción');
  assert.ok(i('conectar') > i('restriccion') && i('conectar') < i('listo'), 'la conexión, justo cuando hace falta (antes del miniresultado)');
  assert.ok(i('listo') < i('genesis'), 'el miniresultado llega antes de cualquier pregunta personal');
  for (const p of ['genesis', 'idioma', 'apodo', 'avatar', 'tema', 'aura', ...ENCUESTA, 'iniciativa', 'permisos']) assert.ok(i(p) > i('listo'), `«${p}» después del primer resultado`);
  assert.equal(new Set(PASOS).size, PASOS.length);
  const pv = leer('primeravez/pasos/PasoObjetivo.tsx');
  assert.match(pv, /¿Qué te gustaría resolver primero\?/);
  assert.match(pv, /Puedes empezar sin conectar ninguna cuenta/);
});

test('sin objetivo: ni restricción, ni conexión, ni permisos, ni miniresultado (nada que no haga falta)', () => {
  const plan = pasosDelPlan(borradorDesde(null, 'Ana'));
  assert.deepEqual(plan, ['objetivo', 'genesis', 'idioma', 'apodo', 'avatar', 'tema', 'aura', ...ENCUESTA, 'iniciativa', 'fiesta']);
  assert.deepEqual(permisosDelPlan(borradorDesde(null, 'Ana')), []);
});

test('cada objetivo pide UNA restricción (la que cambia el resultado) y solo la conexión o el permiso que necesita', () => {
  assert.ok(OBJETIVOS.length >= 6);
  for (const o of OBJETIVOS) {
    assert.ok(o.titulo.es && o.titulo.en && o.pedido.es && o.pedido.en, `${o.id}: le falta texto`);
    assert.ok(o.restriccion.pregunta.es && o.restriccion.pregunta.en && o.restriccion.etiqueta.es && o.restriccion.ejemplo.es, `${o.id}: sin restricción`);
    assert.ok(o.restriccion.sugerencias.length >= 3, `${o.id}: pocas opciones`);
  }
  const comparar = OBJETIVOS.find((o) => o.id === 'comparar')!;
  assert.match(comparar.restriccion.pregunta.es, /presupuesto|uso/i, 'R1: para comparar, presupuesto y uso');
  const plan = (objetivo: string) => pasosDelPlan({ ...borradorDesde(null, 'Ana'), objetivo });
  assert.deepEqual(plan('comparar').slice(0, 3), ['objetivo', 'restriccion', 'listo'], 'comparar no pide cuentas');
  assert.ok(!plan('comparar').includes('conectar') && !plan('comparar').includes('permisos'));
  assert.deepEqual(plan('correo').slice(0, 4), ['objetivo', 'restriccion', 'conectar', 'listo'], 'revisar el correo sí pide la cuenta, ahí mismo');
  assert.ok(plan('whatsapp').includes('conectar'));
  assert.ok(plan('recordar').includes('permisos') && !plan('recordar').includes('conectar'), 'un recordatorio necesita los avisos');
  assert.deepEqual(permisosDelPlan({ ...borradorDesde(null, 'Ana'), objetivo: 'recordar' }), ['android.permission.POST_NOTIFICATIONS']);
  assert.ok(plan('recordar').indexOf('permisos') > plan('recordar').indexOf('iniciativa'));
  // Escrito con sus palabras (sin elegir una opción): también vale.
  const libre = pasosDelPlan({ ...borradorDesde(null, 'Ana'), objetivoTexto: 'Ordenar las facturas del mes' });
  assert.deepEqual(libre.slice(0, 3), ['objetivo', 'restriccion', 'listo']);
  assert.equal(objetivoDe({ ...borradorDesde(null, 'Ana'), objetivo: 'inventado' }), null);
});

test('el miniresultado: la primera petición, armada con el objetivo y la restricción, lista para mandar', () => {
  const b = { ...borradorDesde(null, 'Ana'), objetivo: 'comparar', objetivoTexto: 'tres laptops para la oficina', restriccion: 'Hasta L 15,000, para trabajar' };
  const p = peticionInicial(b, 'es');
  assert.match(p, /tres laptops para la oficina/);
  assert.match(p, /Hasta L 15,000, para trabajar/);
  assert.match(p, /fuentes/, 'R1: con fuentes');
  assert.match(peticionInicial(b, 'en'), /sources/);
  assert.equal(peticionInicial({ ...b, restriccion: '' }, 'es').includes('L 15,000'), false, 'sin restricción, sin ella');
  assert.equal(peticionInicial({ ...borradorDesde(null, 'Ana'), objetivoTexto: 'Ordenar mis facturas' }, 'es'), 'Ordenar mis facturas.');
  assert.equal(peticionInicial(borradorDesde(null, 'Ana'), 'es'), '', 'sin objetivo no hay petición');
  // Se guarda aparte del perfil y vuelve sana si Android cierra la app a la mitad.
  assert.deepEqual(objetivoGuardado(JSON.stringify({ objetivo: 'comparar', objetivoTexto: ' laptops ', restriccion: 'barato', basura: 1 })), { objetivo: 'comparar', objetivoTexto: 'laptops', restriccion: 'barato' });
  assert.deepEqual(objetivoGuardado('no es json'), {});
  assert.deepEqual(objetivoGuardado(JSON.stringify({ objetivo: 'hackear' })), {});
  // Al terminar, queda escrita en la mesa (no se manda sola: la persona la revisa y la manda).
  const pv = leer('primeravez/PrimeraVez.tsx');
  assert.match(pv, /marcarPrimeraPeticion\(peticionInicial\(b/);
  assert.match(leer('app/sesion.ts'), /export function tomarPrimeraPeticion/);
  assert.match(leer('screens/DeskScreen.tsx'), /useState\(\(\) => tomarPrimeraPeticion\(\)\)/);
  assert.match(leer('primeravez/pasos/PasoListo.tsx'), /peticionInicial\(/);
});

test('todo lo personal se salta: familia, salud ni finanzas son obligatorias; solo el apodo para poder llamarte', () => {
  for (const p of ['objetivo', 'restriccion', 'conectar', 'permisos', 'aura', 'iniciativa', ...ENCUESTA]) assert.ok(saltable(p as any), `«${p}» se puede saltar`);
  for (const p of ['apodo', 'listo', 'fiesta']) assert.ok(!saltable(p as any), `«${p}» no es para saltar`);
  const campos = PREGUNTAS.map((q) => q.campo as string);
  assert.ok(!campos.some((c) => /salud|finanza|dinero|banco|ingreso/.test(c)), 'no se pregunta salud ni finanzas');
  const b = borradorDesde(null, 'Ana');
  for (const p of PASOS) if (p !== 'apodo') assert.ok(puedeSeguir(p, b), `«${p}» sigue sin contestar nada`);
  assert.ok(puedeSeguir('apodo', b), 'el apodo viene del nombre de la cuenta');
  assert.equal(cambiosDe(b, true).completado, true);
  assert.deepEqual(cambiosDe(b, true).encuesta, {}, 'se termina con la encuesta vacía');
  const conectar = leer('primeravez/pasos/PasoConectar.tsx');
  assert.match(conectar, /Para revisar ese hilo necesito acceso a esa cuenta\. Puedes conectarla o pegar solo el texto que quieras usar/);
});

test('moverse por el plan: siguiente, anterior y la barra; el plan cambia si cambia el objetivo', () => {
  const plan = pasosDelPlan({ ...borradorDesde(null, 'Ana'), objetivo: 'correo' });
  assert.equal(siguienteEn(plan, 'objetivo'), 'restriccion');
  assert.equal(siguienteEn(plan, 'restriccion'), 'conectar');
  assert.equal(anteriorEn(plan, 'conectar'), 'restriccion');
  assert.equal(anteriorEn(plan, 'objetivo'), 'objetivo');
  assert.equal(siguienteEn(plan, 'fiesta'), 'fiesta');
  assert.equal(progresoEn(plan, 'objetivo'), 0);
  assert.equal(progresoEn(plan, 'fiesta'), 1);
  // Un paso que ya no está en el plan (cambió el objetivo): sigue en el siguiente que sí está.
  const sin = pasosDelPlan({ ...borradorDesde(null, 'Ana'), objetivo: 'comparar' });
  assert.equal(siguienteEn(sin, 'conectar'), 'listo');
});

test('quien iba a mitad retoma donde estaba: el nombre (v3) y el número viejo (v2) de siempre', () => {
  assert.deepEqual(
    [...PASOS_V2],
    ['genesis', 'idioma', 'apodo', 'avatar', 'tema', 'aura', ...ENCUESTA, 'iniciativa', 'permisos', 'fiesta'],
    'los pasos de la v2 quedan congelados: un número viejo no se corre con los pasos nuevos'
  );
  const plan = pasosDelPlan(borradorDesde(null, 'Ana'));
  assert.equal(pasoRetomado(plan, 'encuesta:familia', null), 'encuesta:familia');
  assert.equal(pasoRetomado(plan, null, PASOS_V2.indexOf('encuesta:vive')), 'encuesta:vive', 'v2: el número de antes');
  assert.equal(pasoRetomado(plan, 'conectar', null), 'encuesta:trabajo', 'iba en «conectar» (ya no hace falta): sigue donde seguía antes');
  assert.equal(pasoRetomado(plan, 'permisos', null), 'fiesta');
  assert.equal(pasoRetomado(plan, 'genesis', null), 'objetivo', 'en el primer paso de antes: empieza por el objetivo');
  assert.equal(pasoRetomado(plan, null, 0), 'objetivo');
  assert.equal(pasoRetomado(plan, null, null), 'objetivo');
  assert.equal(pasoRetomado(plan, 'paso-inventado', 99), 'objetivo');
  const conObjetivo = pasosDelPlan({ ...borradorDesde(null, 'Ana'), objetivo: 'comparar' });
  assert.equal(pasoRetomado(conObjetivo, 'listo', null), 'listo', 'lo nuevo también se retoma');
  const pv = leer('primeravez/PrimeraVez.tsx');
  assert.match(pv, /aura\.primeravez\.paso\.v3:/, 'la clave de siempre');
  assert.match(pv, /aura\.primeravez\.paso\.v2:/, 'y la vieja, de respaldo');
  assert.match(pv, /aura\.primeravez\.objetivo\.v1:/, 'el objetivo y la restricción, aparte');
});
