/**
 * Un Voicebox de mentira para las pruebas: las tres rutas que expone el de verdad
 * (`POST /generate/stream`, `POST /transcribe`, `GET /health`), con la misma puerta
 * (`X-Voz-Clave`, 403 sin ella) y la misma forma de respuesta. No es un archivo de pruebas
 * (`*.test.ts`): lo importan las que hablan con la voz o el oído.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export const CLAVE_FALSA = 'clave-de-prueba';

/** WAV PCM 16 bits mono de verdad: un tono de `segundos` a `hz` muestras por segundo. */
export function wavDePrueba(segundos = 0.5, hz = 24000): Buffer {
  const n = Math.round(segundos * hz);
  const datos = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) datos.writeInt16LE(Math.round(Math.sin((i / hz) * 2 * Math.PI * 220) * 8000), i * 2);
  const cab = Buffer.alloc(44);
  cab.write('RIFF', 0, 'ascii');
  cab.writeUInt32LE(36 + datos.length, 4);
  cab.write('WAVE', 8, 'ascii');
  cab.write('fmt ', 12, 'ascii');
  cab.writeUInt32LE(16, 16);
  cab.writeUInt16LE(1, 20);
  cab.writeUInt16LE(1, 22);
  cab.writeUInt32LE(hz, 24);
  cab.writeUInt32LE(hz * 2, 28);
  cab.writeUInt16LE(2, 32);
  cab.writeUInt16LE(16, 34);
  cab.write('data', 36, 'ascii');
  cab.writeUInt32LE(datos.length, 40);
  return Buffer.concat([cab, datos]);
}

export type Pedido = { ruta: string; clave: string | undefined; cuerpo: any; crudo: string };

export type Opciones = {
  /** Qué dice Whisper. Por omisión, «hola Aura». */
  transcripcion?: (crudo: string) => { status?: number; json?: any; texto?: string };
  /** Qué devuelve la voz. Por omisión, un WAV de medio segundo. */
  voz?: (cuerpo: any) => { status?: number; audio?: Buffer; tipo?: string; texto?: string };
};

export function voiceboxFalso(op: Opciones = {}): Promise<{ url: string; pedidos: Pedido[]; cerrar: () => Promise<void> }> {
  const pedidos: Pedido[] = [];
  const srv = http.createServer((req, res) => {
    const trozos: Buffer[] = [];
    req.on('data', (c) => trozos.push(c));
    req.on('end', () => {
      const crudo = Buffer.concat(trozos).toString('latin1');
      const clave = req.headers['x-voz-clave'] as string | undefined;
      let cuerpo: any = null;
      if (/json/.test(String(req.headers['content-type'] || ''))) {
        try {
          cuerpo = JSON.parse(crudo);
        } catch {
          cuerpo = null;
        }
      }
      pedidos.push({ ruta: `${req.method} ${req.url}`, clave, cuerpo, crudo });
      if (clave !== CLAVE_FALSA) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end('{"detail":"Forbidden"}');
      }
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{"status":"healthy"}');
      }
      if (req.method === 'POST' && req.url === '/generate/stream') {
        const r = op.voz?.(cuerpo) || {};
        if (r.texto !== undefined) {
          res.writeHead(r.status || 500, { 'Content-Type': r.tipo || 'text/plain' });
          return res.end(r.texto);
        }
        res.writeHead(r.status || 200, { 'Content-Type': r.tipo || 'audio/wav' });
        return res.end(r.audio || wavDePrueba());
      }
      if (req.method === 'POST' && req.url === '/transcribe') {
        const r = op.transcripcion?.(crudo) || {};
        res.writeHead(r.status || 200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(r.json !== undefined ? r.json : { text: r.texto ?? 'hola Aura', duration: 1.2 }));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"detail":"Not Found"}');
    });
  });
  return new Promise((ok) =>
    srv.listen(0, '127.0.0.1', () =>
      ok({
        url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`,
        pedidos,
        cerrar: () => new Promise<void>((fin) => srv.close(() => fin())),
      })
    )
  );
}

/** Pone VOICEBOX_URL/VOICEBOX_CLAVE (o los quita con `undefined`) mientras corre `fn`, y los deja como estaban. */
export async function conVoicebox<T>(url: string | undefined, clave: string | undefined, fn: () => Promise<T>): Promise<T> {
  const antes = { url: process.env.VOICEBOX_URL, clave: process.env.VOICEBOX_CLAVE };
  const poner = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
  poner('VOICEBOX_URL', url);
  poner('VOICEBOX_CLAVE', clave);
  try {
    return await fn();
  } finally {
    poner('VOICEBOX_URL', antes.url);
    poner('VOICEBOX_CLAVE', antes.clave);
  }
}
