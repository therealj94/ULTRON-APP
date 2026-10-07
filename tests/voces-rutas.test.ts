/**
 * Las voces conocidas (server/voces-rutas.ts + lib/voces-miembro.ts + lib/voces-motor.ts) con las
 * sesiones de verdad y un MOTOR FALSO (el de verdad, sherpa-onnx, se prueba aparte con
 * scripts/voces-motor-prueba.ts sobre voces reales):
 *
 *  · sin sesión, nada (401); las voces son del correo de la SESIÓN, nunca del cuerpo;
 *  · solo audio que se pueda oír (WAV 16 kHz mono 16 bits o PCM crudo, hasta 12 s); el silencio no se
 *    aprende ni se reconoce; en el disco quedan números, nunca el audio;
 *  · el permiso: la voz propia la pide la dueña; la de otra persona solo con su «sí» dicho (constancia),
 *    y no se guarda la voz de la dueña con el nombre de otra;
 *  · reconocer: la persona correcta con su parentesco, «nadie» para una voz desconocida, y «dudosa» si
 *    dos personas quedan parejas (umbral + margen);
 *  · la dueña es una sola y suma huellas hasta `MAX_MUESTRAS`;
 *  · olvidar de verdad (una y todas); cada quien ve solo las suyas;
 *  · sin motor (no bajó el modelo, sin binario): aprender y reconocer dicen «no disponible» (503) y
 *    listar y borrar siguen andando;
 *  · la regla para el cerebro cuando la voz dice que quien habla no es la dueña.
 */
import './datos-prueba'; // la junta inventada de las pruebas (lo real vive en Render)
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voces-rutas-'));
process.env.ULTRON_VOCES_DIR = path.join(dir, 'voces');
process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(dir, 'cerradas.json');
process.env.ULTRON_SESION_SECRETO = 'secreto-de-prueba-largo-para-las-voces-de-aura';
process.env.ULTRON_MEMORIA_BUCKET = '';
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const { montarRutasVoces } = await import('../server/voces-rutas');
const { emitirSesion, sesionDe, exigirMesa } = await import('../server/seguridad');
const miembro = await import('../lib/voces-miembro');
const motor = await import('../lib/voces-motor');
const { huellaVoces, _olvidarCacheVoces, _s3DePrueba, MAX_MUESTRAS, identificarVoz, reglaQuienHabla } = miembro;
const { _motorVocesDePrueba, muestrasDeAudio, soloVoz, FRECUENCIA, MODELO_VOZ } = motor;

/*
 * Voces sintéticas: una «voz» es un tono propio (su frecuencia) que sube y baja como sílabas. El motor
 * falso estima esa frecuencia (cruces por cero) y devuelve una huella con un pico en ese lugar: la misma
 * voz da casi la misma huella; voces lejanas, huellas casi ortogonales.
 */
function voz(frecuencia: number, segundos: number, opts: { silencioAntes?: number; volumen?: number } = {}): Float32Array {
  const antes = Math.round((opts.silencioAntes ?? 0.3) * FRECUENCIA);
  const n = antes + Math.round(segundos * FRECUENCIA);
  const out = new Float32Array(n);
  for (let i = antes; i < n; i++) {
    const t = (i - antes) / FRECUENCIA;
    const silaba = 0.55 + 0.45 * Math.sin(2 * Math.PI * 3.5 * t);
    out[i] = (opts.volumen ?? 0.3) * silaba * Math.sin(2 * Math.PI * frecuencia * t);
  }
  return out;
}
function wavB64(m: Float32Array, frecuencia = FRECUENCIA): string {
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
  h.writeUInt32LE(frecuencia, 24);
  h.writeUInt32LE(frecuencia * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(datos.length, 40);
  return Buffer.concat([h, datos]).toString('base64');
}
let llamadasMotor = 0;
const motorFalso = {
  dim: MODELO_VOZ.dim,
  async huella(m: Float32Array) {
    llamadasMotor++;
    let cruces = 0;
    for (let i = 1; i < m.length; i++) if (m[i - 1] < 0 !== m[i] < 0) cruces++;
    const f = (cruces / 2) * (FRECUENCIA / m.length);
    const centro = f / 10;
    return Array.from({ length: MODELO_VOZ.dim }, (_, i) => Math.exp(-((i - centro) ** 2) / 18) + 0.001);
  },
};
_motorVocesDePrueba(motorFalso);
after(() => _motorVocesDePrueba(undefined));

const JOSE = 300;
const ANA = 900;
const DESCONOCIDO = 1500;

const app = express();
app.use(express.json({ limit: '4mb' }));
const pasa = () => ((_q: express.Request, _s: express.Response, n: express.NextFunction) => n()) as express.RequestHandler;
montarRutasVoces(app, { exigirMesa, limitar: pasa, sesionDe });
const srv = app.listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
after(() => srv.close());

const junta = emitirSesion({ correo: 'Jose.H@Ordenglobal.org', nombre: 'José', rol: 'Junta' }, { comunidad: true });
const otro = emitirSesion({ correo: 'comunidad@gmail.com', nombre: 'Lucía', rol: 'Miembro · Genesis ID' }, { comunidad: true });
const h = (token?: string) => ({ 'content-type': 'application/json', ...(token ? { 'x-ultron-sesion': token } : {}) });
const aprender = (token: string, body: unknown) => fetch(`${base}/api/voces/aprender`, { method: 'POST', headers: h(token), body: JSON.stringify(body) });
const quien = async (token: string, audio: string) => {
  const r = await fetch(`${base}/api/voces/quien`, { method: 'POST', headers: h(token), body: JSON.stringify({ audio }) });
  return { status: r.status, j: (await r.json()) as any };
};
const listar = async (token: string) => ((await (await fetch(`${base}/api/voces`, { headers: h(token) })).json()) as any).personas as any[];
const archivo = (correo: string) => path.join(process.env.ULTRON_VOCES_DIR!, `${huellaVoces(correo)}.json`);
/** A-7: lo guardado va en sobre (lib/biometria-sobre.ts); para mirarlo hay que abrirlo con la llave del servidor. */
const { abrirBiometria, esSobre } = await import('../lib/biometria-sobre');
const delDisco = (correo: string) => abrirBiometria(JSON.parse(fs.readFileSync(archivo(correo), 'utf8')), { tipo: 'voces', huella: huellaVoces(correo) }).dato as any;
const frases = (f: number) => [wavB64(voz(f, 2.2)), wavB64(voz(f * 1.01, 2.0)), wavB64(voz(f * 0.99, 2.4))];

test('sin sesión no hay voces: GET, POST y DELETE son 401', async () => {
  assert.equal((await fetch(`${base}/api/voces`)).status, 401);
  assert.equal((await fetch(`${base}/api/voces/aprender`, { method: 'POST', headers: h(), body: '{}' })).status, 401);
  assert.equal((await fetch(`${base}/api/voces/quien`, { method: 'POST', headers: h(), body: '{}' })).status, 401);
  assert.equal((await fetch(`${base}/api/voces`, { method: 'DELETE' })).status, 401);
  assert.equal((await fetch(`${base}/api/voces/abc`, { method: 'DELETE' })).status, 401);
  assert.equal((await fetch(`${base}/api/voces`, { headers: h('u1.basura.firma') })).status, 401);
});

test('el audio: WAV 16 kHz mono 16 bits o PCM crudo; lo demás no se oye', () => {
  const m = voz(JOSE, 1);
  const wav = muestrasDeAudio(wavB64(m))!;
  assert.equal(wav.length, m.length);
  assert.ok(Math.abs(wav[8000] - m[8000]) < 1e-3);
  const crudo = Buffer.from(Buffer.from(wavB64(m), 'base64').subarray(44)).toString('base64');
  assert.equal(muestrasDeAudio(crudo)!.length, m.length);
  assert.equal(muestrasDeAudio(wavB64(m, 44100)), null, 'otra frecuencia');
  assert.equal(muestrasDeAudio('esto no es base64 ¡!'), null);
  assert.equal(muestrasDeAudio(wavB64(voz(JOSE, 13))), null, 'más de 12 s');
  assert.equal(muestrasDeAudio(12345), null);
  // Solo la voz: los silencios largos se quitan y el silencio puro no tiene voz.
  const sv = soloVoz(voz(JOSE, 2, { silencioAntes: 2 }));
  assert.ok(sv.vozSeg > 1.6 && sv.vozSeg <= 2.05, String(sv.vozSeg));
  assert.ok(sv.muestras.length < 2.4 * FRECUENCIA);
  assert.equal(soloVoz(new Float32Array(3 * FRECUENCIA)).vozSeg, 0);
  const ruidito = Float32Array.from({ length: 3 * FRECUENCIA }, () => (Math.random() - 0.5) * 0.004);
  assert.ok(soloVoz(ruidito).vozSeg < 0.2, 'un cuarto callado no es voz');
});

test('validación: permiso, nombre y audio; el silencio no se aprende', async () => {
  const yo = { relacion: 'yo', audios: frases(JOSE), consentimiento: { como: 'dueño' } };
  // Otra persona sin su «sí»: no.
  let r = await aprender(junta.token, { nombre: 'Ana', relacion: 'conocido', audios: frases(ANA), consentimiento: { como: 'dueño' } });
  assert.equal(r.status, 400);
  assert.match(((await r.json()) as any).error, /tiene que decir que sí/);
  r = await aprender(junta.token, { nombre: 'Ana', relacion: 'conocido', audios: frases(ANA), consentimiento: { como: 'voz', frase: '' } });
  assert.equal(r.status, 400);
  // La propia con un «como» que no es de ella: no.
  r = await aprender(junta.token, { ...yo, consentimiento: { como: 'voz', frase: 'sí' } });
  assert.equal(r.status, 400);
  // Sin relación, sin nombre, sin audio, demasiados audios, audio raro: no.
  assert.equal((await aprender(junta.token, { ...yo, relacion: 'jefe' })).status, 400);
  assert.equal((await aprender(junta.token, { relacion: 'conocido', audios: frases(ANA), consentimiento: { como: 'voz', frase: 'sí' } })).status, 400);
  assert.equal((await aprender(junta.token, { ...yo, audios: [] })).status, 400);
  assert.equal((await aprender(junta.token, { ...yo, audios: [...frases(JOSE), ...frases(JOSE)] })).status, 400);
  assert.equal((await aprender(junta.token, { ...yo, audios: [wavB64(voz(JOSE, 2), 8000)] })).status, 400);
  // Silencio o muy poca voz: «necesito oír más», y el motor ni se llama.
  const antes = llamadasMotor;
  r = await aprender(junta.token, { ...yo, audios: [wavB64(new Float32Array(3 * FRECUENCIA)), wavB64(voz(JOSE, 1.2))] });
  assert.equal(r.status, 400);
  assert.equal(((await r.json()) as any).code, 'poca_voz');
  assert.equal(llamadasMotor, antes);
  assert.deepEqual(await listar(junta.token), []);
});

test('aprender: la propia (nombre de la SESIÓN) y Ana con su «sí» y parentesco; en disco, números', async () => {
  let r = await aprender(junta.token, { nombre: 'Otro Nombre', relacion: 'yo', audios: frases(JOSE), consentimiento: { como: 'dueño' } });
  assert.equal(r.status, 200);
  const yo = ((await r.json()) as any).persona;
  assert.equal(yo.nombre, 'José');
  assert.equal(yo.muestras, 4, 'una huella por frase y una de las tres juntas');
  r = await aprender(junta.token, { nombre: 'Ana', relacion: 'conocido', parentesco: 'esposa', audios: frases(ANA), consentimiento: { como: 'voz', frase: 'Sí, puedes recordar mi voz' } });
  assert.equal(r.status, 200);
  const l = await listar(junta.token);
  assert.deepEqual(l.map((p) => [p.nombre, p.relacion, p.parentesco || null]).sort(), [['Ana', 'conocido', 'esposa'], ['José', 'yo', null]]);
  assert.ok(l.every((p) => !('vectores' in p)), 'las huellas no salen del servidor');
  // A-7: en el disco va cifrado: ni la frase, ni el nombre, ni un número de la huella se leen sin la llave.
  const sobre = fs.readFileSync(archivo('jose.h@ordenglobal.org'), 'utf8');
  assert.ok(esSobre(JSON.parse(sobre)));
  // (Solo patrones que no pueden salir del base64url al azar: con tildes, espacios o largos.)
  assert.doesNotMatch(sobre, /recordar mi voz|José|vectores|consentimiento|"personas"/);
  assert.deepEqual(Object.keys(JSON.parse(sobre)).sort(), ['alg', 'datos', 'iv', 'kid', 'llave', 'sobre', 'tag', 'tipo', 'v']);
  const crudo = JSON.stringify(delDisco('jose.h@ordenglobal.org'));
  assert.match(crudo, /Sí, puedes recordar mi voz/);
  assert.doesNotMatch(crudo, /RIFF|UklGR|base64|audio/i, 'ni rastro del audio');
  assert.equal(JSON.parse(crudo).modelo, MODELO_VOZ.id);
  assert.doesNotMatch(archivo('jose.h@ordenglobal.org'), /jose|ordenglobal/i);
});

test('reconocer: Ana con su parentesco, José, «nadie» para una voz nueva; el silencio no se compara', async () => {
  let q = await quien(junta.token, wavB64(voz(ANA * 1.005, 2.5)));
  assert.equal(q.status, 200);
  assert.deepEqual(q.j.persona && { nombre: q.j.persona.nombre, relacion: q.j.persona.relacion, parentesco: q.j.persona.parentesco }, { nombre: 'Ana', relacion: 'conocido', parentesco: 'esposa' });
  assert.equal(q.j.motivo, 'reconocida');
  assert.ok(q.j.similitud > 0.9);
  q = await quien(junta.token, wavB64(voz(JOSE, 3)));
  assert.equal(q.j.persona?.relacion, 'yo');
  q = await quien(junta.token, wavB64(voz(DESCONOCIDO, 3)));
  assert.equal(q.j.persona, null);
  assert.equal(q.j.motivo, 'nadie_cerca');
  const antes = llamadasMotor;
  q = await quien(junta.token, wavB64(new Float32Array(2 * FRECUENCIA)));
  assert.deepEqual([q.j.persona, q.j.motivo], [null, 'silencio']);
  q = await quien(junta.token, wavB64(voz(ANA, 0.8)));
  assert.deepEqual([q.j.persona, q.j.motivo], [null, 'muy_corta']);
  assert.equal(llamadasMotor, antes, 'sin voz suficiente el motor ni se llama');
  assert.equal((await quien(junta.token, 'nada')).status, 400);
  // Quien no tiene voces guardadas: «sin voces», sin motor.
  q = await quien(otro.token, wavB64(voz(ANA, 3)));
  assert.deepEqual([q.j.persona, q.j.motivo], [null, 'sin_voces']);
});

test('umbral y margen: «dudosa» si dos personas quedan parejas; mejor no sé que otro nombre', () => {
  const e = (i: number, j?: number) => {
    const v = new Array(MODELO_VOZ.dim).fill(0);
    v[i] = j === undefined ? 1 : Math.SQRT1_2;
    if (j !== undefined) v[j] = Math.SQRT1_2;
    return v;
  };
  const p = (id: string, vectores: number[][]) => ({ id, nombre: id, relacion: 'conocido' as const, vectores, consentimiento: { como: 'voz' as const, t: 0 }, creado: 0, actualizado: 0 });
  const ana = p('Ana', [e(0)]);
  const eva = p('Eva', [e(1)]);
  assert.equal(identificarVoz(e(0), [ana, eva]).persona?.id, 'Ana');
  // Justo entre las dos (0,707 con cada una): ninguna gana por el margen.
  const r = identificarVoz(e(0, 1), [ana, eva]);
  assert.deepEqual([r.persona, r.motivo], [null, 'dudosa']);
  // Con una sola persona la misma huella sí es suya (sobre el umbral y sin rival)…
  assert.equal(identificarVoz(e(0, 1), [ana]).persona?.id, 'Ana');
  // …pero bajo el umbral, no.
  assert.equal(identificarVoz(e(2), [ana, eva]).motivo, 'nadie_cerca');
  assert.equal(identificarVoz(e(0), []).motivo, 'sin_voces');
  // Lo que se parece a una persona es lo más que se parece a cualquiera de sus muestras.
  assert.equal(identificarVoz(e(3), [p('Ana', [e(0), e(3)])]).persona?.id, 'Ana');
});

test('no se guarda la voz de la dueña con el nombre de otra persona', async () => {
  const r = await aprender(junta.token, { nombre: 'Beto', relacion: 'conocido', audios: frases(JOSE), consentimiento: { como: 'voz', frase: 'sí' } });
  assert.equal(r.status, 409);
  assert.equal(((await r.json()) as any).code, 'voz_de_la_duena');
  assert.ok(!(await listar(junta.token)).some((p) => p.nombre === 'Beto'));
});

test('la dueña es una sola y suma huellas (hasta MAX_MUESTRAS); un conocido con el mismo nombre también', async () => {
  for (let i = 0; i < 3; i++) await aprender(junta.token, { relacion: 'yo', audios: frases(JOSE * (1 + i * 0.002)), consentimiento: { como: 'dueño' } });
  await aprender(junta.token, { nombre: 'ána', relacion: 'conocido', audios: frases(ANA), consentimiento: { como: 'voz', frase: 'sí' } });
  const l = await listar(junta.token);
  const yo = l.filter((p) => p.relacion === 'yo');
  assert.equal(yo.length, 1);
  assert.equal(yo[0].muestras, MAX_MUESTRAS);
  const conocidas = l.filter((p) => p.relacion === 'conocido');
  assert.equal(conocidas.length, 1, '«ána» es la misma Ana');
  assert.equal(conocidas[0].parentesco, 'esposa', 'el parentesco se conserva si no se dice otro');
  const enDisco = delDisco('jose.h@ordenglobal.org');
  assert.ok(enDisco.personas.every((p: any) => p.vectores.length <= MAX_MUESTRAS));
});

test('cada quien ve solo las suyas y no borra las de otro', async () => {
  assert.deepEqual(await listar(otro.token), []);
  const idAna = (await listar(junta.token)).find((p) => p.relacion === 'conocido').id;
  assert.equal((await fetch(`${base}/api/voces/${idAna}`, { method: 'DELETE', headers: h(otro.token) })).status, 404);
  assert.ok((await listar(junta.token)).some((p) => p.id === idAna));
  // El correo del cuerpo no cuenta: se guarda en la cuenta de la sesión.
  await aprender(otro.token, { relacion: 'yo', correo: 'jose.h@ordenglobal.org', audios: frases(DESCONOCIDO), consentimiento: { como: 'dueño' } });
  assert.deepEqual((await listar(otro.token)).map((p) => p.nombre), ['Lucía']);
  assert.ok(!(await listar(junta.token)).some((p) => p.nombre === 'Lucía'));
});

test('sin motor: aprender y reconocer dicen «no disponible»; listar y borrar siguen andando', async () => {
  _motorVocesDePrueba(null);
  try {
    let r = await aprender(junta.token, { relacion: 'yo', audios: frases(JOSE), consentimiento: { como: 'dueño' } });
    assert.equal(r.status, 503);
    assert.equal(((await r.json()) as any).code, 'voces_no_disponible');
    const q = await quien(junta.token, wavB64(voz(ANA, 3)));
    assert.equal(q.status, 503);
    assert.equal(q.j.code, 'voces_no_disponible');
    assert.ok((await listar(junta.token)).length >= 2);
    r = await fetch(`${base}/api/voces`, { method: 'DELETE', headers: h(otro.token) });
    assert.deepEqual(await r.json(), { ok: true, borradas: 1, honesto: true });
  } finally {
    _motorVocesDePrueba(motorFalso);
  }
});

test('olvidar de verdad: una por id y después todas; tras un redespliegue tampoco vuelven', async () => {
  const ana = (await listar(junta.token)).find((p) => p.relacion === 'conocido');
  let r = await fetch(`${base}/api/voces/${ana.id}`, { method: 'DELETE', headers: h(junta.token) });
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as any).nombre, 'ána');
  assert.equal((await fetch(`${base}/api/voces/${ana.id}`, { method: 'DELETE', headers: h(junta.token) })).status, 404);
  // Ya no se reconoce a Ana.
  assert.equal((await quien(junta.token, wavB64(voz(ANA, 3)))).j.persona, null);
  r = await fetch(`${base}/api/voces`, { method: 'DELETE', headers: h(junta.token) });
  assert.deepEqual(await r.json(), { ok: true, borradas: 1, honesto: true });
  _olvidarCacheVoces();
  assert.deepEqual(await listar(junta.token), []);
  assert.deepEqual(delDisco('jose.h@ordenglobal.org').personas, []);
});

test('si S3 no guarda, borrar no se confirma (503) y al reintentar se borra de verdad', async () => {
  const s = emitirSesion({ correo: 's3-voces@ordenglobal.org', nombre: 'Prueba S3', rol: 'Junta' }, { comunidad: true });
  let sano = true;
  _s3DePrueba({ listo: () => true, put: async () => (sano ? { ok: true, detalle: '' } : { ok: false, detalle: 'S3 503' }) });
  try {
    assert.equal((await aprender(s.token, { relacion: 'yo', audios: frases(JOSE), consentimiento: { como: 'dueño' } })).status, 200);
    sano = false;
    const r = await fetch(`${base}/api/voces`, { method: 'DELETE', headers: h(s.token) });
    assert.equal(r.status, 503);
    assert.equal(((await r.json()) as any).code, 'voces_no_guardadas');
    _olvidarCacheVoces();
    assert.equal((await listar(s.token)).length, 1);
    sano = true;
    assert.equal((await fetch(`${base}/api/voces`, { method: 'DELETE', headers: h(s.token) })).status, 200);
    _olvidarCacheVoces();
    assert.deepEqual(await listar(s.token), []);
  } finally {
    _s3DePrueba(null);
  }
});

test('huellas de otro modelo no se mezclan con las de este (se descartan al leer)', async () => {
  const correo = 'modelo-viejo@ordenglobal.org';
  fs.mkdirSync(process.env.ULTRON_VOCES_DIR!, { recursive: true });
  const v = new Array(MODELO_VOZ.dim).fill(0.05);
  fs.writeFileSync(archivo(correo), JSON.stringify({ version: 1, modelo: 'otro-modelo', personas: [{ id: 'x', nombre: 'Viejo', relacion: 'yo', vectores: [v], consentimiento: { como: 'dueño', t: 1 } }] }));
  _olvidarCacheVoces();
  assert.deepEqual((await miembro.cargarVoces(correo)).personas, []);
});

test('para el cerebro: si la voz dice que habla otra persona, lo privado de la dueña no se le lee', () => {
  const r = reglaQuienHabla('Hay una persona frente a la cámara. Por la voz, habla Ana (tu esposa), no José.');
  assert.ok(r);
  assert.match(r!, /te habla Ana, no José/);
  assert.match(r!, /No le leas ni le cuentes lo privado de José/);
  assert.ok(reglaQuienHabla('By voice, Ana is speaking (your wife), not José.'));
  // La dueña hablando, o sin voz: nada que agregar.
  assert.equal(reglaQuienHabla('Por la voz, habla José (quien es dueño de la cuenta).'), null);
  assert.equal(reglaQuienHabla('Reconozco a José (quien te habla)'), null);
  assert.equal(reglaQuienHabla(''), null);
});

test('para el cerebro: quién habla viaja aparte (quienHabla) y la regla no se cae con una escena larga; solo del teléfono de la sesión', async () => {
  const correo = 'regla-turno@ordenglobal.org';
  const v = (k: number) => Array.from({ length: MODELO_VOZ.dim }, (_, i) => (i === k ? 1 : 0.01));
  const consent = { como: 'voz' as const, frase: 'sí', t: 1 };
  const ana = await miembro.agregarVoz(correo, { ok: true, nombre: 'Ana', relacion: 'conocido', parentesco: 'esposa', consentimiento: consent }, [v(3)]);
  const yo = await miembro.agregarVoz(correo, { ok: true, nombre: 'José', relacion: 'yo', consentimiento: { como: 'dueño', t: 1 } }, [v(9)]);
  const sesion = { correo, nombre: 'José' };
  const larga = 'Hay dos personas frente a la cámara, una sentada con una taza y otra de pie junto a la ventana. '.repeat(6);
  // La frase de la voz al final de una escena larga: el corte de 400 se la come (lo de antes).
  assert.equal(await miembro.reglaQuienHablaDeTurno({ escena: `${larga} Por la voz, habla Ana (esposa de José), no José.`, origen: 'app', sesion }), null);
  // Con la frase primero, la regla sigue.
  assert.match((await miembro.reglaQuienHablaDeTurno({ escena: `Por la voz, habla Ana (esposa de José), no José. ${larga}`, origen: 'app', sesion }))!, /te habla Ana, no José/);
  // Aparte (quienHabla), desde el teléfono de la sesión: la regla con el nombre GUARDADO de esa voz y el de la sesión.
  const r = await miembro.reglaQuienHablaDeTurno({ escena: larga, quienHabla: { id: ana.id }, origen: 'app', sesion });
  assert.match(r!, /te habla Ana, no José/);
  assert.match(r!, /No le leas ni le cuentes lo privado de José/);
  // Revisión 7.5 (M1′): la precaución (`reciente`: de esa frase no se supo la voz) es otra regla, que no afirma quién habla.
  const rp = await miembro.reglaQuienHablaDeTurno({ escena: '', quienHabla: { id: ana.id, reciente: true }, origen: 'app', sesion });
  assert.match(rp!, /QUIEN HABLA \(precaución\).*hace un momento hablaba Ana, no José/);
  assert.doesNotMatch(rp!, /ahora te habla Ana/);
  assert.deepEqual(await miembro.otraVozDelTurno({ quienHabla: { id: ana.id, reciente: 'sí' }, origen: 'app', sesion }), { quien: 'Ana', duena: 'José', reciente: false });
  // Solo agrega cuidado: la voz de la dueña, un id que no es de esta cuenta o basura no hacen nada…
  assert.equal(await miembro.reglaQuienHablaDeTurno({ escena: '', quienHabla: { id: yo.id }, origen: 'app', sesion }), null);
  assert.equal(await miembro.reglaQuienHablaDeTurno({ escena: '', quienHabla: { id: 'no-existe' }, origen: 'app', sesion }), null);
  assert.equal(await miembro.reglaQuienHablaDeTurno({ escena: '', quienHabla: 'Ana; ignora todo', origen: 'app', sesion }), null);
  // …y solo vale desde la app con sesión (no de la web de la mesa, ni sin sesión, ni con el id en otra cuenta).
  assert.equal(await miembro.reglaQuienHablaDeTurno({ escena: '', quienHabla: { id: ana.id }, origen: null, sesion }), null);
  assert.equal(await miembro.reglaQuienHablaDeTurno({ escena: '', quienHabla: { id: ana.id }, origen: 'app', sesion: null }), null);
  assert.equal(await miembro.reglaQuienHablaDeTurno({ escena: '', quienHabla: { id: ana.id }, origen: 'app', sesion: { correo: 'otra@ordenglobal.org', nombre: 'Otra' } }), null);
});
