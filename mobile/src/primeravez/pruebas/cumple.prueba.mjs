/**
 * Pruebas en Node del cumpleaños de la primera vez y de Ajustes (sin teléfono). José, 5-oct, en un Samsung:
 * «No podemos seleccionar las fechas de cumple». En «Para empezar · ¿Cuándo es tu cumpleaños?» tocar un mes
 * no hacía nada y los días seguían apagados.
 *
 * LA CAUSA: PasoGenesis leía el mes y el día del selector de `borrador.cumple`, que solo guarda fechas
 * completas («MM-DD»). Al tocar un mes sin día, `onCambiar(mes, null)` dejaba `cumple: undefined`: el mes
 * volvía a null al dibujar, los días seguían con pointerEvents="none" (apagados hasta tener mes) y no había
 * forma de salir de ahí. En Ajustes funcionaba porque esa pantalla sí guardaba la selección a medias.
 *
 * Además: los meses iban en una fila horizontal escondida (se veían 5 y había que adivinar que se
 * deslizaba), y el paso que se iba quedaba encima del nuevo con su animación de salida (una vista nativa
 * sin nodo de React que puede tragarse los toques en Android).
 *
 *   cd mobile && npx tsx src/primeravez/pruebas/cumple.prueba.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DIAS_POR_MES,
  SIN_CUMPLE,
  armarCumple,
  cambiosDe,
  cambiosDelPaso,
  borradorDesde,
  cumpleDeSeleccion,
  cumpleTrasCambio,
  diasDelMes,
  elegirDia,
  elegirMes,
  faltaEnCumple,
  leerCumple,
  puedeSeguir,
  seleccionDeCumple,
  validarCumple,
} from '../flujo.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const leer = (r) => fs.readFileSync(path.join(AQUI, '..', '..', r), 'utf8');
const pruebas = [];
const prueba = (nombre, f) => pruebas.push([nombre, f]);

/** Lo que hace PasoGenesis al tocar el selector: la selección a medias en su estado y la fecha en el borrador. */
function pasoGenesis(cumpleInicial) {
  let b = { ...borradorDesde(null, 'José'), cumple: cumpleInicial };
  let sel = seleccionDeCumple(b.cumple);
  const tocar = (n) => {
    sel = n;
    const cumple = cumpleTrasCambio(b.cumple, n);
    if (cumple !== b.cumple) b = { ...b, cumple };
  };
  return {
    mes: (m) => tocar(elegirMes(sel, m)),
    dia: (d) => tocar(elegirDia(sel, d)),
    quitar: () => tocar(SIN_CUMPLE),
    get sel() {
      return sel;
    },
    get b() {
      return b;
    },
    /** Los días que enseña el selector y si responden (antes: apagados sin mes). */
    get dias() {
      return diasDelMes(sel.mes);
    },
  };
}

prueba('los días de cada mes, sin año: el 29 de febrero existe, el 31 de abril no', () => {
  assert.equal(diasDelMes(null), 31, 'sin mes se ofrecen los 31');
  assert.equal(diasDelMes(undefined), 31);
  assert.equal(diasDelMes(2), 29);
  for (const m of [4, 6, 9, 11]) assert.equal(diasDelMes(m), 30, `mes ${m}`);
  for (const m of [1, 3, 5, 7, 8, 10, 12]) assert.equal(diasDelMes(m), 31, `mes ${m}`);
  assert.equal(diasDelMes(13), 31, 'un mes que no existe no rompe nada');
  assert.equal(diasDelMes(0), 31);
  assert.equal(DIAS_POR_MES.reduce((a, b) => a + b, 0), 366);
});

prueba('validarCumple: solo fechas que existen', () => {
  assert.ok(validarCumple(2, 29));
  assert.ok(validarCumple(12, 31));
  assert.ok(validarCumple(1, 1));
  assert.ok(!validarCumple(2, 30));
  assert.ok(!validarCumple(4, 31));
  assert.ok(!validarCumple(0, 10));
  assert.ok(!validarCumple(13, 1));
  assert.ok(!validarCumple(5, 0));
  assert.ok(!validarCumple(5, 32));
  assert.ok(!validarCumple(1.5, 3));
  assert.ok(!validarCumple(null, 3));
  assert.ok(!validarCumple(3, null));
});

prueba('las 366 fechas se arman, se leen de vuelta y el perfil las acepta', () => {
  // El perfil (lib/perfil.ts cumpleValido, que importa React Native) valida con su propia tabla: la misma.
  const tabla = /const DIAS_DEL_MES = \[([^\]]*)\]/.exec(leer('lib/perfil.ts'));
  assert.ok(tabla, 'DIAS_DEL_MES en lib/perfil.ts');
  assert.deepEqual(tabla[1].split(',').map((x) => Number(x.trim())), DIAS_POR_MES, 'el perfil acepta las mismas fechas');
  let n = 0;
  for (let m = 1; m <= 12; m++)
    for (let d = 1; d <= DIAS_POR_MES[m - 1]; d++) {
      const c = armarCumple(m, d);
      assert.equal(c, `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      assert.deepEqual(leerCumple(c), { mes: m, dia: d });
      n++;
    }
  assert.equal(n, 366);
  assert.equal(armarCumple(2, 30), undefined);
  assert.equal(armarCumple(4, 31), undefined);
  assert.equal(leerCumple('02-30'), null, 'leer tampoco acepta lo que no existe');
  assert.equal(leerCumple('13-01'), null);
  assert.equal(leerCumple(''), null);
  assert.equal(leerCumple(undefined), null);
  assert.deepEqual(seleccionDeCumple(undefined), { mes: null, dia: null });
  assert.deepEqual(seleccionDeCumple('07-04'), { mes: 7, dia: 4 });
});

prueba('elegir: primero el mes o primero el día; cambiar de mes suelta el día que no existe', () => {
  let s = elegirMes(SIN_CUMPLE, 4);
  assert.deepEqual(s, { mes: 4, dia: null }, 'el mes queda aunque falte el día');
  s = elegirDia(s, 30);
  assert.deepEqual(s, { mes: 4, dia: 30 });
  assert.deepEqual(elegirDia(s, 31), s, 'el 31 no existe en abril: no cambia nada');
  // Día primero (antes los días no respondían sin mes).
  s = elegirDia(SIN_CUMPLE, 31);
  assert.deepEqual(s, { mes: null, dia: 31 });
  assert.deepEqual(elegirMes(s, 4), { mes: 4, dia: null }, 'el 31 no sobrevive a abril');
  assert.deepEqual(elegirMes(s, 12), { mes: 12, dia: 31 });
  // El 29 de febrero.
  s = elegirMes(elegirDia(SIN_CUMPLE, 29), 2);
  assert.deepEqual(s, { mes: 2, dia: 29 });
  assert.equal(cumpleDeSeleccion(s), '02-29');
  assert.deepEqual(elegirMes({ mes: 1, dia: 30 }, 2), { mes: 2, dia: null }, 'el 30 no existe en febrero');
  // Lo que no es un mes o un día no mueve nada.
  assert.deepEqual(elegirMes(s, 13), s);
  assert.deepEqual(elegirDia(s, 0), s);
  assert.deepEqual(elegirDia(SIN_CUMPLE, 32), SIN_CUMPLE);
});

prueba('qué falta: nada elegido, el mes, el día, o lista', () => {
  assert.equal(faltaEnCumple(SIN_CUMPLE), 'todo');
  assert.equal(faltaEnCumple({ mes: 3, dia: null }), 'dia');
  assert.equal(faltaEnCumple({ mes: null, dia: 3 }), 'mes');
  assert.equal(faltaEnCumple({ mes: 3, dia: 3 }), 'nada');
  assert.equal(cumpleDeSeleccion({ mes: 3, dia: null }), undefined);
});

prueba('EL BUG (José, 5-oct): en la primera vez, el mes tocado se queda y los días responden', () => {
  const p = pasoGenesis(undefined);
  p.mes(6);
  assert.equal(p.sel.mes, 6, 'antes: el mes volvía a null porque el borrador no tenía fecha completa');
  assert.equal(p.b.cumple, undefined, 'a medias no hay fecha en el borrador');
  assert.equal(p.dias, 30, 'junio enseña sus 30 días');
  p.dia(15);
  assert.deepEqual(p.sel, { mes: 6, dia: 15 });
  assert.equal(p.b.cumple, '06-15');
  assert.deepEqual(cambiosDelPaso('genesis', p.b), { cumple: '06-15' }, '«Siguiente» lo guarda');
  // Cambia de mes: el día se conserva si existe.
  p.mes(2);
  assert.equal(p.b.cumple, '02-15');
  p.dia(29);
  assert.equal(p.b.cumple, '02-29', 'el 29 de febrero se puede elegir');
});

prueba('es opcional: «Siguiente» sigue sin fecha, a medias o quitándola', () => {
  // Sin tocar nada: no se manda nada.
  const nada = pasoGenesis(undefined);
  assert.ok(puedeSeguir('genesis', nada.b));
  assert.equal(cambiosDelPaso('genesis', nada.b), null);
  assert.ok(!('cumple' in cambiosDe(nada.b, true)), 'al terminar tampoco se manda un cumpleaños vacío');
  // A medias (solo el mes): sigue, sin fecha.
  const medias = pasoGenesis(undefined);
  medias.mes(9);
  assert.ok(puedeSeguir('genesis', medias.b));
  assert.equal(cambiosDelPaso('genesis', medias.b), null);
  // La eligió, siguió, volvió y la quitó: se borra también del perfil ('' lo borra en lib/perfil.ts).
  const quitada = pasoGenesis('03-14');
  assert.deepEqual(quitada.sel, { mes: 3, dia: 14 }, 'al volver al paso la fecha se ve elegida');
  quitada.quitar();
  assert.deepEqual(quitada.sel, SIN_CUMPLE);
  assert.equal(quitada.b.cumple, '');
  assert.deepEqual(cambiosDelPaso('genesis', quitada.b), { cumple: '' });
  assert.ok(puedeSeguir('genesis', quitada.b));
  // Y a medias después de tener fecha (cambió a abril con el 31): tampoco queda una fecha vieja.
  const vieja = pasoGenesis('01-31');
  vieja.mes(4);
  assert.deepEqual(vieja.sel, { mes: 4, dia: null });
  assert.equal(vieja.b.cumple, '');
  vieja.dia(30);
  assert.equal(vieja.b.cumple, '04-30');
  assert.equal(cumpleTrasCambio(undefined, SIN_CUMPLE), undefined);
  assert.equal(cumpleTrasCambio('', SIN_CUMPLE), '');
});

/* ── el código de las pantallas ─────────────────────────────────────────────────────────── */

const piezas = leer('primeravez/piezas.tsx');
const selector = piezas.slice(piezas.indexOf('export function SelectorCumple'), piezas.indexOf('/* ── el avatar vivo'));
const genesis = leer('primeravez/pasos/PasoGenesis.tsx');
const primeraVez = leer('primeravez/PrimeraVez.tsx');
const ajustes = leer('ajustes/Ajustes.tsx');

prueba('PasoGenesis guarda la selección a medias (no la lee del borrador)', () => {
  assert.ok(!/mes=\{c\?\.mes/.test(genesis), 'el mes del selector ya no sale de borrador.cumple');
  assert.ok(!/mes && dia \? armarCumple/.test(genesis), 'ya no se tira la selección a medias');
  assert.match(genesis, /useState<SeleccionCumple>\(\(\) => seleccionDeCumple\(borrador\.cumple\)\)/);
  assert.match(genesis, /mes=\{sel\.mes\}/);
  assert.match(genesis, /dia=\{sel\.dia\}/);
  assert.match(genesis, /cumpleTrasCambio\(borrador\.cumple, n\)/);
});

prueba('el selector: los 12 meses a la vista y los 31 días en filas de 7, nada apagado', () => {
  assert.ok(selector.length > 200, 'se encontró SelectorCumple');
  assert.ok(!/ScrollView/.test(selector), 'los meses no van en una fila horizontal escondida (ni anidada en el ScrollView del paso)');
  assert.ok(!/\bhorizontal\b/.test(selector));
  assert.ok(!/pointerEvents/.test(selector), 'ningún bloque deja de responder (antes: los días con pointerEvents="none" sin mes)');
  assert.ok(!/opacity:\s*mes \?/.test(selector), 'los días no se apagan sin mes');
  assert.match(piezas, /const COLUMNAS_MES = 4;/);
  assert.match(piezas, /const COLUMNAS_DIA = 7;/);
  assert.match(selector, /enFilas\(12, COLUMNAS_MES\)/);
  assert.match(selector, /enFilas\(diasDelMes\(mes\), COLUMNAS_DIA\)/);
  assert.match(selector, /elegirMes\(sel, m\)/);
  assert.match(selector, /elegirDia\(sel, d\)/);
  assert.match(selector, /cambiar\(SIN_CUMPLE\)/, '«Quitar fecha»');
  assert.match(selector, /Quitar fecha/);
  // Las celdas reparten la fila (flex 1): ninguna se sale del ancho del teléfono.
  assert.match(piezas, /celda: \{ flex: 1, minWidth: 0 \}/);
  assert.match(piezas, /fila: \{ flexDirection: 'row', gap: 6 \}/);
  // Cuántas filas salen: 3 de meses y 5 de días (28/29/30/31 caben en 5 de 7).
  for (const m of [null, ...Array.from({ length: 12 }, (_, i) => i + 1)]) assert.ok(Math.ceil(diasDelMes(m) / 7) <= 5, `mes ${m}`);
});

prueba('nada queda encima del paso para tragarse los toques', () => {
  // El paso que se va no se queda como vista fantasma encima del que llega.
  const paso = primeraVez.slice(primeraVez.indexOf('<Animated.View key={paso}'));
  const etiqueta = paso.slice(0, paso.indexOf('>'));
  assert.ok(etiqueta.length > 20, 'se encontró el contenedor del paso');
  assert.ok(!/exiting=/.test(etiqueta), 'sin animación de salida en el contenedor del paso');
  assert.ok(!/FadeOut/.test(primeraVez));
  // La pantalla no pone capas absolutas propias; el confeti (solo en la fiesta) deja pasar los toques.
  assert.ok(!/absoluteFill|position: 'absolute'/.test(primeraVez), 'PrimeraVez no tiene capas absolutas');
  assert.match(leer('primeravez/pasos/PasoFiesta.tsx'), /<View style=\{StyleSheet\.absoluteFill\} pointerEvents="none">/);
  assert.match(primeraVez, /\{paso === 'fiesta' && <LluviaConfeti/);
  // Ni el paso del cumpleaños ni el selector tienen capas absolutas.
  assert.ok(!/absoluteFill|position: 'absolute'/.test(genesis));
  assert.ok(!/absoluteFill|position: 'absolute'/.test(selector));
  // Las capas de toda la app (la compañera flotante, la computadora en vivo, la cartera) no se dibujan en la
  // primera vez: solo en las pantallas de la sesión.
  const rutas = leer('app/rutas.ts');
  const sesion = /RUTAS_DE_SESION: readonly string\[\] = \[([^\]]*)\]/.exec(rutas);
  assert.ok(sesion, 'RUTAS_DE_SESION');
  assert.ok(!/PrimeraVez/.test(sesion[1]), 'PrimeraVez no es una ruta de sesión');
  const app = leer('app/AppAura.tsx');
  for (const capa of ['<ComputadoraEnVivo />', '<HojasCartera />']) assert.ok(app.includes(`{enSesion && ${capa}}`), capa);
  // La pastilla de la actualización sí va en todas las pantallas (José, 5-oct), pero no tapa toques: su capa deja
  // pasar todo lo que no sea la pastilla misma (arriba al centro, chica).
  assert.ok(app.includes('<AvisoActualizacion />'), 'AvisoActualizacion en todas las pantallas');
  assert.match(leer('app/AvisoActualizacion.tsx'), /pointerEvents="box-none"/);
  assert.match(app, /conCompanera=\{enSesion\}/);
});

prueba('Ajustes: el mismo selector, con la selección a medias y guardar solo completa', () => {
  assert.match(ajustes, /useState<SeleccionCumple>\(SIN_CUMPLE\)/);
  assert.match(ajustes, /<SelectorCumple mes=\{cumple\.mes\} dia=\{cumple\.dia\} onCambiar=\{\(mes, dia\) => setCumple\(\{ mes, dia \}\)\} \/>/);
  assert.match(ajustes, /deshabilitado=\{!cumpleDeSeleccion\(cumple\)\}/);
  assert.match(ajustes, /setCumple\(seleccionDeCumple\(perfil\?\.cumple\)\)/);
  // La hoja solo se arrastra desde el asa: el arrastre en el contenido (los meses, los días) es para tocar y recorrer.
  const hoja = leer('ui/Hoja.tsx');
  const gd = hoja.indexOf('<GestureDetector gesture={pan}>');
  assert.ok(gd > 0 && hoja.indexOf('</GestureDetector>') < hoja.indexOf('<ScrollView'), 'el ScrollView de la hoja va fuera del arrastre');
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
console.log(`\n${ok}/${pruebas.length} pruebas del cumpleaños`);
if (ok !== pruebas.length) process.exit(1);
