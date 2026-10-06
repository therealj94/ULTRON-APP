/**
 * Revisión del 6-oct (blocker 4, «ningún registro borrado que reaparezca»): en lib/voces-miembro.ts `guardar()`
 * ponía en fila solo las ESCRITURAS, no el «leer → cambiar → guardar». «Olvida la voz de Ana» y un alta a la vez
 * (otra persona, o una muestra más) leían el mismo cajón con Ana; si el alta guardaba última, la voz biométrica
 * borrada volvía. Ahora agregarVoz / olvidarVoz / olvidarTodasLasVoces van de a uno por cuenta, y una lectura
 * lenta de S3 (caché vacía tras un reinicio) que empezó antes de un cambio no pisa la caché ni el disco
 * (lib/fila-por-cuenta.ts). Lo mismo para las caras (la lectura lenta).
 *
 * 50 vueltas de cada mezcla, con y sin caché, con S3 de mentira que tarda distinto en cada lectura.
 */
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voces-carrera-'));
process.env.ULTRON_VOCES_DIR = path.join(dir, 'voces');
process.env.ULTRON_CARAS_DIR = path.join(dir, 'caras');
process.env.ULTRON_MEMORIA_BUCKET = '';
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const voces = await import('../lib/voces-miembro');
const caras = await import('../lib/caras-miembro');
const { MODELO_VOZ } = await import('../lib/voces-motor');

const CORREO = 'carrera-voz@ejemplo.test';
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Pseudoazar fijo: las mismas demoras en cada corrida. */
let semilla = 7;
const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648);

const huella = (pico: number) => Array.from({ length: MODELO_VOZ.dim }, (_, i) => (i === pico % MODELO_VOZ.dim ? 0.9 : 0.01));
const alta = (nombre: string) => {
  const a = voces.validarAltaVoz({ nombre, relacion: 'conocido', consentimiento: { como: 'voz', frase: 'sí, recuérdame' } }, 'Dueña');
  assert.ok(a.ok);
  return a as Exclude<typeof a, { ok: false }>;
};

/** Un S3 de mentira: lo guardado y lecturas que tardan (o no) lo que diga `demora`. */
function s3Falso(demora: () => number) {
  const guardado = new Map<string, unknown>();
  const leer = async (k: string) => {
    // Se copia lo que hay AL EMPEZAR la lectura: una respuesta lenta trae lo de antes (como S3 de verdad).
    const v = guardado.has(k) ? JSON.parse(JSON.stringify(guardado.get(k))) : null;
    await dormir(demora());
    return v ? { ok: true, json: v, detalle: '' } : { ok: false, json: null, detalle: 'no existe', missing: true };
  };
  const poner = async (k: string, j: unknown) => {
    await dormir(1);
    guardado.set(k, JSON.parse(JSON.stringify(j)));
    return { ok: true, detalle: '' };
  };
  return { guardado, leer, poner };
}

function sinDiscoNiCache() {
  voces._olvidarCacheVoces();
  caras._olvidarCacheCaras();
  fs.rmSync(path.join(dir, 'voces'), { recursive: true, force: true });
  fs.rmSync(path.join(dir, 'caras'), { recursive: true, force: true });
}

beforeEach(() => {
  voces._s3DePrueba(null);
  (voces as any)._s3LecturaDePrueba?.(null);
  caras._s3DePrueba(null);
  (caras as any)._s3LecturaDePrueba?.(null);
});

test('voces: olvidar y dar de alta a otra persona a la vez (con caché) — la voz borrada nunca vuelve (50 vueltas)', async () => {
  sinDiscoNiCache();
  for (let i = 0; i < 50; i++) {
    const ana = await voces.agregarVoz(CORREO, alta(`Ana ${i}`), [huella(i)]);
    const [olvidada] = await Promise.all([voces.olvidarVoz(CORREO, ana.id), voces.agregarVoz(CORREO, alta(`Bruno ${i}`), [huella(i + 100)])]);
    assert.equal(olvidada?.id, ana.id, `vuelta ${i}: se olvidó`);
    assert.ok(!(await voces.cargarVoces(CORREO)).personas.some((p) => p.id === ana.id), `vuelta ${i}: Ana no vuelve (caché)`);
    voces._olvidarCacheVoces();
    assert.ok(!(await voces.cargarVoces(CORREO)).personas.some((p) => p.id === ana.id), `vuelta ${i}: Ana no vuelve (disco)`);
    await voces.olvidarTodasLasVoces(CORREO);
  }
});

test('voces: olvidar a una persona mientras se le suman muestras — no resucita (50 vueltas)', async () => {
  sinDiscoNiCache();
  for (let i = 0; i < 50; i++) {
    const ana = await voces.agregarVoz(CORREO, alta('Ana'), [huella(i)]);
    // El borrado y una muestra más para «Ana» (mismo nombre) a la vez: si la muestra va después, es un alta
    // NUEVA (otro id, con su propio permiso); lo que nunca puede pasar es que vuelva el registro borrado.
    await Promise.all([voces.olvidarVoz(CORREO, ana.id), voces.agregarVoz(CORREO, alta('Ana'), [huella(i + 1)])]);
    const ids = (await voces.cargarVoces(CORREO)).personas.map((p) => p.id);
    assert.ok(!ids.includes(ana.id), `vuelta ${i}`);
    await voces.olvidarTodasLasVoces(CORREO);
  }
});

test('voces: olvidar TODAS y dar de alta a la vez — ninguna de las borradas vuelve (50 vueltas)', async () => {
  sinDiscoNiCache();
  for (let i = 0; i < 50; i++) {
    const ana = await voces.agregarVoz(CORREO, alta('Ana'), [huella(i)]);
    const altaYo = voces.validarAltaVoz({ nombre: '', relacion: 'yo', consentimiento: { como: 'dueño' } }, 'Dueña');
    assert.ok(altaYo.ok);
    const yo = await voces.agregarVoz(CORREO, altaYo as any, [huella(i + 3)]);
    await Promise.all([voces.olvidarTodasLasVoces(CORREO), voces.agregarVoz(CORREO, alta('Bruno'), [huella(i + 5)])]);
    const ids = (await voces.cargarVoces(CORREO)).personas.map((p) => p.id);
    assert.ok(!ids.includes(ana.id) && !ids.includes(yo.id), `vuelta ${i}: ${ids}`);
    await voces.olvidarTodasLasVoces(CORREO);
  }
});

test('voces: SIN caché ni disco (reinicio) y S3 lento — una lectura vieja no pisa el borrado (50 vueltas)', async () => {
  const s3 = s3Falso(() => Math.floor(azar() * 25));
  voces._s3DePrueba({ listo: () => true, put: s3.poner as any });
  (voces as any)._s3LecturaDePrueba?.({ listo: () => true, get: s3.leer });
  for (let i = 0; i < 50; i++) {
    sinDiscoNiCache();
    const ana = await voces.agregarVoz(CORREO, alta('Ana'), [huella(i)]);
    sinDiscoNiCache(); // un redespliegue: solo queda S3
    // Una lectura cualquiera (la de «¿quién habla?») va a S3 y tarda; mientras, se olvida a Ana y se da de alta a Bruno.
    const lectura = voces.cargarVoces(CORREO);
    const [olvidada] = await Promise.all([voces.olvidarVoz(CORREO, ana.id), voces.agregarVoz(CORREO, alta('Bruno'), [huella(i + 9)]), lectura]);
    assert.equal(olvidada?.id, ana.id, `vuelta ${i}: se olvidó`);
    // Otra alta después: parte de lo guardado, no de la lectura vieja.
    await voces.agregarVoz(CORREO, alta('Carla'), [huella(i + 20)]);
    assert.ok(!(await voces.cargarVoces(CORREO)).personas.some((p) => p.id === ana.id), `vuelta ${i}: no vuelve (caché)`);
    voces._olvidarCacheVoces();
    assert.ok(!(await voces.cargarVoces(CORREO)).personas.some((p) => p.id === ana.id), `vuelta ${i}: no vuelve (disco)`);
    const enS3 = [...s3.guardado.values()].at(-1) as any;
    assert.ok(!enS3.personas.some((p: any) => p.id === ana.id), `vuelta ${i}: no vuelve (S3)`);
    await voces.olvidarTodasLasVoces(CORREO);
  }
});

test('caras: SIN caché ni disco y S3 lento — una lectura vieja no hace volver una cara olvidada (50 vueltas)', async () => {
  const s3 = s3Falso(() => Math.floor(azar() * 25));
  caras._s3DePrueba({ listo: () => true, put: s3.poner as any });
  (caras as any)._s3LecturaDePrueba?.({ listo: () => true, get: s3.leer });
  const vec = (k: number) => Array.from({ length: caras.LARGO_VECTOR }, (_, i) => (i === k % caras.LARGO_VECTOR ? 0.5 : 0.01));
  const altaCara = (nombre: string, k: number) => {
    const a = caras.validarAlta({ nombre, relacion: 'conocido', vectores: [vec(k)], consentimiento: { como: 'voz', frase: 'sí' } }, 'Dueña');
    assert.ok(a.ok);
    return a as any;
  };
  for (let i = 0; i < 50; i++) {
    sinDiscoNiCache();
    const ana = await caras.agregarCara(CORREO, altaCara('Ana', i));
    sinDiscoNiCache();
    const lectura = caras.cargarCaras(CORREO);
    const [olvidada] = await Promise.all([caras.olvidarCara(CORREO, ana.id), caras.agregarCara(CORREO, altaCara('Bruno', i + 1)), lectura]);
    assert.equal(olvidada?.id, ana.id, `vuelta ${i}: se olvidó`);
    await caras.agregarCara(CORREO, altaCara('Carla', i + 2));
    assert.ok(!(await caras.cargarCaras(CORREO)).personas.some((p) => p.id === ana.id), `vuelta ${i}: no vuelve`);
    caras._olvidarCacheCaras();
    assert.ok(!(await caras.cargarCaras(CORREO)).personas.some((p) => p.id === ana.id), `vuelta ${i}: no vuelve (disco)`);
    await caras.olvidarTodasLasCaras(CORREO);
  }
});
