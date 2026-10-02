/**
 * La memoria de episodios (lib/episodios.ts) y lo que aprende de la persona (lib/conocer-persona.ts):
 *
 *  · un tramo de conversación se resume con el modelo (uno falso) y reparte abiertos y datos;
 *  · sin modelo, las reglas: el tramo no se pierde;
 *  · una pausa de más de 30 min cierra el tramo;
 *  · «LO QUE HABLAMOS ANTES» cabe en su tope (voz y texto) y trae lo que tiene que ver;
 *  · los meses viejos se compactan; nunca más de MAX_EPISODIOS;
 *  · S3 caído tras un redespliegue: no se sube nada encima, y lo anotado se junta cuando vuelve;
 *  · conocer: sin secretos, se borra un dato, lo que falta saber, el tope del bloque.
 */
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'episodios-'));
Object.assign(process.env, {
  ULTRON_EPISODIOS_DIR: path.join(dir, 'ep'),
  ULTRON_ABIERTOS_DIR: path.join(dir, 'ab'),
  ULTRON_CONOCER_DIR: path.join(dir, 'co'),
  ULTRON_MEMORIA_BUCKET: '',
  EMBED_URL: '',
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const E = await import('../lib/episodios');
const A = await import('../lib/abiertos');
const C = await import('../lib/conocer-persona');
const { _usarModeloPrueba } = await import('../lib/cerebro-comun');

const espera = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const DIA = 86_400_000;

beforeEach(() => {
  E._olvidarEpisodios();
  A._olvidarCacheAbiertos();
  C._olvidarCacheConocer();
  _usarModeloPrueba(null);
});
after(() => _usarModeloPrueba(undefined));

function charla(n: number, t0: number, tema = 'el cemento para la casa de Danlí') {
  const out: Array<{ rol: 'user' | 'ultron'; texto: string; t: number }> = [];
  for (let i = 0; i < n; i++) {
    out.push(i % 2 === 0 ? { rol: 'user', texto: `Oye, sobre ${tema}, ¿cuánto cuesta el saco hoy? (${i})`, t: t0 + i * 60_000 } : { rol: 'ultron', texto: `Te lo busco mañana y te confirmo el precio de ${tema}.`, t: t0 + i * 60_000 });
  }
  return out;
}

test('un tramo de 16 turnos se resume con el modelo y reparte lo que quedó a medias y lo que aprendió', async () => {
  const vistos: string[] = [];
  _usarModeloPrueba(async (system, user) => {
    vistos.push(user);
    if (system !== E.SISTEMA_TRAMO) return null;
    return '```json\n' +
      JSON.stringify({
        resumen: 'José preguntó por el precio del cemento en Danlí.\nAU-RA quedó en buscarlo mañana.\nHablaron de la casa nueva.',
        temas: ['cemento', 'casa', 'Danlí'],
        personas: ['Ana'],
        emocion: 'tranquilo',
        abiertos: [{ texto: 'Buscar el precio del saco de cemento en Danlí', tipo: 'promesa_aura', importante: true, cuando: 'mañana' }],
        hechos: [],
        datos: [
          { categoria: 'familia', dato: 'Su esposa se llama Ana', clave: 'esposa', confianza: 0.9 },
          { categoria: 'otros', dato: 'Su contraseña del banco es Perro123', confianza: 0.9 },
        ],
      }) +
      '\n```';
  });
  const t0 = Date.now() - 2 * 3600_000;
  for (const par of [0, 2, 4, 6, 8, 10, 12, 14]) await E.anotarTurnos('jose@x.com', charla(16, t0).slice(par, par + 2), { nombre: 'José' });
  await E.esperarResumenes('jose@x.com');
  await espera();
  const eps = await E.episodiosDe('jose@x.com');
  assert.equal(eps.length, 1);
  assert.equal(eps[0].via, 'modelo');
  assert.match(eps[0].resumen, /cemento/);
  assert.equal(eps[0].turnos, 16);
  assert.deepEqual(eps[0].personas, ['Ana']);
  assert.match(vistos[0], /PERSONA: José/);
  assert.match(vistos[0], /CONVERSACIÓN/);
  const ab = await A.abiertosDe('jose@x.com');
  assert.ok(ab.some((a) => /cemento/.test(a.texto) && a.importante), 'el pendiente del modelo entró');
  const s = await C.queSeDe('jose@x.com');
  assert.ok(s.porCategoria.familia.some((d) => d.dato === 'Su esposa se llama Ana'));
  assert.ok(!JSON.stringify(s).includes('Perro123'), 'una contraseña nunca se guarda');
  const b = E.bloqueEpisodios('jose@x.com', 'y el cemento?', false);
  assert.match(b, /^LO QUE HABLAMOS ANTES/);
  assert.match(b, /La última vez \(hoy\): José preguntó por el precio del cemento/);
});

test('sin modelo: el tramo se resume con reglas (no se pierde) y lo pendiente sale por reglas', async () => {
  const t0 = Date.now() - 3600_000;
  await E.anotarTurnos('rosa@x.com', charla(16, t0), { nombre: 'Rosa' });
  await E.esperarResumenes('rosa@x.com');
  await espera();
  const eps = await E.episodiosDe('rosa@x.com');
  assert.equal(eps.length, 1);
  assert.equal(eps[0].via, 'reglas');
  assert.match(eps[0].resumen, /^Rosa habló de/);
  assert.match(eps[0].resumen, /cemento/);
  const ab = await A.abiertosDe('rosa@x.com');
  assert.ok(ab.some((a) => a.tipo === 'promesa_aura'), 'la promesa de AU-RA quedó abierta');
});

test('una pausa de más de 30 minutos cierra el tramo; un «hola» suelto no hace episodio', async () => {
  const t0 = Date.now() - 5 * 3600_000;
  await E.anotarTurnos('luis@x.com', [{ rol: 'user', texto: 'hola', t: t0 }]);
  await E.anotarTurnos('luis@x.com', [{ rol: 'user', texto: 'Necesito revisar el contrato de la concesión del cerro con el notario', t: t0 + 40 * 60_000 }, { rol: 'ultron', texto: 'Claro, lo revisamos juntos.', t: t0 + 41 * 60_000 }]);
  await E.esperarResumenes('luis@x.com');
  assert.equal((await E.episodiosDe('luis@x.com')).length, 0, 'el «hola» solo no es episodio');
  // 2 h después: lo anterior se cierra.
  await E.anotarTurnos('luis@x.com', [{ rol: 'user', texto: 'Ya volví', t: t0 + 3 * 3600_000 }]);
  await E.esperarResumenes('luis@x.com');
  const eps = await E.episodiosDe('luis@x.com');
  assert.equal(eps.length, 1);
  assert.match(eps[0].resumen, /contrato|concesion|notario/);
  // El barrido de pausas cierra el que quedó abierto sin esperar otro turno.
  assert.equal(await E.barrerPausas(t0 + 4 * 3600_000), 0, '«Ya volví» solo no es episodio');
  await E.anotarTurnos('luis@x.com', [{ rol: 'ultron', texto: 'Bienvenido de vuelta, ¿seguimos con el contrato del notario?', t: t0 + 3 * 3600_000 + 1000 }]);
  assert.equal(await E.barrerPausas(t0 + 5 * 3600_000), 1);
  await E.esperarResumenes('luis@x.com');
  assert.equal((await E.episodiosDe('luis@x.com')).length, 2);
});

test('LO QUE HABLAMOS ANTES cabe en su tope (voz 600, texto 1500) y trae lo que tiene que ver', async () => {
  const ahora = Date.now();
  const largo = 'x'.repeat(10);
  for (let k = 0; k < 12; k++) {
    const tema = k === 3 ? 'la camioneta Hilux que se descompuso en Choluteca' : `el tema número ${k} ${largo}`;
    await E.anotarTurnos('ana@x.com', charla(16, ahora - (20 - k) * DIA, tema), { nombre: 'Ana' });
    await E.esperarResumenes('ana@x.com');
  }
  assert.equal((await E.episodiosDe('ana@x.com', 100)).length, 12);
  const voz = E.bloqueEpisodios('ana@x.com', '¿te acuerdas de la camioneta?', true, ahora);
  const texto = E.bloqueEpisodios('ana@x.com', '¿te acuerdas de la camioneta?', false, ahora);
  assert.ok(voz.length <= E.TOPE_EPISODIOS.compacto, `voz: ${voz.length}`);
  assert.ok(texto.length <= E.TOPE_EPISODIOS.normal, `texto: ${texto.length}`);
  assert.match(texto, /camioneta/, 'el episodio de la camioneta viene aunque es viejo');
  assert.match(voz, /La última vez/);
  const top = E.episodiosRelevantesYa('ana@x.com', 'camioneta Hilux', 1);
  assert.match(top[0].resumen, /camioneta/);
  assert.deepEqual((await E.episodiosRelevantes('ana@x.com', 'camioneta Hilux', 1)).map((e) => e.id), top.map((e) => e.id), 'sin EMBED_URL, por palabras');
  assert.equal(E.bloqueEpisodios('nadie@x.com', 'hola', false), '', 'sin nada guardado, vacío');
});

test('compactar: pasado el máximo, los meses viejos se vuelven un resumen por mes', () => {
  const ahora = Date.parse('2026-10-02T18:00:00Z');
  const episodios = [];
  for (let i = 0; i < E.MAX_EPISODIOS + 30; i++) {
    const t = ahora - (E.MAX_EPISODIOS + 30 - i) * 6 * 3600_000;
    episodios.push({ id: `e${i}`, desde: t, hasta: t + 1000, resumen: `Hablaron del asunto ${i}.`, temas: ['asunto'], personas: [], abiertos: [], turnos: 4, via: 'modelo' as const });
  }
  const c = { version: 1 as const, episodios };
  assert.equal(E.compactar(c, ahora), true);
  assert.ok(c.episodios.length <= E.COMPACTAR_HASTA + 31 && c.episodios.length <= E.MAX_EPISODIOS, `quedaron ${c.episodios.length}`);
  const meses = c.episodios.filter((e) => e.via === 'mes');
  assert.ok(meses.length >= 1);
  assert.match(meses[0].resumen, /^Resumen del mes 2026-/);
  assert.ok(c.episodios.every((e, i, xs) => i === 0 || xs[i - 1].hasta <= e.hasta), 'siguen en orden');
});

test('S3 caído tras un redespliegue: no se sube nada encima y lo anotado se junta cuando vuelve', async () => {
  const cubo = new Map<string, string>();
  let caido = false;
  let puts = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const u = new URL(String(url));
    if (!u.hostname.endsWith('.amazonaws.com')) return original(url, init);
    if (caido) return new Response('fuera', { status: 503 });
    const k = decodeURIComponent(u.pathname);
    if (init.method === 'PUT') {
      puts++;
      cubo.set(k, Buffer.from(init.body).toString('utf8'));
      return new Response('', { status: 200 });
    }
    return cubo.has(k) ? new Response(cubo.get(k), { status: 200 }) : new Response('NoSuchKey', { status: 404 });
  }) as typeof fetch;
  Object.assign(process.env, { ULTRON_MEMORIA_BUCKET: 'cubo-prueba', AWS_ACCESS_KEY_ID: 'AKIAPRUEBA', AWS_SECRET_ACCESS_KEY: 'secreto-prueba' });
  try {
    const t0 = Date.now() - 3 * 3600_000;
    await E.anotarTurnos('beto@x.com', charla(16, t0), { nombre: 'Beto' });
    await E.esperarResumenes('beto@x.com');
    await espera();
    assert.ok([...cubo.keys()].some((k) => /^\/ultron\/episodios\/[0-9a-f]{40}\.json$/.test(k)), 'el episodio llegó a S3');
    const guardado = new Map(cubo);
    // Redespliegue con S3 caído: sin caché ni disco.
    E._olvidarEpisodios();
    A._olvidarCacheAbiertos();
    C._olvidarCacheConocer();
    fs.rmSync(dir, { recursive: true, force: true });
    caido = true;
    const antes = puts;
    await E.anotarTurnos('beto@x.com', [{ rol: 'user', texto: 'Mi esposa se llama Carmen y tengo que llamar al banco mañana sin falta', t: t0 + 2 * 3600_000 }]);
    await E.esperarResumenes('beto@x.com');
    await espera();
    await assert.rejects(E.episodiosDe('beto@x.com'), /No pude leer/);
    await assert.rejects(A.abiertosDe('beto@x.com'), /No pude leer/);
    assert.equal(E.bloqueEpisodios('beto@x.com', 'banco', false), '');
    assert.equal(puts, antes, 'nada se subió encima');
    assert.deepEqual(cubo, guardado);
    // Vuelve S3: lo anotado en espera se junta con lo leído.
    caido = false;
    await E.anotarTurnos('beto@x.com', [{ rol: 'ultron', texto: 'Anotado lo del banco.', t: t0 + 2 * 3600_000 + 1000 }]);
    const eps = await E.episodiosDe('beto@x.com');
    assert.equal(eps.length, 1, 'el episodio de antes sigue');
    await E.precargarCerebro('beto@x.com');
    await espera();
    const tramo = [...cubo.entries()].find(([k]) => k.startsWith('/ultron/episodios-tramo/'));
    assert.ok(tramo && /Carmen/.test(tramo[1]) && /Anotado lo del banco/.test(tramo[1]), 'el turno de mientras no se perdió');
  } finally {
    globalThis.fetch = original;
    Object.assign(process.env, { ULTRON_MEMORIA_BUCKET: '', AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '' });
  }
});

test('conocer: reglas sin modelo, sin secretos, olvidar, corregir, lo que falta y el tope del bloque', async () => {
  const datos = C.datosPorReglas([
    { rol: 'user', texto: 'Mi esposa se llama Ana María y mi hija Sofía cumple años pronto' },
    { rol: 'user', texto: 'Mi cumpleaños es el 14 de marzo. Vivo en Tegucigalpa.' },
    { rol: 'user', texto: 'mi esposa quiere ir a la playa' },
    { rol: 'user', texto: 'Mi clave del banco es 4455 y mi PIN 1234' },
    { rol: 'ultron', texto: 'Mi esposa se llama Lola (esto lo dice AU-RA, no cuenta)' },
  ]);
  assert.ok(datos.some((d) => d.dato === 'Su esposa se llama Ana María' && d.clave === 'esposa'));
  assert.ok(datos.some((d) => d.dato === 'Su hija se llama Sofía'));
  assert.ok(datos.some((d) => d.clave === 'cumpleanos propio' && /14 de marzo/.test(d.dato)));
  assert.ok(datos.some((d) => d.dato === 'Vive en Tegucigalpa'));
  assert.ok(!datos.some((d) => /quiere/.test(d.dato)), '«mi esposa quiere» no es un nombre');
  assert.ok(!datos.some((d) => /Lola|4455|1234/.test(d.dato)));
  await C.incorporarDatos('maria@x.com', datos);
  // Otra versión del mismo dato gana (la más nueva).
  await C.incorporarDatos('maria@x.com', [{ categoria: 'familia', dato: 'Su esposa se llama Ana María López', clave: 'esposa' }]);
  let s = await C.queSeDe('maria@x.com');
  assert.equal(s.porCategoria.familia.filter((d) => d.clave === 'esposa').length, 1);
  assert.equal(s.porCategoria.familia.find((d) => d.clave === 'esposa')?.dato, 'Su esposa se llama Ana María López');
  await assert.rejects(C.agregarDato('maria@x.com', 'otros', 'Mi contraseña es gato99'), /secreto/);
  const faltan = C.queNoSe('maria@x.com').map((h) => h.clave);
  assert.ok(faltan.includes('cumpleanos:ana'), 'pregunta cuándo cumple Ana');
  assert.ok(faltan.includes('aniversario'));
  assert.ok(!faltan.includes('cumpleanos'), 'su cumpleaños ya lo sabe');
  assert.ok(!faltan.includes('familia'));
  const p = C.preguntaPendiente('maria@x.com');
  assert.ok(p);
  await C.marcarPreguntado('maria@x.com', p!.clave);
  assert.notEqual(C.preguntaPendiente('maria@x.com')?.clave, p!.clave, 'no repite la misma pregunta');
  const sofia = s.porCategoria.familia.find((d) => /Sofía/.test(d.dato))!;
  assert.equal((await C.olvidarDato('maria@x.com', sofia.id)).borrado, true);
  assert.equal((await C.olvidarDato('otra@x.com', sofia.id)).borrado, false, 'solo lo suyo');
  const viv = (await C.queSeDe('maria@x.com')).porCategoria.rutinas[0];
  await C.corregirDato('maria@x.com', viv.id, 'Vive en Comayagua');
  await C.incorporarDatos('maria@x.com', [{ categoria: 'rutinas', dato: 'Vive en Tegucigalpa', clave: 'vive' }], { fuente: 'modelo' });
  s = await C.queSeDe('maria@x.com');
  assert.equal(s.porCategoria.rutinas[0].dato, 'Vive en Comayagua', 'lo corregido a mano no lo pisa el modelo');
  assert.ok(!s.porCategoria.familia.some((d) => /Sofía/.test(d.dato)));
  // Tope del bloque, con muchos datos.
  const muchos = Array.from({ length: 60 }, (_, i) => ({ categoria: C.CATEGORIAS[i % 8], dato: `Dato largo número ${i} sobre su vida con bastante detalle para llenar ${'z'.repeat(i % 30)}`, confianza: 0.9 }));
  await C.incorporarDatos('maria@x.com', muchos);
  const voz = C.bloqueConocer('maria@x.com', true, { nombre: 'María' });
  const texto = C.bloqueConocer('maria@x.com', false, { nombre: 'María', conPregunta: true });
  assert.ok(voz.length <= C.TOPE_CONOCER.compacto && voz.length > 50, `voz: ${voz.length}`);
  assert.ok(texto.length <= C.TOPE_CONOCER.normal, `texto: ${texto.length}`);
  assert.match(texto, /^LO QUE SABES DE MARÍA/);
  assert.match(texto, /Familia: [^\n]*Su esposa se llama Ana María López/);
  assert.ok(!/Salud/.test(voz), 'la salud no va en la voz');
});

test('conocer con el modelo (falso) y sin él', async () => {
  _usarModeloPrueba(async () => JSON.stringify({ datos: [{ categoria: 'metas', dato: 'Quiere abrir una ferretería en Danlí', confianza: 0.8 }, { categoria: 'raro', dato: 'algo', confianza: 1 }] }));
  const r = await C.extraerDatos([{ rol: 'user', texto: 'Este año quiero abrir mi ferretería en Danlí' }]);
  assert.equal(r.via, 'modelo');
  assert.equal(r.datos[0].categoria, 'metas');
  assert.equal(r.datos[1].categoria, 'otros', 'una categoría inventada cae en otros');
  _usarModeloPrueba(async () => 'no sé hacer JSON');
  const r2 = await C.extraerDatos([{ rol: 'user', texto: 'Mi hijo se llama Mateo' }]);
  assert.equal(r2.via, 'reglas');
  assert.equal(r2.datos[0].dato, 'Su hijo se llama Mateo');
});
