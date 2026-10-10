/**
 * La REPARACIÓN de S3 (caras y voces) no pisa una copia más nueva con lápida.
 *
 * Reproducción sobre 01a1359: al leer, si S3 quedó atrás (un respaldo restaurado), repararS3 escribía lo fusionado SIN
 * condición. Si entre esa lectura y la escritura otra instancia guardó un cajón más nuevo que olvidaba a Beto, la
 * reparación lo pisaba con el cajón donde Beto seguía vivo: Beto, borrado, VOLVÍA. Contrato: escritura condicional
 * (ETag), en conflicto se relee, se fusionan las lápidas y se reintenta (acotado); nunca se pierde una lápida.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biometria-reparar-'));
process.env.ULTRON_CARAS_DIR = path.join(dir, 'caras');
process.env.ULTRON_VOCES_DIR = path.join(dir, 'voces');
process.env.ULTRON_MEMORIA_BUCKET = '';
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const caras: Record<string, any> = await import('../lib/caras-miembro');
const voces: Record<string, any> = await import('../lib/voces-miembro');

/** S3 falso con ETag; `antesDeEscribir` corre UNA vez, justo antes de la próxima escritura (otra instancia que se cuela). */
const s3 = { datos: new Map<string, unknown>(), etags: new Map<string, string>(), n: 0, antesDeEscribir: null as null | (() => void), escrituras: 0 };
const copia = (x: unknown) => JSON.parse(JSON.stringify(x));
const poner = (k: string, j: unknown) => {
  s3.datos.set(k, copia(j));
  s3.etags.set(k, `"e${++s3.n}"`);
};
const colarse = () => {
  const f = s3.antesDeEscribir;
  s3.antesDeEscribir = null;
  f?.();
};
const get = async (k: string) => (s3.datos.has(k) ? { ok: true, json: copia(s3.datos.get(k)), detalle: '' } : { ok: true, json: null, detalle: 'vacío', missing: true });
const getEtag = async (k: string) => ({ ...(await get(k)), etag: s3.etags.get(k) || null });
const put = async (k: string, j: unknown) => {
  colarse();
  s3.escrituras++;
  poner(k, j);
  return { ok: true, detalle: '' };
};
const putCond = async (k: string, j: unknown, cond: { siNoExiste?: boolean; siCoincide?: string }) => {
  colarse();
  s3.escrituras++;
  if ((cond.siNoExiste && s3.datos.has(k)) || (cond.siCoincide && s3.etags.get(k) !== cond.siCoincide)) return { ok: false, etag: null, conflicto: true, status: 412, detalle: 'S3 412' };
  poner(k, j);
  return { ok: true, etag: s3.etags.get(k), conflicto: false, status: 200, detalle: 'ok' };
};

const vec = (n: number, semilla: number) => Array.from({ length: n }, (_, i) => Math.round(Math.sin(semilla * 7.31 + i * 0.37) * 9000) / 10000);
const permiso = { como: 'voz', frase: 'sí, recuérdame' };
const TIPOS = [
  {
    nombre: 'caras',
    m: caras,
    archivo: (c: string) => path.join(process.env.ULTRON_CARAS_DIR!, `${caras.huellaCaras(c)}.json`),
    agregar: (c: string, nombre: string, s: number) => caras.agregarCara(c, caras.validarAlta({ nombre, relacion: 'conocido', vectores: [vec(caras.LARGO_VECTOR, s)], consentimiento: permiso }, 'Dueña')),
    olvidar: (c: string, id: string) => caras.olvidarCara(c, id),
    cargar: (c: string) => caras.cargarCaras(c),
    olvidarCache: () => caras._olvidarCacheCaras(),
  },
  {
    nombre: 'voces',
    m: voces,
    archivo: (c: string) => path.join(process.env.ULTRON_VOCES_DIR!, `${voces.huellaVoces(c)}.json`),
    agregar: (c: string, nombre: string, s: number) => voces.agregarVoz(c, voces.validarAltaVoz({ nombre, relacion: 'conocido', consentimiento: permiso }, 'Dueña'), [vec(voces.LARGO_HUELLA, s)]),
    olvidar: (c: string, id: string) => voces.olvidarVoz(c, id),
    cargar: (c: string) => voces.cargarVoces(c),
    olvidarCache: () => voces._olvidarCacheVoces(),
  },
];

let n = 0;
for (const t of TIPOS) {
  test(`${t.nombre}: la reparación de S3 no resucita a Beto si otra instancia lo olvidó entre la lectura y la escritura`, async () => {
    s3.datos.clear();
    s3.etags.clear();
    s3.antesDeEscribir = null;
    t.m._s3DePrueba({ listo: () => true, put, putCond });
    t.m._s3LecturaDePrueba({ listo: () => true, get, getEtag });
    t.olvidarCache();
    const correo = `reparar${++n}.${t.nombre}@prueba.invalid`;
    try {
      const ana = await t.agregar(correo, 'Ana', 1);
      const beto = await t.agregar(correo, 'Beto', 2);
      const [clave] = [...s3.datos.keys()];
      const respaldo = copia(s3.datos.get(clave)); // Ana y Beto, versión vieja
      await t.olvidar(correo, ana.id);
      const discoTrasAna = fs.readFileSync(t.archivo(correo), 'utf8'); // esta instancia: Beto vivo, lápida de Ana
      await t.olvidar(correo, beto.id);
      const deLaOtra = copia(s3.datos.get(clave)); // la otra instancia: versión más nueva, lápidas de Ana y Beto
      // Esta instancia se quedó con su disco de antes; a S3 le restauraron el respaldo viejo.
      fs.writeFileSync(t.archivo(correo), discoTrasAna);
      poner(clave, respaldo);
      t.olvidarCache();
      // La otra instancia guarda lo suyo justo entre la lectura de la reparación y su escritura.
      s3.antesDeEscribir = () => poner(clave, deLaOtra);
      s3.escrituras = 0;
      assert.deepEqual((await t.cargar(correo)).personas.map((p: any) => p.nombre), ['Beto'], 'lo que esta instancia sabía');
      await new Promise((r) => setTimeout(r, 30));
      assert.ok(s3.escrituras >= 1, 'la reparación intentó escribir');
      assert.equal(s3.antesDeEscribir, null, 'la otra instancia se coló');
      assert.equal(JSON.stringify(s3.datos.get(clave)).includes('"Beto"'), false, 'S3 no volvió a tener a Beto');
      const lapidas = ((s3.datos.get(clave) as any)?.lapidas || []).map((l: any) => l.id);
      assert.ok(lapidas.includes(beto.id) && lapidas.includes(ana.id), 'las dos lápidas siguen en S3');
      t.olvidarCache();
      assert.deepEqual((await t.cargar(correo)).personas.map((p: any) => p.nombre), [], 'Beto no vuelve');
    } finally {
      t.m._s3DePrueba(null);
      t.m._s3LecturaDePrueba(null);
    }
  });
}
