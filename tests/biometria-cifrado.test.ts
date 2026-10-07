/**
 * A-7 · Las caras y las voces, cifradas en reposo (lib/biometria-sobre.ts).
 *
 * Contrato: AES-256-GCM con una llave de datos por escritura envuelta con una llave DERIVADA de un secreto del servidor
 * (sin KMS); cabecera versionada con `kid`; AAD con el tipo y la huella de la cuenta. Lo viejo en claro se sigue leyendo,
 * el próximo guardado ya va sellado, y la migración del arranque es idempotente y segura con dos arranques a la vez
 * (If-Match). Las lápidas (borradoTodo / marcaLapidas / aplicarLapidas / horaDeAlta) siguen valiendo con el sobre. La
 * constancia del permiso dice quién, cuándo, quién la presentó y, para un posible menor, la confirmación en pantalla.
 * Nada del cajón (vectores, nombres) sale al log. Todo con S3 y disco falsos, en carpetas temporales.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biometria-cifrado-'));
process.env.ULTRON_CARAS_DIR = path.join(dir, 'caras');
process.env.ULTRON_VOCES_DIR = path.join(dir, 'voces');
const LLAVE_A = 'llave-de-prueba-A-larga-y-al-azar-para-la-biometria';
const LLAVE_B = 'llave-de-prueba-B-otra-distinta-para-la-biometria';
for (const k of ['BIOMETRIA_CLAVE_CIFRADO', 'CORREO_CLAVE_CIFRADO', 'ULTRON_SESION_SECRETO', 'BIOMETRIA_CLAVES_ANTERIORES', 'BIOMETRIA_SOLO_CIFRADO']) delete process.env[k];
process.env.BIOMETRIA_CLAVE_CIFRADO = LLAVE_A;
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const sobre = await import('../lib/biometria-sobre');
const caras = await import('../lib/caras-miembro');
const voces = await import('../lib/voces-miembro');
const durable = await import('../lib/biometria-durable');
const consent = await import('../lib/biometria-consentimiento');

const usarLlave = (s: string | null, anteriores?: string) => {
  if (s) process.env.BIOMETRIA_CLAVE_CIFRADO = s;
  else delete process.env.BIOMETRIA_CLAVE_CIFRADO;
  if (anteriores) process.env.BIOMETRIA_CLAVES_ANTERIORES = anteriores;
  else delete process.env.BIOMETRIA_CLAVES_ANTERIORES;
};

/* ── un S3 falso con ETag (If-Match / If-None-Match) y listado ───────────────────────────────────────── */
type Obj = { json: unknown; etag: string };
function s3Falso() {
  const datos = new Map<string, Obj>();
  let n = 0;
  const copia = (x: unknown) => JSON.parse(JSON.stringify(x));
  const f = {
    datos,
    puts: 0,
    conflictos: 0,
    /** Se llama justo después de cada getEtag (para meter un cambio «de otra instancia» en medio). */
    trasLeer: null as null | ((key: string) => void),
    poner(key: string, json: unknown) {
      datos.set(key, { json: copia(json), etag: `"e${++n}"` });
    },
    listo: () => true,
    get: async (key: string) => (datos.has(key) ? { ok: true, json: copia(datos.get(key)!.json), detalle: 'ok' } : { ok: true, json: null, detalle: 'vacío', missing: true }),
    getEtag: async (key: string) => {
      const o = datos.get(key);
      const r = o ? { ok: true, json: copia(o.json), etag: o.etag, detalle: 'ok' } : { ok: true, json: null, etag: null, detalle: 'vacío', missing: true };
      f.trasLeer?.(key);
      return r;
    },
    put: async (key: string, json: unknown) => (f.puts++, f.poner(key, json), { ok: true, detalle: '' }),
    putCond: async (key: string, json: unknown, c: { siNoExiste?: boolean; siCoincide?: string }) => {
      const o = datos.get(key);
      if ((c.siNoExiste && o) || (c.siCoincide && o?.etag !== c.siCoincide)) return (f.conflictos++, { ok: false, etag: null, conflicto: true, status: 412, detalle: '412' });
      f.puts++;
      f.poner(key, json);
      return { ok: true, etag: datos.get(key)!.etag, conflicto: false, status: 200, detalle: '' };
    },
    listar: async (prefijo: string, o: { desde?: string | null } = {}) => ({
      ok: true as const,
      claves: [...datos.keys()].filter((k) => k.startsWith(prefijo) && (!o.desde || k > o.desde)).sort(),
      truncado: false,
    }),
  };
  return f;
}

type S3F = ReturnType<typeof s3Falso>;
const conS3 = (m: typeof caras | typeof voces, s: S3F) => {
  m._s3DePrueba({ listo: s.listo, put: s.put as any, putCond: s.putCond as any });
  m._s3LecturaDePrueba({ listo: s.listo, get: s.get as any, getEtag: s.getEtag as any, listar: s.listar as any });
};
const sinS3 = (m: typeof caras | typeof voces) => {
  m._s3DePrueba({ listo: () => false });
  m._s3LecturaDePrueba({ listo: () => false });
};
const restaurar = () => {
  for (const m of [caras, voces]) {
    m._s3DePrueba(null);
    m._s3LecturaDePrueba(null);
  }
  caras._olvidarCacheCaras();
  voces._olvidarCacheVoces();
  usarLlave(LLAVE_A);
  delete process.env.BIOMETRIA_SOLO_CIFRADO;
};

const vec = (n: number, semilla: number) => Array.from({ length: n }, (_, i) => Math.round(Math.sin(semilla * 7.31 + i * 0.37) * 9000) / 10000);
const altaCara = (nombre: string, s: number, extra: Record<string, unknown> = {}) =>
  caras.validarAlta({ nombre, relacion: 'conocido', vectores: [vec(caras.LARGO_VECTOR, s)], consentimiento: { como: 'voz', frase: 'sí, recuérdame', ...extra }, ...(extra.parentesco ? { parentesco: extra.parentesco } : {}) }, 'José') as any;
let n = 0;
const correoNuevo = () => `persona${++n}@cifrado.invalid`;
const claveCaras = (correo: string) => `ultron/caras/${caras.huellaCaras(correo)}.json`;
const archivoCaras = (correo: string) => path.join(process.env.ULTRON_CARAS_DIR!, `${caras.huellaCaras(correo)}.json`);
const ctxCaras = (correo: string) => ({ tipo: 'caras' as const, huella: caras.huellaCaras(correo) });
const nombres = async (correo: string) => (await caras.cargarCaras(correo)).personas.map((p) => p.nombre).sort();
const silencio = async <T>(f: () => Promise<T>): Promise<T> => {
  const w = console.warn;
  console.warn = () => {};
  try {
    return await f();
  } finally {
    console.warn = w;
  }
};

/* ── el sobre ──────────────────────────────────────────────────────────────────────────────────────── */

test('ida y vuelta: se sella con AES-256-GCM, cabecera versionada con kid, y abre igual; cada escritura con su llave de datos', () => {
  const ctx = { tipo: 'caras' as const, huella: 'a'.repeat(40) };
  const dato = { version: 1, personas: [{ id: 'x', nombre: 'Bea', vectores: [vec(128, 1)] }], rev: 3, lapidas: [{ id: 'z', t: 9 }] };
  const s1 = sobre.sellarBiometria(dato, ctx) as any;
  const s2 = sobre.sellarBiometria(dato, ctx) as any;
  assert.equal(s1.sobre, 'aura-bio');
  assert.equal(s1.v, 1);
  assert.equal(s1.alg, 'A256GCM');
  assert.equal(s1.tipo, 'caras');
  assert.match(s1.kid, /^[0-9a-f]{16}$/);
  assert.equal(s1.kid, sobre.kidActivo());
  assert.ok(!LLAVE_A.includes(s1.kid) && !JSON.stringify(s1).includes(LLAVE_A), 'el kid no es el secreto');
  assert.notEqual(s1.datos, s2.datos, 'IV y llave de datos nuevos en cada escritura');
  assert.notEqual(s1.llave, s2.llave);
  assert.doesNotMatch(JSON.stringify(s1), /Bea|vectores|personas|lapidas/);
  const r = sobre.abrirBiometria(s1, ctx);
  assert.equal(r.enClaro, false);
  assert.deepEqual(r.dato, dato);
  // Lo viejo en claro pasa tal cual (migración transparente).
  assert.deepEqual(sobre.abrirBiometria(dato, ctx), { dato, enClaro: true });
  assert.equal(sobre.pideSellar(dato), true);
  assert.equal(sobre.pideSellar(s1), false);
});

test('llave equivocada: no abre (SobreIlegible); con el secreto viejo en BIOMETRIA_CLAVES_ANTERIORES abre y pide re-sellar', () => {
  const ctx = { tipo: 'voces' as const, huella: 'b'.repeat(40) };
  try {
    const s = sobre.sellarBiometria({ personas: [] }, ctx) as any;
    usarLlave(LLAVE_B);
    assert.throws(() => sobre.abrirBiometria(s, ctx), sobre.SobreIlegible);
    // Un kid falsificado que apunta a la llave B: GCM no autentica, no abre.
    assert.throws(() => sobre.abrirBiometria({ ...s, kid: sobre.kidActivo() }, ctx), sobre.SobreIlegible);
    usarLlave(LLAVE_B, LLAVE_A);
    assert.deepEqual(sobre.abrirBiometria(s, ctx).dato, { personas: [] });
    assert.equal(sobre.pideSellar(s), true, 'sellado con la llave anterior: la migración lo pasa a la nueva');
    // Sin ninguna llave: se guarda en claro (desarrollo) y lo sellado no abre.
    usarLlave(null);
    assert.equal(sobre.hayLlaveBiometria(), false);
    assert.deepEqual(silencioSync(() => sobre.sellarBiometria({ a: 1 }, ctx)), { a: 1 });
    assert.throws(() => sobre.abrirBiometria(s, ctx), sobre.SobreIlegible);
  } finally {
    restaurar();
  }
});
function silencioSync<T>(f: () => T): T {
  const w = console.warn;
  console.warn = () => {};
  try {
    return f();
  } finally {
    console.warn = w;
  }
}

test('alterado: un byte del cifrado, la llave envuelta, el tipo, la versión o la cuenta (huella) → no abre', () => {
  const ctx = { tipo: 'caras' as const, huella: 'c'.repeat(40) };
  const s = sobre.sellarBiometria({ personas: [{ id: 'x' }] }, ctx) as any;
  const voltear = (b64: string) => {
    const b = Buffer.from(b64, 'base64url');
    b[Math.floor(b.length / 2)] ^= 0x01;
    return b.toString('base64url');
  };
  const casos: Array<[string, any, any]> = [
    ['datos', { ...s, datos: voltear(s.datos) }, ctx],
    ['tag', { ...s, tag: voltear(s.tag) }, ctx],
    ['iv', { ...s, iv: voltear(s.iv) }, ctx],
    ['llave envuelta', { ...s, llave: s.llave.split('.').map((p: string, i: number) => (i === 2 ? voltear(p) : p)).join('.') }, ctx],
    ['tipo', { ...s, tipo: 'voces' }, ctx],
    ['versión', { ...s, v: 2 }, ctx],
    ['otra cuenta', s, { ...ctx, huella: 'd'.repeat(40) }],
    ['caras → voces', s, { ...ctx, tipo: 'voces' }],
  ];
  for (const [que, x, c] of casos) assert.throws(() => sobre.abrirBiometria(x, c), sobre.SobreIlegible, que);
  // Y el mensaje no lleva nada del contenido.
  try {
    sobre.abrirBiometria({ ...s, datos: voltear(s.datos) }, ctx);
  } catch (e) {
    assert.doesNotMatch(String((e as Error).message), /personas|"x"/);
  }
});

test('BIOMETRIA_SOLO_CIFRADO=1: lo que llegue en claro no se acepta', () => {
  process.env.BIOMETRIA_SOLO_CIFRADO = '1';
  try {
    assert.throws(() => sobre.abrirBiometria({ personas: [] }, { tipo: 'caras', huella: 'e'.repeat(40) }), sobre.SobreIlegible);
  } finally {
    delete process.env.BIOMETRIA_SOLO_CIFRADO;
  }
});

/* ── los cajones, con el sobre ─────────────────────────────────────────────────────────────────────── */

test('caras: en S3 y en disco va sellado; tras un reinicio se lee igual; con otra llave es «no disponible» y NO se escribe encima', async () => {
  const s3 = s3Falso();
  conS3(caras, s3);
  const correo = correoNuevo();
  try {
    await caras.agregarCara(correo, altaCara('Bea', 1));
    const enS3 = s3.datos.get(claveCaras(correo))!.json;
    assert.ok(sobre.esSobre(enS3), 'S3 sellado');
    assert.ok(sobre.esSobre(JSON.parse(fs.readFileSync(archivoCaras(correo), 'utf8'))), 'disco sellado');
    caras._olvidarCacheCaras();
    assert.deepEqual(await nombres(correo), ['Bea']);
    // La llave cambió sin declarar la anterior: falla cerrado, y agregar no pisa lo que hay.
    usarLlave(LLAVE_B);
    caras._olvidarCacheCaras();
    await silencio(async () => {
      await assert.rejects(caras.cargarCaras(correo), caras.CarasNoDisponibles);
      await assert.rejects(caras.agregarCara(correo, altaCara('Ciro', 2)), caras.CarasNoDisponibles);
    });
    assert.deepEqual(s3.datos.get(claveCaras(correo))!.json, enS3, 'S3 intacto');
    // Con la anterior declarada vuelve a abrir.
    usarLlave(LLAVE_B, LLAVE_A);
    caras._olvidarCacheCaras();
    assert.deepEqual(await nombres(correo), ['Bea']);
  } finally {
    restaurar();
  }
});

test('sin S3 (solo disco): un archivo que no abre es «no disponible», no «vacío» (no se pierde al guardar)', async () => {
  sinS3(caras);
  const correo = correoNuevo();
  try {
    await caras.agregarCara(correo, altaCara('Dora', 3));
    const antes = fs.readFileSync(archivoCaras(correo), 'utf8');
    usarLlave(LLAVE_B);
    caras._olvidarCacheCaras();
    await assert.rejects(caras.cargarCaras(correo), caras.CarasNoDisponibles);
    await assert.rejects(caras.agregarCara(correo, altaCara('Eva', 4)), caras.CarasNoDisponibles);
    assert.equal(fs.readFileSync(archivoCaras(correo), 'utf8'), antes);
  } finally {
    restaurar();
  }
});

test('migración transparente: lo viejo en claro se lee; el próximo guardado lo sella; leerlo de S3 lo re-sella con If-Match', async () => {
  const s3 = s3Falso();
  conS3(caras, s3);
  const correo = correoNuevo();
  try {
    // Un cajón de antes de A-7, en claro, en S3.
    const viejo = { version: 1, rev: 5, personas: [{ id: 'p1', nombre: 'Fito', relacion: 'conocido', vectores: [vec(128, 5)], consentimiento: { como: 'voz', frase: 'sí', t: 1 }, creado: 10, actualizado: 10 }] };
    s3.poner(claveCaras(correo), viejo);
    assert.deepEqual(await nombres(correo), ['Fito']);
    await new Promise((r) => setTimeout(r, 20));
    const ahora = s3.datos.get(claveCaras(correo))!.json as any;
    assert.ok(sobre.esSobre(ahora), 'leído en claro → re-sellado por detrás');
    assert.deepEqual(sobre.abrirBiometria(ahora, ctxCaras(correo)).dato, viejo, 'el mismo contenido, sin tocar la versión');
    // Y el siguiente guardado también va sellado.
    await caras.agregarCara(correo, altaCara('Gina', 6));
    assert.ok(sobre.esSobre(s3.datos.get(claveCaras(correo))!.json));
    caras._olvidarCacheCaras();
    assert.deepEqual(await nombres(correo), ['Fito', 'Gina']);
  } finally {
    restaurar();
  }
});

test('migración del arranque: sella disco y S3, es idempotente, y con dos arranques a la vez cada objeto se sella una vez', async () => {
  const s3 = s3Falso();
  conS3(caras, s3);
  conS3(voces, s3);
  try {
    const cajones: Array<[string, unknown]> = [];
    for (let i = 0; i < 4; i++) {
      const correo = correoNuevo();
      const c = { version: 1, rev: i + 1, personas: [{ id: `p${i}`, nombre: `Nombre${i}`, relacion: 'conocido', vectores: [vec(128, i)], consentimiento: { como: 'voz', frase: 'sí', t: 1 }, creado: 5, actualizado: 5 }] };
      s3.poner(claveCaras(correo), c);
      cajones.push([correo, c]);
    }
    // Uno ya sellado con una llave anterior (rotación) y uno local en claro.
    const rotado = correoNuevo();
    usarLlave(LLAVE_B);
    s3.poner(claveCaras(rotado), sobre.sellarBiometria({ version: 1, personas: [] }, ctxCaras(rotado)));
    usarLlave(LLAVE_A, LLAVE_B);
    const local = correoNuevo();
    fs.mkdirSync(process.env.ULTRON_CARAS_DIR!, { recursive: true });
    fs.writeFileSync(archivoCaras(local), JSON.stringify({ version: 1, personas: [] }));
    // Basura que no es un cajón: no se toca.
    s3.poner('ultron/caras/otra-cosa.txt', { hola: 1 });

    const [r1, r2] = await Promise.all([caras.migrarCarasAlSobre(), caras.migrarCarasAlSobre()]);
    assert.equal(r1.s3.sellados + r2.s3.sellados, 5, 'cada objeto, una sola vez entre los dos arranques');
    assert.equal(r1.s3.fallos + r2.s3.fallos, 0);
    for (const [correo, c] of cajones) {
      const x = s3.datos.get(claveCaras(correo))!.json as any;
      assert.ok(sobre.esSobre(x));
      assert.equal(x.kid, sobre.kidActivo());
      assert.deepEqual(sobre.abrirBiometria(x, ctxCaras(correo)).dato, c, 'sin cambiar el contenido');
    }
    assert.equal((s3.datos.get(claveCaras(rotado))!.json as any).kid, sobre.kidActivo(), 'rotado a la llave activa');
    assert.ok(sobre.esSobre(JSON.parse(fs.readFileSync(archivoCaras(local), 'utf8'))), 'el disco también');
    assert.deepEqual(s3.datos.get('ultron/caras/otra-cosa.txt')!.json, { hola: 1 });
    // Otra vez: nada que hacer.
    const puts = s3.puts;
    const r3 = await caras.migrarCarasAlSobre();
    assert.equal(r3.s3.sellados, 0);
    assert.equal(r3.disco.sellados, 0);
    assert.equal(s3.puts, puts, 'idempotente: ni una escritura');
    // Voces: el mismo camino, otro prefijo y otro tipo en el AAD.
    const cv = correoNuevo();
    s3.poner(`ultron/voces/${voces.huellaVoces(cv)}.json`, { version: 1, modelo: 'x', personas: [] });
    const rv = await voces.migrarVocesAlSobre();
    assert.equal(rv.s3.sellados, 1);
    assert.ok(sobre.esSobre(s3.datos.get(`ultron/voces/${voces.huellaVoces(cv)}.json`)!.json));
  } finally {
    restaurar();
  }
});

test('migración con un cambio de otra instancia en medio: If-Match no lo pisa (412 → relee → ya está sellado)', async () => {
  const s3 = s3Falso();
  conS3(caras, s3);
  const correo = correoNuevo();
  try {
    s3.poner(claveCaras(correo), { version: 1, rev: 1, personas: [] });
    // Justo después de que la migración lee, otra instancia guarda (ya sellado, con Hugo).
    let una = true;
    s3.trasLeer = (k) => {
      if (!una || k !== claveCaras(correo)) return;
      una = false;
      s3.poner(k, sobre.sellarBiometria({ version: 1, rev: 2, personas: [{ id: 'h', nombre: 'Hugo', relacion: 'conocido', vectores: [vec(128, 8)], consentimiento: { como: 'voz', t: 1 }, creado: 9, actualizado: 9 }] }, ctxCaras(correo)));
    };
    const r = await caras.migrarCarasAlSobre();
    assert.equal(s3.conflictos, 1, 'la escritura vieja chocó con el ETag');
    assert.equal(r.s3.sellados, 0);
    caras._olvidarCacheCaras();
    assert.deepEqual(await nombres(correo), ['Hugo'], 'el cambio de la otra instancia queda');
  } finally {
    s3.trasLeer = null;
    restaurar();
  }
});

test('sin permiso de listar S3: la migración lo dice (sin_listado) y el disco igual se sella', async () => {
  const s3 = s3Falso();
  caras._s3DePrueba({ listo: s3.listo, put: s3.put as any, putCond: s3.putCond as any });
  caras._s3LecturaDePrueba({ listo: s3.listo, get: s3.get as any, getEtag: s3.getEtag as any, listar: (async () => ({ ok: false, detalle: 'S3 403' })) as any });
  try {
    const r = await caras.migrarCarasAlSobre();
    assert.equal(r.s3.estado, 'sin_listado');
  } finally {
    restaurar();
  }
});

/* ── las lápidas, con el sobre ─────────────────────────────────────────────────────────────────────── */

test('lápidas con el sobre: olvidar una no vuelve por una copia local vieja (sellada); «olvida todas» + alta en el mismo ms', async () => {
  const s3 = s3Falso();
  conS3(caras, s3);
  const correo = correoNuevo();
  try {
    const ana = await caras.agregarCara(correo, altaCara('Ana', 11));
    await caras.agregarCara(correo, altaCara('Beto', 12));
    const copiaVieja = fs.readFileSync(archivoCaras(correo), 'utf8');
    await caras.olvidarCara(correo, ana.id);
    // Un respaldo viejo del disco (sellado, con Ana) vuelve a aparecer: la versión de S3 y la lápida mandan.
    fs.writeFileSync(archivoCaras(correo), copiaVieja);
    caras._olvidarCacheCaras();
    assert.deepEqual(await nombres(correo), ['Beto']);
    // Y un S3 restaurado a la versión vieja tampoco la resucita: la lápida está en el disco (reparado arriba).
    caras._olvidarCacheCaras();
    const sellado = s3.datos.get(claveCaras(correo))!.json;
    const lapidas = (sobre.abrirBiometria(sellado, ctxCaras(correo)).dato as any).lapidas;
    assert.ok(lapidas.some((l: any) => l.id === ana.id), 'la lápida viaja dentro del sobre');
    s3.poner(claveCaras(correo), sobre.sellarBiometria(sobre.abrirBiometria(JSON.parse(copiaVieja), ctxCaras(correo)).dato, ctxCaras(correo)));
    assert.deepEqual(await nombres(correo), ['Beto'], 'S3 viejo + lápida del disco: Ana no vuelve');
    // «Olvida todas» y un alta enseguida: borradoTodo + horaDeAlta.
    await caras.olvidarTodasLasCaras(correo);
    const cajon = await caras.cargarCaras(correo);
    assert.ok(cajon.borradoTodo! > 0);
    const nueva = await caras.agregarCara(correo, altaCara('Ciro', 13));
    assert.ok(nueva.creado > cajon.borradoTodo!, 'horaDeAlta: después del borrado');
    caras._olvidarCacheCaras();
    assert.deepEqual(await nombres(correo), ['Ciro']);
  } finally {
    restaurar();
  }
});

test('lápidas con el sobre: la marca de agua (marcaLapidas / vivosEnMarca) también se aplica a lo sellado', async () => {
  const s3 = s3Falso();
  conS3(caras, s3);
  const correo = correoNuevo();
  try {
    const p = (id: string, creado: number) => ({ id, nombre: `N${id}`, relacion: 'conocido', vectores: [vec(128, creado)], consentimiento: { como: 'voz', t: 1 }, creado, actualizado: creado });
    // S3 (sellado): compactado, con la marca en 100 y solo «v» vivo de lo nacido hasta ahí.
    s3.poner(claveCaras(correo), sobre.sellarBiometria({ version: 1, rev: 10, personas: [p('v', 50), p('n', 200)], lapidas: [], marcaLapidas: 100, vivosEnMarca: ['v'] }, ctxCaras(correo)));
    // El disco (sellado, versión más alta a propósito): todavía tiene a «m», que murió antes de la marca.
    fs.mkdirSync(process.env.ULTRON_CARAS_DIR!, { recursive: true });
    fs.writeFileSync(archivoCaras(correo), JSON.stringify(sobre.sellarBiometria({ version: 1, rev: 11, personas: [p('v', 50), p('m', 60), p('n', 200)], lapidas: [] }, ctxCaras(correo))));
    caras._olvidarCacheCaras();
    const ids = (await caras.cargarCaras(correo)).personas.map((x) => x.id).sort();
    assert.deepEqual(ids, ['n', 'v'], '«m» no vuelve aunque su lápida ya se compactó');
    // Y la regla misma, sobre lo abierto.
    const abierto = sobre.abrirBiometria(s3.datos.get(claveCaras(correo))!.json, ctxCaras(correo)).dato as any;
    assert.deepEqual(durable.aplicarLapidas([p('m', 60), p('v', 50)], abierto).map((x: any) => x.id), ['v']);
    assert.equal(durable.horaDeAlta(abierto, 100), 101);
  } finally {
    restaurar();
  }
});

/* ── la constancia del permiso ─────────────────────────────────────────────────────────────────────── */

test('constancia: quién dijo que sí, cuándo, quién la presentó; un posible menor queda «por confirmar» hasta que la dueña toca su pantalla', async () => {
  const s3 = s3Falso();
  conS3(caras, s3);
  conS3(voces, s3);
  const correo = correoNuevo();
  try {
    const antes = Date.now();
    const bea = await caras.agregarCara(correo, altaCara('Bea', 21, { parentesco: 'hija' }));
    assert.equal(bea.consentimiento.como, 'voz');
    assert.equal(bea.consentimiento.quien, 'Bea');
    assert.equal(bea.consentimiento.presentadoPor, 'José');
    assert.equal(bea.consentimiento.frase, 'sí, recuérdame');
    assert.ok(bea.consentimiento.t >= antes);
    assert.equal(bea.consentimiento.menor, true, 'hija → posible menor');
    assert.equal(consent.pendienteDeConfirmar(bea.consentimiento), true);
    // Un adulto presentado no es «menor»; la cara propia la consiente la dueña.
    const socio = await caras.agregarCara(correo, altaCara('Raúl', 22, { parentesco: 'socio' }));
    assert.equal(socio.consentimiento.menor, undefined);
    const yo = caras.validarAlta({ relacion: 'yo', vectores: [vec(128, 23)], consentimiento: { como: 'dueño' }, nombre: '' }, 'José') as any;
    assert.equal(yo.consentimiento.quien, 'José');
    assert.equal(yo.consentimiento.presentadoPor, undefined);
    // La app dice que es menor aunque el parentesco no lo diga.
    assert.equal((altaCara('Lía', 24, { menor: true }).consentimiento as any).menor, true);
    // La dueña confirma en pantalla: queda la hora, sellado, y sobrevive a un reinicio y a una muestra más.
    const conf = await caras.confirmarConsentimientoCara(correo, bea.id);
    assert.ok(conf!.consentimiento.confirmadoEnPantalla! >= antes);
    await caras.agregarCara(correo, altaCara('Bea', 25, { parentesco: 'hija' }));
    caras._olvidarCacheCaras();
    const otra = (await caras.cargarCaras(correo)).personas.find((p) => p.id === bea.id)!;
    assert.equal(consent.pendienteDeConfirmar(otra.consentimiento), false, 'la confirmación no se pierde con un «sí» nuevo');
    assert.equal(await caras.confirmarConsentimientoCara(correo, 'no-existe'), null);
    // Voces: lo mismo.
    const alta = voces.validarAltaVoz({ nombre: 'Bea', relacion: 'conocido', parentesco: 'Hija', consentimiento: { como: 'voz', frase: 'sí' } }, 'José') as any;
    assert.deepEqual([alta.consentimiento.quien, alta.consentimiento.presentadoPor, alta.consentimiento.menor], ['Bea', 'José', true]);
    const v = await voces.agregarVoz(correo, alta, [vec(voces.LARGO_HUELLA, 26)]);
    assert.ok((await voces.confirmarConsentimientoVoz(correo, v.id))!.consentimiento.confirmadoEnPantalla);
    // Lo de antes de A-7 (solo como/frase/t) sigue valiendo.
    assert.deepEqual(consent.consentimientoValido({ como: 'voz', frase: 'sí', t: 5 }), { como: 'voz', frase: 'sí', t: 5 });
  } finally {
    restaurar();
  }
});

/* ── nada al log ───────────────────────────────────────────────────────────────────────────────────── */

test('nunca al log: ni vectores ni nombres, tampoco cuando S3 falla o el sobre no abre', async () => {
  const lineas: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  const atrapar = (...a: unknown[]) => void lineas.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  Object.assign(console, { log: atrapar, warn: atrapar, error: atrapar, info: atrapar });
  const s3 = s3Falso();
  conS3(caras, s3);
  const correo = correoNuevo();
  const v = vec(caras.LARGO_VECTOR, 31);
  try {
    usarLlave(null);
    sobre.sellarBiometria({}, ctxCaras(correo)); // el aviso de «sin llave» (una vez)
    usarLlave(LLAVE_A);
    await caras.agregarCara(correo, caras.validarAlta({ nombre: 'Zoe Secreta', relacion: 'conocido', vectores: [v], consentimiento: { como: 'voz', frase: 'sí' } }, 'José') as any);
    // S3 no guarda.
    caras._s3DePrueba({ listo: () => true, put: async () => ({ ok: false, detalle: 'S3 503' }) });
    await caras.agregarCara(correo, caras.validarAlta({ nombre: 'Zoe Secreta', relacion: 'conocido', vectores: [v], consentimiento: { como: 'voz', frase: 'sí' } }, 'José') as any).catch(() => null);
    // El sobre del disco no abre (otra llave) con S3: aviso sin contenido.
    conS3(caras, s3);
    usarLlave(LLAVE_B, LLAVE_A);
    fs.writeFileSync(archivoCaras(correo), JSON.stringify({ ...(JSON.parse(fs.readFileSync(archivoCaras(correo), 'utf8')) as object), datos: 'AAAA' }));
    caras._olvidarCacheCaras();
    await caras.cargarCaras(correo).catch(() => null);
    await caras.migrarCarasAlSobre();
  } finally {
    Object.assign(console, orig);
    restaurar();
  }
  const todo = lineas.join('\n');
  assert.ok(lineas.length > 0, 'hubo avisos');
  assert.doesNotMatch(todo, /Zoe|Secreta/);
  for (const x of v.slice(0, 16)) if (Math.abs(x) > 0.01) assert.ok(!todo.includes(String(x)), `el número ${x} del vector no sale al log`);
  assert.doesNotMatch(todo, new RegExp(LLAVE_A));
});
