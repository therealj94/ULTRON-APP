#!/usr/bin/env node
/**
 * Genera las tomas de canto (a capella, una voz) para los cuatro ganchos fijos vía /api/tts performance=sing.
 * Letra e idioma FIJOS: se copian tal cual de src/lib/sing.ts.
 *   node scripts/build-sing-takes.mjs [API_BASE]
 * Para sustituir una toma por una grabación real: reemplaza assets/sing/<id>.mp3 (8–15 s).
 */
import fs from 'node:fs';
import path from 'node:path';

const API = (process.argv[2] || process.env.ULTRON_API || 'https://ultron-looi-desk.onrender.com').replace(/\/$/, '');
const root = path.resolve(new URL('..', import.meta.url).pathname);
const src = fs.readFileSync(path.join(root, 'src', 'lib', 'sing.ts'), 'utf8');
const outDir = path.join(root, 'assets', 'sing');
fs.mkdirSync(outDir, { recursive: true });

const re = /id: '(\w+)',[\s\S]*?lang: '(\w+)',[\s\S]*?lyrics:\s*(['"])([\s\S]*?)\3,/g;
let m;
while ((m = re.exec(src))) {
  const [, id, lang, , raw] = m;
  const lyrics = raw.replace(/\\n/g, '\n').replace(/\\'/g, "'");
  const dest = path.join(outDir, `${id}.mp3`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 20000 && !process.env.FORCE) {
    console.log('skip', id);
    continue;
  }
  const r = await fetch(`${API}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: lyrics, performance: 'sing', engine: 'eleven', lang }),
  });
  if (!r.ok) {
    console.error('FALLO', id, r.status, await r.text());
    continue;
  }
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  console.log('ok', id, lang, r.headers.get('x-ultron-tts'), fs.statSync(dest).size);
}
