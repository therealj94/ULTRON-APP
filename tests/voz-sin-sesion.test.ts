/**
 * LO QUE GASTA DINERO PIDE SESIÓN (auditoría del 7-oct, C-2). El servidor entero, de verdad (server.ts en un proceso
 * aparte, NODE_ENV=production), con un Voicebox falso detrás de la voz y del oído:
 *
 *  · sin sesión, nada nuevo: la voz, el canto y la oración que no están guardados contestan 401 (y el Voicebox ni se
 *    entera); el oído y los ojos, 401 siempre;
 *  · con sesión, todo como siempre;
 *  · lo ya guardado sigue público: una frase ya dicha (caché) y el repertorio grabado salen sin sesión;
 *  · la conversación de ElevenLabs (/api/voz/llm) sigue con su propia puerta (su llave derivada y el pase), no con esta.
 *
 * Datos inventados.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { voiceboxFalso, CLAVE_FALSA, wavDePrueba } from './voicebox-falso';

const RAIZ = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'voz-sin-sesion-'));
// El repertorio grabado (public/voz) donde el servidor lo busca: junto a su directorio de trabajo.
fs.symlinkSync(path.join(RAIZ, 'public'), path.join(tmp, 'public'));
const SECRETO = 'secreto-de-prueba-largo-para-la-voz-sin-sesion';
process.env.ULTRON_SESION_SECRETO = SECRETO;
process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(tmp, 'cerradas-prueba.json');
process.env.ULTRON_MEMORIA_BUCKET = '';
const { emitirSesion, secretoDerivado } = await import('../server/seguridad');
const { ETIQUETA_SECRETO_LLM } = await import('../server/voz-agente');

const vb = await voiceboxFalso();
const PORT = 8060 + Math.floor(Math.random() * 30);
const BASE = `http://127.0.0.1:${PORT}`;
const proc: ChildProcess = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), path.join(RAIZ, 'server.ts')], {
  cwd: tmp,
  env: {
    PATH: process.env.PATH || '',
    HOME: tmp,
    NODE_ENV: 'production',
    AURA_SUSPENSIONES: 'ninguna',
    PORT: String(PORT),
    PLATAFORMA: 'ultron',
    ULTRON_SESION_SECRETO: SECRETO,
    ULTRON_SESIONES_CERRADAS_ARCHIVO: path.join(tmp, 'cerradas.json'),
    ULTRON_PERFILES_DIR: path.join(tmp, 'perfiles'),
    VOICEBOX_URL: vb.url,
    VOICEBOX_CLAVE: CLAVE_FALSA,
    TSX_TSCONFIG_PATH: path.join(RAIZ, 'tsconfig.json'),
    ULTRON_PADRON: 'lucia | Lucía Prueba | lucia.prueba@ordenglobal.org | | ultron=lee',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
  detached: true,
});
let errores = '';
proc.stderr?.on('data', (d) => (errores = (errores + d).slice(-4000)));
after(async () => {
  try {
    process.kill(-proc.pid!);
  } catch {
    /* ya se fue */
  }
  await vb.cerrar();
  fs.rmSync(tmp, { recursive: true, force: true });
});
let listo = false;
for (let i = 0; i < 240 && !listo; i++) {
  try {
    listo = (await fetch(`${BASE}/api/health`)).ok;
  } catch {
    await new Promise((r) => setTimeout(r, 250));
  }
}

const sesion = emitirSesion({ correo: 'lucia.prueba@ordenglobal.org', nombre: 'Lucía Prueba', rol: 'Junta' });
const json = { 'content-type': 'application/json' };
const conSesion = { ...json, 'x-ultron-sesion': sesion.token };
const post = (ruta: string, cuerpo: unknown, headers: Record<string, string> = json) => fetch(`${BASE}${ruta}`, { method: 'POST', headers, body: JSON.stringify(cuerpo) });
const voces = () => vb.pedidos.filter((p) => p.ruta === 'POST /generate/stream').length;
const oidos = () => vb.pedidos.filter((p) => p.ruta === 'POST /transcribe').length;

test('el servidor arrancó', () => {
  assert.ok(listo, `no arrancó: ${errores}`);
});

test('sin sesión, la voz que no está guardada no se genera: 401 y el Voicebox ni se entera', async () => {
  const antes = voces();
  for (const ruta of ['/api/tts', '/api/tts/stream', '/api/voz']) {
    const r = await post(ruta, { text: `Una frase nueva que nadie dijo por ${ruta}.` });
    assert.equal(r.status, 401, ruta);
    assert.equal((await r.json()).code, 'sesion_requerida', ruta);
  }
  const pcm = await fetch(`${BASE}/api/tts/pcm?text=${encodeURIComponent('Otra frase nueva por PCM.')}`);
  assert.equal(pcm.status, 401);
  // La oración por tema y una letra libre también se generan: sin sesión, no.
  assert.equal((await post('/api/orar', { tema: 'la cosecha de este año' })).status, 401);
  assert.equal((await post('/api/cantar', { letra: 'una letra libre que nadie grabó nunca', titulo: 'x' })).status, 401);
  assert.equal(voces(), antes, 'nada llegó a la voz');
});

test('sin sesión, el oído y los ojos no: 401', async () => {
  const antes = oidos();
  const wav = wavDePrueba(1, 16000).toString('base64');
  const stt = await post('/api/stt', { audioBase64: `data:audio/wav;base64,${wav}`, mimeType: 'audio/wav' });
  assert.equal(stt.status, 401);
  assert.equal((await stt.json()).code, 'sesion_requerida');
  const ver = await post('/api/vision/analyze', { mediaType: 'image/jpeg', base64Data: 'data:image/jpeg;base64,AAAA', modo: 'estructurado' });
  assert.equal(ver.status, 401);
  assert.equal(oidos(), antes, 'nada llegó al oído');
});

test('con sesión, todo como siempre: la voz se genera y el oído oye', async () => {
  const antes = voces();
  const r = await post('/api/tts', { text: 'Hola, aquí estoy para lo que necesites.' }, conSesion);
  assert.equal(r.status, 200);
  assert.match(String(r.headers.get('content-type')), /audio/);
  assert.ok((await r.arrayBuffer()).byteLength > 44);
  assert.equal(voces(), antes + 1);
  const wav = wavDePrueba(1, 16000).toString('base64');
  const stt = await post('/api/stt', { audioBase64: `data:audio/wav;base64,${wav}`, mimeType: 'audio/wav' }, conSesion);
  assert.equal(stt.status, 200);
  assert.equal((await stt.json()).text, 'hola Aura');
});

test('lo ya guardado sigue público: la frase ya dicha sale de la caché y el repertorio grabado suena, sin sesión', async () => {
  const antes = voces();
  const r = await post('/api/tts', { text: 'Hola, aquí estoy para lo que necesites.' });
  assert.equal(r.status, 200, 'la misma frase, ya guardada');
  assert.ok((await r.arrayBuffer()).byteLength > 44);
  assert.equal(voces(), antes, 'de la caché: el Voicebox no se tocó');
  const cancion = await post('/api/cantar', { id: 'jesus', avatar: 'aura' });
  assert.equal(cancion.status, 200);
  assert.match(String(cancion.headers.get('content-type')), /audio\/mpeg/);
  // La lista del repertorio tampoco pide nada.
  assert.equal((await fetch(`${BASE}/api/cantar`)).status, 200);
});

test('la conversación de ElevenLabs sigue con su propia puerta (la llave derivada y el pase), no con la de la mesa', async () => {
  const sinLlave = await post('/api/voz/llm/chat/completions', { model: 'aura', messages: [{ role: 'user', content: 'hola' }] });
  assert.equal(sinLlave.status, 401);
  assert.equal((await sinLlave.json()).error?.message, 'unauthorized');
  // Con la llave buena, la puerta de la mesa no se mete: lo que falta es el pase (su propia regla de siempre).
  const conLlave = await post('/api/voz/llm/chat/completions', { model: 'aura', messages: [{ role: 'user', content: 'hola' }] }, { ...json, authorization: `Bearer ${secretoDerivado(ETIQUETA_SECRETO_LLM)}` });
  assert.equal(conLlave.status, 401);
  assert.equal((await conLlave.json()).error?.message, 'pase vencido o inválido');
});
