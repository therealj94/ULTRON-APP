/**
 * AUR11 (documento maestro, sección 13): memoria gobernable y borrado sin resurrección, en el servidor.
 *
 *  · PROCEDENCIA: cada dato de «lo que sé de ti» guarda de dónde salió (la primera vez, Ajustes, una
 *    conversación), cuándo, su alcance (general o limitado) y si la persona lo dijo o AURA lo dedujo. Lo
 *    viejo (sin esos campos) se migra al leerlo.
 *  · CORREGIR cambia los USOS ACTIVOS, no solo la pantalla: el bloque del prompt, la respuesta del perfil
 *    (que también va al prompt), los resúmenes de conversaciones de antes y la firma del system congelado.
 *  · BORRAR marca la supresión (tombstone con versión) ANTES de tocar los almacenes, borra en cada uno
 *    (lo que sé de ti, el perfil, los resúmenes y el tramo) y la marca prevalece sobre:
 *      – un dispositivo offline que sincroniza una copia vieja (PUT del perfil sin fecha o con fecha vieja,
 *        un POST de «lo que sé de ti» con `dicho` viejo, la encuesta entera desde otro teléfono);
 *      – un tramo de conversación viejo que se resume después del borrado;
 *      – una migración o restauración de datos viejos (el objeto de S3 y el disco de antes);
 *      – un reinicio a mitad del trabajo (la marca está; se reanuda).
 *
 * S3 de mentira (fetch interceptado, en memoria) y disco temporal: sin cuentas reales.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'olvido-'));
Object.assign(process.env, {
  ULTRON_CIRCULO_DIR: path.join(dir, 'ci'),
  ULTRON_ABIERTOS_DIR: path.join(dir, 'ab'),
  ULTRON_CONOCER_DIR: path.join(dir, 'co'),
  ULTRON_EPISODIOS_DIR: path.join(dir, 'ep'),
  ULTRON_SUPRESIONES_DIR: path.join(dir, 'su'),
  ULTRON_PERFILES_DIR: path.join(dir, 'pe'),
  ULTRON_SESIONES_CERRADAS_ARCHIVO: path.join(dir, 'cerradas.json'),
  ULTRON_SESION_SECRETO: 'secreto-de-prueba-largo-para-las-sesiones-olvido',
  ULTRON_MEMORIA_BUCKET: 'cubo-prueba',
  AWS_ACCESS_KEY_ID: 'AKIAPRUEBA',
  AWS_SECRET_ACCESS_KEY: 'secreto-prueba',
  WHATSAPP_PUENTE_URL: '',
  WHATSAPP_DUENOS: '',
});

/* ── S3 de mentira ─────────────────────────────────────────────────────────────────────────── */
const s3 = new Map<string, string>();
const putsOrden: string[] = [];
let s3Caido = false;
let putsFallan: RegExp | null = null;
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any = {}) => {
  const u = new URL(String(url));
  if (!u.hostname.endsWith('.amazonaws.com')) return fetchOriginal(url, init);
  const key = decodeURIComponent(u.pathname.slice(1));
  if (s3Caido) return new Response('fuera', { status: 503 });
  if (init.method === 'PUT') {
    if (putsFallan?.test(key)) return new Response('no', { status: 500 });
    putsOrden.push(key);
    s3.set(key, Buffer.from(init.body).toString('utf8'));
    return new Response('', { status: 200 });
  }
  const v = s3.get(key);
  return v === undefined ? new Response('NoSuchKey', { status: 404 }) : new Response(v, { status: 200 });
}) as typeof fetch;
after(() => {
  globalThis.fetch = fetchOriginal;
  fs.rmSync(dir, { recursive: true, force: true });
});

const K = await import('../lib/conocer-persona');
const E = await import('../lib/episodios');
const P = await import('../lib/perfil-persona');
const S = await import('../lib/supresiones');
const O = await import('../lib/olvido');
const { huellaDe, _usarModeloPrueba } = await import('../lib/cerebro-comun');
const { piezasDelTurno } = await import('../server/prompt-turno');
const { montarRutasCerebroContinuo } = await import('../server/cerebro-continuo');
const { montarRutasApp } = await import('../server/app-rutas');
const { emitirSesion, sesionDe, tokenDe, exigirMesa } = await import('../server/seguridad');
const { CLAVE_CONOCER } = await import('../mobile/src/primeravez/flujo');

const app = express();
app.use(express.json());
const pasa = () => ((_q: express.Request, _s: express.Response, n: express.NextFunction) => n()) as express.RequestHandler;
montarRutasCerebroContinuo(app, { exigirMesa, limitar: pasa, sesionDe: (req) => sesionDe(req) });
montarRutasApp(app, { exigirMesa, limitar: pasa, sesionDe, tokenDe, perfilPlataforma: () => ({}), latidoMs: 60 });
const srv = app.listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
after(() => srv.close());

const sesion = (correo: string) => emitirSesion({ correo, nombre: 'Persona Prueba', rol: 'Junta' }, { comunidad: true }).token;
const pedir = async (ruta: string, init: RequestInit & { token?: string } = {}) => {
  const r = await fetch(`${base}${ruta}`, { ...init, headers: { 'content-type': 'application/json', ...(init.token ? { 'x-ultron-sesion': init.token } : {}) } });
  return { status: r.status, j: (await r.json().catch(() => null)) as any };
};
const datosDe = (j: any) => (j?.categorias || []).flatMap((c: any) => c.datos);
const claveS3 = (cajon: string, persona: string) => `ultron/${cajon}/${huellaDe(cajon, persona)}.json`;
const archivo = (dirEnv: string, cajon: string, persona: string) => path.join(process.env[dirEnv]!, `${huellaDe(cajon, persona)}.json`);
/** Como tras un redespliegue: sin cachés (el disco y S3 siguen). */
const reiniciar = () => {
  K._olvidarCacheConocer();
  E._olvidarEpisodios();
  P._olvidarCachePerfiles();
  S._olvidarCacheSupresiones();
};
const HACE_UN_DIA = () => Date.now() - 86_400_000;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Un episodio viejo que menciona el dato (se siembra en disco y en S3, como lo dejó el resumen). */
function sembrarEpisodio(persona: string, resumen: string, t: number) {
  const caj = { version: 1, episodios: [{ id: 'ep_viejo', desde: t, hasta: t + 60_000, resumen, temas: ['Tela'], personas: [], abiertos: [], turnos: 4, via: 'modelo' }] };
  fs.mkdirSync(process.env.ULTRON_EPISODIOS_DIR!, { recursive: true });
  fs.writeFileSync(archivo('ULTRON_EPISODIOS_DIR', 'episodios', persona), JSON.stringify(caj));
  s3.set(claveS3('episodios', persona), JSON.stringify(caj));
}

test('la tabla de claves comunes del servidor es la misma que la de la app (borrar una copia encuentra la otra)', () => {
  for (const [campo, k] of Object.entries(CLAVE_CONOCER)) {
    if (campo === 'apodo') continue;
    assert.deepEqual(O.CAMPO_CLAVE[campo as keyof typeof O.CAMPO_CLAVE], k, `${campo}: el servidor y la app difieren`);
  }
});

test('procedencia: fuente, fecha, alcance y si fue explícito o inferido; lo viejo se migra al leerlo', async () => {
  const p = 'proc@prueba.local';
  const tok = sesion(p);
  const r = await pedir('/api/cerebro/conocer', { method: 'POST', token: tok, body: JSON.stringify({ categoria: 'rutinas', dato: 'Vive en Tela', clave: 'vive', origen: 'primeravez' }) });
  assert.equal(r.status, 200);
  await K.incorporarDatos(p, [{ categoria: 'gustos', dato: 'Le gusta el fútbol', confianza: 0.6 }], { fuente: 'modelo' });
  const g = await pedir('/api/cerebro/conocer', { token: tok });
  const vive = datosDe(g.j).find((d: any) => d.clave === 'vive');
  const futbol = datosDe(g.j).find((d: any) => /fútbol/.test(d.dato));
  assert.equal(vive.origen, 'primeravez');
  assert.equal(vive.explicito, true, 'lo contó ella');
  assert.equal(vive.alcance, 'general');
  assert.ok(vive.desde > 0 && vive.actualizado >= vive.desde, 'con fecha');
  assert.equal(futbol.origen, 'conversacion');
  assert.equal(futbol.explicito, false, 'el modelo lo dedujo: inferido');

  // Un cajón del formato de antes (sin procedencia), en S3 y sin disco: se lee migrado.
  const viejo = 'viejo@prueba.local';
  s3.set(claveS3('conocer', viejo), JSON.stringify({ version: 1, datos: [{ id: 'dt_a', categoria: 'familia', dato: 'Su esposa se llama Ana', clave: 'esposa', confianza: 0.8, fuente: 'reglas', desde: 5, visto: 5, veces: 1 }, { id: 'dt_b', categoria: 'otros', dato: 'Quiere que le digan «Chepe»', clave: 'apodo', confianza: 1, fuente: 'manual', desde: 6, visto: 6, veces: 1 }], preguntado: {} }));
  const gv = await pedir('/api/cerebro/conocer', { token: sesion(viejo) });
  const [a, b] = ['dt_a', 'dt_b'].map((id) => datosDe(gv.j).find((d: any) => d.id === id));
  assert.deepEqual([a.origen, a.explicito, a.alcance], ['conversacion', true, 'general'], 'reglas = frase literal de la persona');
  assert.deepEqual([b.origen, b.explicito], ['app', true]);
});

test('corregir actualiza los usos activos: prompt, perfil, resúmenes y la firma del system congelado', async () => {
  const p = 'corrige@prueba.local';
  const tok = sesion(p);
  const t0 = HACE_UN_DIA();
  await pedir('/api/perfil', { method: 'PUT', token: tok, body: JSON.stringify({ encuesta: { vive: 'Tela' } }) });
  const { dato } = await K.agregarDato(p, 'rutinas', 'Vive en Tela', 'vive');
  sembrarEpisodio(p, 'Contó que vive en Tela y que va a la playa los domingos.', t0);
  reiniciar();
  await E.precargarCerebro(p);
  assert.match(K.bloqueConocer(p, false, { nombre: 'Ana' }), /Tela/);
  assert.match(E.bloqueEpisodios(p, 'la playa de los domingos'), /Tela/);
  const firma0 = K.firmaConocer(p);

  const r = await pedir(`/api/cerebro/conocer/${dato.id}`, { method: 'PATCH', token: tok, body: JSON.stringify({ dato: 'Vive en Tocoa' }) });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.durable, true);
  assert.equal(r.j.dato.dato, 'Vive en Tocoa');
  assert.ok(r.j.dato.corregido > 0 && r.j.dato.explicito === true, 'la corrección queda en la procedencia');
  // El prompt de AURA (lo que sabe y el perfil), los resúmenes y el system congelado.
  assert.match(K.bloqueConocer(p, false, { nombre: 'Ana' }), /Tocoa/);
  assert.doesNotMatch(K.bloqueConocer(p, false, { nombre: 'Ana' }), /Tela/);
  assert.equal((await P.leerPerfil(p))?.encuesta.vive, 'Tocoa', 'la respuesta del perfil (va al prompt) también');
  assert.doesNotMatch(P.lineaPerfil(await P.leerPerfil(p)), /Tela/);
  assert.doesNotMatch(E.bloqueEpisodios(p, 'la playa de los domingos'), /Tela/, 'el resumen viejo ya no lo dice');
  assert.match(E.bloqueEpisodios(p, 'la playa de los domingos'), /playa/, 'lo demás del resumen sigue');
  assert.notEqual(K.firmaConocer(p), firma0, 'el system congelado se rehace');
  const pz = (conocerFirma: string, conocer = 'X') => piezasDelTurno({ nivel: 'junta', canal: 'mesa', modo: 'CREATIVE', mando: false, quien: null, quienMem: null, hechos: [], conocer, conocerFirma });
  assert.notEqual(pz('1').firma, pz('2').firma, 'una corrección cambia la firma');
  assert.equal(pz('1', 'aprendió algo').firma, pz('1', 'otra cosa').firma, 'aprender algo NO rehace el system (como antes)');
  // Y de reinicio en reinicio, en disco y en S3.
  reiniciar();
  await E.precargarCerebro(p);
  assert.doesNotMatch(E.bloqueEpisodios(p, 'la playa de los domingos'), /Tela/);
  assert.doesNotMatch(s3.get(claveS3('episodios', p)) || '', /Tela/, 'el resumen se reescribió en S3');
  // Un tramo viejo que se vuelve a leer no trae de vuelta lo corregido.
  await K.incorporarDatos(p, [{ categoria: 'rutinas', dato: 'Vive en Tela' }], { fuente: 'modelo', dicho: t0 });
  assert.ok(!K.datosConocidos(p).some((d) => /Tela/.test(d.dato)), JSON.stringify(K.datosConocidos(p)));
});

test('limitar: el dato se queda a la vista pero AURA deja de usarlo en el prompt', async () => {
  const p = 'limita@prueba.local';
  const tok = sesion(p);
  const { dato } = await K.agregarDato(p, 'salud', 'Es diabético', 'diabetes');
  assert.match(K.bloqueConocer(p, false, {}), /diabético/);
  const r = await pedir(`/api/cerebro/conocer/${dato.id}`, { method: 'PATCH', token: tok, body: JSON.stringify({ alcance: 'limitado' }) });
  assert.equal(r.status, 200);
  assert.equal(r.j.dato.alcance, 'limitado');
  assert.doesNotMatch(K.bloqueConocer(p, false, {}), /diabético/);
  assert.ok(datosDe((await pedir('/api/cerebro/conocer', { token: tok })).j).some((d: any) => d.id === dato.id && d.alcance === 'limitado'));
  assert.equal((await pedir(`/api/cerebro/conocer/${dato.id}`, { method: 'PATCH', token: tok, body: JSON.stringify({ alcance: 'todo' }) })).status, 400);
  assert.equal((await pedir(`/api/cerebro/conocer/${dato.id}`, { method: 'PATCH', token: sesion('otra@prueba.local'), body: JSON.stringify({ alcance: 'general' }) })).status, 404, 'lo ajeno no');
});

test('olvidar: la marca (con versión) se escribe ANTES que los almacenes, se borra en todos y el recibo lo dice', async () => {
  const p = 'olvida@prueba.local';
  const tok = sesion(p);
  const t0 = HACE_UN_DIA();
  await pedir('/api/perfil', { method: 'PUT', token: tok, body: JSON.stringify({ encuesta: { vive: 'Tela', comida: 'Baleadas' } }) });
  const { dato } = await K.agregarDato(p, 'rutinas', 'Vive en Tela', 'vive');
  sembrarEpisodio(p, 'Contó que vive en Tela.', t0);
  reiniciar();
  putsOrden.length = 0;
  const r = await pedir('/api/cerebro/conocer/olvidar', { method: 'POST', token: tok, body: JSON.stringify({ ids: [dato.id] }) });
  assert.equal(r.status, 200);
  assert.equal(r.j.durable, true);
  assert.equal(r.j.recibo.estado, 'confirmado');
  assert.ok(r.j.recibo.version >= 1, 'la marca tiene versión');
  assert.deepEqual(r.j.recibo.almacenes, { marca: true, conocer: true, perfil: true, episodios: true });
  const iMarca = putsOrden.indexOf(claveS3('supresiones', p));
  assert.ok(iMarca >= 0, 'la marca quedó en S3');
  for (const otro of [claveS3('conocer', p), claveS3('episodios', p), `ultron/perfiles/`]) {
    const i = putsOrden.findIndex((k) => k.startsWith(otro));
    assert.ok(i > iMarca, `${otro} se tocó después de la marca (${putsOrden.join(', ')})`);
  }
  // En cada almacén y en cada lectura.
  assert.equal(datosDe((await pedir('/api/cerebro/conocer', { token: tok })).j).length, 0);
  const perfil = (await pedir('/api/perfil', { token: tok })).j;
  assert.equal(perfil.perfil.encuesta.vive, undefined, 'la respuesta del perfil (misma clave) también');
  assert.equal(perfil.perfil.encuesta.comida, 'Baleadas', 'lo demás del perfil se queda');
  assert.ok(perfil.supresiones?.['encuesta.vive'] > 0, 'el teléfono se entera de la marca');
  for (const k of [claveS3('conocer', p), claveS3('episodios', p)]) assert.doesNotMatch(s3.get(k) || '', /Tela/, k);
});

test('offline + sync viejo: ni el PUT viejo del perfil, ni el POST viejo, ni otro teléfono con la encuesta entera lo resucitan', async () => {
  const p = 'offline@prueba.local';
  const telA = sesion(p);
  const telB = sesion(p);
  await pedir('/api/perfil', { method: 'PUT', token: telA, body: JSON.stringify({ encuesta: { vive: 'Tela', comida: 'Baleadas' } }) });
  await K.agregarDato(p, 'rutinas', 'Vive en Tela', 'vive');
  const antes = Date.now() - 60_000;
  // El teléfono A borra «Dónde vives» (como «Borrar esta respuesta»: el PUT con el campo vacío).
  const borra = await pedir('/api/perfil', { method: 'PUT', token: telA, body: JSON.stringify({ encuesta: { vive: '', comida: 'Baleadas' }, hechoEn: { 'encuesta.vive': Date.now() } }) });
  assert.equal(borra.status, 200);
  assert.equal(borra.j.perfil.encuesta.vive, undefined);
  assert.ok(!datosDe((await pedir('/api/cerebro/conocer', { token: telA })).j).some((d: any) => d.clave === 'vive'), 'borrar la respuesta del perfil borra su copia en lo que sé de ti (servidor)');

  // El teléfono B estuvo offline: reenvía su caché (huecos, sin fecha) y su cambio pendiente de antes.
  const huecos = await pedir('/api/perfil', { method: 'PUT', token: telB, body: JSON.stringify({ encuesta: { vive: 'Tela', comida: 'Pupusas' }, hechoEn: { 'encuesta.comida': Date.now() } }) });
  assert.equal(huecos.status, 200);
  assert.equal(huecos.j.perfil.encuesta.vive, undefined, 'la copia vieja de B no resucita «vive»');
  assert.equal(huecos.j.perfil.encuesta.comida, 'Pupusas', 'lo que B sí cambió después, entra');
  assert.deepEqual(huecos.j.suprimidos, ['encuesta.vive']);
  const viejo = await pedir('/api/perfil', { method: 'PUT', token: telB, body: JSON.stringify({ encuesta: { vive: 'Tela' }, hechoEn: { 'encuesta.vive': antes } }) });
  assert.equal(viejo.j.perfil.encuesta.vive, undefined, 'un cambio hecho ANTES del borrado tampoco');
  const post = await pedir('/api/cerebro/conocer', { method: 'POST', token: telB, body: JSON.stringify({ categoria: 'rutinas', dato: 'Vive en Tela', clave: 'vive', dicho: antes }) });
  assert.equal(post.status, 409);
  assert.equal(post.j.code, 'suprimido');
  assert.ok(!datosDe((await pedir('/api/cerebro/conocer', { token: telA })).j).some((d: any) => d.clave === 'vive'));

  // Después del borrado, una respuesta NUEVA sí vale (la marca no prohíbe para siempre).
  await espera(5);
  const nuevo = await pedir('/api/perfil', { method: 'PUT', token: telA, body: JSON.stringify({ encuesta: { vive: 'Tocoa' }, hechoEn: { 'encuesta.vive': Date.now() + 1000 } }) });
  assert.equal(nuevo.j.perfil.encuesta.vive, 'Tocoa');
  const postNuevo = await pedir('/api/cerebro/conocer', { method: 'POST', token: telA, body: JSON.stringify({ categoria: 'rutinas', dato: 'Vive en Tocoa', clave: 'vive' }) });
  assert.equal(postNuevo.status, 200);
});

test('un tramo de conversación viejo que se resume después del borrado no lo trae de vuelta', async () => {
  const p = 'tramo@prueba.local';
  const tok = sesion(p);
  const t0 = HACE_UN_DIA();
  await K.agregarDato(p, 'rutinas', 'Vive en Tela', 'vive');
  assert.equal((await pedir('/api/cerebro/conocer/olvidar', { method: 'POST', token: tok, body: JSON.stringify({ claves: [{ categoria: 'rutinas', clave: 'vive' }] }) })).j.recibo.estado, 'confirmado');
  // El modelo resume un tramo de AYER (anterior al borrado) que menciona el dato.
  _usarModeloPrueba(async () => JSON.stringify({ resumen: 'Contó que vive en Tela y que tiene una tienda.', temas: ['Tela'], personas: [], emocion: '', abiertos: [], hechos: [], datos: [{ categoria: 'rutinas', dato: 'Vive en Tela', confianza: 0.8 }] }));
  try {
    const turnos = Array.from({ length: E.TRAMO_TURNOS }, (_, i) => ({ rol: i % 2 ? 'ultron' : 'user', texto: i === 0 ? 'Vivo en Tela y tengo una tienda' : `turno ${i} de la charla`, t: t0 + i * 1000 }));
    await E.anotarTurnos(p, turnos, { ahora: t0 });
    await E.esperarResumenes(p);
  } finally {
    _usarModeloPrueba(undefined);
  }
  assert.ok(!datosDe((await pedir('/api/cerebro/conocer', { token: tok })).j).some((d: any) => /Tela/.test(d.dato)), 'ni por reglas ni por el modelo');
  const eps = (await pedir('/api/cerebro/episodios', { token: tok })).j.episodios;
  assert.ok(eps.length >= 1, 'el episodio se guardó');
  assert.ok(eps.every((e: any) => !/Tela/.test(JSON.stringify(e))), JSON.stringify(eps));
  assert.ok(eps.some((e: any) => /tienda/.test(e.resumen)), 'lo demás del resumen se queda');
});

test('migración / restauración antigua: el objeto viejo de S3 y del disco no resucita el dato (ni en el perfil)', async () => {
  const p = 'restaura@prueba.local';
  const tok = sesion(p);
  await pedir('/api/perfil', { method: 'PUT', token: tok, body: JSON.stringify({ apodo: 'Resi', encuesta: { vive: 'Tela', musica: 'Punta' } }) });
  await K.agregarDato(p, 'rutinas', 'Vive en Tela', 'vive');
  const conocerViejo = s3.get(claveS3('conocer', p))!;
  const perfilViejo = [...s3.entries()].find(([k, v]) => k.startsWith('ultron/perfiles/') && v.includes('Resi'))!;
  assert.ok(conocerViejo && perfilViejo, 'hay copia de antes');
  assert.equal((await pedir('/api/cerebro/conocer/olvidar', { method: 'POST', token: tok, body: JSON.stringify({ claves: [{ categoria: 'rutinas', clave: 'vive' }] }) })).j.recibo.estado, 'confirmado');
  // Se restaura un respaldo de antes del borrado (S3 y disco), en el formato viejo (sin procedencia ni marcas).
  const viejoSinCampos = JSON.parse(conocerViejo);
  for (const d of viejoSinCampos.datos) for (const k of ['origen', 'explicito', 'alcance', 'actualizado']) delete d[k];
  s3.set(claveS3('conocer', p), JSON.stringify(viejoSinCampos));
  fs.writeFileSync(archivo('ULTRON_CONOCER_DIR', 'conocer', p), JSON.stringify(viejoSinCampos));
  const perfilSinMarcas = JSON.parse(perfilViejo[1]);
  delete perfilSinMarcas.marcas;
  s3.set(perfilViejo[0], JSON.stringify(perfilSinMarcas));
  for (const f of fs.readdirSync(process.env.ULTRON_PERFILES_DIR!)) fs.writeFileSync(path.join(process.env.ULTRON_PERFILES_DIR!, f), fs.readFileSync(path.join(process.env.ULTRON_PERFILES_DIR!, f), 'utf8').includes('Resi') ? JSON.stringify(perfilSinMarcas) : fs.readFileSync(path.join(process.env.ULTRON_PERFILES_DIR!, f), 'utf8'));
  reiniciar();
  assert.ok(!datosDe((await pedir('/api/cerebro/conocer', { token: tok })).j).some((d: any) => /Tela/.test(d.dato)), 'lo que sé de ti, filtrado al leer');
  await K.precargarConocer(p);
  assert.doesNotMatch(K.bloqueConocer(p, false, {}), /Tela/, 'ni en el prompt');
  const perfil = (await pedir('/api/perfil', { token: tok })).j.perfil;
  assert.equal(perfil.encuesta.vive, undefined, 'el perfil restaurado tampoco lo enseña');
  assert.equal(perfil.encuesta.musica, 'Punta');
  assert.doesNotMatch(P.lineaPerfil(await P.leerPerfil(p)), /Tela/);
  // La próxima escritura deja el almacén limpio de verdad.
  await K.agregarDato(p, 'gustos', 'Le gusta la punta', 'musica');
  assert.doesNotMatch(s3.get(claveS3('conocer', p))!, /Tela/);
  await pedir('/api/perfil', { method: 'PUT', token: tok, body: JSON.stringify({ tema: 'oscuro' }) });
  assert.doesNotMatch(s3.get(perfilViejo[0])!, /Tela/);
});

test('reinicio a mitad del borrado: la marca ya está, nada se lee mientras tanto, y se reanuda', async () => {
  const p = 'reinicio@prueba.local';
  const tok = sesion(p);
  const { dato } = await K.agregarDato(p, 'familia', 'Su hija se llama Lucía', 'hija:lucia');
  // El proceso murió justo después de escribir la marca (antes de tocar los almacenes).
  const { tumba } = await S.marcarSupresion(p, { tipo: 'olvido', ids: [dato.id], claves: [], terminos: [['lucia']], campos: [], pendientes: ['conocer', 'episodios', 'perfil'] });
  reiniciar();
  assert.match(fs.readFileSync(archivo('ULTRON_CONOCER_DIR', 'conocer', p), 'utf8'), /Lucía/, 'el almacén todavía lo tiene…');
  const leido = await K.queSeDe(p);
  assert.ok(!Object.values(leido.porCategoria).flat().some((d) => d.id === dato.id), '…pero ninguna lectura nueva lo recupera');
  await K.precargarConocer(p);
  assert.doesNotMatch(K.bloqueConocer(p, false, {}), /Lucía/);
  assert.equal(await O.reanudarSupresiones(p), 1, 'se reanuda el trabajo pendiente');
  assert.equal(await O.reanudarSupresiones(p), 0, 'y una vez hecho, no queda nada');
  assert.ok(!datosDe((await pedir('/api/cerebro/conocer', { token: tok })).j).some((d: any) => d.id === dato.id));
  assert.doesNotMatch(fs.readFileSync(archivo('ULTRON_CONOCER_DIR', 'conocer', p), 'utf8'), /Lucía/);
  assert.doesNotMatch(s3.get(claveS3('conocer', p))!, /Lucía/);
  const t = (await S.tumbasDe(p)).find((x) => x.id === tumba.id)!;
  assert.deepEqual(t.pendientes, []);
  assert.ok(t.hecho! > 0);
});

test('recibo honesto: si un almacén no confirma, queda pendiente (y la marca protege); al volver S3 se completa', async () => {
  const p = 'recibo@prueba.local';
  const tok = sesion(p);
  await K.agregarDato(p, 'rutinas', 'Vive en Tela', 'vive');
  sembrarEpisodio(p, 'Contó que vive en Tela.', HACE_UN_DIA());
  putsFallan = new RegExp(`^${claveS3('episodios', p)}$`);
  let r;
  try {
    r = await pedir('/api/cerebro/conocer/olvidar', { method: 'POST', token: tok, body: JSON.stringify({ claves: [{ categoria: 'rutinas', clave: 'vive' }] }) });
  } finally {
    putsFallan = null;
  }
  assert.equal(r.status, 200);
  assert.equal(r.j.durable, false, 'no se promete lo que no quedó');
  assert.equal(r.j.recibo.estado, 'pendiente');
  assert.equal(r.j.recibo.almacenes.episodios, false);
  await E.precargarCerebro(p);
  assert.doesNotMatch(E.bloqueEpisodios(p, 'donde vive'), /Tela/, 'mientras tanto, la lectura ya lo filtra');
  // El reintento (la app vuelve a tocar «Olvidar») reanuda lo pendiente y confirma.
  const r2 = await pedir('/api/cerebro/conocer/olvidar', { method: 'POST', token: tok, body: JSON.stringify({ claves: [{ categoria: 'rutinas', clave: 'vive' }] }) });
  assert.equal(r2.j.durable, true);
  assert.equal(r2.j.recibo.estado, 'confirmado');
  assert.doesNotMatch(s3.get(claveS3('episodios', p))!, /Tela/);
  assert.ok((await S.tumbasDe(p)).every((t) => t.pendientes.length === 0));
});

test('borrar todo: una marca de todo; nada de antes vuelve por ningún camino, lo nuevo sí', async () => {
  const p = 'todo@prueba.local';
  const tok = sesion(p);
  const t0 = HACE_UN_DIA();
  await K.agregarDato(p, 'familia', 'Su esposa se llama Ana', 'esposa');
  await K.incorporarDatos(p, [{ categoria: 'gustos', dato: 'Le gusta pescar en Omoa', confianza: 0.7 }], { fuente: 'modelo' });
  const r = await pedir('/api/cerebro/conocer', { method: 'DELETE', token: tok });
  assert.equal(r.status, 200);
  assert.equal(r.j.durable, true);
  assert.equal(r.j.borrados, 2);
  await K.incorporarDatos(p, [{ categoria: 'familia', dato: 'Su esposa se llama Ana', clave: 'esposa' }], { fuente: 'modelo', dicho: t0 });
  assert.equal(datosDe((await pedir('/api/cerebro/conocer', { token: tok })).j).length, 0, 'lo de antes no vuelve');
  await espera(5);
  await K.incorporarDatos(p, [{ categoria: 'trabajo', dato: 'Abrió una ferretería', clave: 'empresa:ferreteria' }], { fuente: 'reglas' });
  assert.equal(datosDe((await pedir('/api/cerebro/conocer', { token: tok })).j).length, 1, 'lo que cuenta después sí se aprende');
});
