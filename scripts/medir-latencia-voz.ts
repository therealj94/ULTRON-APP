#!/usr/bin/env -S npx tsx
/**
 * CUÁNTO TARDA LA PRIMERA PALABRA DE LA VOZ, con un cerebro falso (nada sale de la máquina).
 *
 *   npx tsx scripts/medir-latencia-voz.ts [--raiz <carpeta con server.ts>] [--n 9]
 *
 * Levanta el server.ts de `--raiz` (por omisión, este) en una carpeta temporal, sin .env ni llaves,
 * contra un 27B falso (primer token a los 250 ms, un trozo de seis letras cada 15 ms) y un modelo
 * chico falso, y mide en /api/voz/llm (como lo pide ElevenLabs) y en /api/turno/stream:
 *   · charla («hola»): la contesta el modelo chico;
 *   · pregunta: la contesta el 27B, en streaming.
 * Sirve para comparar dos versiones: sacar la otra con `git archive <commit> | tar -x -C <carpeta>`,
 * enlazar su node_modules y correr este script con `--raiz <carpeta>`. Imprime solo cifras.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';

const arg = (k: string, def: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : def;
};
const RAIZ = path.resolve(arg('--raiz', process.cwd()));
const N = Number(arg('--n', '9'));
const SECRETO = 'secreto-de-medicion-largo-solo-para-este-script-0001';
const RESPUESTA = 'Mira, lo que pasa con la planta de beneficio este trimestre es que avanzó bastante, sobre todo en la parte eléctrica. Te cuento el detalle cuando quieras.';

function servidorFalso(fn: (j: any, res: http.ServerResponse) => void) {
  const s = http.createServer((req, res) => {
    let c = '';
    req.on('data', (d) => (c += d));
    req.on('end', () => fn(JSON.parse(c || '{}'), res));
  });
  return new Promise<http.Server>((r) => s.listen(0, '127.0.0.1', () => r(s)));
}
const puerto = (s: http.Server) => (s.address() as AddressInfo).port;

async function main() {
  const nodo = await servidorFalso(async (j, res) => {
    if (!j.stream) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ message: { content: RESPUESTA } }));
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    await new Promise((r) => setTimeout(r, 250));
    for (const t of RESPUESTA.match(/.{1,6}/gs) || []) {
      if (res.destroyed) return;
      res.write(JSON.stringify({ message: { content: t }, done: false }) + '\n');
      await new Promise((r) => setTimeout(r, 15));
    }
    res.end(JSON.stringify({ message: { content: '' }, done: true }) + '\n');
  });
  const chico = await servidorFalso((_j, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: '[EMO: feliz] ¡Muy bien! ¿Y tú?' } }] })));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'medir-voz-'));
  const PORT = 7700 + Math.floor(Math.random() * 100);
  const BASE = `http://127.0.0.1:${PORT}`;
  const proc = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), path.join(RAIZ, 'server.ts')], {
    cwd: tmp,
    env: {
      PATH: process.env.PATH || '',
      HOME: tmp,
      NODE_ENV: 'production',
      PORT: String(PORT),
      PLATAFORMA: 'ultron',
      ULTRON_SESION_SECRETO: SECRETO,
      ULTRON_NODO_URL: `http://127.0.0.1:${puerto(nodo)}`,
      ULTRON_NODO_SECRETO: 'medicion',
      MODELO_CHICO_URL: `http://127.0.0.1:${puerto(chico)}`,
      MODELO_CHICO_MODO: 'activo',
    },
    stdio: 'ignore',
    detached: true,
  });
  const cerrar = () => {
    try {
      process.kill(-proc.pid!);
    } catch {
      /* ya se fue */
    }
    nodo.close();
    chico.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  try {
    let listo = false;
    for (let i = 0; i < 240 && !listo; i++) {
      try {
        listo = (await fetch(`${BASE}/api/health`)).ok;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    if (!listo) throw new Error('el servidor no levantó');

    // El pase y la llave, con el código de ESA versión (las firmas cambian entre versiones).
    process.env.ULTRON_SESION_SECRETO = SECRETO;
    process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(tmp, 'cerradas-script.json');
    const seg = await import(pathToFileURL(path.join(RAIZ, 'server/seguridad.ts')).href);
    const va = await import(pathToFileURL(path.join(RAIZ, 'server/voz-agente.ts')).href);
    const sesion = seg.emitirSesion({ correo: 'medicion@ordenglobal.org', nombre: 'Medición', rol: 'Junta' });
    const bearer = `Bearer ${seg.secretoDerivado(va.ETIQUETA_SECRETO_LLM)}`;
    const pase = () => {
      const p = va.emitirPase(sesion, 'aura', 'es');
      return typeof p === 'string' ? p : p.pase;
    };

    /** Primera palabra y respuesta entera, en ms, leyendo el stream a medida que llega. */
    async function medir(url: string, init: RequestInit, esTexto: (bloque: string) => boolean) {
      const t0 = performance.now();
      const r = await fetch(url, init);
      let primera = -1;
      let buf = '';
      const dec = new TextDecoder();
      for await (const trozo of r.body as any) {
        buf += dec.decode(trozo, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const b = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (primera < 0 && esTexto(b)) primera = performance.now() - t0;
        }
      }
      return { primera, total: performance.now() - t0 };
    }
    const voz = (mensaje: string) =>
      medir(
        `${BASE}/api/voz/llm`,
        { method: 'POST', headers: { 'content-type': 'application/json', authorization: bearer, 'x-pase': pase() }, body: JSON.stringify({ messages: [{ role: 'user', content: mensaje }] }) },
        (b) => b.startsWith('data: {') && !!JSON.parse(b.slice(6)).choices?.[0]?.delta?.content
      );
    const texto = (mensaje: string) =>
      medir(
        `${BASE}/api/turno/stream`,
        { method: 'POST', headers: { 'content-type': 'application/json', 'x-ultron-sesion': sesion.token }, body: JSON.stringify({ message: mensaje }) },
        (b) => b.startsWith('event: delta')
      );

    const mediana = (xs: number[]) => Math.round([...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]);
    const casos: Array<[string, () => Promise<{ primera: number; total: number }>]> = [
      ['voz · charla «hola»', () => voz('hola')],
      ['voz · pregunta al 27B', () => voz('explícame cómo va el proyecto de la planta de beneficio este trimestre')],
      ['texto · pregunta al 27B', () => texto('explícame cómo va el proyecto de la planta de beneficio este trimestre')],
    ];
    console.log(`raíz: ${RAIZ}`);
    for (const [nombre, fn] of casos) {
      await fn(); // calentar
      const p: number[] = [];
      const t: number[] = [];
      for (let i = 0; i < N; i++) {
        const r = await fn();
        p.push(r.primera);
        t.push(r.total);
      }
      console.log(`${nombre}: primera palabra ${mediana(p)} ms · entera ${mediana(t)} ms (mediana de ${N})`);
    }
  } finally {
    cerrar();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(`No se pudo medir: ${String(e?.message || e).slice(0, 200)}`);
    process.exit(1);
  }
);
