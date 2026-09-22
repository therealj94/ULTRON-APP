#!/usr/bin/env node
/**
 * Graba clips cortos de la voz oficial en public/voz con ElevenLabs v3.
 * Uso: ELEVENLABS_API_KEY=... node scripts/grabar-banco.mjs [ids...]
 * Sin ids graba todos los que falten. No sobreescribe salvo --force.
 * La clave viene del entorno; nunca se guarda en el repo.
 */
import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.ELEVENLABS_API_KEY;
const VOZ = process.env.ELEVENLABS_VOZ || 'hHjbwzYZW17oh0p05AKv';
if (!KEY) {
  console.error('Falta ELEVENLABS_API_KEY');
  process.exit(1);
}
const OUT = path.join(process.cwd(), 'public', 'voz');
fs.mkdirSync(OUT, { recursive: true });

/** id → guion con etiquetas v3. Frases cortas que la mesa dice sin gastar red. */
export const GUIONES = {
  aqui: '[warmly] Aquí estoy.',
  listo: '[warmly] Listo.',
  hola: '[warmly] Hola. [short pause] Qué bueno verte.',
  gracias: '[softly] Gracias. De verdad.',
  yaya: '[laughs] Ya, ya. [mischievously] Te vi.',
  risa1: '[laughs] Ay, no. [laughs]',
  risa2: '[chuckles] Je. [laughs] Esa estuvo buena.',
  mmm2: '[thoughtful] Mmm... déjame pensarlo un segundo.',
  uy2: '[surprised] Uy. [short pause] Eso no me lo esperaba.',
  cansado: '[tired] [sighs] Va. Una cosa a la vez.',
  carino: '[softly] Tranquilo. Aquí estoy contigo.',
  orgullo: '[proud] [warmly] Eso. Así se hace.',
  sorpresa: '[surprised] ¿En serio? [curious] Contame más.',
  triste: '[sad] Lo siento. [softly] De verdad lo siento.',
  molesto: '[annoyed] Ya. Basta. [short pause] Hablemos en serio.',
  despertar: '[sleepy] [yawns] Mmm... ya, ya desperté. [warmly] ¿Qué necesitás?',
  bienvenida: '[warmly] AU-RA, en línea. [short pause] Orden Global, buenos días.',
  // jesus, waymaker y oracion: sus guiones viven en server/voz.ts (LETRAS y ORACION_DEL_DIA) para no duplicarlos.
};

const force = process.argv.includes('--force');
const pedidos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ids = pedidos.length ? pedidos : Object.keys(GUIONES);

for (const id of ids) {
  const guion = GUIONES[id];
  if (!guion) {
    console.warn('sin guion:', id);
    continue;
  }
  const ruta = path.join(OUT, `${id}.mp3`);
  if (fs.existsSync(ruta) && !force) {
    console.log('ya existe', id);
    continue;
  }
  const sing = /\[singing\]/.test(guion);
  const t0 = Date.now();
  const r = await fetch('https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': KEY, Accept: 'audio/mpeg' },
    body: JSON.stringify({ model_id: 'eleven_v3', language_code: sing ? undefined : 'es', inputs: [{ text: guion, voice_id: VOZ }] }),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) {
    console.error('ERR', id, r.status, (await r.text()).slice(0, 200));
    continue;
  }
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(ruta, buf);
  console.log('OK', id, buf.length, 'bytes', Date.now() - t0, 'ms');
}
