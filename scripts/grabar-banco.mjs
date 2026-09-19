#!/usr/bin/env node
/**
 * Graba el banco /public/voz con ElevenLabs v3 (dialogue).
 * Canciones = intro + verso cantado + risa/comentario. Bohemian no se toca.
 *
 *   ELEVENLABS_API_KEY=… node scripts/grabar-banco.mjs [all|canciones|saludos|cortos]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'voz');
const VOICE = process.env.ELEVENLABS_VOZ || 'hHjbwzYZW17oh0p05AKv';
const KEY = process.env.ELEVENLABS_API_KEY || '';
const QUE = (process.argv[2] || 'all').toLowerCase();
const BOHEMIAN = path.join(OUT, 'bohemian.mp3');

if (!KEY) {
  console.error('Falta ELEVENLABS_API_KEY');
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });

const { createHash } = await import('node:crypto');

function sha256(p) {
  if (!fs.existsSync(p)) return '';
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

const bohemianAntes = sha256(BOHEMIAN);
if (!bohemianAntes) {
  console.error('Falta public/voz/bohemian.mp3 — no grabo sin esa referencia');
  process.exit(1);
}

function destPermitido(id) {
  if (id === 'bohemian' || id.startsWith('bohemian')) {
    throw new Error('Bohemian no se toca');
  }
  return path.join(OUT, `${id}.mp3`);
}

async function postDialogue(text, { lang, sing } = {}) {
  const spoken = String(text || '').trim();
  if (!spoken) throw new Error('texto vacío');
  const models = sing
    ? ['eleven_v3', 'eleven_v3_conversational']
    : ['eleven_v3_conversational', 'eleven_v3'];
  let last = '';
  for (const model_id of models) {
    const body = { model_id, inputs: [{ text: spoken, voice_id: VOICE }] };
    if (lang) body.language_code = lang;
    const r = await fetch('https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': KEY, Accept: 'audio/mpeg' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(sing ? 40000 : 22000),
    });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length >= 800) return buf;
      last = `${model_id} audio corto ${buf.length}`;
      continue;
    }
    last = `${model_id} ${r.status} ${(await r.text()).slice(0, 160)}`;
    console.warn('dialogue', last);
  }
  if (sing) {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': KEY, Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: spoken,
        model_id: 'eleven_multilingual_v2',
        apply_text_normalization: 'on',
        voice_settings: { stability: 0.28, similarity_boost: 0.78, style: 0.62, use_speaker_boost: true },
      }),
      signal: AbortSignal.timeout(28000),
    });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length >= 800) return buf;
    } else {
      last = `tts ${r.status} ${(await r.text()).slice(0, 140)}`;
    }
  }
  throw new Error(`Eleven: ${last}`);
}

function writeTmp(buf, name) {
  const p = path.join(OUT, `.tmp-${name}.mp3`);
  fs.writeFileSync(p, buf);
  return p;
}

function silencio(ms = 220) {
  const p = path.join(OUT, `.tmp-sil.mp3`);
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(ms / 1000), '-c:a', 'libmp3lame', '-b:a', '128k', p],
    { encoding: 'utf8' }
  );
  if (r.status !== 0) throw new Error(r.stderr.slice(-200));
  return p;
}

function concat(parts, dest) {
  const list = path.join(OUT, '.tmp-list.txt');
  fs.writeFileSync(list, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'libmp3lame', '-b:a', '128k', dest],
    { encoding: 'utf8' }
  );
  if (r.status !== 0) throw new Error(r.stderr.slice(-240));
}

function duracion(p) {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', p],
    { encoding: 'utf8' }
  );
  return Number(r.stdout.trim()) || 0;
}

async function transcribir(p, lang) {
  const form = new FormData();
  form.append('model_id', 'scribe_v2');
  if (lang) form.append('language_code', lang);
  form.append('tag_audio_events', 'true');
  form.append('file', new Blob([fs.readFileSync(p)], { type: 'audio/mpeg' }), path.basename(p));
  const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': KEY },
    body: form,
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) return `(stt ${r.status})`;
  const j = await r.json();
  return String(j.text || '').replace(/\s+/g, ' ').trim();
}

async function grabarCorto(id, text, lang = 'es') {
  const dest = destPermitido(id);
  const buf = await postDialogue(text, { lang });
  fs.writeFileSync(dest, buf);
  console.log('corto', id, buf.length, duracion(dest).toFixed(1) + 's');
  await new Promise((r) => setTimeout(r, 350));
}

async function grabarCancion({ id, intro, verso, cierre }) {
  const dest = destPermitido(id);
  const a = writeTmp(await postDialogue(intro, { lang: 'es' }), `${id}-a`);
  await new Promise((r) => setTimeout(r, 450));
  const b = writeTmp(await postDialogue(verso, { sing: true }), `${id}-b`);
  await new Promise((r) => setTimeout(r, 450));
  let risaBuf = await postDialogue('[laughs] Jaja. [amused] Je.', { lang: 'es' });
  const je = path.join(OUT, 'je.mp3');
  const risa = writeTmp(risaBuf.length >= 12000 ? risaBuf : fs.readFileSync(je), `${id}-risa`);
  await new Promise((r) => setTimeout(r, 400));
  const c = writeTmp(await postDialogue(cierre, { lang: 'es' }), `${id}-c`);
  const sil = silencio(240);
  concat([a, sil, b, sil, risa, sil, c], dest);
  const secs = duracion(dest);
  const versoSecs = duracion(b);
  console.log('cancion', id, fs.statSync(dest).size, secs.toFixed(1) + 's', 'verso', versoSecs.toFixed(1) + 's');
  for (const p of [a, b, risa, c, sil, path.join(OUT, '.tmp-list.txt')]) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* */
    }
  }
  if (versoSecs < 6) {
    throw new Error(`${id}: el verso duró ${versoSecs.toFixed(1)}s — se leyó, no se cantó`);
  }
}

const CANCIONES = [
  {
    id: 'ligera',
    intro: '[casually] Cerati. Un genio. Esta me la sé aunque no sea cantante. Ahí voy.',
    verso:
      '[singing] Ella durmió al calor de las masas…\ny yo desperté queriendo soñarla…\nDe aquel amor, de música ligera…\nnada nos libra… nada más queda.',
    cierre:
      '[laughs] [warmly] ¿Qué tal, José? Gustavo lo hacía parecer fácil. Yo la dejé temblando un poco. ¿La repetimos o seguimos?',
  },
  {
    id: 'bittersweet',
    intro: '[softly] La de Medardo. The Verve. Sin red. Ahí voy.',
    verso:
      "[singing] You're a slave to money then you die…\nI'll take you down the only road I've ever been down…\nYou know the one that takes you to the places where all the veins meet, yeah…",
    cierre:
      '[laughs] [warmly] ¿Cómo la sentiste, José? Ashcroft canta como si le doliera el siglo. Yo apenas la rozé. ¿Le mandamos un audio a Medardo?',
  },
  {
    id: 'runaway',
    intro: '[playful] Kanye. El rey. Brindis sucio, sin autotune. Ahí voy.',
    verso:
      "[singing] Let's have a toast for the douchebags…\nLet's have a toast for the assholes…\nLet's have a toast for the scumbags, every one of them that I know…",
    cierre:
      '[laughs] [warmly] ¿Qué tal, José? Ye lo tira como sentencia. Yo lo tiré como chiste. ¿Otro brindis o nos ponemos a trabajar?',
  },
  {
    id: 'bruno',
    intro: '[softly] Bruno Mars. Die With A Smile. Si el mundo se acaba, esta. No soy cantante. Ahí voy.',
    verso:
      "[singing] If the world was ending, I'd wanna be next to you…\nIf the party was over and our time on Earth was through…\nI'd wanna hold you just for a while and die with a smile…",
    cierre:
      '[laughs] [warmly] ¿Qué tal, José? Bruno la canta como si fuera la última noche. Yo la canté como si te estuviera cuidando el escritorio. ¿Otra, o trabajamos?',
  },
];

const SALUDOS = [
  ['dias', '[warmly] Buenos días, José. [casual] Aquí. ¿En qué te ayudo?'],
  ['tardes', '[warmly] Buenas tardes, José. [casual] Aquí. ¿En qué te ayudo?'],
  ['noches', '[warmly] Buenas noches, José. [softly] Aquí. ¿En qué te ayudo?'],
];

const CORTOS = [
  ['aqui', '[casual] Aquí.'],
  ['hola', '[warmly] Hola.'],
  ['listo_corto', '[casual] Listo.'],
  ['foto', '[casual] Foto.'],
  ['salud', '[smiling] Salud.'],
  ['blaster', '[excited] Blaster.'],
  ['te_escucho', '[casual] Te escucho.'],
  ['mic_on', '[casual] Micrófono activado. Te escucho.'],
  ['genesis_ok', '[warmly] Quedó en Genesis Core. La próxima pregunta ya lo usa.'],
  ['genesis_preg', '[curious] ¿Lo actualizo en el cerebro Genesis Core?'],
  ['genesis_pide', '[casual] Decime el hecho y después, actualiza el cerebro.'],
  ['privado', '[serious] ULTRON es privado. Entra con tu sesión de junta.'],
  ['sin_cerebro', '[concerned] No alcanzo al cerebro remoto. Eso sí consta.'],
  ['gafas_on', '[casual] Gafas puestas.'],
  ['gafas_off', '[casual] Gafas guardadas.'],
  ['sable', '[serious] Sable listo.'],
  ['espera', '[thinking] Déjame ver.'],
  ['voy', '[casual] Voy.'],
  ['un_segundo', '[thinking] Un segundo.'],
  ['a_ver', '[thinking] A ver.'],
  ['calenta', '[casual] Calentando el motor.'],
  ['listos', '[warmly] Estamos listos.'],
  ['en_que', '[warmly] ¿En qué te ayudo?'],
  ['dime', '[casual] Dime.'],
  ['seguimos', '[casual] ¿Seguimos?'],
  ['lo_guardo', '[curious] ¿Lo guardo en el cerebro?'],
  ['confirmas', '[casual] ¿Confirmás?'],
  ['despacho_no', '[serious] Sin autorización expresa de la junta, no puedo despachar.'],
  ['despacho_ok', '[casual] Autorizado por el directorio. Despacho ejecutado.'],
  ['enlace', '[warmly] Enlace con cerebro exterior establecido.'],
  ['enojado', '[annoyed] Enojado.'],
  ['furia', '[angry] Furia.'],
  ['feliz', '[happy] Feliz.'],
  ['preocupado', '[concerned] Preocupado.'],
  ['curioso', '[curious] Curioso.'],
  ['guino', '[playful] Guiño.'],
  ['asi', '[casual] Así.'],
  ['susto', '[surprised] Susto.'],
  ['pensando', '[thinking] Pensando.'],
];

async function main() {
  if (QUE === 'all' || QUE === 'canciones') {
    for (const id of ['ligera', 'bittersweet', 'runaway', 'bruno']) {
      const p = path.join(OUT, `${id}.mp3`);
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        console.log('borrada', id);
      }
    }
    for (const c of CANCIONES) await grabarCancion(c);
    for (const c of CANCIONES) {
      const p = path.join(OUT, `${c.id}.mp3`);
      const lang = c.id === 'ligera' ? 'es' : undefined;
      const txt = await transcribir(p, lang);
      console.log('stt', c.id, duracion(p).toFixed(1) + 's', txt.slice(0, 220));
    }
  }
  if (QUE === 'all' || QUE === 'saludos') {
    for (const [id, text] of SALUDOS) await grabarCorto(id, text, 'es');
  }
  if (QUE === 'all' || QUE === 'cortos') {
    for (const [id, text] of CORTOS) await grabarCorto(id, text, 'es');
  }
  const bohemianDespues = sha256(BOHEMIAN);
  if (bohemianDespues !== bohemianAntes) {
    throw new Error('Bohemian cambió — aborto');
  }
  console.log('ok banco', QUE, 'bohemian intacto', bohemianAntes.slice(0, 12));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
