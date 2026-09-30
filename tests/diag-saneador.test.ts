/**
 * El diagnóstico de campo no lleva datos sensibles (lib/diag-saneador.ts y mobile/src/lib/saneador.ts;
 * auditoría A23).
 *
 * Antes /api/diag escribía en el log el mensaje del error y su pila tal cual (la pila, con saltos de
 * línea) y el teléfono los mandaba sin filtrar: un token, una clave o un correo dentro de una
 * excepción terminaban en los logs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanearDiag, sanearTexto } from '../lib/diag-saneador';
import { sanearTexto as sanearMovil } from '../mobile/src/lib/saneador';

const TOKEN = 'u1.eyJjb3JyZW8iOiJhQGIuYyJ9.Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA';
const SINTETICOS = [
  `Error: fetch failed https://aura-fp.onrender.com/api/turno?token=${TOKEN}&x=1`,
  `401 x-ultron-sesion: ${TOKEN}`,
  'password=Hunter2! y clave: miClaveSecreta',
  '{"contraseña":"abc123456","correo":"maria.jose@ordenglobal.org"}',
  'Authorization: Bearer sk_live_abcdefghijklmnop',
  'llamar a +504 9988-7766 mañana',
  'llave AAAAB3NzaC1yc2EAAAADAQABAAABAQC7aBcDeFgHiJkLmNoPqRsTuVwXyZ',
  'TypeError: undefined is not a function\n    at enviar (index.android.bundle:1:2345)\n    at línea falsa',
];

test('tokens, claves, correos, parámetros de URL y teléfonos no quedan en la carga ni en el log', () => {
  const salida = SINTETICOS.map((s) => sanearTexto(s, 900)).join(' || ');
  for (const prohibido of [TOKEN, 'Hunter2!', 'miClaveSecreta', 'abc123456', 'maria.jose@ordenglobal.org', 'sk_live_abcdefghijklmnop', '9988-7766', 'AAAAB3NzaC1yc2EAAAADAQABAAABAQC7aBcDeFgHiJkLmNoPqRsTuVwXyZ', 'x=1']) {
    assert.ok(!salida.includes(prohibido), `quedó «${prohibido}» en: ${salida}`);
  }
  assert.ok(salida.includes('https://aura-fp.onrender.com/api/turno?[…]'), 'la URL queda, sin sus parámetros');
  assert.ok(salida.includes('TypeError: undefined is not a function'), 'lo útil del error se conserva');
  assert.ok(!/[\r\n]/.test(salida), 'una sola línea: nadie escribe líneas falsas en el log');
});

test('el teléfono tapa EXACTAMENTE igual que el servidor', () => {
  for (const s of SINTETICOS) assert.equal(sanearMovil(s, 900), sanearTexto(s, 900), s);
});

test('solo pasan los campos conocidos, con su largo y saneados', () => {
  const d = sanearDiag({
    tipo: 'error-js',
    version: '4.7.0',
    plataforma: 'android 34',
    dispositivo: 'Samsung SM-A155',
    sesion: 'ab12cd34<script>',
    error: `No pude: ${TOKEN}`,
    stack: 'x\n'.repeat(2000),
    migas: ['+0.1s arranque', 'correo jose@ordenglobal.org'],
    correo: 'jose@ordenglobal.org',
    token: TOKEN,
    cualquierCosa: { profundo: true },
  });
  assert.deepEqual(Object.keys(d).sort(), ['dispositivo', 'error', 'migas', 'plataforma', 'sesion', 'stack', 'tipo', 'version'].sort());
  assert.equal(d.sesion, 'ab12cd34script');
  assert.ok(!d.error!.includes(TOKEN));
  assert.ok(d.stack!.length <= 900);
  assert.deepEqual(d.migas, ['+0.1s arranque', 'correo [correo]']);
  assert.equal(sanearDiag({ tipo: 'inventado' }).tipo, 'estado');
});
