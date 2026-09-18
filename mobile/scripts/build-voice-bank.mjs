#!/usr/bin/env node
/**
 * Graba las frases fijas de ULTRON con la voz oficial (ElevenLabs vía /api/tts)
 * y genera src/lib/voiceBank.ts con el mapa texto→asset.
 *
 *   node scripts/build-voice-bank.mjs [API_BASE]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const API = (process.argv[2] || process.env.ULTRON_API || 'https://ultron-looi-desk.onrender.com').replace(/\/$/, '');
const root = path.resolve(new URL('..', import.meta.url).pathname);
const lines = JSON.parse(fs.readFileSync(path.join(root, 'voice-lines.json'), 'utf8'));
const outDir = path.join(root, 'assets', 'voice');
fs.mkdirSync(outDir, { recursive: true });

const key = (t) =>
  String(t)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ]+/g, '');

const phrases = new Set();
for (const name of lines.names) for (const part of lines.greetingParts) {
  phrases.add(lines.greetingTemplate.replace('{part}', part).replace('{name}', name));
}
for (const k of ['acks', 'tap', 'annoy', 'angry', 'love', 'shake', 'system']) for (const p of lines[k]) phrases.add(p);

const entries = [];
let downloaded = 0;
for (const text of phrases) {
  const k = key(text);
  const file = `${crypto.createHash('sha1').update(k).digest('hex').slice(0, 12)}.mp3`;
  const dest = path.join(outDir, file);
  if (!fs.existsSync(dest) || fs.statSync(dest).size < 500) {
    const r = await fetch(`${API}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, performance: 'speak', engine: 'fast' }),
    });
    if (!r.ok) {
      console.error('FALLO', r.status, text);
      continue;
    }
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    downloaded += 1;
    console.log('ok', file, r.headers.get('x-ultron-tts'), text);
  }
  entries.push({ k, file, text });
}

const used = new Set(entries.map((e) => e.file));
for (const f of fs.readdirSync(outDir)) if (!used.has(f)) fs.unlinkSync(path.join(outDir, f));

const ts = `/* Generado por scripts/build-voice-bank.mjs — no editar a mano. */
/* eslint-disable */
export function bankKey(t: string): string {
  return String(t)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .replace(/[^a-z0-9ñ]+/g, '');
}

export const VOICE_BANK: Record<string, number> = {
${entries.map((e) => `  // ${e.text.replace(/\*\//g, '')}\n  ${JSON.stringify(e.k)}: require('../../assets/voice/${e.file}'),`).join('\n')}
};
`;
fs.writeFileSync(path.join(root, 'src', 'lib', 'voiceBank.ts'), ts);
console.log(`voiceBank: ${entries.length} frases, ${downloaded} nuevas, ${fs.readdirSync(outDir).length} archivos`);
