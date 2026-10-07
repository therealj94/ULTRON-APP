/**
 * La guarda de la cuenta de prueba del emulador (cuenta-prueba.mjs), sin red: la primera guarda («no es de la junta»)
 * se quedó vacía cuando DESK_USERS pasó a []. Ahora: la lista de la junta llega por secreto (AURA_CORREOS_JUNTA, nunca
 * escrita en el repositorio) y, lo que manda, el nivel que da el SERVIDOR tiene que ser «miembro».
 *
 *   cd mobile && npx tsx pruebas/emulador/cuenta-prueba.prueba.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { correosDeLaJunta, esDeLaListaDeLaJunta, motivoDelNivel } from './cuenta-prueba.mjs';

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

prueba('la lista de la junta sale del secreto (comas, espacios, `;` o líneas; sin mayúsculas)', () => {
  const junta = correosDeLaJunta('A@Junta.Test, b@junta.test;c@junta.test\n d@junta.test');
  assert.deepEqual([...junta].sort(), ['a@junta.test', 'b@junta.test', 'c@junta.test', 'd@junta.test']);
  assert.equal(esDeLaListaDeLaJunta(' B@JUNTA.test ', junta), true, 'se rechaza sin entrar');
  assert.equal(esDeLaListaDeLaJunta('prueba@otra.test', junta), false);
  assert.equal(correosDeLaJunta('').size, 0, 'sin secreto, la lista está vacía (y manda el nivel del servidor)');
  assert.equal(correosDeLaJunta(undefined).size, 0);
});

prueba('el servidor manda: solo «miembro» pasa; junta, nivel desconocido, rol de la junta u otra cuenta, no', () => {
  const s = (user) => ({ authenticated: true, user });
  assert.equal(motivoDelNivel(s({ correo: 'p@x.test', nivel: 'miembro', rol: 'Miembro · Genesis ID' }), 'p@x.test'), null);
  assert.match(motivoDelNivel(s({ correo: 'p@x.test', nivel: 'junta', rol: 'Junta Directiva' }), 'p@x.test'), /nivel «junta»/);
  assert.match(motivoDelNivel(s({ correo: 'p@x.test', rol: '' }), 'p@x.test'), /nivel «desconocido»/);
  assert.match(motivoDelNivel(s({ correo: 'p@x.test', nivel: 'miembro', rol: 'Junta Directiva · Orden Global' }), 'p@x.test'), /rol/);
  assert.match(motivoDelNivel(s({ correo: 'otra@x.test', nivel: 'miembro' }), 'p@x.test'), /no se pudo comprobar/);
  assert.match(motivoDelNivel({ authenticated: false }, 'p@x.test'), /no se pudo comprobar/);
});

prueba('la guarda ya no lee mobile/src/config.ts ni trae correos escritos; el flujo pasa el secreto', () => {
  const src = fs.readFileSync(path.join(AQUI, 'cuenta-prueba.mjs'), 'utf8');
  assert.doesNotMatch(src, /config\.ts'\)/, 'no lee config.ts');
  assert.match(src, /correosDeLaJunta\(process\.env\.AURA_CORREOS_JUNTA\)/);
  assert.match(src, /motivoDelNivel\(s\.json, CORREO\)/, 'el nivel del servidor se comprueba al entrar');
  const sinComentarios = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(sinComentarios, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, 'ningún correo escrito en el código');
  const flujo = fs.readFileSync(path.join(AQUI, '../../../.github/workflows/emulador-android.yml'), 'utf8');
  assert.match(flujo, /AURA_CORREOS_JUNTA: \$\{\{ secrets\.AURA_CORREOS_JUNTA \}\}/);
  assert.doesNotMatch(flujo, /\/mobile\/src\/config\.ts/, 'ya no hace falta bajar config.ts');
});

console.log(`\n${n - fallos}/${n} pruebas de la cuenta de prueba del emulador`);
process.exit(fallos ? 1 : 0);
