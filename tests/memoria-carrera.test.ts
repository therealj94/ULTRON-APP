/**
 * Revisión 7 (G4, «ningún registro borrado que reaparezca»): «olvida todo» volvía en la memoria de un miembro
 * (lib/memoria-miembro.ts) y en la de la junta (lib/memoria.ts) cuando una lectura lenta de S3 (tras un reinicio: caché y
 * disco vacíos) empezaba ANTES del olvido y volvía DESPUÉS con el cajón viejo, que se ponía en la caché y se guardaba
 * encima. Ahora: cambios de a uno por cuenta, lecturas viejas descartadas (lib/fila-por-cuenta.ts) y, en la junta, la
 * primera carga es una sola aunque la pidan varios a la vez.
 *
 * S3 falso con lecturas lentas (la PRIMERA lectura de cada vuelta tarda más que las demás, como un S3 que se atasca),
 * 50 vueltas con tiempos al azar, y un reinicio de verdad (caché y disco vacíos) antes de comprobar lo que quedó.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-carrera-'));
const ANTES = { ...process.env };
Object.assign(process.env, {
  ULTRON_MEMORIA_BUCKET: 'cubo-carrera',
  AWS_ACCESS_KEY_ID: 'AKIAPRUEBA',
  AWS_SECRET_ACCESS_KEY: 'secreto-prueba',
  ULTRON_MEMORIA_MIEMBROS_DIR: path.join(DIR, 'miembros'),
  ULTRON_MEMORIA_JUNTA_FILE: path.join(DIR, 'junta', 'memoria-junta.json'),
});

const store = new Map<string, string>();
/** Demora de cada lectura en orden (la primera de la vuelta, la segunda…); después de la lista, 0. */
let demoras: number[] = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any = {}) => {
  const u = new URL(String(url));
  if (!u.host.endsWith('amazonaws.com')) return fetchOriginal(url, init);
  const k = u.pathname;
  const m = String(init.method || 'GET').toUpperCase();
  if (m === 'PUT') {
    store.set(k, Buffer.from(init.body).toString('utf8'));
    return new Response('', { status: 200 });
  }
  const foto = store.get(k); // lo que había cuando EMPEZÓ la lectura
  const ms = demoras.shift() || 0;
  if (ms) await new Promise((r) => setTimeout(r, ms));
  return foto === undefined ? new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 }) : new Response(foto, { status: 200 });
}) as typeof fetch;

test.after(() => {
  globalThis.fetch = fetchOriginal;
  for (const k of Object.keys(process.env)) if (!(k in ANTES)) delete process.env[k];
  Object.assign(process.env, ANTES);
  fs.rmSync(DIR, { recursive: true, force: true });
});

const M = await import('../lib/memoria-miembro');
const J = await import('../lib/memoria');

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const azar = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const SECRETO = 'recuerda que mi clave del banco termina en 4321';

function reiniciarMiembros() {
  M._olvidarCacheMiembros();
  fs.rmSync(path.join(DIR, 'miembros'), { recursive: true, force: true });
}
function reiniciarJunta() {
  J._olvidarCargaTest();
  fs.rmSync(path.join(DIR, 'junta'), { recursive: true, force: true });
}
const enS3 = (pista: string) => [...store.entries()].filter(([k]) => k.includes(pista)).map(([, v]) => v);

test('memoria de un miembro: «olvida todo» con un turno leyendo S3 lento no vuelve (50 vueltas, con reinicio)', async () => {
  for (let i = 0; i < 50; i++) {
    const correo = `ana-${i}@carrera.test`;
    demoras = [];
    await M.guardarHechoMiembro(correo, SECRETO);
    reiniciarMiembros();
    // Turno primero (su lectura tarda), «olvida todo» después, mientras esa lectura sigue en vuelo.
    demoras = [azar(20, 70), azar(0, 10), azar(0, 10)];
    const turno = M.recordarTurnoMiembro({ correo, rol: 'user', texto: 'hola, ¿cómo vas?', esperar: true });
    const otro = Math.random() < 0.5 ? M.cargarMiembro(correo) : Promise.resolve();
    await espera(azar(0, 15));
    const olvido = await M.olvidarMiembro(correo);
    assert.equal(olvido.durable, true);
    await Promise.all([turno, otro]);
    const guardado = enS3(M.huellaMiembro(correo));
    assert.equal(guardado.length, 1);
    assert.ok(!guardado[0].includes('4321'), `vuelta ${i}: el hecho olvidado volvió a S3`);
    // Reinicio: lo que queda es lo de S3.
    reiniciarMiembros();
    demoras = [];
    const tras = await M.cargarMiembro(correo);
    assert.deepEqual(tras.larga, [], `vuelta ${i}: tras reiniciar, el hecho olvidado volvió`);
  }
});

test('memoria de un miembro: un hecho nuevo y un olvido a la vez no dejan lo olvidado antes (orden de llegada)', async () => {
  for (let i = 0; i < 20; i++) {
    const correo = `bruno-${i}@carrera.test`;
    demoras = [];
    await M.guardarHechoMiembro(correo, SECRETO);
    reiniciarMiembros();
    demoras = [azar(20, 60), azar(0, 10)];
    const nuevo = M.guardarHechoMiembro(correo, 'recuerda que el lunes tengo dentista');
    await espera(azar(0, 10));
    await M.olvidarMiembro(correo);
    await nuevo;
    reiniciarMiembros();
    demoras = [];
    const tras = await M.cargarMiembro(correo);
    assert.ok(!tras.larga.some((h) => h.hecho.includes('4321')), `vuelta ${i}: lo olvidado volvió`);
  }
});

test('memoria de la junta: «olvídalo todo» con un turno leyendo S3 lento no vuelve (50 vueltas, con reinicio)', async () => {
  for (let i = 0; i < 50; i++) {
    store.clear();
    demoras = [];
    J.resetMemoriaTest();
    await J.guardarHechoQuien({ quien: 'jose', hecho: `${SECRETO} (${i})` });
    assert.ok(enS3('memoria-junta')[0]?.includes('4321'));
    reiniciarJunta();
    demoras = [azar(20, 70), azar(0, 10), azar(0, 10)];
    const turno = J.recordarTurno({ quien: 'jose', rol: 'user', texto: 'hola, ¿cómo vas?', canal: 'mesa' });
    await espera(azar(0, 15));
    const olvido = await J.olvidarQuien('jose');
    assert.equal(olvido.durable, true);
    await turno;
    const guardado = enS3('memoria-junta')[0];
    assert.ok(!guardado.includes('4321'), `vuelta ${i}: el hecho olvidado volvió a S3`);
    reiniciarJunta();
    demoras = [];
    const tras = await J.cargarMemoria();
    assert.ok(!(tras.perfiles.jose?.larga || []).some((h) => h.hecho.includes('4321')), `vuelta ${i}: tras reiniciar, el hecho olvidado volvió`);
  }
  reiniciarJunta();
});
