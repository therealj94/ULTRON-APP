/**
 * La memoria larga de la mesa WEB, por cuenta, y lo que dice al guardar u olvidar
 * (src/09-estado/memoria.ts; auditoría A01 y A14).
 *
 * Antes: un solo cajón por navegador (`ultron_memoria_larga`). Guardar un hecho con A y otro con B
 * devolvía los dos en la misma lectura, y cada turno de B mandaba al servidor los de A (que los
 * guardaba como de B). «Olvidar» decía «listo» sin mirar si el servidor contestaba 503.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

type Llamada = { url: string; cuerpo: any; token: string };
const almacen = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => (almacen.has(k) ? almacen.get(k)! : null),
  setItem: (k: string, v: string) => void almacen.set(k, String(v)),
  removeItem: (k: string) => void almacen.delete(k),
};
(globalThis as any).localStorage = fakeStorage;
(globalThis as any).sessionStorage = fakeStorage;
(globalThis as any).window = globalThis;

let llamadas: Llamada[] = [];
let responder: (c: Llamada) => { status: number; json: unknown } = () => ({ status: 200, json: { ok: true } });
globalThis.fetch = (async (url: string, init: any = {}) => {
  const c: Llamada = { url: String(url), cuerpo: init.body ? JSON.parse(init.body) : null, token: init.headers?.['x-ultron-sesion'] || '' };
  llamadas.push(c);
  const r = responder(c);
  return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'Content-Type': 'application/json' } });
}) as any;

const mem = await import('../src/09-estado/memoria');
const { guardarTokenMesa } = await import('../src/10-infra/sesionCliente');
const { pedirTurno } = await import('../src/04-cerebro/turno');

function entrar(correo: string, token: string) {
  guardarTokenMesa(token);
  mem.fijarCuentaMemoria(correo);
}
function salir() {
  guardarTokenMesa('');
  mem.fijarCuentaMemoria(null);
}

test('A01: cada cuenta tiene su cajón; lo de A no aparece para B', async () => {
  almacen.clear();
  responder = () => ({ status: 200, json: { ok: true } });
  entrar('a@prueba.local', 'tok-a');
  assert.equal((await mem.guardarHecho('dato exclusivo A')).remoto, 'ok');
  assert.deepEqual(mem.leerLarga(), ['dato exclusivo A']);
  salir();
  assert.deepEqual(mem.leerLarga(), [], 'sin nadie, nada');
  entrar('b@prueba.local', 'tok-b');
  assert.deepEqual(mem.leerLarga(), [], 'B no hereda lo de A');
  await mem.guardarHecho('dato exclusivo B');
  assert.deepEqual(mem.leerLarga(), ['dato exclusivo B']);
  salir();
  entrar('A@Prueba.local ', 'tok-a2');
  assert.deepEqual(mem.leerLarga(), ['dato exclusivo A'], 'A lo encuentra al volver (mismo correo, otra sesión)');
  assert.ok(![...almacen.keys()].some((k) => k.includes('@')), 'la clave no lleva el correo a la vista');
});

test('A01: si el token cambió y la pantalla no avisó todavía, no se lee el cajón de nadie', () => {
  almacen.clear();
  entrar('a@prueba.local', 'tok-a');
  almacen.set(mem.claveDeCuenta('a@prueba.local'), JSON.stringify(['secreto de A']));
  guardarTokenMesa('tok-de-otro');
  assert.deepEqual(mem.leerLarga(), []);
  assert.equal(mem.cuentaDeMemoria(), '');
});

test('A01: el cajón viejo compartido no se le pasa a nadie (se descarta)', () => {
  almacen.clear();
  almacen.set(mem.CLAVE_COMPARTIDA, JSON.stringify(['de alguien', 'de otro']));
  entrar('b@prueba.local', 'tok-b');
  assert.deepEqual(mem.leerLarga(), []);
  assert.equal(almacen.has(mem.CLAVE_COMPARTIDA), false);
});

test('A01: el turno de B no manda al servidor lo de A, y dice de quién es lo que manda', async () => {
  almacen.clear();
  responder = () => ({ status: 200, json: { ok: true } });
  entrar('a@prueba.local', 'tok-a');
  await mem.guardarHecho('A: su hija se llama Sofía');
  salir();
  entrar('b@prueba.local', 'tok-b');
  llamadas = [];
  responder = () => ({ status: 200, json: { reply: 'hola' } });
  await pedirTurno({ message: 'hola' });
  const turno = llamadas.find((c) => c.url === '/api/turno')!;
  assert.deepEqual(turno.cuerpo.memoria, []);
  assert.equal(turno.cuerpo.memoriaDe, 'b@prueba.local');
  assert.ok(!JSON.stringify(turno.cuerpo).includes('Sofía'));
});

test('sin cuenta no se guarda nada local ni se llama al servidor', async () => {
  almacen.clear();
  salir();
  llamadas = [];
  assert.equal((await mem.guardarHecho('algo')).remoto, 'sin-sesion');
  assert.equal(almacen.size, 0);
  assert.equal(llamadas.length, 0);
});

test('A14: olvidar dice lo que de verdad pasó (503, 401, sin red, ok)', async () => {
  almacen.clear();
  entrar('a@prueba.local', 'tok-a');
  responder = () => ({ status: 503, json: { error: 'no' } });
  const r503 = await mem.olvidarTodo();
  assert.equal(r503.remoto, 'fallo');
  assert.equal(r503.status, 503);
  responder = () => ({ status: 401, json: { error: 'sesión requerida' } });
  assert.equal((await mem.olvidarTodo()).remoto, 'sin-sesion');
  responder = () => ({ status: 403, json: { error: 'no' } });
  assert.equal((await mem.olvidarTodo()).remoto, 'sin-sesion');
  responder = () => ({ status: 200, json: { ok: true } });
  assert.equal((await mem.olvidarTodo()).remoto, 'fallo', 'sin `olvidado: true` no hay recibo de borrado');
  responder = () => ({ status: 200, json: { ok: true, olvidado: true } });
  assert.equal((await mem.olvidarTodo()).remoto, 'ok');
  const antes = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError('Failed to fetch');
  }) as any;
  assert.equal((await mem.olvidarTodo()).remoto, 'fallo');
  globalThis.fetch = antes;
});

test('A14: guardar también devuelve el recibo (503 no es «anotado»)', async () => {
  almacen.clear();
  entrar('a@prueba.local', 'tok-a');
  responder = () => ({ status: 503, json: {} });
  assert.equal((await mem.guardarHecho('x')).remoto, 'fallo');
  responder = () => ({ status: 200, json: { ok: true } });
  assert.equal((await mem.guardarHecho('y')).remoto, 'ok');
});
