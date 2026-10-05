/**
 * P4 / A5 (auditoría del 4-oct): buscar un correo por nombre NO confunde una caída con la ausencia de correo.
 *
 * Antes (1bc4ab6), «leer Ana Paz» buscaba en cada cuenta con `.catch(() => [])`: un timeout o una autorización
 * caducada daban el mismo «no encuentro ningún correo de…» (código `referencia`) que una búsqueda vacía válida, y con
 * dos cuentas y una caída se decía «ni buscando en su bandeja» como si se hubieran mirado las dos.
 *
 * Lo que tiene que ser verdad ahora (con `_buzonDePrueba`, sin IMAP, sin red):
 *  · el colector común (`buscarEnCuentas`) devuelve un resultado TIPADO: found / ambiguous / empty / partial /
 *    provider_failed, con la cobertura de cada cuenta (consultada o fallo) y un error seguro (sin el texto crudo del
 *    proveedor, que puede traer usuarios o claves);
 *  · timeout → invita a reintentar; autorización fallida → invita a reconectar ESA cuenta; vacío → «no hay» con la
 *    cobertura de lo mirado; con datos → lo abre;
 *  · dos cuentas y una caída → parcial: dice cuál se consultó y cuál no, no declara ausencia global ni resuelve
 *    homónimos en silencio;
 *  · `revisar` tampoco filtra el texto crudo del proveedor.
 */
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'correo-busqueda-'));
Object.assign(process.env, {
  CORREO_CLAVE_CIFRADO: 'llave-de-prueba-busqueda',
  ULTRON_CORREO_DIR: DIR,
  ULTRON_TAREA_CURSO_DIR: path.join(DIR, 'tarea'),
  ULTRON_ABIERTOS_DIR: path.join(DIR, 'abiertos'),
  ULTRON_MEMORIA_BUCKET: '',
});
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

let intentosRed = 0;
const fetchReal = globalThis.fetch;
globalThis.fetch = (async () => {
  intentosRed++;
  throw new Error('sin red en esta prueba');
}) as typeof fetch;
after(() => {
  globalThis.fetch = fetchReal;
  assert.equal(intentosRed, 0, 'ninguna llamada de red');
});

const C = await import('../server/correo');
const { agregarCuenta, cuentasDe, quitarCuenta, _olvidarCuentas } = await import('../lib/correo/cuentas');
const { resultadoMemorizable } = await import('../lib/recibo-herramienta');

const PROV = { nombre: 'Sintético', imap: { host: 'imap.prueba.invalid', puerto: 993, seguro: true }, smtp: { host: 'smtp.prueba.invalid', puerto: 465, seguro: true }, auth: 'clave', usuario: 'correo', guardaEnviados: false } as any;
const YO = 'lola@prueba.invalid';
/** Lo que un proveedor puede devolver crudo y nunca debe llegar al modelo ni a la pantalla. */
const CRUDO = 'user=lola@prueba.invalid pass=CLAVE-FILTRADA-123';

const timeout = () => Object.assign(new Error(`Synthetic connection timeout ${CRUDO}`), { code: 'ETIMEDOUT' });
const auth = () => Object.assign(new Error(`AUTHENTICATIONFAILED ${CRUDO}`), { code: 'EAUTH', authenticationFailed: true });
const resumen = (cuentaId: string, uid: number, de: string, deCorreo: string, asunto: string) => ({
  ref: `${cuentaId}:${uid}`,
  cuenta: cuentaId,
  de,
  deCorreo,
  asunto,
  fecha: new Date(Date.UTC(2026, 9, 4, 12, uid)).toISOString(),
  noLeido: true,
});
const mensaje = (r: ReturnType<typeof resumen>, texto: string) => ({ ...r, para: YO, cc: '', paraCorreos: [YO], ccCorreos: [], texto, adjuntos: [], messageId: `<m${r.ref}@x>`, referencias: [], responderA: r.deCorreo });

async function soloEstas(...correos: string[]) {
  for (const c of await cuentasDe(YO)) await quitarCuenta(YO, c.id);
  const out = [];
  for (const c of correos) out.push(await agregarCuenta(YO, c, PROV, 'clave-sintetica'));
  return out;
}

beforeEach(() => {
  C._olvidarCorreo();
  _olvidarCuentas();
  C._buzonDePrueba(null);
});
after(() => C._buzonDePrueba(null));

test('una cuenta: timeout, autorización fallida, vacío y con datos se distinguen (verdad y paso siguiente)', async () => {
  const [cta] = await soloEstas('inbox@prueba.invalid');
  let leidos = 0;

  // 1) Timeout: no es «no hay correo»; se dice que no contestó y que se puede reintentar.
  C._buzonDePrueba({ listar: (async () => { throw timeout(); }) as any, leer: (async () => (leidos++, null)) as any });
  const caida = await C.correrCorreoConEstado(YO, 'leer Ana Paz', 'p4');
  assert.equal(caida.estado, 'failed');
  assert.equal(caida.recibo?.codigo, 'proveedor', 'un fallo del proveedor, no una referencia que no existe');
  assert.doesNotMatch(caida.texto, /no encuentro ning[uú]n correo/i);
  assert.match(caida.texto, /no contest[oó] a tiempo/i);
  assert.match(caida.texto, /reintent|otra vez/i);
  assert.match(caida.texto, /inbox@prueba\.invalid/);
  assert.match(caida.texto, /no s[eé] si/i, 'no sabe si el correo existe');
  assert.deepEqual(caida.recibo?.cuentas, [{ cuenta: 'inbox@prueba.invalid', estado: 'fallo', fallo: 'timeout', siguiente: 'reintentar' }]);
  assert.ok(!caida.texto.includes('CLAVE-FILTRADA') && !caida.texto.includes('pass='), 'el texto crudo del proveedor no se filtra');

  // 2) Autorización fallida: reconectar ESA cuenta (en Ajustes → Tus correos).
  C._buzonDePrueba({ listar: (async () => { throw auth(); }) as any });
  const sinPermiso = await C.correrCorreoConEstado(YO, 'leer Ana Paz', 'p4');
  assert.equal(sinPermiso.estado, 'failed');
  assert.equal(sinPermiso.recibo?.codigo, 'proveedor');
  assert.doesNotMatch(sinPermiso.texto, /no encuentro ning[uú]n correo/i);
  assert.match(sinPermiso.texto, /reconect/i);
  assert.match(sinPermiso.texto, /inbox@prueba\.invalid/);
  assert.match(sinPermiso.texto, /Ajustes → Tus correos/);
  assert.doesNotMatch(sinPermiso.texto, /reintent/i, 'reintentar no arregla una autorización caducada');
  assert.deepEqual(sinPermiso.recibo?.cuentas, [{ cuenta: 'inbox@prueba.invalid', estado: 'fallo', fallo: 'auth', siguiente: 'reconectar' }]);
  assert.ok(!sinPermiso.texto.includes('CLAVE-FILTRADA'));

  // 3) Vacío válido: aquí sí «no encuentro», con lo que se miró.
  C._buzonDePrueba({ listar: (async () => []) as any });
  const vacio = await C.correrCorreoConEstado(YO, 'leer Ana Paz', 'p4');
  assert.equal(vacio.estado, 'failed');
  assert.equal(vacio.recibo?.codigo, 'no-encontrado');
  assert.match(vacio.texto, /no encuentro ning[uú]n correo de «ana paz»/i);
  assert.match(vacio.texto, /inbox@prueba\.invalid/, 'dice en qué cuenta buscó');
  assert.deepEqual(vacio.recibo?.cuentas, [{ cuenta: 'inbox@prueba.invalid', estado: 'consultada' }]);

  // 4) Con datos: lo abre.
  const r = resumen(cta.id, 1, 'Ana Paz', 'ana@paz.invalid', 'Auditoría sintética');
  C._buzonDePrueba({ listar: (async () => [r]) as any, leer: (async () => mensaje(r, 'Contenido sintético para el control positivo.')) as any });
  const ok = await C.correrCorreoConEstado(YO, 'leer Ana Paz', 'p4');
  assert.equal(ok.estado, 'succeeded');
  assert.match(ok.texto, /Contenido sintético/);
  assert.equal(resultadoMemorizable(ok), true, 'una búsqueda completa que abrió el correo es un éxito entero');

  // Los cuatro textos son distintos: cada uno dice lo que es cierto.
  assert.equal(new Set([caida.texto, sinPermiso.texto, vacio.texto, ok.texto]).size, 4);
  assert.equal(leidos, 0, 'con el proveedor caído no se abrió nada');
});

test('el colector común devuelve el resultado tipado con la cobertura de cada cuenta y errores seguros', async () => {
  const [a] = await soloEstas('inbox@prueba.invalid');
  const de = (x: string, y: string) => resumen(a.id, x.length, x, y, `Asunto de ${x}`);

  C._buzonDePrueba({ listar: (async () => { throw timeout(); }) as any });
  const t = await C.buscarEnCuentas(YO, 'ana paz');
  assert.equal(t.tipo, 'provider_failed');
  assert.equal(t.cobertura.length, 1);
  assert.equal(t.cobertura[0].estado, 'fallo');
  assert.equal(t.cobertura[0].fallo?.tipo, 'timeout');
  assert.equal(t.cobertura[0].fallo?.siguiente, 'reintentar');
  assert.ok(!JSON.stringify(t).includes('CLAVE-FILTRADA'), 'ni el resultado tipado lleva el texto crudo');

  C._buzonDePrueba({ listar: (async () => { throw auth(); }) as any });
  const au = await C.buscarEnCuentas(YO, 'ana paz');
  assert.equal(au.tipo, 'provider_failed');
  assert.deepEqual([au.cobertura[0].fallo?.tipo, au.cobertura[0].fallo?.siguiente], ['auth', 'reconectar']);
  assert.ok(!JSON.stringify(au).includes('CLAVE-FILTRADA'));

  C._buzonDePrueba({ listar: (async () => []) as any });
  const v = await C.buscarEnCuentas(YO, 'ana paz');
  assert.equal(v.tipo, 'empty');
  assert.deepEqual(v.cobertura.map((x) => [x.cuenta, x.estado]), [['inbox@prueba.invalid', 'consultada']]);

  C._buzonDePrueba({ listar: (async () => [de('Ana Paz', 'ana@paz.invalid')]) as any });
  const f = await C.buscarEnCuentas(YO, 'ana');
  assert.equal(f.tipo, 'found');
  assert.equal(f.tipo === 'found' && f.elegido.deCorreo, 'ana@paz.invalid');

  C._buzonDePrueba({ listar: (async () => [de('Ana Paz', 'ana@paz.invalid'), de('Ana Pérez', 'ana@perez.invalid')]) as any });
  const amb = await C.buscarEnCuentas(YO, 'ana');
  assert.equal(amb.tipo, 'ambiguous');
  assert.equal(amb.hallados.length, 2);
});

test('dos cuentas y una caída: cobertura parcial, sin ausencia global ni homónimos resueltos en silencio', async () => {
  const [casa, trabajo] = await soloEstas('casa@prueba.invalid', 'trabajo@prueba.invalid');
  const leidos: string[] = [];
  const conCasa = (lista: ReturnType<typeof resumen>[]) =>
    C._buzonDePrueba({
      listar: (async (_q: string, c: { id: string }) => {
        if (c.id === trabajo.id) throw timeout();
        return lista;
      }) as any,
      leer: (async (_q: string, c: { id: string }, uid: number) => {
        leidos.push(`${c.id}:${uid}`);
        const r = lista.find((x) => x.ref === `${c.id}:${uid}`);
        return r ? mensaje(r, 'Hola, soy Ana desde casa.') : null;
      }) as any,
    });

  // a) En la que abrió no está; la otra no contestó: NO es «no hay ningún correo de Ana».
  conCasa([]);
  const col = await C.buscarEnCuentas(YO, 'ana paz');
  assert.equal(col.tipo, 'partial');
  assert.deepEqual(
    col.cobertura.map((x) => [x.cuenta, x.estado, x.fallo?.tipo ?? null]),
    [
      ['casa@prueba.invalid', 'consultada', null],
      ['trabajo@prueba.invalid', 'fallo', 'timeout'],
    ],
    'dice cuál se consultó y cuál no; no inventa que se miraron las dos'
  );
  const vacioParcial = await C.correrCorreoConEstado(YO, 'leer Ana Paz', 'p4b');
  assert.equal(vacioParcial.estado, 'failed');
  assert.equal(vacioParcial.recibo?.codigo, 'parcial');
  assert.doesNotMatch(vacioParcial.texto, /ni buscando en su bandeja/, 'no declara ausencia global');
  assert.match(vacioParcial.texto, /casa@prueba\.invalid/);
  assert.match(vacioParcial.texto, /trabajo@prueba\.invalid/);
  assert.match(vacioParcial.texto, /no s[eé] si/i);
  assert.match(vacioParcial.texto, /reintent/i);
  assert.deepEqual(vacioParcial.recibo?.cuentas, [
    { cuenta: 'casa@prueba.invalid', estado: 'consultada' },
    { cuenta: 'trabajo@prueba.invalid', estado: 'fallo', fallo: 'timeout', siguiente: 'reintentar' },
  ]);

  // b) Dos «Ana» distintas en la que abrió: pregunta, y dice que la otra cuenta no se pudo mirar.
  conCasa([resumen(casa.id, 1, 'Ana Paz', 'ana@paz.invalid', 'Factura'), resumen(casa.id, 2, 'Ana Pérez', 'ana@perez.invalid', 'Planos')]);
  const dos = await C.correrCorreoConEstado(YO, 'leer Ana', 'p4b');
  assert.equal(dos.estado, 'failed');
  assert.equal(dos.recibo?.codigo, 'ambiguo');
  assert.match(dos.texto, /no adivines/);
  assert.match(dos.texto, /trabajo@prueba\.invalid/, 'la cuenta que faltó se nombra también aquí');
  assert.equal(leidos.length, 0, 'no abrió ninguna');

  // c) Una sola «Ana» en la que abrió: la abre, pero NO en silencio: dice que en la otra puede haber otra.
  conCasa([resumen(casa.id, 3, 'Ana Paz', 'ana@paz.invalid', 'Factura')]);
  const una = await C.correrCorreoConEstado(YO, 'leer Ana Paz', 'p4b');
  assert.equal(una.estado, 'succeeded');
  assert.match(una.texto, /Hola, soy Ana desde casa/);
  assert.match(una.texto, /trabajo@prueba\.invalid/);
  assert.match(una.texto, /no pude (mirar|revisar|consultar)/i);
  assert.equal(una.recibo?.incompleto, true, 'lo parcial no se memoriza como conclusión');
  assert.equal(resultadoMemorizable(una), false);
});

test('revisar también usa errores seguros: dice qué cuenta y qué hacer, sin el texto crudo del proveedor', async () => {
  await soloEstas('casa@prueba.invalid', 'trabajo@prueba.invalid');
  C._buzonDePrueba({ listar: (async (_q: string, c: { correo: string }) => { throw c.correo.startsWith('casa') ? auth() : timeout(); }) as any });
  const r = await C.correrCorreoConEstado(YO, 'revisar', 'p4c');
  assert.equal(r.estado, 'failed');
  assert.match(r.texto, /no pude abrir ninguna/i);
  assert.match(r.texto, /casa@prueba\.invalid[^;]*reconect/i);
  assert.match(r.texto, /trabajo@prueba\.invalid[^;]*(reintent|otra vez)/i);
  assert.ok(!r.texto.includes('CLAVE-FILTRADA'), 'el texto crudo del proveedor no llega al modelo');
  assert.deepEqual(
    (r.recibo?.cuentas || []).map((x) => [x.cuenta, x.fallo]),
    [
      ['casa@prueba.invalid', 'auth'],
      ['trabajo@prueba.invalid', 'timeout'],
    ]
  );
});
