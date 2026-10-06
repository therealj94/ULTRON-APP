/**
 * Revisión 7 (M3, «ningún registro borrado que reaparezca»): en un despliegue sin cortes corren DOS instancias del
 * servidor un rato, cada una con su caché de voces y caras. Antes la caché no vencía nunca y cada cambio partía de ella:
 * «olvida la voz de Ana» en la instancia A y una muestra más de Bruno en la B (con Ana todavía en su caché) hacían volver
 * a Ana a S3. Ahora cada cambio vuelve a leer S3 bajo el candado y guarda con la condición del ETag leído (412 → se
 * vuelve a leer), y la caché vence.
 *
 * Dos instancias de verdad del módulo (dos importaciones distintas) con UN S3 falso compartido que sabe de ETags y de
 * If-Match / If-None-Match.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voces-dos-'));
process.env.ULTRON_VOCES_DIR = path.join(dir, 'voces');
process.env.ULTRON_CARAS_DIR = path.join(dir, 'caras');
process.env.ULTRON_MEMORIA_BUCKET = '';
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const vocesA = await import('../lib/voces-miembro.ts?instancia=A');
const vocesB = await import('../lib/voces-miembro.ts?instancia=B');
const carasA = await import('../lib/caras-miembro.ts?instancia=A');
const carasB = await import('../lib/caras-miembro.ts?instancia=B');
const { MODELO_VOZ } = await import('../lib/voces-motor');
assert.notEqual(vocesA, vocesB, 'dos instancias del módulo, cada una con su caché');

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
let semilla = 11;
const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648);

/** UN S3 para las dos instancias: lecturas que tardan, ETag por versión, PUT con y sin condición. */
function s3Compartido(demora: () => number) {
  const datos = new Map<string, { json: string; etag: string }>();
  let version = 0;
  const leer = async (k: string) => {
    const v = datos.get(k); // lo que hay AL EMPEZAR la lectura
    await dormir(demora());
    return v ? { ok: true, json: JSON.parse(v.json), etag: v.etag, detalle: '' } : { ok: true, json: null, etag: null, detalle: 'vacío', missing: true };
  };
  const poner = async (k: string, j: unknown) => {
    await dormir(1);
    datos.set(k, { json: JSON.stringify(j), etag: `"v${++version}"` });
    return { ok: true, detalle: '' };
  };
  const ponerSi = async (k: string, j: unknown, cond: { siNoExiste?: boolean; siCoincide?: string }) => {
    await dormir(1);
    const v = datos.get(k);
    if ((cond.siNoExiste && v) || (cond.siCoincide && v?.etag !== cond.siCoincide)) return { ok: false, etag: null, conflicto: true, status: 412, detalle: 'S3 412' };
    const etag = `"v${++version}"`;
    datos.set(k, { json: JSON.stringify(j), etag });
    return { ok: true, etag, conflicto: false, status: 200, detalle: 'ok' };
  };
  return {
    datos,
    escribe: { listo: () => true, put: poner as any, putCond: ponerSi as any },
    lee: { listo: () => true, get: leer as any, getEtag: leer as any },
    ultimo: (k: string) => (datos.has(k) ? JSON.parse(datos.get(k)!.json) : null),
  };
}

function conectar(s3: ReturnType<typeof s3Compartido>) {
  for (const m of [vocesA, vocesB, carasA, carasB] as any[]) {
    m._s3DePrueba(s3.escribe);
    m._s3LecturaDePrueba(s3.lee);
  }
  vocesA._olvidarCacheVoces();
  vocesB._olvidarCacheVoces();
  carasA._olvidarCacheCaras();
  carasB._olvidarCacheCaras();
}

const huella = (pico: number) => Array.from({ length: MODELO_VOZ.dim }, (_, i) => (i === pico % MODELO_VOZ.dim ? 0.9 : 0.01));
const altaVoz = (m: typeof vocesA, nombre: string) => {
  const a = m.validarAltaVoz({ nombre, relacion: 'conocido', consentimiento: { como: 'voz', frase: 'sí, recuérdame' } }, 'Dueña');
  assert.ok(a.ok);
  return a as Exclude<typeof a, { ok: false }>;
};
const vec = (k: number) => Array.from({ length: carasA.LARGO_VECTOR }, (_, i) => (i === k % carasA.LARGO_VECTOR ? 0.5 : 0.01));
const altaCara = (m: typeof carasA, nombre: string, k: number) => {
  const a = m.validarAlta({ nombre, relacion: 'conocido', vectores: [vec(k)], consentimiento: { como: 'voz', frase: 'sí' } }, 'Dueña');
  assert.ok(a.ok);
  return a as Exclude<typeof a, { ok: false }>;
};

test('voces: A olvida a Ana; B (con Ana en su caché) suma una muestra de Bruno → Ana NO vuelve a S3', async () => {
  const s3 = s3Compartido(() => 0);
  conectar(s3);
  const correo = 'dos-voces@ejemplo.test';
  const clave = `ultron/voces/${vocesA.huellaVoces(correo)}.json`;
  const ana = await vocesA.agregarVoz(correo, altaVoz(vocesA, 'Ana'), [huella(1)]);
  const bruno = await vocesA.agregarVoz(correo, altaVoz(vocesA, 'Bruno'), [huella(2)]);
  // La instancia B reconoce voces: las tiene en su caché (con Ana).
  assert.equal((await vocesB.cargarVoces(correo)).personas.length, 2);
  // En A: «olvida la voz de Ana».
  assert.equal((await vocesA.olvidarVoz(correo, ana.id))?.id, ana.id);
  // En B: una muestra más de Bruno (aprender con el uso, o un alta).
  await vocesB.agregarVoz(correo, altaVoz(vocesB, 'Bruno'), [huella(3)]);
  const enS3 = s3.ultimo(clave);
  assert.ok(!enS3.personas.some((p: any) => p.id === ana.id), 'la voz borrada en A no vuelve a S3 por la caché vieja de B');
  assert.ok(enS3.personas.some((p: any) => p.id === bruno.id && p.vectores.length === 2), 'y la muestra de Bruno no se pierde');
  assert.ok(!(await vocesB.cargarVoces(correo)).personas.some((p) => p.id === ana.id), 'ni en la caché de B');
});

test('voces: la caché de una instancia vence — B deja de reconocer una voz borrada en A', async () => {
  const s3 = s3Compartido(() => 0);
  conectar(s3);
  process.env.ULTRON_VOCES_CACHE_MS = '40';
  try {
    const correo = 'dos-voces-ttl@ejemplo.test';
    const ana = await vocesA.agregarVoz(correo, altaVoz(vocesA, 'Ana'), [huella(4)]);
    assert.ok((await vocesB.cargarVoces(correo)).personas.some((p) => p.id === ana.id));
    await vocesA.olvidarVoz(correo, ana.id);
    await dormir(60);
    assert.ok(!(await vocesB.cargarVoces(correo)).personas.some((p) => p.id === ana.id), 'pasada la vida de la caché, B lee S3');
  } finally {
    delete process.env.ULTRON_VOCES_CACHE_MS;
  }
});

test('voces: olvido en A y alta en B A LA VEZ (lecturas lentas) — la borrada nunca vuelve y el alta no se pierde (30 vueltas)', async () => {
  const s3 = s3Compartido(() => Math.floor(azar() * 20));
  conectar(s3);
  const correo = 'dos-voces-carrera@ejemplo.test';
  const clave = `ultron/voces/${vocesA.huellaVoces(correo)}.json`;
  for (let i = 0; i < 30; i++) {
    const ana = await vocesA.agregarVoz(correo, altaVoz(vocesA, `Ana ${i}`), [huella(i)]);
    await vocesB.cargarVoces(correo);
    const [olvidada, nuevo] = await Promise.all([vocesA.olvidarVoz(correo, ana.id), vocesB.agregarVoz(correo, altaVoz(vocesB, `Bruno ${i}`), [huella(i + 50)])]);
    assert.equal(olvidada?.id, ana.id);
    const enS3 = s3.ultimo(clave);
    assert.ok(!enS3.personas.some((p: any) => p.id === ana.id), `vuelta ${i}: la borrada volvió`);
    assert.ok(enS3.personas.some((p: any) => p.id === nuevo.id), `vuelta ${i}: el alta de B se perdió`);
    await vocesA.olvidarTodasLasVoces(correo);
  }
});

test('caras: A olvida a Ana; B (con Ana en su caché) suma muestras a Bruno → Ana NO vuelve; y a la vez (30 vueltas)', async () => {
  const s3 = s3Compartido(() => 0);
  conectar(s3);
  const correo = 'dos-caras@ejemplo.test';
  const clave = `ultron/caras/${carasA.huellaCaras(correo)}.json`;
  const ana = await carasA.agregarCara(correo, altaCara(carasA, 'Ana', 1));
  const bruno = await carasA.agregarCara(correo, altaCara(carasA, 'Bruno', 2));
  assert.equal((await carasB.cargarCaras(correo)).personas.length, 2);
  await carasA.olvidarCara(correo, ana.id);
  await carasB.sumarMuestras(correo, bruno.id, [vec(3)]);
  assert.ok(!s3.ultimo(clave).personas.some((p: any) => p.id === ana.id), 'la cara olvidada en A no vuelve por la caché de B');

  const s3b = s3Compartido(() => Math.floor(azar() * 20));
  conectar(s3b);
  for (let i = 0; i < 30; i++) {
    const a = await carasA.agregarCara(correo, altaCara(carasA, `Ana ${i}`, i));
    const b = await carasA.agregarCara(correo, altaCara(carasA, `Bruno ${i}`, i + 40));
    await carasB.cargarCaras(correo);
    await Promise.all([carasA.olvidarCara(correo, a.id), carasB.sumarMuestras(correo, b.id, [vec(i + 80)])]);
    const enS3 = s3b.ultimo(clave);
    assert.ok(!enS3.personas.some((p: any) => p.id === a.id), `vuelta ${i}: la cara olvidada volvió`);
    assert.ok(enS3.personas.find((p: any) => p.id === b.id)?.vectores.length === 2, `vuelta ${i}: la muestra de B se perdió`);
    await carasA.olvidarTodasLasCaras(correo);
  }
});
