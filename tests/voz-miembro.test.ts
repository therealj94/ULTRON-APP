/**
 * La voz con miembros de la comunidad (server/voz-agente.ts + server/tope-voz.ts):
 *
 *   · el pase de voz lleva el nivel FIRMADO (junta o miembro); no se puede cambiar sin romper la
 *     firma, y en cada turno vale el más estrecho entre el firmado y el que dice hoy el padrón;
 *   · un miembro tiene minutos de voz al día (VOZ_MIEMBRO_MIN_DIA, 10 por omisión): sin minutos no
 *     abre conversación (y ni se le pide permiso a ElevenLabs), el pase vence cuando se acaban y un
 *     turno pasado el tope solo dice, con amabilidad, que sigamos por escrito;
 *   · la junta, sin tope y con su nivel de siempre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voz-miembro-'));
process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(dir, 'cerradas.json');
process.env.ULTRON_SESION_SECRETO = 'secreto-de-prueba-largo-para-la-voz-de-miembros';
process.env.ULTRON_MEMORIA_BUCKET = '';
process.env.ULTRON_PADRON = '';
process.env.ELEVENLABS_API_KEY = 'xi-de-prueba';
delete process.env.VOZ_MIEMBRO_MIN_DIA;

const { emitirPase, leerPase, montarVozAgente, abrirConversacion, ETIQUETA_SECRETO_LLM, PASE_TTL_MS, _reiniciarConversaciones } = await import('../server/voz-agente');
const { secretoDerivado, emitirSesion, sesionDe } = await import('../server/seguridad');
const { anotarVoz, restanteVozMs, vozUsadaMs, topeVozMinDia, fraseTopeVoz, msDeHabla, diaHonduras, _reiniciarTopeVoz, VOZ_MIEMBRO_MIN_DIA_DEFECTO } = await import('../server/tope-voz');
type TurnoVoz = import('../server/voz-agente').TurnoVoz;

const BEARER = `Bearer ${secretoDerivado(ETIQUETA_SECRETO_LLM)}`;
const JOSE = 'j.ordonez@ordenglobal.org';
let n = 0;
const miembro = () => emitirSesion({ correo: `miembro${++n}@gmail.com`, nombre: 'José', rol: 'Miembro · Genesis ID' });
const jose = () => emitirSesion({ correo: JOSE, nombre: 'José', rol: 'Junta Directiva · Orden Global' });

const pedidasAEleven: string[] = [];
const elevenFalso: typeof fetch = (async (url: any) => {
  pedidasAEleven.push(String(url));
  return new Response(JSON.stringify({ token: 'tok-webrtc' }), { status: 200, headers: { 'content-type': 'application/json' } });
}) as any;

async function montar() {
  const app = express();
  app.use(express.json());
  const vistos: TurnoVoz[] = [];
  const pasa: express.RequestHandler = (_q, _s, next) => next();
  montarVozAgente(app, {
    exigirMesaODesk: pasa,
    limitar: () => pasa,
    sesionDe,
    fetch: elevenFalso,
    turno: async (t) => {
      vistos.push(t);
      t.enviar('delta', { text: 'Hola.', voz: 'Hola.' });
      t.enviar('done', { reply: 'Hola.' });
    },
  });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return { base, vistos, cerrar: () => new Promise((r) => srv.close(r)) };
}

const abrir = (base: string, token: string) =>
  fetch(`${base}/api/voz/agente`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ultron-sesion': token }, body: JSON.stringify({ avatar: 'aura', idioma: 'es' }) });

const llm = (base: string, pase: string, texto = 'Hola') =>
  fetch(`${base}/api/voz/llm/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: BEARER, 'x-pase': pase },
    body: JSON.stringify({ model: 'aura', stream: true, messages: [{ role: 'user', content: texto }] }),
  });

const dichoDe = (texto: string) =>
  texto
    .split('\n\n')
    .filter((l) => l.startsWith('data: {'))
    .map((l) => JSON.parse(l.slice(6)).choices[0].delta.content || '')
    .join('');

test('el pase lleva el nivel firmado: no se cambia sin romper la firma', () => {
  const s = miembro();
  const p = emitirPase(s, 'aura', 'es', { nivel: 'miembro' });
  assert.equal(leerPase(p.pase)?.nivel, 'miembro');
  assert.equal(leerPase(emitirPase(jose(), 'aura', 'es', { nivel: 'junta' }).pase)?.nivel, 'junta');
  assert.equal(leerPase(emitirPase(s, 'aura', 'es').pase)?.nivel, null, 'un pase sin nivel (de antes) se recalcula en el servidor');
  // Cambiar `nv` a mano (cliente o quien tenga el pase) rompe la firma: el pase deja de valer.
  const [pre, cuerpo, firma] = p.pase.split('.');
  const d = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
  d.nv = 'junta';
  const falso = `${pre}.${Buffer.from(JSON.stringify(d)).toString('base64url')}.${firma}`;
  assert.equal(leerPase(falso), null);
});

test('abrir la conversación: el servidor firma el nivel por el correo de la sesión, no por el nombre', async () => {
  _reiniciarConversaciones();
  _reiniciarTopeVoz();
  const s = await montar();
  try {
    const rm = await abrir(s.base, miembro().token);
    assert.equal(rm.status, 200);
    const pm = leerPase((await rm.json()).pase)!;
    assert.equal(pm.nivel, 'miembro', 'se llama José, pero su correo no está en el padrón');
    assert.equal(pm.tope, true, 'con 10 minutos de voz, el pase vence antes que los 20 de siempre');
    assert.ok(pm.exp <= Date.now() + VOZ_MIEMBRO_MIN_DIA_DEFECTO * 60_000 + 1000);

    const rj = await abrir(s.base, jose().token);
    const pj = leerPase((await rj.json()).pase)!;
    assert.equal(pj.nivel, 'junta');
    assert.equal(pj.tope, false, 'la junta no tiene tope');
    assert.ok(pj.exp > Date.now() + PASE_TTL_MS - 5000);
  } finally {
    await s.cerrar();
  }
});

test('en cada turno vale el nivel más estrecho: un pase de junta de alguien fuera del padrón habla como miembro', async () => {
  _reiniciarConversaciones();
  _reiniciarTopeVoz();
  const s = await montar();
  try {
    // Firmado como junta (lo sacaron del padrón después de abrir): hoy su correo dice miembro.
    const fuera = miembro();
    const p1 = emitirPase(fuera, 'aura', 'es', { nivel: 'junta' });
    abrirConversacion(fuera.correo, p1.cid);
    assert.equal((await llm(s.base, p1.pase)).status, 200);
    assert.equal(s.vistos.at(-1)!.persona.nivel, 'miembro');

    const j = jose();
    const p2 = emitirPase(j, 'aura', 'es', { nivel: 'junta' });
    abrirConversacion(j.correo, p2.cid);
    await (await llm(s.base, p2.pase)).text();
    assert.equal(s.vistos.at(-1)!.persona.nivel, 'junta');

    // Firmado como miembro, aunque el correo sea de la junta: miembro (lo firmado no se agranda).
    const p3 = emitirPase(j, 'aura', 'es', { nivel: 'miembro' });
    abrirConversacion(j.correo, p3.cid);
    await (await llm(s.base, p3.pase)).text();
    assert.equal(s.vistos.at(-1)!.persona.nivel, 'miembro');
  } finally {
    await s.cerrar();
  }
});

test('tope diario: sin minutos, un miembro no abre conversación y ni se le pide permiso a ElevenLabs; la junta sí', async () => {
  _reiniciarConversaciones();
  _reiniciarTopeVoz();
  const s = await montar();
  process.env.VOZ_MIEMBRO_MIN_DIA = '0';
  try {
    pedidasAEleven.length = 0;
    const r = await abrir(s.base, miembro().token);
    assert.equal(r.status, 429);
    const j = await r.json();
    assert.equal(j.codigo, 'TOPE_VOZ');
    assert.match(j.error, /chat escrito/, 'mensaje amable, con salida');
    assert.equal(pedidasAEleven.length, 0, 'no se gastó ni el pedido del permiso');
    assert.equal((await abrir(s.base, jose().token)).status, 200, 'la junta no tiene tope');
  } finally {
    delete process.env.VOZ_MIEMBRO_MIN_DIA;
    await s.cerrar();
  }
});

test('tope diario: pasado el tope a mitad de charla, el turno solo dice que sigamos por escrito (sin cerebro)', async () => {
  _reiniciarConversaciones();
  _reiniciarTopeVoz();
  const s = await montar();
  try {
    const m = miembro();
    const r = await abrir(s.base, m.token);
    const { pase } = await r.json();
    assert.equal(dichoDe(await (await llm(s.base, pase)).text()), 'Hola.', 'con minutos, habla el cerebro');
    const antes = s.vistos.length;
    anotarVoz(m.correo, 11 * 60_000);
    const dicho = dichoDe(await (await llm(s.base, pase, '¿Seguimos?')).text());
    assert.equal(dicho, fraseTopeVoz('es'));
    assert.equal(s.vistos.length, antes, 'el cerebro no se despertó');
    // La junta, con cualquier cantidad, sigue.
    const j = jose();
    const pj = (await (await abrir(s.base, j.token)).json()).pase;
    anotarVoz(j.correo, 60 * 60_000);
    assert.equal(dichoDe(await (await llm(s.base, pj)).text()), 'Hola.');
  } finally {
    await s.cerrar();
  }
});

test('el contador de voz: por persona, por día de Honduras, configurable', () => {
  _reiniciarTopeVoz();
  assert.equal(topeVozMinDia(), 10);
  process.env.VOZ_MIEMBRO_MIN_DIA = '3';
  assert.equal(topeVozMinDia(), 3);
  process.env.VOZ_MIEMBRO_MIN_DIA = 'muchos';
  assert.equal(topeVozMinDia(), 10, 'lo que no es número se ignora');
  process.env.VOZ_MIEMBRO_MIN_DIA = '-2';
  assert.equal(topeVozMinDia(), 10);
  delete process.env.VOZ_MIEMBRO_MIN_DIA;
  const hoy = Date.parse('2026-09-30T18:00:00Z');
  anotarVoz('Ana@Gmail.com', 4 * 60_000, hoy);
  anotarVoz('ana@gmail.com', -50, hoy);
  assert.equal(vozUsadaMs('ana@gmail.com', hoy), 4 * 60_000, 'sin mayúsculas y sin restar');
  assert.equal(restanteVozMs('ana@gmail.com', hoy), 6 * 60_000);
  assert.equal(restanteVozMs('otra@gmail.com', hoy), 10 * 60_000, 'una persona no gasta el de otra');
  // Medianoche en Honduras (UTC-6): 06:30 UTC del día siguiente ya es otro día.
  const manana = Date.parse('2026-10-01T06:30:00Z');
  assert.notEqual(diaHonduras(hoy), diaHonduras(manana));
  assert.equal(restanteVozMs('ana@gmail.com', manana), 10 * 60_000);
  assert.equal(msDeHabla('x'.repeat(150)), 10_000, 'quince caracteres por segundo');
  assert.match(fraseTopeVoz('en'), /written chat/);
});
