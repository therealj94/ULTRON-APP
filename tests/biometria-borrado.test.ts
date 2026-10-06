/**
 * SEC-03 · Borrar una cara o una voz no puede «volver» por una copia local vieja.
 *
 * Reproducción sobre 5754c78 (caras y voces): guardar a Ana y a Beto; al olvidar a Ana, S3 acepta el cajón nuevo pero la
 * escritura LOCAL falla; la operación resolvía «ok». Tras recargar (caché vacía, como tras un reinicio) se leía primero
 * el disco —la copia vieja, con Ana— y Ana reaparecía.
 *
 * Contrato (lib/biometria-durable.ts): versión + lápidas + precedencia de la supresión; una copia vieja (disco que no se
 * pudo escribir, crash entre escrituras, respaldo restaurado en S3) nunca resucita a nadie; una escritura local fallida
 * es un estado DEGRADADO explícito (no «borrado completo»); con S3 caído al leer no se expone el disco solo; sin S3, un
 * disco que no guarda es un borrado que no ocurrió. Todo con S3 y disco falsos, en carpetas temporales.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biometria-borrado-'));
process.env.ULTRON_CARAS_DIR = path.join(dir, 'caras');
process.env.ULTRON_VOCES_DIR = path.join(dir, 'voces');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const caras: Record<string, any> = await import('../lib/caras-miembro');
const voces: Record<string, any> = await import('../lib/voces-miembro');
const D: Record<string, any> = await import('../lib/biometria-durable').catch(() => ({}));

/** S3 falso compartido: un mapa de claves. `caido` hace fallar lecturas y/o escrituras. */
const s3 = { datos: new Map<string, unknown>(), leerCae: false, ponerCae: false };
const s3Put = async (k: string, j: unknown) => (s3.ponerCae ? { ok: false, detalle: 'S3 503' } : (s3.datos.set(k, JSON.parse(JSON.stringify(j))), { ok: true, detalle: '' }));
const s3Get = async (k: string) =>
  s3.leerCae ? { ok: false, json: null, detalle: 'S3 503', missing: false } : s3.datos.has(k) ? { ok: true, json: JSON.parse(JSON.stringify(s3.datos.get(k))), detalle: '' } : { ok: true, json: null, detalle: 'vacío', missing: true };

const vec = (n: number, semilla: number) => Array.from({ length: n }, (_, i) => Math.round(Math.sin(semilla * 7.31 + i * 0.37) * 9000) / 10000);

type Tipo = {
  nombre: 'caras' | 'voces';
  m: Record<string, any>;
  archivo: (correo: string) => string;
  agregar: (correo: string, nombre: string, semilla: number) => Promise<{ id: string }>;
  olvidar: (correo: string, id: string) => Promise<unknown>;
  olvidarTodas: (correo: string) => Promise<unknown>;
  cargar: (correo: string) => Promise<{ personas: Array<{ id: string; nombre: string }> }>;
  olvidarCache: () => void;
  noGuardadas: any;
  noDisponibles: any;
};
const TIPOS: Tipo[] = [
  {
    nombre: 'caras',
    m: caras,
    archivo: (c) => path.join(process.env.ULTRON_CARAS_DIR!, `${caras.huellaCaras(c)}.json`),
    agregar: (c, nombre, s) => caras.agregarCara(c, caras.validarAlta({ nombre, relacion: 'conocido', vectores: [vec(caras.LARGO_VECTOR, s)], consentimiento: { como: 'voz', frase: 'sí, recuérdame' } }, 'Dueña')),
    olvidar: (c, id) => caras.olvidarCara(c, id),
    olvidarTodas: (c) => caras.olvidarTodasLasCaras(c),
    cargar: (c) => caras.cargarCaras(c),
    olvidarCache: () => caras._olvidarCacheCaras(),
    noGuardadas: caras.CarasNoGuardadas,
    noDisponibles: caras.CarasNoDisponibles,
  },
  {
    nombre: 'voces',
    m: voces,
    archivo: (c) => path.join(process.env.ULTRON_VOCES_DIR!, `${voces.huellaVoces(c)}.json`),
    agregar: (c, nombre, s) => voces.agregarVoz(c, voces.validarAltaVoz({ nombre, relacion: 'conocido', consentimiento: { como: 'voz', frase: 'sí, recuérdame' } }, 'Dueña'), [vec(voces.LARGO_HUELLA, s)]),
    olvidar: (c, id) => voces.olvidarVoz(c, id),
    olvidarTodas: (c) => voces.olvidarTodasLasVoces(c),
    cargar: (c) => voces.cargarVoces(c),
    olvidarCache: () => voces._olvidarCacheVoces(),
    noGuardadas: voces.VocesNoGuardadas,
    noDisponibles: voces.VocesNoDisponibles,
  },
];

let n = 0;
function preparar(t: Tipo, o: { s3?: boolean } = {}) {
  s3.datos.clear();
  s3.leerCae = false;
  s3.ponerCae = false;
  const conS3 = o.s3 ?? true;
  t.m._s3DePrueba(conS3 ? { listo: () => true, put: s3Put } : { listo: () => false });
  t.m._s3LecturaDePrueba?.(conS3 ? { listo: () => true, get: s3Get } : { listo: () => false });
  D._discoBiometriaDePrueba?.(null);
  t.olvidarCache();
  return `persona${++n}.${t.nombre}@prueba.invalid`;
}
function limpiar(t: Tipo) {
  t.m._s3DePrueba(null);
  t.m._s3LecturaDePrueba?.(null);
  D._discoBiometriaDePrueba?.(null);
}
const nombres = async (t: Tipo, correo: string) => (await t.cargar(correo)).personas.map((p) => p.nombre).sort();
const silencio = async <T>(f: () => Promise<T>): Promise<T> => {
  const w = console.warn;
  console.warn = () => {};
  try {
    return await f();
  } finally {
    console.warn = w;
  }
};

for (const t of TIPOS) {
  test(`SEC-03 ${t.nombre}: S3 acepta y el disco NO se puede escribir (archivo temporal bloqueado) → tras recargar, Ana no vuelve`, async () => {
    const correo = preparar(t);
    try {
      const ana = await t.agregar(correo, 'Ana', 1);
      await t.agregar(correo, 'Beto', 2);
      const f = t.archivo(correo);
      assert.ok(fs.readFileSync(f, 'utf8').includes('Ana'));
      // El disco falla de verdad: donde va el temporal hay una carpeta (EISDIR al escribir).
      fs.mkdirSync(`${f}.tmp`, { recursive: true });
      await silencio(() => t.olvidar(correo, ana.id).catch(() => null));
      // Caché vacía (caché vieja / reinicio): manda la versión más nueva (S3) y la lápida.
      t.olvidarCache();
      assert.deepEqual(await nombres(t, correo), ['Beto'], 'Ana no resucita por la copia local');
      fs.rmSync(`${f}.tmp`, { recursive: true, force: true });
      t.olvidarCache();
      assert.deepEqual(await nombres(t, correo), ['Beto'], 'y la copia se repara sin ella');
    } finally {
      limpiar(t);
    }
  });

  test(`SEC-03 ${t.nombre}: si la copia local vieja no se puede ni reescribir ni quitar, el borrado es DEGRADADO (no «ok») y aun así no resucita`, async () => {
    const correo = preparar(t);
    try {
      const ana = await t.agregar(correo, 'Ana', 3);
      await t.agregar(correo, 'Beto', 4);
      const f = t.archivo(correo);
      assert.equal(typeof D._discoBiometriaDePrueba, 'function', 'el disco es inyectable');
      D._discoBiometriaDePrueba({
        writeFileSync: () => {
          throw Object.assign(new Error('EIO: disco roto'), { code: 'EIO' });
        },
        unlinkSync: () => {
          throw Object.assign(new Error('EROFS'), { code: 'EROFS' });
        },
      });
      const e = await silencio(() => t.olvidar(correo, ana.id).then(() => null, (x) => x));
      assert.ok(e instanceof D.BorradoDegradado, `no resuelve como borrado completo: ${e}`);
      assert.equal((e.resultado as any)?.nombre, 'Ana');
      assert.ok(t.m.copiaLocalDegradada(correo), 'queda anotado el estado degradado');
      assert.ok(fs.readFileSync(f, 'utf8').includes('Ana'), 'la copia local vieja sigue ahí (por eso es degradado)');
      // La caché y S3 ya no la tienen; tras recargar tampoco (S3 más nuevo + lápida).
      assert.deepEqual(await nombres(t, correo), ['Beto']);
      t.olvidarCache();
      D._discoBiometriaDePrueba(null);
      assert.deepEqual(await nombres(t, correo), ['Beto'], 'tras reiniciar, la precedencia se aplica antes de exponer nada');
      assert.equal(fs.readFileSync(f, 'utf8').includes('Ana'), false, 'y la copia local se reparó');
    } finally {
      limpiar(t);
    }
  });

  test(`SEC-03 ${t.nombre}: crash entre escrituras (S3 nuevo, disco viejo) y reinicio → la versión más nueva gana`, async () => {
    const correo = preparar(t);
    try {
      const ana = await t.agregar(correo, 'Ana', 5);
      await t.agregar(correo, 'Beto', 6);
      const f = t.archivo(correo);
      const viejo = fs.readFileSync(f, 'utf8');
      await t.olvidar(correo, ana.id);
      // Como si el proceso hubiera muerto después de S3 y antes del disco: el disco queda con la versión de antes.
      fs.writeFileSync(f, viejo);
      t.olvidarCache();
      assert.deepEqual(await nombres(t, correo), ['Beto']);
    } finally {
      limpiar(t);
    }
  });

  test(`SEC-03 ${t.nombre}: un respaldo VIEJO restaurado en S3 no resucita a Ana (lápida del disco) y S3 se repara`, async () => {
    const correo = preparar(t);
    try {
      const ana = await t.agregar(correo, 'Ana', 7);
      await t.agregar(correo, 'Beto', 8);
      const [clave] = [...s3.datos.keys()];
      const respaldo = JSON.parse(JSON.stringify(s3.datos.get(clave)));
      await t.olvidar(correo, ana.id);
      s3.datos.set(clave, respaldo);
      t.olvidarCache();
      assert.deepEqual(await nombres(t, correo), ['Beto']);
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(JSON.stringify(s3.datos.get(clave)).includes('"Ana"'), false, 'S3 quedó con la versión fusionada');
    } finally {
      limpiar(t);
    }
  });

  test(`SEC-03 ${t.nombre}: S3 caído al borrar → no se confirma y Ana sigue (honesto); al volver S3, se borra de verdad`, async () => {
    const correo = preparar(t);
    try {
      const ana = await t.agregar(correo, 'Ana', 9);
      s3.ponerCae = true;
      await assert.rejects(silencio(() => t.olvidar(correo, ana.id)) as Promise<unknown>, (e: unknown) => e instanceof t.noGuardadas);
      t.olvidarCache();
      assert.deepEqual(await nombres(t, correo), ['Ana'], 'no se dijo que se borró, y no se borró');
      s3.ponerCae = false;
      await t.olvidar(correo, ana.id);
      t.olvidarCache();
      assert.deepEqual(await nombres(t, correo), []);
    } finally {
      limpiar(t);
    }
  });

  test(`SEC-03 ${t.nombre}: S3 caído al LEER tras un borrado degradado → «no disponible», nunca la copia local vieja`, async () => {
    const correo = preparar(t);
    try {
      const ana = await t.agregar(correo, 'Ana', 10);
      D._discoBiometriaDePrueba?.({
        writeFileSync: () => {
          throw new Error('EIO');
        },
        unlinkSync: () => {
          throw new Error('EROFS');
        },
      });
      await silencio(() => t.olvidar(correo, ana.id).catch(() => null));
      D._discoBiometriaDePrueba?.(null);
      t.olvidarCache();
      s3.leerCae = true;
      await assert.rejects(t.cargar(correo), (e: unknown) => e instanceof t.noDisponibles);
    } finally {
      limpiar(t);
    }
  });

  test(`SEC-03 ${t.nombre}: «olvida todas» con el disco roto y reinicio → ninguna vuelve`, async () => {
    const correo = preparar(t);
    try {
      await t.agregar(correo, 'Ana', 11);
      await t.agregar(correo, 'Beto', 12);
      fs.mkdirSync(`${t.archivo(correo)}.tmp`, { recursive: true });
      D._discoBiometriaDePrueba?.({
        unlinkSync: () => {
          throw new Error('EROFS');
        },
      });
      await silencio(() => t.olvidarTodas(correo).catch(() => null));
      D._discoBiometriaDePrueba?.(null);
      fs.rmSync(`${t.archivo(correo)}.tmp`, { recursive: true, force: true });
      t.olvidarCache();
      assert.deepEqual(await nombres(t, correo), []);
      // Y alguien nuevo después del «olvida todas» sí se guarda.
      await t.agregar(correo, 'Carla', 13);
      t.olvidarCache();
      assert.deepEqual(await nombres(t, correo), ['Carla']);
    } finally {
      limpiar(t);
    }
  });

  test(`SEC-03 ${t.nombre}: SIN S3 (solo disco), un disco que no guarda el borrado es un error, no un «ok» que se deshace al reiniciar`, async () => {
    const correo = preparar(t, { s3: false });
    try {
      const ana = await t.agregar(correo, 'Ana', 14);
      fs.mkdirSync(`${t.archivo(correo)}.tmp`, { recursive: true });
      D._discoBiometriaDePrueba?.({
        unlinkSync: () => {
          throw new Error('EROFS');
        },
      });
      const e = await silencio(() => t.olvidar(correo, ana.id).then(() => null, (x) => x));
      assert.ok(e instanceof t.noGuardadas, `debía decir que no se guardó: ${e}`);
      D._discoBiometriaDePrueba?.(null);
      fs.rmSync(`${t.archivo(correo)}.tmp`, { recursive: true, force: true });
      t.olvidarCache();
      assert.deepEqual(await nombres(t, correo), ['Ana'], 'lo que se dijo (no se borró) es lo que hay');
      await t.olvidar(correo, ana.id);
      t.olvidarCache();
      assert.deepEqual(await nombres(t, correo), []);
    } finally {
      limpiar(t);
    }
  });
}

/* ── con el camino de dos instancias (revisión 7 M3): lectura con ETag y guardado con If-Match / If-None-Match ── */

const etags = new Map<string, string>();
let nEtag = 0;
const s3GetEtag = async (k: string) => {
  const r = await s3Get(k);
  return { ...r, etag: s3.datos.has(k) ? etags.get(k) || null : null };
};
const s3PutCond = async (k: string, j: unknown, cond: { siNoExiste?: boolean; siCoincide?: string }) => {
  if (s3.ponerCae) return { ok: false, etag: null, conflicto: false, status: 503, detalle: 'S3 503' };
  if ((cond.siNoExiste && s3.datos.has(k)) || (cond.siCoincide && etags.get(k) !== cond.siCoincide)) return { ok: false, etag: null, conflicto: true, status: 412, detalle: 'S3 412' };
  s3.datos.set(k, JSON.parse(JSON.stringify(j)));
  const etag = `"e${++nEtag}"`;
  etags.set(k, etag);
  return { ok: true, etag, conflicto: false, status: 200, detalle: 'ok' };
};
function conCAS(t: Tipo) {
  const correo = preparar(t);
  etags.clear();
  t.m._s3DePrueba({ listo: () => true, put: async (k: string, j: unknown) => { const r = await s3Put(k, j); if (r.ok) etags.set(k, `"e${++nEtag}"`); return r; }, putCond: s3PutCond });
  t.m._s3LecturaDePrueba({ listo: () => true, get: s3Get, getEtag: s3GetEtag });
  return correo;
}

for (const t of TIPOS) {
  test(`SEC-03 + M3 ${t.nombre}: con ETag, el borrado con la copia local atascada es DEGRADADO y no resucita al recargar`, async () => {
    const correo = conCAS(t);
    try {
      const ana = await t.agregar(correo, 'Ana', 30);
      await t.agregar(correo, 'Beto', 31);
      D._discoBiometriaDePrueba({
        writeFileSync: () => {
          throw new Error('EIO');
        },
        unlinkSync: () => {
          throw new Error('EROFS');
        },
      });
      const e = await silencio(() => t.olvidar(correo, ana.id).then(() => null, (x) => x));
      assert.ok(e instanceof D.BorradoDegradado, String(e));
      D._discoBiometriaDePrueba(null);
      t.olvidarCache();
      assert.deepEqual(await nombres(t, correo), ['Beto']);
    } finally {
      limpiar(t);
    }
  });

  test(`SEC-03 + M3 ${t.nombre}: un respaldo viejo restaurado en S3 y un cambio después (con ETag) no resucitan a Ana`, async () => {
    const correo = conCAS(t);
    try {
      const ana = await t.agregar(correo, 'Ana', 32);
      await t.agregar(correo, 'Beto', 33);
      const [clave] = [...s3.datos.keys()];
      const respaldo = JSON.parse(JSON.stringify(s3.datos.get(clave)));
      await t.olvidar(correo, ana.id);
      s3.datos.set(clave, respaldo);
      etags.set(clave, '"restaurado"');
      t.olvidarCache();
      // Un cambio partiendo de lo restaurado: lee S3 (con Ana) + la lápida del disco, y guarda sin Ana.
      await t.agregar(correo, 'Carla', 34);
      t.olvidarCache();
      assert.deepEqual(await nombres(t, correo), ['Beto', 'Carla']);
      assert.equal(JSON.stringify(s3.datos.get(clave)).includes('"Ana"'), false);
    } finally {
      limpiar(t);
    }
  });

  test(`SEC-03 + M3 ${t.nombre}: con S3 configurado y caído, ni leer ni cambiar usan el disco solo (falla cerrado)`, async () => {
    const correo = conCAS(t);
    try {
      await t.agregar(correo, 'Ana', 35);
      t.olvidarCache();
      s3.leerCae = true;
      await assert.rejects(t.cargar(correo), (e: unknown) => e instanceof t.noDisponibles);
      await assert.rejects(t.agregar(correo, 'Beto', 36), (e: unknown) => e instanceof t.noDisponibles);
    } finally {
      limpiar(t);
    }
  });
}

test('SEC-03 rutas: DELETE /api/caras/:id y /api/voces/:id con la copia local atascada → 202 completo:false (no «borrada»)', async () => {
  const express = (await import('express')).default;
  const { montarRutasCaras } = await import('../server/caras-rutas');
  const { montarRutasVoces } = await import('../server/voces-rutas');
  for (const t of TIPOS) {
    const correo = preparar(t);
    try {
      const p = await t.agregar(correo, 'Ana', 20);
      const app = express();
      app.use(express.json());
      const pasa = ((_q: unknown, _r: unknown, sigue: () => void) => sigue()) as any;
      const deps = { exigirMesa: pasa, limitar: () => pasa, sesionDe: () => ({ correo, nombre: 'Dueña', rol: 'Junta', token: 't', at: Date.now() }) as any };
      (t.nombre === 'caras' ? montarRutasCaras : montarRutasVoces)(app, deps);
      const srv = app.listen(0, '127.0.0.1');
      await new Promise((r) => srv.once('listening', r));
      try {
        D._discoBiometriaDePrueba?.({
          writeFileSync: () => {
            throw new Error('EIO');
          },
          unlinkSync: () => {
            throw new Error('EROFS');
          },
        });
        const r = await silencio(() => fetch(`http://127.0.0.1:${(srv.address() as { port: number }).port}/api/${t.nombre}/${p.id}`, { method: 'DELETE' }));
        const j = (await r.json()) as any;
        assert.equal(r.status, 202, `${t.nombre}: ${JSON.stringify(j)}`);
        assert.equal(j.completo, false);
        assert.equal(j.pendiente, 'copia_local');
        assert.equal(j.nombre, 'Ana');
      } finally {
        srv.close();
      }
    } finally {
      limpiar(t);
    }
  }
});

test('SEC-03: fusionarCopias — gana la versión más alta y las lápidas de las dos copias se aplican siempre', () => {
  assert.equal(typeof D.fusionarCopias, 'function');
  const P = (id: string, creado = 1) => ({ id, nombre: id, creado });
  const viejo = { version: 1, rev: 5, personas: [P('a'), P('b')], lapidas: [] };
  const nuevo = { version: 1, rev: 9, personas: [P('b')], lapidas: [{ id: 'a', t: 100 }] };
  assert.deepEqual(D.fusionarCopias(viejo, nuevo).cajon.personas.map((p: any) => p.id), ['b']);
  assert.deepEqual(D.fusionarCopias(nuevo, viejo).cajon.personas.map((p: any) => p.id), ['b'], 'en cualquier orden');
  // Una copia con rev más alta pero SIN la lápida no devuelve a «a».
  const rara = { version: 1, rev: 20, personas: [P('a'), P('b')], lapidas: [] };
  assert.deepEqual(D.fusionarCopias(rara, nuevo).cajon.personas.map((p: any) => p.id), ['b']);
  // «olvida todas» a las 50: lo creado antes muere; lo de después vive.
  const todo = { version: 1, rev: 30, personas: [P('c', 60)], lapidas: [], borradoTodo: 50 };
  assert.deepEqual(D.fusionarCopias(rara, todo).cajon.personas.map((p: any) => p.id), ['c']);
});

/*
 * Revisión 9 (MENOR 6): las lápidas tenían tope (MAX_LAPIDAS) y la más vieja se PERDÍA: pasado el tope, una copia vieja
 * (otra instancia, un respaldo) con esa persona la devolvía. Ahora lo que sale del tope queda en una marca de agua.
 */
test('revisión 9: pasado el tope de lápidas, la persona olvidada primero NO vuelve desde una copia vieja (marca de agua); los vivos siguen', () => {
  assert.equal(typeof D.compactarLapidas, 'function');
  const P = (id: string, creado: number) => ({ id, nombre: id, creado });
  let c: any = { version: 1, rev: 1, personas: [P('vieja-viva', 1), P('x0', 2)], lapidas: [] };
  // Se olvida a x0 (la primera lápida) y después a MAX_LAPIDAS + 100 personas más.
  c = D.siguiente(c, { version: 1, personas: [P('vieja-viva', 1)], lapidas: D.conLapidas(c, ['x0'], 10) });
  for (let i = 0; i < D.MAX_LAPIDAS + 100; i++) c = D.siguiente(c, { version: 1, personas: c.personas, lapidas: D.conLapidas(c, [`m${i}`], 11 + i) });
  assert.ok(c.lapidas.length <= D.MAX_LAPIDAS, 'las lápidas por id siguen acotadas');
  assert.ok(!c.lapidas.some((l: any) => l.id === 'x0'), 'la de x0 salió del tope');
  assert.ok(c.marcaLapidas >= 10, 'quedó en la marca de agua');
  assert.deepEqual(c.vivosEnMarca, ['vieja-viva'], 'solo ids de quien sigue vivo (nada biométrico)');
  // Una copia con versión más alta pero vieja de contenido (una instancia atrasada, un respaldo) trae a x0 sin su lápida.
  const ahora = Date.now();
  const rara = { version: 1, rev: c.rev + 1_000_000, personas: [P('vieja-viva', 1), P('x0', 2), P('m3', 14), P('nueva', ahora)], lapidas: [] };
  const f = D.fusionarCopias(rara, c).cajon;
  assert.deepEqual(f.personas.map((p: any) => p.id), ['vieja-viva', 'nueva'], 'x0 (y m3) no resucitan; la de antes y la nueva siguen');
  assert.deepEqual(D.fusionarCopias(c, rara).cajon.personas.map((p: any) => p.id), ['vieja-viva', 'nueva'], 'en cualquier orden');
  // La marca viaja en el JSON guardado (sanear) y se aplica a una copia sola.
  const leido = D.sanearDurable(JSON.parse(JSON.stringify(c)));
  assert.deepEqual(D.aplicarLapidas(rara.personas, leido).map((p: any) => p.id), ['vieja-viva', 'nueva']);
  // Y se conserva al seguir guardando (otra persona nueva, otra lápida).
  const d = D.siguiente(f, { version: 1, personas: [...f.personas, P('otra', ahora + 1)], lapidas: D.conLapidas(f, ['m-final'], ahora) });
  assert.ok(d.marcaLapidas >= c.marcaLapidas && d.lapidas.length <= D.MAX_LAPIDAS);
  assert.deepEqual(D.aplicarLapidas([...rara.personas, P('otra', ahora + 1)], d).map((p: any) => p.id), ['vieja-viva', 'nueva', 'otra']);
});
