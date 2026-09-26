#!/usr/bin/env node
/**
 * Banco de voz offline de AU-RA.
 *
 * Descarga los clips cortos grabados con la voz oficial (Render sirve `GET /voz/<id>.mp3`, o la
 * `ruta` del clip: las expresiones del estudio viven en `/voz/expresiones/<toma>.mp3`) a
 * `assets/voice/<id>.mp3` y genera `src/lib/voiceBank.ts` con:
 *   - VOICE_BANK   → clips empaquetados en el APK (require), 0 ms y sin red.
 *   - REMOTE_CLIPS → ruta remota de TODOS los clips (canciones, chistes, discurso y los que aún no
 *                    existen en el servidor); la app cae a TTS si el clip no responde audio.
 *   - CLIP_TEXT    → lo que dice cada clip (burbuja + fallback TTS).
 *   - PHRASE_TO_CLIP → frase exacta → clip (para que `speak()` no pague TTS por una frase grabada).
 *
 * El archivo generado nunca referencia un asset que no exista en disco: si una descarga falla, ese
 * clip queda solo como remoto y `tsc`/Metro siguen pasando.
 *
 *   node scripts/build-voice-bank.mjs [API_BASE]
 */
import fs from 'node:fs';
import path from 'node:path';

const API = (process.argv[2] || process.env.ULTRON_API || 'https://ultron-looi-desk.onrender.com').replace(/\/$/, '');
const root = path.resolve(new URL('..', import.meta.url).pathname);
const outDir = path.join(root, 'assets', 'voice');
fs.mkdirSync(outDir, { recursive: true });

/** Un clip empaquetado no debe pasar de este tamaño (los largos se quedan en el servidor). */
const MAX_BUNDLED_BYTES = 300 * 1024;

/**
 * id, texto aproximado, si se empaqueta y las frases exactas que lo disparan desde `speak()`.
 * Los `phrases` deben coincidir letra por letra (tras bankKey) con lo que dice la app.
 * `ruta`: dónde lo sirve Render, si no es `/voz/<id>.mp3`.
 *
 * Empaquetados: lo que tiene que sonar al instante o sin red (saludos, reacciones al tacto). Las
 * canciones nunca: pesan un mega cada una y van por la red.
 */
const CLIPS = [
  // --- cortos: se empaquetan ---
  { id: 'mmm', text: 'Mmm… déjame ver.', bundle: true, phrases: ['Déjame ver.', 'Mmm… déjame ver.', 'Mmm.'] },
  { id: 'je', text: 'Je, je.', bundle: true, phrases: ['Jeje.', 'Je, je.'] },
  { id: 'uy', text: 'Uy.', bundle: true, phrases: ['Uy.'] },
  { id: 'vale', text: 'Vale, jefe.', bundle: true, phrases: ['Vale, jefe.', 'Vale.'] },
  { id: 'entendido', text: 'Entendido.', bundle: true, phrases: ['Entendido.'] },
  { id: 'dias', text: 'Buenos días, José. Estoy lista. ¿En qué te ayudo?', bundle: true, phrases: ['Buenos días, José. Estoy lista. ¿En qué te ayudo?'] },
  { id: 'tardes', text: 'Buenas tardes, José. Estoy lista. ¿En qué te ayudo?', bundle: true, phrases: ['Buenas tardes, José. Estoy lista. ¿En qué te ayudo?'] },
  { id: 'noches', text: 'Buenas noches, José. Estoy lista. ¿En qué te ayudo?', bundle: true, phrases: ['Buenas noches, José. Estoy lista. ¿En qué te ayudo?'] },
  { id: 'calenta', text: 'Espera. Estamos calentando el motor de veintisiete B.', bundle: true, phrases: ['Espera. Estamos calentando el motor de veintisiete B.'] },
  { id: 'listos', text: 'Estamos listos.', bundle: true, phrases: ['Estamos listos.'] },
  // --- largos: solo remotos ---
  { id: 'puedo', text: 'Esto es lo que puedo hacer.', bundle: false, phrases: [] },
  { id: 'chiste1', text: 'Chiste uno.', bundle: false, phrases: [] },
  { id: 'chiste2', text: 'Chiste dos.', bundle: false, phrases: [] },
  { id: 'chiste3', text: 'Chiste tres.', bundle: false, phrases: [] },
  { id: 'chiste4', text: 'Chiste cuatro.', bundle: false, phrases: [] },
  { id: 'chiste5', text: 'Chiste cinco.', bundle: false, phrases: [] },
  { id: 'bruno', text: 'Die With A Smile — Bruno Mars.', bundle: false, phrases: [] },
  { id: 'bohemian', text: 'Bohemian Rhapsody — Queen.', bundle: false, phrases: [] },
  { id: 'ligera', text: 'De música ligera — Soda Stereo.', bundle: false, phrases: [] },
  { id: 'bittersweet', text: 'Bitter Sweet Symphony — The Verve.', bundle: false, phrases: [] },
  { id: 'runaway', text: 'Runaway — Kanye West.', bundle: false, phrases: [] },
  // --- nuevos (los sube el servidor en el próximo deploy; hasta entonces caen a TTS) ---
  { id: 'jesus', text: 'Quiero conocer a Jesús — Generación 12 (versión de AU-RA).', bundle: false, phrases: [] },
  { id: 'risa1', text: 'Jajaja.', bundle: false, phrases: ['Jajaja.', 'Jaja.'] },
  { id: 'risa2', text: 'Jeje, jajaja.', bundle: false, phrases: [] },
  { id: 'mmm2', text: 'Mmm…', bundle: false, phrases: [] },
  { id: 'uy2', text: 'Uy…', bundle: false, phrases: [] },
  { id: 'aqui', text: 'Aquí estoy.', bundle: false, phrases: ['Aquí estoy.'] },
  { id: 'listo', text: 'Listo.', bundle: false, phrases: ['Listo.'] },
  { id: 'yaya', text: 'Ya, ya.', bundle: false, phrases: ['Ya, ya.'] },
  { id: 'gracias', text: 'Gracias.', bundle: false, phrases: ['Gracias.'] },
  { id: 'hola', text: 'Hola.', bundle: false, phrases: ['Hola.'] },
  // --- nuevos de emoción (también los sube el servidor; se usan sin fallback a TTS) ---
  { id: 'despertar', text: 'Ya despierto.', bundle: false, phrases: [] },
  { id: 'triste', text: 'Ay…', bundle: false, phrases: [] },
  { id: 'cansado', text: 'Aaah…', bundle: false, phrases: [] },
  { id: 'carino', text: 'Mmm… gracias.', bundle: false, phrases: [] },
  { id: 'molesto', text: 'Oye…', bundle: false, phrases: [] },
  { id: 'orgullo', text: 'Eso se nota.', bundle: false, phrases: [] },
  { id: 'sorpresa', text: '¡Uy!', bundle: false, phrases: [] },
  { id: 'oracion', text: 'Oración por el día.', bundle: false, phrases: [] },
  { id: 'waymaker', text: 'Way Maker — Sinach (versión de AU-RA).', bundle: false, phrases: [] },
  // --- canciones propias de AU-RA (estudio, voz de Dora): remotas ---
  { id: 'bienvenida', text: 'Bienvenidos a AU-RA — canción de AU-RA.', bundle: false, phrases: [] },
  { id: 'felizdia', text: 'Feliz día — canción de AU-RA.', bundle: false, phrases: [] },
  { id: 'bendicion', text: 'Bendición — canción de AU-RA.', bundle: false, phrases: [] },
  { id: 'cuna', text: 'Duerme, duerme — canción de cuna de AU-RA.', bundle: false, phrases: [] },
  // --- bienvenida y respuestas de todos los días (Dora, scripts/grabar-banco.ts) ---
  { id: 'bienvenido', text: 'Bienvenido a AU-RA. ¿En qué te ayudo?', bundle: true, phrases: ['Bienvenido a AU-RA. ¿En qué te ayudo?'] },
  { id: 'vertejose', text: 'Qué bueno verte, José.', bundle: true, phrases: ['Qué bueno verte, José.'] },
  { id: 'vertemedardo', text: 'Qué bueno verte, Medardo.', bundle: true, phrases: ['Qué bueno verte, Medardo.'] },
  { id: 'holadenuevo', text: 'Hola de nuevo.', bundle: true, phrases: ['Hola de nuevo.'] },
  { id: 'unmomento', text: 'Un momento.', bundle: true, phrases: ['Un momento.'] },
  { id: 'sinconexion', text: 'Estoy sin conexión ahora mismo.', bundle: true, phrases: ['Estoy sin conexión ahora mismo.'] },
  { id: 'hastaluego', text: 'Hasta luego.', bundle: true, phrases: ['Hasta luego.'] },
  { id: 'denada', text: 'De nada.', bundle: true, phrases: ['De nada.'] },
  { id: 'vertecarlos', text: 'Qué bueno verte, Carlos.', bundle: false, phrases: ['Qué bueno verte, Carlos.'] },
  { id: 'vertemayra', text: 'Qué bueno verte, Mayra.', bundle: false, phrases: ['Qué bueno verte, Mayra.'] },
  { id: 'mealegra', text: 'Me alegra verte.', bundle: false, phrases: ['Me alegra verte.'] },
  { id: 'dameunsegundo', text: 'Dame un segundo, lo busco.', bundle: false, phrases: ['Dame un segundo, lo busco.'] },
  { id: 'claroquesi', text: 'Claro que sí.', bundle: false, phrases: ['Claro que sí.'] },
  { id: 'congusto', text: 'Con gusto.', bundle: false, phrases: ['Con gusto.'] },
  { id: 'perfecto', text: 'Perfecto.', bundle: false, phrases: ['Perfecto.'] },
  { id: 'yaesta', text: 'Ya está.', bundle: false, phrases: ['Ya está.'] },
  { id: 'aquilotenes', text: 'Aquí lo tenés.', bundle: false, phrases: ['Aquí lo tenés.'] },
  { id: 'noentendi', text: 'No te entendí bien, ¿me lo repetís?', bundle: false, phrases: ['No te entendí bien, ¿me lo repetís?'] },
  { id: 'cuandoquieras', text: 'Cuando quieras.', bundle: false, phrases: ['Cuando quieras.'] },
  { id: 'quedescanses', text: 'Que descanses.', bundle: false, phrases: ['Que descanses.'] },
  // --- reacciones sin palabras (expresiones del estudio): las del tacto van en el APK ---
  { id: 'risacorta', text: 'Ji, ji, ji.', bundle: true, phrases: [], ruta: '/voz/expresiones/risa-corta-1.mp3' },
  { id: 'jepicara', text: 'Je, je, je.', bundle: true, phrases: [], ruta: '/voz/expresiones/je-picara-1.mp3' },
  { id: 'sorpresaoh', text: 'Oh.', bundle: true, phrases: [], ruta: '/voz/expresiones/sorpresa-oh-1.mp3' },
  { id: 'mmmpensando', text: 'Mmm.', bundle: true, phrases: [], ruta: '/voz/expresiones/mmm-pensando-2.mp3' },
  { id: 'aww', text: 'Aww.', bundle: true, phrases: [], ruta: '/voz/expresiones/aww-ternura-1.mp3' },
  { id: 'bostezo', text: 'Aaah…', bundle: true, phrases: [], ruta: '/voz/expresiones/bostezo-1.mp3' },
  { id: 'risatierna', text: 'Ji, ji.', bundle: false, phrases: [], ruta: '/voz/expresiones/risa-tierna-1.mp3' },
  { id: 'asombro', text: 'Ah.', bundle: false, phrases: [], ruta: '/voz/expresiones/asombro-gasp-2.mp3' },
  { id: 'hmm', text: 'Mmm, no sé.', bundle: false, phrases: [], ruta: '/voz/expresiones/hmm-dudando-1.mp3' },
];

/** Dónde sirve Render cada clip. */
const rutaDe = (c) => c.ruta || `/voz/${c.id}.mp3`;

const bankKey = (t) =>
  String(t)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ]+/g, '');

async function download(c, dest) {
  try {
    const r = await fetch(`${API}${rutaDe(c)}`, { headers: { Accept: 'audio/mpeg' } });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !/audio|octet/.test(ct)) return { ok: false, why: `${r.status} ${ct}` };
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 1024) return { ok: false, why: 'demasiado pequeño' };
    if (buf.length > MAX_BUNDLED_BYTES) return { ok: false, why: `${Math.round(buf.length / 1024)} KB > límite` };
    fs.writeFileSync(dest, buf);
    return { ok: true, bytes: buf.length };
  } catch (e) {
    return { ok: false, why: e?.message || 'red' };
  }
}

const bundled = [];
for (const c of CLIPS) {
  if (!c.bundle) continue;
  const dest = path.join(outDir, `${c.id}.mp3`);
  if (!fs.existsSync(dest) || fs.statSync(dest).size < 1024) {
    const r = await download(c, dest);
    if (!r.ok) {
      console.error(`  ✗ ${c.id}: ${r.why} → queda remoto`);
      continue;
    }
    console.log(`  ✓ ${c.id} (${Math.round(r.bytes / 1024)} KB)`);
  } else console.log(`  = ${c.id} (ya estaba)`);
  bundled.push(c.id);
}

// limpia huérfanos
const keep = new Set(bundled.map((id) => `${id}.mp3`));
for (const f of fs.readdirSync(outDir)) if (!keep.has(f)) fs.unlinkSync(path.join(outDir, f));

const ids = CLIPS.map((c) => c.id);
const phraseMap = [];
const seenKeys = new Set();
for (const c of CLIPS) for (const p of c.phrases) {
  const k = bankKey(p);
  if (seenKeys.has(k)) continue; // «Jeje.» y «Je, je.» colapsan a la misma clave
  seenKeys.add(k);
  phraseMap.push([k, c.id, p]);
}

const ts = `/* Generado por scripts/build-voice-bank.mjs — no editar a mano. */
/* eslint-disable */

export type ClipId =
${ids.map((id) => `  | '${id}'`).join('\n')};

export const CLIP_IDS: readonly ClipId[] = [${ids.map((id) => `'${id}'`).join(', ')}];

export function bankKey(t: string): string {
  return String(t)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .replace(/[^a-z0-9ñ]+/g, '');
}

/** Clips empaquetados en el APK (assets/voice). Suenan sin red. */
export const VOICE_BANK: Partial<Record<ClipId, number>> = {
${bundled.map((id) => `  ${id}: require('../../assets/voice/${id}.mp3'),`).join('\n')}
};

/** Ruta remota de cada clip (Render sirve /voz/<id>.mp3; las expresiones, /voz/expresiones/<toma>.mp3). */
export const REMOTE_CLIPS: Record<ClipId, string> = {
${CLIPS.map((c) => `  ${c.id}: '${rutaDe(c)}',`).join('\n')}
};

/** Qué dice cada clip (burbuja y fallback a TTS si el clip no responde audio). */
export const CLIP_TEXT: Record<ClipId, string> = {
${CLIPS.map((c) => `  ${c.id}: ${JSON.stringify(c.text)},`).join('\n')}
};

/** Frase exacta (bankKey) → clip, para que speak() use el clip en vez de pedir TTS. */
export const PHRASE_TO_CLIP: Record<string, ClipId> = {
${phraseMap.map(([k, id, p]) => `  // ${p.replace(/\*\//g, '')}\n  ${JSON.stringify(k)}: '${id}',`).join('\n')}
};

export const BUNDLED_CLIP_IDS: readonly ClipId[] = [${bundled.map((id) => `'${id}'`).join(', ')}];
`;
fs.writeFileSync(path.join(root, 'src', 'lib', 'voiceBank.ts'), ts);
const total = bundled.reduce((n, id) => n + fs.statSync(path.join(outDir, `${id}.mp3`)).size, 0);
console.log(`voiceBank: ${ids.length} clips, ${bundled.length} empaquetados (${Math.round(total / 1024)} KB), ${ids.length - bundled.length} remotos`);
