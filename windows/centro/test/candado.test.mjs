/**
 * EL CANDADO DEL CENTRO CONTRA EL DEL TELÉFONO, byte por byte.
 *
 * Se empaquetan los dos tal cual (`mobile/src/pulse/candado.ts` con Expo imitado, y
 * `windows/centro/src/pulse/candado.ts` con su cajón en memoria) y se cruzan: lo que cierra uno lo abre
 * el otro, las firmas de uno se verifican en el otro, y los ids de aparato, el base64url, el saneo de
 * texto y el código de seguridad salen idénticos. Cada empaque es un aparato distinto (su propio par).
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { armar, CENTRO, MOVIL } from './ayudas.mjs';

let movil; // el candado del teléfono
let centro; // el candado del Centro
let otroCentro; // un segundo equipo con el candado del Centro (otro par)
let apMovil; // { id, pub, fir } publicados del teléfono
let apCentro;
let apOtro;

const entradaCentro = {
  codigo: "export * from './candado'; export { ponerAlmacen, almacenEnMemoria } from './secretos';",
  carpeta: join(CENTRO, 'src', 'pulse'),
};

before(async () => {
  movil = await armar(join(MOVIL, 'src', 'pulse', 'candado.ts'));
  centro = await armar(entradaCentro);
  otroCentro = await armar(entradaCentro);
  centro.ponerAlmacen(centro.almacenEnMemoria());
  otroCentro.ponerAlmacen(otroCentro.almacenEnMemoria());
  const m = await movil.miLlave();
  const c = await centro.miLlave();
  const o = await otroCentro.miLlave();
  assert.ok(m && c && o, 'los tres aparatos tienen llave');
  assert.equal(m.volatil, false);
  assert.equal(c.volatil, false);
  apMovil = { id: m.id, pub: m.pub, fir: m.fir };
  apCentro = { id: c.id, pub: c.pub, fir: c.fir };
  apOtro = { id: o.id, pub: o.pub, fir: o.fir };
  assert.notEqual(apMovil.id, apCentro.id);
});

/** Lo que pasa por el relevo: JSON de ida y vuelta. */
const porElRelevo = (b) => JSON.parse(JSON.stringify(b));

const TEXTOS = [
  'hola',
  '',
  'Ñandú, acción, pingüino: ¿qué tal? ¡Bien!',
  'emoji 👩🏽‍💻🚀 y bandera 🇭🇳',
  '中文 · русский · العربية · עברית',
  '﻿empieza con BOM',
  'renglones\nseparados\r\ncon\ttabulador',
  '{"t":"parece json","k":1}',
  'x'.repeat(10_000),
  'surrogate suelto al final \uD83D',
  '\uDE00 bajo suelto al principio',
  'mitad \uD83D\uD83D doble alto',
];

test('base64url: los dos codifican y decodifican igual (largos 0..80 y bytes al azar)', () => {
  for (let n = 0; n <= 80; n++) {
    const b = new Uint8Array(randomBytes(n));
    const a = movil.aB64(b);
    assert.equal(centro.aB64(b), a, `aB64 largo ${n}`);
    assert.deepEqual(Array.from(centro.deB64(a)), Array.from(b));
    assert.deepEqual(Array.from(movil.deB64(a)), Array.from(b));
  }
  // Basura y relleno se ignoran igual en los dos.
  for (const raro of ['ab==', 'a b\nc', '+/+/', '', 'A', 'AB$%CD']) {
    assert.deepEqual(Array.from(centro.deB64(raro)), Array.from(movil.deB64(raro)), raro);
  }
});

test('el id de un aparato se deriva igual de su llave pública', () => {
  assert.equal(centro.idDeAparato(apMovil.pub), apMovil.id);
  assert.equal(movil.idDeAparato(apCentro.pub), apCentro.id);
  for (let i = 0; i < 50; i++) {
    const pub = movil.aB64(new Uint8Array(randomBytes(65)));
    const id = centro.idDeAparato(pub);
    assert.equal(id, movil.idDeAparato(pub));
    assert.equal(id.length, 22);
  }
});

test('el saneo de texto (surrogates sueltos → U+FFFD) es idéntico', () => {
  for (const t of TEXTOS) assert.equal(centro.sanearTexto(t), movil.sanearTexto(t), JSON.stringify(t.slice(0, 30)));
});

test('teléfono → Centro: el Centro abre lo que cierra el teléfono y verifica su firma', async () => {
  for (const t of TEXTOS) {
    const b = porElRelevo(await movil.cerrar(t, [apCentro]));
    assert.equal(b.v, 2);
    assert.equal(b.de, apMovil.pub);
    assert.equal(b.fir, apMovil.fir);
    assert.equal(movil.deB64(b.f).length, 64, 'firma CRUDA r‖s, no DER');
    const r = await centro.abrir(b, [apMovil]);
    assert.ok(r, 'abre');
    assert.equal(r.texto, movil.sanearTexto(t));
    assert.equal(r.verificado, true);
    assert.equal(r.motivo, '');
  }
});

test('Centro → teléfono: el teléfono abre lo que cierra el Centro y verifica su firma', async () => {
  for (const t of TEXTOS) {
    const b = porElRelevo(await centro.cerrar(t, [apMovil]));
    assert.equal(b.v, 2);
    assert.equal(b.de, apCentro.pub);
    assert.equal(centro.deB64(b.f).length, 64);
    const r = await movil.abrir(b, [apCentro]);
    assert.ok(r, 'abre');
    assert.equal(r.texto, centro.sanearTexto(t));
    assert.equal(r.verificado, true);
    assert.equal(r.motivo, '');
  }
});

test('los sobres van a todos: destinatario, los otros aparatos y el propio (releer lo mandado)', async () => {
  const b = porElRelevo(await centro.cerrar('para todos', [apMovil, apOtro]));
  assert.deepEqual(b.s.map((s) => s.a).sort(), [apCentro.id, apMovil.id, apOtro.id].sort());
  assert.equal(b.s[0].a, apCentro.id, 'el propio va primero');
  assert.equal((await movil.abrir(b, [apCentro])).texto, 'para todos');
  assert.equal((await otroCentro.abrir(b, [apCentro])).texto, 'para todos');
  assert.equal((await centro.abrir(b, [apCentro])).texto, 'para todos');
  const m = porElRelevo(await movil.cerrar('del teléfono', [apCentro, apOtro]));
  assert.equal((await movil.abrir(m, [apMovil])).texto, 'del teléfono');
  assert.equal((await otroCentro.abrir(m, [apMovil])).verificado, true);
});

test('un aparato que dice un id que no es el de su llave no recibe sobre (en ninguno de los dos)', async () => {
  const impostor = { id: apCentro.id, pub: apOtro.pub, fir: apOtro.fir };
  for (const [quien, cerrar] of [['teléfono', movil], ['Centro', otroCentro]]) {
    const b = await cerrar.cerrar('hola', [impostor, apCentro]);
    const ids = b.s.map((s) => s.a);
    assert.equal(ids.filter((x) => x === apCentro.id).length, 1, quien);
    assert.equal((await centro.abrir(porElRelevo(b), [])).texto, 'hola', quien);
  }
});

test('las firmas se juzgan igual en los dos: sin firma, rota, no publicada, de otro aparato', async () => {
  const deMovil = porElRelevo(await movil.cerrar('firmado', [apCentro, apOtro]));
  const deCentro = porElRelevo(await centro.cerrar('firmado', [apMovil, apOtro]));

  // Sin la firma: se abre, pero «sin firma».
  const sinFirma = (b) => {
    const { f: _f, fir: _fir, ...resto } = b;
    return resto;
  };
  for (const [abre, b, ap] of [[centro, deMovil, apMovil], [movil, deCentro, apCentro]]) {
    const r = await abre.abrir(sinFirma(b), [ap]);
    assert.equal(r.verificado, false);
    assert.equal(r.motivo, 'sin-firma');
  }

  // La firma de OTRO bulto (válida, pero no de este): «firma rota».
  const otroMovil = porElRelevo(await movil.cerrar('otro', [apCentro]));
  const otroCentroB = porElRelevo(await centro.cerrar('otro', [apMovil]));
  assert.equal((await centro.abrir({ ...deMovil, f: otroMovil.f }, [apMovil])).motivo, 'firma-rota');
  assert.equal((await movil.abrir({ ...deCentro, f: otroCentroB.f }, [apCentro])).motivo, 'firma-rota');

  // Firma ilegible: igual en los dos.
  const ilegible = { ...deMovil, f: 'AAAA' };
  const a = await centro.abrir(ilegible, [apMovil]);
  const b = await otroCentro.abrir(ilegible, [apMovil]);
  assert.equal(a.verificado, false);
  assert.equal(a.motivo, b.motivo);

  // La llave de firma no está entre las publicadas del remitente.
  assert.equal((await centro.abrir(deMovil, [apOtro])).motivo, 'llave-no-publicada');
  assert.equal((await movil.abrir(deCentro, [apOtro])).motivo, 'llave-no-publicada');
  // Sin llaves del remitente.
  assert.equal((await centro.abrir(deMovil, [])).motivo, 'sin-llaves-del-remitente');
  // La firma publicada es de un aparato, pero el bulto dice venir de otra llave de acordar.
  const cruzado = { id: apMovil.id, pub: apOtro.pub, fir: apMovil.fir };
  assert.equal((await centro.abrir(deMovil, [cruzado])).motivo, 'aparato-no-cuadra');
  assert.equal((await movil.abrir(deCentro, [{ ...apCentro, pub: apOtro.pub }])).motivo, 'aparato-no-cuadra');
});

test('un bulto tocado no se abre en ninguno de los dos', async () => {
  const b = porElRelevo(await movil.cerrar('intacto', [apCentro]));
  const ct = centro.deB64(b.ct);
  ct[0] ^= 1;
  const tocado = { ...b, ct: centro.aB64(ct) };
  assert.equal(await centro.abrir(tocado, [apMovil]), null);
  assert.equal(await movil.abrir(tocado, [apMovil]), null);
  // Mal formado: null, no lanza.
  for (const malo of [null, {}, { ...b, s: [null] }, { ...b, de: 5 }, { ...b, v: 3 }]) {
    assert.equal(await centro.abrir(malo, [apMovil]), null);
    assert.equal(await movil.abrir(malo, [apMovil]), null);
    assert.equal(centro.esBulto(malo), movil.esBulto(malo));
  }
  // Sin sobre para este aparato (llegó antes de que existiera): null.
  const ajeno = porElRelevo(await movil.cerrar('no es para el Centro', [apOtro]));
  assert.equal(await centro.abrir(ajeno, [apMovil]), null);
});

test('las fotos: los bytes cerrados en uno se abren en el otro', () => {
  const foto = new Uint8Array(randomBytes(50_000));
  const c1 = movil.cerrarBytes(foto);
  assert.deepEqual(Buffer.from(centro.abrirBytes(c1.bytes, c1.llave, c1.iv)), Buffer.from(foto));
  const c2 = centro.cerrarBytes(foto);
  assert.deepEqual(Buffer.from(movil.abrirBytes(c2.bytes, c2.llave, c2.iv)), Buffer.from(foto));
  assert.equal(centro.deB64(c2.llave).length, 32);
  assert.equal(centro.deB64(c2.iv).length, 12);
});

test('el código de seguridad sale idéntico y simétrico en los dos', () => {
  const mias = [apCentro.pub, apOtro.pub];
  const suyas = [apMovil.pub];
  const a = centro.codigoDeSeguridad(mias, suyas);
  assert.equal(a, movil.codigoDeSeguridad(mias, suyas));
  assert.equal(a, movil.codigoDeSeguridad(suyas, [...mias].reverse()));
  assert.match(a, /^\d{5}( \d{5}){4} {2}\d{5}( \d{5}){4}$/);
});

test('el Centro guarda su par en el cajón y vuelve con el MISMO id; si el cajón no se deja leer, no publica', async () => {
  const c = await armar(entradaCentro);
  const cajon = c.almacenEnMemoria();
  c.ponerAlmacen(cajon);
  const antes = await c.miLlave();
  assert.equal(antes.volatil, false);
  assert.deepEqual([...cajon.datos.keys()].sort(), [...c.CAJONES].sort());
  c.olvidarEnMemoria();
  const despues = await c.miLlave();
  assert.equal(despues.id, antes.id, 'mismo aparato al volver a arrancar');
  assert.equal(despues.fir, antes.fir);

  // Cajón enfermo: par solo en memoria (volátil), y lo guardado NO se pisa.
  const guardado = new Map(cajon.datos);
  c.olvidarEnMemoria();
  c.ponerAlmacen({
    leer: async () => {
      throw new Error('DPAPI no respondió');
    },
    guardar: async (k, v) => cajon.datos.set(k, v),
    borrar: async () => {},
  });
  const enfermo = await c.miLlave();
  assert.equal(enfermo.volatil, true);
  assert.notEqual(enfermo.id, antes.id);
  assert.deepEqual([...cajon.datos], [...guardado], 'no se pisó la llave guardada');
});
