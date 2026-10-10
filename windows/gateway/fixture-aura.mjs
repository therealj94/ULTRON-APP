// Servidor AU-RA SIMULADO para las pruebas del .exe en el CI de Windows (127.0.0.1:18788).
// Habla el mismo contrato que server.ts: /api/health, /api/turno/stream (SSE), /api/tts (y /api/tts/stream), /api/stt,
// /api/windows/intencion. No es el cerebro ni la voz de verdad: solo prueba el cliente.
import http from 'node:http';

const wav = (() => {
  const n = 1600, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 8) * 6000), 44 + i * 2);
  return b;
})();

const leer = (req) => new Promise((r) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => { try { r(JSON.parse(s || '{}')); } catch { r({}); } }); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (o, st = 200) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.headers['x-aura-origen'] !== 'windows' && url.pathname !== '/api/health') return json({ error: 'falta x-aura-origen: windows' }, 400);
  if (url.pathname === '/api/health') return json({ ok: true });
  const body = await leer(req);
  if (url.pathname === '/api/turno/stream') {
    if (!body.message || body.avatar !== 'aura' || !Array.isArray(body.historial)) return json({ error: 'cuerpo raro' }, 400);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const ev = (e, d) => res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`);
    ev('tools', { tools: [] });
    ev('emocion', { emocion: 'feliz' });
    const partes = ['Hola, José. ', '[risa] Aquí estoy, ', 'lista para ayudarte.'];
    for (const p of partes) { ev('delta', { text: p.replace('[risa] ', ''), voz: p }); await new Promise((r) => setTimeout(r, 40)); }
    ev('done', { reply: 'Hola, José. Aquí estoy, lista para ayudarte.', voz: partes.join(''), emocion: 'feliz', ms: 120, via: 'fixture' });
    return res.end();
  }
  // La voz de Windows sale por /api/tts/stream (sin tiempos por letra, 10-oct); /api/tts sigue para lo demás.
  if (url.pathname === '/api/tts' || url.pathname === '/api/tts/stream') { res.writeHead(200, { 'content-type': 'audio/wav', 'X-Ultron-TTS': 'fixture' }); return res.end(wav); }
  if (url.pathname === '/api/stt') return json({ text: String(body.audioBase64 || '').startsWith('data:audio/wav;base64,UklGR') ? 'abre la calculadora' : '' });
  if (url.pathname === '/api/windows/intencion') {
    if (req.headers['x-ultron-sesion'] !== 'sesion-de-prueba') return json({ error: 'sesión' }, 401);
    return json({ etiqueta: /carta|correo/.test(String(body.texto)) ? 'win_redactar' : 'win_abrir_app', p: 0.93, seguro: true, umbral: 0.6, ms: 12, motivo: 'ok' });
  }
  json({ error: 'no existe' }, 404);
}).listen(18788, '127.0.0.1', () => console.log('fixture AU-RA en 127.0.0.1:18788'));
