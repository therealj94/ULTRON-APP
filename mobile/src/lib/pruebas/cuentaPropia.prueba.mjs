/**
 * Pruebas en Node de la cuenta de AU-RA en el teléfono (lib/cuentaPropia.ts): lo que se comprueba antes de
 * mandar «Entrar» o «Crear cuenta», las mismas reglas de contraseña que el servidor, el código de 6 cifras y
 * que cada respuesta del servidor se diga con su mensaje preciso (contraseña mala ≠ sin conexión).
 *
 *   cd mobile && npx tsx src/lib/pruebas/cuentaPropia.prueba.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { correoConForma, errorDeCodigo, errorDeEntrada, errorDeRegistro, normalizarCodigo, problemaDeClave, validarEntrada, validarRegistro } from '../cuentaPropia.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const pruebas = [];
const prueba = (n, f) => pruebas.push([n, f]);

const BIEN = { nombre: 'Ana López', correo: 'ana@correo.com', clave: 'una frase larga', confirmar: 'una frase larga' };

prueba('crear cuenta: el formulario bueno pasa; cada campo malo se dice debajo de SU campo', () => {
  assert.equal(validarRegistro(BIEN), null);
  assert.equal(validarRegistro({ ...BIEN, nombre: ' A ' })?.campo, 'nombre');
  assert.equal(validarRegistro({ ...BIEN, correo: 'ana@correo' })?.campo, 'correo');
  assert.equal(validarRegistro({ ...BIEN, clave: 'corta', confirmar: 'corta' })?.campo, 'clave');
  assert.equal(validarRegistro({ ...BIEN, confirmar: 'otra frase larga' })?.campo, 'confirmar');
});

prueba('las reglas de la contraseña son las del servidor (server/cuentas.ts problemaDeClave)', () => {
  assert.match(problemaDeClave('123456789'), /10 caracteres/);
  assert.match(problemaDeClave('aaaaaaaaaaaa'), /repetido/);
  assert.match(problemaDeClave('123456789012'), /solo números/);
  assert.match(problemaDeClave('xxanalopezxx', 'analopez@correo.com'), /correo/);
  assert.equal(problemaDeClave('una frase larga', 'ana@correo.com'), null);
  // Las mismas cinco reglas, con los mismos números, que el servidor.
  const srv = fs.readFileSync(path.resolve(AQUI, '../../../../server/cuentas.ts'), 'utf8');
  for (const r of ['c.length < 10', 'c.length > 200', '/^(.)\\1+$/', '/^\\d+$/', 'local.length >= 4']) assert.ok(srv.includes(r), `el servidor también tiene ${r}`);
});

prueba('entrar: sin correo o sin contraseña no sale nada', () => {
  assert.equal(validarEntrada({ correo: 'x', clave: 'algo' })?.campo, 'correo');
  assert.equal(validarEntrada({ correo: 'ana@correo.com', clave: '' })?.campo, 'clave');
  assert.equal(validarEntrada({ correo: 'ana@correo.com', clave: 'algo' }), null);
  assert.ok(correoConForma(' ana@correo.com '));
  assert.ok(!correoConForma('ana correo.com'));
});

prueba('entrar: contraseña mala (401) ≠ sin conexión ≠ freno ≠ servidor ocupado ≠ suspendida', () => {
  const mala = errorDeEntrada({ status: 401, data: { codigo: 'NO_ENTRA', error: 'Correo o clave incorrectos.' } });
  assert.deepEqual([mala.codigo, mala.campo], ['CLAVE_MALA', 'clave']);
  assert.match(mala.mensaje, /incorrectos/);
  assert.match(mala.mensaje, /Veta Wallet/, 'a quien escribió su clave de la wallet aquí se le dice dónde ir');
  const red = errorDeEntrada({ name: 'AbortError' });
  assert.equal(red.codigo, 'SIN_CONEXION');
  assert.doesNotMatch(red.mensaje, /incorrect/, 'una red caída nunca dice «contraseña incorrecta»');
  assert.equal(errorDeEntrada({ status: 429, data: {} }).codigo, 'LIMITE');
  assert.equal(errorDeEntrada({ status: 503, data: { error: 'No pude comprobar tu cuenta' } }).codigo, 'SERVIDOR');
  assert.equal(errorDeEntrada({ status: 500, data: { codigo: 'REMOTO_CAIDO' } }).codigo, 'SERVIDOR');
  assert.equal(errorDeEntrada({ status: 403, data: { codigo: 'SUSPENDIDA' } }).codigo, 'SUSPENDIDA');
});

prueba('crear cuenta: correo ocupado sin decir de quién; los campos del servidor van a su campo; red ≠ servidor', () => {
  const ocupado = errorDeRegistro({ status: 409, data: { codigo: 'CORREO_NO_DISPONIBLE', error: 'No se puede crear una cuenta nueva con ese correo.' } });
  assert.deepEqual([ocupado.codigo, ocupado.campo], ['CORREO_NO_DISPONIBLE', 'correo']);
  assert.equal(errorDeRegistro({ status: 400, data: { codigo: 'CLAVE_DEBIL', error: 'La contraseña necesita al menos 10 caracteres.' } }).campo, 'clave');
  assert.equal(errorDeRegistro({ status: 400, data: { codigo: 'NOMBRE' } }).campo, 'nombre');
  assert.equal(errorDeRegistro({}).codigo, 'SIN_CONEXION');
  assert.equal(errorDeRegistro({ status: 429, data: {} }).codigo, 'LIMITE');
  assert.equal(errorDeRegistro({ status: 503, data: { codigo: 'SIN_BASE', error: 'Ahora mismo no se pueden crear cuentas.' } }).codigo, 'SIN_BASE');
});

prueba('el código: solo cifras, hasta 6; el malo va debajo del campo; «espera» antes de pedir otro', () => {
  assert.equal(normalizarCodigo(' 12-34 56 7'), '123456');
  assert.equal(normalizarCodigo('abc'), '');
  assert.equal(errorDeCodigo({ status: 400, data: { codigo: 'CODIGO_INVALIDO' } }).campo, 'codigo');
  assert.equal(errorDeCodigo({ status: 429, data: { codigo: 'ESPERA' } }).codigo, 'ESPERA');
  assert.equal(errorDeCodigo({ status: 429, data: { codigo: 'LIMITE' } }).codigo, 'LIMITE');
  assert.equal(errorDeCodigo({ status: 401, data: {} }).codigo, 'SESION');
  assert.equal(errorDeCodigo(null).codigo, 'SIN_CONEXION');
});

let ok = 0;
for (const [n, f] of pruebas) {
  try {
    await f();
    ok++;
    console.log(`ok - ${n}`);
  } catch (e) {
    console.log(`FALLA - ${n}\n  ${e.message}`);
  }
}
console.log(`\n${ok}/${pruebas.length} pruebas de la cuenta de AU-RA`);
if (ok !== pruebas.length) process.exit(1);
