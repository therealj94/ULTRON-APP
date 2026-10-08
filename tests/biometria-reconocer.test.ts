/**
 * TANDA F1 (A-7, se EXIGE): un posible menor que la dueña todavía no confirmó EN SU PANTALLA no se usa para reconocer ni
 * se nombra en la escena del turno (lib/biometria-consentimiento.ts reconocible).
 *
 *  · caras: GET /api/caras lo lista con «por confirmar», quién lo presentó y cuándo, pero SIN vectores (el teléfono no
 *    puede reconocerlo); POST /api/caras/:id/confirmar y ya van sus vectores. Un adulto presentado, como siempre;
 *  · voces: POST /api/voces/quien no lo reconoce (ni lo compara) hasta que se confirme; después sí. El listado lo dice;
 *  · el campo `quienHabla` con su id no lo nombra (lib/voces-miembro.ts vozDelTurno → sin verificar: solo precaución);
 *  · la escena del teléfono pierde su nombre (lib/caras-turno.ts escenaSinPorConfirmar, server/modo-invitado.ts
 *    conModoInvitado): ni «Reconozco a Nora (tu hija)» ni «Por la voz, habla Nora…», y no se ofrece aprenderla otra vez.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biometria-reconocer-'));
process.env.ULTRON_CARAS_DIR = path.join(dir, 'caras');
process.env.ULTRON_VOCES_DIR = path.join(dir, 'voces');
process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(dir, 'cerradas.json');
process.env.ULTRON_SESION_SECRETO = 'secreto-de-prueba-largo-para-el-permiso-de-los-menores';
process.env.ULTRON_MEMORIA_BUCKET = '';
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const { montarRutasCaras } = await import('../server/caras-rutas');
const { montarRutasVoces } = await import('../server/voces-rutas');
const { emitirSesion, sesionDe, exigirMesa } = await import('../server/seguridad');
const caras = await import('../lib/caras-miembro');
const voces = await import('../lib/voces-miembro');
const motor = await import('../lib/voces-motor');
const turno = await import('../lib/caras-turno');
const invitado = await import('../server/modo-invitado');
const consent = await import('../lib/biometria-consentimiento');

/* ── el motor de voces falso (como tests/voces-rutas.test.ts): la huella es un pico en la frecuencia del tono ── */
const { _motorVocesDePrueba, FRECUENCIA, MODELO_VOZ } = motor;
function voz(frecuencia: number, segundos: number): Float32Array {
  const antes = Math.round(0.3 * FRECUENCIA);
  const n = antes + Math.round(segundos * FRECUENCIA);
  const out = new Float32Array(n);
  for (let i = antes; i < n; i++) {
    const t = (i - antes) / FRECUENCIA;
    out[i] = 0.3 * (0.55 + 0.45 * Math.sin(2 * Math.PI * 3.5 * t)) * Math.sin(2 * Math.PI * frecuencia * t);
  }
  return out;
}
function wavB64(m: Float32Array): string {
  const datos = Buffer.alloc(m.length * 2);
  m.forEach((x, i) => datos.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x * 32767))), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + datos.length, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(FRECUENCIA, 24);
  h.writeUInt32LE(FRECUENCIA * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(datos.length, 40);
  return Buffer.concat([h, datos]).toString('base64');
}
_motorVocesDePrueba({
  dim: MODELO_VOZ.dim,
  async huella(m: Float32Array) {
    let cruces = 0;
    for (let i = 1; i < m.length; i++) if (m[i - 1] < 0 !== m[i] < 0) cruces++;
    const centro = ((cruces / 2) * (FRECUENCIA / m.length)) / 10;
    return Array.from({ length: MODELO_VOZ.dim }, (_, i) => Math.exp(-((i - centro) ** 2) / 18) + 0.001);
  },
});
after(() => _motorVocesDePrueba(undefined));
const frases = (f: number) => [wavB64(voz(f, 2.2)), wavB64(voz(f * 1.01, 2.0)), wavB64(voz(f * 0.99, 2.4))];
const JOSE = 300;
const NORA = 900;
const RAUL = 1500;

const app = express();
app.use(express.json({ limit: '4mb' }));
const pasa = () => ((_q: express.Request, _s: express.Response, n: express.NextFunction) => n()) as express.RequestHandler;
montarRutasCaras(app, { exigirMesa, limitar: pasa, sesionDe });
montarRutasVoces(app, { exigirMesa, limitar: pasa, sesionDe });
const srv = app.listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
after(() => srv.close());

const CORREO = 'jose.f1@ordenglobal.org';
const jose = emitirSesion({ correo: CORREO, nombre: 'José', rol: 'Junta' }, { comunidad: true });
const h = (token: string) => ({ 'content-type': 'application/json', 'x-ultron-sesion': token });
const pedir = async (ruta: string, init: { method?: string; body?: unknown } = {}) => {
  const r = await fetch(`${base}${ruta}`, { method: init.method || 'GET', headers: h(jose.token), ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });
  return { status: r.status, j: (await r.json()) as any };
};
const vec = (semilla: number) => Array.from({ length: 128 }, (_, i) => Math.round(Math.sin(semilla * 7.3 + i) * 0.3 * 1e4) / 1e4);

test('caras: un posible menor por confirmar va en la lista SIN vectores (con quién lo presentó y cuándo); confirmado, con ellos', async () => {
  const antes = Date.now();
  let r = await pedir('/api/caras', { method: 'POST', body: { relacion: 'yo', vectores: [vec(1)], consentimiento: { como: 'dueño' } } });
  assert.equal(r.status, 200);
  r = await pedir('/api/caras', { method: 'POST', body: { nombre: 'Nora', relacion: 'conocido', parentesco: 'hija', vectores: [vec(2), vec(3)], consentimiento: { como: 'voz', frase: 'sí' } } });
  assert.equal(r.status, 200);
  assert.equal(r.j.persona.porConfirmar, true, 'el alta lo dice: el teléfono avisa que todavía no la reconoce');
  const idNora = r.j.persona.id;
  r = await pedir('/api/caras', { method: 'POST', body: { nombre: 'Raúl', relacion: 'conocido', parentesco: 'socio', vectores: [vec(4)], consentimiento: { como: 'voz', frase: 'sí' } } });
  assert.equal(r.j.persona.porConfirmar, undefined, 'un adulto presentado, como siempre');

  let lista = (await pedir('/api/caras')).j.personas as any[];
  const nora = lista.find((p) => p.nombre === 'Nora');
  assert.deepEqual(nora.vectores, [], 'sin vectores: el teléfono no puede reconocerla');
  assert.equal(nora.porConfirmar, true);
  assert.equal(nora.menor, true);
  assert.equal(nora.presentadoPor, 'José');
  assert.ok(nora.presentadoEn >= antes);
  for (const p of lista.filter((x) => x.nombre !== 'Nora')) {
    assert.equal(p.vectores.length > 0, true, `${p.nombre} sí se reconoce`);
    assert.equal(p.porConfirmar, undefined);
  }
  // El teléfono (mobile/src/caras/caras.ts) no la reconoce con esa lista, aunque su cara esté delante.
  const movil = await import('../mobile/src/caras/caras');
  assert.equal(movil.identificar(vec(2), lista)?.nombre, undefined);

  r = await pedir(`/api/caras/${idNora}/confirmar`, { method: 'POST', body: {} });
  assert.equal(r.status, 200);
  lista = (await pedir('/api/caras')).j.personas as any[];
  const confirmada = lista.find((p) => p.nombre === 'Nora');
  assert.equal(confirmada.vectores.length, 2, 'confirmada en pantalla: ya van sus vectores');
  assert.equal(confirmada.porConfirmar, undefined);
  assert.equal(movil.identificar(vec(2), lista)?.nombre, 'Nora');
  assert.equal((await pedir('/api/caras/no-existe/confirmar', { method: 'POST', body: {} })).status, 404);
});

test('voces: /quien no reconoce (ni compara) a un posible menor por confirmar; confirmado, sí', async () => {
  let r = await pedir('/api/voces/aprender', { method: 'POST', body: { relacion: 'yo', audios: frases(JOSE), consentimiento: { como: 'dueño' } } });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  r = await pedir('/api/voces/aprender', { method: 'POST', body: { nombre: 'Nora', relacion: 'conocido', parentesco: 'hija', audios: frases(NORA), consentimiento: { como: 'voz', frase: 'sí' } } });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.persona.porConfirmar, true, 'el alta lo dice (el teléfono no dice «ya reconozco tu voz»)');
  const idNora = r.j.persona.id;
  r = await pedir('/api/voces/aprender', { method: 'POST', body: { nombre: 'Raúl', relacion: 'conocido', parentesco: 'socio', audios: frases(RAUL), consentimiento: { como: 'voz', frase: 'sí' } } });
  assert.equal(r.j.persona.porConfirmar, undefined);

  const lista = (await pedir('/api/voces')).j.personas as any[];
  const nora = lista.find((p) => p.nombre === 'Nora');
  assert.deepEqual([nora.porConfirmar, nora.menor, nora.presentadoPor], [true, true, 'José']);

  r = await pedir('/api/voces/quien', { method: 'POST', body: { audio: wavB64(voz(NORA, 2.5)) } });
  assert.equal(r.status, 200);
  assert.equal(r.j.persona, null, 'Nora habla y no se la nombra');
  assert.equal((await pedir('/api/voces/quien', { method: 'POST', body: { audio: wavB64(voz(RAUL, 2.5)) } })).j.persona?.nombre, 'Raúl', 'los demás, como siempre');

  // La regla en la librería: la voz por confirmar no entra a la comparación.
  const cajon = await voces.cargarVoces(CORREO);
  const pNora = cajon.personas.find((p) => p.nombre === 'Nora')!;
  assert.equal(consent.reconocible(pNora.consentimiento), false);
  assert.equal(voces.identificarVoz(pNora.vectores[0], [pNora]).motivo, 'sin_voces');

  // `quienHabla` con su id: no se nombra (solo precaución: «sin verificar»).
  const sesion = { correo: CORREO, nombre: 'José' };
  assert.deepEqual(await voces.vozDelTurno({ quienHabla: { id: idNora }, origen: 'app', sesion }), { tipo: 'sin_verificar', reciente: false });
  assert.deepEqual(await voces.nombresVocesPorConfirmar(CORREO), ['Nora']);

  r = await pedir(`/api/voces/${idNora}/confirmar`, { method: 'POST', body: {} });
  assert.equal(r.status, 200);
  assert.equal((await pedir('/api/voces/quien', { method: 'POST', body: { audio: wavB64(voz(NORA, 2.5)) } })).j.persona?.nombre, 'Nora', 'confirmada: ya se reconoce');
  const v = await voces.vozDelTurno({ quienHabla: { id: idNora }, origen: 'app', sesion });
  assert.equal(v.tipo, 'otra');
  assert.deepEqual(await voces.nombresVocesPorConfirmar(CORREO), []);
});

test('escena: el nombre de quien espera la confirmación sale; queda alguien sin nombre y no se ofrece aprenderla otra vez', () => {
  const q = turno.escenaSinPorConfirmar;
  assert.equal(q('Reconozco a Nora (tu hija), José (quien te habla); 1 persona(s) que no conozco', ['Nora']), 'Reconozco a José (quien te habla); 1 persona(s) que no conozco; 1 persona(s) guardada(s) que todavía no puedo reconocer (falta que la dueña lo confirme en su pantalla): no la nombres');
  const sola = q('Reconozco a nora (tu hija)', ['Nora']);
  assert.doesNotMatch(sola, /nora/i);
  assert.match(sola, /^1 persona\(s\) guardada\(s\) que todavía no puedo reconocer/);
  assert.doesNotMatch(q('Con la cámara trasera: reconozco a Nóra (tu hija)', ['Nora']), /Nóra|trasera:\s*;/);
  assert.equal(q('I recognize Nora (your hija), José', ['Nora']), "I recognize José; 1 saved person(s) I can't recognize yet (the owner still has to confirm it on screen): don't name them");
  assert.doesNotMatch(q('Una mesa. Por la voz, habla Nora (hija de José), no José.', ['Nora']), /Nora/);
  assert.doesNotMatch(q('By voice, Nora is speaking (José\'s hija), not José.', ['Nora']), /Nora/);
  // Sin nadie por confirmar, o sin que lo nombre, igual que antes.
  assert.equal(q('Reconozco a Ana (tu esposa)', ['Nora']), 'Reconozco a Ana (tu esposa)');
  assert.equal(q('Reconozco a Ana (tu esposa)', []), 'Reconozco a Ana (tu esposa)');
  assert.equal(q('Reconozco a Noralí', ['Nora']), 'Reconozco a Noralí', 'solo el nombre entero');
  // El hecho CARAS no la cuenta como desconocida (no se le ofrece aprender otra vez su cara).
  turno.olvidarOfertasCaras();
  const hecho = turno.hechoCaras({ escena: sola, mensaje: '¿quién está conmigo?', ambito: 'a|1' });
  assert.doesNotMatch(String(hecho), /aprendo su cara/);
});

test('el turno: conModoInvitado le quita a la escena el nombre de quien espera la confirmación (cara o voz)', async () => {
  // Una cara nueva por confirmar (la de antes ya se confirmó arriba).
  const r = await pedir('/api/caras', { method: 'POST', body: { nombre: 'Mía', relacion: 'conocido', parentesco: 'sobrina', vectores: [vec(9)], consentimiento: { como: 'voz', frase: 'sí' } } });
  assert.equal(r.j.persona.porConfirmar, true);
  assert.deepEqual(await caras.nombresCarasPorConfirmar(CORREO), ['Mía']);
  const body = { message: '¿quién está aquí?', origen: 'app', sesion: { correo: CORREO, nombre: 'José' }, escena: 'Reconozco a Mía (tu sobrina), Raúl (tu socio)' };
  const out = (await invitado.conModoInvitado(body)) as any;
  assert.doesNotMatch(out.escena, /Mía/);
  assert.match(out.escena, /^Reconozco a Raúl \(tu socio\); 1 persona\(s\) guardada\(s\) que todavía no puedo reconocer/);
  assert.equal(out.modoInvitado, undefined, 'no es invitado: solo pierde ese nombre');
  // Sin la sesión de la app (web, Telegram), no se mira nada.
  assert.equal(((await invitado.conModoInvitado({ ...body, origen: undefined })) as any).escena, body.escena);
  // Confirmada en pantalla: su nombre vuelve a la escena.
  const id = (await caras.cargarCaras(CORREO)).personas.find((p) => p.nombre === 'Mía')!.id;
  await pedir(`/api/caras/${id}/confirmar`, { method: 'POST', body: {} });
  assert.equal(((await invitado.conModoInvitado(body)) as any).escena, body.escena);
});
