/**
 * Pruebas en Node de la bienvenida (sin teléfono): las preguntas de la primera vez (José, 2-oct: «que le
 * pregunte toda la información que ocupe, por voz o cuestionario de selección múltiple dando opciones o
 * que pueda escribir»), lo que se guarda en el perfil y en «lo que sé de ti», lo dictado convertido en
 * opciones, lo que queda para retomar y la ventana que lo abre.
 *
 *   cd mobile && npx tsx src/bienvenida/pruebas/bienvenida.prueba.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PASOS,
  PREGUNTAS,
  OPCIONES_INICIATIVA,
  PALABRAS_INICIATIVA,
  PALABRAS_IDIOMA,
  borradorDesde,
  cambiosDe,
  cambiosDelPaso,
  chipsDeDictado,
  datoConocerDe,
  opcionDeDictado,
  pasosPendientes,
  armarRespuesta,
  apodoDeDictado,
  esCorreoOrdenGlobal,
  pasosDelPlan,
  PASOS_V2,
  saltable,
} from '../../primeravez/flujo.ts';
import { anotarEnConocer } from '../conocer.ts';
import { abrirBienvenida, abrirPreguntas, bienvenidaAhora, cerrarBienvenida, suscribirBienvenida } from '../estado.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const leer = (r) => fs.readFileSync(path.join(AQUI, '..', '..', r), 'utf8');
const pruebas = [];
const prueba = (nombre, f) => pruebas.push([nombre, f]);

prueba('pregunta todo lo que ocupa, en orden: idioma, apodo, a qué se dedica, dónde vive, familia, gustos, qué quiere de AURA e iniciativa', () => {
  const i = (p) => PASOS.indexOf(p);
  for (const p of ['idioma', 'apodo', 'encuesta:trabajo', 'encuesta:vive', 'encuesta:familia', 'encuesta:gustos', 'encuesta:ayuda', 'iniciativa']) assert.ok(i(p) > 0, `falta «${p}»`);
  assert.ok(i('idioma') < i('apodo'), 'el idioma primero: todo lo demás se lee en ese idioma');
  assert.ok(i('encuesta:trabajo') < i('encuesta:vive') && i('encuesta:vive') < i('encuesta:familia'));
  assert.ok(i('encuesta:ayuda') < i('iniciativa') && i('iniciativa') < i('permisos'));
  assert.equal(PASOS.at(-1), 'fiesta');
  assert.equal(new Set(PASOS).size, PASOS.length);
});

prueba('conectar el correo y el WhatsApp desde la primera vez (saltable), con instrucciones; Orden Global solo con correo y contraseña', () => {
  const i = (p) => PASOS.indexOf(p);
  // AUR11 (documento maestro, sección 14): la cuenta se pide justo cuando el objetivo la necesita, antes del
  // primer resultado y de la encuesta (y solo entonces: flujo.ts pasosDelPlan; tests/primeravez-objetivo.test.ts).
  assert.ok(i('conectar') === i('restriccion') + 1, 'justo después de la restricción del objetivo, antes del miniresultado');
  assert.ok(i('conectar') < i('encuesta:trabajo'));
  assert.ok(pasosDelPlan({ ...borradorDesde(null, 'Ana'), objetivo: 'correo' }).includes('conectar'), 'revisar el correo la pide');
  // José (3-oct): «desde el principio… conectar WhatsApp y el correo». Se ofrece siempre, saltable.
  assert.ok(pasosDelPlan(borradorDesde(null, 'Ana')).includes('conectar'), 'se ofrece siempre, aunque el objetivo no la pida');
  assert.equal(cambiosDelPaso('conectar', borradorDesde(null, 'Ana')), null, 'no escribe en el perfil (lo guarda el servidor)');
  assert.ok(esCorreoOrdenGlobal('j.herrera@ordenglobal.org') && esCorreoOrdenGlobal('  Ana@OrdenGlobal.ORG '));
  for (const no of ['ana@gmail.com', 'ana@ordenglobal.org.hn', 'ana@mail-ordenglobal.org', 'ordenglobal.org', '']) assert.ok(!esCorreoOrdenGlobal(no), no);
  const pc = leer('primeravez/pasos/PasoConectar.tsx');
  assert.match(pc, /'\/api\/correo\/cuentas'/, 'conecta de verdad (el servidor prueba leer y mandar)');
  assert.match(pc, /esCorreoOrdenGlobal\(correo\)/, 'Orden Global: sin preguntar al servidor qué contraseña va');
  assert.match(pc, /<HojaCorreos/, 'Outlook y servidores a mano: la hoja completa');
  assert.match(pc, /<Vincular p=\{tema\}/, 'WhatsApp: el mismo vincular de la pestaña');
  assert.match(pc, /vista === 'oculto'\) return null/, 'sin WhatsApp habilitado, no se ofrece');
  assert.match(pc, /setInterval\(\(\) => void leer\(\), 4000\)/, 've solo cuando queda vinculado');
  assert.match(pc, /clearInterval/, 'y deja de preguntar al salir del paso');
  const pv = leer('primeravez/PrimeraVez.tsx');
  assert.match(pv, /paso === 'conectar' \? \(\s*<PasoConectar/, 'se dibuja');
  assert.ok(saltable('conectar'), 'se puede saltar');
  assert.match(leer('primeravez/pasos/PasoConectar.tsx'), /Puedes conectarla o pegar solo el texto que quieras usar/, 'sin cuenta, puede pegar el texto');
});

prueba('cada pregunta tiene opciones de selección múltiple en los dos idiomas, un ejemplo para «Otro» y su porqué', () => {
  for (const q of PREGUNTAS) {
    assert.ok(q.sugerencias.length >= 6, `${q.campo}: pocas opciones`);
    for (const s of q.sugerencias) assert.ok(s.es && s.en, `${q.campo}: una opción sin idioma`);
    assert.ok(q.titulo.es && q.titulo.en && q.nota.es && q.nota.en && q.ejemplo.es && q.ejemplo.en, `${q.campo}: le falta texto`);
  }
  const ayuda = PREGUNTAS.find((q) => q.campo === 'ayuda');
  assert.equal(ayuda.titulo.es, '¿Qué quieres que AURA haga por ti?');
  assert.ok(ayuda.sugerencias.some((s) => s.es === 'Revisar mis correos'));
  assert.deepEqual(OPCIONES_INICIATIVA.map((o) => o.id), ['alta', 'media', 'baja', 'apagada']);
});

prueba('las tres formas de contestar están en pantalla: opciones, «Otro (escribir)» y «Responder hablando»', () => {
  const p = leer('primeravez/pasos/PasoPregunta.tsx');
  assert.match(p, /<Chip /);
  assert.match(p, /tr\('Otro \(escribir\)'/);
  assert.match(p, /<ResponderHablando /);
  for (const f of ['primeravez/pasos/PasoIdioma.tsx', 'primeravez/pasos/PasoIniciativa.tsx']) {
    assert.match(leer(f), /<OpcionUnica/);
    assert.match(leer(f), /<ResponderHablando/);
  }
  // El dictado es el reconocimiento del teléfono que ya está en la app (sin dependencias nativas nuevas: OTA).
  const d = leer('bienvenida/dictado.ts');
  assert.match(d, /from 'expo-speech-recognition'/);
  const pkg = JSON.parse(fs.readFileSync(path.join(AQUI, '../../../package.json'), 'utf8'));
  assert.ok(pkg.dependencies['expo-speech-recognition'], 'el módulo ya venía en la APK');
  assert.match(d, /if \(pausado\) nativePause\(true\)/, 'pausa el oído continuo solo si estaba encendido');
});

prueba('lo dictado marca las opciones que nombró y deja lo demás como texto', () => {
  const comida = PREGUNTAS.find((q) => q.campo === 'comida').sugerencias;
  assert.deepEqual(chipsDeDictado('Me gustan las baleadas y la sopa de caracol', comida, 'es'), { chips: ['Baleadas', 'Sopa de caracol'], texto: '' });
  const r = chipsDeDictado('pizza y la sopa de frijoles de mi abuela', comida, 'es');
  assert.deepEqual(r.chips, ['Pizza']);
  assert.equal(r.texto, 'pizza y la sopa de frijoles de mi abuela', 'dijo algo más: se queda con sus palabras');
  assert.deepEqual(chipsDeDictado('Seafood and desserts', comida, 'en'), { chips: ['Seafood', 'Desserts'], texto: '' });
  assert.deepEqual(chipsDeDictado('mariscos', comida, 'en').chips, ['Seafood'], 'dicho en español, marcado en inglés');
  assert.deepEqual(chipsDeDictado('', comida, 'es'), { chips: [], texto: '' });
  // Y como frase en el perfil.
  assert.equal(armarRespuesta(['Baleadas', 'Pizza'], 'y la sopa de mi abuela'), 'Baleadas, Pizza. y la sopa de mi abuela');
  // Una sola opción: la iniciativa y el idioma, dichos.
  assert.equal(opcionDeDictado('poquita, una al día', PALABRAS_INICIATIVA), 'baja');
  assert.equal(opcionDeDictado('nunca, apagada', PALABRAS_INICIATIVA), 'apagada');
  assert.equal(opcionDeDictado('Media está bien', PALABRAS_INICIATIVA), 'media');
  assert.equal(opcionDeDictado('alta', PALABRAS_INICIATIVA), 'alta');
  assert.equal(opcionDeDictado('qué sé yo', PALABRAS_INICIATIVA), null);
  assert.equal(opcionDeDictado('en inglés por favor', PALABRAS_IDIOMA), 'en');
  assert.equal(opcionDeDictado('Español', PALABRAS_IDIOMA), 'es');
  // El apodo, dicho: «¿cómo quieres que te diga?» también se contesta hablando.
  assert.equal(apodoDeDictado('dime Chepe'), 'Chepe');
  assert.equal(apodoDeDictado('Me dicen toño.'), 'Toño');
  assert.equal(apodoDeDictado('José está bien'), 'José');
  assert.equal(apodoDeDictado('pues llámame don José por favor'), 'Don José');
  assert.equal(apodoDeDictado(''), '');
  assert.match(leer('primeravez/pasos/PasoApodo.tsx'), /<ResponderHablando/);
});

prueba('lo que cada paso guarda en el perfil (como motorComputadora/iniciativa: guardarPerfil)', () => {
  const b = { ...borradorDesde(null, 'José Villeda'), encuesta: { trabajo: 'Minería', ayuda: 'Revisar mis correos' }, iniciativa: 'baja' };
  assert.equal(b.apodo, 'José');
  assert.deepEqual(cambiosDelPaso('encuesta:trabajo', b), { encuesta: { trabajo: 'Minería' } });
  assert.deepEqual(cambiosDelPaso('encuesta:ayuda', b), { encuesta: { ayuda: 'Revisar mis correos' } });
  assert.deepEqual(cambiosDelPaso('encuesta:vive', b), { encuesta: { vive: '' } }, 'saltada: queda en blanco');
  assert.deepEqual(cambiosDelPaso('iniciativa', b), { iniciativa: 'baja' });
  assert.equal(cambiosDelPaso('iniciativa', { ...b, iniciativa: undefined }), null, 'sin elegir no se manda (el servidor usa media)');
  assert.deepEqual(cambiosDelPaso('apodo', { ...b, apodo: ' Chepe ' }), { apodo: 'Chepe' });
  assert.equal(cambiosDelPaso('idioma', b), null, 'el idioma se guarda al tocarlo (elegirIdioma)');
  assert.equal(cambiosDe(b, true).iniciativa, 'baja');
  assert.equal(cambiosDe(b, true).completado, true);
  // El servidor y el teléfono conocen el campo nuevo de la encuesta.
  assert.match(leer('lib/perfil.ts'), /'gustos', 'ayuda', 'otros'/);
  assert.match(fs.readFileSync(path.join(AQUI, '../../../../lib/perfil-persona.ts'), 'utf8'), /'gustos', 'ayuda', 'otros'/);
});

prueba('cada respuesta también va a «lo que sé de ti», con su clave (contestar otra vez reemplaza)', async () => {
  assert.deepEqual(datoConocerDe('trabajo', 'Minería'), { categoria: 'trabajo', dato: 'Se dedica a: Minería', clave: 'oficio' });
  assert.deepEqual(datoConocerDe('vive', 'San Pedro Sula'), { categoria: 'rutinas', dato: 'Vive en San Pedro Sula', clave: 'vive' });
  assert.equal(datoConocerDe('ayuda', 'Recordarme cosas').categoria, 'metas');
  assert.equal(datoConocerDe('familia', 'Casado, dos hijas').categoria, 'familia');
  assert.equal(datoConocerDe('apodo', 'Chepe').dato, 'Quiere que le digan «Chepe»');
  assert.equal(datoConocerDe('gustos', ''), null);
  for (const q of PREGUNTAS) assert.ok(datoConocerDe(q.campo, 'algo de prueba'), `${q.campo} sin dato`);
  const enviados = [];
  const enviar = async (c) => void enviados.push(c);
  const b = { ...borradorDesde(null, 'Ana'), encuesta: { comida: 'Baleadas' } };
  assert.equal(await anotarEnConocer('encuesta:comida', b, enviar), true);
  assert.equal(await anotarEnConocer('encuesta:musica', b, enviar), false, 'en blanco no se manda');
  assert.equal(await anotarEnConocer('tema', b, enviar), false);
  assert.equal(await anotarEnConocer('apodo', b, enviar), true);
  assert.deepEqual(enviados.map((e) => e.clave), ['comida favorita', 'apodo']);
  assert.equal(await anotarEnConocer('encuesta:comida', b, async () => { throw new Error('sin red'); }), false, 'sin red no rompe nada');
  // La primera vez y las preguntas de la mesa lo anotan al seguir.
  assert.match(leer('primeravez/PrimeraVez.tsx'), /void anotarEnConocer\(paso, b\)/);
  assert.match(leer('bienvenida/VentanaBienvenida.tsx'), /void anotarEnConocer\(paso, b\)/);
  assert.match(leer('bienvenida/conocer.ts'), /'\/api\/cerebro\/conocer', \{ method: 'POST'/);
});

prueba('saltable y retomable: lo que falta se ofrece después, y la primera vez se retoma donde quedó', () => {
  const todas = pasosPendientes(null);
  assert.deepEqual(todas, [...PREGUNTAS.map((q) => `encuesta:${q.campo}`), 'iniciativa']);
  const perfil = { apodo: 'José', avatar: 'aura', tema: 'sistema', idioma: 'es', encuesta: { trabajo: 'Minería', vive: 'Tegucigalpa' }, completado: true, iniciativa: 'media', actualizado: 1 };
  assert.deepEqual(pasosPendientes(perfil), ['encuesta:familia', 'encuesta:gustos', 'encuesta:comida', 'encuesta:musica', 'encuesta:ayuda']);
  const lleno = { ...perfil, encuesta: Object.fromEntries(PREGUNTAS.map((q) => [q.campo, 'x'])) };
  assert.deepEqual(pasosPendientes(lleno), []);
  const pv = leer('primeravez/PrimeraVez.tsx');
  assert.match(pv, /aura\.primeravez\.paso\.v3:/, 'se guarda el nombre del paso (no retoma en el que no es)');
  // Un número viejo (v2) se traduce con los pasos de antes, ahora congelados (flujo.ts PASOS_V2).
  assert.deepEqual([...PASOS_V2], PASOS.filter((p) => !['objetivo', 'restriccion', 'listo', 'conectar'].includes(p)), 'un número viejo (v2) se traduce con los pasos de antes');
  assert.match(pv, /pasoRetomado\(/);
  assert.ok(saltable('iniciativa'), 'la iniciativa se puede saltar');
  assert.match(pv, /ir\('iniciativa', 1\)/, '«Saltar todas» sigue en la iniciativa');
});

prueba('la ventana: se abre, pasa a las preguntas y se cierra (bienvenida/estado.ts)', () => {
  let avisos = 0;
  const soltar = suscribirBienvenida(() => avisos++);
  assert.equal(bienvenidaAhora().abierta, null);
  abrirBienvenida('primera');
  assert.deepEqual(bienvenidaAhora(), { abierta: 'oferta', motivo: 'primera' });
  abrirPreguntas();
  assert.deepEqual(bienvenidaAhora(), { abierta: 'preguntas', motivo: 'primera' });
  cerrarBienvenida();
  assert.equal(bienvenidaAhora().abierta, null);
  cerrarBienvenida();
  assert.equal(avisos, 3, 'cerrar lo ya cerrado no avisa');
  soltar();
  abrirBienvenida();
  assert.equal(avisos, 3, 'sin oyente no avisa');
  assert.equal(bienvenidaAhora().motivo, 'menu');
  cerrarBienvenida();
  // Las preguntas: «Mejor te lo cuento hablando» pasa a la entrevista por voz de la mesa.
  assert.match(leer('screens/DeskScreen.tsx'), /onHablando=\{\(\) => void startConocer\(false\)\}/);
  assert.match(leer('screens/DeskScreen.tsx'), /const tapada = tutorialAbierto \|\| preguntasAbiertas;/, 'con las preguntas a la vista la mesa suelta el micrófono');
});

let ok = 0;
for (const [nombre, f] of pruebas) {
  try {
    await f();
    ok++;
    console.log(`ok - ${nombre}`);
  } catch (e) {
    console.log(`FALLA - ${nombre}\n  ${e.message}`);
  }
}
console.log(`\n${ok}/${pruebas.length} pruebas de la bienvenida`);
if (ok !== pruebas.length) process.exit(1);
